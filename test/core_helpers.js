// core_helpers.js: shared by E's core tests (test/core_sculpt*.test.js, test/core_close*.test.js). Not a test file.
// - gen(): the D185 registration's SEEDED generator of 20 nearly-closed tracks (seed 185, mulberry32), reproduced exactly from
//   the sealed exo_memory/loop/d185/gen_tracks.js (pane B), so the tests run on the same 20 tracks the read checks.
// - piecesFrom(): a generated piece list as the core's channels (clamped cubic B-splines in each piece's local s, a knot every
//   `h` m), each channel the Bloss ramp from the previous end value to the piece's target (02 §4, S(u) = 3u² − 2u³), fitted by
//   least squares (03 §2) with D184's solver. A cubic lies in the spline space, so the fit reproduces the ramp to rounding.
'use strict';
const PW = require('../tools/piecewise.cjs');

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gen(SEED = 185, COUNT = 20) {
  const rnd = mulberry32(SEED), U = (a, b) => a + (b - a) * rnd(), I = (a, b) => Math.floor(U(a, b + 1));
  const DEG = Math.PI / 180, r6 = (x) => +x.toPrecision(12), tracks = [];
  for (let t = 0; t < COUNT; t++) {
    const n = I(6, 12), pieces = [];
    let kh = 0, kv = 0, bank = 0, width = 30;
    for (let i = 0; i < n; i++) {
      const p = { length: U(150, 600), kh: [kh, U(-1 / 150, 1 / 150)], kv: [kv, U(-1 / 3000, 1 / 3000)], bank: [bank, U(-35, 35) * DEG], width: [width, U(25, 35)] };
      kh = p.kh[1]; kv = p.kv[1]; bank = p.bank[1]; width = p.width[1];
      pieces.push(p);
    }
    const net = (key) => pieces.reduce((s, p) => s + p.length * (p[key][0] + p[key][1]) / 2, 0);
    const eps = U(-0.1, 0.1), scale = (2 * Math.PI * (1 + eps)) / net('kh');
    for (const p of pieces) p.kh = p.kh.map((v) => v * scale);
    const L = pieces.reduce((s, p) => s + p.length, 0), mean = net('kv') / L;
    for (const p of pieces) p.kv = p.kv.map((v) => v - mean);
    tracks.push({ id: t, seed: SEED, eps: r6(eps), lengthM: r6(L), pieces: pieces.map((p) => ({ length: r6(p.length), kh: p.kh.map(r6), kv: p.kv.map(r6), bank: p.bank.map(r6), width: p.width.map(r6) })) });
  }
  return tracks;
}

const bloss = (u) => 3 * u * u - 2 * u * u * u;   // 02 §4
/** A clamped cubic on [0, L] with a knot every ~h m, fitted (03 §2) to g(s). */
function channelOf(g, L, h) {
  const m = Math.max(0, Math.round(L / h) - 1), inner = []; for (let j = 1; j <= m; j++) inner.push((j * L) / (m + 1));
  const P = [{ U: PW.knotsOf(0, L, inner) }], rows = [];
  for (let k = 0, n = Math.max(40, 8 * (m + 4)); k <= n; k++) { const s = (k * L) / n; rows.push({ piece: 0, s, values: [g(s)] }); }
  const f = PW.fitSystem(P, rows, [], 1, 0);
  const ctrl = Array.from(f.x[0].slice(0, inner.length + 4));
  ctrl[0] = g(0); ctrl[ctrl.length - 1] = g(L);   // a clamped end coefficient IS the end value: pin it exactly, so joints meet bit for bit
  return { knots: P[0].U, ctrl };
}
function piecesFrom(track, h = 20) {
  return track.pieces.map((p) => {
    const L = p.length, ramp = ([a, b]) => (s) => a + (b - a) * bloss(s / L);
    // a ramp's end is its target EXACTLY (a + (b − a)·1 can round away from b), so the next piece starts on the same double
    const ch = (ab) => { const c = channelOf(ramp(ab), L, h); c.ctrl[c.ctrl.length - 1] = ab[1]; return c; };
    return { length: L, ch: { kh: ch(p.kh), kv: ch(p.kv), bank: ch(p.bank), width: ch(p.width), rise: channelOf(() => 0.02, L, h) } };
  });
}
/** The value of a channel at local s (03 §1). */
function val(ch, s) { const b = PW.basis(ch.knots, s); let v = 0; for (let a = 0; a < 4; a++) v += ch.ctrl[b.first + a] * b.N[a]; return v; }
function slope(ch, s) { const b = PW.basis(ch.knots, s); let v = 0; for (let a = 0; a < 4; a++) v += ch.ctrl[b.first + a] * b.D1[a]; return v; }

/**
 * A generated track as a CORE document (src/core), built the way the D185 registration says: piece by piece with the core's
 * extend, each piece's channels blended from the previous end to its targets over its whole length. The first piece starts
 * from the generated start values.
 */
function docFrom(track, { name = `gen ${track.id}`, knotM } = {}) {
  const Dc = require('../src/core/document.js'), { extend } = require('../src/core/extend.js');
  let d = Dc.createDoc(name);
  track.pieces.forEach((p, i) => {
    const first = i === 0 ? { kh: p.kh[0], kv: p.kv[0], phi: p.bank[0], w: p.width[0] } : undefined;
    d = extend(d, { length: p.length, targets: { kh: p.kh[1], kv: p.kv[1], phi: p.bank[1], w: p.width[1] }, first, knotM });
  });
  return d;
}

module.exports = { gen, piecesFrom, channelOf, val, slope, bloss, docFrom };
