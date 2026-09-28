// trackfiles.js: every file of an AC track folder EXCEPT the kn5 (that is src/export/kn5write.js), written from a scene
// in the shared T1 shape (src/export/scene.js) and a small track description. docs/ARCHITECTURE.md §6 "Files" is the
// list. Pure functions return strings / Buffers; `writeTrackFiles` puts them on disk. Dependency-free: node's zlib only.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { walkScene, isDrivable, countPits } = require('./markers.js');

// ── data/surfaces.ini ──────────────────────────────────────────────────────────────────────────────────────────────
// THE T-180 SOFT-COLLISION BLOCK. Its numbers are docs/FINDINGS.md §4c, lines 80-81: `MESHES = 1ROAD?`, `SOFT_ERP=0.8`,
// `SOFT_CFM=0.0002`, `BOUNCE=0.1`, `MAX_DEPTH=4`, and `FRICTION` 0.05 (the value on eight of the eleven tracks; the
// other three raise it only because they add pit concrete). The section header `[COLLISION_PARAMS_...]` is the form
// all those tracks use (read locally on D, 2026-09-27: centrifuge, sakura_speedway, ohyeah2389_t180testtrack); it is
// CSP's own syntax, so it is written as-is. No other author's text is copied: the keys and values are FINDINGS'.
// INTENSITY / RIGID_WITH_BODIES / RIGID_WITH_BOXES, which the observed blocks also set (to 1 / 0 / 0), are NOT in
// FINDINGS §4c and are left to CSP's defaults here; the hand-back names this as a difference to test if the soft road
// does not reproduce.
const SOFT_COLLISION_BLOCK = [
  '[COLLISION_PARAMS_...]',
  '; T-180 soft road (docs/FINDINGS.md §4c). CSP only: plain AC ignores this section.',
  'MESHES=1ROAD?',
  'SOFT_ERP=0.8',
  'SOFT_CFM=0.0002',
  'BOUNCE=0.1',
  'FRICTION=0.05',
  'MAX_DEPTH=4',
  '',
].join('\n');

const SURFACES_HEADER = [
  '; data/surfaces.ini, written by t180-track-builder.',
  '; The road and walls use AC\'s own surfaces (system/data/surfaces.ini: ROAD, GRASS, KERB, SAND); none are redefined.',
  '; A T-180 track also defines PIT, which no mesh here uses, to carry CSP\'s extended-physics flag.',
  '',
].join('\n');

// CSP'S EXTENDED-PHYSICS SWITCH (ARCHITECTURE §6: the soft-collision block "plus CSP's WAV_PITCH=extended-0 opt-in with a
// CSP-only warning"; missed until R1, docs/research/04_ac_physics_drivability.md §2). SOURCED there from the CSP wiki
// (Tracks – Enabling extended physics): one surface in surfaces.ini with `WAV_PITCH=extended-0` marks the track as using
// extended physics, and plain AC without CSP would crash on that value. MEASURED there: 25 of the 39 installed
// surfaces.ini files with the soft block also carry it (Sakura, Centrifuge, the Test Track, Hazen, Coast, Rainbow), on a
// `KEY=PIT` surface. It is written the same way, with AC's standard surface keys. No mesh of this builder is keyed PIT
// (the pit lane is `1ROAD_PIT_…`, src/geom/pitlane.js), so defining it changes nothing but the flag. Whether the soft
// block NEEDS the switch is UNVERIFIED (research §2: the keeper's one AC test settles it); it is written because
// ARCHITECTURE §6 says so and the proven tracks do.
const EXTENDED_PHYSICS_SURFACE = [
  '[SURFACE_0]',
  '; CSP extended physics (ARCHITECTURE §6). Needs Custom Shaders Patch: plain AC can crash loading this file.',
  'KEY=PIT',
  'FRICTION=1',
  'DAMPING=0',
  'WAV=',
  'WAV_PITCH=extended-0',
  'FF_EFFECT=NULL',
  'DIRT_ADDITIVE=0',
  'BLACK_FLAG_TIME=0',
  'IS_VALID_TRACK=1',
  'SIN_HEIGHT=0',
  'SIN_LENGTH=0',
  'IS_PITLANE=1',
  'VIBRATION_GAIN=0',
  'VIBRATION_LENGTH=0',
  '',
].join('\n');

/** The warning that goes with the switch, wherever an export writes it (the app shows export warnings). */
const CSP_ONLY_WARNING = 'csp-only: surfaces.ini sets WAV_PITCH=extended-0, CSP\'s extended physics (ARCHITECTURE §6). Assetto Corsa without Custom Shaders Patch can crash loading this track (CSP wiki, "Tracks – Enabling extended physics"; docs/research/04_ac_physics_drivability.md §2). Turn off "T-180 track" to export without it.';

/**
 * surfaces.ini. `softCollision`: the T-180 soft-collision block. `extendedPhysics`: CSP's extended-0 surface. Both default
 * to on (a T-180 track). They are separate so the soft-road CONTROL (the noblock variant) differs from the block variant
 * by the block ALONE (FINDINGS §4c's registered prediction must not test two things at once); the app's "T-180 track"
 * toggle turns both on or both off.
 */
function surfacesIni({ softCollision = true, extendedPhysics = true } = {}) {
  return SURFACES_HEADER + (extendedPhysics ? '\n' + EXTENDED_PHYSICS_SURFACE : '') + (softCollision ? '\n' + SOFT_COLLISION_BLOCK : '');
}

// ── models.ini / models_<layout>.ini ───────────────────────────────────────────────────────────────────────────────
function modelsIniName(layout) { return layout ? `models_${layout}.ini` : 'models.ini'; }
function modelsIni(kn5Files) {
  if (!Array.isArray(kn5Files) || !kn5Files.length) throw new Error('modelsIni: at least one kn5 file name is required');
  return kn5Files.map((f, i) => {
    if (!/^[^\\/]+\.kn5$/i.test(f)) throw new Error(`modelsIni: "${f}" is not a bare .kn5 file name`);
    return `[MODEL_${i}]\nFILE=${f}\nPOSITION=0,0,0\nROTATION=0,0,0\n`;
  }).join('\n');
}

// ── ui/ui_track.json ───────────────────────────────────────────────────────────────────────────────────────────────
/** `pitboxes` is COUNTED from the scene's AC_PIT_n markers (ARCHITECTURE §5c), never taken from `desc`. */
function uiTrack(scene, desc = {}) {
  if (!desc.name) throw new Error('uiTrack: desc.name is required');
  const pits = countPits(scene);
  const m = (v) => (typeof v === 'number' ? `${Math.round(v)}m` : v);
  return {
    name: desc.name,
    description: desc.description || '',
    tags: desc.tags || ['t180', 'original'],
    geotags: desc.geotags || [],
    country: desc.country || '',
    city: desc.city || '',
    length: m(desc.length) || '',
    width: m(desc.width) || '',
    pitboxes: String(pits),
    run: desc.run || '',   // never guessed: clockwise vs counter depends on the axis handedness, not measured here
    author: desc.author || '',
    version: desc.version || '0.1',
    url: desc.url || null,
    year: desc.year || new Date().getFullYear(),
  };
}

// ── map.png + data/map.ini: Content Manager's formula ──────────────────────────────────────────────────────────────
// Source: AcTools, AcTools.Render/Kn5SpecificSpecial/TrackMapRenderer.cs (github.com/gro-ove/actools, master @ 812f856):
//   :762-783  width = size.X × Scale, height = size.Z × Scale; image Width = (int)(width + 2·Margin), same for Height
//   :786-793  XOffset = −box.Minimum.X + Margin / Scale;  ZOffset = −box.Minimum.Z + Margin / Scale;  ScaleFactor = 1 / Scale
//   :394-400  map.ini WIDTH = Width + 2·Margin (i.e. the image width), HEIGHT likewise, MARGIN, SCALE_FACTOR, DRAWING_SIZE
//   :285, :289, :388  defaults Margin = 10, Scale = 1, DrawingSize = 10
// `box` there is the bounding box of the road meshes; here it is the drivable physics meshes (<digit><KEY>, not WALL).
// A world point (x, z) lands on pixel ((x + X_OFFSET) / SCALE_FACTOR, (z + Z_OFFSET) / SCALE_FACTOR).
function roadMeshes(scene) {
  const road = walkScene(scene).meshes.filter((m) => isDrivable(m.name));
  if (!road.length) throw new Error('no drivable physics mesh (<digit><KEY>, KEY not WALL) in the scene');
  return road;
}
function mapParams(scene, { margin = 10, scale = 1, drawingSize = 10 } = {}) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const m of roadMeshes(scene)) for (let i = 0; i < m.positions.length; i += 3) {
    const x = m.positions[i], z = m.positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const width = Math.trunc((maxX - minX) * scale + margin * 2), height = Math.trunc((maxZ - minZ) * scale + margin * 2);
  return { WIDTH: width, HEIGHT: height, X_OFFSET: -minX + margin / scale, Z_OFFSET: -minZ + margin / scale, MARGIN: margin, SCALE_FACTOR: 1 / scale, DRAWING_SIZE: drawingSize };
}
function mapIni(p) {
  return '[PARAMETERS]\n' + ['WIDTH', 'HEIGHT', 'X_OFFSET', 'Z_OFFSET', 'MARGIN', 'SCALE_FACTOR', 'DRAWING_SIZE'].map((k) => `${k}=${+p[k].toFixed(4)}`).join('\n') + '\n';
}

/** Rasterise the road's triangles, seen from above, into an RGBA buffer: `toPx(x, z)` → [px, py]. */
function rasterRoad(scene, width, height, toPx, rgba = [255, 255, 255, 255]) {
  const img = Buffer.alloc(width * height * 4);
  for (const m of roadMeshes(scene)) {
    const P = m.positions, I = m.indices;
    for (let t = 0; t < I.length; t += 3) {
      const v = [0, 1, 2].map((k) => toPx(P[I[t + k] * 3], P[I[t + k] * 3 + 2]));
      const area = (v[1][0] - v[0][0]) * (v[2][1] - v[0][1]) - (v[2][0] - v[0][0]) * (v[1][1] - v[0][1]);
      if (Math.abs(area) < 1e-9) continue;   // edge-on from above (a vertical wall face)
      const x0 = Math.max(0, Math.floor(Math.min(v[0][0], v[1][0], v[2][0]))), x1 = Math.min(width - 1, Math.ceil(Math.max(v[0][0], v[1][0], v[2][0])));
      const y0 = Math.max(0, Math.floor(Math.min(v[0][1], v[1][1], v[2][1]))), y1 = Math.min(height - 1, Math.ceil(Math.max(v[0][1], v[1][1], v[2][1])));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const e = (a, b) => (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
        const w0 = e(v[1], v[2]), w1 = e(v[2], v[0]), w2 = e(v[0], v[1]);
        if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) { const o = (y * width + x) * 4; img[o] = rgba[0]; img[o + 1] = rgba[1]; img[o + 2] = rgba[2]; img[o + 3] = rgba[3]; }
      }
    }
  }
  return img;
}

function mapPng(scene, p = mapParams(scene)) {
  const img = rasterRoad(scene, p.WIDTH, p.HEIGHT, (x, z) => [(x + p.X_OFFSET) / p.SCALE_FACTOR, (z + p.Z_OFFSET) / p.SCALE_FACTOR]);
  return encodePng(p.WIDTH, p.HEIGHT, img);
}

/** The road fitted into a w×h frame with a margin: outline.png (white on transparent) and preview.png (on a backdrop). */
function fittedPng(scene, w, h, { margin = 8, rgba = [255, 255, 255, 255], background = null } = {}) {
  const p = mapParams(scene, { margin: 0 });
  const s = Math.min((w - 2 * margin) / Math.max(p.WIDTH, 1), (h - 2 * margin) / Math.max(p.HEIGHT, 1));
  const ox = (w - p.WIDTH * s) / 2, oy = (h - p.HEIGHT * s) / 2;
  const img = rasterRoad(scene, w, h, (x, z) => [ox + (x + p.X_OFFSET) * s, oy + (z + p.Z_OFFSET) * s], rgba);
  if (background) for (let i = 0; i < w * h * 4; i += 4) if (img[i + 3] === 0) { img[i] = background[0]; img[i + 1] = background[1]; img[i + 2] = background[2]; img[i + 3] = 255; }
  return encodePng(w, h, img);
}
// Sizes: the CM-generated UI of the T-180 Test Track on D (ui/outline.png 365×192, ui/preview.png 355×200). inferred: CM's defaults.
const outlinePng = (scene) => fittedPng(scene, 365, 192);
const previewPng = (scene) => fittedPng(scene, 355, 200, { rgba: [200, 200, 200, 255], background: [24, 26, 30] });

// ── PNG, dependency-free (RFC 2083 / the PNG spec: signature, IHDR, IDAT, IEND; CRC-32 over type + data) ─────────────
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** RGBA8 → PNG (colour type 6, filter 0 on every row). */
function encodePng(width, height, rgba) {
  if (!(width > 0 && height > 0) || rgba.length !== width * height * 4) throw new Error(`encodePng: ${width}×${height} needs ${width * height * 4} bytes, got ${rgba.length}`);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ── the whole folder ───────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Write every non-kn5 file of one track folder. Returns the list of relative paths written (for the install marker).
 * opts: { softCollision, extendedPhysics, kn5Files: ['x.kn5'], desc }.
 */
function writeTrackFiles(dir, scene, { softCollision = true, extendedPhysics = true, kn5Files, desc } = {}) {
  const files = {
    'data/surfaces.ini': surfacesIni({ softCollision, extendedPhysics }),
    [modelsIniName(null)]: modelsIni(kn5Files),
    'ui/ui_track.json': JSON.stringify(uiTrack(scene, desc), null, 2) + '\n',
    'ui/preview.png': previewPng(scene),
    'ui/outline.png': outlinePng(scene),
  };
  const mp = mapParams(scene);
  files['map.png'] = mapPng(scene, mp);
  files['data/map.ini'] = mapIni(mp);
  for (const [rel, body] of Object.entries(files)) { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); }
  return Object.keys(files);
}

module.exports = { SOFT_COLLISION_BLOCK, EXTENDED_PHYSICS_SURFACE, CSP_ONLY_WARNING, surfacesIni, modelsIni, modelsIniName, uiTrack, mapParams, mapIni, mapPng, outlinePng, previewPng, encodePng, crc32, writeTrackFiles };
