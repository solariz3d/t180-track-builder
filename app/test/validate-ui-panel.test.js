// Headless tests for app/validate-ui/panel.js (the validation panel's logic) against A's real shell, and for both of
// E's panels loading through A's webview loader. Run: node --test "app/test/*.test.js"
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createShell } = require('../shell.js');
const { loadCjs } = require('../lib/cjs.js');
const G = require('../../src/geom/index.js');
const { validate } = require('../../src/validate/index.js');
const { colourMap } = require('../validate-ui/colour.js');
const { MACH6 } = require('../../src/validate/limits.js');
const { createValidationController, summary, STEP } = require('../validate-ui/panel.js');

const REPO = path.resolve(__dirname, '..', '..');
const mem = () => { const docs = new Map(); let lib = null; return { saveDoc: async (n, t) => docs.set(n, t), openDoc: async (n) => docs.get(n), listDocs: async () => [...docs.keys()], saveLibrary: async (t) => { lib = t; }, openLibrary: async () => lib }; };
const levels = (map) => map.stations.map((e) => Array.from(e.levels));
/** What a fresh, full validation of the shell's current document colours: the reference every live state must equal. */
function fresh(shell, csp = true, extra = {}) {
  const r = shell.getState().resolved, p = G.buildPath(r.segments, { step: STEP });
  return colourMap(validate(p, r.segments, { ...extra, csp }), { path: p, car: extra.car });
}
// The shell places words with no design speed, and FINDINGS has no car acceleration (src/validate/limits.js accel:
// null), so a shell-built track has NO loads. Tests that must see loads give the lap sim an acceleration: inferred,
// a test value only (the plan's 745 km/h cap is reached either way).
const LOADED = { car: { ...MACH6, accel: 15 }, startSpeed: 50 };

test('the first word builds and colours the whole track (full), and an empty document shows nothing', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createValidationController(shell);
  assert.deepStrictEqual([ctl.state.how, ctl.state.map], ['empty', null]);
  shell.place('straight');
  assert.deepStrictEqual([ctl.state.how, ctl.state.full, ctl.state.error], ['full', true, null]);
  assert.deepStrictEqual(levels(ctl.state.map), levels(fresh(shell)));
});

test('placing at the head is an APPEND: extendPath, revalidate, only the new span re-coloured, and equal to a full run', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createValidationController(shell, { validate: LOADED });
  shell.place('straight'); shell.place('turn');
  const before = ctl.state.map, oldEnd = ctl.state.path.lengthM;
  shell.place('straight');
  assert.deepStrictEqual([ctl.state.how, ctl.state.full], ['append', false]);
  const firstNew = ctl.state.map.stations.findIndex((e) => e.s >= oldEnd - 1e-9);
  assert.ok(Math.min(...ctl.state.changed) >= firstNew - 1);
  for (let k = 0; k < firstNew - 1; k++) assert.strictEqual(ctl.state.map.stations[k], before.stations[k]);
  assert.ok(ctl.state.result.lines.length > 0, 'the lap sim gives loads, or this equality proves nothing');
  assert.deepStrictEqual(ctl.state.result.lines.map((l) => [l.s, l.u, l.fN_g]), (() => { const r = shell.getState().resolved, p = G.buildPath(r.segments, { step: STEP }); return validate(p, r.segments, { ...LOADED, csp: true }).lines.map((l) => [l.s, l.u, l.fN_g]); })());
  assert.deepStrictEqual(levels(ctl.state.map), levels(fresh(shell, true, LOADED)));
});

test('a drag on an earlier word is a SCULPT from that word, and still equals a full run', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createValidationController(shell);
  for (const w of ['straight', 'turn', 'straight']) shell.place(w);
  shell.beginDrag(); shell.dragTo('w2', { handles: { length: 150 } });
  assert.strictEqual(ctl.state.how, 'sculpt');
  shell.endDrag();
  assert.deepStrictEqual(levels(ctl.state.map), levels(fresh(shell)));
});

test('removing the head, and undo, take the full route and still equal a full run', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createValidationController(shell);
  for (const w of ['straight', 'turn', 'straight']) shell.place(w);
  shell.removeHead();
  assert.strictEqual(ctl.state.how, 'full');
  assert.deepStrictEqual(levels(ctl.state.map), levels(fresh(shell)));
  shell.undo();
  assert.deepStrictEqual(levels(ctl.state.map), levels(fresh(shell)));
});

test('the CSP switch re-validates for vanilla AC: a 60° wall turns red, and back', async () => {
  const shell = await createShell({ storage: mem() });
  shell.setPicker('font', 'half-pipe');
  const ctl = createValidationController(shell);
  shell.place('straight'); shell.place('straight');
  assert.strictEqual(summary(ctl.state).red, 0);
  ctl.setCsp(false);
  assert.ok(ctl.state.result.red.some((r) => r.reason === 'steep-without-raycast'));
  assert.deepStrictEqual(levels(ctl.state.map), levels(fresh(shell, false)));
  ctl.setCsp(true);
  assert.strictEqual(summary(ctl.state).red, 0);
});

test('a jump placed at the open head is pending, and drawn once its landing road is placed', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createValidationController(shell);
  shell.place('straight'); shell.place('jump');
  assert.deepStrictEqual(ctl.state.arcs, []);
  shell.place('straight');
  assert.strictEqual(ctl.state.arcs.length, 1);
  assert.deepStrictEqual(ctl.state.arcs[0].arcs.map((a) => a.g), [3.2, 6.3]);
});

test('changes arriving before the scheduled update are coalesced into one update', async () => {
  const shell = await createShell({ storage: mem() });
  const queue = [], ctl = createValidationController(shell, { schedule: (fn) => queue.push(fn) });
  shell.place('straight'); shell.place('turn'); shell.place('straight');
  assert.strictEqual(queue.length, 1);
  queue.shift()();
  assert.deepStrictEqual(levels(ctl.state.map), levels(fresh(shell)));
});

test('E\'s panels load through A\'s webview loader (app/lib/cjs.js), and each exports mount(root, shell)', async () => {
  const fromDisk = async (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
  for (const p of ['app/validate-ui/index.js', 'app/handles/index.js']) assert.strictEqual(typeof (await loadCjs(p, fromDisk)).mount, 'function', p);
});
