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

function fixture({ lessonText = 'Understand the cutting edge.', realContent = false, delaySessionStart = false } = {}) {
  const document = new Document(), window = new Events();
  const main = document.createElement('main'); main.id = 'main'; document.body.appendChild(main);
  const lesson = {
    id: 'first', title: 'First lesson', subtitle: 'A fixture lesson', group: 'Fundamentals',
    objectives: ['Explain an edge.'], sections: [{ heading: 'Dimensions', body: lessonText }],
    exercise: { prompt: 'Observe one edge.', answer: 'HIDDEN_EXERCISE_ANSWER' },
    quiz: { question: 'Which part cuts?', options: ['The edge', 'The label'], correct: 0, explanation: 'HIDDEN_QUIZ_EXPLANATION' }, sources: [],
  };
  main.innerHTML = '<div class="page-heading"><h1>First lesson</h1></div><article class="lesson-body"><div class="learning-objectives">Objectives</div><section><h3>Dimensions</h3></section><section><details><summary>Reveal</summary></details></section><section><div class="quiz-options"><button data-answer="0">The edge</button><button data-answer="1">The label</button></div><div id="quiz-feedback"></div></section></article><textarea id="lesson-notes"></textarea>';
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
  const sectionElement = main.querySelector('.lesson-body > section');
  const content = {
    getSections: () => [{ id: 'first:section:0', title: 'Dimensions', text: lessonText, element: sectionElement }],
    getContext: () => ({ route: location.hash.slice(1), currentSections: [{ title: 'Dimensions', text: lessonText }] }),
    performAction: () => ({ ok: true, message: 'Action recorded' }),
  };
  const store = new Map();
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
