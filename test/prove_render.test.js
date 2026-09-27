// prove_render.test.js: node --test test/prove_render.test.js. The window proof's pure parts (scripts/prove_render.js):
// its arguments, its plan, the camera keys that reach each view, and the judge of each capture. The run itself starts the
// real app and is not a unit test (its result is reported in the D169 hand-back). Stated before the code:
//   · --exe and --out are required; the timeout is capped at 600 s (the night's hard cap); the port is 1025..65535.
//   · The plan places straight, sweep, a half-pipe turn, wall-ride and jump, in that order, through the palette.
//   · Pressing each view's keys in turn, on a fresh camera rig, lands on exactly that view.
//   · The judge fails a view for: no capture, under 1% of the preview drawn, the head out of frame or behind the camera,
//     a build view looking less than 0.9 along T, and a canvas whose backing store is not css × DPR.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const SDIR = process.env.SCRIPTS_DIR || path.join(__dirname, '..', 'scripts');
const R = require(path.join(SDIR, 'prove_render.js'));
const { createRig } = require('../app/camera/cameras.js');

test('arguments: exe and out are required, the timeout is capped at 600 s, the port is checked', () => {
  assert.deepEqual(R.parseArgs(['--exe', 'a.exe', '--out', 'o']), { exe: 'a.exe', out: 'o', port: 9340, timeout: 600, shimTimers: false });
  assert.equal(R.parseArgs(['--exe', 'a.exe', '--out', 'o', '--shim-timers']).shimTimers, true, 'the D170 shim is opt-in only');
  assert.throws(() => R.parseArgs(['--exe', 'a.exe']), /needs --exe/);
  assert.throws(() => R.parseArgs(['--exe', 'a.exe', '--out', 'o', '--timeout', '601']), /600/);
  assert.throws(() => R.parseArgs(['--exe', 'a.exe', '--out', 'o', '--port', '80']), /port/);
  assert.throws(() => R.parseArgs(['--exe', 'a.exe', '--out', 'o', '--steer', '1']), /unknown argument/);
});
test('the plan is the packet\'s track: straight, sweep, half-pipe turn, wall-ride, jump', () => {
  assert.deepEqual(R.PLAN.map((s) => [s.word, s.font]), [['straight', 'auto'], ['sweep', 'auto'], ['turn', 'half-pipe'], ['wall-ride', 'auto'], ['jump', 'auto']]);
});
test('each view\'s keys, pressed in turn on a fresh rig, land on exactly that view', () => {
  const rig = createRig();
  for (const v of R.VIEWS) { for (const k of v.keys) rig.key(k, null); assert.equal(rig.mode, v.mode); }
  assert.deepEqual(R.VIEWS.map((v) => v.mode), ['build', 'overhead', 'chase', 'free']);
});

const good = { headNdc: [0, -0.3, 0.9], lookAlongT: 0.98, canvas: { width: 1200, height: 750, cssWidth: 800, cssHeight: 500, dpr: 1.5 } };
const cap = { ok: true, drawn: 500, rectPixels: 10000 };
const names = (checks) => Object.fromEntries(checks.map((c) => [c.name, c.pass]));
test('judge: a good build view passes every check', () => {
  assert.deepEqual(names(R.judge('build', good, cap)), { 'track visible': true, 'head in frame': true, 'looks along growth': true, dpr: true });
});
test('judge: each failure is caught on its own', () => {
  assert.equal(names(R.judge('build', good, { ok: false, reason: 'minimised' }))['track visible'], false);
  assert.equal(names(R.judge('build', good, { ok: true, drawn: 99, rectPixels: 10000 }))['track visible'], false, 'under 1% drawn');
  assert.equal(names(R.judge('build', { ...good, headNdc: [1.2, 0, 0.9] }, cap))['head in frame'], false, 'off the side');
  assert.equal(names(R.judge('build', { ...good, headNdc: null }, cap))['head in frame'], false, 'behind the camera');
  assert.equal(names(R.judge('build', { ...good, headNdc: [0, 0, 1.01] }, cap))['head in frame'], false, 'past the far plane');
  assert.equal(names(R.judge('build', { ...good, lookAlongT: 0.5 }, cap))['looks along growth'], false);
  assert.equal(names(R.judge('build', { ...good, canvas: { ...good.canvas, width: 800 } }, cap)).dpr, false, 'backing store ignores DPR');
});
test('judge: only the build view is held to looking along the growth direction', () => {
  assert.ok(!('looks along growth' in names(R.judge('overhead', { ...good, lookAlongT: 0 }, cap))));
});
