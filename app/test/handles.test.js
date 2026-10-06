// handles.test.js: node --test app/test/handles.test.js   (under the heavy-run lock)
// D244, THE DRAG HANDLES (app/core/handles.js): where each handle sits on the ghost of a piece, how a pointer drag becomes a value, and the overlay that carries it. FEEL tier: targeted rows, no
// mutation harness (the keeper's 09-29 rule). The panel's wiring (a drag types into the Extend field, Sculpt on a placed piece) is in app/test/core-pieces-ui.test.js, rows 11 to 13.
//   1  placement: length, width, bank, cup, turn and climb on a ghost piece; every kind that has a side is on BOTH sides, mirrored about the centreline
//   2  the axes: a positive drag is outward for width and cup, left for turn (both sides), up on the left edge and down on the right for bank, along the road for length, up for climb
//   3  the two mirrored handles change the SAME value: the same motion of the handle, outward, gives the same field value from either side
//   4  value from drag: each kind's rate, its clamps, its rounding, Shift (a tenth of the speed) and Ctrl (snap to 5 degrees, 10 m, 5 m)
//   5  the screen: where a handle is, one metre along its axis in px, behind the camera, an axis seen end-on
//   6  hit test: the nearest handle inside the radius, none outside
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

test('row 1: every kind is placed where the keeper marked it, and every kind with a side is on BOTH sides, mirrored about the centreline', () => {
  const list = HD.placeHandles(MODEL), h = byId(list);
  assert.deepEqual(list.map((x) => x.kind), ['length', 'width', 'width', 'bank', 'bank', 'cup', 'cup', 'turn', 'turn', 'climb'], 'ten handles: the one-sided kinds once, the others twice');
  assert.deepEqual(h['length:0'].pos, [0, 0, 40], 'length: the centreline at the NEAR end (the keeper\'s picture, D250 item 3)');
  assert.deepEqual([h['width:1'].pos, h['width:-1'].pos], [[10, 0, 40], [-10, 0, 40]], 'width: both edges at the NEAR end');
  assert.deepEqual([h['bank:1'].pos, h['bank:-1'].pos], [[10, 0, 120], [-10, 0, 120]], 'bank: both edges, mid piece');
  assert.deepEqual([h['cup:1'].pos, h['cup:-1'].pos], [[3, 0, 120], [-3, 0, 120]], 'cup: just inside the centre, both sides, mid piece');
  assert.deepEqual([h['turn:1'].pos, h['turn:-1'].pos], [[10, 0, 160], [-10, 0, 160]], 'turn: both edges three quarters along');
  assert.deepEqual(h['climb:0'].pos, [0, 0, 160], 'climb: the centreline three quarters along');
  for (const k of ['width', 'bank', 'cup', 'turn']) assert.equal(h[`${k}:1`].pos[0], -h[`${k}:-1`].pos[0], `${k}: mirrored`);
});
test('row 1b: the road\'s width at the handle sets how far out an edge handle sits, and an unknown or absent kind places nothing', () => {
  const narrow = byId(HD.placeHandles({ ...MODEL, half: (f) => 4 + 8 * f, kinds: ['width'] }));
  assert.deepEqual(narrow['width:1'].pos, [4, 0, 40], 'with no target given, the near end (share 0) is where the road is: 4 m from the centre');
  // the width mark sits at the TARGET half-width (the field's value) when one is given, so it follows the drag from the near end; Sculpt moves it back along the piece
  const target = byId(HD.placeHandles({ ...MODEL, half: (f) => 4 + 8 * f, halfTarget: 9, kinds: ['width', 'bank'] }));
  assert.deepEqual([target['width:1'].pos, target['width:-1'].pos], [[9, 0, 40], [-9, 0, 40]], 'the near end, at the target width'); assert.deepEqual(target['bank:1'].pos, [8, 0, 120], 'only a target kind uses it: bank still sits at the road\'s own edge, mid piece');
  const placed = byId(HD.placeHandles({ ...MODEL, half: (f) => 4 + 8 * f, halfTarget: 9, at: { width: 1 }, kinds: ['width'] })); assert.deepEqual(placed['width:1'].pos, [9, 0, 200], 'an `at` override moves it (Sculpt keeps the width mark at the far end of the piece)');
  assert.deepEqual(byId(HD.placeHandles({ ...MODEL, half: (f) => 4 + 8 * f, at: { width: 1 }, kinds: ['width'] }))['width:1'].pos, [12, 0, 200], 'with no target, the road\'s own half-width at that share');
  assert.deepEqual(HD.placeHandles({ ...MODEL, kinds: ['nope'] }), []); assert.deepEqual(HD.placeHandles({ ...MODEL, samples: [] }), []);
});

test('row 2: a positive drag runs outward (width, cup), left on both sides (turn), up on the left edge and down on the right (bank), away from the piece (length: its near end stays put), up (climb)', () => {
  const h = byId(HD.placeHandles(MODEL));
  assert.deepEqual([h['width:1'].axis, h['width:-1'].axis], [[1, 0, 0], [-1, 0, 0]], 'width: outward');
  assert.deepEqual([h['cup:1'].axis, h['cup:-1'].axis], [[1, 0, 0], [-1, 0, 0]], 'cup: outward');
  assert.deepEqual([h['turn:1'].axis, h['turn:-1'].axis], [[1, 0, 0], [1, 0, 0]], 'turn: left on both sides');
  assert.deepEqual([h['bank:1'].axis, h['bank:-1'].axis], [[0, 1, 0], [0, -1, 0]], 'bank: the left edge up, the right edge down');
  assert.deepEqual([h['length:0'].axis, h['climb:0'].axis], [[0, 0, -1], [0, 1, 0]], 'length: AWAY from the piece (back toward the camera) is longer, since the near end stays put; climb: up');
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
  assert.equal(HD.targetFor('width', 31, 30, {}), 34, 'width: 30 px at a tenth of a metre each');
  // turn: dragging EITHER handle toward the left is the same positive change
  const tl = HD.screenAxis(VP, W, Hh, h['turn:1'].pos, h['turn:1'].axis), tr = HD.screenAxis(VP, W, Hh, h['turn:-1'].pos, h['turn:-1'].axis);
  assert.ok(tl.dx < 0 && tr.dx < 0, 'turn: the same screen direction (left) from both sides'); assert.ok(HD.dragPixels(tr, -10, 0, 'turn') > 0 && HD.dragPixels(tl, -10, 0, 'turn') > 0);
});

test('row 4: a value from a drag in PIXELS: the rates per pixel, the clamps, the rounding, Shift (a tenth) and Ctrl (snap)', () => {
  const T = HD.targetFor;
  assert.equal(T('length', 160, 40), 180, 'length: half a metre a pixel'); assert.equal(T('length', 160, -500), 1, 'length: never under 1 m'); assert.equal(T('length', 160, 9.2), 164.6, 'rounded to 0.1 m');
  assert.equal(T('width', 31, 100), 41, 'width: a tenth of a metre a pixel'); assert.equal(T('width', 31, -1000), 0.5, 'width: a floor');
  assert.equal(T('bank', 0, 50), 10, 'bank: a fifth of a degree a pixel, whatever the width of the road'); assert.equal(T('bank', 0, 50, { half: 3 }), 10); assert.equal(T('bank', 5, 0, { half: 15 }), 5, 'no drag, no change');
  assert.equal(T('cup', 15.5, 1000), 150, 'cup: 0 to 150, the core range'); assert.equal(T('cup', 15.5, -1000), 0);
  assert.equal(T('turn', 0, 40), 2, 'turn: a twentieth of a degree per 100 m a pixel'); assert.equal(T('climb', 2, -20), 1);
  assert.equal(T('length', 160, 40, {}, { shift: true }), 162, 'Shift: a tenth of the speed'); assert.equal(T('turn', 0, 40, {}, { shift: true }), 0.2);
  assert.equal(T('length', 163, 0, {}, { ctrl: true }), 160, 'Ctrl snaps length to 10 m'); assert.equal(T('width', 31, 0, {}, { ctrl: true }), 30, 'width to 5 m');
  assert.equal(T('bank', 0, 52, {}, { ctrl: true }), 10, 'bank to 5 degrees'); assert.equal(T('cup', 14, 0, {}, { ctrl: true }), 15); assert.equal(T('turn', 3, 0, {}, { ctrl: true }), 5);
  assert.throws(() => T('nope', 0, 0), /no kind "nope"/);
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
  assert.equal(HD.format('bank', 12), 'bank 12.0°'); assert.equal(HD.format('width', 31), 'width 31.0 m'); assert.equal(HD.format('turn', 0), 'turn 0.0°/100 m');
});

/** A stage and a window, just enough for the overlay: the listeners are kept to be called by the test. */
function fakeStage(ctx = null) {
  const listeners = {}, frames = [];
  const canvas = { style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getContext: () => ctx, remove() { this.gone = true; }, isConnected: true };
  const stage = { clientWidth: W, clientHeight: Hh, style: {}, ownerDocument: { createElement: () => canvas }, getBoundingClientRect: () => ({ left: 0, top: 0 }), isConnected: true, append() {}, setPointerCapture() {},
    addEventListener(t, f, cap) { (listeners[t] = listeners[t] || []).push({ f, cap: !!cap }); }, removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter((x) => x.f !== f); } };
  const win = { devicePixelRatio: 1, requestAnimationFrame: (f) => { frames.push(f); return frames.length; }, cancelAnimationFrame() {} };
  const fire = (type, e) => { const ev = { button: 0, pointerId: 1, stopped: false, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...e }; for (const { f } of (listeners[type] || []).slice()) { f(ev); if (ev.stopped) break; } return ev; };
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
  // two moves in one frame: one apply, with the LATEST position; 30 px outward on the left edge is 3 m of width
  const ax = left.screen, px = ax.dx / ax.len;
  S.fire('pointermove', { clientX: ax.x + px * 3, clientY: ax.y + (ax.dy / ax.len) * 3 }); S.fire('pointermove', { clientX: ax.x + px * 30, clientY: ax.y + (ax.dy / ax.len) * 30, shiftKey: false, ctrlKey: true });
  assert.equal(calls.length, 1, 'nothing applied until the frame'); S.tick();
  assert.deepEqual(calls[1], ['apply', 'width:1', 35, false, true, false], '30 px outward is 3 m wider, 34, which Ctrl snaps to 5 m: 35');
  // the release applies the position it carries, once more, and ends
  S.fire('pointerup', { clientX: ax.x + px * 40, clientY: ax.y + (ax.dy / ax.len) * 40 }); assert.deepEqual(calls.slice(2), [['apply', 'width:1', 35, false, false, true], ['end', 'width:1']]); assert.equal(ov.dragging(), false);
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
  assert.deepEqual([out.near.turn, out.near.width, out.near.length], [1, 33, 170], '20 px: turn 0.05 a pixel, width 0.1 m a pixel, length 0.5 m a pixel');
  assert.deepEqual([out.far.turn, out.far.width, out.far.length], [1, 33, 170], 'the same when zoomed out');
});

test('row 9: the detents: a drag holds about 6 px at the value it started from and, for bank, turn and climb, at 0; Ctrl snaps instead; past the hold it moves again', () => {
  const v0 = rig({ base: B2 }).drag('turn:1', -36); assert.ok(Object.is(v0, 0), `36 px down from 2 is 0.2 from 0, inside the hold: exactly 0, not ${v0}`);
  assert.equal(rig({ base: B2 }).drag('turn:1', -3), 2, 'a 3 px wobble from the start changes nothing');
  assert.equal(rig({ base: B2 }).drag('turn:1', -8), 1.6, 'past the hold it moves again: 8 px is 0.4 below 2');
  assert.equal(rig().drag('length:0', 5), 160, 'length holds its start too: 5 px is 2.5 m, held'); assert.equal(rig().drag('length:0', 20), 170);
  const bank5 = { ...B2, turn: 0, bank: 5 };
  assert.equal(rig({ base: bank5 }).drag('bank:1', -22), 0, 'bank: 22 px from 5 is 0.6 from 0, inside the 6 px (1.2 degrees) hold: 0'); assert.equal(rig({ base: bank5 }).drag('bank:1', -35), -2, 'bank: 35 px is 2 below 0, past the hold');
  assert.equal(rig({ base: B2 }).drag('turn:1', -36, { ctrl: true }), 0, 'Ctrl snaps to 5, no detent: 0.2 snaps to 0'); assert.equal(rig({ base: B2 }).drag('turn:1', 60, { ctrl: true }), 5, 'Ctrl: 5 snaps to 5, the hold is not in the way');
});

test('row 10: the value is rounded to the step with Shift too: a fine drag lands on 0.0, not 0.03', () => {
  const v0 = rig({ base: B2 }).drag('turn:1', -397, { shift: true }); assert.ok(Object.is(v0, 0), `a slow drag to nothing is exactly 0, not ${v0}`);
  assert.equal(rig({ base: B2 }).drag('turn:1', -103.7, { shift: true }), 1.5, 'Shift: 0.005 a pixel, 103.7 px is 0.5185: 1.5 to the tenth, not 1.48');
  assert.equal(HD.targetFor('turn', 0, 5.6, {}, { shift: true }), 0, 'a fine drag of 5.6 px is 0.028: held at 0, never 0.03');
  assert.equal(HD.targetFor('turn', 2, -60, {}, { shift: true }), 1.7, '60 px fine is 0.3: 1.7'); assert.equal(HD.targetFor('width', 31, 77, {}, { shift: true }), 31.8, 'width: 77 px fine is 0.77 m: 31.8, not 31.77');
});

test('row 11: a double-click on a handle resets it: 0 for bank, turn, climb; the value before the last drag for length, width, cup; and it is the handle\'s, not the camera\'s', () => {
  const R = rig({ base: { turn: 2, width: 31, length: 160, bank: 7.5 } });
  const t = R.at('turn:1'), onTurn = R.S.fire('dblclick', { clientX: t.x, clientY: t.y }); assert.equal(onTurn.stopped, true, 'taken by the handle'); assert.deepEqual(R.calls, [['begin', 'turn:1'], ['apply', 'turn:1', 0, true], ['end', 'turn:1']], 'one step: turn goes to 0'); assert.ok(Object.is(R.cur.turn, 0));
  R.calls.length = 0; const b = R.at('bank:1'); R.S.fire('dblclick', { clientX: b.x, clientY: b.y }); assert.equal(R.cur.bank, 0, 'bank to 0');
  // length: drag it, then reset puts back what it was before the drag
  R.calls.length = 0; assert.equal(R.drag('length:0', 40), 180); const l = R.at('length:0'); R.S.fire('dblclick', { clientX: l.x, clientY: l.y }); assert.equal(R.cur.length, 160, 'length back to the value before the drag');
  R.calls.length = 0; R.S.fire('dblclick', { clientX: l.x, clientY: l.y }); assert.deepEqual(R.calls, [], 'already there: nothing happens');
  // width: dragged twice, the reset goes back to before the LAST drag; and a value typed since is not "put back"
  assert.equal(R.drag('width:1', 20), 33); assert.equal(R.drag('width:1', 20), 35); const w = R.at('width:1'); R.S.fire('dblclick', { clientX: w.x, clientY: w.y }); assert.equal(R.cur.width, 33, 'back to before the last drag');
  R.cur.width = 40; R.calls.length = 0; R.S.fire('dblclick', { clientX: w.x, clientY: w.y }); assert.deepEqual(R.calls, [], 'a value typed since is the keeper\'s: no stale "before" is put back');
  // a double-click away from every handle is nobody's
  const away = R.S.fire('dblclick', { clientX: 5, clientY: 5 }); assert.equal(away.stopped, false); assert.equal(away.prevented, false);
});

test('row 12: the label shows the exact value the drag sets, and what a double-click would set', () => {
  const texts = [], ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? (x) => ({ width: x.length * 7 }) : k === 'fillText' ? (x) => { texts.push(x); } : (t[k] === undefined ? () => {} : t[k])), set: (t, k, v) => { t[k] = v; return true; } });
  const R = rig({ ctx, base: B2 }), t = R.at('turn:1');
  R.S.fire('pointermove', { clientX: t.x, clientY: t.y }); R.S.tick(); assert.equal(texts[texts.length - 1], 'turn 2.0°/100 m · double-click: 0', 'hovering: the value it has and what a double-click sets');
  const { x, y } = R.along('turn:1', -36); R.S.fire('pointerdown', { clientX: t.x, clientY: t.y }); R.S.fire('pointermove', { clientX: x, clientY: y }); R.S.tick(); R.S.tick();
  assert.equal(R.last()[2], 0); assert.equal(texts[texts.length - 1], 'turn 0.0°/100 m', 'dragging: exactly what is set, held at 0.0');
  R.S.fire('pointerup', { clientX: x, clientY: y }); R.drag('length:0', 40); const l = R.at('length:0'); texts.length = 0; R.S.fire('pointermove', { clientX: l.x, clientY: l.y }); R.S.tick(); assert.equal(texts[texts.length - 1], 'length 180.0 m · double-click: 160.0', 'length: a double-click would put back 160');
});
