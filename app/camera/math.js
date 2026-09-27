// math.js: the camera's matrices, COLUMN-MAJOR (v' = M·v), as GL takes them. Written after blackbox's ui/mathutil.js
// (mPerspective, mLookAt, mMul), which keeps two conventions apart; this file has only the column-major one.
//
// kn5 node matrices (src/geom/mesh.js matrixOf, src/export/scene.js) are ROW-VECTOR, row-major: world = local · M. The
// same 16 numbers read column-major give v' = M·v with the identical result, so a node matrix goes to GL as it is
// (app/preview/batches.js relies on this, and app/test/preview.test.js checks it against the geometry's own transform).
'use strict';

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function lookAt(eye, at, up) {
  let zx = eye[0] - at[0], zy = eye[1] - at[1], zz = eye[2] - at[2];
  const zl = Math.hypot(zx, zy, zz); if (!(zl > 0)) throw new Error('lookAt: eye and target coincide');
  zx /= zl; zy /= zl; zz /= zl;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  const xl = Math.hypot(xx, xy, xz); if (!(xl > 0)) throw new Error('lookAt: up is parallel to the view direction');
  xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]), -(yx * eye[0] + yy * eye[1] + yz * eye[2]), -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1];
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
/** Apply a column-major matrix to a point (w = 1), returning [x, y, z, w]. */
const apply = (M, p) => [0, 1, 2, 3].map((r) => M[r] * p[0] + M[4 + r] * p[1] + M[8 + r] * p[2] + M[12 + r]);

/** The view-projection of a camera pose ({ eye, target, up, fov, far? }) for a view of the given aspect. Near 0.5 m;
 *  far is the pose's own (the fitted overhead of a long track needs more) and never under 20 km. */
const NEAR = 0.5, FAR = 20000;
const viewProj = (pose, aspect) => mul(perspective(pose.fov, aspect, NEAR, Math.max(FAR, pose.far || 0)), lookAt(pose.eye, pose.target, pose.up));

module.exports = { perspective, lookAt, mul, apply, viewProj, NEAR, FAR };
