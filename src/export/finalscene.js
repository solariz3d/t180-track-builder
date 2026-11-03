// finalscene.js: THE FINAL-SCENE CHECK. It runs on the scene the kn5 is about to be written from (world space, flattened and welded, beside acready.js
// findFins), because validation (src/validate) reads the road and the pit lane BEFORE the underside skin, the edge apron and the catch are added, and
// the fin guard reads only the road's seams. Each defect below is the builder's, never the track's; each was shipped once and caught only by a test.
//
//   checkFinalScene(scene, { path, segments, lane, open }) -> { refuse: [finding], warn: [finding] }   (open: the track's two ends are open by design; so is a
//   jump's lip and its landing)
//     finding: { kind, piece, s, u, count, message }   (s along the road, u across it, left +, at the worst one found)
//
// REFUSED (a surface the car drives on: a builder fault the driver would hit):
//   across   a drivable triangle that stands across the road, its normal within ACROSS_DEG of the road's direction: a step in the road's edge, or a cap
//            across a lane's end (the pit notch: a plank capping the lane's 0.5 m end). A seam's zip fan between two fonts stands in the cross-section
//            plane by design and is the fin guard's to judge (acready.js findFins), so a seam is not read here
//   lane     the pit lane wider than LANE_END_M where it leaves or rejoins the road: a step that wide in the road's edge (the notch's cause)
//   open     an edge of a drivable surface that no other surface closes, by DRIVE_CRACK_M or more: a crack in the road (an opening's slot tips). Under
//            it, the downforce-ray check would weld the two sides as one (src/validate/raygap.js, 5 mm), and so is the car's ray
// WARNED (drawn only: a builder fault the eye would see):
//   open     the same on a drawn-only surface, by SKY_CRACK_M or more: a line of sky through the skin (a closed ring's piece joints, 19 mm to 3 cm)
//   fold     in one piece, the skin bends across the road more than the road it hangs under, plus FOLD_SLACK_DEG (the jag where a tube opens or closes).
//            A seam's zipper stands in the cross-section plane by design and is not read
//   bottom   beside an open road edge, the hull's bottom steps by more than BOTTOM_STEP_M in a metre against the bottom either side (the step under the
//            pit lane's leave; a hull that deepens evenly, under a rising edge, is a slope, not a step). It is read only on pieces that never curl into a
//            wall side or a tube, BOTTOM_CLEAR_M clear of one: the hull there thins and turns by design, and the fold reads it
//   sliver   a drawn or driven triangle thinner than acready.js SLIVER, its height over its longest edge (a zipper of zero-width strips)
//   through  a drawn face (the skin, the hull's side) that passes through the road, the apron or the pit lane of ANOTHER pass (its station more than PASS_M away
//            along the road, both ways round a closed lap): the hull hung through a pass running under it (ELYSIUM's p38 over p41's apron). Read only in the
//            4 m cells that hold drivable faces of two passes; a cell that holds the lap's start and its end is one pass, so a crossing right at a closed
//            lap's start line is not read. A drawn face is another pass's only if EVERY one of its corners is: each corner's station is walked along the road
//            from the face's own (a light hull's long triangle runs tens of metres, across a piece joint, and its centre alone made it another pass's at the next
//            piece's apron), and it must stand THROUGH_MIN_M or more out of the surface (a corner on it only touches)
//
// Measured as the tests that first caught each one measure it: test/export_apron.test.js rows 22 and 26, test/tube_cases.test.js rows 2, 3 and 4.
// Not read: the catch (a second sheet under the road, open by design), the painted markers (decals laid on the road) and the test route's end wall; nor a
// road with no equation-core piece, which has no hull (only its pit lane's ends are read there).
'use strict';
const Prof = require('../geom/profile.js');
const { SLIVER } = require('./acready.js');

const DEG = Math.PI / 180;
const ACROSS_DEG = 25;        // a drivable face this close to facing along the road stands across it (export_apron row 22's bar)
const LANE_END_M = 0.1;       // the pit lane's width where it leaves and rejoins: the road's edge steps by this much there (row 22)
const FOLD_SLACK_DEG = 10;    // how far past the road's own largest bend across the road the skin's may go in a piece (tube_cases row 2)
const BOTTOM_STEP_M = 0.03;   // the most a metre of the hull's bottom beside an edge may step against the bottom either side of it (row 26)
const BOTTOM_IN_M = 0.5;      // the bottom is read this far in from the road's edge (row 26)
const BOTTOM_ABOVE_M = 3;     // from this far above the road's own surface there, down its normal
const SAME_PASS_M = 10;       // a surface whose own station lies further along the track than this is another pass's, and is not read
const PASS_M = 25;            // `through`: a drivable face this far along the road from a drawn one is another pass's (src/geom/bvh.js minSeparationM)
const PASS_CELL_M = 4;        // `through`: the cells the drivable faces are filed in by station
const THROUGH_MIN_M = 0.01;   // `through`: a drawn face standing out of the other pass's surface by less than this only touches it (a centimetre, SKY_CRACK_M's floor)
const BOTTOM_PSI_MAX = 45 * DEG;   // the bottom is read only on a section this flat: a wall side or a tube has no bottom beside its edge
const CURL_PSI = 60 * DEG;    // a piece whose section turns past this anywhere curls into a wall side or a tube
const BOTTOM_CLEAR_M = 25;    // and the bottom is read only this far clear of one: its twisted zone, the 4 m pad and the 10 m ease (underskin.js), with margin
const WELD = 1e-3;            // vertices this close are one
const COVER = 2e-3;           // a boundary edge lying within this of another boundary edge is covered (a T-junction), not open (tube_cases row 3)
const DRIVE_CRACK_M = 5e-3;   // an open drivable edge this far from any other surface is a crack in the road (the ray check's own weld, raygap.js)
const SKY_CRACK_M = 0.01;     // an open drawn edge this far from any other surface is a line of sky (export_apron row 18's 1 cm floor)
const END_M = 4;              // an open track's own two ends are open by design
const LISTED = 12;            // findings listed in one message; the rest are counted

const family = (name) => (/CATCH/.test(name) ? null : /^1ROAD_APRON/.test(name) ? 'apron' : /^1ROAD_PIT/.test(name) ? 'pit' : /^1(?:ROAD|GRIP\d{3})_/.test(name) ? 'road'
  : /^UNDERSKIN_/.test(name) ? 'skin' : /^(?:APRONSIDE|APRONLIP)_/.test(name) ? 'join' : null);
const zipper = (name) => /seam|_join_/i.test(name);   // a seam's zipper between two pieces' rows, in the cross-section plane (the road's 'seam', the skin's '_join_')
const DRIVABLE = new Set(['road', 'apron', 'pit']);
const NAMES = { road: 'the road', apron: 'the edge apron', pit: 'the pit lane', skin: 'the underside skin', join: 'the hull\'s side' };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The distance from p to the triangle (a, b, c): its closest point by region (Ericson, Real-Time Collision Detection 5.1.5). */
function pointTriangle(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap), at = (o, e, t) => [o[0] + e[0] * t, o[1] + e[1] * t, o[2] + e[2] * t];
  let q;
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp), cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp), vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) q = b;
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) q = at(a, ab, d1 / (d1 - d3));
    else if (d6 >= 0 && d5 <= d6) q = c;
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) q = at(a, ac, d2 / (d2 - d6));
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) q = at(b, sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
    else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]; }
  }
  return Math.hypot(...sub(p, q));
}

/**
 * The path's samples as plain arrays, and a nearest-sample finder: a search by grid for a seed, then a walk along the samples from it. Given a piece's
 * range of samples, both keep to it: a mesh is its own piece's (the cell names carry the piece), so a road that passes close by another, over or beside
 * it, is never read against the other's stations.
 */
function samplesOf(path, segments) {
  const S = path.samples.map((q) => ({ s: q.s, pos: q.pos.slice(), T: q.T.slice(), L: q.L.slice(), U: q.U.slice(), seg: q.seg }));
  const range = new Map();
  S.forEach((q, i) => { const id = segments[q.seg] && segments[q.seg].id; if (id === undefined) return; const r = range.get(id); if (r) r.hi = i; else range.set(id, { lo: i, hi: i }); });
  const C = 10, grid = new Map(), cellOf = (p) => p.map((x) => Math.floor(x / C));
  S.forEach((q, i) => { const k = cellOf(q.pos).join(','); let L = grid.get(k); if (!L) grid.set(k, (L = [])); L.push(i); });
  const d2 = (i, p) => { const a = S[i].pos; return (a[0] - p[0]) ** 2 + (a[1] - p[1]) ** 2 + (a[2] - p[2]) ** 2; };
  const seed = (p, r) => {
    const c = cellOf(p), lo = r ? r.lo : 0, hi = r ? r.hi : S.length - 1;
    for (let k = 1; k <= 4; k++) {
      let best = -1, bd = Infinity;
      for (let i = -k; i <= k; i++) for (let j = -k; j <= k; j++) for (let l = -k; l <= k; l++) { const L = grid.get(`${c[0] + i},${c[1] + j},${c[2] + l}`); if (L) for (const x of L) { if (x < lo || x > hi) continue; const d = d2(x, p); if (d < bd) { bd = d; best = x; } } }
      if (best >= 0) return best;
    }
    let best = lo; for (let x = lo + 1; x <= hi; x++) if (d2(x, p) < d2(best, p)) best = x; return best;
  };
  const walk = (i, p, r) => {
    const lo = r ? r.lo : 0, hi = r ? r.hi : S.length - 1; let d = d2(i, p);
    for (;;) { if (i + 1 <= hi && d2(i + 1, p) < d) { i++; d = d2(i, p); } else if (i - 1 >= lo && d2(i - 1, p) < d) { i--; d = d2(i, p); } else return i; }
  };
  return { S, seed, walk, range };
}

/**
 * Integer triples numbered in the order first seen, in an open-addressed table of typed arrays (in place of a Map keyed by "x,y,z" strings): id(x, y, z)
 * -> the triple's number; size: how many there are.
 */
function tripleIds() {
  let cap = 1 << 16, K = new Int32Array(3 * cap), V = new Int32Array(cap).fill(-1), size = 0;
  const slot = (x, y, z, K, V, cap) => {
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (cap - 1);
    while (V[h] >= 0 && (K[3 * h] !== x || K[3 * h + 1] !== y || K[3 * h + 2] !== z)) h = (h + 1) & (cap - 1);
    return h;
  };
  const grow = () => {
    const c2 = 2 * cap, K2 = new Int32Array(3 * c2), V2 = new Int32Array(c2).fill(-1);
    for (let h = 0; h < cap; h++) if (V[h] >= 0) { const g = slot(K[3 * h], K[3 * h + 1], K[3 * h + 2], K2, V2, c2); K2[3 * g] = K[3 * h]; K2[3 * g + 1] = K[3 * h + 1]; K2[3 * g + 2] = K[3 * h + 2]; V2[g] = V[h]; }
    cap = c2; K = K2; V = V2;
  };
  return {
    id(x, y, z) {
      let h = slot(x, y, z, K, V, cap);
      if (V[h] < 0) { if (2 * (size + 1) > cap) { grow(); h = slot(x, y, z, K, V, cap); } K[3 * h] = x; K[3 * h + 1] = y; K[3 * h + 2] = z; V[h] = size++; }
      return V[h];
    },
    get size() { return size; },
  };
}

/**
 * Edges by their two vertex ids (a < b), grouped in the order first seen, in typed arrays (the table grows at three quarters full): add(a, b, slot) files one triangle's edge (slot = 3 x the
 * triangle + which edge); then, per group g < size, count[g] (to 3: more is 3), and first[g] and second[g], the first two slots filed.
 */
function edgeGroups() {
  let cap = 1 << 16, KA = new Int32Array(cap), KB = new Int32Array(cap), G = new Int32Array(cap).fill(-1), size = 0, gcap = 1 << 15;
  const out = { first: new Int32Array(gcap), second: new Int32Array(gcap), count: new Uint8Array(gcap), get size() { return size; } };
  const slot = (a, b, KA, KB, G, cap) => { let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) & (cap - 1); while (G[h] >= 0 && (KA[h] !== a || KB[h] !== b)) h = (h + 1) & (cap - 1); return h; };
  const grow = () => {
    const c2 = 2 * cap, A2 = new Int32Array(c2), B2 = new Int32Array(c2), G2 = new Int32Array(c2).fill(-1);
    for (let h = 0; h < cap; h++) if (G[h] >= 0) { const g = slot(KA[h], KB[h], A2, B2, G2, c2); A2[g] = KA[h]; B2[g] = KB[h]; G2[g] = G[h]; }
    cap = c2; KA = A2; KB = B2; G = G2;
  };
  const more = (T, n) => { const U = new T.constructor(n); U.set(T); return U; };
  out.add = (a, b, s) => {
    let h = slot(a, b, KA, KB, G, cap);
    if (G[h] < 0) {
      if (4 * (size + 1) > 3 * cap) { grow(); h = slot(a, b, KA, KB, G, cap); }
      if (size === gcap) { gcap *= 2; out.first = more(out.first, gcap); out.second = more(out.second, gcap); out.count = more(out.count, gcap); }
      KA[h] = a; KB[h] = b; G[h] = size; out.first[size] = s; out.count[size] = 1; size++;
      return;
    }
    const g = G[h];
    if (out.count[g] === 1) out.second[g] = s;
    if (out.count[g] < 3) out.count[g]++;
  };
  return out;
}

/**
 * How far the drawn triangle v stands out of the drivable triangle w (unit normal n, its drivable side) over w ITSELF: v clipped to the prism on w (its three edge
 * planes along n, Sutherland-Hodgman), then the clipped polygon's highest point over w's plane; 0 when nothing of v is over w on its drivable side. Over w's
 * infinite plane a long skin triangle tilted to the road stood 179 mm "out" of a road it only grazed by 5 mm (export_finalscene row 12).
 */
function standOut(v, w, n) {
  let poly = v.map((p) => p.slice());
  for (let e = 0; e < 3 && poly.length; e++) {
    const a = w[e], b = w[(e + 1) % 3], c = w[(e + 2) % 3]; let m = cross(n, sub(b, a)); if (dot(sub(c, a), m) < 0) m = m.map((x) => -x);
    const side = (p) => dot(sub(p, a), m), out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]); }
    }
    poly = out;
  }
  return poly.reduce((h, p) => Math.max(h, dot(sub(p, w[0]), n)), 0);
}

/** Group findings by kind, piece and family, each with its count and its worst place, into one message apiece. */
function grouped(list, say) {
  const by = new Map();
  for (const f of list) { const k = `${f.kind}|${f.piece}|${f.fam || ''}`; const g = by.get(k); if (!g) by.set(k, { ...f, count: 1 }); else { g.count++; if (f.worst > g.worst) Object.assign(g, { worst: f.worst, s: f.s, u: f.u }); } }
  const out = [...by.values()].sort((a, b) => a.s - b.s);
  return out.map((g) => ({ kind: g.kind, piece: g.piece, s: g.s, u: g.u, count: g.count, message: say(g) }));
}
const place = (s, u) => `${(s / 1000).toFixed(2)} km (s ${s.toFixed(0)} m)${u === null || u === undefined ? '' : `, ${Math.abs(u).toFixed(1)} m ${u >= 0 ? 'left' : 'right'} of the centre`}`;

function checkFinalScene(scene, { path, segments, lane = null, open = false, detail = false } = {}) {
  if (!scene || !scene.root || !path || !Array.isArray(path.samples) || !path.samples.length || !Array.isArray(segments)) throw new Error('checkFinalScene needs the scene, the path and its segments');
  const { S, seed, walk, range } = samplesOf(path, segments), sEnd = S[S.length - 1].s, pieceOf = (q) => (segments[q.seg] && segments[q.seg].id) || `segment ${q.seg}`;
  // an open track's own two ends, and a jump's take-off and landing (its road stops at the lip and starts again at the landing, open by design, as
  // src/validate/raygap.js reads them), are not read within END_M
  const isGap = (j) => !!(segments[j] && segments[j].kind === 'gap'), lips = [];
  for (let i = 1; i < S.length; i++) { let gap = isGap(S[i].seg) !== isGap(S[i - 1].seg); for (let j = S[i - 1].seg + 1; j < S[i].seg && !gap; j++) gap = isGap(j); if (gap) lips.push(S[i - 1].s, S[i].s); }
  const atEnd = (q) => (open && (q.s < S[0].s + END_M || q.s > sEnd - END_M)) || lips.some((x) => Math.abs(q.s - x) < END_M);
  const refuse = [], warn = [], across = [], opens = [], thin = [], hairline = [], cosAcross = Math.cos(ACROSS_DEG * DEG);

  // every triangle of the hull's surfaces, with its welded vertex ids, its normal, its thickness and its nearest sample. They are held in typed arrays, one
  // row a triangle, and read through tri(i), a view made when it is read: as one object each (and a string key per vertex), ELYSIUM's 3.5 million kept
  // 3.6 GB alive in the check, and its export ran out of memory under a 4 GB heap
  let ids = tripleIds();
  const vid = (x, y, z) => {
    const k = [Math.round(x / WELD), Math.round(y / WELD), Math.round(z / WELD)];
    if (!k.every((w) => Math.abs(w) <= 0x7fffffff)) throw new Error(`checkFinalScene: a vertex at (${x}, ${y}, ${z}) is not a finite point within 2,000 km of the origin`);
    return ids.id(k[0], k[1], k[2]);
  };
  // the hull (skin, apron, side) is built on an equation-core road only (underskin.js, apron.js); a word document's road is a surface with open edges by design, and
  // validation reads it, so on a road with no core piece only the pit lane's ends are read here
  const hulled = segments.some((g) => g && g.word === 'core'), meshes = [];
  for (const m of hulled ? scene.root.children : []) {
    if (m.type !== 'mesh' || !m.indices || !m.indices.length) continue;
    const f = family(m.name);
    if (!f || (!DRIVABLE.has(f) && (m.visible === false || m.renderable === false))) continue;
    const pm = /_(p\d+)_/.exec(m.name);
    meshes.push({ m, f, r: pm ? range.get(pm[1]) : null, zip: zipper(m.name) });
  }
  const N = meshes.reduce((a, x) => a + Math.ceil(x.m.indices.length / 3), 0);
  let tIds = new Int32Array(3 * N);
  const tMesh = new Int32Array(N), tAt = new Int32Array(N), tQ = new Int32Array(N), tN = new Float64Array(3 * N), tHasN = new Uint8Array(N);
  const corner = (i, k) => { const m = meshes[tMesh[i]].m, P = m.positions, a = 3 * m.indices[tAt[i] + k]; return [P[a], P[a + 1], P[a + 2]]; };
  class Tri {
    constructor(i) { this.i = i; this._v = null; }
    get mesh() { return meshes[tMesh[this.i]].m.name; }
    get f() { return meshes[tMesh[this.i]].f; }
    get zip() { return meshes[tMesh[this.i]].zip; }
    get q() { return S[tQ[this.i]]; }
    get v() { return this._v || (this._v = [corner(this.i, 0), corner(this.i, 1), corner(this.i, 2)]); }
    get n() { const i = 3 * this.i; return tHasN[this.i] ? [tN[i], tN[i + 1], tN[i + 2]] : null; }
    get u() { const v = this.v, q = this.q, cen = [(v[0][0] + v[1][0] + v[2][0]) / 3, (v[0][1] + v[1][1] + v[2][1]) / 3, (v[0][2] + v[1][2] + v[2][2]) / 3]; return dot(sub(cen, q.pos), q.L); }
  }
  const tri = (i) => new Tri(i);
  let ti = 0;
  meshes.forEach(({ m, f, r, zip }, mi) => {
    const P = m.positions, I = m.indices; let qi = -1;
    for (let t = 0; t < I.length; t += 3, ti++) {
      const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2], v = [[P[a], P[a + 1], P[a + 2]], [P[b], P[b + 1], P[b + 2]], [P[c], P[c + 1], P[c + 2]]];
      const e1 = sub(v[1], v[0]), e2 = sub(v[2], v[0]), n = cross(e1, e2), area2 = Math.hypot(...n), longest = Math.max(Math.hypot(...e1), Math.hypot(...e2), Math.hypot(...sub(v[2], v[1])));
      const cen = [(v[0][0] + v[1][0] + v[2][0]) / 3, (v[0][1] + v[1][1] + v[2][1]) / 3, (v[0][2] + v[1][2] + v[2][2]) / 3];
      qi = qi < 0 ? seed(cen, r) : walk(qi, cen, r);
      const q = S[qi], thick = longest > 0 ? area2 / longest : 0, u = dot(sub(cen, q.pos), q.L);
      tMesh[ti] = mi; tAt[ti] = t; tQ[ti] = qi;
      for (let k = 0; k < 3; k++) tIds[3 * ti + k] = vid(...v[k]);
      const nu = thick >= SLIVER ? n.map((x) => x / area2) : null;
      if (nu) { tHasN[ti] = 1; tN[3 * ti] = nu[0]; tN[3 * ti + 1] = nu[1]; tN[3 * ti + 2] = nu[2]; }
      if (atEnd(q)) continue;
      if (thick < SLIVER) { thin.push({ kind: 'sliver', piece: pieceOf(q), fam: f, s: q.s, u, worst: 0 }); continue; }
      if (DRIVABLE.has(f) && !zip && Math.abs(dot(nu, q.T)) >= cosAcross) across.push({ kind: 'across', piece: pieceOf(q), fam: f, s: q.s, u, worst: 0, mesh: m.name });
    }
  });

  // edges by welded vertex pair, over the triangles at least SLIVER thick (a sliver's direction means nothing, and is counted above), grouped in the order
  // first seen; the vertex table and the triangles' vertex ids are not read after this, and are let go
  ids = null;
  const edges = edgeGroups();
  for (let i = 0; i < N; i++) {
    if (!tHasN[i]) continue;
    for (let x = 0; x < 3; x++) { const y = (x + 1) % 3, a = tIds[3 * i + x], b = tIds[3 * i + y]; if (a === b) continue; if (a < b) edges.add(a, b, 3 * i + x); else edges.add(b, a, 3 * i + x); }
  }
  tIds = null;

  // FOLD: per piece, the largest bend across the road between two triangles of one surface, the road's and the skin's
  const most = new Map(), bnd = [];
  const slotOf = (s) => [Math.floor(s / 3), s % 3, ((s % 3) + 1) % 3];   // a filed edge's triangle, and its two corners in that triangle
  for (let e = 0; e < edges.size; e++) {
    if (edges.count[e] === 1) { bnd.push(slotOf(edges.first[e])); continue; }
    if (edges.count[e] !== 2) continue;
    const L = [...slotOf(edges.first[e]), ...slotOf(edges.second[e])], t = tri(L[0]), g = tri(L[3]);
    if (t.f !== g.f || (t.f !== 'road' && t.f !== 'skin') || t.zip || g.zip || atEnd(t.q)) continue;
    const d = sub(t.v[L[2]], t.v[L[1]]);
    if (Math.abs(dot(d, t.q.T)) / Math.hypot(...d) >= 0.5) continue;   // an edge along the road (a ring's facets, the skin's columns): not a bend across it
    const ang = Math.acos(Math.max(-1, Math.min(1, dot(t.n, g.n)))) / DEG, k = `${pieceOf(t.q)}|${t.f}`, o = most.get(k);
    if (!o || ang > o.ang) most.set(k, { ang, s: t.q.s, u: t.u, piece: pieceOf(t.q), at: detail ? [t.mesh, g.mesh, t.v, g.v] : null });
  }
  for (const [k, o] of most) {
    if (!k.endsWith('|skin')) continue;
    const r = most.get(`${o.piece}|road`), ra = r ? r.ang : 0;
    if (o.ang > ra + FOLD_SLACK_DEG) warn.push({ kind: 'fold', piece: o.piece, s: o.s, u: o.u, count: 1,
      message: `the underside skin folds ${o.ang.toFixed(1)}° across the road at ${place(o.s, o.u)}, in piece ${o.piece}, where the road bends at most ${ra.toFixed(1)}°: a jag in the hull's outline` });
  }

  // OPEN: a boundary edge (one triangle) is open unless another boundary edge covers it within COVER (a T-junction); an open one's width is how far its
  // quarter points lie from any other mesh's surface (the far side of the crack)
  const C = 1, grid = new Map(), cellOf = (p) => p.map((x) => Math.floor(x / C));
  const ends = bnd.map(([i, x, y]) => { const v = tri(i).v; return [v[x], v[y]]; });
  ends.forEach(([a, b], i) => { const n = Math.ceil(Math.hypot(...sub(b, a)) / C) + 1; for (let j = 0; j <= n; j++) { const k = cellOf(a.map((x, m) => x + ((b[m] - x) * j) / n)).join(','); let L = grid.get(k); if (!L) grid.set(k, (L = [])); if (L[L.length - 1] !== i) L.push(i); } });
  const segDist = (p, a, b) => { const ab = sub(b, a), ap = sub(p, a), L = dot(ab, ab), u = L ? Math.max(0, Math.min(1, dot(ap, ab) / L)) : 0; return Math.hypot(ap[0] - u * ab[0], ap[1] - u * ab[1], ap[2] - u * ab[2]); };
  const covered = (p, self) => { const c = cellOf(p); for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) { const L = grid.get(`${c[0] + x},${c[1] + y},${c[2] + z}`); if (L) for (const j of L) if (j !== self && segDist(p, ends[j][0], ends[j][1]) < COVER) return true; } return false; };
  const cand = [];
  bnd.forEach(([j], i) => {
    const t = tri(j), [a, b] = ends[i], pts = [0.25, 0.5, 0.75].map((f) => a.map((x, m) => x + (b[m] - x) * f));
    if (atEnd(t.q) || pts.every((p) => covered(p, i))) return;
    cand.push({ t, a, b, pts });
  });
  if (cand.length) {
    // the faces near the open edges, in 1 m cells, then each quarter point's nearest face of another mesh (the crack's width, capped at 1 m: nothing near)
    const want = new Set(); for (const o of cand) for (const p of o.pts) { const c = cellOf(p); for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) want.add(`${c[0] + x},${c[1] + y},${c[2] + z}`); }
    const near = new Map();
    for (let i = 0; i < N; i++) {
      const t = tri(i), lo = [0, 1, 2].map((k) => Math.floor(Math.min(t.v[0][k], t.v[1][k], t.v[2][k]) / C)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(t.v[0][k], t.v[1][k], t.v[2][k]) / C));
      if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) > 512) continue;   // a face over 8 m across is no neighbour of a crack's edge
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const k = `${x},${y},${z}`; if (want.has(k)) { let L = near.get(k); if (!L) near.set(k, (L = [])); L.push(t); } }
    }
    const widthAt = (p, mesh) => { let best = 1; const c = cellOf(p); for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) for (const t of near.get(`${c[0] + x},${c[1] + y},${c[2] + z}`) || []) if (t.mesh !== mesh && t.n) { const d = pointTriangle(p, ...t.v); if (d < best) best = d; } return best; };
    for (const o of cand) {
      const w = Math.max(...o.pts.map((p) => widthAt(p, o.t.mesh))), drivable = DRIVABLE.has(o.t.f);
      const f = { kind: 'open', piece: pieceOf(o.t.q), fam: o.t.f, s: o.t.q.s, u: dot(sub(o.a, o.t.q.pos), o.t.q.L), worst: w, drivable, at: detail ? { mesh: o.t.mesh, a: o.a, b: o.b, len: Math.hypot(...sub(o.b, o.a)) } : null };
      if (w >= (drivable ? DRIVE_CRACK_M : SKY_CRACK_M)) opens.push(f); else hairline.push(f);
    }
  }

  // LANE: the pit lane's width where it leaves and rejoins the road
  if (lane && lane.joins && typeof lane.widthAt === 'function') for (const [name, s] of [['leaves', lane.joins.leave.s], ['rejoins', lane.joins.rejoin.s]]) {
    const w = lane.widthAt(s);
    if (!(w <= LANE_END_M + 1e-9)) refuse.push({ kind: 'lane', piece: 'pit lane', s, u: null, count: 1,
      message: `the pit lane is ${w.toFixed(2)} m wide where it ${name} the road at ${place(s, null)}: the road's edge steps sideways by that much there (at most ${LANE_END_M} m)` });
  }

  // BOTTOM: beside each open edge, a metre at a time, the depth from the road down to the skin, along a ray down the road's normal from above it
  const segStart = new Map(); for (const q of S) if (!segStart.has(q.seg)) segStart.set(q.seg, q.s);
  // a piece that curls into a wall side or a tube anywhere, and BOTTOM_CLEAR_M of road either side of it, is not read: the hull there thins and turns by
  // design (underskin.js twistZone, eased over HULL_TWIST_EASE_M), and the fold above is the check that reads it
  const curled = new Set();
  const pid = (j) => (segments[j] && segments[j].id !== undefined ? segments[j].id : `#${j}`);   // a segment's piece (a word document's segments may carry none)
  segments.forEach((g, j) => { if (g && g.kind !== 'gap' && g.profile && [0, 0.5, 1].some((f) => Prof.maxPsi(Prof.readAt(g, f * g.length)) > CURL_PSI)) curled.add(pid(j)); });
  const curl = S.map((q) => curled.has(pid(q.seg))), nearCurl = new Array(S.length).fill(false);
  for (let i = 0, lo = 0, hi = 0, n = 0; i < S.length; i++) {   // a window of BOTTOM_CLEAR_M either side, counting the curled stations in it
    while (hi < S.length && S[hi].s <= S[i].s + BOTTOM_CLEAR_M) { if (curl[hi]) n++; hi++; }
    while (S[lo].s < S[i].s - BOTTOM_CLEAR_M) { if (curl[lo]) n--; lo++; }
    nearCurl[i] = n > 0;
  }
  const rays = [];
  for (let i = 0; i < S.length; i++) {
    const q = S[i], g = segments[q.seg];
    if (!g || g.kind === 'gap' || !g.profile || atEnd(q) || nearCurl[i]) continue;
    const P = Prof.readAt(g, q.s - segStart.get(q.seg));
    if (Prof.maxPsi(P) > BOTTOM_PSI_MAX) continue;
    for (const side of [1, -1]) {
      if (lane && lane.joins && lane.side === (side > 0 ? 'L' : 'R') && q.s > lane.joins.leave.s - 0.25 && q.s < lane.joins.rejoin.s + 0.25) continue;   // the lane joins the road there
      const uEdge = side > 0 ? P.u[P.u.length - 1] : P.u[0], uIn = uEdge - side * BOTTOM_IN_M;
      if (side * uIn <= 0) continue;
      const [x, y] = Prof.offsetAt(P, uIn), o = [0, 1, 2].map((k) => q.pos[k] + q.L[k] * x + q.U[k] * (y + BOTTOM_ABOVE_M));
      rays.push({ side, q, o, d: q.U.map((v) => -v), u: x });
    }
  }
  // a ray down a station's row of vertices lies on the edge two triangles share: within BARY of a triangle it hits it, so it cannot slip between the two
  // (tube_cases row 6's tolerance)
  const BARY = 1e-4, RC = 4, RAY_M = 12, rgrid = new Map(), rcell = (p) => p.map((x) => Math.floor(x / RC)).join(',');
  rays.forEach((r) => { for (let j = 0; j <= RAY_M; j += 2) { const c = rcell(r.o.map((x, m) => x + r.d[m] * j)); if (!rgrid.has(c)) rgrid.set(c, { road: [], skin: [] }); } });
  for (let i = 0; i < N; i++) {   // the road's triangles (not a seam's zipper) and the skin's, each at least SLIVER thick, filed by triangle number
    const t = tri(i), key = !tHasN[i] ? null : t.f === 'road' && !t.zip ? 'road' : t.f === 'skin' ? 'skin' : null;
    if (!key) continue;
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(t.v[0][k], t.v[1][k], t.v[2][k]) / RC)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(t.v[0][k], t.v[1][k], t.v[2][k]) / RC));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const L = rgrid.get(`${x},${y},${z}`); if (L) L[key].push(i); }
  }
  const hit = (r, key, after = 0) => {   // the nearest hit along the ray past `after` (the skin under the road, not a skin above it: an edge's wall, a pass overhead)
    let best = null; const seen = new Set();
    for (let j = 0; j <= RAY_M; j += 2) {
      const L = rgrid.get(rcell(r.o.map((x, m) => x + r.d[m] * j))); if (!L) continue;
      for (const i of L[key]) {
        if (seen.has(i)) continue; seen.add(i);
        const t = tri(i);
        if (Math.abs(t.q.s - r.q.s) > SAME_PASS_M) continue;   // another pass of the track (a helix, a bridge, a road stacked close): not this station's hull
        const [a, b, c] = t.v, e1 = sub(b, a), e2 = sub(c, a), pv = cross(r.d, e2), det = dot(e1, pv); if (Math.abs(det) < 1e-12) continue;
        const tv = sub(r.o, a), u = dot(tv, pv) / det; if (u < -BARY || u > 1 + BARY) continue;
        const qv = cross(tv, e1), v = dot(r.d, qv) / det; if (v < -BARY || u + v > 1 + BARY) continue;
        const d = dot(e2, qv) / det; if (d > after && d < RAY_M && (best === null || d < best)) best = d;
      }
    }
    return best;
  };
  // each side's depth against the one about a metre back (the path's stations are 0.5 to 2 m apart: a step over 2 m is the next station's, read per metre),
  // as a run of rates per metre that a miss breaks. A STEP stands out of the bottom either side of it: its rate differs from the rates two stations back and two
  // on in the SAME direction, by more than BOTTOM_STEP_M (a step one or two stations wide). A hull that deepens evenly (under a rising edge) changes depth faster
  // than that a metre but evenly, and where it starts or stops deepening its rate lies between the two either side: a bend in the bottom, not a step
  const steps = [], last = new Map(), runs = new Map(), depths = detail ? [] : null; let read = 0, compared = 0;
  const flush = (side) => {
    const R = runs.get(side) || []; runs.delete(side);
    R.forEach((x, i) => {
      const back = R[i - 2] || R[i - 1], on = R[i + 2] || R[i + 1], a = back ? x.rate - back.rate : 0, b = on ? x.rate - on.rate : 0;
      const off = a * b > 0 ? Math.min(Math.abs(a), Math.abs(b)) : 0;   // a station with no neighbour on one side is not judged
      if (off > BOTTOM_STEP_M) steps.push({ kind: 'bottom', piece: pieceOf(x.q), s: x.q.s, u: x.u, worst: off });
    });
  };
  for (const r of rays) {
    // the ray starts BOTTOM_ABOVE_M over this road's own surface: a road met much nearer is another pass over it (a helix, a bridge), so this station is not read
    const tr0 = hit(r, 'road'), tr = tr0 !== null && Math.abs(tr0 - BOTTOM_ABOVE_M) < 0.25 ? tr0 : null, ts = tr === null ? null : hit(r, 'skin', tr + 1e-3), dep = tr === null || ts === null ? null : ts - tr, prev = last.get(r.side), ds = prev ? r.q.s - prev.s : 0;
    if (depths) depths.push({ s: r.q.s, side: r.side, road: tr, skin: ts, dep });
    if (dep === null) { last.delete(r.side); flush(r.side); continue; }
    read++;
    if (prev && ds < 0.99) continue;
    if (prev && ds <= 2.01) { compared++; let R = runs.get(r.side); if (!R) runs.set(r.side, (R = [])); R.push({ q: r.q, u: r.u, rate: (dep - prev.dep) / ds }); } else flush(r.side);
    last.set(r.side, { s: r.q.s, dep });
  }
  for (const side of [...runs.keys()]) flush(side);

  // THROUGH: the drivable faces' stations, least and most, per PASS_CELL_M cell (a typed table, as the triangles'); a cell is read for a drawn face when it holds a
  // drivable face of another pass (its least or its most station is PASS_M or more from the drawn face's); then each such drawn face against each drivable face of
  // another pass in its cells
  const through = [], closedLap = !open, apart = (a, b) => { const d = Math.abs(a - b); return (closedLap ? Math.min(d, sEnd - d) : d) > PASS_M; };
  const cells = tripleIds(); let sLo = new Float64Array(1 << 12), sHi = new Float64Array(1 << 12);
  const cellsOf = (v, f) => { const lo = [0, 1, 2].map((k) => Math.floor(Math.min(v[0][k], v[1][k], v[2][k]) / PASS_CELL_M)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(v[0][k], v[1][k], v[2][k]) / PASS_CELL_M));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) f(x, y, z); };
  const filed = (x, y, z) => { const before = cells.size, c = cells.id(x, y, z); return c === before ? -1 : c; };   // the cell's number, or -1 when no drivable face is filed there
  const nFiled = (() => {
    for (let i = 0; i < N; i++) {
      if (!tHasN[i] || !DRIVABLE.has(meshes[tMesh[i]].f)) continue;
      const sq = S[tQ[i]].s;
      cellsOf(tri(i).v, (x, y, z) => {
        const before = cells.size, c = cells.id(x, y, z);
        if (c >= sLo.length) { const a = new Float64Array(2 * sLo.length), b = new Float64Array(2 * sHi.length); a.set(sLo); b.set(sHi); sLo = a; sHi = b; }
        if (c === before) { sLo[c] = sq; sHi[c] = sq; } else { if (sq < sLo[c]) sLo[c] = sq; if (sq > sHi[c]) sHi[c] = sq; }
      });
    }
    return cells.size;
  })();
  const wanted = new Map(), drawnFaces = [];   // a wanted cell -> its drivable faces; the drawn faces that meet one
  for (let i = 0; i < N; i++) {
    const f = meshes[tMesh[i]].f; if (!tHasN[i] || DRIVABLE.has(f)) continue;
    const t = tri(i); if (atEnd(t.q)) continue;
    let any = false;
    cellsOf(t.v, (x, y, z) => { const c = filed(x, y, z); if (c >= 0 && c < nFiled && (apart(t.q.s, sLo[c]) || apart(t.q.s, sHi[c]))) { any = true; if (!wanted.has(c)) wanted.set(c, []); } });
    if (any) drawnFaces.push(i);
  }
  if (wanted.size) {
    for (let i = 0; i < N; i++) {
      if (!tHasN[i] || !DRIVABLE.has(meshes[tMesh[i]].f)) continue;
      cellsOf(tri(i).v, (x, y, z) => { const c = filed(x, y, z), l = c >= 0 ? wanted.get(c) : null; if (l) l.push(i); });
    }
    const meets = (p, q, t) => { const d = sub(q, p), e1 = sub(t[1], t[0]), e2 = sub(t[2], t[0]), h = cross(d, e2), a = dot(e1, h); if (Math.abs(a) < 1e-12) return false; const u = dot(sub(p, t[0]), h) / a; if (u < 0 || u > 1) return false; const qq = cross(sub(p, t[0]), e1), v = dot(d, qq) / a; if (v < 0 || u + v > 1) return false; const w = dot(e2, qq) / a; return w > 1e-6 && w < 1 - 1e-6; };
    for (const i of drawnFaces) {
      const t = tri(i), v = t.v, near = new Set(), sv = v.map((p) => S[walk(tQ[i], p, null)].s);   // each corner's station, walked from the face's own
      cellsOf(v, (x, y, z) => { const c = filed(x, y, z), l = c >= 0 ? wanted.get(c) : null; if (l) for (const j of l) near.add(j); });
      let worst = -1, phys = null, other = null;
      for (const j of near) {
        const g = tri(j); if (!sv.every((x) => apart(x, g.q.s))) continue;
        const w = g.v; if (![[0, 1], [1, 2], [2, 0]].some(([a, b]) => meets(v[a], v[b], w) || meets(w[a], w[b], v))) continue;
        const out = standOut(v, w, g.n);   // how far the drawn face stands out on the drivable side, over the drivable face itself
        if (out < THROUGH_MIN_M) continue;
        if (out > worst) { worst = out; phys = g.f; other = detail ? { mesh: t.mesh, with: g.mesh, sWith: g.q.s } : null; }
      }
      if (phys) through.push({ kind: 'through', piece: pieceOf(t.q), fam: t.f, phys, s: t.q.s, u: t.u, worst: Math.max(0, worst), at: other });
    }
  }

  // the messages
  const where = (g) => `at ${place(g.s, g.u)}, in piece ${g.piece}`, mm = (x) => `${(x * 1000).toFixed(0)} mm`;
  refuse.push(...grouped(across, (g) => `${g.count} face(s) of ${NAMES[g.fam]} stand across the road ${where(g)}: a step in the road's edge the car would hit`));
  refuse.push(...grouped(opens.filter((o) => o.drivable), (g) => `${g.count} edge(s) of ${NAMES[g.fam]} are open by up to ${g.worst >= 1 ? 'a metre or more' : mm(g.worst)} ${where(g)}: a crack in the road's surface`));
  warn.push(...grouped(opens.filter((o) => !o.drivable), (g) => `${g.count} edge(s) of ${NAMES[g.fam]} are open by up to ${g.worst >= 1 ? 'a metre or more' : mm(g.worst)} ${where(g)}: a line of sky through the hull`));
  warn.push(...grouped(steps, (g) => `the hull's bottom steps ${g.worst.toFixed(3)} m in a metre against the bottom either side ${where(g)} (at most ${BOTTOM_STEP_M} m): a step in its underside`));
  warn.push(...grouped(thin, (g) => `${g.count} triangle(s) of ${NAMES[g.fam]} thinner than ${(SLIVER * 1000).toFixed(0)} mm ${where(g)}: slivers`));
  warn.push(...grouped(through, (g) => `${g.count} face(s) of ${NAMES[g.fam]} pass through ${NAMES[g.phys]} of another pass (standing up to ${g.worst >= 1 ? `${g.worst.toFixed(2)} m` : mm(g.worst)} out of it) ${where(g)}: the hull shows through a surface the car drives on`));
  return detail ? { refuse, warn, detail: { opens, hairline, folds: [...most.values()], steps, across, thin, through, rays: rays.length, read, compared, depths } } : { refuse, warn };
}

/** One line for an export message: every finding, LISTED at most, the rest counted. */
function sayFindings(list) {
  const shown = list.slice(0, LISTED).map((f) => f.message);
  return shown.join('; ') + (list.length > LISTED ? `; and ${list.length - LISTED} more` : '');
}

module.exports = { checkFinalScene, sayFindings, tripleIds, edgeGroups, PASS_M, THROUGH_MIN_M, ACROSS_DEG, LANE_END_M, FOLD_SLACK_DEG, BOTTOM_STEP_M, COVER, DRIVE_CRACK_M, SKY_CRACK_M, END_M };
