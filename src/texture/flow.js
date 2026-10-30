// flow.js: the texture coordinates of an EQUATION-CORE track that wears a texture (D228).
//
//   flowCell(mesh, segments, set, cell, node) -> Float32Array uvs | null   one mesh cell's (or seam's) new texture coordinates; `node` is its
//                                                                          mesh object (mesh.scene.root.children[k].children[0] for mesh.cells[k])
//   flowUvs(mesh, segments, set)              -> Map(mesh object -> uvs)   every textured cell of the mesh, keyed by the mesh OBJECT: node NAMES repeat
//                                                                          (every 2 m segment of a piece is named for the piece), so a name is no key
//   closedRing(segment)                 -> bool                        the section is a closed ring (a tube swept to 360°)
//
// WHY. src/geom/mesh.js gives every piece texture coordinates of its OWN: u = (arc length across)/10, v = (s − the piece's first s)/10.
// A word is a long piece, so the texture restarts once per word. The equation core's track is hundreds of 2 m chord segments
// (src/core/adapter.js), so the same rule restarts the texture every 2 m: a hard break twenty times a tile. Here a textured core cell
// takes v from the PATH'S OWN arc length, row by row (the row's s, continuous through every segment and every seam), and u from the
// profile's own arc length (profile.js: u IS arc length, on a wall and on a tube's roof alike), so a texture flows through turns,
// walls and the tube the way ARCHITECTURE §5b says.
//
// THE CLOSED TUBE. A section that is a closed ring (ψ = ±180° at both edges, the tube at a sweep of 360°) runs u from −w/2 to +w/2
// round the circumference w, floor at u = 0 and the ceiling at the two ends, where the ring closes. Laid at tileWidth metres a
// repeat, the ends would differ by w/tileWidth, a fraction, and the texture would jump along the ceiling's centre line. So a closed
// ring takes a WHOLE number of repeats round, n = max(1, round(w / tileWidth)), spread evenly: u = n · arc / w. The two ends then differ
// by exactly n, and a tiling texture meets itself there. THE SEAM IS AT THE CEILING (the top of the ring, u = ±w/2); nothing is stretched
// by more than the rounding (tileWidth × [n/(w/tileWidth)], at most a few per cent: 3 repeats for a 31 m ring is 10.33 m each).
// Only a ring that is closed in every row gets this: an open tube, a cup and a plain road keep u = arc / tileWidth.
//
// FIT (D364): a floor whose settings say fit 'fit' (src/doc/textures.js: stretch once across the strip's own width) takes u = arc / w, w the row's own
// width, so u runs from -0.5 to 0.5 across every row whatever the road's width, and follows a road that widens or narrows (ELYSIUM, 35 m to 60 m). A closed
// ring with fit is one repeat round it. Until D364 this file read tileWidth only, so a track that changed width repeated its texture where it was wider.
//
// EDGE (D371, src/texture/edge.js): a floor whose settings say fit 'edge' takes the band-and-centre layout the set built from the track's width range: u runs\n// 0..fb over the outer edgeBand metres of each side and fb..1-fb over the rest, so the edge bands are the same size in metres on every row, and the centre is the whole\n// repeats the texture was composed with. A row of two bands or less, and a closed ring, take the plain fit.\n//\n// WHAT IT TOUCHES: only cells of a segment whose word is 'core' (the equation core's) with a textured FLOOR slot (an image or a made
// texture, the rule src/texture/set.js withTextureSet already uses for the material). A word document's texture coordinates, and every
// untextured track's, are exactly what mesh.js made; the export without a texture set is byte for byte what it was.
'use strict';
const { normalize } = require('../geom/profile.js');
const EDGE = require('./edge.js');

const DEG = Math.PI / 180, CLOSED_RAD = (180 - 1e-3) * DEG;

const ringShape = (profile) => { const P = normalize(profile), n = P.psi.length; return n >= 3 && Math.abs(P.psi[0]) >= CLOSED_RAD && Math.abs(P.psi[n - 1]) >= CLOSED_RAD; };
/**
 * True when the segment's section is a closed ring all along it: |ψ| is 180° at both edges at its end (seg.profile) AND at its start (seg.blend.from, the
 * shape a core chord segment starts from; a segment that morphs from an open section into the tube is not a ring until the morph is done), and it is not
 * a ramp from another section (profileIn).
 */
// 2026-10-14 (ELYSIUM: ~245 ms of every placed piece, the preview's texture coordinates normalising each new cell's section twice): a FROZEN
// segment (the core shell's, src/core/adapter.js toSegments cache) cannot change, so its answer is remembered; any other is read each time.
const ringMemo = new WeakMap();
function closedRing(seg) {
  if (!seg || !seg.profile || seg.profileIn !== undefined) return false;
  if (!Object.isFrozen(seg)) return ringOf(seg);
  let v = ringMemo.get(seg); if (v === undefined) { v = ringOf(seg); ringMemo.set(seg, v); }
  return v;
}
function ringOf(seg) { return ringShape(seg.profile) && (!seg.blend || (!!seg.blend.from && ringShape(seg.blend.from))); }

/** The floor slot's settings if this segment is a core segment that wears a texture, else null. */
function floorOf(seg, set) {
  if (!seg || seg.word !== 'core' || !set) return null;
  const slots = set.bySegment(seg.id), f = slots && slots.floor && slots.floor.settings;
  return f && (f.texture || f.make) ? f : null;
}

/** u for one row of `K` vertices whose arc lengths are `arc[k]` (from the mesh's own u, ×10): `fit` (D364: once across the row's own width, -0.5 to 0.5, a ring included: one repeat round), else a ring's whole-number wrap, else the plain tile. */
function rowU(arc, K, ring, tileWidth, fit, edge, ringN = null) {
  const out = new Float64Array(K);
  const w = arc[K - 1] - arc[0];
  if (fit === 'edge' && edge && !ring && w > 0) for (let k = 0; k < K; k++) out[k] = EDGE.rowMap(arc[k] - arc[0], w, edge);
  else if ((fit === 'fit' || (fit === 'edge' && edge)) && w > 0) for (let k = 0; k < K; k++) out[k] = arc[k] / w;
  else if (ring && w > 0) { const n = ringN || Math.max(1, Math.round(w / tileWidth)); for (let k = 0; k < K; k++) out[k] = (n * arc[k]) / w; }
  else for (let k = 0; k < K; k++) out[k] = arc[k] / tileWidth;
  return out;
}

/**
 * Texture coordinates for one cell: R rows of K vertices, row r at path arc length rowS[r]; `segOf` its segment (or a seam's two), each with whether it is a
 * closed ring and that ring run's whole number of repeats `n` (ringRunN). `startArc`, when given, is the arc of the cell's FIRST row (the segment before's end
 * section; see flowCell): mesh.js lays one across arc per segment, its END section, so without it every row of a segment wears the end's arc.
 */
function build(uvs, K, rowS, segOf, settings, edge, startArc = null) {
  const R = uvs.length / (2 * K), out = new Float32Array(uvs.length), { tileLength, tileWidth, offset, dir, fit } = settings;
  for (let r = 0; r < R; r++) {
    let arc = new Float64Array(K); for (let k = 0; k < K; k++) arc[k] = uvs[(r * K + k) * 2] * 10;   // the mesh's u is arc length / 10
    // THE ROW'S OWN SECTION: the first row takes the start arc, the last the segment's own (end) arc, a row between them the blend by its distance along. Where
    // the section does not change the two are the same numbers and nothing moves; where it changes, two coincident rows at a segment boundary now carry the same arc
    if (startArc && R > 1 && r < R - 1) { const t = (rowS[r] - rowS[0]) / (rowS[R - 1] - rowS[0]), end = arc; arc = new Float64Array(K); for (let k = 0; k < K; k++) arc[k] = r === 0 ? startArc[k] : startArc[k] + (end[k] - startArc[k]) * t; }
    const u = segOf.length === 1 ? rowU(arc, K, segOf[0].ring, tileWidth, fit, edge, segOf[0].n) : (() => {                    // a seam: two rows end to end, each its own segment's
      const o = new Float64Array(K); let a = 0;
      for (const part of segOf) { const sub = rowU(arc.subarray(a, a + part.K), part.K, part.ring, tileWidth, fit, edge, part.n); o.set(sub, a); a += part.K; }
      return o;
    })();
    const v = (rowS[r] + offset) / tileLength;
    for (let k = 0; k < K; k++) { const o = (r * K + k) * 2; if (dir === 'across') { out[o] = v; out[o + 1] = u[k]; } else { out[o] = u[k]; out[o + 1] = v; } }
  }
  return out;
}

/** The new uvs of one of `mesh.cells` (buildMesh's cell record: a road cell or a seam) whose mesh object is `node`, or null when it wears no texture or is not a core cell. */
function flowCell(mesh, segments, set, cell, node) {
  const st = mesh && mesh._state, seg = segments[cell.piece], f = floorOf(seg, set), edge = f ? set.bySegment(seg.id).floor.edge : undefined;
  if (!f || !st || !node) return null;
  const uvs = node.uvs, tw = f.tileWidth;
  if (!cell.seam) {
    const pc = st.pieces[cell.piece], n = Number(cell.name.slice(cell.name.lastIndexOf('_') + 1)), c = pc && pc.cells[n];
    if (!c || !c.rowS || c.rowS.length * pc.K * 2 !== uvs.length) return null;
    // the cell's first row is the segment before's end section (the mesh joins them there): its arc, read as mesh.js stores it (u = arc / 10 in a float), when it
    // has as many vertices; the first cell of a segment only (a piece's later cells start where the same segment's earlier cell ended)
    const ip = cell.piece === 0 ? (st.closed ? st.pieces.length - 1 : -1) : cell.piece - 1, prev = ip >= 0 ? st.pieces[ip] : null;
    let startArc = n === 0 && prev && prev.K === pc.K && prev.Us && prev.Us.length === pc.K ? Float64Array.from(prev.Us, (x) => Math.fround(x / 10) * 10) : null;
    // a section that does not change: two segments' arcs agree to floating noise (5e-14 m on a plain road), which a float can round either way, so the start
    // arc is taken only where the section moved by more than SAME_ARC_M somewhere across the row; below that the rows keep their bytes
    if (startArc) { let d = 0; for (let k = 0; k < pc.K; k++) d = Math.max(d, Math.abs(startArc[k] - uvs[k * 2] * 10)); if (!(d > SAME_ARC_M)) startArc = null; }
    return build(uvs, pc.K, c.rowS, [{ K: pc.K, ring: closedRing(seg), n: ringRunN(st, segments, cell.piece, tw) }], f, edge, startArc);
  }
  // a seam joins the piece before to this one; the lap's first seam (piece 0, on a closed track) joins the LAST piece to the first
  const ia = cell.piece === 0 ? st.pieces.length - 1 : cell.piece - 1, A = st.pieces[ia], B = st.pieces[cell.piece], sm = st.seams[cell.piece];
  if (!A || !B || !sm || (A.K + B.K) * 2 !== uvs.length) return null;
  return build(uvs, A.K + B.K, [sm.s], [{ K: A.K, ring: closedRing(segments[ia]), n: ringRunN(st, segments, ia, tw) }, { K: B.K, ring: closedRing(seg), n: ringRunN(st, segments, cell.piece, tw) }], f, edge);   // a seam is ONE row of both rings end to end
}

/**
 * ONE WHOLE NUMBER OF REPEATS ROUND FOR A RUN OF CLOSED RINGS: n from the run's median circumference (each segment's own, mesh.js's Us end to end), so it never
 * flips along a ring that widens or narrows (each row takes round(w / tileWidth) of its own w, and on a ring easing 60 -> 32 m n went 6, 5, 4, 3, each change a
 * jump of a whole repeat across the walls). The median, not the first ring: a ring that widens into a long tube keeps the long tube's own n, so a tube of one width
 * is laid as before. null for a segment that is not a closed ring (its rows keep their own). Kept per mesh state and segments, rebuilt when either is replaced or grows.
 */
const RUNS = new WeakMap();
// the across arc a section must move by, from one segment to the next, before a row's start arc is taken from the segment before (0.1 mm: a section that eases
// moves by millimetres to centimetres a 2 m segment, his tube narrowing 60 -> 32 m by about 3 cm at the roof)
const SAME_ARC_M = 1e-4;
function ringRunN(st, segments, i, tileWidth) {
  if (!closedRing(segments[i]) || !(tileWidth > 0)) return null;
  let memo = RUNS.get(st);
  if (!memo || memo.segments !== segments || memo.len !== st.pieces.length || memo.tw !== tileWidth) { memo = { segments, len: st.pieces.length, tw: tileWidth, n: new Map() }; RUNS.set(st, memo); }
  if (memo.n.has(i)) return memo.n.get(i);
  const ring = (j) => j >= 0 && j < st.pieces.length && st.pieces[j] && st.pieces[j].Us && closedRing(segments[j]);
  let a = i, b = i; while (ring(a - 1)) a--; while (ring(b + 1)) b++;
  const ws = []; for (let j = a; j <= b; j++) { const U = st.pieces[j].Us; ws.push(U[U.length - 1] - U[0]); }
  ws.sort((x, y) => x - y);
  const n = Math.max(1, Math.round(ws[(ws.length - 1) >> 1] / tileWidth));
  for (let j = a; j <= b; j++) memo.n.set(j, n);
  return n;
}

/** Every textured core cell of the mesh: Map(mesh object -> uvs). The cells pair with the root's children by position (set.js withTextureSet does the same). */
function flowUvs(mesh, segments, set) {
  const out = new Map();
  if (!set) return out;
  const kids = mesh.scene.root.children;
  mesh.cells.forEach((cell, k) => { const node = kids[k] && kids[k].children[0], u = flowCell(mesh, segments, set, cell, node); if (u) out.set(node, u); });
  return out;
}

module.exports = { flowCell, flowUvs, closedRing };
