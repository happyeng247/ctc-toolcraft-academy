'use strict';

// Run with: node --test tests/voice-ui.test.cjs
// These tests execute the unmodified controller and content bridge. The small
// DOM/media doubles model only APIs they use; no browser, package or network is needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const CONTROLLER = fs.readFileSync(path.join(ROOT, 'src/voice.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'src/voice-content.js'), 'utf8');

class MockEvent {
  constructor(type, values = {}) { this.type = type; Object.assign(this, values); }
  preventDefault() { this.defaultPrevented = true; }
}
class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    for (const callback of this.listeners.get(event.type) || []) callback(event);
    this[`on${event.type}`]?.(event);
    if (event.bubbles) this.parentNode?.dispatchEvent(event);
    return !event.defaultPrevented;
  }
}
function simpleMatch(element, selector) {
  if (element.tagName === '#TEXT') return false;
  const tag = selector.match(/^[a-z][a-z0-9-]*/i)?.[0];
  if (tag && element.tagName !== tag.toUpperCase()) return false;
  for (const [, id] of selector.matchAll(/#([\w-]+)/g)) if (element.id !== id) return false;
  for (const [, name] of selector.matchAll(/\.([\w-]+)/g)) if (!element.classList.contains(name)) return false;
  for (const [, name, , value] of selector.matchAll(/\[([\w-]+)(?:=(["']?)([^"'\]]+)\2)?\]/g)) {
    if (!element.hasAttribute(name)) return false;
    if (value !== undefined && element.getAttribute(name) !== value) return false;
  }
  return true;
}
function matches(element, selector) {
  return selector.split(',').some(branch => {
    const tokens = branch.trim().replace(/>/g, ' > ').split(/\s+/);
    function at(node, index) {
      if (!node || !simpleMatch(node, tokens[index])) return false;
      if (index === 0) return true;
      if (tokens[index - 1] === '>') return at(node.parentNode, index - 2);
      for (let parent = node.parentNode; parent; parent = parent.parentNode) if (at(parent, index - 1)) return true;
      return false;
    }
    return at(element, tokens.length - 1);
  });
}
function descendants(node) { return node.children.flatMap(child => [child, ...descendants(child)]); }
class Element extends Events {
  constructor(tagName, document) {
    super(); this.tagName = tagName.toUpperCase(); this.ownerDocument = document;
    this.children = []; this.parentNode = null; this.attributes = {}; this.dataset = {};
    this.id = ''; this.className = ''; this._text = ''; this._value = null;
    this.hidden = false; this.disabled = false; this.checked = false; this.open = false;
    this.style = {}; this.scrollTop = 0; this.scrollHeight = 0;
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
      toggle: (name, force) => { const on = force ?? !this.classList.contains(name); this.classList[on ? 'add' : 'remove'](name); return on; },
    };
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get value() {
    if (this._value !== null) return this._value;
    return this.tagName === 'SELECT' ? this.children.find(child => child.tagName === 'OPTION')?.value || '' : '';
  }
  set value(value) { this._value = String(value); }
  set selectedIndex(index) { this.value = this.children[index]?.value || ''; }
  get firstElementChild() { return this.children[0] || null; }
  set innerHTML(value) {
    this.replaceChildren();
    const stack = [this], voidTags = new Set(['INPUT', 'BR', 'HR', 'IMG', 'META', 'LINK']);
    for (const token of String(value).match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || []) {
      if (token.startsWith('<!--')) continue;
      if (token.startsWith('</')) { stack.pop(); continue; }
      if (token.startsWith('<')) {
        const tag = token.match(/^<([\w-]+)/)?.[1];
        if (!tag) continue;
        const child = this.ownerDocument.createElement(tag);
        const attributes = token.slice(tag.length + 1).replace(/\/?\s*>$/, '');
        for (const [, name, , quoted, plain] of attributes.matchAll(/([\w-]+)(?:=(?:(["'])(.*?)\2|([^\s>]+)))?/g)) child.setAttribute(name, quoted ?? plain ?? '');
        stack.at(-1).appendChild(child);
        if (!voidTags.has(child.tagName) && !token.endsWith('/>')) stack.push(child);
      } else {
        const child = this.ownerDocument.createElement('#text'); child._text = token;
        stack.at(-1).appendChild(child);
      }
    }
  }
  setAttribute(name, value) {
    value = String(value); this.attributes[name] = value;
    if (name === 'id') this.id = value;
    else if (name === 'class') this.className = value;
    else if (name === 'value') this.value = value;
    else if (['hidden', 'disabled', 'checked', 'open'].includes(name)) this[name] = true;
    else if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    if (name.startsWith('data-')) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] ?? null;
    return this.attributes[name] ?? null;
  }
  hasAttribute(name) { return this.getAttribute(name) !== null; }
  removeAttribute(name) { delete this.attributes[name]; if (name === 'src') this.src = ''; }
  appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  replaceChildren(...children) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this._text = ''; this._value = this.tagName === 'SELECT' ? null : this._value; this.append(...children); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  matches(selector) { return matches(this, selector); }
  closest(selector) { for (let element = this; element; element = element.parentNode) if (element.matches(selector)) return element; return null; }
  querySelectorAll(selector) { return descendants(this).filter(element => element.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() { this.ownerDocument.activeElement = this; this.dispatchEvent(new MockEvent('focusin', { bubbles: true })); }
  scrollIntoView() { this.scrolled = true; }
  click() { if (!this.disabled) return this.onclick?.(new MockEvent('click', { target: this })); }
  pause() { this.pauses = (this.pauses || 0) + 1; this.onpause?.(); }
  play() { this.plays = (this.plays || 0) + 1; this.onplay?.(); return Promise.resolve(); }
  load() {}
}
class Document extends Events {
  constructor() {
    super(); this.visibilityState = 'visible'; this.documentElement = new Element('html', this);
    this.head = new Element('head', this); this.body = new Element('body', this);
    this.documentElement.append(this.head, this.body);
  }
  createElement(tag) { return new Element(tag, this); }
  getElementById(id) { return descendants(this.documentElement).find(element => element.id === id) || null; }
  querySelectorAll(selector) { return this.documentElement.querySelectorAll(selector); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 24; i++) await Promise.resolve(); }

function fixture({ lessonText = 'Understand the cutting edge.', realContent = false, delaySessionStart = false, initialPreferences } = {}) {
  const document = new Document(), window = new Events();
  const main = document.createElement('main'); main.id = 'main'; document.body.appendChild(main);
  const lesson = {
    id: 'first', title: 'First lesson', subtitle: 'A fixture lesson', group: 'Fundamentals',
    objectives: ['Explain an edge.'], sections: [{ heading: 'Dimensions', body: lessonText }],
    exercise: { prompt: 'Observe one edge.', answer: 'HIDDEN_EXERCISE_ANSWER' },
    quiz: { question: 'Which part cuts?', options: ['The edge', 'The label'], correct: 0, explanation: 'HIDDEN_QUIZ_EXPLANATION' }, sources: [],
  };
  main.innerHTML = '<div class="page-heading"><h1>First lesson</h1></div><div id="voice-learning-slot"></div><article class="lesson-body"><div class="learning-objectives">Objectives</div><section class="lesson-section"><h3>Dimensions</h3></section><section class="lesson-section"><details><summary>Reveal</summary></details></section><section class="lesson-section"><div class="quiz-options"><button data-answer="0">The edge</button><button data-answer="1">The label</button></div><div id="quiz-feedback"></div></section></article><textarea id="lesson-notes"></textarea>';
  const records = { spoken: [], cancellations: 0, fetches: [], sessions: [], recognizers: [], scribes: [], saves: 0 };
  const sessionStartGate = delaySessionStart ? deferred() : null;
  const timers = new Map(); let timerId = 0;
  const speechSynthesis = {
    getVoices: () => [{ lang: 'en-US', localService: true }],
    speak: utterance => records.spoken.push(utterance),
    cancel: () => { records.cancellations++; }, pause() {}, resume() {},
  };
  class Utterance { constructor(value) { this.text = value; } }
  class Recognition {
    constructor() { records.recognizers.push(this); this.starts = 0; this.aborts = 0; this.stops = 0; }
    start() { this.starts++; this.onstart?.(); }
    stop() { this.stops++; this.onend?.(); }
    abort() { this.aborts++; this.onend?.(); }
  }
  const sdk = {
    Conversation: { startSession: async options => {
      const session = { options, updates: [], messages: [], ends: 0,
        endSession() { this.ends++; return this.endGate?.promise || Promise.resolve(); },
        sendContextualUpdate(value) { this.updates.push(value); },
        sendUserMessage(value) { this.messages.push(value); }, sendUserActivity() {}, setMicMuted() {},
      };
      records.sessions.push(session);
      if (sessionStartGate) await sessionStartGate.promise;
      options.onConnect?.(); return session;
    } },
    RealtimeEvents: { PARTIAL_TRANSCRIPT: 'partial', COMMITTED_TRANSCRIPT: 'committed', AUDIO_STARTED: 'audio', ERROR: 'error', CLOSE: 'close' },
    Scribe: { connect: options => {
      const scribe = { options, handlers: new Map(), closes: 0, mutes: 0,
        on(name, callback) { this.handlers.set(name, callback); },
        emit(name, data) { this.handlers.get(name)?.(data); },
        mute() { this.mutes++; }, close() { this.closes++; },
      }; records.scribes.push(scribe); return scribe;
    } },
  };
  const state = { completed: [], passed: [], notes: {}, brief: {} };
  const DATA = { modules: [lesson], briefFields: [{ name: 'Material', why: 'Identify material', example: 'Example material' }], sources: [], glossary: [], processSteps: [], diagnostics: [], roadmap: [], fieldwork: [] };
  const location = { hash: '#lesson/first', href: 'https://academy.example/#lesson/first', hostname: 'academy.example', origin: 'https://academy.example' };
  const sectionElement = main.querySelector('.lesson-body section.lesson-section');
  const content = {
    getSections: () => [{ id: 'first:section:0', title: 'Dimensions', text: lessonText, element: sectionElement }],
    getContext: () => ({ route: location.hash.slice(1), currentSections: [{ title: 'Dimensions', text: lessonText }] }),
    performAction: () => ({ ok: true, message: 'Action recorded' }),
  };
  const store = new Map();
  if (initialPreferences) store.set('ctc-voice-preferences-v1', JSON.stringify(initialPreferences));
  class LocalURL extends URL {}
  LocalURL.createObjectURL = () => 'blob:offline-fixture'; LocalURL.revokeObjectURL = () => {};
  const context = {
    window, document, location, DATA, state, nav: [['lab', 'Geometry lab'], ['learn', 'Learning path']],
    lab: { kind: 'endmill', view: '3d', flutes: 3, helix: 30, core: 52, rake: 12, relief: 8, feature: 'edges', spin: false, exploded: false },
    cut: { d: 6, n: 12000, z: 3, fz: .025, ae: 25, ap: 3, length: 3 },
    activeStep: 0, activeCase: 0, renderLab() {}, renderCutting() {},
    save: () => { records.saves++; }, console, URL: LocalURL, Blob, AbortController,
    Event: MockEvent, CustomEvent: MockEvent, SpeechSynthesisUtterance: Utterance, speechSynthesis,
    navigator: {}, localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value) },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body); records.fetches.push(body);
      const response = body.action === 'login' ? { sessionToken: 'offline-session', expiresAt: new Date(Date.now() + 3600000).toISOString() }
        : body.action === 'session' ? { conversationToken: 'offline-rtc', signedUrl: 'wss://example.invalid/offline' }
          : body.action === 'dictation-token' ? { token: 'offline-scribe' } : {};
      return { ok: true, headers: { get: () => body.action === 'tts' ? 'audio/mpeg' : 'application/json' }, json: async () => response, blob: async () => new Blob(['offline-audio'], { type: 'audio/mpeg' }) };
    },
  };
  Object.assign(window, { AcademyVoiceContent: content, ACADEMY_VOICE_CONFIG: { endpoint: 'https://voice.example/api/voice' }, ElevenLabsClient: sdk, speechSynthesis, SpeechSynthesisUtterance: Utterance, SpeechRecognition: Recognition });
  vm.createContext(context);
  if (realContent) vm.runInContext(BRIDGE, context, { filename: 'voice-content.js' });
  vm.runInContext(CONTROLLER, context, { filename: 'voice.js' });
  const get = id => { const element = document.getElementById(id); assert.ok(element, `Fixture element ${id}`); return element; };
  return {
    context, window, document, DATA, state, location, records, get, voice: window.AcademyVoice,
    click: id => get(id).click(),
    async unlock() { get('voice-access-code').value = 'offline-test-access'; await get('voice-login').click(); },
    releaseSessionStart: () => sessionStartGate.resolve(),
    runTimer(delay) {
      const found = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(found, `Expected a pending ${delay} ms timer`);
      timers.delete(found[0]); found[1].callback();
    },
    change(id, value) { const element = get(id); element.value = value; element.onchange?.(new MockEvent('change', { target: element })); },
    route(hash) { location.hash = '#' + hash; window.dispatchEvent(new MockEvent('academy:route')); },
    async drainSpeech() {
      for (let index = 0; index < records.spoken.length; index++) {
        assert.ok(index < 100, 'Speech must finish without an infinite continuation');
        records.spoken[index].onend?.(); await flush();
      }
    },
  };
}

test('device narration preserves decimal values, negatives and punctuation across chunks', async () => {
  const passage = 'Use 0.025 mm per tooth and a 1.5 mm diameter. Compare -0.5 and 12.75. ' +
    'The numbers describe this illustrative lesson, and do not qualify a machine setting. '.repeat(7) +
    'Finish with 0.005 and 100.25.';
  const h = fixture({ lessonText: passage });
  h.click('voice-read'); await flush(); await h.drainSpeech();
  assert.ok(h.records.spoken.length > 1, 'The passage must exercise chunk boundaries');
  assert.equal(h.records.spoken.map(item => item.text).join(' '), `Dimensions. ${passage}`.replace(/\s+/g, ' ').trim());
  assert.equal(h.voice.getStatus().playing, false);
});

for (const mode of ['device reading', 'ElevenLabs reading', 'page audio', 'browser dictation', 'Scribe dictation', 'tutor restart']) {
  test(`Stop all cancels ${mode} waiting for an earlier tutor to end`, async () => {
    const h = fixture(); await h.unlock(); await h.click('voice-start-tutor');
    assert.equal(h.records.sessions.length, 1);
    const previous = h.records.sessions[0]; previous.endGate = deferred();
    if (mode === 'ElevenLabs reading') h.change('voice-engine', 'elevenlabs');
    if (mode === 'Scribe dictation') h.get('voice-dictation-engine').value = 'elevenlabs';
    if (mode === 'browser dictation') h.get('voice-dictation-engine').value = 'browser';
    const control = mode.includes('reading') ? 'voice-read' : mode === 'page audio' ? 'voice-full-audio'
      : mode.includes('dictation') ? 'voice-dictate' : 'voice-text-tutor';
    const pending = h.click(control); await flush();
    assert.equal(previous.ends, 1, 'New activity must first wait for the old session');
    await h.voice.stop();
    previous.endGate.resolve(); await pending; await flush();
    assert.equal(h.records.sessions.length, 1, 'No replacement tutor may start');
    assert.equal(h.records.recognizers.length, 0, 'No browser microphone may start');
    assert.equal(h.records.scribes.length, 0, 'No Scribe microphone may start');
    assert.equal(h.records.spoken.length, 0, 'No device narration may start');
    assert.equal(h.records.fetches.filter(call => call.action === 'tts').length, 0, 'No TTS request may start');
    assert.equal(h.records.fetches.filter(call => call.action === 'dictation-token').length, 0);
    assert.equal(h.records.fetches.filter(call => call.action === 'session').length, 1);
    const status = h.voice.getStatus();
    assert.equal(status.playing || status.dictating || status.connected || status.connecting, false);
  });
}

test('route changes cancel narration and make an already queued speech completion harmless', async () => {
  const h = fixture({ lessonText: 'A long paragraph to read. '.repeat(30) });
  h.click('voice-read'); await flush();
  assert.equal(h.records.spoken.length, 1);
  const lateCompletion = h.records.spoken[0].onend;
  const cancellations = h.records.cancellations;
  h.route('learn'); lateCompletion(); await flush();
  assert.ok(h.records.cancellations > cancellations);
  assert.equal(h.records.spoken.length, 1, 'A stale callback cannot continue the old passage');
  assert.equal(h.voice.getStatus().playing, false);
  assert.equal(h.get('voice-read').textContent, 'Play from here');
});

test('browser dictation deduplicates final result indices and saves only on Add text', async () => {
  const h = fixture(); h.state.notes.first = 'Existing note';
  h.get('voice-dictation-engine').value = 'browser';
  await h.click('voice-dictate');
  const recognition = h.records.recognizers[0]; assert.equal(recognition.starts, 1);
  const result = (transcript, isFinal) => Object.assign([{ transcript }], { isFinal });
  recognition.onresult({ resultIndex: 0, results: [result('Partial thought', false)] });
  assert.equal(h.get('voice-draft').value, '');
  assert.equal(h.get('voice-interim').textContent, 'Partial thought');
  const first = result('Measure runout.', true);
  recognition.onresult({ resultIndex: 0, results: [first] });
  recognition.onresult({ resultIndex: 0, results: [first] });
  assert.equal(h.get('voice-draft').value, 'Measure runout.');
  recognition.onresult({ resultIndex: 1, results: [first, result('Measure runout.', true)] });
  assert.equal(h.get('voice-draft').value, 'Measure runout. Measure runout.', 'A new utterance can intentionally repeat the same words');
  assert.equal(h.state.notes.first, 'Existing note');
  assert.equal(h.records.saves, 0, 'Microphone results do not save notes');
  h.click('voice-save-dictation');
  assert.equal(h.state.notes.first, 'Existing note', 'Add text cannot commit an unfinished microphone draft');
  assert.equal(h.records.saves, 0);
  h.click('voice-finish-dictation');
  assert.equal(h.voice.getStatus().dictating, false);
  h.click('voice-save-dictation');
  assert.equal(h.state.notes.first, 'Existing note\nMeasure runout. Measure runout.');
  assert.equal(h.records.saves, 1);
  assert.equal(h.get('voice-draft').value, '');
  h.state.notes.first += '\nA later manual edit';
  h.click('voice-undo-dictation');
  assert.equal(h.state.notes.first, 'Existing note\nMeasure runout. Measure runout.\nA later manual edit');
  assert.match(h.get('voice-error').textContent, /edited after dictation/);
});

test('lesson note dictation keeps its explicit destination after a tutor question was focused', async () => {
  const h = fixture();
  h.state.notes.first = 'Existing lesson observation';
  h.get('lesson-notes').value = h.state.notes.first;
  const question = h.get('voice-question');
  question.value = 'How does helix angle affect chip evacuation?';
  // Model the focus event seen by the controller, including the stale selection
  // that previously made the lesson's Dictate button append to the question.
  h.document.dispatchEvent(new MockEvent('focusin', { target: question }));
  h.voice.open('dictate');
  assert.equal(h.get('voice-dictation-target').value, 'question');
  h.get('voice-dictation-engine').value = 'browser';

  await h.voice.start('dictate', { target: 'lesson/first' });
  assert.equal(h.get('voice-dictation-target').value, 'lesson/first', 'The notes entry point must override stale question focus');
  const recognition = h.records.recognizers[0];
  assert.equal(recognition.starts, 1);
  recognition.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'Compare the flute and core on one tool.' }], { isFinal: true })] });
  assert.equal(h.state.notes.first, 'Existing lesson observation', 'Capture remains a reviewable draft until explicitly saved');
  h.click('voice-finish-dictation');
  h.click('voice-save-dictation');

  assert.equal(h.state.notes.first, 'Existing lesson observation\nCompare the flute and core on one tool.');
  assert.equal(h.get('lesson-notes').value, h.state.notes.first, 'The visible lesson notebook must update');
  assert.equal(question.value, 'How does helix angle affect chip evacuation?', 'An unrelated tutor question must remain untouched');
  assert.equal(h.records.saves, 1);
});

test('Undo removes only an unchanged last addition, and stale dictation callbacks cannot add words', async () => {
  const h = fixture(); h.state.notes.first = 'Keep this';
  h.get('voice-draft').value = 'Temporary observation'; h.click('voice-save-dictation');
  assert.equal(h.state.notes.first, 'Keep this\nTemporary observation');
  h.click('voice-undo-dictation');
  assert.equal(h.state.notes.first, 'Keep this');
  assert.equal(h.get('voice-undo-dictation').disabled, true);
  h.get('voice-dictation-engine').value = 'browser'; await h.click('voice-dictate');
  const recognition = h.records.recognizers[0], lateResult = recognition.onresult;
  await h.voice.stop();
  lateResult({ resultIndex: 0, results: [Object.assign([{ transcript: 'Too late' }], { isFinal: true })] });
  assert.equal(recognition.aborts, 1);
  assert.equal(h.get('voice-draft').value, '');
  assert.equal(h.state.notes.first, 'Keep this');
});

test('Scribe partials stay interim, committed words stay a draft, and Stop all ignores late commits', async () => {
  const h = fixture(); await h.unlock(); h.get('voice-dictation-engine').value = 'elevenlabs';
  await h.click('voice-dictate'); const scribe = h.records.scribes[0];
  assert.ok(scribe);
  scribe.emit('partial', { text: 'Inspect' }); assert.equal(h.get('voice-draft').value, '');
  scribe.emit('committed', { text: 'Inspect the edge.' });
  assert.equal(h.get('voice-draft').value, 'Inspect the edge.');
  assert.equal(h.records.saves, 0);
  await h.voice.stop(); scribe.emit('committed', { text: 'Late words' });
  assert.equal(scribe.closes, 1);
  assert.equal(h.get('voice-draft').value, 'Inspect the edge.');
});

test('Finish Scribe mutes first, accepts the final commit once, then closes before Add text', async () => {
  const h = fixture(); await h.unlock(); h.get('voice-dictation-engine').value = 'elevenlabs';
  await h.click('voice-dictate'); const scribe = h.records.scribes[0];
  scribe.emit('partial', { text: 'Inspect the' });
  h.click('voice-finish-dictation');
  assert.equal(scribe.mutes, 1);
  assert.equal(scribe.closes, 0, 'Finishing must allow the final service commit to arrive');
  assert.equal(h.voice.getStatus().dictating, true);
  assert.equal(h.get('voice-draft').value, '');
  scribe.emit('committed', { text: 'Inspect the cutting edge.' });
  assert.equal(scribe.closes, 1);
  assert.equal(h.voice.getStatus().dictating, false);
  assert.equal(h.get('voice-draft').value, 'Inspect the cutting edge.');
  scribe.emit('committed', { text: 'Inspect the cutting edge.' });
  assert.equal(h.get('voice-draft').value, 'Inspect the cutting edge.', 'A late repeated commit cannot duplicate the finished phrase');
  assert.equal(h.records.saves, 0);
  h.click('voice-save-dictation');
  assert.equal(h.state.notes.first, 'Inspect the cutting edge.');
});

test('Scribe finishing timeout preserves an unconfirmed partial for review', async () => {
  const h = fixture(); await h.unlock(); h.get('voice-dictation-engine').value = 'elevenlabs';
  await h.click('voice-dictate'); const scribe = h.records.scribes[0];
  scribe.emit('partial', { text: 'Check the final phrase' });
  h.click('voice-finish-dictation'); h.runTimer(4500);
  assert.equal(scribe.closes, 1);
  assert.equal(h.voice.getStatus().dictating, false);
  assert.equal(h.get('voice-draft').value, 'Check the final phrase');
  assert.match(h.get('voice-error').textContent, /not confirmed/);
  assert.equal(h.records.saves, 0, 'Unconfirmed words still require explicit review and Add text');
  scribe.emit('committed', { text: 'Check the final phrase' });
  assert.equal(h.get('voice-draft').value, 'Check the final phrase');
});

test('Stop all closes a tutor instance returned after a delayed initial startSession', async () => {
  const h = fixture({ delaySessionStart: true }); await h.unlock();
  const starting = h.click('voice-start-tutor'); await flush();
  assert.equal(h.records.sessions.length, 1);
  assert.equal(h.voice.getStatus().connecting, true);
  await h.voice.stop(); h.releaseSessionStart(); await starting; await flush();
  assert.equal(h.records.sessions[0].ends, 1, 'The late microphone session must be ended immediately');
  assert.equal(h.records.sessions[0].updates.length, 0, 'A canceled connection must not be activated');
  assert.equal(h.voice.getStatus().connected || h.voice.getStatus().connecting, false);
  assert.match(h.get('voice-status').textContent, /Stopped/);
});

test('sending a question preserves text edited while the tutor connection is pending', async () => {
  const h = fixture({ delaySessionStart: true }); await h.unlock();
  h.get('voice-question').value = 'Explain the original question.';
  h.get('voice-question-form').onsubmit(new MockEvent('submit'));
  await flush(); assert.equal(h.records.sessions.length, 1);
  h.get('voice-question').value = 'My next question is still being edited.';
  h.get('voice-question-form').onsubmit(new MockEvent('submit'));
  h.releaseSessionStart(); await flush();
  assert.deepEqual(h.records.sessions[0].messages, ['Explain the original question.']);
  assert.equal(h.get('voice-question').value, 'My next question is still being edited.');
  assert.equal(h.records.sessions.length, 1, 'A repeated submit cannot open another pending conversation');
});

test('real content bridge keeps hidden answers and private notes out of live tutor context', async () => {
  const h = fixture({ realContent: true });
  h.state.notes.first = 'PRIVATE_NOTE_MARKER'; h.state.brief.Material = 'PRIVATE_BRIEF_MARKER';
  h.get('lesson-notes').value = 'PRIVATE_NOTE_MARKER';
  await h.unlock(); await h.click('voice-text-tutor');
  const { options } = h.records.sessions[0];
  for (const payload of [options.dynamicVariables.current_context, options.clientTools.academy_context()]) {
    assert.doesNotMatch(payload, /HIDDEN_EXERCISE_ANSWER|HIDDEN_QUIZ_EXPLANATION|PRIVATE_NOTE_MARKER|PRIVATE_BRIEF_MARKER/);
    const context = JSON.parse(payload);
    assert.equal(context.currentLesson.quiz.question, 'Which part cuts?');
    assert.deepEqual(context.currentLesson.quiz.options, ['The edge', 'The label']);
    assert.equal(Object.hasOwn(context.currentLesson.quiz, 'correct'), false);
  }
  h.document.querySelector('.lesson-body details').open = true;
  h.document.querySelector('[data-answer]').classList.add('correct');
  h.get('quiz-feedback').textContent = 'Correct. HIDDEN_QUIZ_EXPLANATION';
  const revealed = options.clientTools.academy_context();
  assert.match(revealed, /HIDDEN_EXERCISE_ANSWER/);
  assert.match(revealed, /HIDDEN_QUIZ_EXPLANATION/);
  assert.doesNotMatch(revealed, /PRIVATE_NOTE_MARKER|PRIVATE_BRIEF_MARKER/);
});

test('exhausted ElevenLabs credits continue the same lesson using device speech without another paid request', async () => {
  const h = fixture({ lessonText: 'Compare 0.025 mm per tooth with 0.05 mm per tooth.' });
  await h.unlock(); h.change('voice-engine', 'elevenlabs'); let requests = 0;
  h.context.fetch = async () => { requests++; return { ok: false, status: 402, json: async () => ({ error: 'provider_quota_exceeded', message: 'PRIVATE_PROVIDER_DETAIL' }) }; };
  h.click('voice-read'); await flush();
  assert.equal(requests, 1);
  assert.equal(h.get('voice-engine').value, 'device');
  assert.equal(h.voice.getStatus().playing, true);
  assert.equal(h.get('voice-error').hidden, true);
  assert.match(h.get('voice-notice').textContent, /device voice/);
  assert.equal(h.records.spoken[0].text, 'Dimensions. Compare 0.025 mm per tooth with 0.05 mm per tooth.');
  assert.equal(JSON.parse(h.context.localStorage.getItem('ctc-voice-preferences-v1')).engine, 'device');
  await h.drainSpeech(); h.click('voice-read'); await flush();
  assert.equal(requests, 1, 'Continuing or replaying must not repeat a paid request after fallback');
  assert.ok(!h.document.body.textContent.includes('PRIVATE_PROVIDER_DETAIL'));
  const saved = JSON.parse(h.context.localStorage.getItem('ctc-voice-preferences-v1'));
  const reopened = fixture({ initialPreferences: saved });
  assert.equal(reopened.get('voice-notice').hidden, false, 'The reason for device listening survives a reload');
  assert.match(reopened.get('voice-inline-notice').textContent, /ElevenLabs.*credits.*device voice/);
  assert.equal(reopened.get('voice-inline-elevenlabs').hidden, false);
  await reopened.voice.start('listen'); await flush();
  assert.equal(reopened.records.fetches.length, 0, 'Reloading never retries paid audio automatically');
  assert.equal(reopened.records.spoken.length, 1);
});

test('deliberate engine choices clear the saved fallback reason without forcing a cloud retry', () => {
  const fresh = fixture();
  assert.equal(fresh.get('voice-engine').value, 'device');
  assert.equal(fresh.get('voice-inline-elevenlabs').hidden, false);
  assert.equal(fresh.get('voice-inline-notice').hidden, true);
  for (const engine of ['device', 'elevenlabs']) {
    const h = fixture({ initialPreferences: { engine: 'device', fallbackReason: 'quota' } });
    h.change('voice-engine', engine);
    const saved = JSON.parse(h.context.localStorage.getItem('ctc-voice-preferences-v1'));
    const reopened = fixture({ initialPreferences: saved });
    assert.equal(reopened.get('voice-engine').value, engine);
    assert.equal(reopened.get('voice-inline-notice').hidden, true);
    assert.equal(reopened.get('voice-inline-elevenlabs').hidden, engine === 'elevenlabs');
    assert.equal(h.records.fetches.length + reopened.records.fetches.length, 0);
  }
});

test('the visible ElevenLabs choice starts the selected section only after normal authentication', async () => {
  const h = visualLessonFixture({ initialPreferences: { engine: 'device', fallbackReason: 'quota' } });
  h.window.dispatchEvent(new MockEvent('academy:visual-step', { detail: { lessonId: 'first', sectionIndex: 1 } }));
  h.document.dispatchEvent(new MockEvent('click', { target: h.get('voice-inline-elevenlabs') })); await flush();
  assert.equal(h.get('voice-engine').value, 'elevenlabs');
  assert.equal(h.get('voice-auth').hidden, false);
  assert.equal(h.get('voice-inline-elevenlabs').hidden, true);
  assert.equal(h.get('voice-inline-notice').hidden, true);
  assert.equal(h.records.fetches.length + h.records.spoken.length, 0, 'Choosing a cloud voice cannot bypass the access code');
  await h.unlock(); await flush();
  const requests = h.records.fetches.filter(call => call.action === 'tts');
  assert.equal(requests.length, 1);
  assert.match(requests[0].text, /PLAIN_SECOND_SECTION/);
  assert.equal(h.voice.getStatus().sectionTitle, 'The chip exit');
  assert.equal(h.get('voice-audio-player').plays, 1);
});

for (const responseKind of ['audio', 'quota fallback']) {
  test(`Pause while TTS is preparing also pauses the eventual ${responseKind}`, async () => {
    const h = fixture(); await h.unlock(); h.change('voice-engine', 'elevenlabs');
    const response = deferred(); h.context.fetch = () => response.promise;
    const pending = h.voice.start('listen'); await flush();
    h.click('voice-quick-pause');
    response.resolve(responseKind === 'audio'
      ? { ok: true, headers: { get: () => 'audio/mpeg' }, blob: async () => new Blob(['offline-audio'], { type: 'audio/mpeg' }) }
      : { ok: false, status: 402, json: async () => ({ error: 'provider_quota_exceeded' }) });
    await pending; await flush();
    assert.equal(h.voice.getStatus().paused, true);
    assert.equal(h.get('voice-audio-player').plays || 0, 0);
    assert.equal(h.records.spoken.length, 0, 'No output begins while the learner has paused');
    h.click('voice-read'); await flush();
    assert.equal(h.voice.getStatus().paused, false);
    assert.equal(responseKind === 'audio' ? h.get('voice-audio-player').plays : h.records.spoken.length, 1);
  });
}

for (const outcome of ['resolve', 'reject']) {
  for (const stage of ['initial playback', 'blocked playback retry', 'paused playback resume']) {
    test(`Stop survives a late media ${outcome} during ${stage}`, async () => {
      const h = fixture(); await h.unlock(); h.change('voice-engine', 'elevenlabs');
      const audio = h.get('voice-audio-player');
      if (stage === 'blocked playback retry') audio.play = () => Promise.reject(new Error('gesture required'));
      if (stage !== 'initial playback') {
        await h.voice.start('listen'); await flush();
        if (stage === 'paused playback resume') h.click('voice-read');
      }
      const media = deferred(); audio.play = () => media.promise;
      const pending = stage === 'initial playback' ? h.voice.start('listen') : h.click('voice-read'); await flush();
      await h.voice.stop();
      const stoppedStatus = h.get('voice-status').textContent;
      outcome === 'resolve' ? media.resolve() : media.reject(new Error('play interrupted'));
      await pending; await flush();
      assert.equal(h.voice.getStatus().playing, false);
      assert.equal(h.get('voice-read').textContent, 'Play from here');
      assert.equal(h.get('voice-status').textContent, stoppedStatus);
      assert.equal(h.get('voice-error').hidden, true);
      assert.equal(h.get('voice-dock').hidden, true, 'A stale media callback cannot reopen the controls');
    });
  }
  test(`Pause survives a late media ${outcome} and can subsequently resume`, async () => {
    const h = fixture(); await h.unlock(); h.change('voice-engine', 'elevenlabs');
    const audio = h.get('voice-audio-player');
    const media = deferred(); audio.play = () => media.promise;
    const pending = h.voice.start('listen'); await flush();
    h.click('voice-quick-pause');
    outcome === 'resolve' ? media.resolve() : media.reject(new Error('play interrupted'));
    await pending; await flush();
    assert.equal(h.voice.getStatus().paused, true);
    assert.equal(h.get('voice-read').textContent, 'Resume');
    assert.equal(h.get('voice-error').hidden, true);
    audio.play = Element.prototype.play;
    await h.click('voice-read'); await flush();
    assert.equal(h.voice.getStatus().paused, false);
    assert.equal(audio.plays, 1);
  });
}

test('Listen and watch retries the prepared mobile audio without rebuilding or requesting it again', async () => {
  const h = visualLessonFixture(); await h.unlock(); h.change('voice-engine', 'elevenlabs');
  let blobUrls = 0;
  h.context.URL.createObjectURL = () => `blob:offline-${++blobUrls}`;
  const audio = h.get('voice-audio-player');
  audio.play = () => Promise.reject(new Error('gesture required'));
  await h.voice.start('listen', { sectionId: 'first:section:1' }); await flush();
  audio.play = Element.prototype.play;
  h.window.dispatchEvent(new MockEvent('academy:visual-listen', { detail: { lessonId: 'first', sectionIndex: 1 } })); await flush();
  assert.equal(blobUrls, 1, 'The tap uses the already prepared audio source');
  assert.equal(audio.plays, 1);
  assert.equal(h.records.fetches.filter(call => call.action === 'tts').length, 1);
  assert.equal(h.voice.getStatus().paused, false);
});

test('mobile media controls keep narration state aligned and cannot restart stopped audio', async () => {
  const h = fixture(); await h.unlock(); h.change('voice-engine', 'elevenlabs');
  const controls = new Map();
  h.context.navigator.mediaSession = { setActionHandler: (name, handler) => controls.set(name, handler) };
  h.window.MediaMetadata = h.context.MediaMetadata = class {};
  await h.voice.start('listen'); await flush();
  controls.get('pause')();
  assert.equal(h.voice.getStatus().paused, true);
  await controls.get('play')(); await flush();
  assert.equal(h.voice.getStatus().paused, false);
  const plays = h.get('voice-audio-player').plays;
  await h.voice.stop(); controls.get('play')(); await flush();
  assert.equal(h.get('voice-audio-player').plays, plays);
  assert.equal(h.voice.getStatus().playing, false);
});

for (const cancellation of ['stop', 'route']) {
  test(`a late quota response cannot start fallback speech after ${cancellation}`, async () => {
    const h = fixture(); await h.unlock(); h.change('voice-engine', 'elevenlabs'); const reply = deferred();
    h.context.fetch = () => reply.promise;
    h.click('voice-read'); await flush();
    if (cancellation === 'stop') await h.voice.stop(); else h.route('learn');
    reply.resolve({ ok: false, status: 402, json: async () => ({ error: 'provider_quota_exceeded' }) });
    await flush();
    assert.equal(h.records.spoken.length, 0);
    assert.equal(h.voice.getStatus().playing, false);
    assert.equal(h.get('voice-engine').value, 'elevenlabs', 'A stale response cannot change saved preferences');
  });
}

test('download credit failure explains the limit and offers real device listening without claiming an audio file', async () => {
  const h = fixture(); await h.unlock(); let requests = 0;
  h.context.fetch = async () => { requests++; return { ok: false, status: 402, json: async () => ({ error: 'provider_quota_exceeded' }) }; };
  await h.click('voice-full-audio'); await flush();
  assert.match(h.get('voice-error').textContent, /not enough ElevenLabs credits/);
  assert.equal(h.get('voice-download-audio').hidden, true);
  assert.equal(h.get('voice-audio-player').hidden, true);
  assert.equal(h.get('voice-use-device').hidden, false);
  assert.equal(h.records.spoken.length, 0, 'Preparing a download does not unexpectedly start speech');
  h.click('voice-use-device'); await flush();
  assert.equal(h.records.spoken.length, 1);
  assert.equal(requests, 1);
  assert.equal(h.get('voice-error').hidden, true);
});

test('unknown gateway errors and raw provider messages are never rendered or mistaken for a quota fallback', async () => {
  const h = fixture(); await h.unlock(); h.change('voice-engine', 'elevenlabs');
  h.context.fetch = async () => ({ ok: false, status: 502, json: async () => ({ error: 'constructor', message: 'SECRET_PROVIDER_BODY' }) });
  h.click('voice-read'); await flush();
  assert.equal(h.records.spoken.length, 0);
  assert.equal(h.voice.getStatus().playing, false);
  assert.ok(!h.document.body.textContent.includes('SECRET_PROVIDER_BODY'));
  assert.match(h.get('voice-error').textContent, /voice service could not complete/);
});

function visualLessonFixture(options = {}) {
  const h = fixture({ ...options, realContent: true });
  const lesson = h.DATA.modules[0];
  lesson.analogy = 'PLAIN_ANALOGY about removing pencil shavings.';
  lesson.takeaway = 'LESSON_TAKEAWAY: material needs a way out.';
  lesson.sections = [
    { heading: 'The cutting edge', body: 'PLAIN_FIRST_SECTION describes the cutting edge.', example: 'PLAIN_EXAMPLE uses a pencil sharpener.', takeaway: 'SECTION_TAKEAWAY says the edge removes material.', technical: { body: 'OPTIONAL_TECHNICAL_BODY', bullets: ['OPTIONAL_TECHNICAL_BULLET'] } },
    { heading: 'The chip exit', body: 'PLAIN_SECOND_SECTION describes a clear exit for chips.', example: 'SECOND_EXAMPLE compares a clear channel.', takeaway: 'SECOND_TAKEAWAY keeps the exit open.' },
  ];
  h.document.querySelector('.lesson-body').innerHTML = '<div class="learning-objectives">Objectives</div><section class="lesson-section"><h3>The cutting edge</h3><details class="lesson-technical" data-technical-index="0"><summary>Engineering detail</summary><p>OPTIONAL_TECHNICAL_BODY</p></details></section><section class="lesson-section"><h3>The chip exit</h3></section><section class="lesson-section"><details><summary>Reveal</summary></details></section><section class="lesson-section"><div class="quiz-options"><button data-answer="0">The edge</button><button data-answer="1">The label</button></div><div id="quiz-feedback"></div></section>';
  const selectedSteps = [];
  const visualState = { lessonId: 'first', sectionIndex: 0, sectionTitle: 'A schematic cutting tool', sceneDescription: 'The edge removes material and chips leave through a channel.', motionPlaying: false, scope: 'Teaching model', privateImplementationData: 'PRIVATE_VISUAL_INTERNAL' };
  h.window.AcademyLessonVisuals = {
    selectStep(index) { selectedSteps.push(index); visualState.sectionIndex = index; },
    getState: () => ({ ...visualState }),
  };
  return { ...h, lesson, selectedSteps, visualState };
}

test('nested lesson transcripts keep section, optional detail, exercise and quiz targets aligned', async () => {
  const h = visualLessonFixture();
  const body = h.document.querySelector('.lesson-body');
  const nodes = body.querySelectorAll('section.lesson-section');
  const transcript = h.document.createElement('details');
  transcript.className = 'lesson-transcript';
  transcript.append(...nodes.slice(0, 2));
  body.replaceChildren(body.querySelector('.learning-objectives'), transcript, ...nodes.slice(2));
  let sections = h.window.AcademyVoiceContent.getSections();
  assert.equal(sections.find(part => part.id === 'first:section:0').element, nodes[0]);
  assert.equal(sections.find(part => part.id === 'first:section:1').element, nodes[1]);
  assert.equal(sections.find(part => part.id === 'first:exercise').element, nodes[2]);
  assert.equal(sections.find(part => part.id === 'first:quiz').element, nodes[3]);
  assert.doesNotMatch(JSON.stringify(h.window.AcademyVoiceContent.getContext()), /OPTIONAL_TECHNICAL_BODY|HIDDEN_EXERCISE_ANSWER|HIDDEN_QUIZ_EXPLANATION/);
  transcript.open = true;
  assert.ok(!h.window.AcademyVoiceContent.getSections().some(part => part.id === 'first:technical:0'), 'Opening the transcript alone does not opt into technical narration');
  const technical = nodes[0].querySelector('.lesson-technical');
  technical.open = true;
  h.window.dispatchEvent(new MockEvent('academy:lesson-detail'));
  sections = h.window.AcademyVoiceContent.getSections();
  assert.equal(sections.filter(part => part.id === 'first:technical:0').length, 1, 'Opening the transcript detail adds one optional passage');
  assert.equal(sections.find(part => part.id === 'first:technical:0').element, technical);
  assert.equal(sections.find(part => part.id === 'first:exercise').element, nodes[2]);
  assert.equal(sections.find(part => part.id === 'first:quiz').element, nodes[3]);
  await h.voice.start('listen', { sectionId: 'first:section:1' }); await flush();
  assert.match(h.records.spoken.at(-1).text, /PLAIN_SECOND_SECTION/);
  assert.equal(h.selectedSteps.at(-1), 1);
  assert.equal(h.records.fetches.length, 0);
});

test('simple examples are narrated while optional engineering detail stays out until the learner opens it', () => {
  const h = visualLessonFixture();
  h.state.notes.first = 'PRIVATE_VISUAL_LESSON_NOTE';
  let sections = h.window.AcademyVoiceContent.getSections();
  let context = JSON.stringify(h.window.AcademyVoiceContent.getContext());
  assert.match(sections[0].text, /PLAIN_ANALOGY/);
  assert.match(sections[0].text, /LESSON_TAKEAWAY/);
  const plain = sections.find(section => section.id === 'first:section:0');
  assert.match(plain.text, /PLAIN_FIRST_SECTION/);
  assert.match(plain.text, /PLAIN_EXAMPLE/);
  assert.match(plain.text, /SECTION_TAKEAWAY/);
  assert.doesNotMatch(context, /OPTIONAL_TECHNICAL_BODY|OPTIONAL_TECHNICAL_BULLET|PRIVATE_VISUAL_LESSON_NOTE|HIDDEN_EXERCISE_ANSWER|HIDDEN_QUIZ_EXPLANATION/);
  h.document.querySelector('.lesson-technical').open = true;
  sections = h.window.AcademyVoiceContent.getSections();
  const technical = sections.find(section => section.id === 'first:technical:0');
  assert.ok(technical, 'Open engineering detail becomes its own optional narration section');
  assert.match(technical.text, /OPTIONAL_TECHNICAL_BODY/);
  assert.match(technical.text, /OPTIONAL_TECHNICAL_BULLET/);
  context = JSON.stringify(h.window.AcademyVoiceContent.getContext());
  assert.match(context, /OPTIONAL_TECHNICAL_BODY/);
  assert.doesNotMatch(context, /PRIVATE_VISUAL_LESSON_NOTE|HIDDEN_EXERCISE_ANSWER|HIDDEN_QUIZ_EXPLANATION/);
  h.document.querySelector('.lesson-technical').open = false;
  assert.doesNotMatch(JSON.stringify(h.window.AcademyVoiceContent.getContext()), /OPTIONAL_TECHNICAL_BODY/);
});

test('narration follows a stable lesson section ID and selects its matching visual step', async () => {
  const h = visualLessonFixture();
  h.document.querySelector('.lesson-technical').open = true;
  await h.voice.start('listen', { sectionId: 'first:section:1' }); await flush();
  assert.equal(h.voice.getStatus().sectionTitle, 'The chip exit');
  assert.equal(h.selectedSteps.at(-1), 1);
  assert.match(h.records.spoken.at(-1).text, /PLAIN_SECOND_SECTION/);
  assert.doesNotMatch(h.records.spoken.at(-1).text, /OPTIONAL_TECHNICAL_BODY/);
  await h.voice.stop();
  await h.voice.start('listen', { sectionId: 'first:technical:0' }); await flush();
  assert.equal(h.selectedSteps.at(-1), 0, 'Optional detail stays with the visual it explains');
  assert.match(h.records.spoken.at(-1).text, /OPTIONAL_TECHNICAL_BODY/);
  assert.equal(h.records.sessions.length + h.records.recognizers.length + h.records.scribes.length, 0, 'Listening does not open a microphone');
});

test('closing the narrated engineering detail stops it and returns to its main section without skipping ahead', async () => {
  const h = visualLessonFixture();
  const detail = h.document.querySelector('.lesson-technical');
  detail.open = true;
  await h.voice.start('listen', { sectionId: 'first:technical:0' }); await flush();
  const oldCompletion = h.records.spoken.at(-1).onend;
  const spokenBeforeClose = h.records.spoken.length;
  detail.open = false;
  h.window.dispatchEvent(new MockEvent('academy:lesson-detail'));
  assert.equal(h.voice.getStatus().playing, false, 'Hiding the detail cancels its narration');
  assert.equal(h.voice.getStatus().sectionTitle, 'The cutting edge');
  assert.equal(h.selectedSteps.at(-1), 0);
  oldCompletion(); await flush();
  assert.equal(h.records.spoken.length, spokenBeforeClose, 'An already queued audio completion cannot continue the closed detail');
  h.click('voice-read'); await flush();
  assert.match(h.records.spoken.at(-1).text, /PLAIN_FIRST_SECTION/);
  for (let i = 0; i < 10 && h.voice.getStatus().sectionTitle === 'The cutting edge'; i++) {
    h.records.spoken.at(-1).onend?.(); await flush();
  }
  assert.equal(h.voice.getStatus().sectionTitle, 'The chip exit', 'Playback advances to the next main section after an explicit restart');
  assert.match(h.records.spoken.at(-1).text, /PLAIN_SECOND_SECTION/);
  assert.equal(h.records.fetches.length, 0);
});

test('closing unrelated engineering detail preserves the selected narration and its audio', async () => {
  const h = visualLessonFixture();
  const detail = h.document.querySelector('.lesson-technical');
  detail.open = true;
  await h.voice.start('listen', { sectionId: 'first:section:1' }); await flush();
  const audio = h.records.spoken.at(-1);
  const completion = audio.onend;
  const cancellations = h.records.cancellations;
  detail.open = false;
  h.window.dispatchEvent(new MockEvent('academy:lesson-detail'));
  assert.equal(h.voice.getStatus().playing, true);
  assert.equal(h.voice.getStatus().sectionTitle, 'The chip exit');
  assert.equal(h.get('voice-section-select').value, '2', 'The dropdown moves with the stable selected section');
  assert.equal(h.records.cancellations, cancellations);
  assert.equal(audio.onend, completion, 'The existing narration continues without being replaced');
  assert.equal(h.selectedSteps.at(-1), 1);
});

test('listening bookmarks survive a return to the lesson with engineering detail collapsed', async () => {
  const h = visualLessonFixture();
  const detail = h.document.querySelector('.lesson-technical');
  detail.open = true;
  await h.voice.start('listen', { sectionId: 'first:section:1' }); await flush();
  h.route('learn');
  detail.open = false;
  h.route('lesson/first');
  assert.equal(h.voice.getStatus().sectionTitle, 'The chip exit', 'The same main explanation is restored even though its list index changed');
  assert.equal(h.voice.getStatus().playing, false, 'Returning to a bookmark does not start audio');
  h.click('voice-read'); await flush();
  assert.match(h.records.spoken.at(-1).text, /PLAIN_SECOND_SECTION/);
});

test('a collapsed engineering-detail bookmark restores its main explanation', async () => {
  const h = visualLessonFixture();
  const detail = h.document.querySelector('.lesson-technical');
  detail.open = true;
  await h.voice.start('listen', { sectionId: 'first:technical:0' }); await flush();
  h.route('learn');
  detail.open = false;
  h.route('lesson/first');
  assert.equal(h.voice.getStatus().sectionTitle, 'The cutting edge');
  assert.equal(detail.open, false, 'Restoring a place does not reopen optional material');
  h.click('voice-read'); await flush();
  assert.match(h.records.spoken.at(-1).text, /PLAIN_FIRST_SECTION/);
});

test('saved numeric bookmarks from older versions still restore within the available section list', () => {
  for (const [saved, expectedId] of [[2, 'first:section:1'], [999, 'first:quiz']]) {
    const h = visualLessonFixture({ initialPreferences: { bookmarks: { 'lesson/first': saved } } });
    h.route('learn'); h.route('lesson/first');
    assert.equal(h.window.AcademyVoiceContent.getSections()[h.voice.getStatus().sectionIndex].id, expectedId);
  }
});

test('a requested narration section stays stable if earlier detail opens while a tutor is ending', async () => {
  const h = visualLessonFixture();
  await h.unlock(); await h.click('voice-start-tutor');
  const previous = h.records.sessions[0]; previous.endGate = deferred();
  const pending = h.voice.start('listen', { sectionId: 'first:section:1' }); await flush();
  h.document.querySelector('.lesson-technical').open = true;
  h.window.dispatchEvent(new MockEvent('academy:lesson-detail'));
  previous.endGate.resolve(); await pending; await flush();
  assert.equal(h.voice.getStatus().sectionTitle, 'The chip exit');
  assert.match(h.records.spoken.at(-1).text, /PLAIN_SECOND_SECTION/);
  assert.doesNotMatch(h.records.spoken.at(-1).text, /OPTIONAL_TECHNICAL_BODY/);
});

for (const mode of ['listen', 'tutor']) {
  test(`delegated ${mode} controls prefer a stable section ID over an obsolete numeric index`, async () => {
    const h = visualLessonFixture();
    if (mode === 'tutor') await h.unlock();
    h.document.querySelector('.lesson-technical').open = true;
    const button = h.document.createElement('button');
    button.setAttribute('data-voice-action', mode);
    button.setAttribute('data-voice-section', '2');
    button.setAttribute('data-voice-section-id', 'first:section:1');
    h.get('main').appendChild(button);
    h.document.dispatchEvent(new MockEvent('click', { target: button })); await flush();
    assert.equal(h.voice.getStatus().sectionTitle, 'The chip exit');
    assert.equal(h.selectedSteps.at(-1), 1);
    if (mode === 'listen') {
      assert.match(h.records.spoken.at(-1).text, /PLAIN_SECOND_SECTION/);
      assert.equal(h.records.fetches.length, 0);
    } else {
      const context = JSON.parse(h.records.sessions[0].options.dynamicVariables.current_context);
      assert.equal(context.narration.sectionId, 'first:section:1');
      assert.equal(h.records.spoken.length, 0);
    }
  });
}

test('legacy delegated controls still accept a numeric narration section', async () => {
  const h = visualLessonFixture();
  h.window.dispatchEvent(new MockEvent('academy:lesson-detail'));
  const button = h.document.querySelectorAll('.voice-section-trigger').find(item => item.dataset.voiceAction === 'listen' && item.dataset.voiceSection === '2');
  assert.ok(button);
  h.document.dispatchEvent(new MockEvent('click', { target: button })); await flush();
  assert.equal(h.voice.getStatus().sectionTitle, 'The chip exit');
  assert.match(h.records.spoken.at(-1).text, /PLAIN_SECOND_SECTION/);
});

test('a visual Listen event resolves the matching main section even when optional detail shifts the list', async () => {
  const h = visualLessonFixture();
  h.document.querySelector('.lesson-technical').open = true;
  h.window.dispatchEvent(new MockEvent('academy:visual-listen', { detail: { lessonId: 'first', sectionIndex: 1 } }));
  await flush();
  assert.equal(h.voice.getStatus().sectionTitle, 'The chip exit');
  assert.match(h.records.spoken.at(-1).text, /PLAIN_SECOND_SECTION/);
  assert.equal(h.selectedSteps.at(-1), 1);
  assert.equal(h.records.fetches.length, 0, 'Device narration does not consume a provider request');
});

test('visual step changes remain silent while idle or paused, and active narration follows the chosen step', async () => {
  const h = visualLessonFixture();
  const step = index => h.window.dispatchEvent(new MockEvent('academy:visual-step', { detail: { lessonId: 'first', sectionIndex: index } }));
  step(1); await flush();
  assert.equal(h.voice.getStatus().sectionTitle, 'The chip exit');
  assert.equal(h.records.spoken.length, 0, 'Selecting a visual alone does not start narration');
  await h.voice.start('listen', { sectionId: 'first:section:0' }); await flush();
  const beforeActiveChange = h.records.spoken.length;
  step(1); await flush();
  assert.equal(h.records.spoken.length, beforeActiveChange + 1);
  assert.match(h.records.spoken.at(-1).text, /PLAIN_SECOND_SECTION/);
  h.click('voice-read'); await flush();
  const beforePausedChange = h.records.spoken.length;
  step(0); await flush();
  assert.equal(h.records.spoken.length, beforePausedChange, 'Changing the visual must not unpause speech');
  assert.equal(h.voice.getStatus().sectionTitle, 'The cutting edge');
  h.click('voice-read'); await flush();
  assert.match(h.records.spoken.at(-1).text, /PLAIN_FIRST_SECTION/, 'The next explicit play starts the newly selected section');
  assert.equal(h.records.sessions.length + h.records.recognizers.length + h.records.scribes.length, 0);
});

test('visual events from another lesson are ignored and Stop cancels narration waiting for a tutor to end', async () => {
  const h = visualLessonFixture();
  h.window.dispatchEvent(new MockEvent('academy:visual-listen', { detail: { lessonId: 'different-lesson', sectionIndex: 1 } }));
  await flush(); assert.equal(h.records.spoken.length, 0);
  await h.unlock(); await h.click('voice-start-tutor');
  const previous = h.records.sessions[0]; previous.endGate = deferred();
  h.window.dispatchEvent(new MockEvent('academy:visual-listen', { detail: { lessonId: 'first', sectionIndex: 1 } }));
  await flush(); assert.equal(previous.ends, 1);
  await h.voice.stop(); previous.endGate.resolve(); await flush();
  assert.equal(h.records.spoken.length, 0, 'Stop wins over a pending visual Listen request');
  assert.equal(h.records.sessions.length, 1);
  assert.equal(h.records.recognizers.length + h.records.scribes.length, 0);
  assert.equal(h.voice.getStatus().playing || h.voice.getStatus().connected, false);
});

test('tutor context includes only the visual that belongs to the current lesson', () => {
  const h = visualLessonFixture();
  let context = h.window.AcademyVoiceContent.getContext();
  assert.equal(context.lessonVisual.lessonId, 'first');
  assert.equal(context.lessonVisual.sectionIndex, 0);
  assert.match(context.lessonVisual.sceneDescription, /chips leave/);
  assert.doesNotMatch(JSON.stringify(context), /PRIVATE_VISUAL_INTERNAL/, 'Only public teaching state belongs in the tutor context');
  h.visualState.lessonId = 'stale-lesson';
  context = h.window.AcademyVoiceContent.getContext();
  assert.ok(!context.lessonVisual, 'A visual left over from another page must not become tutor context');
  h.visualState.lessonId = 'first'; h.route('learn');
  context = h.window.AcademyVoiceContent.getContext();
  assert.ok(!context.lessonVisual, 'The course overview must not inherit a lesson visual');
});
