// undo-ghost-panel.test.js: node --test app/test/undo-ghost-panel.test.js
// The user, 2026-11-25 01:33: "you should see the ghost of the piece you undo every time you undo". Through the panel and the preview's own track model:
//   P1  an undo puts the removed road up as the preview's ghost (a 't180-ghost' event) and the preview's model ACCEPTS it as an extension of the placed road
//   P2  its readout box shows the removed piece's own length, not the next piece's
//   P3  a redo clears it; typing in a field hands the picture back to the next piece's ghost
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const TM = require('../preview/trackmodel.js');
class El {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.attrs = {}; this.style = {}; this._text = ''; this.listeners = {}; this.value = ''; this.checked = false; this.parent = null; }
  append(...k) { for (const c of k) { if (c == null) continue; const n = typeof c === 'string' ? Object.assign(new El('#text', this.ownerDocument), { _text: c }) : c; n.parent = this; this.children.push(n); } }
  replaceChildren(...k) { for (const c of this.children) c.parent = null; this.children = []; this.append(...k); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.ownerDocument.ids[v] = this; }
  getAttribute(k) { return this.attrs[k]; }
  set textContent(t) { this._text = String(t); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  addEventListener(e, f, o) { (this.listeners[e] = this.listeners[e] || []).push({ f, capture: !!(o === true || (o && o.capture)) }); }
  removeEventListener(e, f) { this.listeners[e] = (this.listeners[e] || []).filter((x) => x.f !== f); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth || 0, height: this.clientHeight || 0 }; }
  get isConnected() { return true; }
  setPointerCapture() {}
  all() { return [this, ...this.children.flatMap((c) => (c.all ? c.all() : []))]; }
  fire(type, init) { let stopped = false; const ev = { type, ...init, preventDefault() {}, stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = true; } };
    const ls = (this.listeners[type] || []).slice(), order = ls.filter((l) => l.capture).concat(ls.filter((l) => !l.capture));
    let n = 0; for (const l of order) { if (stopped) break; n++; l.f(ev); } return n; }
}
function fakeWindow() {
  const doc = { ids: {}, listeners: {}, createElement: (t) => new El(t, doc) };
  doc.getElementById = (id) => doc.ids[id] || null;
  doc.addEventListener = (e, f) => { (doc.listeners[e] = doc.listeners[e] || []).push(f); };
  doc.removeEventListener = (e, f) => { doc.listeners[e] = (doc.listeners[e] || []).filter((x) => x !== f); };
  doc.dispatchEvent = (ev) => { for (const f of (doc.listeners[ev.type] || []).slice()) f(ev); return true; };
  const frames = [];
  const win = { CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }, Option: class { constructor(t, v) { this.textContent = t; this.value = v; } },
    requestAnimationFrame: (f) => { frames.push(f); return frames.length; }, cancelAnimationFrame: () => {}, setTimeout: () => 0, clearTimeout: () => {} };
  doc.defaultView = win;
  return { doc, win, tick: () => { for (let i = 0; i < 3; i++) { const fs = frames.splice(0); for (const f of fs) f(0); } } };
}

async function mount() {
  const { doc, tick } = fakeWindow();
  const events = []; for (const k of ['t180-ghost', 't180-ghost-clear']) doc.addEventListener(k, (e) => events.push({ type: k, detail: e.detail }));
  doc.addEventListener('t180:ghost-request', (e) => e.detail.reply(null)); doc.addEventListener('t180:view', (e) => e.detail.reply({ pose: null }));
  const stage = doc.createElement('div'); stage.setAttribute('id', 'preview'); stage.clientWidth = 1200; stage.clientHeight = 800;
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null });
  shell.extend({ length: 300, family: 'bowl' }); shell.extend({ length: 220, targets: { kh: 1 / 500 } }); shell.extend({ length: 170 });
  const panel = require('../core/panel.js').mount(root, shell);
  const label = (text) => root.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === text);
  const type = (text, v) => { const l = label(text); assert.ok(l, `no "${text}" field`); const f = l.children[1]; f.value = String(v); f.oninput(); tick(); };
  return { shell, panel, events, type, tick, root };
}
const last = (p) => p.events[p.events.length - 1];

test('P1: undo puts the removed road up as the ghost, and the preview model accepts it', async () => {
  const p = await mount(); p.events.length = 0;
  p.shell.undo(); p.tick();
  const g = p.events.filter((e) => e.type === 't180-ghost').pop();
  assert.ok(g, 'a ghost event after the undo');
  assert.equal(g.detail.candidate, p.shell.getState().undoGhost.candidate);
  const st = p.shell.getState(), tm = TM.createTrackModel(); tm.update({ segments: st.resolved.segments, closed: false, start: st.resolved.start });
  assert.doesNotThrow(() => tm.ghostFor(g.detail.candidate), 'the preview draws it as an extension of the placed road');
});

test('P2: the readout shows the removed piece (170 m), not the next one', async () => {
  const p = await mount(); p.type('length m', 100);
  p.shell.undo(); p.tick();
  const cell = p.root.all().find((e) => e.attrs && e.attrs['data-readout'] === 'length'), text = cell.textContent;
  assert.match(text, /170/, 'the removed piece\'s length is in the readout');
});

test('P3: a redo clears the ghost; typing hands the picture back to the next piece', async () => {
  const p = await mount();
  p.type('length m', 100); p.shell.undo(); p.tick(); const undone = p.shell.getState().undoGhost; p.events.length = 0;
  p.shell.redo(); p.tick();
  const un = p.events.filter((e) => e.type === 't180-ghost' && e.detail.candidate === undone.candidate).length;
  assert.ok(p.events.some((e) => e.type === 't180-ghost-clear'), 'redo clears the picture');
  assert.equal(un, 0, 'and sends no undo ghost again');
  p.shell.undo(); p.tick(); p.events.length = 0;
  p.type('length m', 90);
  const g = last(p);
  assert.equal(g.type, 't180-ghost');
  assert.notEqual(g.detail.candidate, p.shell.getState().undoGhost.candidate, 'the next piece\'s ghost, not the undone one');
});
