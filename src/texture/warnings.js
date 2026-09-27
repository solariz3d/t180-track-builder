// warnings.js: what AC can't do, said before export (ARCHITECTURE §5b: "Warns about what AC can't do, e.g. compressed
// normal maps aren't supported"; "Budget: a live count of texture memory and resolution per track").
//
//   checkTexture({ width, height }, { role, compress }) -> [{ level: 'refuse' | 'warn', code, message }]
//   budget(textures, { limitBytes }) -> { bytes, largest: { name, width, height }, count, over, warnings }
//
// REFUSED: larger than 8192 on a side (AC's limit, §5b); a normal map with block compression asked for.
// WARNED: a side that is not a power of two (mips of such a texture average uneven footprints, and older GPUs and
// tools handle them worse); a texture whose alpha is not all 255 on a slot drawn opaque (the alpha is ignored).
// The budget's default limit, 256 MiB of texture memory, is INFERRED (not measured): a round figure well above a
// typical AC track's textures, meant as a "this is getting heavy" line, not a hard cap.
'use strict';
const { MAX_SIDE } = require('./dds.js');

const pow2 = (n) => n > 0 && (n & (n - 1)) === 0;
const DEFAULT_LIMIT = 256 * 1024 * 1024;

function checkTexture(img, { role = 'diffuse', compress = false, name = 'texture' } = {}) {
  const out = [], { width: W, height: H } = img;
  if (W > MAX_SIDE || H > MAX_SIDE) out.push({ level: 'refuse', code: 'TEXTURE_TOO_LARGE', message: `${name}: ${W}×${H}; AC takes textures up to ${MAX_SIDE} on a side` });
  if (role === 'normal' && compress) out.push({ level: 'refuse', code: 'COMPRESSED_NORMAL', message: `${name}: AC does not support block-compressed normal maps; it is written uncompressed or not at all` });
  if (!pow2(W) || !pow2(H)) out.push({ level: 'warn', code: 'NOT_POWER_OF_TWO', message: `${name}: ${W}×${H} is not a power of two on each side; its mipmaps average uneven blocks` });
  if (role === 'diffuse' && img.rgba) { for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] !== 255) { out.push({ level: 'warn', code: 'ALPHA_IGNORED', message: `${name}: has transparency, but road slots are drawn opaque; the alpha is ignored` }); break; } }
  return out;
}

/** Texture memory of a set: the DDS bytes (every mip level), the largest texture, and whether it is over the limit. */
function budget(textures, { limitBytes = DEFAULT_LIMIT } = {}) {
  let bytes = 0, largest = null;
  for (const t of textures) {
    bytes += t.dds ? t.dds.length : 0;
    if (!largest || t.width * t.height > largest.width * largest.height) largest = { name: t.name, width: t.width, height: t.height };
  }
  const over = bytes > limitBytes;
  return { bytes, largest, count: textures.length, limitBytes, over,
    warnings: over ? [{ level: 'warn', code: 'TEXTURE_BUDGET', message: `textures take ${(bytes / 1048576).toFixed(1)} MiB, over the ${(limitBytes / 1048576).toFixed(0)} MiB budget` }] : [] };
}

module.exports = { checkTexture, budget, DEFAULT_LIMIT, pow2 };
