// mesh.js: path + segments → scene (docs/ARCHITECTURE.md §3, docs/INTERFACES.md §2).
//
//   buildMesh(path, segments, { maxSeamDeg = 1, chordErr = 0.02, cellLength = 150, maxStep = 4, maxAcross = 1 })
//     -> { scene, cells: [{ name, piece, s0, s1, vertices, origin, seam? }], folds: [{ s, u, margin }], stats, _state }
//   extendMesh(prev, path, segments)      the build head: new pieces were appended by extendPath
//   sculptMesh(prev, path, segments, g)   piece g's handles changed; rebuildPathFrom re-grew the path from g
//
// A PIECE IS SELF-CONTAINED (the keeper, 12:22: users sculpt pieces and save their own). A road segment's mesh is made
// from its OWN handles and nothing else:
//   · its own vertex count across (K from its own profile, not a track-wide K);
//   · its own stations, on its own grid (path.js samples each segment from its own start);
//   · its own start sample and its own END sample (its own roll1 and heartline), never the next piece's;
//   · its vertices in its OWN START FRAME (x = left L, y = up U, z = forward T, origin at its start). The placement,
//     rotation and translation, lives in its cells' node matrices (rows L, U, T, then the origin: kn5's stored order,
//     world = local × matrix, as tools/kn5.cjs and src/export/markers.js read it).
// So the same handles give the same vertex arrays wherever the piece is placed, up to the placement transform, and moving
// a piece changes only its matrices. THE LIMIT, stated: path.js's curve model turns about WORLD up, so a piece's shape in
// its own frame is invariant under translation and rotation about world up, at the same start pitch and start bank. At a
// different start pitch, the same handles bend differently. That is the open question in the D166 hand-back (§5, §9):
// curvature relative to the track would make pieces invariant under any placement.
//
// SEAMS. Where two neighbouring road pieces end and start with different cross-sections (different K, or a different
// shape), a SEAM mesh zips the first piece's end row to the next piece's start row. Both rows lie at the same station, so
// the seam is the honest step between the two fonts the user placed side by side (a transition piece is the document's
// job). Where the rows coincide, no seam is emitted. A seam depends on exactly its two pieces.
//
// ADAPTIVE STEP ALONG THE ROAD (§3 `:59-61`), per piece, checked on EVERY profile vertex:
//   · chord error: every intermediate sample of that vertex's track lies within `chordErr` of the straight edge between
//     the two chosen stations;
//   · seam angle: the vertex normal turns by at most `maxSeamDeg` between them (FINDINGS.md:24, median 0.2–1.1°);
//   · a hard cap of `maxStep` m (FINDINGS.md:23, longest road edges median 1.6–5.5 m).
// CELLS (§3 `:62-65`): each piece is split into cells every `cellLength` m (from the piece's start) and before 65,536
// vertices. Cell names carry the piece's id: `1<KEY>_<id>_<n>`.
// FOLDS (§3 `:57`): margin = 1 − kvec·q at every sample and every profile vertex; margin ≤ 0 is reported and still meshed.
// Self-intersection between NON-adjacent cells (§3 `:58`) and stacked surfaces (§4 `:85`) are src/geom/bvh.js,
// run on the finished mesh (`selfCheck`), or here with the `selfCheck: true` option of buildMesh.
//
// FONT RAMPS (the librarian's ruling on D166 §5: "Fonts RAMP; they never jump"). Where a road piece follows a road piece
// of a different font, the ENTERING piece blends from the previous font to its own over its first `rampM` metres
// (default 20, inferred per the ruling; shortened to the piece's length if it is shorter), smoothstep in s: width, wall
// height and ψ(u) together (profile.js `blend`). The entry font is a handle of the entering piece, `profileIn`: the
// document may set it (and `rampM`); otherwise it is taken from the previous road piece, so a saved piece is a pure
// function of its own handles plus the font it is attached after. `rampM: 0` (per piece or as an option) turns it off.
// THE DOCUMENT'S FIELD WINS (A's resolve, p-d167-ramp-connector-A §4): a segment carrying `blend: { from, s0, length }`
// blends from `from` at weight smoothstep((s0 + d) / length), capped at 1, where d is the distance into the segment and
// s0 the segment's offset into its word, so one transition may span several segments. `blend: null` means no ramp, and
// the geometry then adds none of its own; only a segment WITHOUT the field falls back to `profileIn` / inheritance.
'use strict';
const { normalize, offsetAt, normalAt, samplesAcross, blend, blendSamples, usOf, smoothstep } = require('./profile.js');
const { _vec: { add, sub, mul, dot, len } } = require('./path.js');
const { selfCheck, asFolds } = require('./bvh.js');

const DEG = Math.PI / 180, MAXV = 65535;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function material(key) {
  return {
    name: `t180b_${key.toLowerCase()}`, shader: 'ksPerPixel', alphaBlend: 0, alphaTested: false, depthMode: 0,
    props: [{ name: 'ksAmbient', value: [0.45] }, { name: 'ksDiffuse', value: [0.55] }, { name: 'ksSpecular', value: [0.15] },
      { name: 'ksSpecularEXP', value: [20] }, { name: 'ksEmissive', value: [0, 0, 0] }, { name: 'ksAlphaRef', value: [0] }],
    samplers: [],
  };
}
/** Per-segment profile and u samples, each with its OWN count (a whole-list helper, also used by tests). */
function profiles(segments, maxSeam, maxAcross) {
  const P = segments.map((g) => (g.kind === 'gap' ? null : normalize(g.profile)));
  const U = P.map((p) => (p ? samplesAcross(p, { maxSeam, maxAcross }).u : null));
  return { P, U, K: U.map((u) => (u ? u.length : 0)) };
}
/** World position and normal of the profile vertex at u, at a sample. */
function vertex(sm, P, u) {
  const [X, Y] = offsetAt(P, u), [nl, nu] = normalAt(P, u);
  const q = add(mul(sm.L, X), mul(sm.U, Y));
  return { p: add(sm.pos, q), n: add(mul(sm.L, nl), mul(sm.U, nu)), q };
}
function rowWith(sm, P, Us) { return Us.map((u) => vertex(sm, P, u)); }
function options(opts) {
  return {
    maxSeam: (opts.maxSeamDeg === undefined ? 1 : opts.maxSeamDeg) * DEG, chordErr: opts.chordErr === undefined ? 0.02 : opts.chordErr,
    cellLength: opts.cellLength === undefined ? 150 : opts.cellLength, maxStep: opts.maxStep === undefined ? 4 : opts.maxStep,
    maxAcross: opts.maxAcross === undefined ? 1 : opts.maxAcross, rampM: opts.rampM === undefined ? 20 : opts.rampM, raw: { ...opts },
  };
}
/** A piece's handles, as text: the ONLY input its mesh depends on besides its start pitch and bank. */
const handleKey = (seg) => JSON.stringify(seg, (k, v) => (k === 'id' ? undefined : v));
const pitchOf = (sm) => Math.asin(Math.max(-1, Math.min(1, sm.T[1])));
// A resolved word emits up to three segments sharing one id (parts in/body/out, docs/INTERFACES.md §1), so a piece is
// named by (id, part): without the part, node names repeat, and bvh.js's name→cell map collapses them (D167 read).
const safeId = (id, g, part) => String(id === undefined ? `p${g}` : part ? `${id}_${part}` : id).replace(/[^A-Za-z0-9]/g, '_');
/** The frame a piece's vertices are stored in: its start sample's L, U, T and position. */
const frameOf = (sm) => ({ o: sm.pos.slice(), L: sm.L.slice(), U: sm.U.slice(), T: sm.T.slice() });
const toLocal = (F, p) => { const d = sub(p, F.o); return [dot(d, F.L), dot(d, F.U), dot(d, F.T)]; };
const dirLocal = (F, n) => [dot(n, F.L), dot(n, F.U), dot(n, F.T)];
const matrixOf = (F) => [F.L[0], F.L[1], F.L[2], 0, F.U[0], F.U[1], F.U[2], 0, F.T[0], F.T[1], F.T[2], 0, F.o[0], F.o[1], F.o[2], 1];

const sameProfile = (a, b) => { const A = normalize(a), B = normalize(b); return A.u.length === B.u.length && A.u.every((x, i) => x === B.u[i] && A.psi[i] === B.psi[i]); };
/**
 * The handles piece g is meshed from: its own, plus `profileIn` (the font it ramps from) when the previous road piece's
 * font differs and the piece does not set one itself. On a closed loop the first piece follows the last.
 */
function effective(segments, g, o, closed) {
  const seg = segments[g];
  if (!seg || seg.kind === 'gap' || seg.profileIn !== undefined || seg.blend !== undefined) return seg;   // the document spoke
  const rampM = seg.rampM === undefined ? o.rampM : seg.rampM;
  const prev = g > 0 ? segments[g - 1] : closed && segments.length > 1 ? segments[segments.length - 1] : null;
  if (!(rampM > 0) || !prev || prev.kind === 'gap' || sameProfile(prev.profile, seg.profile)) return seg;
  return { ...seg, profileIn: prev.profile, rampM };
}
/** The samples of piece g: its own samples in the path, then its own end sample. */
function pieceSamples(path, g) {
  const a = path.segFirst[g], b = g + 1 < path.segFirst.length ? path.segFirst[g + 1] : path.samples.length;
  const own = path.samples.slice(a, b).filter((sm) => sm.seg === g && sm.s < path.segEnd[g].s - 1e-9);
  return [...own, path.segEnd[g]];
}
/**
 * Mesh one road piece from its own samples alone: vertices, folds, stations, cells (local arrays + placement frame).
 * `work` counts vertex evaluations + chord-check iterations.
 */
function meshPiece(g, seg, S, o, work) {
  const P = normalize(seg.profile), rampM = seg.rampM === undefined ? o.rampM : seg.rampM;
  if (seg.blend) {
    const b = seg.blend;
    if (!b.from || !(Number.isFinite(b.s0) && b.s0 >= 0) || !(Number.isFinite(b.length) && b.length > 0))
      throw new Error(`buildMesh: piece ${g}: blend needs { from: profile, s0 ≥ 0, length > 0 }`);
  }
  const ramp = seg.blend ? { from: seg.blend.from, s0: seg.blend.s0, length: seg.blend.length }
    : seg.profileIn !== undefined && rampM > 0 ? { from: seg.profileIn, s0: 0, length: Math.min(rampM, S[S.length - 1].s - S[0].s) } : null;
  const A = ramp ? normalize(ramp.from) : null;
  // a ramp: one vertex count for the whole piece, at matched fractions of the width; otherwise the font's own samples
  const fr = A ? blendSamples(A, P, { maxSeam: o.maxSeam, maxAcross: o.maxAcross }) : null;
  const Us = A ? usOf(P, fr) : samplesAcross(P, { maxSeam: o.maxSeam, maxAcross: o.maxAcross }).u, K = Us.length;
  if (K > MAXV / 2) throw new Error(`buildMesh: piece ${g}: ${K} vertices across one row leaves no room for two rows`);
  const shapeAt = (sm) => {                   // the cross-section at a sample: the font, or the blend on the ramp
    if (!A) return { P, Us };
    const w = smoothstep((ramp.s0 + sm.s - S[0].s) / ramp.length);
    if (w >= 1) return { P, Us };
    const Pw = normalize(blend(A, P, w)); return { P: Pw, Us: usOf(Pw, fr) };
  };
  const shapes = S.map(shapeAt);
  const V = S.map((sm, i) => { work.n += K; return rowWith(sm, shapes[i].P, shapes[i].Us); });
  const folds = [];
  S.forEach((sm, i) => V[i].forEach((v, k) => { const margin = 1 - dot(sm.kvec, v.q); if (margin <= 0) folds.push({ s: sm.s, u: shapes[i].Us[k], margin }); }));
  const ok = (a, b) => {                      // may one strip run from sample a to sample b?
    if (S[b].s - S[a].s > o.maxStep + 1e-9) return false;
    const A = V[a], B = V[b];
    for (let k = 0; k < K; k++) {
      if (Math.acos(Math.max(-1, Math.min(1, dot(A[k].n, B[k].n)))) > o.maxSeam) return false;
      const d = sub(B[k].p, A[k].p), dd = dot(d, d);
      for (let m = a + 1; m < b; m++) { work.n++; const w = sub(V[m][k].p, A[k].p), t = dd > 0 ? Math.max(0, Math.min(1, dot(w, d) / dd)) : 0; if (len(sub(w, mul(d, t))) > o.chordErr) return false; }
    }
    return true;
  };
  const stations = [0];
  for (let a = 0; a < S.length - 1;) { let b = a + 1; while (b + 1 < S.length && ok(a, b + 1)) b++; stations.push(b); a = b; }
  const F = frameOf(S[0]), key = P.material, cells = [];
  let cur = null;
  for (let n = 0; n < stations.length - 1; n++) {
    const i = stations[n], j = stations[n + 1];
    const tooLong = cur && (S[j].s - S[cur.rows[0]].s > o.cellLength);
    const tooMany = cur && (cur.rows.length + 1) * K > MAXV;
    if (!cur || tooLong || tooMany) { cur = { rows: [i] }; cells.push(cur); }
    cur.rows.push(j);
  }
  const built = cells.map((run) => {
    const R = run.rows.length, positions = new Float32Array(R * K * 3), normals = new Float32Array(R * K * 3), uvs = new Float32Array(R * K * 2);
    run.rows.forEach((i, r) => V[i].forEach((v, k) => {
      const oo = r * K + k, pl = toLocal(F, v.p), nl = dirLocal(F, v.n);
      positions[oo * 3] = pl[0]; positions[oo * 3 + 1] = pl[1]; positions[oo * 3 + 2] = pl[2];
      normals[oo * 3] = nl[0]; normals[oo * 3 + 1] = nl[1]; normals[oo * 3 + 2] = nl[2];
      uvs[oo * 2] = Us[k] / 10; uvs[oo * 2 + 1] = (S[i].s - S[0].s) / 10;      // piece-local: the same wherever placed
    }));
    const indices = new Uint16Array((R - 1) * (K - 1) * 6); let t = 0;
    for (let r = 0; r < R - 1; r++) for (let k = 0; k < K - 1; k++) {
      const A = r * K + k, B = A + 1, C = A + K, D = C + 1;          // u ascends right → left, rows run forward
      indices[t++] = A; indices[t++] = C; indices[t++] = B; indices[t++] = B; indices[t++] = C; indices[t++] = D;
    }
    return { positions, normals, uvs, indices, s0: S[run.rows[0]].s, s1: S[run.rows[R - 1]].s, vertices: R * K, rowS: run.rows.map((i) => S[i].s) };
  });
  return { g, id: seg.id, part: seg.part, key, K, Us, P, F, folds, stations: stations.map((x) => x), cells: built, first: V[0], last: V[V.length - 1], firstS: S[0], lastS: S[S.length - 1], stationS: stations.map((i) => S[i].s), ends: { first: shapes[0], last: shapes[S.length - 1] },
    handles: handleKey(seg), p0: pitchOf(S[0]), b0: S[0].bankG };
}
/** The seam between two consecutive road pieces, or null where their boundary rows coincide. */
function meshSeam(A, B, work) {
  const ra = rowsOf(A, 'last', work), rb = rowsOf(B, 'first', work);
  if (ra.length === rb.length && ra.every((v, k) => len(sub(v.p, rb[k].p)) < 1e-9)) return null;
  const F = B.F, Ka = ra.length, Kb = rb.length;
  const pts = [...ra, ...rb], positions = new Float32Array(pts.length * 3), normals = new Float32Array(pts.length * 3), uvs = new Float32Array(pts.length * 2);
  pts.forEach((v, i) => {
    const pl = toLocal(F, v.p), nl = dirLocal(F, v.n); positions.set(pl, i * 3); normals.set(nl, i * 3);
    uvs[i * 2] = (i < Ka ? A.Us[i] : B.Us[i - Ka]) / 10; uvs[i * 2 + 1] = 0;
  });
  // zipper: walk both rows by their fraction across; triangles wound as the strip quads (A, C, B) and (B, C, D)
  const idx = []; let i = 0, j = 0;
  while (i < Ka - 1 || j < Kb - 1) {
    const ta = i < Ka - 1 ? (i + 1) / (Ka - 1) : Infinity, tb = j < Kb - 1 ? (j + 1) / (Kb - 1) : Infinity;
    if (ta <= tb) { idx.push(i, Ka + j, i + 1); i++; } else { idx.push(i, Ka + j, Ka + j + 1); j++; }
  }
  return { positions, normals, uvs, indices: Uint16Array.from(idx), s: B.firstS.s, vertices: pts.length, F };
}

/** A piece's boundary row in CURRENT world coordinates; a reused (moved) piece recomputes it only when a seam needs it. */
function rowsOf(pc, which, work) {
  if (pc.stale && pc.stale[which]) { const sm = which === 'first' ? pc.firstS : pc.lastS, e = pc.ends[which]; pc[which] = rowWith(sm, e.P, e.Us); pc.stale[which] = false; if (work) work.n += pc.K; }
  return pc[which];
}
/** Assemble the scene from the per-piece state. O(pieces), no geometry is recomputed here. */
function assemble(st) {
  const children = [], cells = [], folds = [], mats = [], matIndex = (key) => { let i = mats.findIndex((m) => m.key === key); if (i < 0) { mats.push({ key, m: material(key) }); i = mats.length - 1; } return i; };
  const mesh = (name, m, arr) => ({ type: 'mesh', name, material: m, positions: arr.positions, normals: arr.normals, uvs: arr.uvs, indices: arr.indices, castShadows: true, visible: true, transparent: false, renderable: true });
  st.pieces.forEach((pc, g) => {
    if (!pc) return;
    folds.push(...pc.folds);
    const m = matIndex(pc.key), M = matrixOf(pc.F);
    pc.cells.forEach((c, n) => {
      const name = `1${pc.key}_${safeId(pc.id, g, pc.part)}_${n}`;
      children.push({ type: 'dummy', name: `CELL_${safeId(pc.id, g, pc.part)}_${n}`, matrix: M, children: [mesh(name, m, c)] });
      cells.push({ name, piece: g, s0: c.s0, s1: c.s1, vertices: c.vertices, origin: pc.F.o });
    });
    const sm = st.seams[g];
    if (sm) {
      const name = `1${pc.key}_seam_${safeId(pc.id, g, pc.part)}`;
      children.push({ type: 'dummy', name: `SEAM_${safeId(pc.id, g, pc.part)}`, matrix: matrixOf(sm.F), children: [mesh(name, m, sm)] });
      cells.push({ name, piece: g, s0: sm.s, s1: sm.s, vertices: sm.vertices, origin: sm.F.o, seam: true });
    }
  });
  const stationS = [...new Set(st.pieces.flatMap((p) => (p ? p.stationS : [])))].sort((a, b) => a - b);
  const scene = { textures: [], materials: mats.map((x) => x.m), root: { type: 'dummy', name: 't180b_track', matrix: IDENTITY.slice(), children } };
  return { scene, cells, folds, stats: { K: st.pieces.map((p) => (p ? p.K : 0)), stations: stationS.length, stationS, work: st.work, reused: st.reused || 0 }, _state: st };
}
/** Mesh pieces [from..] and the seams that touch them; `keepFrom` reuses unchanged pieces (sculpt). */
function meshRange(st, path, segments, from, to) {
  for (let g = from; g < to; g++) {
    const seg = segments[g];
    st.pieces[g] = seg.kind === 'gap' ? null : meshPiece(g, effective(segments, g, st.o, st.closed), pieceSamples(path, g), st.o, st.workC);
  }
}
function seamsAround(st, gs) {
  for (const g of gs) {
    if (g < 0 || g >= st.pieces.length) continue;
    const A = st.pieces[g - 1], B = st.pieces[g];
    st.seams[g] = A && B ? meshSeam(A, B, st.workC) : null;           // the seam that starts piece g
  }
}

function buildMesh(path, segments, opts = {}) {
  const st = { o: options(opts), pieces: [], seams: [], workC: { n: 0 }, nseg: segments.length, closed: !!path.closed };
  meshRange(st, path, segments, 0, segments.length);
  seamsAround(st, segments.map((_, g) => g));
  if (path.closed && segments.length > 1) {                // a closed loop also joins its last piece to its first
    const A = st.pieces[segments.length - 1], B = st.pieces[0];
    st.seams[0] = A && B ? meshSeam(A, B, st.workC) : null;
  }
  st.work = st.workC.n;
  const out = assemble(st);
  if (opts.selfCheck) {                                    // opt-in: a whole-track check, O(triangles · log)
    out.selfCheck = selfCheck(out, { closed: !!path.closed, lengthM: path.lengthM, minSeparationM: opts.minSeparationM, stackedM: opts.stackedM });
    out.folds.push(...asFolds(out.selfCheck));
  }
  return out;
}

/** extendMesh(prev, path, segments): new pieces after extendPath. Only the new pieces and the seam onto them are made. */
function extendMesh(prev, path, segments) {
  const st = prev._state;
  if (st.closed || path.closed) throw new Error('extendMesh: a closed loop has no open end; rebuild it');
  if (segments.length <= st.nseg) throw new Error('extendMesh: no new segments');
  st.workC = { n: 0 };
  const from = st.nseg;
  meshRange(st, path, segments, from, segments.length);
  seamsAround(st, segments.map((_, g) => g).slice(from));
  st.nseg = segments.length; st.work = st.workC.n;
  return assemble(st);
}

/**
 * sculptMesh(prev, path, segments, g): piece g's handles changed and rebuildPathFrom(path, segments, g) re-grew the
 * path. Piece g is remeshed. Every later piece is remeshed only if its shape IN ITS OWN FRAME changed (with the
 * world-up curve model that happens when its start pitch or start bank changed); otherwise its local arrays are kept
 * and only its placement (the matrix) moves. The seams on both sides of every remeshed piece are redone.
 */
function sculptMesh(prev, path, segments, g) {
  const st = prev._state;
  if (st.closed || path.closed) throw new Error('sculptMesh: a closed loop is rebuilt in full');
  st.workC = { n: 0 }; st.reused = 0;
  const changed = new Set([g]);
  for (let j = g; j < segments.length; j++) {
    const seg = effective(segments, j, st.o, st.closed);
    if (seg.kind === 'gap') { st.pieces[j] = null; continue; }
    const old = st.pieces[j], f0 = path.samples[path.segFirst[j]];
    // reuse test for a later piece: the same handles AND the same start pitch and bank (the shape in its own frame)
    const sameShape = old && j !== g && old.handles === handleKey(seg) && Math.abs(old.p0 - pitchOf(f0)) < 1e-12 && Math.abs(old.b0 - f0.bankG) < 1e-12;
    if (sameShape) {
      // moved rigidly: only its placement changes (O(1), no sample is read). Its local arrays stay; its boundary rows are
      // recomputed only if a seam next to a remeshed piece asks for them; a seam between two moved pieces moves with the
      // later one
      st.reused++; old.F = frameOf(f0); old.firstS = f0; old.lastS = path.segEnd[j]; old.stale = { first: true, last: true };
      if (st.seams[j]) st.seams[j].F = old.F;
      continue;
    }
    st.pieces[j] = meshPiece(j, seg, pieceSamples(path, j), st.o, st.workC);
    changed.add(j);
  }
  const around = new Set(); for (const j of changed) { around.add(j); around.add(j + 1); }
  seamsAround(st, [...around]);
  st.nseg = segments.length; st.work = st.workC.n;
  return assemble(st);
}
module.exports = { buildMesh, extendMesh, sculptMesh, vertex, profiles, toLocal };
