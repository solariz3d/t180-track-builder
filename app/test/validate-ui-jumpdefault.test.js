// D179: THE FIRST JUMP MUST NOT BE RED BY DEFAULT. A jump with no speed of its own sizes its landing ramp for the design
// speed (A's src/doc: vocab.js LANDING, resolve.js landingRamp, shell.js setDesignSpeed); validation checks it at the same
// speed (app/validate-ui). The jump is the LAST word in these tests, so only its own ramp can catch the car: the case a
// new user meets on placing a jump at the build head. Run: node --test --test-concurrency=4 app/test/validate-ui-jumpdefault.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createShell } = require('../shell.js');
const D = require('../../src/doc/index.js');
const G = require('../../src/geom/index.js');
const { validate } = require('../../src/validate/index.js');
const { landingRamp } = require('../../src/validate/jumps.js');
const { MACH6 } = require('../../src/validate/limits.js');
const { createValidationController } = require('../validate-ui/panel.js');

const mem = () => { const docs = new Map(); let lib = null; return { saveDoc: async (n, t) => docs.set(n, t), openDoc: async (n) => docs.get(n), listDocs: async () => [...docs.keys()], saveLibrary: async (t) => { lib = t; }, openLibrary: async () => lib }; };
const DEG = Math.PI / 180;
/** A new user's track: two straights and a jump at the head, with the panel's controller following it. */
async function firstJump() {
  const shell = await createShell({ storage: mem(), autosaveMs: 0 }), ctl = createValidationController(shell);
  for (const w of ['straight', 'straight', 'jump']) shell.place(w);
  return { shell, ctl };
}
/** Move the slider the way the panel does (app/validate-ui/index.js): the shell's design speed, then validation's. */
const slide = ({ shell, ctl }, kmh) => { shell.setDesignSpeed(kmh); ctl.setDesignSpeed(kmh); };
const reds = (ctl) => ctl.state.result.red;
const rampOf = (shell) => shell.getState().resolved.segments.find((g) => g.part === 'land');
// the slider's range and step (app/validate-ui/speed.js: 50 km/h to MACH6.vmaxKmh, step 5)
const MIN = 50, MAX = MACH6.vmaxKmh, STEP = 5;

test('the default jump at the default design speed (460 km/h, FINDINGS.md:476) is clean: no red, both landings caught', async () => {
  const { ctl, shell } = await firstJump();
  assert.strictEqual(ctl.designSpeedKmh, MACH6.designSpeedKmh);
  assert.deepStrictEqual(reds(ctl), [], JSON.stringify(reds(ctl)));
  const jp = ctl.state.result.jumps[0];
  assert.deepStrictEqual(jp.landings.map((L) => [L.g, L.caught]), [[3.2, true], [6.3, true]]);
  assert.strictEqual(Math.round(rampOf(shell).landing.speed * 3.6), MACH6.designSpeedKmh, 'the ramp was sized for the default design speed');
});

test('resolve with no speed given sizes the ramp for the same default, so every caller agrees (the export, the connector)', () => {
  let d = D.createDoc('t'); for (const w of ['straight', 'straight', 'jump']) d = D.appendWord(d, w);
  const segs = D.resolve(d).segments, ramp = segs.find((g) => g.part === 'land');
  assert.deepStrictEqual([ramp.landing.speedFrom, Math.round(ramp.landing.speed * 3.6)], ['default', MACH6.designSpeedKmh]);
  const v = validate(G.buildPath(segs, { step: 2 }), segs, { designSpeed: MACH6.designSpeedKmh / 3.6 });
  assert.deepStrictEqual(v.red, []);
});

test(`the slider swept over its whole range (${MIN}–${MAX} km/h, its own step of ${STEP}): clean wherever the car clears the gap, and nowhere else`, async () => {
  // "clears the gap" is computed independently of the ramp: both falls come down past the gap (jumps.js landingRamp's
  // touchdowns) off the default jump, whatever the vocabulary makes it (12 m / 0.7 m before D182; 81 m / 14 m measured). Below that speed no ramp can help,
  // and the red says why; above it the ramp resized to the slider must catch both landings at EVERY step.
  const J = D.WORDS ? D.WORDS.jump : require('../../src/doc/vocab.js').WORDS.jump;
  const clears = (kmh) => landingRamp({ D: J.gap, dh: -J.drop, thetaRad: 0, landRad: J.land, v: kmh / 3.6 }).touchdowns.every((t) => t.x != null);
  const t = await firstJump(), dirty = [], clean = [];
  // every step the slider stops at (50, 55 … 760: a range input snaps to min + n·step), and its maximum, which the
  // picker's own clamp can set (speed.js set(kmh))
  const speeds = []; for (let k = MIN; k <= MAX; k += STEP) speeds.push(k); if (speeds[speeds.length - 1] !== MAX) speeds.push(MAX);
  for (const k of speeds) {
    slide(t, k);
    const r = reds(t.ctl);
    if (clears(k)) { if (r.length) dirty.push(`${k} km/h: ${r.map((x) => x.reason).join(', ')}`); else clean.push(k); }
    else assert.ok(r.length && r.every((x) => x.reason === 'landing-misses-zone'), `${k} km/h: the car does not clear the gap, so the jump must be red for that, and only that: ${JSON.stringify(r.map((x) => x.reason))}`);
    assert.deepStrictEqual([Math.round(rampOf(t.shell).landing.speed * 3.6), rampOf(t.shell).landing.speedFrom], [k, 'design'], `${k} km/h: the ramp follows the slider, and says so`);
  }
  assert.deepStrictEqual(dirty, [], 'red at a speed where the car clears the gap');
  // clean at EXACTLY the speeds that clear the gap (the ripple, p-d182-ripple-E: this was "more than 80 steps", the 12 m
  // jump's own figure; the measured 81 m jump clears from 435 km/h), and at the slider's maximum
  assert.deepStrictEqual(clean, speeds.filter(clears), `clean at ${clean[0]}–${clean[clean.length - 1]} km/h (${clean.length} steps)`);
  assert.strictEqual(clean[clean.length - 1], MAX);
});

test('a jump sculpted past what the car can clear is red, and says so: the landings that miss, the heaviest fall', async () => {
  // the ramp cannot be sculpted (it is the jump's own, sized by resolve); what a user CAN make too much for the speed is
  // the flight: a gap sculpted far longer than 460 km/h carries the car
  const { shell, ctl } = await firstJump();
  const jump = shell.getState().history.present.words.find((w) => w.word === 'jump');
  // named (the ripple, p-d182-ripple-E): an 80 m gap off a 0.7 m drop, which the 6.3 g landing cannot reach at 460 km/h.
  // The measured default jump is itself 81 m with a 14 m drop, so "sculpted past" has to say what it was sculpted to
  shell.sculpt(jump.id, { handles: { gap: 80, drop: 0.7, land: -2 * DEG } });
  assert.strictEqual(shell.getState().message, null, shell.getState().message);
  const r = reds(ctl).filter((x) => x.reason === 'landing-misses-zone');
  assert.strictEqual(r.length, 1, JSON.stringify(reds(ctl)));
  assert.ok(r[0].source && /ARCHITECTURE/.test(r[0].source), 'it carries its source');
  assert.strictEqual(r[0].worst, 6.3, 'the heaviest fall that misses is named');
  assert.ok(ctl.state.result.jumps[0].landings.some((L) => !L.caught));
});

test('the ramp resize is DERIVED: no undo step, the document unchanged, and the same speed gives the same ramp again', async () => {
  const { shell } = await firstJump();
  const h0 = shell.getState().history, len460 = rampOf(shell).length;
  shell.setDesignSpeed(600);
  const h1 = shell.getState().history;
  assert.strictEqual(h1, h0, 'the history is the same object: no entry was added');
  assert.ok(rampOf(shell).length > len460, 'a faster design speed, a longer ramp');
  shell.setDesignSpeed(460);
  assert.strictEqual(rampOf(shell).length, len460, 'back at 460 km/h: the same ramp, to the bit');
  shell.undo();
  assert.deepStrictEqual(shell.getState().history.present.words.map((w) => w.word), ['straight', 'straight'], 'undo takes back the last WORD, not the speed');
});

test('a CLOSED loop keeps its ramps at the default when the slider moves, so it stays closed', async () => {
  const shell = await createShell({ storage: mem(), autosaveMs: 0 });
  for (const w of ['straight', 'straight', 'jump', 'straight', 'turn', 'straight', 'turn']) shell.place(w);
  shell.closeLoop();
  assert.strictEqual(shell.getState().history.present.closed, true, shell.getState().message);
  const before = rampOf(shell).length;
  shell.setDesignSpeed(700);
  assert.strictEqual(shell.getState().resolveError, null, shell.getState().resolveError);
  assert.strictEqual(rampOf(shell).length, before, 'a closed loop does not resize its ramps');
  assert.doesNotThrow(() => G.buildPath(shell.getState().resolved.segments, { step: 2, closed: true }), 'the loop still closes');
});

test('resolve itself refuses a design speed that is not a positive number (a named ResolveError), and takes null as the default', () => {
  let d = D.createDoc('t'); for (const w of ['straight', 'jump']) d = D.appendWord(d, w);
  for (const bad of [0, -5, NaN, Infinity]) assert.throws(() => D.resolve(d, { designSpeedKmh: bad }), (e) => e.name === 'ResolveError' && /design speed/.test(e.message), `${bad}`);
  assert.strictEqual(D.resolve(d, { designSpeedKmh: null }).segments.find((g) => g.part === 'land').landing.speedFrom, 'default');
});
test('a design speed that is not a positive number is refused with a message, and changes nothing', async () => {
  const { shell } = await firstJump();
  const r0 = shell.getState().resolved;
  shell.setDesignSpeed(-5);
  assert.match(shell.getState().message, /design speed/);
  assert.strictEqual(shell.getState().resolved, r0);
});
