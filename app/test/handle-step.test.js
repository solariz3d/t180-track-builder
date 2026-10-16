// handle-step.test.js: node --test app/test/handle-step.test.js
// D345 ("the scroll sounds are broken"). The drag tick (app/sound.js) is driven by 't180:handle-step', which app/core/handles.js dispatched from ONE place, the drag
// path's apply. The wheel over a handle (onWheel) changed the value without it, so a wheel notch was silent and sound.js's last value for that handle went stale: the
// next drag's first step was measured from where the value was BEFORE the scroll, and could tick where no whole number was crossed. The arrow nudge (onKeyDown) goes
// through apply, so it already sent the step (measured here, row 2). Now one helper, stepped(), sends it for all three. Rows:
//   1  a wheel notch over a handle dispatches exactly one step with the new value; a notch at a clamp (no change) dispatches none
//   2  an arrow nudge on a held handle dispatches exactly one step with the new value
//   3  through sound.js: a wheel notch that lands on a whole number gives exactly one tick, the next notch none; and a drag after a scroll that crossed a whole number
//      ticks only where IT crosses one (with the stale value it ticked again, at the drag)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ADIR = process.env.APP_DIR || path.join(__dirname, '..');
const HD = require(path.join(ADIR, 'core', 'handles.js'));
const { createSound } = require(path.join(ADIR, 'sound.js'));

const W = 900, Hh = 600;
const POSE = { eye: [0, 40, -60], target: [0, 0, 80], up: [0, 1, 0], fov: 60 * Math.PI / 180 };
const SAMPLES = Array.from({ length: 161 }, (_, i) => ({ s: i, pos: [0, 0, i], T: [0, 0, 1], L: [1, 0, 0], U: [0, 1, 0] }));
const MODEL = { samples: SAMPLES, s0: 40, s1: 200, half: () => 10 };
/** The overlay on a fake stage whose document is shared with sound.js (as the page's is), with a host that keeps each field's value as the panel's do. */
function world(start = { length: 160 }) {
  const dl = {}, stageL = {}, frames = [], steps = [], calls = [];
  const doc = { createElement: () => canvas, addEventListener: (t, f) => { (dl[t] = dl[t] || []).push(f); }, removeEventListener: (t, f) => { dl[t] = (dl[t] || []).filter((g) => g !== f); },
    dispatchEvent: (ev) => { if (ev.type === 't180:handle-step') steps.push(ev.detail); (dl[ev.type] || []).slice().forEach((f) => f(ev)); return true; } };
  const canvas = { style: {}, attrs: {}, setAttribute() {}, getContext: () => null, remove() {}, isConnected: true };
  const stage = { clientWidth: W, clientHeight: Hh, style: {}, ownerDocument: doc, getBoundingClientRect: () => ({ left: 0, top: 0 }), isConnected: true, append() {}, setPointerCapture() {},
    addEventListener(t, f) { (stageL[t] = stageL[t] || []).push(f); }, removeEventListener() {} };
  class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  const win = { devicePixelRatio: 1, CustomEvent, requestAnimationFrame: (f) => { frames.push(f); return frames.length; }, cancelAnimationFrame() {}, document: doc };
  const cur = { ...start }, kinds = Object.keys(start);
  const host = { model: () => ({ ...MODEL, kinds, base: (k) => cur[k], ctx: () => ({ half: 10 }) }), pose: () => POSE, begin: () => {}, apply: (h, v) => { cur[h.kind] = v; calls.push(v); }, end: () => {} };
  const ov = HD.mount(stage, win, host); const tick = () => frames.splice(0).forEach((g) => g(0)); tick();
  let clock = 0;
  const fire = (type, e = {}) => { clock += 1000; const ev = { type, button: 0, pointerId: 1, timeStamp: clock, preventDefault() {}, stopImmediatePropagation() {}, ...e }; (stageL[type] || []).slice().forEach((f) => f(ev)); return ev; };
  const at = (kind) => ov.handles().find((h) => h.kind === kind && h.screen).screen;
  const wheel = (kind, up = true) => { const a = at(kind); fire('wheel', { clientX: a.x, clientY: a.y, deltaY: up ? -100 : 100 }); };
  const key = (k) => (dl.keydown || []).slice().forEach((f) => f({ type: 'keydown', key: k, preventDefault() {} }));
  return { ov, cur, steps, calls, fire, tick, at, wheel, key, doc, win };
}
/** sound.js on the same document, its engine recording each tick; the audio clock moves on at every read, so no tick is held back by TICK_MS. */
function withSound(Wd) {
  const ticks = [];
  class Ctx { constructor() { this.t = 0; } get currentTime() { this.t += 1; return this.t; } }
  const store = {}, sw = { AudioContext: Ctx, localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } }, document: Wd.doc };
  const s = createSound(sw, { engineFor: () => ({ tick: (p) => ticks.push(p.midi), step() {}, loopClosed() {}, setLevel() {} }), log: () => {} });
  Wd.doc.dispatchEvent({ type: 'pointerdown' });   // the first press starts the sound
  return { s, ticks };
}

test('row 1: a wheel notch over a handle dispatches exactly one step with the new value; a notch at a clamp dispatches none', () => {
  const Wd = world({ length: 160 }); Wd.wheel('length', true);
  assert.deepEqual(Wd.steps, [{ kind: 'length', value: 160.01 }]);
  const C = world({ cup: 150 }); C.wheel('cup', true); assert.equal(C.cur.cup, 150, 'at the clamp'); assert.deepEqual(C.steps, [], 'no change, no step');
});
test('row 1b: a double-click reset (a value moved, as the wheel moves one) dispatches one step with the value it reset to', () => {
  const Wd = world({ turn: 2 }), a = Wd.at('turn');
  Wd.fire('pointerdown', { clientX: a.x, clientY: a.y, timeStamp: 5000 }); Wd.fire('pointerup', { clientX: a.x, clientY: a.y, timeStamp: 5010 });
  Wd.fire('pointerdown', { clientX: a.x, clientY: a.y, timeStamp: 5050 }); Wd.fire('pointerup', { clientX: a.x, clientY: a.y, timeStamp: 5060 });
  assert.equal(Wd.cur.turn, 0, 'the second press within the double-click time resets the turn to 0');
  assert.deepEqual(Wd.steps, [{ kind: 'turn', value: 0 }]);
});
test('row 2: an arrow nudge on a held handle dispatches exactly one step with the new value', () => {
  const Wd = world({ length: 160 }), a = Wd.at('length');
  Wd.fire('pointerdown', { clientX: a.x, clientY: a.y }); const before = Wd.steps.length;
  Wd.key('ArrowUp');
  assert.deepEqual(Wd.steps.slice(before), [{ kind: 'length', value: 160.01 }]);
  Wd.fire('pointerup', { clientX: a.x, clientY: a.y });
});
test('row 3: through sound.js, a notch landing on a whole number gives exactly one tick and the next none; a drag after a scroll ticks only where it crosses one itself', () => {
  const Wd = world({ length: 99.99 }), S = withSound(Wd);
  Wd.wheel('length', true); assert.equal(Wd.cur.length, 100); assert.equal(S.ticks.length, 1, 'onto 100: one tick');
  Wd.wheel('length', true); assert.equal(S.ticks.length, 1, 'onto 100.01: none');
  // a drag that sets sound's value at 99.5, a scroll across 100 to 100.1, then a drag from 100.1 to 100.4: only the scroll crosses a whole number
  const D = world({ length: 99.5 }), T = withSound(D); D.doc.dispatchEvent({ type: 't180:handle-step', detail: { kind: 'length', value: 99.5 } });
  for (let i = 0; i < 60; i++) D.wheel('length', true);
  assert.equal(D.cur.length, 100.1); assert.equal(T.ticks.length, 1, 'the scroll across 100: one tick, on the way');
  D.doc.dispatchEvent({ type: 't180:handle-step', detail: { kind: 'length', value: 100.4 } });   // the next drag's first step, as handles.js sends it
  assert.equal(T.ticks.length, 1, 'the drag from 100.1 to 100.4 crosses nothing: no tick (with a stale 99.5 it ticked here)');
});
