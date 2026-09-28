// cameras.js: resolve a look-match reference view (src/lookmatch/views.json) to a world camera pose on a real track.
//
//   loadViews(text)                 the views file, checked: { tracks, views }
//   resolveView(view, dummies)      { id, eye, target, up, fovDeg, width, height, anchor, forward } in the track's world
//                                   coordinates (the kn5's own, as tools/kn5.cjs reads them: y up)
//
// The ANCHOR is one of the track's AC_ dummies ({ name, pos, fwd } as tools/kn5.cjs gives them). Its forward axis is made
// horizontal and SIGNED by the track's race direction (src/export/markers.js raceDirection: back grid slot → pole),
// because some authors' marker axes point backwards (FINDINGS §7b). left = up × forward, as src/export/markers.js defines
// it. The camera sits at anchor + up·U + forward·F + right·R, and looks along F turned by yawDeg about up (+ = left) and
// then by pitchDeg (+ = up).
'use strict';
const { raceDirection } = require('../export/markers.js');

const DEG = Math.PI / 180;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a); return l > 1e-12 ? mul(a, 1 / l) : null; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const UP = [0, 1, 0];
const FIELDS = ['up', 'forward', 'right', 'yawDeg', 'pitchDeg', 'fovDeg', 'width', 'height'];

function loadViews(text) {
  let v; try { v = JSON.parse(text); } catch (e) { throw new Error(`lookmatch: the views file is not JSON (${e.message})`); }
  if (!v || typeof v.tracks !== 'object' || !Array.isArray(v.views) || !v.views.length) throw new Error('lookmatch: the views file needs "tracks" and a non-empty "views" list');
  const ids = new Set();
  for (const w of v.views) {
    if (!w || typeof w.id !== 'string' || !/^[a-z0-9-]+$/.test(w.id)) throw new Error(`lookmatch: a view needs a file-safe id, got ${w && w.id}`);
    if (ids.has(w.id)) throw new Error(`lookmatch: view id ${w.id} is used twice`); ids.add(w.id);
    if (!v.tracks[w.track]) throw new Error(`lookmatch: view ${w.id} names track ${w.track}, which is not in "tracks"`);
    if (typeof w.anchor !== 'string' || !/^AC_/.test(w.anchor)) throw new Error(`lookmatch: view ${w.id} needs an AC_ dummy as its anchor`);
    for (const k of FIELDS) if (!Number.isFinite(w[k])) throw new Error(`lookmatch: view ${w.id}: ${k} is not a number`);
    if (!(w.fovDeg > 1 && w.fovDeg < 170) || !(Number.isInteger(w.width) && w.width > 0 && w.width <= 4096) || !(Number.isInteger(w.height) && w.height > 0 && w.height <= 4096)) throw new Error(`lookmatch: view ${w.id}: a field of view in (1°, 170°) and a size up to 4096 px`);
  }
  return v;
}

function resolveView(view, dummies) {
  const a = dummies.find((d) => d.name === view.anchor);
  if (!a) throw new Error(`lookmatch: view ${view.id}: the track has no ${view.anchor}`);
  const grid = dummies.filter((d) => /^AC_START_\d+$/.test(d.name)).sort((x, y) => +x.name.slice(9) - +y.name.slice(9));
  const race = raceDirection(grid);
  let F = unit([a.fwd[0], 0, a.fwd[2]]) || race;
  if (!F) throw new Error(`lookmatch: view ${view.id}: ${view.anchor} has no horizontal forward axis and the track no grid`);
  if (race && dot(F, race) < 0) F = mul(F, -1);          // an author's axis pointing backwards
  const L = cross(UP, F), R = mul(L, -1);
  const eye = add(add(add(a.pos, mul(UP, view.up)), mul(F, view.forward)), mul(R, view.right));
  const yaw = view.yawDeg * DEG, pitch = view.pitchDeg * DEG;
  const H = add(mul(F, Math.cos(yaw)), mul(L, Math.sin(yaw))), D = add(mul(H, Math.cos(pitch)), mul(UP, Math.sin(pitch)));
  return { id: view.id, eye, target: add(eye, mul(D, 10)), up: UP.slice(), fovDeg: view.fovDeg, width: view.width, height: view.height, anchor: view.anchor, forward: F };
}

module.exports = { loadViews, resolveView };
