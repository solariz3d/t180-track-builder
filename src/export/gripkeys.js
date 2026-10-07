// gripkeys.js: GRIP PER PIECE in the export (D261, the export half). A road piece's grip (src/core/document.js gripOf: a whole percent of AC's road
// grip, 50 to 150, 100 when the piece carries none) reaches AC as a SURFACE: the physics mesh `1<KEY>…` drives on the [SURFACE_n] whose KEY it names
// (AC's system/data/surfaces.ini: ROAD is FRICTION=1).
//   · 100% writes nothing new: the piece's road meshes stay `1ROAD_…` on AC's own ROAD, so an all-100 track exports byte for byte as before.
//   · any other grip g is the key GRIP + g in three digits (GRIP050 … GRIP150): fixed width, so no grip key is the start of another key.
//     Its meshes are `1GRIPnnn_<piece>_<n>` and its surface is AC's ROAD with FRICTION = g/100 (every other line as ROAD's, gripSurface below).
//   · CSP's soft-collision block lists `1GRIP?` beside `1ROAD?` (the CSP wiki: `?` is any symbols), trackfiles.js surfacesIni.
//   gripKey(g)                       -> 'GRIP070' (null at 100)
//   withGripKeys(scene, mesh, segs)  -> the scene with each gripped segment's road cells (and seams) renamed 1ROAD_… -> 1GRIPnnn_…
//   gripsOf(scene)                   -> the distinct grips (≠ 100) the scene's physics meshes name, ascending
//   gripSurface(g, n)                -> the [SURFACE_n] text for grip g
'use strict';
const { walkScene } = require('./markers.js');

// The core's range (src/core/document.js GRIP_MIN / GRIP_MAX / GRIP_DEFAULT; test/export_grip.test.js pins them equal), restated so that the file writer
// (trackfiles.js) does not load the core: the core needs tools/, and the look-match harness copies src/ alone (test/lookmatch_mutation.test.js).
const GRIP_MIN = 50, GRIP_MAX = 150, GRIP_DEFAULT = 100;
const GRIP_MESH = /^1GRIP(\d{3})_/;
function gripKey(g) {
  if (typeof g !== 'number' || !Number.isInteger(g) || g < GRIP_MIN || g > GRIP_MAX) throw Object.assign(new Error(`a grip is a whole percent of AC's road grip, from ${GRIP_MIN} to ${GRIP_MAX}, got ${JSON.stringify(g)}`), { code: 'BAD_GRIP' });
  return g === GRIP_DEFAULT ? null : `GRIP${String(g).padStart(3, '0')}`;
}

/**
 * The scene's road cells renamed by their segment's grip (src/core/adapter.js toSegments puts `grip` on a road segment only when it is not 100).
 * The scene's first children are the mesh's own nodes in mesh.cells order (the pit lane and the skins are appended after them, as withUnderskin
 * and withTextureSet rely on), and only their mesh's NAME changes: the geometry, material and flags are the same objects' values.
 */
function withGripKeys(scene, mesh, segments) {
  if (!mesh || !mesh.cells || !segments.some((g) => g.grip !== undefined && g.grip !== GRIP_DEFAULT)) return scene;
  const kids = scene.root.children;
  const children = kids.map((c, k) => {
    const cell = k < mesh.cells.length ? mesh.cells[k] : null, seg = cell ? segments[cell.piece] : null, key = seg && seg.grip !== undefined ? gripKey(seg.grip) : null;
    if (!key) return c;
    const m = c.children && c.children[0];
    if (!m || m.name !== cell.name) throw new Error(`withGripKeys: scene node ${k} is not the mesh's cell ${k} (${m && m.name} against ${cell.name})`);
    if (!/^1ROAD_/.test(m.name)) throw new Error(`withGripKeys: cell ${m.name} is not a 1ROAD_ road mesh, so grip ${seg.grip} has no mesh to name`);
    return { ...c, children: [{ ...m, name: m.name.replace(/^1ROAD_/, `1${key}_`) }, ...c.children.slice(1)] };
  });
  return { ...scene, root: { ...scene.root, children } };
}

/** The distinct grips (not 100) that the scene's physics meshes are named for, ascending. */
function gripsOf(scene) {
  const out = new Set();
  for (const m of walkScene(scene).meshes) { const x = GRIP_MESH.exec(m.name || ''); if (x) out.add(Number(x[1])); }
  return [...out].sort((a, b) => a - b);
}

/**
 * The surface for grip g: AC's own ROAD (system/data/surfaces.ini [SURFACE_0], read on D 2026-10-06) line for line, with its KEY and FRICTION changed.
 * Nothing else differs, so a gripped piece drives as ROAD does in every way but grip (the sound, the vibration, valid-track, not pit lane).
 */
function gripSurface(g, n) {
  const key = gripKey(g);
  if (!key) throw new Error('gripSurface: 100% is AC\'s own ROAD and gets no surface');
  return [
    `[SURFACE_${n}]`,
    `; grip ${g}% (D261): AC's ROAD with FRICTION ${g}/100; the road meshes of a ${g}% piece are 1${key}_…`,
    `KEY=${key}`,
    `FRICTION=${g / 100}`,
    'DAMPING=0',
    'WAV=',
    'WAV_PITCH=0',
    'FF_EFFECT=NULL',
    'DIRT_ADDITIVE=0',
    'BLACK_FLAG_TIME=0',
    'IS_VALID_TRACK=1',
    'SIN_HEIGHT=0',
    'SIN_LENGTH=0',
    'IS_PITLANE=0',
    'VIBRATION_GAIN=0',
    'VIBRATION_LENGTH=0',
    '',
  ].join('\n');
}

module.exports = { gripKey, withGripKeys, gripsOf, gripSurface, GRIP_MESH, GRIP_MIN, GRIP_MAX, GRIP_DEFAULT };
