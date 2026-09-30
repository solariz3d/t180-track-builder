// core_cup_readers.test.js: node --test test/core_cup_readers.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D190 R1/R2 follow-up: a cup's segments carry a BLEND (the seamless scheme, adapter.js), so `segment.profile` alone is the blend's TARGET (the run's
// widest cross-section) for the whole segment. Every reader of it that is not the mesh must evaluate the blend at its station (src/geom/profile.js
// atSegment, the way markers/place.js and geom/pitlane.js already do): the marker layout's floor, validation, the water, the camera's span, and
// the export's sections. Each test below fails if that reader goes back to reading segment.profile.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const S = require('../src/core/sculpt.js');
const A = require('../src/core/adapter.js');
const PF = require('../src/geom/profile.js');
const Markers = require('../src/markers/layout.js');
const { validate } = require('../src/validate/index.js');
const FW = require('../src/export/fromwords.js');
const { profilerOf } = require('../app/core/coreshell.js');
const { widthAtHead } = require('../app/preview/preview.js');

const DEG = Math.PI / 180;
const edgeDeg = (P) => P.psi[P.psi.length - 1] / DEG;
/** A track with a legacy start straight and a cup ramp (15.5 → target) over `trans` m, and its path and segments (the seamless default). */
function ramp({ target = 90, trans = 100, len = 250, straight = 60, family = 'bowl', kh } = {}) {
  let d = extend(D.createDoc('rd'), { length: straight, family });
  d = extend(d, { length: len, transition: trans, targets: { c: target, ...(kh ? { kh } : {}) } });
  const { segments, path } = A.toPath(d); return { d, segments, path, P: d.pieces[1] };
}

test('atSegment: the profile at d = 0 is the blend\'s `from`, at the segment\'s end the mix at its end weight, and a segment with no blend is its own profile', () => {
  const { segments, P } = ramp({ target: 120, trans: 60 }), g = segments.find((x) => x.id === 'p2' && x.blend);
  assert.ok(g, 'a cup segment with a blend');
  const a = PF.atSegment(g, 0), b = PF.atSegment(g, g.length);
  const w1 = PF.smoothstep((g.blend.s0 + g.length) / g.blend.length), from = PF.normalize(g.blend.from), own = PF.normalize(g.profile);
  assert.deepEqual(a.psi, PF.blend(from, own, PF.smoothstep(g.blend.s0 / g.blend.length)).psi);
  assert.ok(Math.abs(edgeDeg(b) - ((1 - w1) * edgeDeg(from) + w1 * edgeDeg(own))) < 1e-9);
  const plain = segments[0]; assert.deepEqual(PF.atSegment(plain, 3), PF.normalize(plain.profile));
  assert.ok(P.cup);
});
test('a word document font-transition blend is NOT evaluated by the readers, only a cup: readAt gives the own profile for a blended segment without the cup mark (the paused piece builder validation, layout and export read as before)', () => {
  const own = A.cupProfile('bowl', 31, 90), from = A.cupProfile('bowl', 31, 20), g = { kind: 'road', length: 2, profile: own, blend: { from, s0: 0, length: 2 } };
  const near = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-12);
  assert.ok(near(PF.readAt(g, 0).psi, PF.normalize(own).psi)); assert.ok(near(PF.readAt({ ...g, cup: true }, 0).psi, PF.normalize(from).psi));
});
test('atSegment lands on the document\'s c along the ramp: the edge of the cross-section at a station is c(s) within 0.05° (a reader that took segment.profile would read the run\'s widest, 90°, at the start)', () => {
  const { segments, path, P } = ramp({ target: 90, trans: 100 }); let start = 0, worst = 0;
  for (const g of segments) { if (g.id === 'p2') break; start += g.length; }
  const starts = []; let a = 0; for (const g of segments) { starts.push(a); a += g.length; }
  for (const m of path.samples) { const g = segments[m.seg]; if (g.id !== 'p2') continue; worst = Math.max(worst, Math.abs(edgeDeg(PF.atSegment(g, m.s - starts[m.seg])) - D.channelAt(P, 'c', m.s - start).v)); }
  assert.ok(worst <= 0.05, `worst ${worst}°`);
});
test('marker layout: a straight running into a cupped turn keeps the width of the straight (the grid is not refused as "too narrow" by the turn\'s 150° target)', () => {
  const { d, segments, path } = ramp({ target: 150, trans: 40, len: 283, straight: 300, kh: 1 / 180 });
  const STRAIGHT_K = 1 / 5000, nearly = (g) => g.kind === 'road' && [g.k0, g.k1, g.kp0, g.kp1].every((x) => Math.abs(x) <= STRAIGHT_K) && [g.roll0, g.roll1].every((x) => Math.abs(x) <= 0.5 * Math.PI / 180);
  const marked = segments.map((g) => (nearly(g) ? { ...g, word: 'straight', k0: 0, k1: 0, kp0: 0, kp1: 0, roll0: 0, roll1: 0 } : g));
  assert.ok(marked.filter((g, i) => nearly(segments[i]) && g.id === 'p2').length >= 1, 'the turn\'s first segments are nearly straight: they join the straight\'s run');
  let lay; assert.doesNotThrow(() => { lay = Markers.defaultLayout(path, marked); });
  assert.ok(lay && typeof lay === 'object', 'a layout came out');
  assert.ok(d.pieces[1].cup);
});
test('validation: with csp off the first steep-without-raycast red is where the wall PASSES 50° (c(s) = 50, about 47 m into a 100 m ramp), not at the ramp\'s start (the run\'s widest, 90°)', () => {
  const { segments, path, P } = ramp({ target: 90, trans: 100, len: 250 });
  const v = validate(path, segments, { csp: false }), reds = v.red.filter((r) => r.reason === 'steep-without-raycast');
  assert.ok(reds.length, 'the ramp reaches 90°: it is steep');
  let cAt = null; for (let s = 0; s <= P.length; s += 0.1) if (D.channelAt(P, 'c', s).v >= 50) { cAt = s; break; }
  const first = Math.min(...reds.map((r) => r.s0));
  assert.ok(first >= 60 + cAt - 1 && first <= 60 + cAt + 3, `the first steep red is at s ${first}, c reaches 50° at s ${60 + cAt}`);
});
test('export sections: the section at a station is the road as drawn there (its maxPsi is c(s)), not the run\'s widest', () => {
  const { segments, path, P } = ramp({ target: 90, trans: 100, len: 250 });
  const { secs } = FW._internal.aiInput(segments, path), st = FW._internal.stations(path), i = st.findIndex((m) => m.s >= 60 + 10 - 1e-9);
  assert.ok(Math.abs(secs[i].font[1] - D.channelAt(P, 'c', st[i].s - 60).v) <= 0.05, `${secs[i].font[1]}° vs c ${D.channelAt(P, 'c', st[i].s - 60).v}°`);
});
test('water: the profile under a sample is the road as drawn there (the edge is c(s)), and a segment without a blend still gives its own profile object', () => {
  const { segments, path, P } = ramp({ target: 90, trans: 100, len: 250 }), pr = profilerOf(path, segments);
  const m = path.samples.find((x) => x.s >= 60 + 20), got = edgeDeg(PF.normalize(pr(m)));
  assert.ok(Math.abs(got - D.channelAt(P, 'c', m.s - 60).v) <= 0.05, `${got}° vs ${D.channelAt(P, 'c', m.s - 60).v}°`);
  const legacy = path.samples.find((x) => segments[x.seg].id === 'p1'); assert.equal(pr(legacy), segments[legacy.seg].profile);
});
test('camera: the width at the head is the last segment\'s cross-section at the head (a cup brushed down at its end reads the lowered c, not the run\'s widest)', () => {
  const { d, P } = ramp({ target: 120, trans: 40, len: 200 });
  const b = S.brush(d, { mode: 'value', channel: 'c', s0: 260, r: 25, delta: -70 }).doc, segs = A.toSegments(b), Q = b.pieces[1];
  const cEnd = D.channelAt(Q, 'c', Q.length).v, w = D.channelAt(Q, 'w', Q.length).v;
  assert.ok(cEnd < 80, `the brush lowered the end to ${cEnd}°`);
  assert.ok(Math.abs(widthAtHead(segs) - PF.spanOf(A.cupProfile('bowl', w, cEnd))) < 0.02, `${widthAtHead(segs)} vs ${PF.spanOf(A.cupProfile('bowl', w, cEnd))}`);
  assert.ok(P.cup);
});
