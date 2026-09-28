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
const D = require('../../src/doc/index.js');
const { appendOld } = require('../../test/pre_d182_words.js');

const REPO = path.resolve(__dirname, '..', '..');
const mem = () => { const docs = new Map(); let lib = null; return { saveDoc: async (n, t) => docs.set(n, t), openDoc: async (n) => docs.get(n), listDocs: async () => [...docs.keys()], saveLibrary: async (t) => { lib = t; }, openLibrary: async () => lib }; };
const levels = (map) => map.stations.map((e) => Array.from(e.levels));
// CHANGED 2026-09-27 (D169): the reference now validates at the controller's own default design speed, the picker's
// 460 km/h (FINDINGS.md:476); before D169 the controller had none. The made-up lap-sim car these tests used to force
// loads onto a shell-built track (accel 15, inferred) is gone: the picker is how a shell-built track gets loads now.
const DESIGN = MACH6.designSpeedKmh / 3.6;
/** What a fresh, full validation of the shell's current document colours: the reference every live state must equal. */
function fresh(shell, csp = true, designSpeed = DESIGN) {
  const r = shell.getState().resolved, p = G.buildPath(r.segments, { step: STEP });
  return colourMap(validate(p, r.segments, { csp, ...(designSpeed == null ? {} : { designSpeed }) }), { path: p });
}

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
  const ctl = createValidationController(shell);
  shell.place('straight'); shell.place('turn');
  const before = ctl.state.map, oldEnd = ctl.state.path.lengthM;
  shell.place('straight');
  assert.deepStrictEqual([ctl.state.how, ctl.state.full], ['append', false]);
  const firstNew = ctl.state.map.stations.findIndex((e) => e.s >= oldEnd - 1e-9);
  assert.ok(Math.min(...ctl.state.changed) >= firstNew - 1);
  for (let k = 0; k < firstNew - 1; k++) assert.strictEqual(ctl.state.map.stations[k], before.stations[k]);
  assert.ok(ctl.state.result.lines.length > 0, 'the picker\'s design speed gives loads, or this equality proves nothing');
  assert.deepStrictEqual(ctl.state.result.lines.map((l) => [l.s, l.u, l.fN_g]), (() => { const r = shell.getState().resolved, p = G.buildPath(r.segments, { step: STEP }); return validate(p, r.segments, { csp: true, designSpeed: DESIGN }).lines.map((l) => [l.s, l.u, l.fN_g]); })());
  assert.deepStrictEqual(levels(ctl.state.map), levels(fresh(shell)));
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
  const ctl = createValidationController(shell);
  // named (the walled-bowl tests, p-d182-walltests-E): two pre-D182 half-pipe straights, a 16 m floor and 8 m walls rising to
  // 60°, red for vanilla AC. The half-pipe the font picker gives now is the MEASURED one, with no wall (C's fonts, D182).
  shell.adopt(['straight', 'straight'].reduce((d, w) => appendOld(D, d, w, { font: 'half-pipe' }), D.createDoc('t')));
  assert.strictEqual(summary(ctl.state).red, 0);
  ctl.setCsp(false);
  assert.ok(ctl.state.result.red.some((r) => r.reason === 'steep-without-raycast'));
  assert.deepStrictEqual(levels(ctl.state.map), levels(fresh(shell, false)));
  ctl.setCsp(true);
  assert.strictEqual(summary(ctl.state).red, 0);
});

// CHANGED 2026-09-27 (D170): a jump word now carries its landing ramp (A's model, D170), so at the head it is either
// waiting (the model without the ramp) or already landed (with it). What holds either way: no arcs while it waits, and
// both landings drawn once there is landing road.
test('a jump placed at the open head is drawn once it has landing road (its own ramp, or the next word)', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createValidationController(shell);
  shell.place('straight'); shell.place('jump');
  const waits = ctl.state.path.samples[ctl.state.path.samples.length - 1].seg === shell.getState().resolved.segments.findIndex((g) => g.kind === 'gap');
  assert.strictEqual(ctl.state.arcs.length, waits ? 0 : 1);
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
