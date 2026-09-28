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
  // D179 (the chair: pick a free port, so no other seat's script can attach): the default port is null, taken free at run time
  assert.deepEqual(R.parseArgs(['--exe', 'a.exe', '--out', 'o']), { exe: 'a.exe', out: 'o', port: null, timeout: 600, shimTimers: false });
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
test('judge (D177): in the AC look, a view that drew no batch with an AC shader fails "ac look drawn"', () => {
  assert.deepEqual([names(R.judge('build', { ...good, look: 'ac', stats: { acDraws: 12, draws: 12 } }, cap))['ac look drawn'], names(R.judge('build', { ...good, look: 'ac', stats: { acDraws: 0, draws: 12 } }, cap))['ac look drawn']], [true, false]);
});
test('judge: only the build view is held to looking along the growth direction', () => {
  assert.ok(!('looks along growth' in names(R.judge('overhead', { ...good, lookAlongT: 0 }, cap))));
});

// D179: --plan, the usability pass's own track and views
test('plan: a plan file gives its steps, and its views in the proof\'s order of keys', () => {
  const p = R.loadPlan(JSON.stringify({ steps: [{ word: 'straight', font: 'tube', capture: 'tube-straight' }, { word: 'jump', font: 'auto', ghost: { word: 'straight', capture: 'tube-ghost' } }], views: ['chase', 'overhead'] }));
  assert.deepEqual([p.steps.length, p.views], [2, ['chase', 'overhead']]);
});
test('plan: no views listed means all of them', () => {
  assert.deepEqual(R.loadPlan(JSON.stringify({ steps: [{ word: 'straight', font: 'auto' }] })).views, R.VIEWS.map((v) => v.mode));
});
test('plan: a bad plan is refused, saying why', () => {
  const bad = (x) => assert.throws(() => R.loadPlan(typeof x === 'string' ? x : JSON.stringify(x)), /prove_render: /);
  bad('{ not json'); bad({ steps: [] }); bad({ steps: [{ word: 'straight' }] }); bad({ steps: [{ word: 'straight', font: 'auto', capture: '../../etc' }] });
  bad({ steps: [{ word: 'straight', font: 'auto', ghost: { word: 'jump' } }] }); bad({ steps: [{ word: 'straight', font: 'auto' }], views: ['side-ish'] });
});

test('port: a free port is free, and a port something listens on is not; its owner is found, and it is not "ours" for another root', async () => {
  const net = require('net'), p = await R.freePort(), s = net.createServer(); await new Promise((r) => s.listen(p, '127.0.0.1', r));
  try {
    const busy = await R.portFree(p), w = R.portOwner(p, 1);
    assert.deepEqual([typeof p, busy, w.pid === process.pid, w.ours], ['number', false, true, false]);
  } finally { await new Promise((r) => s.close(r)); }
  assert.equal(await R.portFree(p), true);
});
test('port: the process listening is "ours" when it is the root itself', async () => {
  const net = require('net'), s = net.createServer(); await new Promise((r) => s.listen(0, '127.0.0.1', r));
  try { assert.equal(R.portOwner(s.address().port, process.pid).ours, true); } finally { await new Promise((r) => s.close(r)); }
});

test('autosave: an existing autosave is put back byte for byte after a run overwrote it', () => {
  const fs = require('fs'), os = require('os'), d = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-pr-')), out = path.join(d, 'out'); fs.mkdirSync(out);
  try {
    const f = path.join(d, 'autosave.t180auto'); fs.writeFileSync(f, 'an unsaved track of the keeper');
    const restore = R.guardAutosave(d, out); fs.writeFileSync(f, 'a proof run');
    assert.deepEqual([restore(), fs.readFileSync(f, 'utf8')], ['restored', 'an unsaved track of the keeper']);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
test('autosave: with none before the run, the one the run made is removed', () => {
  const fs = require('fs'), os = require('os'), d = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-pr-')), out = path.join(d, 'out'); fs.mkdirSync(out);
  try {
    const f = path.join(d, 'autosave.t180auto'), restore = R.guardAutosave(d, out); fs.writeFileSync(f, 'a proof run');
    assert.deepEqual([restore(), fs.existsSync(f)], ['removed', false]);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
test('profile: each run gets a fresh WebView2 profile folder inside its own out folder', () => {
  const fs = require('fs'), os = require('os'), d = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-pr-'));
  try {
    fs.mkdirSync(path.join(d, 'webview2-profile', 'EBWebView'), { recursive: true });
    const p = R.profileDir(d);
    assert.deepEqual([p, fs.existsSync(p)], [path.join(d, 'webview2-profile'), false]);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('export seam: --export-seam is an opt-in flag (off by default)', () => {
  assert.deepEqual([R.parseArgs(['--exe', 'a.exe', '--out', 'o']).exportSeam, R.parseArgs(['--exe', 'a.exe', '--out', 'o', '--export-seam']).exportSeam], [undefined, true]);
});
