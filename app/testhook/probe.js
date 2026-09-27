// probe.js: what the preview has on screen, as plain numbers, for the window proof (scripts/prove_render.js) and its
// tests. Read-only: it never changes the camera, the track or the canvas.
//
//   probe(preview, canvas, win) -> { mode, words?, segments, head: { s, pos, T }, pose, headNdc: [x, y, z],
//                                    lookAlongT, canvas: { width, height, cssWidth, cssHeight, dpr }, stats, error }
//   headNdc     where the build head lands on screen, in normalised device coordinates: in frame when x and y are in
//               (−1, 1) and z < 1 (in front of the far plane) with w > 0 (in front of the camera)
//   lookAlongT  the view direction · the head's T: 1 is looking straight along the growth direction
'use strict';

const M = require('../camera/math.js');

function probe(preview, canvas, win) {
  const v = preview.view(), t = v.track, stats = preview.renderer.stats();
  const size = { width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight, dpr: win.devicePixelRatio };
  if (!t || !t.path || !v.pose) return { mode: v.mode, segments: t && t.path ? t.path._nseg : 0, head: null, pose: v.pose, headNdc: null, lookAlongT: null, canvas: size, stats, error: v.error };
  const h = t.path.head, pose = v.pose, aspect = size.width / size.height;
  const clip = M.apply(M.viewProj(pose, aspect), h.pos);
  const d = [pose.target[0] - pose.eye[0], pose.target[1] - pose.eye[1], pose.target[2] - pose.eye[2]], dl = Math.hypot(...d);
  return {
    mode: v.mode, segments: t.path._nseg, head: { s: h.s, pos: h.pos, T: h.T }, pose,
    headNdc: clip[3] > 0 ? [clip[0] / clip[3], clip[1] / clip[3], clip[2] / clip[3]] : null,
    lookAlongT: (d[0] * h.T[0] + d[1] * h.T[1] + d[2] * h.T[2]) / dl, canvas: size, stats, error: v.error,
    ghost: v.ghost, grid: v.grid, bounds: t.bounds || null,
  };
}

module.exports = { probe };
