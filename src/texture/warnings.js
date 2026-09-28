// warnings.js: what AC can't do, said before export (ARCHITECTURE §5b: "Warns about what AC can't do, e.g. compressed
// normal maps aren't supported"; "Budget: a live count of texture memory and resolution per track").
//
//   checkTexture({ width, height }, { role, compress }) -> [{ level: 'refuse' | 'warn', code, message }]
//   budget(textures, { amberBytes, redBytes }) -> { bytes, level: 'ok' | 'amber' | 'red', rows, perSlot, largest, count,
//                                                   over, warnings }
//   ddsBytes(width, height) -> the bytes of this builder's DDS: 128 + 4·Σ (every mip level's texels), A8R8G8B8
//
// REFUSED: larger than 8192 on a side (AC's limit, §5b); a normal map with block compression asked for.
// WARNED: a side that is not a power of two (mips of such a texture average uneven footprints, and older GPUs and
// tools handle them worse); a texture whose alpha is not all 255 on a slot drawn opaque (the alpha is ignored).
// THE BUDGET'S LEVELS. §5b gives the counter and no number: "Budget: a live count of texture memory and resolution per
// track, because textures are the easiest way to make a track heavy" (docs/ARCHITECTURE.md:125). So the levels are
// MEASURED, on the eleven T-180 tracks FINDINGS §1 studies (results/t180.json), as the texture bytes their kn5 files embed
// (read 2026-09-27 on this machine, texture blocks only): sorted, 0.8, 6.2, 14.9, 47.8, 50.5, 53.7, 93.7, 173.3, 191.7,
// 236.9, 313.6 MiB. AMBER above the median (56,278,061 B: heavier than half of them), RED above the largest
// (328,874,531 B: heavier than every one). Those are file bytes and theirs are mostly block-compressed, while this
// builder writes uncompressed A8R8G8B8, so the same pixels cost more here; the comparison is of what the kn5 carries.
// The red is a level shown, not a refusal: whether a red budget stops an export is the keeper's call.
'use strict';
const { MAX_SIDE } = require('./dds.js');

const pow2 = (n) => n > 0 && (n & (n - 1)) === 0;
const AMBER_BYTES = 56278061, RED_BYTES = 328874531;
const DEFAULT_LIMIT = AMBER_BYTES;   // D172's name for the amber line, kept for its callers
/** This builder's DDS size (src/texture/dds.js): the 128-byte header, then 4 bytes a texel over the whole mip chain. */
function ddsBytes(w, h) { let n = 0; for (;;) { n += w * h; if (w === 1 && h === 1) break; w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); } return 128 + 4 * n; }

function checkTexture(img, { role = 'diffuse', compress = false, name = 'texture' } = {}) {
  const out = [], { width: W, height: H } = img;
  if (W > MAX_SIDE || H > MAX_SIDE) out.push({ level: 'refuse', code: 'TEXTURE_TOO_LARGE', message: `${name}: ${W}×${H}; AC takes textures up to ${MAX_SIDE} on a side` });
  if (role === 'normal' && compress) out.push({ level: 'refuse', code: 'COMPRESSED_NORMAL', message: `${name}: AC does not support block-compressed normal maps; it is written uncompressed or not at all` });
  if (!pow2(W) || !pow2(H)) out.push({ level: 'warn', code: 'NOT_POWER_OF_TWO', message: `${name}: ${W}×${H} is not a power of two on each side; its mipmaps average uneven blocks` });
  if (role === 'diffuse' && img.rgba) { for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] !== 255) { out.push({ level: 'warn', code: 'ALPHA_IGNORED', message: `${name}: has transparency, but road slots are drawn opaque; the alpha is ignored` }); break; } }
  return out;
}

/**
 * Texture memory of a set: one row per texture (resolution, format, mips, bytes, the slots that use it), the bytes per
 * slot (a texture two slots share counts in each), the total (each texture once), and its level. `limitBytes` is the
 * amber line under its D172 name.
 */
function budget(textures, { amberBytes, redBytes = RED_BYTES, limitBytes } = {}) {
  const amber = amberBytes !== undefined ? amberBytes : limitBytes !== undefined ? limitBytes : AMBER_BYTES;
  let bytes = 0, largest = null; const perSlot = {};
  const rows = textures.map((t) => {
    const b = t.dds ? t.dds.length : 0; bytes += b;
    if (!largest || t.width * t.height > largest.width * largest.height) largest = { name: t.name, width: t.width, height: t.height };
    for (const s of t.slots || []) perSlot[s] = (perSlot[s] || 0) + b;
    return { name: t.name, width: t.width, height: t.height, format: 'A8R8G8B8', mips: t.mips, bytes: b, slots: t.slots || [] };
  });
  const level = bytes > redBytes ? 'red' : bytes > amber ? 'amber' : 'ok', over = level !== 'ok';
  const mib = (x) => (x / 1048576).toFixed(1);
  return { bytes, level, rows, perSlot, largest, count: textures.length, amberBytes: amber, redBytes, limitBytes: amber, over,
    warnings: over ? [{ level: 'warn', code: 'TEXTURE_BUDGET', message: level === 'red'
      ? `textures take ${mib(bytes)} MiB: more than any of the eleven T-180 tracks measured (${mib(redBytes)} MiB)`
      : `textures take ${mib(bytes)} MiB: more than half the T-180 tracks measured (${mib(amber)} MiB, their median)` }] : [] };
}

module.exports = { checkTexture, budget, ddsBytes, DEFAULT_LIMIT, AMBER_BYTES, RED_BYTES, pow2 };
