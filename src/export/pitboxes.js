// pitboxes.js (export): D279 follow-up, the PAINTED PIT BOXES wear the road (the keeper, 2026-10-09, asked which pits: "The painted pit boxes").
//
//   withPitBoxFloor(scene, paint, { path, segments, lane, set }) -> scene
//     paint: placeAll's paint (src/markers/paint.js paintFor), whose `su` holds each pit box's vertices' (s, u) and whether it is on the lane
//     lane:  buildPitLane's result, or null; set: the texture set, or null (the solid road)
//
// An equation-core track has no pit lane: its pits sit on the main road, marked by the pit-box outlines, which were near-white paint
// (t180b_paint). Each PAINT_PIT_n now wears what the road under it wears:
//   - the material: the floor material of the road segment it lies on (a made texture or the user's picture), or the road's own t180b_road
//     when the floor is not textured. On a solid-colour road the boxes are then the road's own flat colour and NO LONGER SHOW: that is what
//     was asked ("blend into the road"), and it is said here so nobody has to find it out.
//     A box on a word document's pit lane wears the lane's floor, which is the floor of the segment the lane leaves (pitlane.js withLaneFloor).
//   - the texture coordinates: the road's own at each vertex. On an equation-core road with a textured floor, the path's arc length
//     (src/texture/flow.js): u / tileWidth across, (s + offset) / tileLength along (swapped for a texture laid 'across'). Everywhere else,
//     mesh.js's rule: u / 10 across, (s − the segment's first s) / 10 along.
// The box geometry (lifted 2 cm), the start line, the grid boxes and the AC_PIT_n spawn markers are untouched; the paint material stays for them.
'use strict';
const { segStarts } = require('../markers/place.js');

const segIndexAt = (starts, s) => { let k = 0; for (let i = 0; i < starts.length; i++) if (starts[i] <= s + 1e-9) k = i; return k; };
const texturedFloor = (set, seg) => {
  const slots = set && seg ? set.bySegment(seg.id) : null, f = slots && slots.floor;
  return f && (f.settings.texture || f.settings.make) ? f : null;
};

function withPitBoxFloor(scene, paint, { path, segments, lane = null, set = null } = {}) {
  if (!paint || !paint.su || !paint.su.size) return scene;
  const matIdx = (name) => scene.materials.findIndex((m) => m.name === name);
  const mainStarts = segStarts(path, segments), laneStarts = lane ? segStarts(lane.path, lane.segments) : null;
  const leaveSeg = lane ? segments[segIndexAt(mainStarts, lane.joins.leave.s)] : null;
  const dress = (n) => {
    const info = paint.su.get(n.name);
    if (!info) return n;
    const [segs, starts] = info.onLane ? [lane.segments, laneStarts] : [segments, mainStarts];
    const su = info.su, here = segs[segIndexAt(starts, su[0])];
    const f = texturedFloor(set, info.onLane ? leaveSeg : here);
    const name = f ? f.material : 't180b_road', idx = matIdx(name);
    if (idx < 0) throw new Error(`PIT_BOX_FLOOR: ${n.name} would wear ${name}, which is not in the scene`);
    const flow = f && !info.onLane && here.word === 'core', st = f ? f.settings : null, uvs = new Float32Array(su.length);
    for (let i = 0; i < su.length; i += 2) {
      const s = su[i], u = su[i + 1];
      let U, V;
      if (flow) { const a = u / st.tileWidth, b = (s + st.offset) / st.tileLength; [U, V] = st.dir === 'across' ? [b, a] : [a, b]; }
      else { U = u / 10; V = (s - starts[segIndexAt(starts, s)]) / 10; }
      uvs[i] = U; uvs[i + 1] = V;
    }
    return { ...n, material: idx, uvs };
  };
  const walk = (n) => (n.type === 'mesh' ? dress(n) : { ...n, children: (n.children || []).map(walk) });
  return { ...scene, root: walk(scene.root) };
}

module.exports = { withPitBoxFloor };
