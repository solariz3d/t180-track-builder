// Headless tests for app/validate-ui/speed.js (the design-speed picker) and its effect through the validation panel's
// controller against A's real shell: the load colours appear on a shell-built track (B's D168 read, gap 2). D169.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createShell } = require('../shell.js');
const { MACH6 } = require('../../src/validate/limits.js');
const { LEVEL } = require('../validate-ui/colour.js');
const { createSpeedPicker, MIN_KMH, MAX_KMH } = require('../validate-ui/speed.js');
const { createValidationController } = require('../validate-ui/panel.js');

const mem = () => { const docs = new Map(); let lib = null; return { saveDoc: async (n, t) => docs.set(n, t), openDoc: async (n) => docs.get(n), listDocs: async () => [...docs.keys()], saveLibrary: async (t) => { lib = t; }, openLibrary: async () => lib }; };
const anyLevel = (map, lvl) => map.stations.some((e) => Array.from(e.levels).includes(lvl));

test('the picker starts at the FINDINGS default, 460 km/h (FINDINGS.md:476), read from the car, not typed here', () => {
  assert.strictEqual(MACH6.designSpeedKmh, 460);
  const p = createSpeedPicker();
  assert.deepStrictEqual([p.kmh, p.defaultKmh], [460, 460]);
  assert.strictEqual(p.ms(), 460 / 3.6);
});

test('the picker holds to its range: 50 km/h up to the lap sim\'s 764 km/h cap (FINDINGS.md:484)', () => {
  assert.deepStrictEqual([MIN_KMH, MAX_KMH], [50, MACH6.vmaxKmh]);
  const p = createSpeedPicker();
  assert.deepStrictEqual([p.set(10), p.set(5000), p.set(300)], [50, 764, 300]);
});

test('off is no design speed; a value that is not a number is refused loudly; onChange fires only on a change', () => {
  const seen = [], p = createSpeedPicker({ onChange: (k) => seen.push(k) });
  p.set(300); p.set(300); p.set(null);
  assert.deepStrictEqual([seen, p.kmh, p.ms()], [[300, null], null, null]);
  assert.throws(() => p.set(NaN), /not a speed/);
});

test('with the picker\'s default, a track built through the shell HAS loads now (it had none in D168)', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createValidationController(shell);
  shell.place('straight'); shell.place('tight');
  assert.strictEqual(ctl.designSpeedKmh, 460);
  assert.strictEqual(ctl.state.result.speedFrom, 'design');
  assert.ok(ctl.state.result.lines.length > 0);
});

test('with the picker off, an open track built through the shell claims no load at all', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createValidationController(shell, { designSpeedKmh: null });
  shell.place('straight'); shell.place('tight');
  assert.deepStrictEqual([ctl.state.result.speedFrom, ctl.state.result.lines.length], ['none', 0]);
  assert.ok(!anyLevel(ctl.state.map, LEVEL.AMBER) && !anyLevel(ctl.state.map, LEVEL.INFO));
});

test('a faster design speed turns a tight curve amber (above the proven 90 g), and a slower one takes it away again', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createValidationController(shell, { designSpeedKmh: 200 });
  shell.place('straight'); shell.place('tight'); shell.beginDrag(); shell.dragTo('w2', { handles: { length: 50 } }); shell.endDrag();
  assert.ok(!anyLevel(ctl.state.map, LEVEL.AMBER), 'clean at 200 km/h');
  ctl.setDesignSpeed(764);
  assert.ok(ctl.state.result.amber.some((a) => a.reason === 'load-above-proven'), 'amber at the cap');
  assert.ok(anyLevel(ctl.state.map, LEVEL.AMBER));
  ctl.setDesignSpeed(200);
  assert.ok(!anyLevel(ctl.state.map, LEVEL.AMBER));
});

test('with the picker off (no loads anywhere), a geometry red still colours the live map, station by station along the path', async () => {
  const shell = await createShell({ storage: mem() });
  shell.setPicker('font', 'half-pipe');   // 60° walls: red for vanilla AC
  const ctl = createValidationController(shell, { designSpeedKmh: null, csp: false });
  shell.place('straight'); shell.place('straight');
  assert.strictEqual(ctl.state.result.lines.length, 0);
  shell.place('straight');                 // an append: the live route, not a fresh map
  assert.strictEqual(ctl.state.how, 'append');
  assert.strictEqual(ctl.state.result.lines.length, 0);
  assert.strictEqual(ctl.state.map.stations.length, ctl.state.path.samples.length);
  assert.ok(anyLevel(ctl.state.map, LEVEL.RED));
});
