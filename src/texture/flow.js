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
// WHAT IT TOUCHES: only cells of a segment whose word is 'core' (the equation core's) with a textured FLOOR slot (an image or a made
// texture, the rule src/texture/set.js withTextureSet already uses for the material). A word document's texture coordinates, and every
// untextured track's, are exactly what mesh.js made; the export without a texture set is byte for byte what it was.
'use strict';
const { normalize } = require('../geom/profile.js');

const DEG = Math.PI / 180, CLOSED_RAD = (180 - 1e-3) * DEG;

const ringShape = (profile) => { const P = normalize(profile), n = P.psi.length; return n >= 3 && Math.abs(P.psi[0]) >= CLOSED_RAD && Math.abs(P.psi[n - 1]) >= CLOSED_RAD; };
/**
 * True when the segment's section is a closed ring all along it: |ψ| is 180° at both edges at its end (seg.profile) AND at its start (seg.blend.from, the
 * shape a core chord segment starts from; a segment that morphs from an open section into the tube is not a ring until the morph is done), and it is not
 * a ramp from another section (profileIn).
 */
function closedRing(seg) {
  if (!seg || !seg.profile || seg.profileIn !== undefined) return false;
  return ringShape(seg.profile) && (!seg.blend || (!!seg.blend.from && ringShape(seg.blend.from)));
}

/** The floor slot's settings if this segment is a core segment that wears a texture, else null. */
function floorOf(seg, set) {
  if (!seg || seg.word !== 'core' || !set) return null;
  const slots = set.bySegment(seg.id), f = slots && slots.floor && slots.floor.settings;
  return f && (f.texture || f.make) ? f : null;
}

/** u for one row of `K` vertices whose arc lengths are `arc[k]` (from the mesh's own u, ×10): a ring's whole-number wrap, or the plain tile. */
function rowU(arc, K, ring, tileWidth) {
  const out = new Float64Array(K);
  const w = arc[K - 1] - arc[0];
  if (ring && w > 0) { const n = Math.max(1, Math.round(w / tileWidth)); for (let k = 0; k < K; k++) out[k] = (n * arc[k]) / w; }
  else for (let k = 0; k < K; k++) out[k] = arc[k] / tileWidth;
  return out;
}

/** Texture coordinates for one cell: R rows of K vertices, row r at path arc length rowS[r]; `rings[k]` says whether vertex column k wears a closed ring. */
function build(uvs, K, rowS, segOf, settings) {
  const R = uvs.length / (2 * K), out = new Float32Array(uvs.length), { tileLength, tileWidth, offset, dir } = settings;
  for (let r = 0; r < R; r++) {
    const arc = new Float64Array(K); for (let k = 0; k < K; k++) arc[k] = uvs[(r * K + k) * 2] * 10;   // the mesh's u is arc length / 10
    const u = segOf.length === 1 ? rowU(arc, K, segOf[0].ring, tileWidth) : (() => {                    // a seam: two rows end to end, each its own segment's
      const o = new Float64Array(K); let a = 0;
      for (const part of segOf) { const sub = rowU(arc.subarray(a, a + part.K), part.K, part.ring, tileWidth); o.set(sub, a); a += part.K; }
      return o;
    })();
    const v = (rowS[r] + offset) / tileLength;
    for (let k = 0; k < K; k++) { const o = (r * K + k) * 2; if (dir === 'across') { out[o] = v; out[o + 1] = u[k]; } else { out[o] = u[k]; out[o + 1] = v; } }
  }
  return out;
}

/** The new uvs of one of `mesh.cells` (buildMesh's cell record: a road cell or a seam) whose mesh object is `node`, or null when it wears no texture or is not a core cell. */
function flowCell(mesh, segments, set, cell, node) {
  const st = mesh && mesh._state, seg = segments[cell.piece], f = floorOf(seg, set);
  if (!f || !st || !node) return null;
  const uvs = node.uvs;
  if (!cell.seam) {
    const pc = st.pieces[cell.piece], n = Number(cell.name.slice(cell.name.lastIndexOf('_') + 1)), c = pc && pc.cells[n];
    if (!c || !c.rowS || c.rowS.length * pc.K * 2 !== uvs.length) return null;
    return build(uvs, pc.K, c.rowS, [{ K: pc.K, ring: closedRing(seg) }], f);
  }
  // a seam joins the piece before to this one; the lap's first seam (piece 0, on a closed track) joins the LAST piece to the first
  const ia = cell.piece === 0 ? st.pieces.length - 1 : cell.piece - 1, A = st.pieces[ia], B = st.pieces[cell.piece], sm = st.seams[cell.piece];
  if (!A || !B || !sm || (A.K + B.K) * 2 !== uvs.length) return null;
  return build(uvs, A.K + B.K, [sm.s], [{ K: A.K, ring: closedRing(segments[ia]) }, { K: B.K, ring: closedRing(seg) }], f);   // a seam is ONE row of both rings end to end
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
