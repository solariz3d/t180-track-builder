// deflate.js: raw DEFLATE (RFC 1951) COMPRESSION, dependency-free, beside its inverse (./inflate.js). LZ77 over a 32 KiB
// window with hash chains (3-byte hash, chain walked up to 128 deep, matches 3..258), coded as ONE block of the fixed
// Huffman codes (BTYPE 01). Fixed codes cost a little against zlib's dynamic ones on text, and buy a short, exact
// encoder. It exists because the app's webview has no compressor (app/export/node-shim.js writes stored blocks only), and
// a shareable track code must be the SAME code wherever it is made: node and the app run this same function.
// Deterministic: the same bytes in give the same bytes out. Any inflate reads the output (tested against node's zlib).
'use strict';

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const WINDOW = 32768, MIN = 3, MAX = 258, CHAIN = 128, HBITS = 15;

function deflateRaw(input) {
  const src = input instanceof Uint8Array ? input : new Uint8Array(input), n = src.length;
  let out = new Uint8Array(Math.max(64, n + (n >> 3) + 16)), o = 0, bitbuf = 0, bitcnt = 0;
  const grow = () => { const b = new Uint8Array(out.length * 2); b.set(out.subarray(0, o)); out = b; };
  const bits = (v, k) => { bitbuf |= v << bitcnt; bitcnt += k; while (bitcnt >= 8) { if (o >= out.length) grow(); out[o++] = bitbuf & 255; bitbuf >>>= 8; bitcnt -= 8; } };
  // Huffman codes are sent MSB first: reverse them into the LSB-first bit stream
  const huff = (code, len) => { let r = 0; for (let i = 0; i < len; i++) r = (r << 1) | ((code >> i) & 1); bits(r, len); };
  const lit = (c) => (c < 144 ? huff(0x30 + c, 8) : c < 256 ? huff(0x190 + c - 144, 9) : c < 280 ? huff(c - 256, 7) : huff(0xc0 + c - 280, 8));
  const find = (tab, x) => { let i = tab.length - 1; while (tab[i] > x) i--; return i; };
  bits(1, 1); bits(1, 2);                                        // BFINAL, BTYPE = 01 (fixed Huffman)
  const head = new Int32Array(1 << HBITS).fill(-1), prev = new Int32Array(WINDOW);
  const hash = (i) => (((src[i] << 10) ^ (src[i + 1] << 5) ^ src[i + 2]) & ((1 << HBITS) - 1));
  const insert = (i) => { if (i + 2 < n) { const h = hash(i); prev[i & (WINDOW - 1)] = head[h]; head[h] = i; } };
  let i = 0;
  while (i < n) {
    let best = 0, dist = 0;
    if (i + 2 < n) {
      let j = head[hash(i)], chain = CHAIN;
      const lim = Math.min(MAX, n - i);
      while (j >= 0 && i - j <= WINDOW && chain-- > 0) {
        let k = 0; while (k < lim && src[j + k] === src[i + k]) k++;
        if (k > best) { best = k; dist = i - j; if (k === lim) break; }
        j = prev[j & (WINDOW - 1)];
      }
    }
    if (best >= MIN) {
      const li = find(LBASE, best); lit(257 + li); bits(best - LBASE[li], LEXT[li]);
      const di = find(DBASE, dist); huff(di, 5); bits(dist - DBASE[di], DEXT[di]);
      for (let k = 0; k < best; k++) insert(i + k);
      i += best;
    } else { lit(src[i]); insert(i); i++; }
  }
  lit(256);                                                      // end of block
  if (bitcnt > 0) { if (o >= out.length) grow(); out[o++] = bitbuf & 255; }
  return out.slice(0, o);
}

module.exports = { deflateRaw };
