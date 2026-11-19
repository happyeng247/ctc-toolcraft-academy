'use strict';

// Run with: node --test tests/lesson-visuals.test.cjs
// Execute the shipped scene controller and actual vendored Three.js geometry.
// Only the DOM, GPU renderer and scheduling APIs are doubled. These tests catch
// missing/malformed teaching scenes and lifecycle regressions; visual appearance
// and real GPU rendering still need browser review. No network or paid service runs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src/lesson-visuals.js'), 'utf8');
const THREE = require(path.join(ROOT, 'src/vendor/three.min.js'));
const MODULES = ['foundations', 'manufacturing', 'ai-playbook'].flatMap(name =>
  JSON.parse(fs.readFileSync(path.join(ROOT, `src/${name}.json`), 'utf8')).modules);
const LESSON_IDS = [
  'cutting-system', 'tool-anatomy', 'chip-mechanics', 'workpiece-materials',
  'tool-materials', 'milling-operations', 'holemaking', 'pcb-tools',
  'failure-diagnosis', 'mfg-requirements', 'mfg-carbide', 'mfg-pcd',
  'mfg-rollomatic', 'mfg-quality', 'ai-design-system',
  'knowledge-and-collaboration', 'portfolio-and-experiments',
];

class MockEvent {
  constructor(type, properties = {}) { this.type = type; Object.assign(this, properties); }
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
    return !event.defaultPrevented;
  }
  listenerCount() { return [...this.listeners.values()].reduce((sum, values) => sum + values.size, 0); }
}
function matches(element, selector) {
  if (element.tagName === '#TEXT') return false;
  const tag = selector.match(/^[a-z][\w-]*/i)?.[0];
  if (tag && element.tagName !== tag.toUpperCase()) return false;
  for (const [, name] of selector.matchAll(/\.([\w-]+)/g))
    if (!element.className.split(/\s+/).includes(name)) return false;
  for (const [, name, , value] of selector.matchAll(/\[([\w-]+)(?:=(["']?)([^"'\]]+)\2)?\]/g)) {
    const actual = element.getAttribute(name);
    if (actual === null || (value !== undefined && actual !== value)) return false;
  }
  return true;
}
class Element extends Events {
  constructor(tag, document) {
    super(); this.tagName = tag.toUpperCase(); this.ownerDocument = document;
    this.children = []; this.parentNode = null; this.attributes = {};
    this.dataset = {}; this.style = {}; this.className = ''; this._text = '';
    this.disabled = false; this.hidden = false;
    this.clientWidth = 640; this.clientHeight = 400;
    document.elements.push(this);
  }
  get isConnected() {
    for (let node = this; node; node = node.parentNode)
      if (node === this.ownerDocument.documentElement) return true;
    return false;
  }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
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
        for (const [, name, , quoted, plain] of attributes.matchAll(/([\w-]+)(?:=(?:(["'])(.*?)\2|([^\s>]+)))?/g))
          child.setAttribute(name, quoted ?? plain ?? '');
        stack.at(-1).appendChild(child);
        if (!voidTags.has(child.tagName) && !token.endsWith('/>')) stack.push(child);
      } else {
        const child = this.ownerDocument.createElement('#text'); child._text = token;
        stack.at(-1).appendChild(child);
      }
    }
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'class') this.className = String(value);
    if (name === 'disabled') this.disabled = true;
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
  }
  getAttribute(name) {
    if (name === 'class') return this.className || null;
    if (name.startsWith('data-')) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] ?? null;
    return this.attributes[name] ?? null;
  }
  appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
  replaceChildren(...children) {
    this.children.forEach(child => { child.parentNode = null; });
    this.children = []; this._text = ''; children.forEach(child => this.appendChild(child));
  }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(matches(child, selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  click() { if (!this.disabled) this.dispatchEvent(new MockEvent('click')); }
  setPointerCapture() {}
}
class Document extends Events {
  constructor() {
    super(); this.elements = []; this.visibilityState = 'visible';
    this.documentElement = new Element('html', this); this.body = new Element('body', this);
    this.documentElement.appendChild(this.body);
  }
  createElement(tag) { return new Element(tag, this); }
}

function fixture({ reducedMotion = false, unavailable = false, rendererFails = false } = {}) {
  const document = new Document(), window = new Events(), frames = new Map();
  const host = document.createElement('div'); document.body.appendChild(host);
  const records = { renders: 0, rendererDisposals: 0, contextReleases: 0,
    observers: [], geometries: new Set(), materials: new Set(), disposed: new Set() };
  let frameId = 0, clock = 0, lastScene = null;
  function track(resource, set) {
    if (set.has(resource)) return;
    set.add(resource); resource.addEventListener('dispose', () => records.disposed.add(resource));
  }
  class Renderer {
    constructor() {
      if (rendererFails) throw new Error('Simulated unavailable GPU');
      this.domElement = document.createElement('canvas');
    }
    setPixelRatio() {}
    setSize() {}
    render(scene, camera) {
      lastScene = scene;
      scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
      scene.traverse(object => {
        if (object.geometry) track(object.geometry, records.geometries);
        if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) track(material, records.materials);
      });
      records.renders++;
    }
    dispose() { records.rendererDisposals++; }
    forceContextLoss() { records.contextReleases++; }
  }
  class ResizeObserver {
    constructor(callback) { this.callback = callback; records.observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  }
  class IntersectionObserver extends ResizeObserver {}
  window.THREE = unavailable ? null : { ...THREE, WebGLRenderer: Renderer };
  window.devicePixelRatio = 1;
  vm.runInNewContext(SOURCE, {
    window, document, console, CustomEvent: MockEvent,
    matchMedia: () => ({ matches: reducedMotion }), ResizeObserver, IntersectionObserver,
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
  }, { filename: 'lesson-visuals.js' });
  return {
    api: window.AcademyLessonVisuals, document, window, host, frames, records,
    get scene() { return lastScene; },
    tick(count = 1) {
      for (let i = 0; i < count; i++) {
        clock += 50;
        const callbacks = [...frames.values()]; frames.clear();
        callbacks.forEach(callback => callback(clock));
      }
    },
    visible(visible) {
      records.observers.find(observer => observer instanceof IntersectionObserver)?.callback([{ isIntersecting: visible }]);
    },
    click(selector) {
      const element = host.querySelector(selector); assert.ok(element, `Control exists: ${selector}`); element.click();
    },
  };
}
function signature(scene) {
  const values = [];
  scene.traverse(object => {
    values.push(...object.position.toArray(), ...object.rotation.toArray().slice(0, 3), ...object.scale.toArray(), object.visible);
    for (const material of object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [])
      values.push(material.opacity, material.emissiveIntensity);
  });
  return JSON.stringify(values);
}
function validateGeometry(scene, label) {
  let vertices = 0, meshes = 0;
  scene.traverse(object => {
    if (object.isMesh) meshes++;
    const position = object.geometry?.attributes?.position;
    if (position) {
      vertices += position.count;
      assert.ok(position.array.every(Number.isFinite), `${label}: geometry contains only finite positions`);
    }
    assert.ok([...object.position.toArray(), ...object.scale.toArray()].every(Number.isFinite), `${label}: finite transforms`);
  });
  assert.ok(meshes >= 2, `${label}: teaching scene has real geometry`);
  assert.ok(vertices > 100, `${label}: nonempty teaching geometry`);
  return vertices;
}

// This explicit catalogue catches an accidentally omitted lesson or changed section
// count; the individual tests below independently execute every section mapping.
test('the curriculum maps all 17 lessons and 76 teaching steps', () => {
  assert.deepEqual(MODULES.map(module => module.id), LESSON_IDS);
  assert.equal(MODULES.reduce((sum, module) => sum + module.sections.length, 0), 76);
});
for (const module of MODULES) {
  test(`${module.id}: every teaching step builds, explains its motion and animates`, t => {
    const f = fixture(); t.after(() => f.api.dispose()); f.api.mount(f.host, module);
    for (let index = 0; index < module.sections.length; index++) {
      f.api.selectStep(index); f.tick();
      const state = f.api.getState(), label = `${module.id} section ${index}`;
      assert.equal(state.webglAvailable, true, `${label}: scene did not silently fall back`);
      assert.equal(state.lessonId, module.id); assert.equal(state.sectionIndex, index);
      assert.equal(state.sectionTitle, module.sections[index].heading);
      assert.ok(state.sceneDescription.length > 20, `${label}: useful description for teaching and voice`);
      assert.equal(f.host.querySelector('.lv-step-heading').textContent, module.sections[index].heading);
      assert.ok(f.host.querySelector('.lv-reading').textContent.includes(module.sections[index].body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')), `${label}: full explanation accompanies the moving model`);
      assert.equal(f.host.querySelector('.lv-example p').textContent, module.sections[index].example);
      assert.equal(f.host.querySelector('.lv-ask').dataset.voiceSectionId, `${module.id}:section:${index}`);
      assert.ok(f.host.querySelectorAll('.lv-model-label').length >= 1, `${label}: labels identify the scene`);
      validateGeometry(f.scene, label);
      const before = signature(f.scene); f.tick(32);
      assert.notEqual(signature(f.scene), before, `${label}: geometry or highlighted state changes during teaching motion`);
      assert.equal(f.api.getState().webglAvailable, true, `${label}: animation stayed valid`);
    }
  });
}

test('step controls and Listen & watch emit stable lesson/section identities without feedback loops', t => {
  const f = fixture(); t.after(() => f.api.dispose()); const module = MODULES[0], steps = [], listens = [];
  f.window.addEventListener('academy:visual-step', event => steps.push(JSON.parse(JSON.stringify(event.detail))));
  f.window.addEventListener('academy:visual-listen', event => listens.push(JSON.parse(JSON.stringify(event.detail))));
  f.api.mount(f.host, module); f.api.selectStep(2); assert.equal(steps.length, 0, 'narration selection must not emit another selection');
  f.click('[data-step="1"]'); assert.deepEqual(steps, [{ lessonId: module.id, sectionIndex: 1 }]);
  f.click('.lv-listen'); assert.deepEqual(listens, [{ lessonId: module.id, sectionIndex: 1 }]);
  f.click('.lv-ask'); assert.equal(steps.length, 1, 'asking must not restart narration before the voice controller opens the tutor');
  assert.equal(f.host.querySelector('.lv-ask').dataset.voiceSectionId, `${module.id}:section:1`);
  f.api.selectStep(0); assert.equal(f.host.querySelector('.lv-previous').disabled, true);
  f.click('.lv-previous'); assert.equal(f.api.getState().sectionIndex, 0);
  f.api.selectStep(module.sections.length - 1); assert.equal(f.host.querySelector('.lv-next').disabled, true);
  f.api.selectStep(Number.NaN); assert.equal(f.api.getState().sectionIndex, module.sections.length - 1);
  assert.doesNotThrow(() => JSON.stringify(f.api.getState()), 'voice context is serializable');
});

test('repeated narration highlights preserve the active model instead of rebuilding it', t => {
  const f = fixture(); t.after(() => f.api.dispose()); f.api.mount(f.host, MODULES[0]); f.tick(8);
  const before = signature(f.scene), allocations = f.records.geometries.size;
  f.api.selectStep(0);
  assert.equal(signature(f.scene), before, 're-selecting current section does not reset motion');
  f.tick(); assert.equal(f.records.geometries.size, allocations, 'current section does not allocate geometry again');
});

test('motion pauses explicitly, offscreen and in hidden tabs, then resumes on return', t => {
  const f = fixture(); t.after(() => f.api.dispose()); f.api.mount(f.host, MODULES[0]); f.tick(3);
  f.click('.lv-motion'); f.tick();
  const paused = signature(f.scene), count = f.records.renders;
  f.tick(30); assert.equal(signature(f.scene), paused); assert.equal(f.records.renders, count);
  assert.equal(f.frames.size, 0); assert.equal(f.api.getState().motionPlaying, false);
  f.click('.lv-motion'); f.tick(6); assert.notEqual(signature(f.scene), paused);
  f.visible(false); assert.equal(f.frames.size, 0); assert.equal(f.api.getState().motionPlaying, false);
  f.visible(true); f.tick(3); assert.equal(f.api.getState().motionPlaying, true);
  f.document.visibilityState = 'hidden'; f.document.dispatchEvent(new MockEvent('visibilitychange'));
  assert.equal(f.frames.size, 0); assert.equal(f.api.getState().motionPlaying, false);
  f.document.visibilityState = 'visible'; f.document.dispatchEvent(new MockEvent('visibilitychange'));
  f.tick(3); assert.equal(f.api.getState().motionPlaying, true);
});

test('reduced motion starts still and an explicit Listen & watch action can start motion', t => {
  const f = fixture({ reducedMotion: true }); t.after(() => f.api.dispose());
  f.api.mount(f.host, MODULES[0]); f.tick();
  assert.equal(f.api.getState().motionPlaying, false); assert.equal(f.frames.size, 0);
  const before = signature(f.scene); f.tick(10); assert.equal(signature(f.scene), before);
  f.click('.lv-listen'); f.tick(10);
  assert.equal(f.api.getState().motionPlaying, true); assert.notEqual(signature(f.scene), before);
});

test('changing lessons and disposing releases render resources, listeners, observers and animation frames', () => {
  const f = fixture(); f.api.mount(f.host, MODULES[0]); f.tick();
  f.api.selectStep(1); f.tick(); f.api.mount(f.host, MODULES[1]); f.tick();
  assert.equal(f.records.rendererDisposals, 1, 'mounting a new lesson releases the previous renderer');
  f.api.dispose(); assert.equal(f.api.getState(), null); assert.equal(f.host.children.length, 0); assert.equal(f.frames.size, 0);
  assert.equal(f.records.rendererDisposals, 2); assert.equal(f.records.contextReleases, 2);
  assert.ok(f.records.observers.every(observer => observer.disconnected));
  assert.equal(f.document.listenerCount(), 0); assert.equal(f.window.listenerCount(), 0);
  assert.ok(f.document.elements.every(element => element.listenerCount() === 0), 'detached controls and canvas release their listeners');
  for (const resource of [...f.records.geometries, ...f.records.materials]) assert.ok(f.records.disposed.has(resource), 'rendered resource was disposed');
  assert.doesNotThrow(() => f.api.dispose(), 'dispose is idempotent');
});

test('removing the lesson element also stops its animation loop', () => {
  const f = fixture(); f.api.mount(f.host, MODULES[0]); f.tick(); f.host.remove(); f.tick();
  assert.equal(f.frames.size, 0); assert.equal(f.api.getState(), null); assert.equal(f.records.rendererDisposals, 1);
});

test('all 76 sections have meaningful still diagrams and voice controls when WebGL is unavailable', t => {
  const f = fixture({ unavailable: true }); t.after(() => f.api.dispose());
  for (const module of MODULES) {
    f.api.mount(f.host, module);
    for (let index = 0; index < module.sections.length; index++) {
      f.api.selectStep(index);
      assert.equal(f.api.getState().webglAvailable, false); assert.equal(f.api.getState().motionPlaying, false);
      const svg = f.host.querySelector('.lv-fallback-diagram'); assert.ok(svg, `${module.id}/${index}: diagram exists`);
      assert.ok(svg.querySelectorAll('path').length + svg.querySelectorAll('rect').length > 0, 'fallback contains diagram geometry');
      assert.ok(svg.querySelectorAll('text').length >= 2, 'fallback has readable labels');
      assert.equal(f.host.querySelector('.lv-step-heading').textContent, module.sections[index].heading);
      assert.equal(f.host.querySelector('.lv-motion').disabled, true);
      assert.equal(f.host.querySelector('.lv-listen').disabled, false);
      assert.equal(f.host.querySelector('.lv-ask').dataset.voiceSectionId, `${module.id}:section:${index}`);
    }
    assert.equal(f.frames.size, 0); f.api.dispose();
  }
});

test('a GPU initialization failure preserves the lesson with a still diagram', t => {
  const f = fixture({ rendererFails: true }); t.after(() => f.api.dispose()); f.api.mount(f.host, MODULES[0]);
  assert.equal(f.api.getState().webglAvailable, false); assert.ok(f.host.querySelector('.lv-fallback-diagram'));
  f.click('[data-step="1"]'); assert.equal(f.api.getState().sectionIndex, 1);
  assert.equal(f.host.querySelector('.lv-watch').textContent, f.api.getState().sceneDescription);
});
