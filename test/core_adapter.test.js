// core_adapter.test.js: node --test test/core_adapter.test.js. The ADAPTER (the spec's GO §6): the core's document becomes
// the SAME path samples src/geom builds, so the preview, cameras, mesh, validation and export are reused unchanged.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { toPath, toSegments, profileAt } = require('../src/core/adapter.js');
const G = require('../src/geom/index.js');
const fonts = require('../src/geom/fonts.js');
const { validate } = require('../src/validate/index.js');

const DEG = Math.PI / 180;
const lenv = (a) => Math.hypot(a[0], a[1], a[2]);

function sample() {
  let d = extend(D.createDoc('a', { start: { pos: [10, 5, -3], heading: 0.3 } }), { length: 200, first: { kh: 1 / 400 } });
  d = extend(d, { length: 180, transition: 120, targets: { kh: -1 / 250, kv: 2e-4, phi: 25 * DEG, w: 35 } });
  return extend(d, { length: 150, transition: 150, targets: { kh: 0, kv: 0, phi: 0 } });
}

test('the samples carry exactly the fields src/geom\'s own buildPath emits, from the document\'s start pose', () => {
  const { path } = toPath(sample()), own = G.buildPath([{ length: 10, k0: 0, k1: 0, kp0: 0, kp1: 0, roll0: 0, roll1: 0 }]);
  assert.deepEqual(Object.keys(path.samples[3]).sort(), Object.keys(own.samples[3]).sort());
  assert.deepEqual(path.samples[0].pos.map((x) => +x.toFixed(9)), [10, 5, -3]);
  assert.ok(Math.abs(Math.atan2(path.samples[0].T[0], path.samples[0].T[2]) - 0.3) < 1e-12);
});

test('at the family\'s own rate the core\'s cross-section IS fonts.js\'s (ref 09 §3), and a lower rate lowers the rim', () => {
  for (const f of ['bowl', 'half-pipe', 'flat']) for (const w of [24, 31, 45]) assert.deepEqual(profileAt(f, w, fonts.RATES[f]), fonts.fontProfile(f, { width: w }), `${f} ${w} m`);
  const lo = profileAt('half-pipe', 31.5, 1), hi = profileAt('half-pipe', 31.5, fonts.RATES['half-pipe']);
  assert.ok(lo.psi[lo.psi.length - 1] < hi.psi[hi.psi.length - 1]);
});

test('the samples\' roll is within the smoothstep bound of the φ channel (ref 09 §5), and 2 m chords move the line under 1 cm over 530 m against 0.25 m chords (the stated deviation, measured)', () => {
  const d = sample(), { path, segments } = toPath(d, { segM: 2 }), fine = toPath(d, { segM: 0.25 }).path;
  let worst = 0;
  for (const x of path.samples) {
    const g = segments[x.seg], P = d.pieces.find((q) => q.id === g.id), sp = offsetIn(segments, x.seg) + (x.s - segStart(segments, x.seg));
    // ref 09 §5: the smoothstep's departure from the chord, plus the channel's own departure from the chord, |φ″|·len²/8
    const mid = offsetIn(segments, x.seg) + g.length / 2, curv = Math.abs(D.channelAt(P, 'phi', mid).d2) * g.length ** 2 / 8;
    const bound = (1 / (6 * Math.sqrt(3))) * Math.abs(g.roll1 - g.roll0) + 1.5 * curv + 1e-9;
    worst = Math.max(worst, Math.abs(x.roll - D.channelAt(P, 'phi', sp).v) / bound);
  }
  assert.ok(worst <= 1, `the roll departs by ${worst.toFixed(3)} × its bound`);
  const end = path.samples[path.samples.length - 1].pos, endF = fine.samples[fine.samples.length - 1].pos;
  assert.ok(lenv([end[0] - endF[0], end[1] - endF[1], end[2] - endF[2]]) < 0.01, `end moves ${lenv([end[0] - endF[0], end[1] - endF[1], end[2] - endF[2]])} m`);
});
const segStart = (segs, i) => segs.slice(0, i).reduce((a, g) => a + g.length, 0);
/** where segment i starts inside its own piece: the lengths of that piece's earlier segments */
function offsetIn(segs, i) { const id = segs[i].id; let s = 0; for (let j = 0; j < i; j++) if (segs[j].id === id) s += segs[j].length; return s; }

// CHANGED D258 (the free jump): a flight is ONE gap segment that carries its landing's pose (to) and ends exactly there; no ramp is generated
test('a flight becomes ONE gap segment carrying its landing\'s pose; the road after it starts exactly there; no ramp is generated', () => {
  let d = extend(D.createDoc('j'), { length: 120, first: { kv: 0 } });
  d = extend(d, { length: 60, transition: 60, targets: { kv: 0 } });
  d = D.appendPiece(d, D.flightPiece({ forward: 30, up: -2, pitch: -2 * DEG }));
  d = extend(d, { length: 100 });
  const { segments, path } = toPath(d);
  assert.deepEqual(segments.filter((g) => g.id === 'p3').map((g) => [g.part, g.kind]), [['gap', 'gap']]);
  const lip = segments.findIndex((g) => g.part === 'gap');
  assert.deepEqual(segments[lip].to, { x: [0, -2, 30], theta: 0, p: d.pieces[2].pitch }, 'the pose: left, up, forward; heading turn; pitch (as stored: quantised to 1e-9 rad)');
  const a = path.starts[lip], b = path.starts[lip + 1];
  assert.ok(Math.abs(b.x[2] - a.x[2] - 30) < 1e-9 && Math.abs(b.x[1] - a.x[1] + 2) < 1e-9 && Math.abs(b.p - d.pieces[2].pitch) < 1e-12, 'the landing starts exactly at its pose');
  const res = validate(path, segments, {});
  assert.equal(res.jumps.length, 1);
  for (let i = 1; i < path.samples.length; i++) assert.ok(lenv([0, 1, 2].map((c) => path.samples[i].pos[c] - path.samples[i - 1].pos[c])) <= path.samples[i].s - path.samples[i - 1].s + 1e-6);
});

test('the mesh is built from the adapter\'s output by the unchanged geometry core, with no folds on a gentle track', () => {
  const { path, segments } = toPath(sample()), m = G.buildMesh(path, segments, {});
  assert.equal(m.folds.length, 0);
  assert.ok(m.scene && m.scene.root, 'a scene the export can write');
});

test('an empty track, or a bad step, is refused by name', () => {
  assert.throws(() => toSegments(D.createDoc('e')), (e) => e.code === 'EMPTY');
  assert.throws(() => toSegments(extend(D.createDoc('e'), { length: 10 }), { segM: 0 }), (e) => e.code === 'BAD_STEP');
});
