// validate_fullspeed.test.js: D256, the keeper's decision (13:2x) on pane E's measurement (exo_memory/loop/design_speed_measure_2026-10-06.md):
// ALWAYS MAX. opts.fullSpeed: an OPEN track's loads at the lap sim's cap (MACH6.vmaxKmh), a CLOSED one on its ghost lap (as the export does);
// the centreline lift-off (leaves-surface) on an open track too; and "holds above N km/h" on a centreline station facing down, red only
// where no speed holds.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const X = require('./validate_paths.js');
const { validate } = require('../src/validate/index.js');
const { G, MACH6, kmh } = require('../src/validate/limits.js');

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b}`);
/** A crest: an arc of a vertical circle of radius R centred BELOW the road, through `angle` rad; the road's up axis points away from the centre. */
function crest(R, angle, { step = 1 } = {}) {
  const out = [], n = Math.round(R * angle / step);
  for (let k = 0; k <= n; k++) {
    const th = -angle / 2 + angle * k / n, T = [0, -Math.sin(th), Math.cos(th)], U = [0, Math.cos(th), Math.sin(th)], L = X.cross(U, T);
    out.push({ s: R * angle * k / n, seg: 0, pos: [0, R * Math.cos(th) - R, R * Math.sin(th)], T, L, U, kvec: [-U[0] / R, -U[1] / R, -U[2] / R] });
  }
  return out;
}
/** A straight road laid UPSIDE DOWN: its drivable side faces the ground, and nothing curves it. */
const upsideDown = (len) => X.straight(len).map((p) => { const U = [0, -1, 0]; return { ...p, U, L: X.cross(U, p.T) }; });
const reasons = (list) => list.map((x) => x.reason);
/** An equation-core road segment (word 'core', as src/core/adapter.js writes them): the roads the two new checks judge (suite reds, D256). */
const core = () => X.seg({ word: 'core' });

test('D256 full speed: an OPEN track is checked at the lap sim\'s cap, 970 km/h, for every word without its own speed', () => {
  const r = validate(X.pathOf(X.loop(20)), [core()], { fullSpeed: true });
  assert.strictEqual(r.speedFrom, 'design');
  assert.ok(r.speed.every((x) => x.v === kmh(MACH6.vmaxKmh)), 'every station at 970 km/h');
});

test('D256 full speed: a CLOSED track is checked on its ghost lap (the export\'s speed), not at a fixed speed', () => {
  const r = validate(X.pathOf(X.loop(20), true), [core()], { fullSpeed: true });
  assert.strictEqual(r.speedFrom, 'lapsim');
});

test('D256 full speed: a word\'s own speed and an explicit design speed still win over it', () => {
  assert.ok(validate(X.pathOf(X.loop(20)), [core()], { fullSpeed: true, designSpeed: 30 }).speed.every((x) => x.v === 30));
  assert.ok(validate(X.pathOf(X.loop(20)), [X.seg({ speed: 25 })], { fullSpeed: true }).speed.every((x) => x.v === 25));
});

test('D256: without fullSpeed an open track still claims no speed (the validator\'s own default is unchanged)', () => {
  assert.strictEqual(validate(X.pathOf(X.loop(20)), [core()], {}).speedFrom, 'none');
});

test('D256 lift-off on an OPEN track: a crest the car flies off at 970 km/h is RED leaves-surface, and is not at 460', () => {
  const R = 3000, A = 0.1, p = X.pathOf(crest(R, A));   // fN = cos θ − v²/(gR): about +0.45 at 460, −1.47 at 970
  const full = validate(p, [core()], { fullSpeed: true });
  assert.ok(reasons(full.red).includes('leaves-surface'), JSON.stringify(full.red));
  const worst = full.red.find((x) => x.reason === 'leaves-surface').worst;
  close(worst, kmh(MACH6.vmaxKmh) ** 2 / (G * R) - Math.cos(A / 2), 1e-6, 'its worst is how far below zero the centreline\'s load goes, in g: at the arc\'s ends, where gravity presses least');
  assert.ok(!reasons(validate(p, [core()], { designSpeed: kmh(460) }).red).includes('leaves-surface'));
});

test('D256 lift-off: a CLOSED track keeps it in the lap proof, so it is not counted twice', () => {
  const r = validate(X.pathOf(X.loop(20), true), [core()], { designSpeed: 1 });   // at 1 m/s the top of a loop lets go
  assert.ok(r.lap.where.some((w) => w.reason === 'leaves-surface'));
  assert.ok(!reasons(r.red).includes('leaves-surface'));
});

test('D256 holds-above: the top of a vertical loop of radius R holds above sqrt(gR), shown as information in km/h', () => {
  const R = 20, r = validate(X.pathOf(X.loop(R)), [core()], {});   // no speed at all: it is the road's shape, not a speed
  const h = r.info.filter((x) => x.reason === 'holds-above');
  assert.ok(h.length > 0, JSON.stringify(r.info));
  close(Math.max(...h.map((x) => x.worst)), Math.sqrt(G * R) * 3.6, 1e-6, 'the highest need is at the top');
  assert.ok(h.every((x) => x.s0 > Math.PI * R / 2 - 2 && x.s1 < 3 * Math.PI * R / 2 + 2), 'only the half past vertical');
  assert.ok(!reasons(r.red).includes('no-speed-holds'));
});

test('D256 holds-above: an upright road shows none', () => {
  for (const p of [X.straight(50), X.leftTurn(50, 1), crest(3000, 0.1)]) assert.ok(!reasons(validate(X.pathOf(p), [core()], {}).info).includes('holds-above'));
});

test('D256 no-speed-holds: a road facing the ground that nothing curves is RED, since no speed holds the car on it', () => {
  const r = validate(X.pathOf(upsideDown(50)), [core()], {});
  assert.ok(reasons(r.red).includes('no-speed-holds'), JSON.stringify(r.red));
  assert.ok(!reasons(r.info).includes('holds-above'));
});

// D256 suite reds: the paused piece builder's word documents are not newly judged by the two checks the keeper's decision added, as the roll-rate bar
// judges only the core's roads (the word builder's S phrase lifts off at its own tempo: measured, flagged, not judged)
test('D256: a word document (the paused piece builder) is not newly judged: no lift-off red on an open track, no holds-above, no no-speed-holds', () => {
  const crestRun = validate(X.pathOf(crest(3000, 0.1)), [X.seg()], { fullSpeed: true });
  assert.ok(!reasons(crestRun.red).includes('leaves-surface'), JSON.stringify(crestRun.red));
  const loopRun = validate(X.pathOf(X.loop(20)), [X.seg()], {});
  assert.ok(!reasons(loopRun.info).includes('holds-above'));
  assert.ok(!reasons(validate(X.pathOf(upsideDown(50)), [X.seg()], {}).red).includes('no-speed-holds'));
});
