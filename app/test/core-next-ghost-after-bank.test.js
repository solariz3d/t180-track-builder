// core-next-ghost-after-bank.test.js: node --test app/test/core-next-ghost-after-bank.test.js
// D642 (pane C), his try of d641-c df62d6f, exo_memory/briefs/t180_second_bank.md 19:54Z: "for the second 180 section i cant even add extra banking back to the other way". His
// picture (t180_extra_bank_inverted_2026-11-05.png) shows, in red in the panel: "no preview of this piece: ghost: the candidate must extend the placed track (the same segments,
// then more)". Reproduced through the panel's own path: a 1,000 m piece with the bank 88.45 eased over the whole piece (the panel's default 'rounded' bank shape) ends with its
// bank still rolling (4.14e-5 rad/m), and once it is placed EVERY next piece's ghost is refused, with or without the extra turn: the next piece re-lays the placed piece's last
// 58 m (src/core/adapter.js bankPlan rounds the joint's bank corner once a next piece exists) and the preview (app/preview/trackmodel.js ghostFor) refuses a candidate that
// changes the placed track. No ghost, no handles: nothing can be added. The cause is in the core and the preview, not the panel; the fix is B's (the chair, 19:56Z).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const TB = require('../../src/core/turnby.js');
const DEG = Math.PI / 180;

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
const A = require('../../src/core/adapter.js');
let ghostMemo = null;
function realGhost(shell, panel) {
  const o = panel.options(), d = shell.getState().history.present, key = JSON.stringify(o);
  if (ghostMemo && ghostMemo.key === key && ghostMemo.d === d) return ghostMemo.g;
  let dc; try { dc = TB.extendCorner(d, o); } catch (e) { return null; }
  const samples = A.toPath(dc, { step: 2 }).path.samples.filter((m) => m.s >= 1000 - 1e-9).map((m) => ({ s: m.s, pos: [...m.pos], T: [...m.T], L: [...m.L], U: [...m.U] }));
  ghostMemo = { key, d, g: { s0: 1000, samples, segments: [], jump: false } }; return ghostMemo.g;
}
function stillPose() {
  let pose = null;
  return (shell, panel) => {
    if (pose) return pose;
    const g = realGhost(shell, panel); if (!g) return { eye: [0, 600, 500], target: [0, 0, 1500], up: [0, 1, 0], fov: Math.PI / 3 };
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const m of g.samples) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m.pos[k]); hi[k] = Math.max(hi[k], m.pos[k]); }
    const c = lo.map((x, k) => (x + hi[k]) / 2), r = Math.max(hi[0] - lo[0], hi[2] - lo[2]);
    pose = { eye: [c[0] - 0.2 * r, 0.9 * r, c[2] - 0.9 * r], target: c, up: [0, 1, 0], fov: Math.PI / 3 }; return pose;
  };
}

async function mount() {
  const { doc, win, tick } = fakeWindow();
  const stage = doc.createElement('div'); stage.setAttribute('id', 'preview'); stage.clientWidth = 1200; stage.clientHeight = 800;
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null });
  shell.extend({ length: 1000, family: 'bowl' });   // his save's p1: the placed 1,000 m straight
  const view = stillPose(); let panel = null;
  doc.addEventListener('t180:ghost-request', (e) => e.detail.reply(panel ? realGhost(shell, panel) : null)); doc.addEventListener('t180:view', (e) => e.detail.reply({ pose: panel ? view(shell, panel) : null }));
  panel = require('../core/panel.js').mount(root, shell);
  const label = (text) => root.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === text);
  const field = (text) => { const l = label(text); assert.ok(l, `no "${text}" field`); return l.children[1]; };
  const type = (text, v) => { const f = field(text); f.value = String(v); f.oninput(); tick(); };
  const extend = () => { const b = root.all().find((e) => e.tagName === 'BUTTON' && e.textContent === 'Extend'); assert.ok(b, 'the Extend button'); b.onclick(); tick(); };
  return { shell, panel, type, extend, tick };
}
const TM = require('../preview/trackmodel.js');
// the next piece's ghost, as the preview builds it: the placed track, then the candidate laid on it
const nextGhost = (p) => { const st = p.shell.getState(), tm = TM.createTrackModel(); tm.update({ segments: st.resolved.segments, closed: false, start: st.resolved.start }); try { tm.ghostFor(p.shell.candidate(p.panel.options())); return null; } catch (e) { return e.message; } };
// OFF TODO (D642, pane B, by name: the fix landed). The cause was the preview's ghost refusing a candidate that re-lays the last placed piece's built tail, as bankPlan does at a
// joint once it has two sides (app/preview/trackmodel.js ghostSteps, app/test/ghost-relaid-tail.test.js). The extra-turn case needs the extra handles (L140); on a build without
// them (0.4.39, where the no-extra case was found red) it is skipped and says why.
const HAS_EXTRA = /extraHandles/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'core', 'panel.js'), 'utf8'));

for (const [name, extraTurn] of [['his p2: a −90 corner, then the extra +180 from 500', 180], ['the same piece with no extra turn', null]]) {
  test(`D642: after his p2 (${name}; bank 88.45, cup 15.5, width 31) is placed, the next piece's ghost is built, so its handles are there to add to`, { skip: extraTurn !== null && !HAS_EXTRA ? 'this build has no extra handles (L140): the case runs where they exist' : false }, async () => {
    const p = await mount(); p.type('length m', 1000); p.type('turn °', -90); p.type('bank °', 88.45); p.type('cup °', 15.5); p.type('width m', 31);
    if (extraTurn !== null) { const xt = p.panel.extraHandles().find((x) => x.field === 'turn'); p.panel.secondExtra(xt.id, extraTurn); p.tick(); }
    p.extend(); assert.equal(p.shell.getState().history.present.pieces.length, 2, 'p2 is placed');
    assert.equal(nextGhost(p), null, 'the next piece has a ghost');
    p.panel.unmount();
  });
}
