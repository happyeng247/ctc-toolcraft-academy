/* Persistent voice learning controller. Provider credentials never belong here. */
(() => {
  'use strict';
  const content = window.AcademyVoiceContent;
  const config = window.ACADEMY_VOICE_CONFIG || {};
  const find = id => document.getElementById(id);
  const text = value => String(value ?? '');
  let preferences = {};
  try { preferences = JSON.parse(localStorage.getItem('ctc-voice-preferences-v1') || '{}'); } catch (_) {}
  const prefs = {
    rate: 1, engine: 'device', fallbackReason: '', continueLesson: false, bookmarks: {}, bookmarkIds: {},
    ...preferences,
  };
  if (![0.75, 1, 1.25, 1.5].includes(Number(prefs.rate))) prefs.rate = 1;
  if (!['device', 'elevenlabs'].includes(prefs.engine)) prefs.engine = 'device';
  if (prefs.engine !== 'device' || prefs.fallbackReason !== 'quota') prefs.fallbackReason = '';
  const quotaFallbackNotice = 'ElevenLabs reported insufficient credits. Listening uses your device voice. Choose Use ElevenLabs voice to try again.';
  let endpoint = normalizeEndpoint(prefs.endpoint || config.endpoint ||
    (location.hostname.endsWith('.vercel.app') ? `${location.origin}/api/voice` : ''));
  let sessionToken = '', sessionExpiresAt = 0, voiceNotice = prefs.fallbackReason === 'quota' ? quotaFallbackNotice : '';
  let expanded = false, selectedMode = 'listen', currentRoute = '';
  let sections = [], sectionIndex = 0, generation = 0, tutorGeneration = 0, operation = 0;
  let continuationTimer = null, autoContinueRoute = '', wakeGeneration = 0;
  let playing = false, paused = false, narrationKind = '', utterance = null;
  let currentAudio = null, currentAudioUrl = '', pendingPlay = false, mediaPlayGeneration = 0;
  let conversation = null, tutorConnecting = false, tutorTextOnly = false, muted = false;
  let recognizer = null, scribe = null, dictating = false, dictateGeneration = 0;
  let scribePartial = '', finishingDictation = false, dictationFinishTimer = null, questionSending = false;
  let lastAppend = null, sdkPromise = null, pendingAfterLogin = null;
  let wakeLock = null, wakeRequested = false;
  let previousFocusedField = null, lastAgentMessage = '', contextTimer = null, launchElement = null;
  let lastContext = '', fetchControllers = new Set(), pendingTypedMessage = '';
  function courseContext() {
    return { ...content.getContext(), narration: { sectionIndex: sectionIndex + 1, sectionId: sections[sectionIndex]?.id, sectionTitle: sections[sectionIndex]?.title } };
  }
  const messageNodes = new Map();
  const audioCache = new Map();

  function normalizeEndpoint(value) {
    if (!value) return '';
    try {
      const url = new URL(value, location.href);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
          url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/api/voice')) return '';
      return url.href;
    } catch (_) { return ''; }
  }
  function storePreferences() {
    try { localStorage.setItem('ctc-voice-preferences-v1', JSON.stringify({ ...prefs, endpoint })); } catch (_) {}
  }
  function status(message, active = false) {
    find('voice-status').textContent = message;
    find('voice-dock').classList.toggle('voice-active', active);
    find('voice-badge').textContent = active ? 'LIVE' : 'VOICE';
    updateSurface();
  }
  function notice(message = '') {
    voiceNotice = message;
    for (const id of ['voice-notice', 'voice-inline-notice']) {
      const element = find(id);
      if (element) { element.textContent = message; element.hidden = !message; }
    }
  }
  function chooseDeviceVoice(message = '', fallbackReason = '') {
    prefs.engine = 'device'; prefs.fallbackReason = fallbackReason;
    find('voice-engine').value = 'device'; storePreferences(); notice(message); updateSurface();
  }
  function changeListeningEngine(engine) {
    stopNarration(); prefs.engine = engine; prefs.fallbackReason = '';
    find('voice-engine').value = engine; storePreferences(); notice(); status('Voice changed · press Play');
  }
  function error(message = '') {
    find('voice-error').textContent = message;
    find('voice-error').hidden = !message;
    if (!message) find('voice-use-device').hidden = true;
    if (message) setExpanded(true);
  }
  function updateSurface() {
    const busy = playing || pendingPlay || dictating || !!conversation || tutorConnecting;
    find('voice-dock').hidden = !expanded && !busy;
    find('voice-dock').classList.toggle('voice-auth-open', !find('voice-auth').hidden);
    document.body.classList.toggle('voice-has-activity', busy || expanded);
    find('voice-quick-pause').hidden = !playing;
    find('voice-quick-pause').textContent = paused ? 'Resume' : pendingPlay ? 'Play' : 'Pause';
    find('voice-bar-title').textContent = dictating ? 'Capturing your notes' : conversation || tutorConnecting || selectedMode === 'tutor' ? 'Your learning companion' : selectedMode === 'dictate' ? 'Your learning notes' : 'Lesson audio';
    const inlineStatus = find('voice-inline-status');
    if (inlineStatus) inlineStatus.textContent = busy ? find('voice-status').textContent : 'Listen at your pace. Ask whenever something is unclear.';
    const inlinePlay = find('voice-inline-listen');
    if (inlinePlay) {
      inlinePlay.textContent = playing ? paused ? '▶ Resume' : pendingPlay ? '▶ Play audio' : 'Ⅱ Pause' : currentRoute.startsWith('lesson/') ? '▶ Listen to lesson' : '▶ Listen to page';
      inlinePlay.setAttribute('aria-pressed', String(playing && !paused));
      inlinePlay.disabled = !sections.length;
    }
    const inlineNext = find('voice-inline-next');
    if (inlineNext) inlineNext.hidden = !playing;
    const inlineSection = find('voice-inline-section');
    if (inlineSection) {
      inlineSection.hidden = !playing;
      inlineSection.textContent = `Section ${sectionIndex + 1} of ${sections.length} · ${sections[sectionIndex]?.title || ''}`;
    }
    const inlineAsk = find('voice-inline-tutor');
    if (inlineAsk) inlineAsk.textContent = conversation || tutorConnecting ? 'Open conversation ↗' : 'Ask your tutor ↗';
    const inlineElevenLabs = find('voice-inline-elevenlabs');
    if (inlineElevenLabs) { inlineElevenLabs.hidden = prefs.engine !== 'device'; inlineElevenLabs.disabled = !sections.length; }
  }
  function setExpanded(value) {
    if (!value && find('voice-panel').contains?.(document.activeElement)) {
      const fallback = launchElement?.parentNode && launchElement.isConnected !== false ? launchElement : find('voice-inline-listen') || document.querySelector('[data-voice-action="tutor"]') || find('voice-toggle');
      fallback?.focus();
    }
    if (!value && !find('voice-auth').hidden) {
      pendingAfterLogin = null; find('voice-auth').hidden = true; find('voice-access-code').value = '';
    }
    expanded = value;
    find('voice-panel').hidden = !value;
    find('voice-dock').classList.toggle('voice-expanded', value);
    find('voice-toggle').setAttribute('aria-expanded', String(value));
    find('voice-toggle').textContent = value ? 'Minimize' : 'Controls';
    document.body.classList.toggle('voice-panel-open', value);
    updateSurface();
  }
  function mountInline() {
    const slot = find('voice-learning-slot');
    if (!slot || slot.querySelector('.voice-inline')) return;
    slot.innerHTML = `<div class="voice-inline"><div class="voice-inline-symbol" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div><div class="voice-inline-copy"><span class="eyebrow">LEARN YOUR WAY</span><strong>Read. Listen. Talk it through.</strong><p id="voice-inline-status" role="status" aria-live="polite"></p><small id="voice-inline-section" hidden></small><small id="voice-inline-notice" hidden></small></div><div class="voice-inline-actions"><button type="button" class="button primary" id="voice-inline-listen" data-voice-action="listen">▶ Listen to lesson</button><button type="button" class="button" id="voice-inline-elevenlabs" data-voice-engine-choice="elevenlabs">Use ElevenLabs voice</button><button type="button" class="button" id="voice-inline-tutor" data-voice-action="tutor">Ask your tutor ↗</button><button type="button" class="voice-text-button" id="voice-inline-next" data-voice-next hidden>Next section →</button><button type="button" class="voice-text-button voice-options" data-voice-panel="listen" aria-label="Listening options and audio download">Listening options</button></div></div>`;
    notice(voiceNotice); updateSurface();
  }
  async function startMode(mode, options = {}) {
    if (!['listen', 'tutor', 'dictate'].includes(mode)) return;
    const previousSectionId = sections[sectionIndex]?.id;
    if (typeof options.sectionId === 'string') {
      refreshSections();
      const selected = sections.findIndex(part => part.id === options.sectionId);
      if (selected < 0) return;
      options = { ...options, sectionIndex: selected };
    }
    if (Number.isInteger(options.sectionIndex)) {
      sectionIndex = Math.max(0, Math.min(sections.length - 1, options.sectionIndex));
      highlight(); sendContext();
    }
    selectMode(mode);
    if (mode === 'dictate' && typeof options.target === 'string' && dictationTargets().some(item => item.value === options.target)) {
      find('voice-dictation-target').value = options.target;
      showSavedWords();
    }
    if (mode === 'listen') {
      if (playing && (!Number.isInteger(options.sectionIndex) || ((paused || pendingPlay) && sections[sectionIndex]?.id === previousSectionId))) toggleReading();
      else await startReading(sectionIndex);
      return;
    }
    if (playing) { stopNarration(); status('Ready for your question'); }
    setExpanded(true);
    if (mode === 'tutor') {
      if (!conversation && !tutorConnecting) await startTutor(false);
    } else if (!dictating) await startDictation(options.target);
  }
  function selectMode(mode) {
    selectedMode = mode;
    document.querySelectorAll('[data-voice-mode]').forEach(button => {
      const on = button.dataset.voiceMode === mode;
      button.classList.toggle('active', on);
      button.setAttribute('aria-selected', String(on));
      button.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('.voice-pane').forEach(pane => { pane.hidden = pane.dataset.voicePane !== mode; });
    if (mode === 'dictate') refreshDictationTargets();
    if (mode === 'tutor') updateTutorButtons();
  }

  const dock = document.createElement('section');
  dock.id = 'voice-dock';
  dock.setAttribute('aria-label', 'Voice learning controls');
  dock.innerHTML = `
    <div class="voice-bar">
      <div class="voice-heading"><span class="voice-badge" id="voice-badge">VOICE</span><div><strong id="voice-bar-title">Your learning companion</strong><span id="voice-status" role="status" aria-live="polite">Ready when you are</span></div></div>
      <div class="voice-actions voice-bar-actions"><button class="button" id="voice-quick-pause" hidden>Pause</button><button class="button" id="voice-stop" title="Stop playback and turn off the microphone">Stop all</button><button class="button" id="voice-toggle" aria-expanded="false" aria-controls="voice-panel">Controls</button></div>
    </div>
    <div id="voice-panel" hidden>
      <div class="voice-panel-header"><div><span class="eyebrow">YOUR LEARNING COMPANION</span><strong id="voice-place"></strong></div><button id="voice-close" class="voice-icon-button" aria-label="Close voice panel">×</button></div>
      <div class="voice-tabs" role="tablist" aria-label="Voice learning mode">
        <button class="button active" id="voice-listen-tab" role="tab" tabindex="0" data-voice-mode="listen" aria-selected="true" aria-controls="voice-listen-pane">Listen</button>
        <button class="button" id="voice-tutor-tab" role="tab" tabindex="-1" data-voice-mode="tutor" aria-selected="false" aria-controls="voice-tutor-pane">Ask tutor</button>
        <button class="button" id="voice-dictate-tab" role="tab" tabindex="-1" data-voice-mode="dictate" aria-selected="false" aria-controls="voice-dictate-pane">Dictate</button>
      </div>
      <p id="voice-error" class="voice-error" role="alert" hidden></p><p id="voice-notice" class="voice-notice" role="status" hidden></p><button id="voice-use-device" class="button" hidden>Listen with device voice</button>
      <div class="voice-auth" id="voice-auth" hidden>
        <div class="voice-auth-icon" aria-hidden="true">✦</div><h3>A conversation away<br>from understanding.</h3><p class="voice-help">Enter your academy access code to talk with your tutor. You only need to do this once while this page stays open.</p>
        <label class="voice-field" for="voice-access-code">Your access code<input id="voice-access-code" type="password" autocomplete="current-password" maxlength="256" placeholder="Enter your academy code"></label>
        <div class="voice-actions"><button class="button primary" id="voice-login">Continue</button><button class="button" id="voice-auth-cancel">Go back</button></div>
        <p id="voice-auth-status" class="voice-inline-status" aria-live="polite"></p>
      </div>
      <div class="voice-pane" id="voice-listen-pane" data-voice-pane="listen" aria-labelledby="voice-listen-tab" role="tabpanel">
        <p class="voice-intro">Take the lesson with you.</p><p class="voice-help">Listen section by section, at your own pace. Your place is remembered.</p>
        <label class="voice-field" for="voice-section-select">Where to begin<select id="voice-section-select" class="voice-section-list"></select></label>
        <div class="voice-section-controls"><button class="button" id="voice-previous" aria-label="Previous section">← Back</button><button class="button primary voice-primary" id="voice-read">Play from here</button><button class="button" id="voice-next" aria-label="Next section">Next →</button></div>
        <details class="voice-settings"><summary>Listening preferences</summary><div class="voice-actions"><label class="voice-field" for="voice-speed">Speed<select id="voice-speed"><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option></select></label><label class="voice-field" for="voice-engine">Voice<select id="voice-engine"><option value="device">Device voice · ready now</option><option value="elevenlabs">ElevenLabs · access code</option></select></label></div><label class="voice-check"><input id="voice-continue" type="checkbox"><span>Continue to the next lesson automatically</span></label><p class="voice-help">Listening does not complete the knowledge check. You can answer it yourself or ask your tutor to quiz you.</p></details>
        <details class="voice-settings"><summary>Download this lesson as audio</summary><p class="voice-help">Prepare a single audio track, then save it to listen when your screen is locked. Uses your private ElevenLabs voice.</p><button class="button" id="voice-full-audio">Prepare audio</button><audio id="voice-audio-player" controls preload="none" hidden></audio><button class="button" id="voice-download-audio" hidden>Download audio</button></details>
      </div>
      <div class="voice-pane" id="voice-tutor-pane" data-voice-pane="tutor" aria-labelledby="voice-tutor-tab" role="tabpanel" hidden>
        <p class="voice-intro">Make it a conversation.</p><p class="voice-help">Your tutor knows which lesson you’re in. Ask a question, explore a concept, or say “quiz me”.</p>
        <div class="voice-actions"><button class="button primary voice-primary" id="voice-start-tutor">Start conversation</button><button class="button" id="voice-mute" disabled>Mute mic</button></div>
        <div class="voice-prompts" aria-label="Question ideas"><button type="button" data-voice-prompt="Explain this section in simpler terms.">Explain it simply</button><button type="button" data-voice-prompt="Give me a practical example of this concept.">Give me an example</button><button type="button" data-voice-prompt="Quiz me on this lesson, one question at a time.">Quiz me</button></div>
        <div class="voice-transcript" id="voice-transcript" role="log" aria-label="Tutor conversation" aria-live="polite"></div>
        <form class="voice-compose" id="voice-question-form"><label class="voice-field" for="voice-question">Or type your question<textarea id="voice-question" rows="2" maxlength="2000" placeholder="What does the helix angle change?"></textarea></label><button class="button primary" type="submit">Send →</button></form>
        <div class="voice-actions"><button class="voice-text-button" id="voice-text-tutor">Use text only</button><button class="voice-text-button" id="voice-save-reply" disabled>Save last reply to notes</button></div>
        <details class="voice-settings"><summary>Conversation details</summary><p class="voice-help">Your microphone and current lesson are shared with ElevenLabs. Your saved notes are not sent automatically. Use your team’s checks before making production decisions.</p><button class="button" id="voice-clear-transcript">Clear transcript</button></details>
      </div>
      <div class="voice-pane" id="voice-dictate-pane" data-voice-pane="dictate" aria-labelledby="voice-dictate-tab" role="tabpanel" hidden>
        <p class="voice-intro">Keep the thought.</p><p class="voice-help">Speak your notes, then review the words before saving them.</p>
        <label class="voice-field" for="voice-dictation-target">Add to<select id="voice-dictation-target"></select></label>
        <div class="voice-actions"><button class="button primary voice-primary" id="voice-dictate">Start dictation</button><button class="button" id="voice-finish-dictation" disabled>Finish</button></div>
        <p id="voice-interim" class="voice-inline-status" aria-live="polite"></p>
        <label class="voice-field" for="voice-draft">Review your words<textarea id="voice-draft" rows="4" maxlength="8000" placeholder="Your words will appear here. You can edit them before adding them to your notes."></textarea></label>
        <div class="voice-actions"><button class="button primary" id="voice-save-dictation">Add to notes</button><button class="voice-text-button" id="voice-undo-dictation" disabled>Undo last addition</button></div>
        <details class="voice-settings"><summary>Dictation preferences & saved notes</summary><label class="voice-field" for="voice-dictation-engine">Dictation service<select id="voice-dictation-engine"><option value="browser">Browser dictation</option><option value="elevenlabs">ElevenLabs Scribe</option></select></label><p class="voice-help">Existing notes stay intact. Your browser or ElevenLabs processes the microphone audio. You can also type or use your phone keyboard’s microphone.</p><pre id="voice-saved-words" class="voice-saved-words"></pre></details>
      </div>
      <details class="voice-settings voice-service-details" id="voice-service-settings"><summary>Connection & privacy</summary><p class="voice-help">Listening with your device voice needs no code. Conversations and ElevenLabs audio use the academy’s private voice service.</p><details><summary>Advanced connection settings</summary><label class="voice-field" for="voice-endpoint">Voice service address<input type="url" id="voice-endpoint" placeholder="https://your-voice-service.vercel.app/api/voice" autocomplete="off"></label><div class="voice-actions"><button class="button" id="voice-save-endpoint">Save connection</button></div></details><button class="voice-text-button" id="voice-signout">Lock private voice</button><p id="voice-connection-status" class="voice-inline-status"></p><p class="voice-help">Keep this page open while talking. Locking your phone or switching apps may interrupt voice. Download lesson audio to listen separately.</p></details>
    </div>
    `;
  document.body.appendChild(dock);

  async function request(action, extra = {}, signal) {
    if (!endpoint) throw new Error('Connect the private voice service first. Device narration is available now.');
    const controller = new AbortController();
    fetchControllers.add(controller);
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, action === 'tts' ? 60000 : 20000);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (action !== 'login') headers.Authorization = `Bearer ${sessionToken}`;
      const response = await fetch(endpoint, {
        method: 'POST', credentials: 'omit', cache: 'no-store', headers,
        body: JSON.stringify({ action, ...extra }), signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 401) { sessionToken = ''; sessionExpiresAt = 0; }
        const messages = {
          401: 'Private voice is locked. Enter your access code again.',
          403: 'This website is not allowed by the voice service configuration.',
          413: 'That passage is too long. Try reading one section.',
          429: 'Voice usage is temporarily limited. Please try again later.',
          503: 'The private voice service has not been configured yet.',
        };
        const knownErrors = {
          provider_quota_exceeded: 'There are not enough ElevenLabs credits for this request. Lesson listening can use your device voice. Add credits in ElevenLabs to use its voice and downloadable audio.',
          provider_not_configured: 'The academy’s ElevenLabs connection needs attention. Device listening is still available.',
          provider_text_too_long: 'This passage is too long for one audio request. Listen one section at a time.',
          provider_busy: 'ElevenLabs is busy. Wait a moment and try again, or listen with your device voice.',
          provider_timeout: 'ElevenLabs took too long to respond. Try again, or listen with your device voice.',
          provider_unavailable: 'ElevenLabs could not prepare this request. Try again, or listen with your device voice.',
          provider_response_invalid: 'ElevenLabs returned an incomplete response. Try again, or listen with your device voice.',
        };
        let detail;
        try { detail = await response.json(); } catch (_) {}
        const code = typeof detail?.error === 'string' && Object.prototype.hasOwnProperty.call(knownErrors, detail.error) ? detail.error : '';
        const failure = new Error(knownErrors[code] || messages[response.status] || 'The voice service could not complete the request. Try again shortly.');
        failure.code = code; failure.status = response.status;
        throw failure;
      }
      if (action === 'tts') {
        if (!response.headers.get('content-type')?.startsWith('audio/')) throw new Error('The voice service returned an unexpected audio format.');
        return await response.blob();
      }
      return await response.json();
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('The voice request was stopped or timed out.');
      if (err instanceof TypeError) throw new Error('Cannot reach the voice service. Check your connection and service address.');
      throw err;
    } finally {
      clearTimeout(timeout); fetchControllers.delete(controller);
      signal?.removeEventListener('abort', abort);
    }
  }
  function requireSession(continuation) {
    if (sessionToken && sessionExpiresAt > Date.now() + 10000) return true;
    setExpanded(true);
    if (!endpoint) {
      error('ElevenLabs is not connected yet. Device narration and supported browser dictation work now.');
      find('voice-service-settings').open = true;
      const advanced = find('voice-service-settings').querySelector('details');
      if (advanced) advanced.open = true;
      find('voice-endpoint').focus();
      return false;
    }
    pendingAfterLogin = continuation;
    find('voice-auth').hidden = false;
    find('voice-auth-status').textContent = '';
    status('Enter your academy access code');
    updateSurface();
    find('voice-access-code').focus();
    return false;
  }
  async function login() {
    const code = find('voice-access-code').value;
    if (!code) { find('voice-auth-status').textContent = 'Enter your academy access code.'; return; }
    if (/^sk_[A-Za-z0-9]{20,}$/.test(code)) {
      find('voice-access-code').value = '';
      find('voice-auth-status').textContent = 'This field accepts an academy access code, not an API key.';
      return;
    }
    find('voice-login').disabled = true;
    find('voice-auth-status').textContent = 'Connecting…';
    try {
      const response = await request('login', { code });
      if (!response.sessionToken || !Number.isFinite(Date.parse(response.expiresAt))) throw new Error('The voice service returned an invalid session.');
      sessionToken = response.sessionToken; sessionExpiresAt = Date.parse(response.expiresAt);
      find('voice-auth').hidden = true;
      updateSurface();
      find('voice-access-code').value = '';
      find('voice-connection-status').textContent = 'Private voice unlocked for this page session.';
      error();
      const resume = pendingAfterLogin; pendingAfterLogin = null;
      if (resume) await resume();
    } catch (err) { find('voice-auth-status').textContent = err.message; }
    finally { find('voice-login').disabled = false; }
  }
  function loadSDK() {
    if (window.ElevenLabsClient?.Conversation) return Promise.resolve(window.ElevenLabsClient);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = config.sdkUrl;
      script.crossOrigin = 'anonymous';
      script.referrerPolicy = 'no-referrer';
      script.async = true;
      const timer = setTimeout(() => finish(new Error('The voice connection library could not load. Check your internet connection.')), 20000);
      function finish(err) {
        clearTimeout(timer); script.onload = script.onerror = null;
        if (err) { script.remove(); sdkPromise = null; reject(err); }
        else resolve(window.ElevenLabsClient);
      }
      script.onload = () => finish(window.ElevenLabsClient?.Conversation ? null : new Error('The voice library did not initialize.'));
      script.onerror = () => finish(new Error('The voice connection library could not load. Check your internet connection.'));
      document.head.appendChild(script);
    });
    return sdkPromise;
  }

  async function keepAwake(value) {
    const run = ++wakeGeneration;
    wakeRequested = value;
    if (!value) { const old = wakeLock; wakeLock = null; try { await old?.release(); } catch (_) {} return; }
    if (wakeLock || document.visibilityState !== 'visible' || !navigator.wakeLock) return;
    try {
      const acquired = await navigator.wakeLock.request('screen');
      if (!wakeRequested || run !== wakeGeneration) { await acquired.release(); return; }
      wakeLock = acquired;
      acquired.addEventListener('release', () => { if (wakeLock === acquired) wakeLock = null; });
    } catch (_) {}
  }
  function stopNarration() {
    generation++; mediaPlayGeneration++; clearTimeout(continuationTimer); autoContinueRoute = '';
    keepAwake(false);
    playing = false; paused = false; pendingPlay = false;
    window.speechSynthesis?.cancel();
    if (utterance) utterance.onend = utterance.onerror = null;
    utterance = null;
    if (currentAudio) { currentAudio.pause(); currentAudio.onended = null; }
    document.querySelectorAll('.voice-reading').forEach(el => el.classList.remove('voice-reading'));
    find('voice-read').textContent = 'Play from here';
    find('voice-audio-player').pause();
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'none';
  }
  function stopDictation(cancel = true) {
    clearTimeout(dictationFinishTimer); finishingDictation = false; scribePartial = '';
    if (cancel) dictateGeneration++;
    const old = recognizer; recognizer = null;
    if (old) { try { cancel ? old.abort() : old.stop(); } catch (_) {} }
    const oldScribe = scribe; scribe = null;
    if (oldScribe) { try { oldScribe.close(); } catch (_) {} }
    dictating = false;
    find('voice-dictate').disabled = false;
    find('voice-finish-dictation').disabled = true;
    find('voice-dictation-target').disabled = false;
    find('voice-dictation-engine').disabled = false;
    if (cancel) find('voice-interim').textContent = '';
  }
  async function endTutor() {
    tutorGeneration++;
    tutorConnecting = false; muted = false; pendingTypedMessage = '';
    const old = conversation; conversation = null;
    updateTutorButtons();
    if (old) { try { await old.endSession(); } catch (_) {} }
  }
  async function stopAll(message = 'Stopped · microphone off') {
    operation++; stopNarration(); stopDictation();
    fetchControllers.forEach(controller => controller.abort());
    pendingAfterLogin = null;
    const ending = endTutor();
    keepAwake(false); status(message);
    await ending;
  }
  function highlight() {
    document.querySelectorAll('.voice-reading').forEach(el => el.classList.remove('voice-reading'));
    sections[sectionIndex]?.element?.classList.add('voice-reading');
    prefs.bookmarks[currentRoute] = sectionIndex;
    prefs.bookmarkIds[currentRoute] = sections[sectionIndex]?.id;
    storePreferences();
    find('voice-section-select').value = String(sectionIndex);
    const selected = sections[sectionIndex]?.id;
    const step = selected?.match(/:(?:section|technical):(\d+)$/);
    if (currentRoute.startsWith('lesson/') && step) window.AcademyLessonVisuals?.selectStep(Number(step[1]));
    else if (currentRoute.startsWith('lesson/') && selected?.endsWith(':objectives')) window.AcademyLessonVisuals?.selectStep(0);
    updateSurface();
  }
  function speakable(value) {
    return text(value).replace(/\bPCBN\b/g, 'P C B N').replace(/\bPCB\b/g, 'P C B').replace(/\bPCD\b/g, 'P C D')
      .replace(/\bCNC\b/g, 'C N C').replace(/\bSKU\b/g, 'S K U').replace(/\bSKUs\b/g, 'S K Us')
      .replace(/\bmm\/min\b/g, 'millimeters per minute').replace(/\bm\/min\b/g, 'meters per minute')
      .replace(/cm³\/min/g, 'cubic centimeters per minute').replace(/\brpm\b/gi, 'revolutions per minute')
      .replace(/°/g, ' degrees ').replace(/δ/g, 'deflection').replace(/∝/g, ' is proportional to ')
      .replace(/γ/g, 'gamma').replace(/α/g, 'alpha').replace(/β/g, 'beta').replace(/×/g, ' times ');
  }
  function speechChunks(value) {
    // Never split by punctuation: decimal dimensions must survive verbatim.
    const words = speakable(value).trim().split(/\s+/);
    const chunks = []; let chunk = '';
    for (const word of words) {
      if (chunk && chunk.length + word.length + 1 > 220) { chunks.push(chunk); chunk = ''; }
      chunk += `${chunk ? ' ' : ''}${word}`;
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  }
  function deviceNarration(value, run, done) {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) throw new Error('This browser cannot read aloud. Try ElevenLabs or another browser.');
    const chunks = speechChunks(value); let index = 0;
    function next() {
      if (run !== generation || !playing) return;
      if (index >= chunks.length) { done(); return; }
      utterance = new SpeechSynthesisUtterance(chunks[index++]);
      utterance.lang = 'en-US'; utterance.rate = Number(prefs.rate);
      const voices = speechSynthesis.getVoices();
      const selected = voices.find(v => v.lang.startsWith('en') && v.localService) || voices.find(v => v.lang.startsWith('en'));
      if (selected) utterance.voice = selected;
      utterance.onend = next;
      utterance.onerror = event => {
        if (run !== generation || ['interrupted', 'canceled'].includes(event.error)) return;
        stopNarration(); keepAwake(false); error('Reading was interrupted. Tap Play from here to resume.'); status('Reading paused');
      };
      speechSynthesis.speak(utterance);
    }
    next();
  }
  async function audioBlob(value) {
    const key = value;
    if (audioCache.has(key)) return audioCache.get(key);
    const blob = await request('tts', { text: speakable(value) });
    audioCache.set(key, blob);
    while (audioCache.size > 6) audioCache.delete(audioCache.keys().next().value);
    return blob;
  }
  function discardAudio() {
    if (currentAudio) { currentAudio.pause(); currentAudio.removeAttribute('src'); currentAudio.load(); }
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudio = null; currentAudioUrl = '';
    find('voice-audio-player').hidden = true;
    find('voice-download-audio').hidden = true;
    find('voice-download-audio').onclick = null;
  }
  function useAudioBlob(blob, title, onEnded) {
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = URL.createObjectURL(blob);
    currentAudio = find('voice-audio-player');
    currentAudio.src = currentAudioUrl; currentAudio.playbackRate = Number(prefs.rate);
    currentAudio.onended = onEnded;
    currentAudio.onplay = () => { if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing'; };
    currentAudio.onpause = () => { if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused'; };
    if (navigator.mediaSession && window.MediaMetadata) {
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist: 'CTC Toolcraft Academy', album: 'Voice learning' });
      for (const [action, handler] of Object.entries({
        play: () => narrationKind === 'section' ? playing && (paused || pendingPlay) && toggleReading() : currentAudio?.play().catch(() => {}),
        pause: () => narrationKind === 'section' ? playing && !paused && toggleReading() : currentAudio?.pause(),
        stop: () => stopAll(), nexttrack: () => moveSection(1), previoustrack: () => moveSection(-1)
      })) {
        try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) {}
      }
    }
  }
  async function playNarrationAudio(run = generation) {
    const audio = currentAudio;
    if (!audio || run !== generation || !playing || paused) return;
    const attempt = ++mediaPlayGeneration;
    pendingPlay = false;
    find('voice-read').textContent = 'Pause';
    status('Starting audio…', true); keepAwake(true);
    try {
      await audio.play();
      if (run !== generation || attempt !== mediaPlayGeneration || audio !== currentAudio || !playing || paused) return;
      find('voice-read').textContent = 'Pause';
      status(`Reading · ${sections[sectionIndex]?.title}`, true); keepAwake(true);
    } catch (_) {
      if (run !== generation || attempt !== mediaPlayGeneration || audio !== currentAudio || !playing || paused) return;
      pendingPlay = true; find('voice-read').textContent = 'Tap to hear';
      status('Audio ready · tap Play to hear it'); keepAwake(false);
    }
  }
  async function startReading(index = sectionIndex, requestedId = sections[index]?.id) {
    if (!sections.length) return;
    if (prefs.engine === 'elevenlabs' && !requireSession(() => startReading(index, requestedId))) return;
    const intent = ++operation;
    stopDictation(); stopNarration(); discardAudio(); error();
    const run = generation;
    await endTutor();
    if (intent !== operation || run !== generation) return;
    const requestedIndex = sections.findIndex(part => part.id === requestedId);
    if (requestedIndex < 0) return;
    sectionIndex = requestedIndex;
    const part = sections[sectionIndex];
    narrationKind = 'section'; playing = true; highlight(); keepAwake(true);
    status(`Reading · ${part.title}`, true); find('voice-read').textContent = 'Pause';
    const done = () => { if (run === generation) advanceReading(); };
    try {
      if (prefs.engine === 'device') deviceNarration(`${part.title}. ${part.text}`, run, done);
      else {
        status('Preparing ElevenLabs audio…', true);
        const blob = await audioBlob(`${part.title}. ${part.text}`);
        if (run !== generation) return;
        useAudioBlob(blob, part.title, done);
        find('voice-audio-player').hidden = true;
        if (!paused) await playNarrationAudio(run);
      }
    } catch (err) {
      if (run !== generation) return;
      if (err.code === 'provider_quota_exceeded' && window.speechSynthesis && window.SpeechSynthesisUtterance) {
        chooseDeviceVoice(quotaFallbackNotice, 'quota');
        try {
          if (paused) return;
          status(`Device voice · ${part.title}`, true);
          deviceNarration(`${part.title}. ${part.text}`, run, done);
          return;
        } catch (_) {}
      }
      stopNarration(); keepAwake(false); error(err.message); status('Reading unavailable');
      if (err.code?.startsWith('provider_')) find('voice-use-device').hidden = false;
    }
  }
  async function advanceReading() {
    if (sectionIndex + 1 < sections.length) { await startReading(sectionIndex + 1); return; }
    stopNarration(); keepAwake(false); status('Page finished · choose a lesson or ask a question');
    if (prefs.continueLesson && currentRoute.startsWith('lesson/')) {
      const index = DATA.modules.findIndex(m => m.id === currentRoute.slice(7));
      if (DATA.modules[index + 1]) {
        autoContinueRoute = `lesson/${DATA.modules[index + 1].id}`;
        location.hash = autoContinueRoute;
      }
    }
  }
  function toggleReading() {
    if (pendingPlay && currentAudio) {
      paused = false;
      return playNarrationAudio();
    }
    if (!playing) { startReading(); return; }
    paused = !paused;
    if (paused) mediaPlayGeneration++;
    if (prefs.engine === 'device') {
      if (!paused && !utterance) return startReading(sectionIndex);
      paused ? speechSynthesis.pause() : speechSynthesis.resume();
    } else if (currentAudio) {
      if (paused) currentAudio.pause();
      else return playNarrationAudio();
    }
    find('voice-read').textContent = paused ? 'Resume' : 'Pause';
    status(paused ? 'Reading paused' : `Reading · ${sections[sectionIndex]?.title}`, !paused);
    keepAwake(!paused);
  }
  function moveSection(delta) {
    const next = Math.min(sections.length - 1, Math.max(0, sectionIndex + delta));
    if (next === sectionIndex) { status(delta > 0 ? 'You are at the last section' : 'You are at the first section'); return; }
    sectionIndex = next; highlight();
    startReading(next);
  }
  async function preparePageAudio() {
    if (!requireSession(preparePageAudio)) return;
    const passage = sections.map(part => `${part.title}. ${part.text}`).join('\n\n');
    if (speakable(passage).length > 10000) { error('This page is too long for one track. Listen one section at a time.'); return; }
    const intent = operation + 1;
    const run = generation + 1;
    await stopAll('Preparing page audio…');
    if (intent !== operation || run !== generation) return;
    discardAudio(); error();
    find('voice-full-audio').disabled = true;
    try {
      const blob = await audioBlob(passage);
      if (run !== generation) return;
      narrationKind = 'page';
      useAudioBlob(blob, find('voice-place').textContent, () => status('Page audio finished'));
      find('voice-audio-player').hidden = false;
      find('voice-download-audio').hidden = false;
      find('voice-download-audio').onclick = () => {
        const link = document.createElement('a'); link.href = currentAudioUrl;
        link.download = `toolcraft-${currentRoute.replace(/[^a-z0-9-]/gi, '-')}.mp3`; link.click();
      };
      status('Page audio ready · press play');
    } catch (err) { if (run === generation) { error(err.message); status('Could not prepare downloadable audio'); if (err.code?.startsWith('provider_')) find('voice-use-device').hidden = false; } }
    finally { find('voice-full-audio').disabled = false; }
  }

  function appendMessage(role, message, eventId) {
    if (!message?.trim()) return;
    const log = find('voice-transcript');
    let node = eventId ? messageNodes.get(eventId) : null;
    if (!node) {
      node = document.createElement('div'); node.className = `voice-message ${role === 'user' ? 'user' : 'agent'}`;
      const label = document.createElement('strong'); label.textContent = role === 'user' ? 'You' : 'Tutor';
      const body = document.createElement('p'); node.append(label, body); log.appendChild(node);
      if (eventId) messageNodes.set(eventId, node);
      while (log.children.length > 60) log.firstElementChild.remove();
      if (messageNodes.size > 100) messageNodes.delete(messageNodes.keys().next().value);
    }
    node.querySelector('p').textContent = message;
    log.scrollTop = log.scrollHeight;
    if (role === 'agent') { lastAgentMessage = message; find('voice-save-reply').disabled = false; }
  }
  function updateTutorButtons() {
    find('voice-start-tutor').disabled = tutorConnecting;
    find('voice-start-tutor').textContent = tutorConnecting ? 'Connecting…' : conversation && !tutorTextOnly ? 'End conversation' : 'Start conversation';
    find('voice-mute').disabled = !conversation || tutorTextOnly;
    find('voice-mute').textContent = muted ? 'Unmute mic' : 'Mute mic';
    find('voice-text-tutor').disabled = tutorConnecting;
  }
  async function startTutor(textOnly = false) {
    if (!requireSession(() => startTutor(textOnly))) return null;
    const intent = operation + 1;
    const run = tutorGeneration + 1;
    await stopAll();
    if (intent !== operation || run !== tutorGeneration) return null;
    discardAudio(); error(); selectMode('tutor'); setExpanded(true);
    tutorConnecting = true; tutorTextOnly = textOnly; updateTutorButtons();
    status(textOnly ? 'Connecting text tutor…' : 'Connecting · allow microphone when asked', true);
    try {
      const sdk = await loadSDK();
      if (run !== tutorGeneration) return null;
      const auth = await request('session', { textOnly });
      if (run !== tutorGeneration) return null;
      if (textOnly ? !auth.signedUrl : !auth.conversationToken) throw new Error('The voice service returned an invalid conversation credential.');
      const context = JSON.stringify(courseContext()); lastContext = context;
      const options = {
        ...(textOnly ? { signedUrl: auth.signedUrl, connectionType: 'websocket', textOnly: true } : { conversationToken: auth.conversationToken, connectionType: 'webrtc' }),
        dynamicVariables: { current_context: context },
        clientTools: {
          academy_context: () => JSON.stringify(courseContext()),
          academy_action: args => {
            if (run !== tutorGeneration) return JSON.stringify({ ok: false, message: 'Conversation has ended.' });
            try {
              const result = content.performAction(args);
              if (!['navigate', 'next', 'previous'].includes(args.action)) { refreshSections(); sendContext(); }
              return JSON.stringify(result);
            }
            catch (_) { return JSON.stringify({ ok: false, message: 'That action could not be applied. Ask the learner to use the controls.' }); }
          },
        },
        onConnect: () => { if (run === tutorGeneration) status(textOnly ? 'Text tutor connected' : 'Tutor connected · microphone on', true); },
        onMessage: message => {
          if (run !== tutorGeneration) return;
          const role = message.role || (message.source === 'user' ? 'user' : 'agent');
          if (role === 'user' && message.message === pendingTypedMessage) { pendingTypedMessage = ''; return; }
          appendMessage(role, message.message, message.event_id);
        },
        onModeChange: event => {
          if (run !== tutorGeneration) return;
          status(event.mode === 'speaking' ? 'Tutor speaking · you can interrupt' : textOnly ? 'Text tutor ready' : muted ? 'Tutor connected · mic muted' : 'Listening · microphone on', true);
        },
        onError: () => { if (run === tutorGeneration) error('The tutor connection was interrupted. You can reconnect or use text instead.'); },
        onDisconnect: () => {
          if (run !== tutorGeneration) return;
          tutorGeneration++; conversation = null; tutorConnecting = false; muted = false; updateTutorButtons(); keepAwake(false);
          status('Conversation ended · microphone off');
        },
      };
      const started = await sdk.Conversation.startSession(options);
      if (run !== tutorGeneration) { await started.endSession(); return null; }
      conversation = started; tutorConnecting = false; updateTutorButtons(); keepAwake(!textOnly);
      conversation.sendContextualUpdate(`Current course context. Use this for the next reply; do not read the JSON aloud. ${context}`);
      status(textOnly ? 'Text tutor ready' : 'Listening · microphone on', true);
      return conversation;
    } catch (err) {
      if (run === tutorGeneration) {
        tutorConnecting = false; updateTutorButtons(); keepAwake(false); status('Tutor not connected · microphone off');
        const micError = ['NotAllowedError', 'NotFoundError', 'NotReadableError'].includes(err.name);
        error(micError ? 'Microphone access is unavailable. Choose Use text instead, or allow microphone access in your browser.' : err.message || 'Could not connect the tutor.');
      }
      return null;
    }
  }
  async function sendQuestion() {
    if (questionSending) return;
    const snapshot = find('voice-question').value;
    const value = snapshot.trim();
    if (!value) return;
    if (!requireSession(sendQuestion)) return;
    questionSending = true;
    try {
      let live = conversation;
      if (!live) live = await startTutor(true);
      if (!live) return;
      pendingTypedMessage = value;
      live.sendUserMessage(value);
      appendMessage('user', value);
      if (find('voice-question').value === snapshot) find('voice-question').value = '';
    } catch (_) { error('Could not send the question. Please reconnect.'); }
    finally { questionSending = false; }
  }

  function dictationTargets() {
    const targets = DATA.modules.map(m => ({ value: `lesson/${m.id}`, label: `Notes · ${m.title}` }));
    targets.unshift({ value: `page/${currentRoute}`, label: 'Notebook · current page' }, { value: 'question', label: 'Question for tutor' });
    if (currentRoute === 'ai') DATA.briefFields.forEach((field, i) => targets.push({ value: `brief/${i}`, label: `Customer brief · ${field.name}` }));
    return targets;
  }
  function refreshDictationTargets() {
    const select = find('voice-dictation-target');
    const old = select.value;
    const targets = dictationTargets();
    select.replaceChildren(...targets.map(item => { const option = document.createElement('option'); option.value = item.value; option.textContent = item.label; return option; }));
    let desired = old;
    if (!find('voice-draft').value.trim()) {
      if (previousFocusedField?.id === 'voice-question') desired = 'question';
      else if (previousFocusedField?.matches('[data-brief]')) desired = `brief/${previousFocusedField.dataset.brief}`;
      else desired = currentRoute.startsWith('lesson/') ? currentRoute : `page/${currentRoute}`;
    }
    if (!targets.some(item => item.value === desired) && desired.startsWith('page/')) {
      const option = document.createElement('option'); option.value = desired; option.textContent = `Notebook · ${desired.slice(5)}`; select.appendChild(option);
    }
    select.value = desired;
    if (!select.value) select.selectedIndex = 0;
    showSavedWords();
  }
  function showSavedWords() {
    const [kind, ...parts] = find('voice-dictation-target').value.split('/');
    const id = parts.join('/');
    const saved = kind === 'question' ? find('voice-question').value :
      kind === 'brief' ? state.brief[DATA.briefFields[Number(id)]?.name] :
      state.notes[kind === 'lesson' ? id : `voice:${id}`];
    find('voice-saved-words').textContent = saved || 'No saved words here yet.';
  }
  function addDraft(value) {
    const draft = find('voice-draft');
    const addition = text(value).trim();
    if (!addition) return;
    const combined = `${draft.value.trim()}${draft.value.trim() ? ' ' : ''}${addition}`;
    draft.value = combined.slice(0, 8000);
    if (combined.length > 8000) { stopDictation(); error('The draft reached its length limit. Save it before continuing.'); }
  }
  async function startDictation(explicitTarget) {
    const target = typeof explicitTarget === 'string' ? explicitTarget : find('voice-dictation-target').value;
    const engine = find('voice-dictation-engine').value;
    if (engine === 'elevenlabs' && !requireSession(() => startDictation(target))) return;
    const intent = operation + 1;
    const run = dictateGeneration + 1;
    await stopAll();
    if (intent !== operation || run !== dictateGeneration) return;
    discardAudio(); error(); selectMode('dictate');
    if (dictationTargets().some(item => item.value === target)) {
      find('voice-dictation-target').value = target;
      showSavedWords();
    }
    dictating = true; find('voice-dictate').disabled = true; find('voice-finish-dictation').disabled = false;
    find('voice-dictation-target').disabled = true; find('voice-dictation-engine').disabled = true;
    find('voice-interim').textContent = 'Allow microphone access when asked. You can cancel with Stop all.';
    status('Starting dictation…', true);
    if (engine === 'browser') {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) { stopDictation(); error('Browser dictation is unavailable here. Use your keyboard microphone, type a draft, or choose ElevenLabs Scribe.'); status('Dictation unavailable'); return; }
      recognizer = new Recognition(); recognizer.lang = 'en-US'; recognizer.continuous = true; recognizer.interimResults = true;
      const finalIndices = new Set();
      recognizer.onstart = () => { if (run === dictateGeneration) { status('Dictating · microphone on', true); keepAwake(true); } };
      recognizer.onresult = event => {
        if (run !== dictateGeneration) return;
        const partial = [];
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            if (!finalIndices.has(i)) { finalIndices.add(i); addDraft(event.results[i][0].transcript); }
          } else partial.push(event.results[i][0].transcript);
        }
        find('voice-interim').textContent = partial.join(' ');
      };
      recognizer.onerror = event => {
        if (run !== dictateGeneration || event.error === 'aborted') return;
        error(event.error === 'not-allowed' ? 'Microphone permission was denied. You can type or use your phone keyboard microphone.' : 'Dictation was interrupted. Your committed draft is still here; you can retry.');
      };
      recognizer.onend = () => {
        if (run !== dictateGeneration) return;
        recognizer = null; stopDictation(false); keepAwake(false); status('Dictation ended · review your words'); find('voice-interim').textContent = '';
      };
      try { recognizer.start(); } catch (_) { stopDictation(); error('Could not start browser dictation. Try your keyboard microphone.'); status('Microphone off'); }
      return;
    }
    try {
      const sdk = await loadSDK();
      if (run !== dictateGeneration) return;
      const auth = await request('dictation-token');
      if (run !== dictateGeneration) return;
      if (!sdk.Scribe || !sdk.RealtimeEvents || !auth.token) throw new Error('The dictation connection is unavailable.');
      const connection = sdk.Scribe.connect({ token: auth.token, modelId: config.scribeModel || 'scribe_v2_realtime',
        commitStrategy: 'vad', microphone: { echoCancellation: true, noiseSuppression: true } });
      scribe = connection;
      const event = sdk.RealtimeEvents;
      connection.on(event.PARTIAL_TRANSCRIPT, data => {
        if (run !== dictateGeneration) return;
        scribePartial = data.text || ''; find('voice-interim').textContent = scribePartial;
      });
      connection.on(event.COMMITTED_TRANSCRIPT, data => {
        if (run !== dictateGeneration) return;
        scribePartial = ''; addDraft(data.text); find('voice-interim').textContent = '';
        if (finishingDictation) { stopDictation(); keepAwake(false); status('Dictation finished · review your words'); }
      });
      connection.on(event.AUDIO_STARTED || event.SESSION_STARTED, () => { if (run === dictateGeneration) { status('Dictating with Scribe · microphone on', true); keepAwake(true); } });
      connection.on(event.ERROR, () => { if (run === dictateGeneration) { stopDictation(); keepAwake(false); error('Scribe dictation was interrupted. Your committed words are preserved.'); status('Dictation stopped'); } });
      if (event.CLOSE) connection.on(event.CLOSE, () => { if (run === dictateGeneration) { scribe = null; stopDictation(); keepAwake(false); status('Dictation ended · review your words'); } });
    } catch (err) { if (run === dictateGeneration) { stopDictation(); error(err.message); status('Dictation not connected'); } }
  }
  function finishScribe() {
    if (!scribe) { stopDictation(); status('Dictation stopped · review your words'); return; }
    const run = dictateGeneration;
    const finishUnconfirmed = () => {
      if (run !== dictateGeneration) return;
      const partial = scribePartial.trim();
      if (partial) addDraft(partial);
      stopDictation(); keepAwake(false);
      status('Dictation finished · review your words');
      if (partial) error('The final phrase was not confirmed by the speech service. It is in your editable draft; check it before adding.');
    };
    if (typeof scribe.mute !== 'function') { finishUnconfirmed(); return; }
    finishingDictation = true;
    find('voice-finish-dictation').disabled = true;
    try { scribe.mute(); } catch (_) { finishUnconfirmed(); return; }
    status('Microphone muted · finishing your last phrase');
    dictationFinishTimer = setTimeout(finishUnconfirmed, 4500);
  }
  function saveDraft() {
    if (dictating) { error('Finish dictation first, then review and add your words.'); return; }
    const draft = find('voice-draft').value.trim();
    if (!draft) { error('Dictate or type something before adding it.'); return; }
    stopDictation(); keepAwake(false);
    const target = find('voice-dictation-target').value;
    const [kind, ...parts] = target.split('/'); const id = parts.join('/');
    let before = '', after = '', write;
    if (kind === 'question') {
      before = find('voice-question').value;
      write = value => { find('voice-question').value = value; };
    } else if (kind === 'lesson' || kind === 'page') {
      const key = kind === 'lesson' ? id : `voice:${id}`;
      if (kind === 'lesson' && !DATA.modules.some(m => m.id === id)) { error('That lesson no longer exists. Choose another destination.'); return; }
      before = state.notes[key] || '';
      write = value => { state.notes[key] = value; if (location.hash.slice(1) === `lesson/${id}` && find('lesson-notes')) find('lesson-notes').value = value; save(); };
    } else if (kind === 'brief' && /^\d+$/.test(id) && DATA.briefFields[Number(id)]) {
      const field = DATA.briefFields[Number(id)].name;
      before = state.brief[field] || '';
      write = value => { state.brief[field] = value; const input = find(`brief-${id}`); if (input) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); } else save(); };
    } else { error('Choose a destination for your words.'); return; }
    after = before + (before.trim() ? '\n' : '') + draft;
    if (kind === 'question' && after.length > 2000) { error('The question is too long. Keep it below 2,000 characters.'); return; }
    write(after); showSavedWords();
    lastAppend = { target, before, after, write };
    find('voice-undo-dictation').disabled = false;
    find('voice-draft').value = '';
    error(); status(kind === 'question' ? 'Question prepared · choose Send when ready' : 'Words added to your local notes');
    if (kind === 'question') selectMode('tutor');
  }
  function undoDraft() {
    if (!lastAppend) return;
    const { target, before, after, write } = lastAppend;
    const [kind, ...parts] = target.split('/'); const id = parts.join('/');
    const current = kind === 'question' ? find('voice-question').value : kind === 'brief' ? state.brief[DATA.briefFields[Number(id)].name] : state.notes[kind === 'lesson' ? id : `voice:${id}`];
    if (current !== after) { error('Those notes were edited after dictation. Undo would overwrite the edits, so it was not applied.'); return; }
    write(before); showSavedWords(); lastAppend = null; find('voice-undo-dictation').disabled = true; status('Last addition removed');
  }

  function refreshSections(routeChanged = false) {
    if (!content) return;
    const oldId = sections[sectionIndex]?.id;
    let closedSelectedDetail = false;
    sections = content.getSections();
    const heading = document.querySelector('#main h1');
    const title = (heading?.innerText || heading?.textContent || nav.find(n => n[0] === currentRoute)?.[1] || 'Academy').replace(/\s+/g, ' ').trim();
    find('voice-place').textContent = title;
    if (routeChanged) {
      const savedId = prefs.bookmarkIds[currentRoute];
      let savedIndex = sections.findIndex(part => part.id === savedId);
      if (savedIndex < 0 && typeof savedId === 'string') savedIndex = sections.findIndex(part => part.id === savedId.replace(/:technical:(\d+)$/, ':section:$1'));
      sectionIndex = savedIndex >= 0 ? savedIndex : Number(prefs.bookmarks[currentRoute] || 0);
    } else {
      const i = sections.findIndex(part => part.id === oldId);
      if (i >= 0) sectionIndex = i;
      else if (oldId?.match(/:technical:\d+$/)) {
        // Closing an optional passage cancels its audio before the list changes place.
        stopNarration(); discardAudio();
        sectionIndex = sections.findIndex(part => part.id === oldId.replace(/:technical:(\d+)$/, ':section:$1'));
        closedSelectedDetail = true;
      }
    }
    sectionIndex = Math.max(0, Math.min(sectionIndex, sections.length - 1));
    const select = find('voice-section-select');
    select.replaceChildren(...sections.map((part, i) => { const option = document.createElement('option'); option.value = String(i); option.textContent = `${i + 1}. ${part.title}`; return option; }));
    select.value = String(sectionIndex);
    find('voice-read').disabled = !sections.length;
    document.querySelectorAll('.voice-section-actions').forEach(el => el.remove());
    sections.forEach((part, i) => {
      if (currentRoute === 'learn' || !part.element || !part.element.matches('section, .learning-objectives')) return;
      const actions = document.createElement('div'); actions.className = 'voice-section-actions';
      for (const [mode, label] of [['listen', 'Listen'], ['tutor', 'Ask about this']]) {
        const trigger = document.createElement('button'); trigger.className = 'voice-section-trigger'; trigger.type = 'button';
        trigger.textContent = `${mode === 'listen' ? '▷' : '✦'} ${label}`;
        trigger.setAttribute('aria-label', `${label}: ${part.title}`);
        trigger.setAttribute('data-voice-action', mode); trigger.setAttribute('data-voice-section', String(i));
        actions.appendChild(trigger);
      }
      part.element.appendChild(actions);
    });
    mountInline(); updateSurface();
    refreshDictationTargets();
    if (closedSelectedDetail) {
      highlight();
      if (!conversation && !dictating) status('Extra detail closed · main lesson selected');
    }
  }
  function sendContext() {
    if (!conversation) return;
    const next = JSON.stringify(courseContext());
    if (next === lastContext) return;
    lastContext = next;
    try { conversation.sendContextualUpdate(`Course state changed. Use the current section and values for the next answer; do not speak just because of this update. ${next}`); } catch (_) {}
  }
  function onRoute() {
    const nextRoute = location.hash.slice(1) || 'learn';
    const changed = nextRoute !== currentRoute;
    const continueHere = autoContinueRoute === nextRoute;
    currentRoute = nextRoute;
    if (changed) {
      operation++; stopNarration(); stopDictation(); discardAudio();
      if (tutorConnecting) endTutor();
      fetchControllers.forEach(controller => controller.abort());
      if (!conversation && !tutorConnecting) { keepAwake(false); status('Ready · your place is updated'); setExpanded(false); }
      pendingAfterLogin = null; find('voice-auth').hidden = true;
    }
    refreshSections(changed); sendContext();
    if (conversation && !tutorTextOnly) keepAwake(true);
    if (continueHere) {
      const intent = operation;
      continuationTimer = setTimeout(() => { if (intent === operation && currentRoute === nextRoute) startReading(0); }, 160);
    }
  }
  window.addEventListener('academy:route', onRoute);
  window.addEventListener('academy:lesson-detail', () => { refreshSections(); sendContext(); });
  function visualSectionId(detail) {
    if (!detail || currentRoute !== `lesson/${detail.lessonId}` || !Number.isInteger(detail.sectionIndex)) return null;
    const lesson = DATA.modules.find(item => item.id === detail.lessonId);
    if (!lesson || detail.sectionIndex < 0 || detail.sectionIndex >= lesson.sections.length) return null;
    return `${detail.lessonId}:section:${detail.sectionIndex}`;
  }
  window.addEventListener('academy:visual-listen', event => {
    const sectionId = visualSectionId(event.detail);
    if (sectionId) startMode('listen', { sectionId });
  });
  window.addEventListener('academy:visual-step', event => {
    const sectionId = visualSectionId(event.detail);
    if (!sectionId) return;
    refreshSections();
    const index = sections.findIndex(part => part.id === sectionId);
    if (index < 0) return;
    const continueReading = playing && !paused;
    if (playing) stopNarration();
    sectionIndex = index; highlight(); sendContext();
    if (continueReading) startReading(index);
    else if (!conversation && !dictating) status('3D step selected · choose Listen & watch to hear it');
  });
  window.addEventListener('academy:voice-command', event => {
    const { action, target, sectionId } = event.detail || {};
    if (action === 'repeat') {
      if (sectionId) {
        const i = sections.findIndex(part => part.id === sectionId);
        if (i >= 0) { sectionIndex = i; highlight(); sendContext(); }
      }
      // Let the live tutor repeat itself; never start two audio outputs together.
      if (!conversation) startReading(sectionIndex);
      return;
    }
    if (target === 'section') {
      const i = Math.max(0, Math.min(sections.length - 1, sectionIndex + (action === 'previous' ? -1 : 1)));
      sectionIndex = i; highlight(); sendContext();
      if (!conversation) startReading(i);
    }
  });
  document.addEventListener('focusin', event => {
    if (event.target.matches('#lesson-notes, [data-brief], #voice-question')) previousFocusedField = event.target;
  });
  for (const name of ['click', 'input', 'change']) document.getElementById('main').addEventListener(name, event => {
    if (event.target.closest('#lesson-visual, [data-voice-action], [data-voice-engine-choice], [data-voice-panel], [data-voice-next], .voice-section-trigger') || event.target.matches('textarea')) return;
    clearTimeout(contextTimer); contextTimer = setTimeout(() => { refreshSections(); sendContext(); }, 200);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wakeRequested) keepAwake(true);
    if (document.visibilityState !== 'visible' && (dictating || conversation || (playing && prefs.engine === 'device'))) {
      // Do not promise lock-screen capture; leave the platform in control and surface status on return.
      find('voice-connection-status').textContent = 'This phone may suspend voice in the background. Check the connection when you return.';
    }
  });
  window.addEventListener('pagehide', () => { stopAll(); audioCache.clear(); if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && expanded) setExpanded(false); });

  document.addEventListener('click', event => {
    const action = event.target.closest?.('[data-voice-action]');
    const panel = event.target.closest?.('[data-voice-panel]');
    const engineChoice = event.target.closest?.('[data-voice-engine-choice]');
    if (action) {
      launchElement = action;
      const sectionId = action.getAttribute('data-voice-section-id');
      const value = action.getAttribute('data-voice-section');
      const options = sectionId !== null ? { sectionId } : value === null ? {} : { sectionIndex: Number(value) };
      if (action.dataset.voiceTarget) options.target = action.dataset.voiceTarget;
      startMode(action.dataset.voiceAction, options);
    } else if (engineChoice?.dataset.voiceEngineChoice === 'elevenlabs') {
      launchElement = find('voice-inline-listen') || engineChoice;
      launchElement.focus(); changeListeningEngine('elevenlabs'); selectMode('listen'); startReading(sectionIndex);
    } else if (panel) {
      launchElement = panel; selectMode(panel.dataset.voicePanel); setExpanded(true);
    } else if (event.target.closest?.('[data-voice-next]')) moveSection(1);
  });
  find('voice-toggle').onclick = () => setExpanded(!expanded);
  find('voice-close').onclick = () => setExpanded(false);
  find('voice-quick-pause').onclick = toggleReading;
  document.querySelectorAll('[data-voice-prompt]').forEach(button => {
    button.onclick = () => { find('voice-question').value = button.dataset.voicePrompt; sendQuestion(); };
  });
  find('voice-stop').onclick = () => stopAll();
  document.querySelectorAll('[data-voice-mode]').forEach(button => {
    button.onclick = () => selectMode(button.dataset.voiceMode);
    button.onkeydown = event => {
      const modes = ['listen', 'tutor', 'dictate'];
      let i = modes.indexOf(button.dataset.voiceMode);
      if (event.key === 'ArrowRight') i = (i + 1) % modes.length;
      else if (event.key === 'ArrowLeft') i = (i + modes.length - 1) % modes.length;
      else if (event.key === 'Home') i = 0;
      else if (event.key === 'End') i = modes.length - 1;
      else return;
      event.preventDefault(); selectMode(modes[i]); find(`voice-${modes[i]}-tab`).focus();
    };
  });
  find('voice-use-device').onclick = () => { chooseDeviceVoice('Listening uses your device voice; no ElevenLabs credits are needed.'); error(); selectMode('listen'); startReading(sectionIndex); };
  find('voice-read').onclick = toggleReading;
  find('voice-previous').onclick = () => moveSection(-1);
  find('voice-next').onclick = () => moveSection(1);
  find('voice-section-select').onchange = event => { stopNarration(); sectionIndex = Number(event.target.value); highlight(); sendContext(); status('Section selected · press Play'); };
  find('voice-speed').value = String(prefs.rate);
  find('voice-speed').onchange = event => {
    prefs.rate = Number(event.target.value); storePreferences();
    if (currentAudio) currentAudio.playbackRate = prefs.rate;
    if (playing && prefs.engine === 'device') startReading(sectionIndex);
  };
  find('voice-engine').value = prefs.engine;
  find('voice-engine').onchange = event => changeListeningEngine(event.target.value);
  find('voice-continue').checked = Boolean(prefs.continueLesson);
  find('voice-continue').onchange = event => { prefs.continueLesson = event.target.checked; storePreferences(); };
  find('voice-full-audio').onclick = preparePageAudio;
  find('voice-start-tutor').onclick = () => conversation && !tutorTextOnly ? stopAll() : startTutor(false);
  find('voice-text-tutor').onclick = () => startTutor(true);
  find('voice-mute').onclick = () => { if (!conversation) return; muted = !muted; conversation.setMicMuted(muted); updateTutorButtons(); status(muted ? 'Tutor connected · mic muted' : 'Listening · microphone on', true); };
  find('voice-question-form').onsubmit = event => { event.preventDefault(); sendQuestion(); };
  find('voice-question').oninput = () => { try { conversation?.sendUserActivity(); } catch (_) {} };
  find('voice-save-reply').onclick = () => {
    const result = content.performAction({ action: 'note', text: lastAgentMessage.slice(0, 2000) });
    status(result.message || 'Tutor reply saved as a local note');
  };
  find('voice-clear-transcript').onclick = () => { find('voice-transcript').replaceChildren(); messageNodes.clear(); lastAgentMessage = ''; find('voice-save-reply').disabled = true; };
  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) find('voice-dictation-engine').value = 'elevenlabs';
  find('voice-dictate').onclick = startDictation;
  find('voice-finish-dictation').onclick = () => {
    if (recognizer) { try { recognizer.stop(); } catch (_) { stopDictation(); } }
    else finishScribe();
    keepAwake(false);
  };
  find('voice-dictation-target').onchange = showSavedWords;
  window.addEventListener('academy:note-saved', showSavedWords);
  find('voice-save-dictation').onclick = saveDraft;
  find('voice-undo-dictation').onclick = undoDraft;
  find('voice-login').onclick = login;
  find('voice-access-code').onkeydown = event => { if (event.key === 'Enter') login(); };
  find('voice-auth-cancel').onclick = () => { pendingAfterLogin = null; find('voice-auth').hidden = true; find('voice-access-code').value = ''; updateSurface(); };
  find('voice-endpoint').value = endpoint;
  find('voice-save-endpoint').onclick = async () => {
    const raw = find('voice-endpoint').value.trim(); const valid = normalizeEndpoint(raw);
    if (raw && !valid) { error('Use an HTTPS service address ending in /api/voice, without a key, query string or password.'); return; }
    await stopAll(); sessionToken = ''; sessionExpiresAt = 0; endpoint = valid; storePreferences(); error();
    find('voice-connection-status').textContent = endpoint ? 'Connection saved. Private voice requires your access code.' : 'No voice service connected. Device narration is available.';
  };
  find('voice-signout').onclick = async () => { await stopAll(); sessionToken = ''; sessionExpiresAt = 0; audioCache.clear(); find('voice-connection-status').textContent = 'Private voice locked.'; };
  find('voice-connection-status').textContent = endpoint ? 'Private voice service configured; enter your access code when connecting.' : 'ElevenLabs is not connected yet. Device narration is available.';
  notice(voiceNotice); onRoute();
  window.AcademyVoice = { start: startMode, stop: stopAll, open: mode => { setExpanded(true); if (mode) selectMode(mode); }, getStatus: () => ({ mode: selectedMode, playing, paused, dictating, connected: !!conversation, connecting: tutorConnecting, sectionIndex, sectionTitle: sections[sectionIndex]?.title, privateVoiceConfigured: !!endpoint }) };
})();
