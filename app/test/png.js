// png.js: a PNG decoder for the page tests that read pixels back from a headless Chrome screenshot (texture-page.test.js). 8-bit RGB or RGBA,
// not interlaced, the five row filters; anything else is refused by name.
//   decode(buffer) -> { w, h, px(x, y) -> [r, g, b] }
'use strict';
const zlib = require('zlib');

function decode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('png: not a PNG');
  let w = 0, h = 0, type = 0; const idat = [];
  for (let i = 8; i < buf.length;) {
    const len = buf.readUInt32BE(i), kind = buf.toString('ascii', i + 4, i + 8), data = buf.subarray(i + 8, i + 8 + len);
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9];
      if (data[8] !== 8 || (type !== 2 && type !== 6) || data[12] !== 0) throw new Error(`png: only 8-bit RGB or RGBA, not interlaced (depth ${data[8]}, type ${type}, interlace ${data[12]})`);
    } else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    i += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[o + x - bpp] : 0, b = y ? out[o - stride + x] : 0, c = x >= bpp && y ? out[o - stride + x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (f !== 0) throw new Error(`png: row filter ${f}`);
      out[o + x] = v & 255;
    }
  }
  return { w, h, px: (x, y) => { const i = y * stride + x * bpp; return [out[i], out[i + 1], out[i + 2]]; } };
}

module.exports = { decode };
