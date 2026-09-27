// texture-image.test.js: node --test test/texture-image.test.js. Bring your own PNG/JPG → DDS with mipmaps
// (ARCHITECTURE §5b). Every image is generated here; nothing is committed. node's zlib is used only to MAKE test files
// (the decoder's own inflate is the thing under test). Bounds stated before the first run: PNG decodes exactly;
// baseline JPEG at quality 100 within 2 levels per channel (a float IDCT against the float DCT here), 4:2:0 on an image
// whose colour is constant over each 2×2 block within 2 levels too; quality 90 within 8.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const T = require('../src/texture/index.js');
const { inflateZlib } = require('../src/texture/inflate.js');
const { encodeJpeg } = require('./texture_jpeg_encoder.js');

function image(W, H, f) { const rgba = new Uint8Array(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgba.set(f(x, y), (y * W + x) * 4); return { width: W, height: H, rgba }; }
const pattern = (W, H) => image(W, H, (x, y) => [(x * 29 + y * 7) & 255, (x * 3 + y * 41) & 255, (x ^ y) * 9 & 255, 128 + ((x + y) & 127)]);
const maxDiff = (a, b, ch = 3) => { let m = 0; for (let i = 0; i < a.length; i += 4) for (let c = 0; c < ch; c++) m = Math.max(m, Math.abs(a[i + c] - b[i + c])); return m; };

/** A PNG whose rows use filter `f` (0–4) or a rotating one, built here so the decoder's unfiltering is tested. */
function pngFiltered({ width: W, height: H, rgba }, f) {
  const stride = W * 4, raw = new Uint8Array((stride + 1) * H);
  for (let y = 0; y < H; y++) {
    const ft = f === 'all' ? y % 5 : f; raw[y * (stride + 1)] = ft;
    for (let x = 0; x < stride; x++) {
      const cur = rgba[y * stride + x], a = x >= 4 ? rgba[y * stride + x - 4] : 0, b = y ? rgba[(y - 1) * stride + x] : 0, c = y && x >= 4 ? rgba[(y - 1) * stride + x - 4] : 0;
      let pr = 0; if (ft === 1) pr = a; else if (ft === 2) pr = b; else if (ft === 3) pr = (a + b) >> 1;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      raw[y * (stride + 1) + 1 + x] = (cur - pr) & 255;
    }
  }
  const png = T.png.encodePng({ width: W, height: H, rgba }, zlib.deflateSync);   // for its chunks; the IDAT is replaced
  return withIdat(png, zlib.deflateSync(raw));
}
function withIdat(png, idat) {
  const parts = []; let i = 8; parts.push(png.subarray(0, 8));
  while (i < png.length) {
    const len = new DataView(png.buffer, png.byteOffset).getUint32(i), type = String.fromCharCode(...png.subarray(i + 4, i + 8));
    if (type === 'IDAT') { const c = new Uint8Array(12 + idat.length), dv = new DataView(c.buffer); dv.setUint32(0, idat.length); c.set([73, 68, 65, 84], 4); c.set(idat, 8); dv.setUint32(8 + idat.length, T.png.crc32(c, 4, 8 + idat.length)); parts.push(c); }
    else parts.push(png.subarray(i, i + 12 + len));
    i += 12 + len;
  }
  return Uint8Array.from(Buffer.concat(parts.map((p) => Buffer.from(p))));
}

// ── inflate ────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the decoder\'s own inflate reads what zlib writes, stored, fixed and dynamic, and refuses a bad Adler-32', () => {
  const d = Uint8Array.from({ length: 70000 }, (_, i) => (i % 700 < 300 ? i & 3 : (i * 2654435761) >>> 24));
  for (const level of [0, 1, 9]) assert.deepEqual(inflateZlib(zlib.deflateSync(d, { level })), d);
  assert.deepEqual(Buffer.from(inflateZlib(zlib.deflateSync(Buffer.from('abcabcabc'), { strategy: zlib.constants.Z_FIXED }))).toString(), 'abcabcabc');
  const z = Uint8Array.from(zlib.deflateSync(d)); z[z.length - 1] ^= 1;
  assert.throws(() => inflateZlib(z), (e) => e.code === 'BAD_DEFLATE' && /Adler-32/.test(e.message));
});

// ── PNG ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('a PNG round-trips exactly through every filter (0–4, and all five in one image)', () => {
  const img = pattern(23, 11);
  for (const f of [0, 1, 2, 3, 4, 'all']) assert.deepEqual(T.decodeImage(pngFiltered(img, f)).rgba, img.rgba, `filter ${f}`);
});
test('PNG colour types: grey, RGB, grey+alpha, 16-bit, all come back as the RGBA they stand for', () => {
  const img = pattern(9, 5), g = (i) => img.rgba[i * 4];
  const exp = (c) => image(9, 5, (x, y) => { const i = y * 9 + x, p = img.rgba.subarray(i * 4, i * 4 + 4);
    return c === 2 ? [p[0], p[1], p[2], 255] : c === 0 ? [g(i), g(i), g(i), 255] : c === 4 ? [g(i), g(i), g(i), p[3]] : [...p]; }).rgba;
  for (const [c, d] of [[2, 8], [0, 8], [4, 8], [6, 16], [0, 16]]) assert.deepEqual(T.decodeImage(T.png.encodePng(img, zlib.deflateSync, { color: c, depth: d })).rgba, exp(c), `type ${c}/${d}`);
});
test('a 2-bit palette PNG with tRNS decodes through its palette', () => {
  // 4×1, indices 0 1 2 3 packed in one byte, palette red/green/blue/white, index 1 half-transparent
  const ih = Buffer.alloc(13); ih.writeUInt32BE(4, 0); ih.writeUInt32BE(1, 4); ih[8] = 2; ih[9] = 3;
  const chunk = (t, d) => { const c = Buffer.alloc(12 + d.length); c.writeUInt32BE(d.length); c.write(t, 4, 'latin1'); Buffer.from(d).copy(c, 8); c.writeUInt32BE(T.png.crc32(c, 4, 8 + d.length), 8 + d.length); return c; };
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('PLTE', [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]),
    chunk('tRNS', [255, 128]), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 0b00011011]))), chunk('IEND', [])]);
  assert.deepEqual([...T.decodeImage(png).rgba], [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 255, 255, 255, 255]);
});
test('a PNG with a bad CRC, a truncated file, or interlacing is refused with a named reason', () => {
  const png = T.png.encodePng(pattern(4, 4), zlib.deflateSync);
  const crc = png.slice(); crc[20] ^= 1;
  assert.throws(() => T.decodeImage(crc), (e) => e.code === 'BAD_IMAGE' && /CRC/.test(e.message));
  assert.throws(() => T.decodeImage(png.subarray(0, png.length - 20)), (e) => e.code === 'BAD_IMAGE');
  const il = png.slice(); il[28] = 1; new DataView(il.buffer).setUint32(29, T.png.crc32(il, 12, 29));
  assert.throws(() => T.decodeImage(il), (e) => e.code === 'TEXTURE_UNSUPPORTED' && /interlac/.test(e.message));
});

// ── JPEG ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const smooth = image(37, 21, (x, y) => [x * 6, y * 11, Math.round(128 + 60 * Math.sin(x / 5)), 255]);
const blocky = image(36, 20, (x, y) => { const X = x >> 1, Y = y >> 1; return [Math.min(255, 40 + X * 9 + (x & 1) * 2), 90 + Y * 7, 200 - X * 4, 255]; });
test('a baseline JPEG decodes within 2 levels at quality 100 (4:4:4, and grey)', () => {
  assert.ok(maxDiff(T.decodeImage(encodeJpeg(smooth, { quality: 100 })).rgba, smooth.rgba) <= 2);
  const grey = smooth.rgba.map((v, i) => (i % 4 === 3 ? 255 : 0)); for (let i = 0; i < grey.length; i += 4) grey[i] = grey[i + 1] = grey[i + 2] = Math.round(0.299 * smooth.rgba[i] + 0.587 * smooth.rgba[i + 1] + 0.114 * smooth.rgba[i + 2]);
  assert.ok(maxDiff(T.decodeImage(encodeJpeg(smooth, { quality: 100, grey: true })).rgba, grey) <= 2);
});
test('4:2:0 chroma, restart markers and 16-bit quantisation tables decode', () => {
  const d = T.decodeImage(encodeJpeg(blocky, { quality: 100, sub: 2, restart: 3, q16: true }));
  assert.deepEqual([d.width, d.height], [36, 20]);
  assert.ok(maxDiff(d.rgba, blocky.rgba) <= 2, `max ${maxDiff(d.rgba, blocky.rgba)}`);
});
test('quality 90 stays within 8 levels', () => {
  assert.ok(maxDiff(T.decodeImage(encodeJpeg(smooth, { quality: 90 })).rgba, smooth.rgba) <= 8);
});
test('progressive, lossless and arithmetic JPEGs are refused as unsupported, by name', () => {
  for (const [m, re] of [[0xc2, /progressive/], [0xc3, /lossless/], [0xc9, /arithmetic/]])
    assert.throws(() => T.decodeImage(encodeJpeg(smooth, { sofMarker: m })), (e) => e.code === 'TEXTURE_UNSUPPORTED' && re.test(e.message));
});
test('a JPEG cut off inside its scan is refused as BAD_IMAGE', () => {
  const j = encodeJpeg(smooth, { quality: 100 });
  assert.throws(() => T.decodeImage(j.subarray(0, j.length - 200)), (e) => e.code === 'BAD_IMAGE');
});
test('a file that is neither PNG nor JPEG is refused as NOT_AN_IMAGE, and a DDS is told to bring its source', () => {
  assert.throws(() => T.decodeImage(Buffer.from('GIF89a......')), (e) => e.code === 'NOT_AN_IMAGE');
  assert.throws(() => T.decodeImage(T.dds.encodeDds(pattern(4, 4))), (e) => e.code === 'NOT_AN_IMAGE' && /already a DDS/.test(e.message));
});

// ── DDS ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('a PNG becomes a DDS with the right header and a full mip chain, and level 0 is the image exactly', () => {
  const img = pattern(64, 16), dds = T.dds.encodeDds(T.decodeImage(T.png.encodePng(img, zlib.deflateSync)));
  const h = T.dds.readDdsHeader(dds);
  assert.deepEqual([h.width, h.height, h.pitch, h.mipCount, h.bitCount, h.fourCC], [64, 16, 256, 7, 32, null]);
  assert.equal(h.flags, 0x1 | 0x2 | 0x4 | 0x8 | 0x1000 | 0x20000);
  assert.equal(h.caps, 0x1000 | 0x400000 | 0x8);
  assert.deepEqual(h.masks, [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000]);
  assert.equal(dds.length, 128 + 4 * (64 * 16 + 32 * 8 + 16 * 4 + 8 * 2 + 4 * 1 + 2 * 1 + 1 * 1));
  assert.deepEqual(T.dds.ddsLevel(dds, 0).rgba, img.rgba);
  assert.deepEqual([6].map((i) => [T.dds.ddsLevel(dds, i).width, T.dds.ddsLevel(dds, i).height]), [[1, 1]]);
});
test('a mip texel is the average of the block it covers; an odd side drops no texel', () => {
  const img = image(3, 1, (x) => [x * 30, 0, 0, 255]);            // 0, 30, 60 → one texel covering all three
  assert.deepEqual([...T.dds.halve(img).rgba], [30, 0, 0, 255]);
  const two = image(2, 2, (x, y) => [x * 100 + y * 50, 0, 0, 255]);  // 0, 100, 50, 150 → 75
  assert.equal(T.dds.halve(two).rgba[0], 75);
});
test('larger than 8192 on a side is refused as TEXTURE_TOO_LARGE', () => {
  assert.throws(() => T.dds.encodeDds({ width: 8193, height: 1, rgba: new Uint8Array(8193 * 4) }), (e) => e.code === 'TEXTURE_TOO_LARGE');
});

// ── warnings (§5b: "Warns about what AC can't do") ─────────────────────────────────────────────────────────────────
test('a compressed normal map is refused; a non-power-of-two side and ignored alpha are warned', () => {
  const codes = (img, o) => T.checkTexture(img, o).map((w) => `${w.level}:${w.code}`);
  assert.deepEqual(codes(pattern(64, 64), { role: 'normal', compress: true }), ['refuse:COMPRESSED_NORMAL']);
  assert.deepEqual(codes(pattern(64, 64), { role: 'normal' }), []);
  assert.deepEqual(codes(image(48, 64, () => [1, 2, 3, 255])), ['warn:NOT_POWER_OF_TWO']);
  assert.deepEqual(codes(pattern(64, 64)), ['warn:ALPHA_IGNORED']);
  assert.deepEqual(codes({ width: 9000, height: 16 }), ['refuse:TEXTURE_TOO_LARGE', 'warn:NOT_POWER_OF_TWO']);
});
test('the budget counts every mip\'s bytes and warns over its limit', () => {
  const t = [{ name: 'a', width: 64, height: 64, dds: new Uint8Array(1000) }, { name: 'b', width: 128, height: 64, dds: new Uint8Array(3000) }];
  const b = T.budget(t, { limitBytes: 3500 });
  assert.deepEqual([b.bytes, b.largest.name, b.count, b.over, b.warnings[0].code], [4000, 'b', 2, true, 'TEXTURE_BUDGET']);
  assert.equal(T.budget(t).over, false);
});

test('inflate refuses a stored block whose length check does not match', () => {
  const z = Uint8Array.from(zlib.deflateSync(Buffer.from('stored data'), { level: 0 })); z[5] ^= 0xff;   // NLEN's low byte
  assert.throws(() => inflateZlib(z), (e) => e.code === 'BAD_DEFLATE' && /length check/.test(e.message));
});
test('a 16-bit PNG keeps each sample\'s HIGH byte', () => {
  const ih = Buffer.alloc(13); ih.writeUInt32BE(2, 0); ih.writeUInt32BE(1, 4); ih[8] = 16; ih[9] = 0;
  const chunk = (t, d) => { const c = Buffer.alloc(12 + d.length); c.writeUInt32BE(d.length); c.write(t, 4, 'latin1'); Buffer.from(d).copy(c, 8); c.writeUInt32BE(T.png.crc32(c, 4, 8 + d.length), 8 + d.length); return c; };
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 0x12, 0x34, 0xab, 0xcd]))), chunk('IEND', [])]);
  assert.deepEqual([...T.decodeImage(png).rgba], [0x12, 0x12, 0x12, 255, 0xab, 0xab, 0xab, 255]);
});
