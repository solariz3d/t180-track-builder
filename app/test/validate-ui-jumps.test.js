// Headless tests for D170 (pane E): the jump counter, the loads graph, and the open end after a jump. Run:
// node --test "app/test/*.test.js"
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createShell } = require('../shell.js');
const { createValidationController, summary } = require('../validate-ui/panel.js');

const mem = () => { const docs = new Map(); let lib = null; return { saveDoc: async (n, t) => docs.set(n, t), openDoc: async (n) => docs.get(n), listDocs: async () => [...docs.keys()], saveLibrary: async (t) => { lib = t; }, openLibrary: async () => lib }; };

// The librarian's item 4 (exo_memory/librarian/2026-09-27.desktop.md:151): "The counter says '0 jumps' with a jump
// placed (w5 jump)". C's capture sequence, word for word (p-d169-render-proof-C §2): the jump is the open head.
test('a document with one jump counts 1 jump, even while the jump is the open head and waits for its landing', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createValidationController(shell);
  shell.place('straight'); shell.place('sweep'); shell.setPicker('font', 'half-pipe'); shell.place('turn'); shell.place('wall-ride'); shell.place('jump');
  assert.deepStrictEqual(shell.getState().history.present.words.map((w) => w.word), ['straight', 'sweep', 'turn', 'wall-ride', 'jump']);
  assert.strictEqual(summary(ctl.state).jumps, 1);
});

// With A's D170 model the jump above carries its landing ramp and is no longer pending, so that test alone would pass even
// with the old counter (which counted drawn arcs). A jump with no take-off road is pending under either model: the old
// counter read "0 jumps" for it too.
test('a pending jump is still counted: a jump placed first (no take-off road) is 1 jump, 1 waiting', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createValidationController(shell);
  shell.place('jump');
  assert.ok(ctl.state.result.jumps[0].pending);
  assert.deepStrictEqual([summary(ctl.state).jumps, summary(ctl.state).jumpsPending, ctl.state.arcs.length], [1, 1, 0]);
});

const { graphModel } = require('../validate-ui/graph.js');
const { MACH6 } = require('../../src/validate/limits.js');

// The librarian's item 5: "The right panel's graph area is an empty grey bar."
test('the load graph is hidden (no model) while there is no speed, so no empty grey bar', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createValidationController(shell, { designSpeedKmh: null });
  assert.strictEqual(graphModel(ctl.state), null, 'an empty document');
  shell.place('straight'); shell.place('tight');
  assert.strictEqual(ctl.state.result.lines.length, 0);
  assert.strictEqual(graphModel(ctl.state), null);
});

test('with a design speed the graph is drawn: one point per station, the hardest line\'s load, the car\'s two limits', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createValidationController(shell);   // the picker's default, 460 km/h
  shell.place('straight'); shell.place('tight');
  const m = graphModel(ctl.state), r = ctl.state.result;
  assert.ok(m, 'drawn');
  assert.strictEqual(m.s.length, new Set(r.lines.map((l) => l.s)).size);
  const at = m.s.findIndex((s) => r.lines.some((l) => l.s === s && l.u !== 0));
  assert.strictEqual(m.fN[at], Math.max(...r.lines.filter((l) => l.s === m.s[at]).map((l) => l.fN_g)), 'the highest line at the station');
  assert.deepStrictEqual(m.lines.map((l) => l.g), [MACH6.suspensionStopG, MACH6.provenG]);
  assert.ok(m.top >= 1.1 * MACH6.provenG && m.top >= Math.max(...m.fN), 'the 90 g line is always on the graph');
});

test('the graph takes the HARDEST line at every station, wherever across the road it is (a right turn: the left wall)', async () => {
  const shell = await createShell({ storage: mem() });
  shell.setPicker('dir', 'R');
  const ctl = createValidationController(shell);
  shell.place('straight'); shell.place('tight');
  const m = graphModel(ctl.state), r = ctl.state.result;
  let notFirst = 0;
  m.s.forEach((s, k) => {
    const at = r.lines.filter((l) => l.s === s), hardest = Math.max(...at.map((l) => l.fN_g));
    assert.strictEqual(m.fN[k], hardest, `s ${s}`);
    if (hardest > at[0].fN_g) notFirst++;
  });
  assert.ok(notFirst > 0, 'somewhere the hardest line is not the first one, or this proves nothing');
});

test('the graph shades the red and amber stretches behind the curve', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createValidationController(shell, { designSpeedKmh: 764 });
  shell.place('straight'); shell.place('tight'); shell.beginDrag(); shell.dragTo('w2', { handles: { length: 50 } }); shell.endDrag();
  const m = graphModel(ctl.state);
  assert.ok(ctl.state.result.amber.length > 0);
  assert.strictEqual(m.bands.length, ctl.state.result.amber.length + ctl.state.result.red.length);
});

// The librarian's item 3: after a jump, the head floats over nothing.
// Written for both sides of A's in-flight model change (D170: the jump word carries its landing ramp): the head is red
// exactly when the path ends in the flight, and landing road always clears it.
test('through the shell: the head is red exactly when it is the flight of a jump; landing road clears it', async () => {
  const shell = await createShell({ storage: mem() });
  const ctl = createValidationController(shell);
  shell.place('straight'); shell.place('jump');
  const segs = shell.getState().resolved.segments, endsInFlight = segs[segs.length - 1].kind === 'gap';
  assert.strictEqual(ctl.state.result.red.some((x) => x.reason === 'head-in-the-air'), endsInFlight);
  shell.place('straight');
  assert.ok(!ctl.state.result.red.some((x) => x.reason === 'head-in-the-air'));
  assert.strictEqual(summary(ctl.state).jumpsPending, 0);
});

// D179 addendum: a jump with no forward gap has no flight, so it draws no arc (validation's red says why instead)
test('jump arcs: a jump whose landing lip is behind its take-off lip draws no arc, and nothing throws', () => {
  const X = require('../../test/validate_paths.js'), { validate } = require('../../src/validate/index.js'), { jumpArcs } = require('../validate-ui/jumparcs.js');
  const run = X.straight(100, { seg: 0 }), flight = X.straight(20, { seg: 1, start: [0, 0, 100], s0: 100 }).slice(1, -1);
  const land = X.straight(120, { seg: 2, start: [0, -1, 95], s0: 120 });
  const segs = [X.seg({ id: 'run', speed: 120 }), X.seg({ id: 'j', kind: 'gap', word: 'jump', speed: 120 }), X.seg({ id: 'land', speed: 120 })];
  const path = X.pathOf([...run, ...flight, ...land]), r = validate(path, segs);
  assert.strictEqual(r.jumps[0].badGap, true);
  assert.deepStrictEqual(jumpArcs(r, path), []);
});
