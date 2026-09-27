// dds.js: 8-bit RGBA → an UNCOMPRESSED DDS with a full mipmap chain (ARCHITECTURE §5b: "The program converts them to
// DDS for AC (AC strongly prefers DDS, up to 8192²) and builds mipmaps"). Dependency-free.
//
// FORMAT (Microsoft, "DDS_HEADER" and "DDS_PIXELFORMAT" in the Direct3D 9/11 programming guide): the magic "DDS ", a
// 124-byte header, then every mip level's pixels, largest first. Pixels are 32-bit A8R8G8B8, which in memory is B, G,
// R, A per pixel (the masks below say so). Header flags CAPS | HEIGHT | WIDTH | PITCH | PIXELFORMAT | MIPMAPCOUNT;
// caps TEXTURE | MIPMAP | COMPLEX. Uncompressed on purpose: block compression is lossy, and for normal maps AC does not
// support it at all (§5b), so v1 writes every texture losslessly and leaves compression to a later, measured choice.
//
// MIPS: each level halves each side (never below 1) and every texel is the plain average of the 2×2 (or 2×1, 1×2, or,
// on an odd side, 3-wide) block of the level above it that it covers, so no texel of the level above is dropped on a
// side that is not a power of two. Colour is averaged as stored: not in linear light, and not weighted by alpha. A
// stated simplification; it shows as slightly dark mips, and as fringes on textures with soft alpha edges.
'use strict';

const { TextureError } = require('./errors.js');

const MAX_SIDE = 8192;
const DDSD = { CAPS: 0x1, HEIGHT: 0x2, WIDTH: 0x4, PITCH: 0x8, PIXELFORMAT: 0x1000, MIPMAPCOUNT: 0x20000 };
const DDPF = { ALPHAPIXELS: 0x1, RGB: 0x40 };
const CAPS = { COMPLEX: 0x8, TEXTURE: 0x1000, MIPMAP: 0x400000 };

const mipCount = (w, h) => Math.floor(Math.log2(Math.max(w, h))) + 1;

/** The next mip level of an RGBA image: each output texel averages the source texels its footprint covers. */
function halve({ width: W, height: H, rgba }) {
  const w = Math.max(1, W >> 1), h = Math.max(1, H >> 1), out = new Uint8Array(w * h * 4);
  const span = (n, N, i) => { const a = Math.floor((i * N) / n), b = Math.max(a + 1, Math.floor(((i + 1) * N) / n)); return [a, b]; };
  for (let y = 0; y < h; y++) {
    const [y0, y1] = span(h, H, y);
    for (let x = 0; x < w; x++) {
      const [x0, x1] = span(w, W, x); const s = [0, 0, 0, 0]; let n = 0;
      for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) { const p = (j * W + i) * 4; s[0] += rgba[p]; s[1] += rgba[p + 1]; s[2] += rgba[p + 2]; s[3] += rgba[p + 3]; n++; }
      const o = (y * w + x) * 4; for (let c = 0; c < 4; c++) out[o + c] = Math.round(s[c] / n);
    }
  }
  return { width: w, height: h, rgba: out };
}

/** All mip levels, largest first. */
function mipChain(img) { const out = [img]; while (out[out.length - 1].width > 1 || out[out.length - 1].height > 1) out.push(halve(out[out.length - 1])); return out; }

function encodeDds(img) {
  const { width: W, height: H, rgba } = img;
  if (!(Number.isInteger(W) && Number.isInteger(H) && W > 0 && H > 0)) throw new TextureError('BAD_IMAGE', `DDS: ${W}×${H} is not an image size`);
  if (rgba.length !== W * H * 4) throw new TextureError('BAD_IMAGE', `DDS: ${rgba.length} bytes for ${W}×${H} RGBA`);
  if (W > MAX_SIDE || H > MAX_SIDE) throw new TextureError('TEXTURE_TOO_LARGE', `${W}×${H}: AC takes textures up to ${MAX_SIDE} on a side`);
  const levels = mipChain(img), size = 128 + levels.reduce((a, l) => a + l.width * l.height * 4, 0);
  const out = new Uint8Array(size), dv = new DataView(out.buffer);
  out.set([0x44, 0x44, 0x53, 0x20], 0);                                 // "DDS "
  const h32 = (i, v) => dv.setUint32(4 + i * 4, v >>> 0, true);         // header dword i
  h32(0, 124); h32(1, DDSD.CAPS | DDSD.HEIGHT | DDSD.WIDTH | DDSD.PITCH | DDSD.PIXELFORMAT | DDSD.MIPMAPCOUNT);
  h32(2, H); h32(3, W); h32(4, W * 4); h32(5, 0); h32(6, levels.length);
  // dwords 7..17 reserved; the pixel format is dwords 18..25
  h32(18, 32); h32(19, DDPF.RGB | DDPF.ALPHAPIXELS); h32(20, 0); h32(21, 32);
  h32(22, 0x00ff0000); h32(23, 0x0000ff00); h32(24, 0x000000ff); h32(25, 0xff000000);
  h32(26, CAPS.TEXTURE | CAPS.MIPMAP | CAPS.COMPLEX);                    // caps2..4 and the last reserved dword stay 0
  let o = 128;
  for (const l of levels) {
    const p = l.rgba;
    for (let i = 0; i < p.length; i += 4) { out[o++] = p[i + 2]; out[o++] = p[i + 1]; out[o++] = p[i]; out[o++] = p[i + 3]; }
  }
  return out;
}

/** Read a DDS header (this writer's, or any uncompressed/FourCC one): the fields a check or a loader needs. */
function readDdsHeader(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 128 || b[0] !== 0x44 || b[1] !== 0x44 || b[2] !== 0x53 || b[3] !== 0x20) throw new TextureError('BAD_IMAGE', 'not a DDS (no "DDS " magic)');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), h = (i) => dv.getUint32(4 + i * 4, true);
  if (h(0) !== 124) throw new TextureError('BAD_IMAGE', `DDS: header size ${h(0)}, 124 expected`);
  const fourCC = h(20) ? String.fromCharCode(h(20) & 255, (h(20) >> 8) & 255, (h(20) >> 16) & 255, h(20) >>> 24) : null;
  return { flags: h(1), height: h(2), width: h(3), pitch: h(4), mipCount: h(6), pfFlags: h(19), fourCC, bitCount: h(21),
    masks: [h(22), h(23), h(24), h(25)], caps: h(26) };
}

/** Level `i` of a DDS this module wrote, back to RGBA (for tests and the preview). */
function ddsLevel(bytes, i = 0) {
  const hd = readDdsHeader(bytes); if (hd.fourCC || hd.bitCount !== 32) throw new TextureError('TEXTURE_UNSUPPORTED', 'DDS: only 32-bit uncompressed levels are read back');
  let o = 128, w = hd.width, h = hd.height;
  for (let k = 0; k < i; k++) { o += w * h * 4; w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); }
  if (o + w * h * 4 > bytes.length) throw new TextureError('BAD_IMAGE', `DDS: level ${i} runs past the end`);
  const rgba = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h * 4; p += 4) { rgba[p] = bytes[o + p + 2]; rgba[p + 1] = bytes[o + p + 1]; rgba[p + 2] = bytes[o + p]; rgba[p + 3] = bytes[o + p + 3]; }
  return { width: w, height: h, rgba };
}

module.exports = { MAX_SIDE, DDSD, DDPF, CAPS, mipCount, halve, mipChain, encodeDds, readDdsHeader, ddsLevel };
