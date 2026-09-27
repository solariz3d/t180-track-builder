// doc-connector.test.js: node --test test/*.test.js
// The font-transition ramp (the design ruling, 2026-09-27: "Fonts RAMP; they never jump … default 20 m …
// user-sculptable as a handle") and the close-the-loop connector (ARCHITECTURE §2 :50-51, "a connector solved from
// the end conditions (G1/G2 clothoid fitting). Candidates are ranked by their worst physics margin").
//
// TOLERANCES, stated before the first run: the loop closes to the geometry's own bar, 1e-3 m in position and 1e-6 in
// tangent (src/geom/path.js closeTol and its tangent check), and to G2: curvature continuous at both joins, within 1e-12.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/doc/index.js');
const C = require('../src/doc/connector.js');
const G = require('../src/geom/index.js');

const DEG = Math.PI / 180;

// ── the transition ramp ────────────────────────────────────────────────────────────────────────────────────────────
test('every road word carries a font transition, 20 m by default', () => {
  const d = D.appendWord(D.appendWord(D.createDoc(), 'straight'), 'turn');
  assert.deepEqual(d.words.map((w) => w.handles.ramp), [20, 20]);
  assert.ok(!('ramp' in D.appendWord(D.createDoc(), 'jump').words[0].handles), 'a jump has no surface to ramp');
});

test('the transition round-trips byte-exact, sculpted or not', () => {
  let d = D.appendWord(D.appendWord(D.createDoc(), 'straight'), 'turn', { font: 'half-pipe' });
  d = D.editWord(d, 'w2', { handles: { ramp: 35.25 } });
  const t = D.serialize(d);
  assert.match(t, /"ramp":35\.25/);
  assert.equal(D.serialize(D.parse(t)), t);
});

test('sculpting the transition is one undo step, and undo is byte-identical', () => {
  let h = D.createHistory(D.appendWord(D.appendWord(D.createDoc(), 'straight'), 'turn'));
  const before = D.serialize(h.present);
  h = D.commit(h, D.editWord(h.present, 'w2', { handles: { ramp: 50 } }));
  assert.equal(h.past.length, 1);
  assert.equal(D.serialize(D.undo(h).present), before);
});

test('fonts never jump: a transition shorter than 1 m is refused', () => {
  assert.throws(() => D.appendWord(D.createDoc(), 'turn', { handles: { ramp: 0 } }), (e) => e.code === 'HANDLE_RANGE');
});

// ── the connector ──────────────────────────────────────────────────────────────────────────────────────────────────
/** Three quarters of a lap: the head is off to the side of the start, facing back across it. */
function openLap() {
  let d = D.createDoc('lap');
  for (const [w, o] of [['straight', { handles: { length: 150 } }], ['tight'], ['straight', { handles: { length: 120, climb: 2 * DEG } }],
    ['tight', { handles: { climb: -2 * DEG } }], ['straight', { handles: { length: 80 } }]]) d = D.appendWord(d, w, o);
  return d;
}
const plainOpen = (d) => ({ ...d, closed: false });
// One closeLoop takes seconds (every start is a Newton solve, every candidate a validated lap), so the lap's result is
// computed once and shared; the determinism test makes its own second call.
let LAP_R = null;
const lap = () => (LAP_R || (LAP_R = C.closeLoop(openLap())));

test('a candidate connector closes the loop to the geometry\'s own bar: 1e-3 m and 1e-6 in tangent', () => {
  const r = lap();
  assert.ok(r.candidates.length > 0, r.reason);
  for (const c of r.candidates) {
    assert.ok(c.closure.position <= 1e-3, `${c.closure.position} m`);
    assert.ok(c.closure.tangent <= 1e-6, `${c.closure.tangent}`);
    const segs = D.resolve(plainOpen(c.doc)).segments;
    assert.doesNotThrow(() => G.buildPath(segs, { step: 1, closed: true }));
  }
});

test('the connector is G2: curvature is continuous where it leaves the head and where it meets the start', () => {
  const d = openLap(), c = lap().candidates[0], segs = D.resolve(plainOpen(c.doc)).segments;
  const n0 = D.resolve(d).segments.length;
  assert.ok(Math.abs(segs[n0].k0 - segs[n0 - 1].k1) < 1e-12 && Math.abs(segs[n0].kp0 - segs[n0 - 1].kp1) < 1e-12, 'at the head');
  const last = segs[segs.length - 1], first = segs[0];
  assert.ok(Math.abs(last.k1 - first.k0) < 1e-12 && Math.abs(last.kp1 - first.kp0) < 1e-12, 'at the start');
});

test('the chosen connector is ordinary words appended at the head, and the document is marked closed', () => {
  const d = openLap(), c = lap().candidates[0];
  assert.equal(c.doc.closed, true);
  assert.deepEqual(c.doc.words.slice(0, d.words.length), d.words, 'the track before the connector is untouched');
  assert.ok(c.doc.words.length > d.words.length);
  assert.ok(c.doc.words.slice(d.words.length).every((w) => D.WORDS[w.word] && w.phrase === undefined));
});

test('closing is one undo step, and undo gives back the open document byte-identical', () => {
  let h = D.createHistory(openLap());
  const before = D.serialize(h.present);
  h = D.commit(h, lap().candidates[0].doc);
  assert.equal(h.past.length, 1);
  assert.equal(D.serialize(D.undo(h).present), before);
});

test('candidates are ranked by their worst physics margin: the safest first, and the margin is validation\'s own', () => {
  const r = lap();
  assert.ok(r.candidates.length >= 2, `only ${r.candidates.length} candidate(s)`);
  for (let i = 1; i < r.candidates.length; i++) {
    const a = r.candidates[i - 1], b = r.candidates[i];
    assert.ok(a.red <= b.red && (a.red < b.red || a.margin >= b.margin), `rank ${i}: ${a.red}/${a.margin} before ${b.red}/${b.margin}`);
  }
  const top = r.candidates[0];
  // the margin covers the connector (s from the old head on): the rest of the track is the same in every candidate
  assert.equal(C.marginOf(top.doc, { ...r.opts, connectorFromS: top.fromS }).margin, top.margin, 'the rank uses the same margin validation reports');
});

test('a candidate\'s worst load is validation\'s largest specific force on the CONNECTOR, not on the whole lap', () => {
  // Computed here without the connector's own code: build the closed lap, validate it at the same design speed, and take
  // the largest f_g at or after the old head.
  const V = require('../src/validate/index.js');
  const r = lap(), top = r.candidates[0], v = r.opts.speedKmh / 3.6;
  const segs = D.resolve(plainOpen(top.doc)).segments.map((g) => ({ ...g, speed: v }));
  const res = V.validate(G.buildPath(segs, { step: r.opts.step, closed: true }), segs, {});
  const onConnector = Math.max(...res.lines.filter((l) => l.s >= top.fromS - 1e-9).map((l) => l.f_g));
  const wholeLap = Math.max(...res.lines.map((l) => l.f_g));
  assert.equal(top.maxG, onConnector);
  assert.ok(wholeLap > onConnector, 'this lap is harder elsewhere than on the connector, so the two regions are told apart');
});

test('an impossible gap gives no candidate, and says why instead of faking one', () => {
  // Climb 2 km away from the start, then allow only small radii and a 10° climb: the connector cannot come down.
  let d = D.createDoc('cliff');
  for (const [w, o] of [['straight', { handles: { length: 100, climb: 30 * DEG } }], ['straight', { handles: { length: 4000 } }],
    ['straight', { handles: { length: 100, climb: -30 * DEG } }]]) d = D.appendWord(d, w, o);
  const r = C.closeLoop(d, { radii: [60], maxClimbDeg: 10 });
  assert.deepEqual(r.candidates, []);
  assert.match(r.reason, /no connector/i);
  assert.match(r.reason, /climb/i);
});

test('closing an empty or already closed document is refused by name', () => {
  assert.throws(() => C.closeLoop(D.createDoc()), (e) => e.code === 'EMPTY_DOC');
  const c = lap().candidates[0];
  assert.throws(() => C.closeLoop(c.doc), (e) => e.code === 'ALREADY_CLOSED');
});

test('the connector is deterministic: the same document gives the same candidates, byte for byte', () => {
  const a = lap(), b = C.closeLoop(openLap());
  assert.deepEqual(a.candidates.map((c) => D.serialize(c.doc)), b.candidates.map((c) => D.serialize(c.doc)));
});
