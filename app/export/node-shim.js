// node-shim.js: the few pieces of node that the exporter (src/export/*, tools/kn5.cjs) uses, for the webview, where node
// is not. With them, src/export/fromwords.js exportTrack() runs UNCHANGED in the app, against an in-memory disk; the
// app then hands the files it wrote to the native side, which puts them in the folder the user picked.
//
//   const shim = createShim();   loadCjs('src/export/fromwords.js', get, { builtins: shim.builtins, globals: { Buffer: shim.Buffer } })
//   exportTrack(doc, { outDir: '/export' });   shim.files('/export')  ->  [{ path: 't180b_x/t180b_x.kn5', bytes }, …]
//
// WHAT IS HERE, and only this (measured with grep over src/export and tools/kn5.cjs on 2026-09-27):
// - Buffer: alloc, from (array, string in utf8 or latin1, another buffer), concat, isBuffer; and on an instance
//   write{Float,Int32,UInt16}LE, writeUInt32BE, read{Float,Int32,UInt16,UInt32}LE, toString(utf8 | latin1 | hex, start,
//   end), copy, equals, plus the Uint8Array methods (subarray and slice give back a Buffer).
// - fs, IN MEMORY: existsSync, mkdirSync (recursive), mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync.
//   Nothing touches a real disk.
// - os.tmpdir() -> '/tmp' (in memory) · path: join, dirname, basename, resolve, relative (POSIX, '/').
// - crypto.createHash('sha256') · zlib.deflateSync as a valid zlib stream of STORED blocks. That is correct, only
//   uncompressed: the exported PNGs are larger than node's, and every other file is byte-identical (tested).
// Anything else a module asks for is refused by the loader, by name.
'use strict';

const enc = new TextEncoder(), dec = new TextDecoder('utf-8');

class Buffer extends Uint8Array {
  static alloc(n) { return new Buffer(n); }
  static isBuffer(x) { return x instanceof Buffer; }
  static from(x, encoding) {
    if (typeof x === 'string') {
      if (!encoding || encoding === 'utf8' || encoding === 'utf-8') { const u = enc.encode(x), b = new Buffer(u.length); b.set(u); return b; }
      if (encoding === 'latin1' || encoding === 'binary') { const b = new Buffer(x.length); for (let i = 0; i < x.length; i++) b[i] = x.charCodeAt(i) & 0xff; return b; }
      throw new Error(`shim Buffer.from: encoding ${encoding} is not supported`);
    }
    if (x instanceof ArrayBuffer) return new Buffer(x.slice(0));
    const b = new Buffer(x.length); b.set(x); return b;
  }
  static concat(list, total) {
    const n = total === undefined ? list.reduce((a, b) => a + b.length, 0) : total, out = new Buffer(n);
    let o = 0; for (const b of list) { out.set(b.subarray(0, Math.min(b.length, n - o)), o); o += b.length; if (o >= n) break; }
    return out;
  }
  get _dv() { return new DataView(this.buffer, this.byteOffset, this.byteLength); }
  _chk(o, n) { if (!(o >= 0 && o + n <= this.length)) throw new RangeError(`offset ${o} is out of range for ${n} bytes in a buffer of ${this.length}`); }
  writeFloatLE(v, o = 0) { this._chk(o, 4); this._dv.setFloat32(o, v, true); return o + 4; }
  writeInt32LE(v, o = 0) { this._chk(o, 4); this._dv.setInt32(o, v, true); return o + 4; }
  writeUInt32LE(v, o = 0) { this._chk(o, 4); this._dv.setUint32(o, v, true); return o + 4; }
  writeUInt16LE(v, o = 0) { this._chk(o, 2); this._dv.setUint16(o, v, true); return o + 2; }
  writeUInt32BE(v, o = 0) { this._chk(o, 4); this._dv.setUint32(o, v, false); return o + 4; }
  readFloatLE(o = 0) { this._chk(o, 4); return this._dv.getFloat32(o, true); }
  readInt32LE(o = 0) { this._chk(o, 4); return this._dv.getInt32(o, true); }
  readUInt16LE(o = 0) { this._chk(o, 2); return this._dv.getUint16(o, true); }
  readUInt32LE(o = 0) { this._chk(o, 4); return this._dv.getUint32(o, true); }
  toString(encoding = 'utf8', start = 0, end = this.length) {
    const s = this.subarray(Math.max(0, start), Math.min(this.length, end));
    if (encoding === 'utf8' || encoding === 'utf-8') return dec.decode(s);
    if (encoding === 'latin1' || encoding === 'binary') { let r = ''; for (let i = 0; i < s.length; i++) r += String.fromCharCode(s[i]); return r; }
    if (encoding === 'hex') { let r = ''; for (let i = 0; i < s.length; i++) r += s[i].toString(16).padStart(2, '0'); return r; }
    throw new Error(`shim Buffer.toString: encoding ${encoding} is not supported`);
  }
  copy(target, targetStart = 0, sourceStart = 0, sourceEnd = this.length) {
    const part = this.subarray(sourceStart, sourceEnd); target.set(part, targetStart); return part.length;
  }
  equals(other) { if (other.length !== this.length) return false; for (let i = 0; i < this.length; i++) if (this[i] !== other[i]) return false; return true; }
}

// ---- sha256 (FIPS 180-4), for crypto.createHash('sha256')
const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
function sha256(bytes) {
  const n = bytes.length, total = Math.ceil((n + 9) / 64) * 64, m = new Uint8Array(total);
  m.set(bytes); m[n] = 0x80;
  const bits = n * 8, dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor(bits / 2 ** 32)); dv.setUint32(total - 4, bits >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), W = new Uint32Array(64);
  const r = (x, k) => (x >>> k) | (x << (32 - k));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + 4 * i);
    for (let i = 16; i < 64; i++) { const s0 = r(W[i - 15], 7) ^ r(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = r(W[i - 2], 17) ^ r(W[i - 2], 19) ^ (W[i - 2] >>> 10); W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0, t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Buffer(32), odv = new DataView(out.buffer); H.forEach((x, i) => odv.setUint32(4 * i, x)); return out;
}
const crypto = {
  createHash(alg) {
    if (alg !== 'sha256') throw new Error(`shim crypto: only sha256 is here, not ${alg}`);
    const parts = [];
    const h = { update(x) { parts.push(typeof x === 'string' ? Buffer.from(x) : x); return h; }, digest(e) { const d = sha256(Buffer.concat(parts)); return e ? d.toString(e) : d; } };
    return h;
  },
};

// ---- zlib.deflateSync as stored blocks (RFC 1950 wrapper around RFC 1951 BTYPE 00), with the Adler-32 check
function deflateSync(data) {
  const n = data.length, blocks = Math.max(1, Math.ceil(n / 65535)), out = new Buffer(2 + n + blocks * 5 + 4);
  out[0] = 0x78; out[1] = 0x01;
  let o = 2;
  for (let b = 0; b < blocks; b++) {
    const s = b * 65535, len = Math.min(65535, n - s);
    out[o++] = b === blocks - 1 ? 1 : 0; out[o++] = len & 0xff; out[o++] = len >> 8; out[o++] = ~len & 0xff; out[o++] = (~len >> 8) & 0xff;
    out.set(data.subarray(s, s + len), o); o += len;
  }
  let a = 1, c = 0; for (let i = 0; i < n; i++) { a = (a + data[i]) % 65521; c = (c + a) % 65521; }
  out.writeUInt32BE(((c << 16) | a) >>> 0, o);
  return out;
}

// ---- path (POSIX) and an in-memory fs
function normalize(p) {
  const abs = p.startsWith('/'), out = [];
  for (const part of p.split('/')) { if (!part || part === '.') continue; if (part === '..') out.pop(); else out.push(part); }
  return (abs ? '/' : '') + out.join('/');
}
const path = {
  sep: '/',
  join: (...xs) => normalize(xs.filter((x) => x !== '').join('/')),
  resolve: (...xs) => { let p = ''; for (const x of xs) p = x.startsWith('/') ? x : `${p}/${x}`; return normalize(p.startsWith('/') ? p : `/${p}`); },
  dirname: (p) => { const n = normalize(p), i = n.lastIndexOf('/'); return i <= 0 ? (n.startsWith('/') ? '/' : '.') : n.slice(0, i); },
  basename: (p) => normalize(p).split('/').pop(),
  relative: (from, to) => { const a = normalize(from).split('/').filter(Boolean), b = normalize(to).split('/').filter(Boolean); let i = 0; while (i < a.length && a[i] === b[i]) i++; return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/'); },
};

function createShim() {
  const files = new Map(), dirs = new Set(['/', '/tmp']);
  let seq = 0;
  const abs = (p) => path.resolve(p);
  const parentOk = (p) => { const d = path.dirname(p); if (!dirs.has(d)) { const e = new Error(`ENOENT: no such directory, '${d}'`); e.code = 'ENOENT'; throw e; } };
  const fs = {
    existsSync: (p) => files.has(abs(p)) || dirs.has(abs(p)),
    mkdirSync(p, o = {}) { const a = abs(p); if (o.recursive) { let cur = ''; for (const part of a.split('/').filter(Boolean)) { cur += `/${part}`; dirs.add(cur); } } else { parentOk(a); dirs.add(a); } },
    mkdtempSync(prefix) { const a = abs(`${prefix}${String(++seq).padStart(6, '0')}`); fs.mkdirSync(a, { recursive: true }); return a; },
    writeFileSync(p, data) { const a = abs(p); parentOk(a); files.set(a, typeof data === 'string' ? Buffer.from(data) : Buffer.from(data)); },
    readFileSync(p, encoding) {
      const a = abs(p); if (!files.has(a)) { const e = new Error(`ENOENT: no such file, '${a}'`); e.code = 'ENOENT'; throw e; }
      const b = files.get(a); return typeof encoding === 'string' ? b.toString(encoding) : encoding && encoding.encoding ? b.toString(encoding.encoding) : b;
    },
    rmSync(p) { const a = abs(p); for (const k of [...files.keys()]) if (k === a || k.startsWith(`${a}/`)) files.delete(k); for (const d of [...dirs]) if (d === a || d.startsWith(`${a}/`)) dirs.delete(d); },
    readdirSync(p) { const a = abs(p), pre = a === '/' ? '/' : `${a}/`, names = new Set(); for (const k of [...files.keys(), ...dirs]) if (k.startsWith(pre) && k !== a) names.add(k.slice(pre.length).split('/')[0]); return [...names].sort(); },
  };
  return {
    Buffer,
    builtins: { fs, os: { tmpdir: () => '/tmp' }, path, crypto, zlib: { deflateSync } },
    /** Empty the in-memory disk, so one loaded exporter serves many exports. */
    reset() { files.clear(); dirs.clear(); dirs.add('/'); dirs.add('/tmp'); },
    /** Every file written under `root`, as { path relative to root, bytes }. */
    files(root) { const r = abs(root), pre = `${r}/`; return [...files.entries()].filter(([k]) => k.startsWith(pre)).map(([k, bytes]) => ({ path: k.slice(pre.length), bytes })).sort((a, b) => (a.path < b.path ? -1 : 1)); },
  };
}

module.exports = { createShim, Buffer, sha256, deflateSync, path };
