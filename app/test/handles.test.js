// handles.test.js: node --test app/test/handles.test.js   (under the heavy-run lock)
// D244, THE DRAG HANDLES (app/core/handles.js): where each handle sits on the ghost of a piece, how a pointer drag becomes a value, and the overlay that carries it. FEEL tier: targeted rows, no
// mutation harness (the 09-29 rule). The panel's wiring (a drag types into the Extend field, Sculpt on a placed piece) is in app/test/core-pieces-ui.test.js, rows 11 to 13.
//   1  placement: length, width, bank, cup, turn and climb on a ghost piece; every kind that has a side is on BOTH sides, mirrored about the centreline
//   2  the axes: a positive drag is outward for width and cup, left for turn (both sides), up on the left edge and down on the right for bank, along the road for length, up for climb
//   3  the two mirrored handles change the SAME value: the same motion of the handle, outward, gives the same field value from either side
//   4  value from drag: each kind's rate, its clamps, its rounding, Shift (a tenth of the speed) and Ctrl (snap to 5 degrees, 10 m, 5 m)
//   5  the screen: where a handle is, one metre along its axis in px, behind the camera, an axis seen end-on
//   6  hit test: the nearest handle inside the radius, none outside
//  14  D258: the free jump's landing kinds: four marks at the landing, each out along its own arrow (the take-off's heading frame), their speeds, holds, snaps and resets
//   8  D251: the speed is per PIXEL: the same drag in px gives the same value zoomed in or out
//   9  D251: the detents: a drag holds about 6 px at the value it started from and, for bank, turn and climb, at 0
//  10  D251: the value is rounded to the kind's step even with Shift, so a fine drag lands on 0.0, not 0.03
//  11  D251: a double-click on a handle resets it: 0 for bank, turn, climb; the value before the drag for length, width, cup
//  12  D251: the label shows the exact value the drag sets, and what a double-click would set
//   7  the overlay: a press ON a handle opens the drag and nothing else sees it; a press elsewhere is left alone (the brush and the camera keep their drags); at most one apply per frame; the release
//      applies the last position and ends; hover sets the cursor; Shift and Ctrl travel with the pointer
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const HD = require('../core/handles.js');
const M = require('../camera/math.js');

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);
/** A straight ghost piece: samples every 5 m from s = 0 to 200 along +z, left = +x, up = +y. The piece is s 40 to 200. */
const SAMPLES = Array.from({ length: 41 }, (_, i) => ({ s: i * 5, pos: [0, 0, i * 5], T: [0, 0, 1], L: [1, 0, 0], U: [0, 1, 0] }));
const MODEL = { samples: SAMPLES, s0: 40, s1: 200, half: () => 10, kinds: HD.ORDER };
const byId = (list) => Object.fromEntries(list.map((h) => [h.id, h]));

test('row 1: every kind is placed where it was marked, and every kind with a side is on BOTH sides, mirrored about the centreline', () => {
  const list = HD.placeHandles(MODEL), h = byId(list);
  assert.deepEqual(list.map((x) => x.kind), ['length', 'width', 'width', 'bank', 'bank', 'cup', 'cup', 'turn', 'turn', 'climb'], 'ten handles: the one-sided kinds once, the others twice');
  // CHANGED 2026-10-14: length and width moved from the near end to the FRONT of the piece (its far end, where it grows to)
  assert.deepEqual(h['length:0'].pos, [0, 0, 200], 'length: the centreline at the front (far) end');
  // CHANGED 2026-10-14 (the second move): width to the middle of the piece, bank three quarters along, turn at the front edges
  // AMENDED (D509): the rule changed by name, the user's layout of 2026-10-28: width and cup at the BACK (share 0.02, a hair in from the join: s 40 + 3.2),
  // bank and climb in the middle, length and turn at the front
  assert.deepEqual([h['width:1'].pos, h['width:-1'].pos], [[10, 0, 43.2], [-10, 0, 43.2]], 'width: both edges, at the back');
  assert.deepEqual([h['bank:1'].pos, h['bank:-1'].pos], [[10, 0, 120], [-10, 0, 120]], 'bank: both edges, mid piece');
  assert.deepEqual([h['cup:1'].pos, h['cup:-1'].pos], [[3, 0, 43.2], [-3, 0, 43.2]], 'cup: just inside the centre, both sides, at the back');
  assert.deepEqual([h['turn:1'].pos, h['turn:-1'].pos], [[10, 0, 200], [-10, 0, 200]], 'turn: both edges at the front (far) end');
  assert.deepEqual(h['climb:0'].pos, [0, 0, 120], 'climb: the centreline mid piece');   // AMENDED (D509): the middle
  for (const k of ['width', 'bank', 'cup', 'turn']) assert.equal(h[`${k}:1`].pos[0], -h[`${k}:-1`].pos[0], `${k}: mirrored`);
});
test('row 1b: the road\'s width at the handle sets how far out an edge handle sits, and an unknown or absent kind places nothing', () => {
  const narrow = byId(HD.placeHandles({ ...MODEL, half: (f) => 4 + 8 * f, kinds: ['width'] }));
  // AMENDED (D509): the rule changed by name, the user's layout of 2026-10-28: the width marks are at the back (share 0.02), where the road is 4 + 8 x 0.02 = 4.16 m out
  assert.deepEqual(narrow['width:1'].pos, [4.16, 0, 43.2], 'with no target given, at the back (share 0.02) is where the road is: 4.16 m from the centre');
  // the width mark sits at the TARGET half-width (the field's value) when one is given, so it follows the drag (it sets the width the piece ENDS at)
  const target = byId(HD.placeHandles({ ...MODEL, half: (f) => 4 + 8 * f, halfTarget: 9, kinds: ['width', 'bank'] }));
  // AMENDED (D509): width at the back, bank mid piece (share 0.5: the road 8 m out)
  assert.deepEqual([target['width:1'].pos, target['width:-1'].pos], [[9, 0, 43.2], [-9, 0, 43.2]], 'at the back, at the target width'); assert.deepEqual(target['bank:1'].pos, [8, 0, 120], 'only a target kind uses it: bank still sits at the road\'s own edge, mid piece');
  const placed = byId(HD.placeHandles({ ...MODEL, half: (f) => 4 + 8 * f, halfTarget: 9, at: { width: 1 }, kinds: ['width'] })); assert.deepEqual(placed['width:1'].pos, [9, 0, 200], 'an `at` override moves it (Sculpt keeps the width mark at the far end of the piece)');
  assert.deepEqual(byId(HD.placeHandles({ ...MODEL, half: (f) => 4 + 8 * f, at: { width: 1 }, kinds: ['width'] }))['width:1'].pos, [12, 0, 200], 'with no target, the road\'s own half-width at that share');
  assert.deepEqual(HD.placeHandles({ ...MODEL, kinds: ['nope'] }), []); assert.deepEqual(HD.placeHandles({ ...MODEL, samples: [] }), []);
});

test('row 2: a positive drag runs outward (width, cup), left on both sides (turn), up on the left edge and down on the right (bank), forward (length: its front end is pulled on), up (climb)', () => {
  const h = byId(HD.placeHandles(MODEL));
  assert.deepEqual([h['width:1'].axis, h['width:-1'].axis], [[1, 0, 0], [-1, 0, 0]], 'width: outward');
  assert.deepEqual([h['cup:1'].axis, h['cup:-1'].axis], [[1, 0, 0], [-1, 0, 0]], 'cup: outward');
  assert.deepEqual([h['turn:1'].axis, h['turn:-1'].axis], [[1, 0, 0], [1, 0, 0]], 'turn: left on both sides');
  assert.deepEqual([h['bank:1'].axis, h['bank:-1'].axis], [[0, 1, 0], [0, -1, 0]], 'bank: the left edge up, the right edge down');
  assert.deepEqual([h['length:0'].axis, h['climb:0'].axis], [[0, 0, 1], [0, 1, 0]], 'length: FORWARD, the way the road runs, is longer (the front end is pulled on); climb: up');
  for (const x of Object.values(h)) close(Math.hypot(...x.axis), 1);
});

// a camera behind and above the piece, looking along it
const POSE = { eye: [0, 60, -40], target: [0, 0, 120], up: [0, 1, 0], fov: 60 * Math.PI / 180 };
const W = 900, Hh = 600, VP = M.viewProj(POSE, W / Hh);

test('row 3: the two mirrored handles change the SAME value: the same outward motion from either side gives the same field value', () => {
  const h = byId(HD.placeHandles(MODEL));
  for (const k of ['width', 'cup']) {
    const L = HD.screenAxis(VP, W, Hh, h[`${k}:1`].pos, h[`${k}:1`].axis), R = HD.screenAxis(VP, W, Hh, h[`${k}:-1`].pos, h[`${k}:-1`].axis);
    // each handle dragged 8 px along its own on-screen outward direction: 8 px each
    const dl = HD.dragPixels(L, 8 * L.dx / L.len, 8 * L.dy / L.len, k), dr = HD.dragPixels(R, 8 * R.dx / R.len, 8 * R.dy / R.len, k);
    assert.ok(L.dx < 0 && R.dx > 0, `${k}: the left handle's outward is leftwards on screen, the right one's rightwards`);
    close(HD.targetFor(k, 30, dl, { half: 10 }), HD.targetFor(k, 30, dr, { half: 10 }), 1e-9);   // 8 px along its own outward axis is the same pixels, so the same value, from either side
    assert.ok(dl > 0 && dr > 0, `${k}: both are positive (outward)`);
  }
  // the value both give for the same pointer travel outward
  assert.equal(HD.targetFor('width', 31, 30, {}), 32.63, 'width: 30 px, less the 6 px hold, at 0.068 m each');
  // turn: dragging EITHER handle toward the left is the same positive change
  const tl = HD.screenAxis(VP, W, Hh, h['turn:1'].pos, h['turn:1'].axis), tr = HD.screenAxis(VP, W, Hh, h['turn:-1'].pos, h['turn:-1'].axis);
  assert.ok(tl.dx < 0 && tr.dx < 0, 'turn: the same screen direction (left) from both sides'); assert.ok(HD.dragPixels(tr, -10, 0, 'turn') > 0 && HD.dragPixels(tl, -10, 0, 'turn') > 0);
});

test('row 4: a value from a drag in PIXELS: the rates per pixel (today\'s speeds at the default camera; length five times), the clamps, the rounding, Shift (one step a pixel: D330) and Ctrl (snap)', () => {
  const T = HD.targetFor;
  assert.equal(T('length', 160, 100), 199.48, 'length: 0.42 m a pixel, five times today\'s 0.085'); assert.equal(T('length', 160, -1000), 1, 'length: never under 1 m'); assert.equal(T('length', 160, 20), 165.88, 'rounded to 0.01 m');
  assert.equal(T('width', 31, 100), 37.39, 'width: 0.068 m a pixel'); assert.equal(T('width', 31, -1000), 0.5, 'width: a floor');
  assert.equal(T('bank', 0, 50), 19.8, 'bank: 0.45 degrees a pixel, whatever the width of the road'); assert.equal(T('bank', 0, 50, { half: 3 }), 19.8); assert.equal(T('bank', 5, 0, { half: 15 }), 5, 'no drag, no change');
  assert.equal(T('cup', 15.5, 1000), 150, 'cup: 0 to 150, the core range'); assert.equal(T('cup', 15.5, -1000), 0);
  assert.equal(T('turn', 0, 40), 2.82, 'turn: 0.083 a pixel'); assert.equal(T('climb', 2, -10), 1.67, 'climb: 0.082 a pixel');
  assert.equal(T('length', 160, 100, {}, { shift: true }), 161, 'Shift (D330: the rule changed, it was a tenth of the speed): one pixel is one step, 0.01'); assert.equal(T('turn', 0, 100, {}, { shift: true }), 1);
  assert.equal(T('length', 163, 0, {}, { ctrl: true }), 160, 'Ctrl snaps length to 10 m'); assert.equal(T('width', 31, 0, {}, { ctrl: true }), 30, 'width to 5 m');
  assert.equal(T('bank', 0, 52, {}, { ctrl: true }), 25, 'bank to 5 degrees'); assert.equal(T('cup', 14, 0, {}, { ctrl: true }), 15); assert.equal(T('turn', 3, 0, {}, { ctrl: true }), 5);
  assert.throws(() => T('nope', 0, 0), /no kind "nope"/);
  // the rates are today's speed per metre over the px a metre takes at the default camera: length 1 m/m over 11.78, width 2 over 29.61, bank 3.70 deg/m over 8.25, cup 2 over 8.23, turn and climb 0.5 over 6.05
  const KS = HD.KINDS; for (const [k, today, px] of [['width', 2, 29.61], ['bank', (1 / 15.5) / HD.DEG, 8.25], ['cup', 2, 8.23], ['turn', 0.5, 6.045], ['climb', 0.5, 6.084]]) assert.ok(Math.abs(KS[k].perPx - today / px) / (today / px) < 0.02, `${k}: ${KS[k].perPx} is today's ${(today / px).toFixed(4)} a pixel`);
  assert.ok(Math.abs(KS.length.perPx / (1 / 11.778) - 5) < 0.1, 'length is five times today\'s');
});

test('row 5: the screen: where a handle is, one metre along its axis in px, behind the camera, an axis seen end-on', () => {
  const p = [0, 0, 120], a = HD.screenAxis(VP, W, Hh, p, [1, 0, 0]);
  close(a.x, W / 2, 1e-6); assert.ok(a.dx < 0 && Math.abs(a.dy) < 1e-6, 'a metre to the left is leftwards on screen and level'); close(a.len, Math.hypot(a.dx, a.dy), 1e-12);
  assert.equal(HD.screenAxis(VP, W, Hh, [0, 0, -100], [1, 0, 0]), null, 'behind the camera: none');
  // a vertical axis seen from straight above is end-on: the pointer's own motion stands in
  const top = M.viewProj({ eye: [0, 100, 0], target: [0, 0, 0.001], up: [0, 0, 1], fov: 1 }, 1.5), e = HD.screenAxis(top, 600, 400, [0, 0, 0], [0, 1, 0]);
  assert.ok(e.len < 0.05, `end-on: ${e.len} px per m`);
  // a FAR handle's axis is short too (the far end of a ghost seen from behind, found in the window: 0.3 px per m) but it has a direction, so a drag along it is measured on it, not read as end-on
  close(HD.dragPixels({ x: 0, y: 0, dx: 0, dy: -0.3, len: 0.3 }, 0, -6, 'length'), 6, 1e-9); close(HD.dragPixels({ x: 0, y: 0, dx: 0, dy: -0.3, len: 0.3 }, 5, 0, 'length'), 0, 1e-9);
  close(HD.dragPixels(e, 0, -40, 'climb'), 40, 1e-9); close(HD.dragPixels(e, 40, 0, 'width'), 40, 1e-9);
  close(HD.dragPixels({ x: 0, y: 0, dx: 10, dy: 0, len: 10 }, 25, 7, 'width'), 25, 1e-9); close(HD.dragPixels({ x: 0, y: 0, dx: 1, dy: 0, len: 1 }, 25, 7, 'width'), 25, 1e-9);   // the same pixels at any zoom: the axis length only gives the direction
  assert.equal(HD.cursorFor({ dx: 10, dy: 1, len: 10 }), 'ew-resize'); assert.equal(HD.cursorFor({ dx: 1, dy: 10, len: 10 }), 'ns-resize'); assert.equal(HD.cursorFor({ len: 0 }), 'move');
});

test('row 6: the hit test takes the nearest handle inside the radius, none outside, and skips a handle behind the camera', () => {
  const list = [{ id: 'a', screen: { x: 100, y: 100 } }, { id: 'b', screen: { x: 108, y: 100 } }, { id: 'c', screen: null }];
  assert.equal(HD.hitTest(list, 104, 100).id, 'a', 'a tie goes to the first'); assert.equal(HD.hitTest(list, 107, 100).id, 'b'); assert.equal(HD.hitTest(list, 200, 200), null); assert.equal(HD.hitTest(list, 100, 111.9).id, 'a'); assert.equal(HD.hitTest(list, 100, 112.1), null);
  assert.equal(HD.format('bank', 12), 'bank 12.00°'); assert.equal(HD.format('width', 31), 'width 31.00 m'); assert.equal(HD.format('turn', 0), 'turn 0.00°/100 m');
});

/** A stage and a window, just enough for the overlay: the listeners are kept to be called by the test. */
function fakeStage(ctx = null) {
  const listeners = {}, frames = [];
  const canvas = { style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getContext: () => ctx, remove() { this.gone = true; }, isConnected: true };
  const stage = { clientWidth: W, clientHeight: Hh, style: {}, ownerDocument: { createElement: () => canvas }, getBoundingClientRect: () => ({ left: 0, top: 0 }), isConnected: true, append() {}, setPointerCapture() {},
    addEventListener(t, f, cap) { (listeners[t] = listeners[t] || []).push({ f, cap: !!cap }); }, removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter((x) => x.f !== f); } };
  const win = { devicePixelRatio: 1, requestAnimationFrame: (f) => { frames.push(f); return frames.length; }, cancelAnimationFrame() {} };
  // D335: a drag's speed is read from the events' times, so the harness gives every press, move and release a time: a move or release with none comes 1 ms after the one before (a flick, the
  // speed the old per-pixel rows were written for); a row that wants a slow hand gives its own timeStamp
  let clock = 0;
  const fire = (type, e) => { if (type === 'pointerdown') clock = e && typeof e.timeStamp === 'number' ? e.timeStamp : clock + 1000; else if ((type === 'pointermove' || type === 'pointerup') && !(e && typeof e.timeStamp === 'number')) e = { ...e, timeStamp: (clock += 1) }; else if (e && typeof e.timeStamp === 'number') clock = e.timeStamp;
    const ev = { button: 0, pointerId: 1, stopped: false, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...e }; for (const { f } of (listeners[type] || []).slice()) { f(ev); if (ev.stopped) break; } return ev; };
  const tick = () => { const f = frames.splice(0); f.forEach((g) => g(0)); };
  return { stage, win, fire, tick, listeners, canvas };
}

test('row 7: the overlay: a press ON a handle opens the drag and nothing else sees it; a press elsewhere is left alone; one apply a frame; the release applies the last position and ends', () => {
  const S = fakeStage(), calls = [], host = {
    model: () => ({ ...MODEL, kinds: ['width', 'turn'], base: (k) => (k === 'width' ? 31 : 0), ctx: () => ({ half: 10 }) }), pose: () => POSE,
    begin: (h) => calls.push(['begin', h.id]), apply: (h, v, mods, final) => calls.push(['apply', h.id, v, !!mods.shift, !!mods.ctrl, !!final]), end: (h) => calls.push(['end', h.id]),
  };
  const ov = HD.mount(S.stage, S.win, host); S.tick();   // the first frame lays the handles out
  const hs = ov.handles(), left = hs.find((h) => h.id === 'width:1'); assert.equal(hs.length, 4); assert.ok(left.screen, 'on screen');
  assert.equal(S.listeners.pointerdown[0].cap, true, 'the press is taken in the capture phase, ahead of the brush and the camera');
  // a press away from every handle: not stopped, nothing opens
  const away = S.fire('pointerdown', { clientX: 5, clientY: 5 }); assert.equal(away.stopped, false); assert.equal(away.prevented, false); assert.deepEqual(calls, []);
  // hover sets the cursor
  S.fire('pointermove', { clientX: left.screen.x, clientY: left.screen.y }); assert.match(S.stage.style.cursor, /resize|move/); assert.equal(ov.hovered().id, 'width:1');
  S.fire('pointermove', { clientX: 5, clientY: 5 }); assert.equal(S.stage.style.cursor, '', 'the cursor goes back off a handle');
  // a press ON it
  const down = S.fire('pointerdown', { clientX: left.screen.x, clientY: left.screen.y }); assert.equal(down.stopped, true); assert.equal(down.prevented, true); assert.deepEqual(calls, [['begin', 'width:1']]); assert.equal(ov.dragging(), true);
  // two moves in one frame: one apply, with the LATEST position; 30 px outward on the left edge is 2 m of width
  const ax = left.screen, px = ax.dx / ax.len;
  S.fire('pointermove', { clientX: ax.x + px * 3, clientY: ax.y + (ax.dy / ax.len) * 3 }); S.fire('pointermove', { clientX: ax.x + px * 30, clientY: ax.y + (ax.dy / ax.len) * 30, shiftKey: false, ctrlKey: true });
  assert.equal(calls.length, 1, 'nothing applied until the frame'); S.tick();
  assert.deepEqual(calls[1], ['apply', 'width:1', 35, false, true, false], '30 px outward is 2 m wider, 33, which Ctrl snaps to 5 m: 35');
  // the release applies the position it carries, once more, and ends
  S.fire('pointerup', { clientX: ax.x + px * 40, clientY: ax.y + (ax.dy / ax.len) * 40 }); assert.deepEqual(calls.slice(2), [['apply', 'width:1', 33.72, false, false, true], ['end', 'width:1']]); assert.equal(ov.dragging(), false);
  // a second press while no drag is open works again; and unmount takes the listeners off
  S.fire('pointerdown', { clientX: ax.x, clientY: ax.y }); S.fire('pointercancel', {}); assert.equal(calls[calls.length - 1][0], 'end');
  ov.unmount(); assert.equal(S.canvas.gone, true); assert.equal((S.listeners.pointerdown || []).length, 0);
});

test('row 7b: no model, no pose or a refused press: no handles are drawn and a press is not taken; a right-button press is never a handle', () => {
  const S = fakeStage(); let model = null; const calls = [];
  const ov = HD.mount(S.stage, S.win, { model: () => model, pose: () => POSE, begin: () => calls.push('begin'), apply: () => {}, end: () => {} }); S.tick();
  assert.deepEqual(ov.handles(), [], 'no ghost, no handles'); assert.equal(S.fire('pointerdown', { clientX: 450, clientY: 300 }).stopped, false);
  model = { ...MODEL, kinds: ['length'], base: () => 160, ctx: () => ({}) }; S.tick(); const h = ov.handles()[0];
  assert.equal(S.fire('pointerdown', { clientX: h.screen.x, clientY: h.screen.y, button: 2 }).stopped, false, 'the right button is the camera\'s'); assert.deepEqual(calls, []);
  ov.unmount();
});

// D251: a drag rig: the overlay on a fake stage whose host keeps the fields as the panel's do (an apply sets the field, so the next press starts from it)
const FAR = { eye: [0, 600, -400], target: [0, 0, 120], up: [0, 1, 0], fov: 60 * Math.PI / 180 };
const B2 = { turn: 2, width: 31, length: 160, bank: 0 };
function rig({ pose = POSE, kinds = ['width', 'turn', 'length', 'bank'], base = { width: 31, turn: 0, length: 160, bank: 0 }, ctx = null } = {}) {
  const S = fakeStage(ctx), calls = [], cur = { ...base };
  const host = { model: () => ({ ...MODEL, kinds, base: (k) => cur[k], ctx: () => ({ half: 10 }) }), pose: () => pose,
    begin: (h) => calls.push(['begin', h.id]), apply: (h, v, mods, final) => { cur[h.kind] = v; calls.push(['apply', h.id, v, !!final]); }, end: (h) => calls.push(['end', h.id]) };
  const ov = HD.mount(S.stage, S.win, host); S.tick();
  const at = (id) => ov.handles().find((x) => x.id === id).screen, last = () => calls.filter((c) => c[0] === 'apply').pop();
  const along = (id, px) => { const a = at(id), u = [a.dx / a.len, a.dy / a.len]; return { a, x: a.x + u[0] * px, y: a.y + u[1] * px }; };
  /** press on the handle, move px pixels along its on-screen axis (Shift or Ctrl if asked), release; returns the value the field was left at */
  const drag = (id, px, mods = {}) => {
    const { a, x, y } = along(id, px), e = { clientX: x, clientY: y, shiftKey: !!mods.shift, ctrlKey: !!mods.ctrl };
    S.fire('pointerdown', { clientX: a.x, clientY: a.y }); S.fire('pointermove', e); S.tick(); S.fire('pointerup', e); S.tick();
    return cur[ov.handles().find((h) => h.id === id).kind];
  };
  return { S, ov, calls, cur, at, last, along, drag };
}

test('row 8: the speed is per PIXEL: 20 px of drag changes a field by the same amount zoomed in and zoomed out', () => {
  const out = {};
  for (const [name, pose] of [['near', POSE], ['far', FAR]]) {
    const R = rig({ pose }), len = R.at('turn:1'); assert.ok(len, 'on screen');
    out[name] = { turn: R.drag('turn:1', 20), width: R.drag('width:1', 20), length: R.drag('length:0', 20), screen: Math.hypot(len.dx, len.dy) };
  }
  assert.ok(out.near.screen > 2 * out.far.screen, `control: the far camera really is zoomed out (${out.near.screen.toFixed(2)} px a metre against ${out.far.screen.toFixed(2)})`);
  assert.deepEqual([out.near.turn, out.near.width, out.near.length], [1.66, 32.36, 168.4], '20 px, no hold (D335): turn 0.083 a pixel, width 0.068 m a pixel, length 0.42 m a pixel');
  assert.deepEqual([out.far.turn, out.far.width, out.far.length], [1.66, 32.36, 168.4], 'the same when zoomed out');
});

// AMENDED D335 (plan :555-583, 2026-10-16): the rule changed. A drag through the overlay holds nothing any more: the 6 px holds at the start and at 0 were dead travel, and a slow scrub is
// 0.01 a pixel exactly (the ask: pinpoint precise). The holds stay in targetFor for a caller that asks (ctx.hold not false); Ctrl still snaps. So the numbers are the new rule's.
test('row 9 (D335, amended): no detents in a drag: it moves from the first pixel and goes through 0 without a hold; Ctrl snaps', () => {
  assert.equal(rig({ base: B2 }).drag('turn:1', -33), -0.74, '33 px down from 2 at 0.083 a pixel: straight through 0 to -0.74');
  assert.equal(rig({ base: B2 }).drag('turn:1', -3), 1.75, 'a 3 px move is 0.25: nothing held');
  assert.equal(rig({ base: B2 }).drag('turn:1', -8), 1.34);
  assert.equal(rig().drag('length:0', 5), 162.1, 'length: 5 px is 2.1 m'); assert.equal(rig().drag('length:0', 20), 168.4);
  const bank5 = { ...B2, turn: 0, bank: 5 };
  assert.equal(rig({ base: bank5 }).drag('bank:1', -20), -4, 'bank: 20 px from 5 at 0.45 a pixel: -4, no hold at 0'); assert.equal(rig({ base: bank5 }).drag('bank:1', -30), -8.5);
  assert.equal(rig({ base: B2 }).drag('turn:1', -20, { ctrl: true }), 0, 'Ctrl snaps to 5: 0.34 snaps to 0'); assert.equal(rig({ base: B2 }).drag('turn:1', 40, { ctrl: true }), 5, 'Ctrl: 5.3 snaps to 5');
  assert.equal(HD.DETENT_PX, 6, 'targetFor still holds 6 px for a caller that does not say hold: false');
});

// D330: the rule changed (Shift was a tenth of the speed with the 6 px hold; it is one pixel = one step, no hold), so the numbers are the new rule's; what the row is for stands: a fine drag lands ON the step
test('row 10: the value is rounded to the step with Shift too: a precise drag lands on the hundredth, never on a fraction of one', () => {
  const v0 = rig({ base: B2 }).drag('turn:1', -200, { shift: true }); assert.ok(Object.is(v0, 0), `a precise drag of 200 px from 2.00 is exactly 0, not ${v0}`);
  assert.equal(rig({ base: B2 }).drag('turn:1', -103.7, { shift: true }), 0.96, 'Shift: a pixel is a step, 103.7 px is 1.037: 0.96 to the hundredth, not 0.963');
  assert.equal(HD.targetFor('turn', 0, 5, {}, { shift: true }), 0.05, 'a precise drag of 5 px is 0.05: no hold');
  assert.equal(HD.targetFor('turn', 2, -60, {}, { shift: true }), 1.4, '60 px precise is 0.6: 1.4'); assert.equal(HD.targetFor('width', 31, 77, {}, { shift: true }), 31.77, 'width: 77 px precise is 0.77 m: 31.77');
});

test('row 11: a double-click on a handle resets it: 0 for bank, turn, climb; the value before the last drag for length, width, cup; and it is the handle\'s, not the camera\'s', () => {
  const R = rig({ base: { turn: 2, width: 31, length: 160, bank: 7.5 } });
  const t = R.at('turn:1'), onTurn = R.S.fire('dblclick', { clientX: t.x, clientY: t.y }); assert.equal(onTurn.stopped, true, 'taken by the handle'); assert.deepEqual(R.calls, [['begin', 'turn:1'], ['apply', 'turn:1', 0, true], ['end', 'turn:1']], 'one step: turn goes to 0'); assert.ok(Object.is(R.cur.turn, 0));
  R.calls.length = 0; const b = R.at('bank:1'); R.S.fire('dblclick', { clientX: b.x, clientY: b.y }); assert.equal(R.cur.bank, 0, 'bank to 0');
  R.calls.length = 0; assert.equal(R.drag('length:0', 40), 176.8); const l = R.at('length:0'); R.S.fire('dblclick', { clientX: l.x, clientY: l.y }); assert.equal(R.cur.length, 160, 'length back to the value before the drag');
  R.calls.length = 0; R.S.fire('dblclick', { clientX: l.x, clientY: l.y }); assert.deepEqual(R.calls, [], 'already there: nothing happens');
  assert.equal(R.drag('width:1', 20), 32.36); assert.equal(R.drag('width:1', 20), 33.72); const w = R.at('width:1'); R.S.fire('dblclick', { clientX: w.x, clientY: w.y }); assert.equal(R.cur.width, 32.36, 'back to before the last drag');
  R.cur.width = 40; R.calls.length = 0; R.S.fire('dblclick', { clientX: w.x, clientY: w.y }); assert.deepEqual(R.calls, [], 'a value typed since is the user\'s: no stale "before" is put back');
  const away = R.S.fire('dblclick', { clientX: 5, clientY: 5 }); assert.equal(away.stopped, false); assert.equal(away.prevented, false);
});

test('row 12: the label shows the exact value the drag sets, and what a double-click would set', () => {
  const texts = [], ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? (x) => ({ width: x.length * 7 }) : k === 'fillText' ? (x) => { texts.push(x); } : (t[k] === undefined ? () => {} : t[k])), set: (t, k, v) => { t[k] = v; return true; } });
  const R = rig({ ctx, base: B2 }), t = R.at('turn:1');
  R.S.fire('pointermove', { clientX: t.x, clientY: t.y }); R.S.tick(); assert.equal(texts[texts.length - 1], 'turn 2.00°/100 m · double-click: 0', 'hovering: the value it has and what a double-click sets');
  const { x, y } = R.along('turn:1', -33); R.S.fire('pointerdown', { clientX: t.x, clientY: t.y }); R.S.fire('pointermove', { clientX: x, clientY: y }); R.S.tick(); R.S.tick();
  assert.equal(R.last()[2], -0.74); assert.equal(texts[texts.length - 1], 'turn -0.74°/100 m', 'dragging: exactly what is set');
  R.S.fire('pointerup', { clientX: x, clientY: y }); R.drag('length:0', 40); const l = R.at('length:0'); texts.length = 0; R.S.fire('pointermove', { clientX: l.x, clientY: l.y }); R.S.tick(); assert.equal(texts[texts.length - 1], 'length 176.80 m · double-click: 160.00', 'length: a double-click would put back 160');
});

// D270 (reported: a window said "tauri.localhost to show your cursor press ESC" on the first click of the points on the track): NO POINTER LOCK. Chromium draws that
// notice itself whenever a page locks the pointer and nothing in WebView2 or Tauri turns it off, so a grab holds the pointer with setPointerCapture, hides the cursor, and gives it back at the handle on release.
// A stage that spies on requestPointerLock and a document that lists its listeners; win.__TAURI__ is the native window (setCursorPosition), present or not.
function grabRig(native = 'ok') {   // native: 'ok' | 'none' | 'throw' | 'reject'
  const S = fakeStage(), doc = S.stage.ownerDocument, dl = {}; let locks = 0, exits = 0;
  doc.addEventListener = (t, f) => { (dl[t] = dl[t] || []).push(f); }; doc.removeEventListener = (t, f) => { dl[t] = (dl[t] || []).filter((g) => g !== f); };
  doc.exitPointerLock = () => { exits++; };
  S.stage.requestPointerLock = () => { locks++; };
  const warps = [], caps = [], cursors = []; S.stage.setPointerCapture = (id) => caps.push(id);
  let shown = ''; Object.defineProperty(S.stage.style, 'cursor', { get: () => shown, set: (v) => { shown = v; cursors.push(v); } });
  if (native !== 'none') S.win.__TAURI__ = { dpi: { LogicalPosition: class { constructor(x, y) { this.x = x; this.y = y; } } }, window: { getCurrentWindow: () => ({ setCursorPosition: (p) => { warps.push([p.x, p.y]); if (native === 'throw') throw new Error('denied'); return native === 'reject' ? Promise.reject(new Error('denied')) : Promise.resolve(); } }) } };
  const calls = [], cur = { turn: 2, width: 31, length: 160, bank: 0 };
  const host = { model: () => ({ ...MODEL, kinds: ['width', 'turn', 'length', 'bank'], base: (k) => cur[k], ctx: () => ({ half: 10 }) }), pose: () => POSE,
    begin: (h) => calls.push(['begin', h.id]), apply: (h, v, mods, final) => { cur[h.kind] = v; calls.push(['apply', h.id, v, !!final]); }, end: (h) => calls.push(['end', h.id]) };
  const ov = HD.mount(S.stage, S.win, host); S.tick();
  return { S, ov, doc, calls, cur, locks: () => locks, exits: () => exits, warps, caps, cursors, listeners: dl, key: (k) => (dl.keydown || []).slice().forEach((f) => f({ type: 'keydown', key: k })), at: (id) => ov.handles().find((x) => x.id === id).screen };
}

test('row 13: no pointer lock (D270): a grab never asks for one and registers no lock listener, so Chromium has no notice to show; the pointer is captured, the cursor is hidden for the drag and the value follows the pointer past the stage at the same pixel speed', () => {
  const R = grabRig(), t = R.at('turn:1'), u = [t.dx / t.len, t.dy / t.len];
  R.S.fire('pointerdown', { clientX: t.x, clientY: t.y, pointerId: 7 });
  assert.equal(R.locks(), 0, 'requestPointerLock is not called'); assert.deepEqual(R.caps, [7], 'the pointer is captured instead'); assert.equal(R.S.stage.style.cursor, 'none', 'the cursor is hidden during the drag');
  assert.equal((R.listeners.pointerlockchange || []).length + (R.listeners.pointerlockerror || []).length, 0, 'no lock listeners');
  // 16 steps of 50 px along the arrow's opposite: 800 px, past the 900 x 600 stage (a captured pointer keeps reporting its position outside it)
  // (2026-10-14: the drag now puts the hidden cursor back at the grab as it goes, so the pointer here moves as a real one does: by steps from where it is, and to the grab
  // when the window puts it there; the travel is the same 800 px)
  let total = 0, pos = [t.x, t.y], seen = 0;
  for (let i = 0; i < 16; i++) {
    total -= 50; pos = [pos[0] - u[0] * 50, pos[1] - u[1] * 50]; R.S.fire('pointermove', { clientX: pos[0], clientY: pos[1] });
    while (seen < R.warps.length) { pos = R.warps[seen++]; R.S.fire('pointermove', { clientX: pos[0], clientY: pos[1] }); }
  }
  R.S.tick(); const last = R.calls.filter((c) => c[0] === 'apply').pop();
  assert.equal(last[2], HD.targetFor('turn', 2, total, { hold: false }, {}), 'the same value the D251 rate gives for that travel'); assert.ok(last[2] > -90 && last[2] < 2, `control: not clamped (${last[2]})`);
  R.S.fire('pointerup', { clientX: pos[0], clientY: pos[1] });
  assert.equal(R.locks(), 0); assert.equal(R.exits(), 0, 'and nothing to unlock'); assert.equal(R.S.stage.style.cursor, '', 'release gives the cursor back'); assert.deepEqual(R.calls.slice(-2).map((c) => c[0]), ['apply', 'end']);
  assert.ok(R.warps.length >= 2 && R.warps.every((w) => w[0] === t.x && w[1] === t.y), 'the cursor is put back at the handle that was grabbed, during the drag and on release: ' + JSON.stringify(R.warps));
});

test('row 13b: the cursor goes back at the handle through the native window when there is one; with none (a browser, a test host) or a refusal the release still ends cleanly', () => {
  for (const native of ['none', 'throw', 'reject']) {
    const R = grabRig(native), t = R.at('turn:1'), u = [t.dx / t.len, t.dy / t.len];
    R.S.fire('pointerdown', { clientX: t.x, clientY: t.y }); R.S.fire('pointermove', { clientX: t.x + u[0] * -33, clientY: t.y + u[1] * -33 }); R.S.tick();
    assert.equal(R.calls.filter((c) => c[0] === 'apply').pop()[2], -0.74, `${native}: 33 px from 2 at 0.083 a pixel, no hold`);
    R.S.fire('pointerup', { clientX: t.x + u[0] * -33, clientY: t.y + u[1] * -33 }); assert.equal(R.ov.dragging(), false, `${native}: the drag ended`); assert.equal(R.S.stage.style.cursor, '', `${native}: the cursor is back`); assert.equal(R.cur.turn, -0.74);
    assert.equal(R.warps.length, native === 'none' ? 0 : 1, `${native}: the native move was tried once, or not at all`);
  }
});

test('row 13c: Esc ends the drag where it is, as a release does, and gives the cursor back; Esc with no drag, or another key, does nothing; unmount takes the key listener off', () => {
  const R = grabRig(), t = R.at('turn:1'), u = [t.dx / t.len, t.dy / t.len];
  R.key('Escape'); assert.deepEqual(R.calls, [], 'Esc with no drag does nothing');
  R.S.fire('pointerdown', { clientX: t.x, clientY: t.y }); R.S.fire('pointermove', { clientX: t.x + u[0] * -100, clientY: t.y + u[1] * -100 }); R.S.tick();
  R.key('a'); assert.equal(R.ov.dragging(), true, 'another key leaves it');
  R.key('Escape');
  assert.equal(R.ov.dragging(), false, 'the drag ended'); assert.deepEqual(R.calls.slice(-2).map((c) => c[0]), ['apply', 'end']); assert.equal(R.cur.turn, HD.targetFor('turn', 2, -100, { hold: false }, {}), 'at the value it had reached'); assert.equal(R.S.stage.style.cursor, '', 'the cursor is back'); assert.deepEqual(R.warps, [[t.x, t.y]]);
  R.S.fire('pointerup', { clientX: t.x, clientY: t.y }); assert.equal(R.calls.filter((c) => c[0] === 'end').length, 1, 'the button coming up afterwards ends nothing twice');
  // a later press works again; unmount while dragging gives the cursor back and the key listener up
  R.S.fire('pointerdown', { clientX: t.x, clientY: t.y, timeStamp: 5000 }); assert.equal(R.S.stage.style.cursor, 'none'); R.ov.unmount(); assert.equal(R.S.stage.style.cursor, '', 'unmount gives the cursor back'); assert.equal((R.listeners.keydown || []).length, 0, 'and takes the key listener off');
});

test('row 11b: the double-click is two presses within 400 ms on one handle that changed nothing (no dblclick need come); a drag between them, or a pause, is not one', () => {
  const press = (R, id, ts, dx = 0) => { const a = R.at(id); R.S.fire('pointerdown', { clientX: a.x, clientY: a.y, timeStamp: ts }); R.S.fire('pointerup', { clientX: a.x + dx, clientY: a.y, timeStamp: ts + 40 }); };
  let R = grabRig(); press(R, 'turn:1', 1000); assert.equal(R.cur.turn, 2, 'one click changes nothing'); press(R, 'turn:1', 1200); assert.ok(Object.is(R.cur.turn, 0), 'the second press, 160 ms after the first release, resets turn to 0'); assert.equal(R.S.stage.style.cursor, '', 'the reset left the cursor shown');
  R = grabRig(); press(R, 'turn:1', 1000); press(R, 'turn:1', 1600); assert.equal(R.cur.turn, 2, 'a pause longer than 400 ms is two single clicks');
  R = grabRig(); const a = R.at('length:0'), u = [a.dx / a.len, a.dy / a.len]; R.S.fire('pointerdown', { clientX: a.x, clientY: a.y, timeStamp: 1000 }); R.S.fire('pointermove', { clientX: a.x + u[0] * 40, clientY: a.y + u[1] * 40 }); R.S.tick(); R.S.fire('pointerup', { clientX: a.x + u[0] * 40, clientY: a.y + u[1] * 40, timeStamp: 1100 });
  assert.equal(R.cur.length, 176.8); press(R, 'length:0', 1200); assert.equal(R.cur.length, 176.8, 'a press right after a DRAG is not a double-click'); press(R, 'length:0', 1300); assert.equal(R.cur.length, 160, 'but a click and a click after it is: back to before the drag');
});

test('row 14: the landing\'s kinds (D258): four free marks at the landing, each out along its own arrow, the arrows ARE the take-off\'s heading frame; their speeds, holds, snaps, resets and labels', () => {
  const free = { pos: [10, 2, 100], T0: [0, 0, 1], L0: [1, 0, 0], U0: [0, 1, 0], T1: [0.6, 0, 0.8], L1: [0.8, 0, -0.6] };
  const list = HD.placeHandles({ ...MODEL, kinds: HD.LANDING_ORDER, free }), h = byId(list);
  assert.deepEqual(list.map((x) => x.id), ['landfwd:0', 'landleft:0', 'landup:0', 'landturn:0'], 'one mark each, in order');
  assert.deepEqual([h['landfwd:0'].pos, h['landfwd:0'].axis], [[10, 2, 110], [0, 0, 1]], 'forward: 10 m ahead of the landing, its arrow along the take-off\'s heading');
  assert.deepEqual([h['landleft:0'].pos, h['landleft:0'].axis], [[18, 2, 100], [1, 0, 0]], 'sideways: 8 m to the left, its arrow to the left'); assert.deepEqual([h['landup:0'].pos, h['landup:0'].axis], [[10, 8, 100], [0, 1, 0]], 'height: 6 m up, its arrow up');
  assert.deepEqual(h['landturn:0'].axis, [0.8, 0, -0.6], 'heading: along the landing\'s own left'); close(h['landturn:0'].pos[0], 19, 1e-12); close(h['landturn:0'].pos[2], 112, 1e-12); close(h['landturn:0'].pos[1], 2, 1e-12);
  assert.equal(new Set(list.map((x) => x.pos.join())).size, 4, 'no two marks on one point: they can be picked apart');
  assert.deepEqual(HD.placeHandles({ ...MODEL, kinds: HD.LANDING_ORDER }), [], 'no landing frame, no marks'); assert.deepEqual(HD.placeHandles({ ...MODEL, kinds: HD.LANDING_ORDER, free: { pos: [0, 0, 0] } }), [], 'a frame without its axes places nothing');
  const T = HD.targetFor; assert.equal(T('landfwd', 40, 100), 54.1, 'forward: 0.15 m a pixel past the 6 px hold'); assert.equal(T('landleft', 0, 100), 9.4, 'sideways: 0.1 m'); assert.equal(T('landup', 0, 100), 4.7, 'height: 0.05 m'); assert.equal(T('landturn', 0, 100), 9.4, 'heading: 0.1 degree');
  assert.equal(T('landup', 0, 200, {}, { shift: true }), 2, 'Shift (D330: one pixel a step): 200 px is 2.00 m'); assert.equal(T('landfwd', 40, 33, {}, { ctrl: true }), 45, 'Ctrl snaps forward to 5 m'); assert.equal(T('landleft', 3.2, 0, {}, { ctrl: true }), 3, 'sideways to 1 m'); assert.equal(T('landturn', 0, 52, {}, { ctrl: true }), 5, 'heading to 5 degrees');
  assert.equal(T('landfwd', 40, 3), 40, 'forward holds its start'); assert.equal(T('landleft', 8, -70), 1.6, 'sideways moves'); assert.equal(T('landleft', 8, -88), 0, 'and holds at 0: 6 px held at 8, 80 to reach 0, 2 into the 6 px (0.6 m) hold there'); assert.ok(Object.is(T('landup', 0.2, 0), 0.2) && Object.is(T('landturn', -1, 18), 0), 'height holds its start; heading holds at 0');
  assert.equal(T('landfwd', 40, 1e6), 2000); assert.equal(T('landturn', 0, -1e6), -180); assert.equal(T('landup', 0, -1e6), -500);
  assert.equal(HD.resetValue('landleft', 12), 0); assert.equal(HD.resetValue('landup', null), 0); assert.equal(HD.resetValue('landturn', 5), 0); assert.equal(HD.resetValue('landfwd', 55), 55, 'forward goes back to before its drag'); assert.equal(HD.resetValue('landfwd', null), null, 'or nowhere');
  assert.equal(HD.format('landfwd', 40), 'forward 40.00 m'); assert.equal(HD.format('landleft', -8), 'sideways -8.00 m'); assert.equal(HD.format('landup', 3.5), 'height 3.50 m'); assert.equal(HD.format('landturn', 10), 'heading 10.00°');
});

// 2026-10-14, reported: a turn could not go past 90 degrees unless Turn by 90 was chosen first, and the camera orientation changed which way a piece had to be
// dragged, which should be the same from every view. The turn handle has no clamp (Turn by and
// Turn to grid are the exact-angle tools), and it reads the pointer's own left and right on screen: a drag to the right is a right turn from any view.
test('the turn handle is not clamped: a long drag goes past 90°/100 m either way', () => {
  assert.equal(HD.targetFor('turn', 0, 5000), 414.5, '5000 px, less the 6 px hold, at 0.083 a pixel'); assert.equal(HD.targetFor('turn', 0, -5000), -414.5);
});
test('the turn handle: a drag to the right is a right turn and to the left a left turn, whichever way the left of the road lies on screen', () => {
  const view = (pose) => { const vp = M.viewProj(pose, W / Hh), h = byId(HD.placeHandles(MODEL)); return ['turn:1', 'turn:-1'].map((id) => HD.screenAxis(vp, W, Hh, h[id].pos, h[id].axis)); };
  const behind = view(POSE), ahead = view({ eye: [0, 60, 260], target: [0, 0, 60], up: [0, 1, 0], fov: 60 * Math.PI / 180 });
  assert.ok(behind[0].dx < 0 && ahead[0].dx > 0, 'the left of the road is screen-left from behind and screen-right from ahead');
  for (const ax of [...behind, ...ahead, null]) {
    assert.ok(HD.dragPixels(ax, 10, 0, 'turn') < 0, 'a drag to the right turns right (negative: + is left)');
    assert.ok(HD.dragPixels(ax, -10, 0, 'turn') > 0, 'a drag to the left turns left');
    assert.equal(HD.dragPixels(ax, 0, 25, 'turn'), 0, 'up and down move nothing');
  }
});

// 2026-10-14, reported: on a 1000 m straight, a turn added by dragging jumped from 0 straight to 0.5 (the 6 px hold times 0.083 a pixel), which on a long piece is
// 5 degrees of heading at once. The hold is now DEAD TRAVEL: leaving it continues from the held value, so the drag walks 0.1, 0.2, ... with nothing skipped.
test('leaving a hold walks on a pixel at a time: no jump off the hold, for every kind', () => {
  for (const kind of ['turn', 'climb', 'bank', 'cup', 'width', 'length']) {
    const K = HD.KINDS[kind], base = K.zero ? 0 : 50, seen = [];
    for (let px = 0; px <= HD.DETENT_PX + 40; px += 0.25) seen.push(HD.targetFor(kind, base, px));
    const steps = seen.slice(1).map((v, i) => v - seen[i]).filter((d) => d !== 0), most = 0.25 * K.perPx + 0.01 + 1e-9;
    assert.ok(steps.length > 3, `${kind}: control, the drag moved`);
    assert.ok(steps.every((d) => d > 0 && d <= most), `${kind}: every change is at most a quarter-pixel's worth (${most.toFixed(3)}): ${Math.max(...steps)}`);
    const first = seen.find((v) => v !== base);
    assert.ok(first - base <= most, `${kind}: the first value off the hold is one small step from ${base}, not a jump: ${first}`);
  }
});

// 2026-10-14, reported: zoomed out, a long length drag stopped at about 400 to 600 m, "it just doesnt let you make it bigger in one go". The cursor is hidden while a
// handle is dragged, and it ran into the edge of the SCREEN unseen: 0.42 m a pixel over a screen's 1,000 to 1,400 px. The drag now puts the hidden cursor back where it
// was grabbed whenever it has gone WARP_PX from it (the native window's setCursorPosition, as on release) and keeps the travel, so a drag never runs out of screen.
test('a long drag never runs out of screen: the hidden cursor is put back at the grab and the travel adds up', () => {
  const R = grabRig(), l = R.at('length:0'), u = [l.dx / l.len, l.dy / l.len], W = 900, H = 600;
  let pos = [l.x, l.y], seen = 0;
  const onScreen = (p) => [Math.max(0, Math.min(W - 1, p[0])), Math.max(0, Math.min(H - 1, p[1]))];
  R.S.fire('pointerdown', { clientX: pos[0], clientY: pos[1] });
  for (let k = 0; k < 250; k++) {                                   // 1,000 px of mouse travel, 4 px a move, along the handle's own axis
    pos = onScreen([pos[0] + u[0] * 4, pos[1] + u[1] * 4]);
    R.S.fire('pointermove', { clientX: pos[0], clientY: pos[1] }); R.S.tick();
    while (seen < R.warps.length) { pos = R.warps[seen++]; R.S.fire('pointermove', { clientX: pos[0], clientY: pos[1] }); R.S.tick(); }   // the OS moves the cursor
  }
  assert.ok(R.warps.length >= 2, `control: the cursor was put back during the drag (${R.warps.length} times)`);
  R.S.fire('pointerup', { clientX: pos[0], clientY: pos[1] }); R.S.tick();
  assert.equal(R.cur.length, Math.round((160 + 1000 * 0.42) * 100) / 100, '1,000 px forward, no hold, 0.42 m a pixel');
});

test('a drag with no native window (a browser) behaves as before: the cursor is never moved, the value follows the pointer', () => {
  const R = grabRig('none'), l = R.at('length:0'), u = [l.dx / l.len, l.dy / l.len];
  R.S.fire('pointerdown', { clientX: l.x, clientY: l.y });
  R.S.fire('pointermove', { clientX: l.x + u[0] * 300, clientY: l.y + u[1] * 300 }); R.S.tick();
  R.S.fire('pointerup', { clientX: l.x + u[0] * 300, clientY: l.y + u[1] * 300 }); R.S.tick();
  assert.deepEqual(R.warps, []); assert.equal(R.cur.length, Math.round((160 + 300 * 0.42) * 100) / 100);
});

test('if the window refuses to move the cursor, the drag gives the travel back and follows the pointer as before (nothing counted twice)', () => {
  for (const native of ['throw']) {
    const R = grabRig(native), l = R.at('length:0'), u = [l.dx / l.len, l.dy / l.len];
    R.S.fire('pointerdown', { clientX: l.x, clientY: l.y });
    for (let k = 1; k <= 75; k++) { R.S.fire('pointermove', { clientX: l.x + u[0] * 4 * k, clientY: l.y + u[1] * 4 * k }); R.S.tick(); }
    R.S.fire('pointerup', { clientX: l.x + u[0] * 300, clientY: l.y + u[1] * 300 }); R.S.tick();
    assert.equal(R.cur.length, Math.round((160 + 300 * 0.42) * 100) / 100, `${native}: 300 px, no hold, 0.42 m a pixel, counted once`);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// D330 (2026-10-15, reported: "when scrubbing a turn from say a 1000m straight, it jumps to 0.08 instead of 0.01, and isnt a completely precise scrub or scroll. I need every one to be").
// Every handle's step is 0.01 but a pixel of drag moved perPx (turn 0.083, climb 0.082, bank 0.45, length 0.42 ...): about 8 steps a pixel, so no drag could land on every 0.01, and Shift
// (a tenth, 0.0083 a pixel for turn) did not either. PRECISE (one constant, the gesture): while it is held one pixel is exactly one step, with no hold, for every kind; the wheel over a
// handle and the arrow keys while one is held move exactly one step.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------
const ALL_KINDS = [...HD.ORDER, ...HD.LANDING_ORDER];

test('D330 precise: the gesture is one constant, and with it one pixel of drag is exactly one step (0.01) for every handle kind, both ways, none skipped, no hold', () => {
  assert.equal(HD.PRECISE_MOD, 'shift', 'the gesture is one constant (it may be changed)');
  const mods = { [HD.PRECISE_MOD]: true }, bad = [];
  for (const kind of ALL_KINDS) {
    const K = HD.KINDS[kind]; assert.equal(K.step, 0.01, kind + ': the step is 0.01');
    for (const dir of [1, -1]) {
      let prev = HD.targetFor(kind, 5, 0, {}, mods);
      if (prev !== 5) bad.push(kind + ': no drag changed the value: ' + prev);
      for (let n = 1; n <= 300; n++) {
        const v = HD.targetFor(kind, 5, dir * n, {}, mods), want = Math.round((5 + dir * n * 0.01) * 100) / 100;
        if (v !== want) { bad.push(kind + ' ' + dir * n + ' px: ' + v + ', wanted ' + want); break; }
        if (Math.abs(Math.abs(v - prev) - 0.01) > 1e-9) { bad.push(kind + ' ' + dir * n + ' px: a step of ' + (v - prev)); break; }
        prev = v;
      }
    }
  }
  assert.deepEqual(bad, []);
  // the reported case: turn from a 1000 m straight (a turn of 0), through 0 and out the other side, and from a value that is not on a round number
  const T = HD.targetFor; assert.equal(T('turn', 0, 37, {}, mods), 0.37); assert.equal(T('turn', 0, -37, {}, mods), -0.37); assert.equal(T('turn', 0.05, -10, {}, mods), -0.05, 'through 0, no hold there'); assert.equal(T('turn', 1.23, 5, {}, mods), 1.28);
  assert.equal(T('turn', 0, 1, {}, mods), 0.01, 'one pixel, one step, not the 0.08 of the coarse drag'); assert.equal(T('turn', 0, 1), 0, 'control: the coarse drag still holds its first 6 px');
  assert.equal(T('length', 160, 100, {}, { ctrl: true, [HD.PRECISE_MOD]: true }), 160, 'Ctrl keeps its snap');
});

test('D330 precise through the overlay: a Shift drag of n px along the handle changes turn, width, length and bank by exactly n x 0.01', () => {
  for (const n of [1, 7, 37, 150]) {
    const R = rig(); assert.equal(R.drag('turn:1', n, { shift: true }), n / 100, 'turn ' + n);
    assert.equal(rig().drag('width:1', n, { shift: true }), Math.round((31 + n * 0.01) * 100) / 100, 'width ' + n);
    assert.equal(rig().drag('length:0', n, { shift: true }), Math.round((160 + n * 0.01) * 100) / 100, 'length ' + n);
    assert.equal(rig().drag('bank:1', n, { shift: true }), Math.round(n) / 100, 'bank ' + n);
  }
});

/** every handle kind on one stage, each with a current value of 5, as the panel's fields hold them */
function allKindsRig() {
  const free = { pos: [10, 2, 100], T0: [0, 0, 1], L0: [1, 0, 0], U0: [0, 1, 0], T1: [0.6, 0, 0.8], L1: [0.8, 0, -0.6] }, cur = {}; for (const k of ALL_KINDS) cur[k] = 5;
  const S = fakeStage(), calls = [], doc = S.stage.ownerDocument, dl = {}; doc.addEventListener = (t, f) => { (dl[t] = dl[t] || []).push(f); }; doc.removeEventListener = (t, f) => { dl[t] = (dl[t] || []).filter((g) => g !== f); };
  const host = { model: () => ({ ...MODEL, kinds: ALL_KINDS, free, base: (k) => cur[k], ctx: () => ({ half: 10 }) }), pose: () => POSE,
    begin: (h) => calls.push(['begin', h.id]), apply: (h, v, mods, final) => { cur[h.kind] = v; calls.push(['apply', h.id, v, !!final]); }, end: (h) => calls.push(['end', h.id]) };
  const ov = HD.mount(S.stage, S.win, host); S.tick();
  return { S, ov, calls, cur, key: (k) => (dl.keydown || []).slice().forEach((g) => g({ type: 'keydown', key: k })) };
}

test('D330 wheel: one notch over a handle is exactly one step (0.01) on every handle kind, up adds and down subtracts; over nothing the camera has it; at a clamp it stays', () => {
  const R = allKindsRig(), hit = new Set();
  for (const h of R.ov.handles()) {
    if (!h.screen) continue;
    const want = HD.hitTest(R.ov.handles(), h.screen.x, h.screen.y); if (want.id !== h.id) continue;   // two marks on one point: the nearer one is the one that is hit
    for (const [deltaY, d] of [[-100, 0.01], [100, -0.01]]) {
      const before = R.cur[h.kind]; R.calls.length = 0;
      const ev = R.S.fire('wheel', { clientX: h.screen.x, clientY: h.screen.y, deltaY });
      assert.equal(ev.stopped, true, h.id + ': the handle takes the wheel from the camera'); assert.equal(ev.prevented, true);
      assert.deepEqual(R.calls, [['begin', h.id], ['apply', h.id, Math.round((before + d) * 100) / 100, true], ['end', h.id]], h.id + ' ' + deltaY);
    }
    hit.add(h.kind);
  }
  assert.deepEqual([...hit].sort(), [...ALL_KINDS].sort(), 'control: every kind of handle was reached');
  const away = R.S.fire('wheel', { clientX: 3, clientY: 3, deltaY: -100 }); assert.equal(away.stopped, false, 'a wheel over nothing is the camera\'s'); assert.equal(away.prevented, false);
  const cup = R.ov.handles().find((h) => h.kind === 'cup' && HD.hitTest(R.ov.handles(), h.screen.x, h.screen.y).id === h.id); R.cur.cup = 150; R.calls.length = 0; R.S.fire('wheel', { clientX: cup.screen.x, clientY: cup.screen.y, deltaY: -100 }); assert.deepEqual(R.calls, [], 'cup is at its 150 limit: no step, no undo step');
  R.ov.unmount(); assert.equal((R.S.listeners.wheel || []).length, 0, 'unmount takes the wheel listener off');
});

test('D330 arrows: while a handle is held each arrow press is exactly one step on top of the drag; with nothing held they do nothing and are not taken', () => {
  const R = grabRig('none'), t = R.at('turn:1'), pressed = [];
  const key = (k) => { const ev = { type: 'keydown', key: k, prevented: false, preventDefault() { this.prevented = true; } }; (R.listeners.keydown || []).slice().forEach((f) => f(ev)); pressed.push(ev); return ev; };
  R.calls.length = 0; const idle = key('ArrowUp'); assert.deepEqual(R.calls, [], 'nothing held: nothing'); assert.equal(idle.prevented, false, 'and the key is not taken');
  R.S.fire('pointerdown', { clientX: t.x, clientY: t.y }); R.calls.length = 0;
  const last = () => R.calls.filter((c) => c[0] === 'apply').pop()[2];
  key('ArrowUp'); assert.equal(last(), 2.01); key('ArrowRight'); assert.equal(last(), 2.02); key('ArrowDown'); assert.equal(last(), 2.01); key('ArrowLeft'); assert.equal(last(), 2.00);
  assert.ok(pressed.slice(1).every((e) => e.prevented), 'held: the arrows are the handle\'s, not the page\'s');
  key('ArrowUp'); key('ArrowUp'); key('ArrowUp'); assert.equal(last(), 2.03, 'three presses, three steps');
  R.S.fire('pointerup', { clientX: t.x, clientY: t.y }); R.S.tick(); assert.equal(R.cur.turn, 2.03, 'the release keeps what the arrows set');
  assert.equal(key('Enter').prevented, false);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// D330 (2026-10-15, reported: "sometimes my mouse move gets interrupted by something and ruins the smooth flow making the track longer, i have to let go of click, and click the drag again").
// A long drag puts the hidden cursor back at the grab every WARP_PX and keeps the travel in acc. The old rule: moves were ignored until an event showed the cursor within 2 px of the grab; if
// none did within WARP_WAIT_MS the travel was given back and the drag stopped warping for good (then it stalls at the screen edge). Two ways to lose it, tested here with a hand and an OS:
//   late: the window thread is busy, the warp is applied late and the events before it arrive late (the hypothesis)   fast: the hand is already 4 px away when the first event after the warp is seen
// ---------------------------------------------------------------------------------------------------------------------------------------------------------
/** a long length drag: the hand moves step px along the handle's axis an event; the page's warp is applied lag events later (the cursor then jumps to the grab); late ms pass before those
 *  events are seen; lead px of hand motion come before the first event after the warp. Returns { R, hand, warps } */
function longDrag({ lag = 0, late = 0, lead = 0, step = 4, steps = 250, lost = false } = {}) {
  const R = grabRig(), l = R.at('length:0'), u = [l.dx / l.len, l.dy / l.len], real = Date.now; let clock = 1e6; Date.now = () => clock;
  const scr = (p) => [Math.max(0, Math.min(899, p[0])), Math.max(0, Math.min(599, p[1]))];
  try {
    let hand = 0, offset = 0, seen = 0, cycles = 0, worst = 0;
    const at = (extra = 0) => scr([l.x + u[0] * (hand + extra - offset), l.y + u[1] * (hand + extra - offset)]);
    const send = () => { const p = at(); R.S.fire('pointermove', { clientX: p[0], clientY: p[1] }); R.S.tick(); if (hand > HD.DETENT_PX) worst = Math.max(worst, Math.abs(R.cur.length - lengthFor(hand))); };   // worst: the field's largest distance from where the hand's travel puts it, on the way
    R.S.fire('pointerdown', { clientX: l.x, clientY: l.y });
    for (let k = 0; k < steps; k++) {
      hand += step; clock += 16; send();
      while (seen < R.warps.length) {
        cycles++; clock += late;                                            // the thread was busy: the events that follow are seen late
        if (lost) { const base = R.warps.length; for (let i = 0; i < 80 && R.warps.length === base; i++) { hand += step; clock += 16; send(); } }   // the OS lost the first ask: only an ask made again gets through
        for (let i = 0; i < lag; i++) { hand += step; clock += 16; send(); }   // the cursor is still on the old track
        offset = hand; hand += lead; clock += 16; send(); seen = R.warps.length;   // the OS applies the warp (asks made while it was pending are the same one): the cursor is at the grab, lead px of hand motion on
      }
    }
    const p = at(); R.S.fire('pointerup', { clientX: p[0], clientY: p[1] }); R.S.tick();
    return { R, hand, warps: R.warps.length, cycles, worst };
  } finally { Date.now = real; }
}
const lengthFor = (hand) => Math.round((160 + hand * HD.KINDS.length.perPx) * 100) / 100;

test('a long drag: with the cursor put back promptly and the next event at the grab, the travel adds up (the control the two below depart from)', () => {
  const r = longDrag(); assert.ok(r.warps >= 4, 'control: warped ' + r.warps + ' times'); assert.equal(r.R.cur.length, lengthFor(r.hand));
});

test('a long drag whose warp is applied LATE (a busy window thread: the events before it arrive after WARP_WAIT_MS) keeps its travel and keeps warping', () => {
  const r = longDrag({ lag: 3, late: HD.WARP_WAIT_MS + 100 });
  assert.ok(r.warps >= 4, 'one late return must not switch warping off for the whole grab: warped ' + r.warps + ' times');
  assert.equal(r.R.cur.length, lengthFor(r.hand), 'the travel is all there: no jump back at the return, none of the moves in the gap lost');
  assert.ok(r.worst < 1, 'and the field follows the hand all the way, no jump forward while the return is awaited: it was ' + r.worst.toFixed(2) + ' m off at worst');
});

test('a long drag with a FAST hand (the first event after a warp is already 4 px from the grab) does not stall: the return is seen, not waited for', () => {
  const r = longDrag({ lead: 4 });
  assert.ok(r.warps >= 4, 'warped ' + r.warps + ' times'); assert.equal(r.R.cur.length, lengthFor(r.hand));
  assert.ok(r.worst < 1, 'the field follows the hand: ' + r.worst.toFixed(2) + ' m off at worst');
  const q = longDrag({ lead: 12, lag: 2, late: HD.WARP_WAIT_MS + 50 }); assert.equal(q.R.cur.length, lengthFor(q.hand), 'fast and late together');
});

test('a warp the OS lost is asked for again after WARP_WAIT_MS, and the travel adds up', () => {
  const r = longDrag({ lost: true }); assert.ok(r.cycles >= 4, 'control: ' + r.cycles + ' warps'); assert.ok(r.warps >= 2 * r.cycles, 'each warp was asked for again: ' + r.warps + ' asks for ' + r.cycles + ' warps');
  assert.equal(r.R.cur.length, lengthFor(r.hand)); assert.ok(r.worst < 1, 'on the way: ' + r.worst.toFixed(2) + ' m off at worst');
});

test('a window that refuses to move the cursor is tried WARP_MISSES times, never forever, and the travel is counted once', () => {
  const R = grabRig('throw'), l = R.at('length:0'), u = [l.dx / l.len, l.dy / l.len];
  R.S.fire('pointerdown', { clientX: l.x, clientY: l.y });
  for (let k = 1; k <= 200; k++) { R.S.fire('pointermove', { clientX: Math.min(899, l.x + u[0] * 4 * k), clientY: Math.min(599, l.y + u[1] * 4 * k) }); R.S.tick(); }
  assert.equal(R.warps.length, HD.WARP_MISSES, 'the native move was tried ' + R.warps.length + ' times');
  assert.ok(HD.WARP_MISSES >= 2, 'one refusal is not the end of warping');
});

// ── D335 (plan :555-583): the speed of the hand sets the rate, with no key. Slow is exact (one pixel is the kind's step, 0.01), a flick is the kind's own perPx a pixel, and between the two the rate is
// eased as a pointer's acceleration is; Shift is always 0.01; the wheel and the arrows stay one step (their rows are above). The speed is read from the events' own times (a window of 60 ms).
/** Press on the handle and move it `n` steps of `step` px along its axis, `dt` ms apart (each step its own event and frame), release; returns the value the field was left at. */
function steady(R, id, n, step, dt, mods = {}) {
  const a = R.at(id), u = [a.dx / a.len, a.dy / a.len]; let t = 10000;
  R.S.fire('pointerdown', { clientX: a.x, clientY: a.y, timeStamp: t });
  let x = a.x, y = a.y;
  for (let i = 0; i < n; i++) { x += u[0] * step; y += u[1] * step; R.S.fire('pointermove', { clientX: x, clientY: y, timeStamp: (t += dt), shiftKey: !!mods.shift, ctrlKey: !!mods.ctrl }); R.S.tick(); }
  R.S.fire('pointerup', { clientX: x, clientY: y, timeStamp: t + dt, shiftKey: !!mods.shift, ctrlKey: !!mods.ctrl });
  return R.cur[HD.KINDS[id.split(':')[0]] ? id.split(':')[0] : id];
}
test('row 17 (D335): the gain: the kind\'s step over perPx at or below the slow speed, exactly 1 at or above the fast one, eased and never falling between', () => {
  for (const kind of ['length', 'width', 'bank', 'cup', 'turn', 'climb', 'turnDeg', 'climbDeg', 'landfwd', 'landleft', 'landup', 'landturn']) {
    const K = HD.KINDS[kind], lo = K.step / K.perPx;
    assert.ok(Math.abs(HD.scrubGain(kind, 0) - lo) < 1e-12, `${kind}: stopped is ${lo}`); assert.ok(Math.abs(HD.scrubGain(kind, HD.SPEED_SLOW) - lo) < 1e-12, `${kind}: at the slow speed`);
    assert.equal(HD.scrubGain(kind, HD.SPEED_FAST), 1, `${kind}: at the fast speed`); assert.equal(HD.scrubGain(kind, 50), 1, `${kind}: faster stays 1`);
    let prev = 0; for (let v = 0; v <= HD.SPEED_FAST * 1.2; v += 0.01) { const g = HD.scrubGain(kind, v); assert.ok(g >= prev - 1e-12 && g <= 1 + 1e-12, `${kind}: ${v} gives ${g}`); prev = g; }
    const mid = HD.scrubGain(kind, (HD.SPEED_SLOW + HD.SPEED_FAST) / 2); assert.ok(mid > lo + 1e-3 && mid < 1 - 1e-3, `${kind}: halfway is eased (${mid})`);
  }
});
test('row 17b (D335): a SLOW drag of n pixels is n x 0.01 for every kind, whatever its own perPx, with no key', () => {
  for (const [id, base] of [['length:0', 160], ['width:1', 31], ['bank:1', 0], ['turn:1', 0]]) {
    const R = rig({ base: { ...B2, turn: 0 } }), v = steady(R, id, 50, 1, 25), kind = id.split(':')[0];
    assert.equal(v, Math.round((base + 50 * 0.01) * 100) / 100, `${kind}: 50 px at 0.04 px a ms is 0.5 of ${HD.KINDS[kind].unit}`);
  }
  const R = rig({ base: { ...B2, turn: 0 } }); assert.equal(steady(R, 'turn:1', 37, 1, 30), 0.37, 'the case that was reported: 37 px of a turn is 0.37, not 3.07 (0.083 a pixel)');
});
test('row 17c (D335): a FLICK covers the old range in the old distance: 100 px in a few events is the kind\'s own perPx a pixel', () => {
  for (const [id, base, per] of [['length:0', 160, 0.42], ['width:1', 31, 0.068], ['bank:1', 0, 0.45]]) {
    const R = rig({ base: { ...B2, turn: 0 } }), v = steady(R, id, 10, 10, 1), kind = id.split(':')[0];
    assert.equal(v, Math.round((base + 100 * per) * 100) / 100, `${kind}: 100 px at 10 px a ms`);
  }
});
test('row 17d (D335): the rate eases with the hand: a medium drag is between the slow and the flick, and a faster hand never covers less', () => {
  const at = (dt) => steady(rig({ base: { ...B2, turn: 0 } }), 'bank:1', 100, 1, dt), slow = at(40), mid = at(3), mid2 = at(2), fast = at(1);
  assert.equal(slow, 1, '100 px slow is 1 degree'); assert.ok(mid > slow && mid < fast, `3 ms a pixel is between: ${slow} < ${mid} < ${fast}`); assert.ok(mid2 >= mid && fast >= mid2, 'and never less for a faster hand');
});
test('row 17e (D335): Shift is always 0.01 a pixel, however fast the hand', () => {
  const R = rig({ base: { ...B2, turn: 0 } }); assert.equal(steady(R, 'bank:1', 10, 10, 1, { shift: true }), 1, '100 px in 10 ms with Shift is 1 degree'); assert.equal(steady(rig({ base: { ...B2, turn: 0 } }), 'bank:1', 100, 1, 40, { shift: true }), 1, 'and slow with Shift the same');
});
test('row 17f (D335): a bank drag of 400 px at the flick rate lands on 180.00 exactly', () => {
  assert.equal(steady(rig({ base: { ...B2, turn: 0 } }), 'bank:1', 40, 10, 1), 180);
});
test('row 17g (D335): the speed is the hand\'s over a short window, so one quick event inside a slow scrub does not jump the rate', () => {
  const R = rig({ base: { ...B2, turn: 0 } }), a = R.at('bank:1'), u = [a.dx / a.len, a.dy / a.len]; let t = 10000, x = a.x, y = a.y;
  const move = (dt) => { x += u[0]; y += u[1]; R.S.fire('pointermove', { clientX: x, clientY: y, timeStamp: (t += dt) }); R.S.tick(); };
  R.S.fire('pointerdown', { clientX: a.x, clientY: a.y, timeStamp: t });
  for (let i = 0; i < 50; i++) { move(i === 25 ? 1 : 40); }   // 50 px, one of them 1 ms after the one before
  R.S.fire('pointerup', { clientX: x, clientY: y, timeStamp: t + 40 });
  assert.ok(Math.abs(R.cur.bank - 0.5) < 0.05, `50 px of a slow scrub with one quick pixel is about 0.5 degree (it is ${R.cur.bank})`);
});

// D519 Part 2 (O's design §3, §4): the zone grab's glyph, and the dot rows
const ZG = require('../core/zonegrab.js');
test('row 18 (D519): one row a zone: the hover glyph\'s kind and its mark at the hit\'s u (a pair, cup or width, at its own place)', () => {
  const FLAT = { family: 'bowl' }, CUP = { family: 'bowl', cup: true }, EDGE = { family: 'bowl', edge: true, s: 0.64 };
  const cases = [[0.1, FLAT, 'brush-grab', [[1, 0, 100]]], [-0.5, FLAT, 'brush-twist', [[-5, 0, 100]]], [0.5, CUP, 'brush-cup', [[3, 0, 100], [-3, 0, 100]]], [0.7, EDGE, 'brush-edge', [[7, 0, 100]]], [-0.95, FLAT, 'brush-width', [[10, 0, 100], [-10, 0, 100]]]];
  for (const [u, P, kind, at] of cases) {
    const z = ZG.zoneAt(u, P), g = ZG.glyphOf(z, u);
    assert.equal(g.kind, kind, `${z.zone} at u ${u}`);
    const list = HD.placeHandles({ samples: SAMPLES, s0: 0, s1: 0, half: () => 0, kinds: [g.kind], brush: { samples: SAMPLES, s: 100, half: 10, ...g.place } });
    assert.deepEqual(list.map((h) => h.pos.map((v) => +v.toFixed(9) || 0)), at, `${kind}: the mark at u ${u}`); assert.ok(list.every((h) => h.brush), 'never hit');
  }
});
const DOTS = (rows) => ({ stations: Array.from({ length: 33 }, (_, i) => 40 + i * 5), run: { s0: 40, s1: 200 }, radius: 60, rows, at: (s, u) => ({ pos: [u * 10, 0, s], U: [0, 1, 0], L: [u < 0 ? -1 : 1, 0, 0] }) });
const ROWS3 = [{ u: 0, colour: '#ffffff' }, { u: 1, colour: '#ff5a5a' }, { u: -1, colour: '#ff5a5a' }], ROWS5 = ROWS3.concat([{ u: 0.5, colour: '#3ddc6e' }, { u: -0.5, colour: '#3ddc6e' }]);
test('row 18b (D519): the dots stand at the thinned stations, one in each row (three, or five on a cup piece), on the road\'s own surface', () => {
  for (const rows of [ROWS3, ROWS5]) {
    const dots = HD.placeDots(DOTS(rows), VP, W, Hh), at = [...new Set(dots.map((d) => d.s))];
    const project = (s) => { const q = HD.screenOf(VP, W, Hh, [0, 0, s]); return q ? [q.x, q.y] : null; };
    assert.deepEqual(at, ZG.dotStations(DOTS(rows).stations, { s0: 40, s1: 200 }, project, { radius: 60, minM: HD.DOT_MIN_M, minPx: HD.DOT_MIN_PX, cap: HD.DOT_CAP }));
    assert.ok(at.length >= 2 && at.slice(1).every((s, i) => s - at[i] >= 100), `at least 100 m apart (${at})`); assert.equal(dots.length, at.length * rows.length, `${rows.length} rows`);
    for (const d of dots) { assert.deepEqual(d.pos, [d.u * 10, 0, d.s]); assert.equal(d.dot, true); assert.ok(d.screen && Number.isFinite(d.axes.U[1])); }
  }
});
test('row 18c (D519): a press within 12 px of a dot is left to the zone grab (no handle takes it) and dotAt names the dot; farther, none', () => {
  const S = fakeStage(), calls = [];
  const ov = HD.mount(S.stage, S.win, { model: () => ({ ...MODEL, kinds: ['width'], base: () => 31, ctx: () => ({ half: 10 }), dots: DOTS(ROWS3) }), pose: () => POSE, begin: () => calls.push('begin'), apply: () => {}, end: () => {} });
  S.tick();
  const d = ov.dots().find((h) => h.u === 0); assert.ok(d, 'the dots are drawn'); assert.ok(ov.handles().every((h) => !h.dot), 'and listed apart from the handles');
  const ev = S.fire('pointerdown', { clientX: d.screen.x + 11, clientY: d.screen.y }); assert.equal(ev.stopped, false, 'the overlay does not take a press on a dot'); assert.deepEqual(calls, []);
  assert.deepEqual(ov.dotAt(d.screen.x + 11, d.screen.y), { s: d.s, u: 0, side: 1, axes: d.axes }, 'within 12 px: the dot, its station and its share across');
  assert.equal(ov.dotAt(d.screen.x + 13, d.screen.y), null, 'farther: no dot');
  assert.equal(HD.hitTest(ov.dots(), d.screen.x, d.screen.y), null, 'a dot is never a handle\'s hit');
  ov.unmount();
});
