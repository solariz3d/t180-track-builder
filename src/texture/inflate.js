// inflate.js: zlib (RFC 1950) and raw DEFLATE (RFC 1951) decompression, dependency-free, so a PNG decodes the same way
// in node and in the app's webview (whose zlib shim only writes: app/export/node-shim.js). Stored, fixed-Huffman and
// dynamic-Huffman blocks. Every malformed stream is refused with a named reason, never read past its end.
'use strict';

class InflateError extends Error { constructor(msg) { super(`inflate: ${msg}`); this.code = 'BAD_DEFLATE'; } }

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** A canonical Huffman decoder from code lengths: counts per length and symbols in code order (as RFC 1951 3.2.2). */
function huffman(lengths) {
  const count = new Uint16Array(16), symbol = new Uint16Array(lengths.length);
  for (const l of lengths) count[l]++;
  count[0] = 0;
  let left = 1;
  for (let l = 1; l < 16; l++) { left = left * 2 - count[l]; if (left < 0) throw new InflateError('over-subscribed Huffman code'); }
  const offs = new Uint16Array(16);
  for (let l = 1; l < 15; l++) offs[l + 1] = offs[l] + count[l];
  lengths.forEach((l, s) => { if (l) symbol[offs[l]++] = s; });
  return { count, symbol };
}

function inflateRaw(src, start = 0, sizeHint = 0) {
  let pos = start, bitbuf = 0, bitcnt = 0;
  let out = new Uint8Array(Math.max(1024, sizeHint)), n = 0;
  const need = (k) => { while (n + k > out.length) { const o = new Uint8Array(out.length * 2); o.set(out.subarray(0, n)); out = o; } };
  const bits = (k) => {
    while (bitcnt < k) { if (pos >= src.length) throw new InflateError('the stream ends early'); bitbuf |= src[pos++] << bitcnt; bitcnt += 8; }
    const v = bitbuf & ((1 << k) - 1); bitbuf >>>= k; bitcnt -= k; return v;
  };
  const decode = (h) => {
    let code = 0, first = 0, index = 0;
    for (let l = 1; l < 16; l++) {
      code |= bits(1); const c = h.count[l];
      if (code - c < first) return h.symbol[index + (code - first)];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    throw new InflateError('a code that is not in the Huffman table');
  };
  const codes = (lit, dist) => {
    for (;;) {
      const sym = decode(lit);
      if (sym < 256) { need(1); out[n++] = sym; continue; }
      if (sym === 256) return;
      const li = sym - 257; if (li >= 29) throw new InflateError(`length symbol ${sym}`);
      const len = LBASE[li] + bits(LEXT[li]);
      const di = decode(dist); if (di >= 30) throw new InflateError(`distance symbol ${di}`);
      const d = DBASE[di] + bits(DEXT[di]);
      if (d > n) throw new InflateError(`a distance of ${d} reaches before the start`);
      need(len); for (let i = 0; i < len; i++, n++) out[n] = out[n - d];
    }
  };
  let FIXED = null;
  for (let last = 0; !last;) {
    last = bits(1); const type = bits(2);
    if (type === 0) {
      bitbuf = 0; bitcnt = 0;
      if (pos + 4 > src.length) throw new InflateError('the stream ends early');
      const len = src[pos] | (src[pos + 1] << 8), nlen = src[pos + 2] | (src[pos + 3] << 8); pos += 4;
      if (len !== (~nlen & 0xffff)) throw new InflateError('a stored block\'s length check fails');
      if (pos + len > src.length) throw new InflateError('the stream ends early');
      need(len); out.set(src.subarray(pos, pos + len), n); n += len; pos += len;
    } else if (type === 1) {
      if (!FIXED) { const l = new Array(288); l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288); FIXED = [huffman(l), huffman(new Array(30).fill(5))]; }
      codes(FIXED[0], FIXED[1]);
    } else if (type === 2) {
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
      if (nlen > 286 || ndist > 30) throw new InflateError('too many length or distance codes');
      const cl = new Array(19).fill(0); for (let i = 0; i < ncode; i++) cl[CLORDER[i]] = bits(3);
      const ch = huffman(cl), lens = [];
      while (lens.length < nlen + ndist) {
        const sym = decode(ch);
        if (sym < 16) lens.push(sym);
        else if (sym === 16) { if (!lens.length) throw new InflateError('a repeat with nothing to repeat'); const r = 3 + bits(2), v = lens[lens.length - 1]; for (let i = 0; i < r; i++) lens.push(v); }
        else { const r = sym === 17 ? 3 + bits(3) : 11 + bits(7); for (let i = 0; i < r; i++) lens.push(0); }
      }
      if (lens.length > nlen + ndist) throw new InflateError('code lengths run past their count');
      if (!lens[256]) throw new InflateError('no end-of-block code');
      codes(huffman(lens.slice(0, nlen)), huffman(lens.slice(nlen)));
    } else throw new InflateError('block type 3 is reserved');
  }
  return { data: out.slice(0, n), end: pos };
}

/** Decompress a zlib stream: header, DEFLATE data, Adler-32 of the output (checked). */
function inflateZlib(src, sizeHint = 0) {
  if (src.length < 6) throw new InflateError('too short for a zlib stream');
  const cmf = src[0], flg = src[1];
  if ((cmf & 15) !== 8) throw new InflateError(`compression method ${cmf & 15} is not DEFLATE`);
  if (((cmf << 8) | flg) % 31) throw new InflateError('the zlib header check fails');
  if (flg & 32) throw new InflateError('a preset dictionary is not supported');
  const { data, end } = inflateRaw(src, 2, sizeHint);
  if (end + 4 > src.length) throw new InflateError('the Adler-32 check is missing');
  let a = 1, b = 0; for (let i = 0; i < data.length; i++) { a = (a + data[i]) % 65521; b = (b + a) % 65521; }
  const want = ((src[end] << 24) | (src[end + 1] << 16) | (src[end + 2] << 8) | src[end + 3]) >>> 0;
  if ((((b << 16) | a) >>> 0) !== want) throw new InflateError('the Adler-32 check fails');
  return data;
}

module.exports = { inflateRaw, inflateZlib, InflateError };
