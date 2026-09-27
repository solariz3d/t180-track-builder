// mapping.js: AUTOMATIC texture mapping for a road piece (ARCHITECTURE §5b: "Mapping is automatic: along the track by
// distance, and across by the profile's own width, so a texture flows correctly through turns, walls and loops. The
// user gets handles for tiling length, stretch versus tile, offset and direction.").
//
//   bandsOf(profile, opts)                  -> [{ slot, side, u0, u1 }]  which part of the cross-section each slot wears
//   splitColumns(Us, bands)                 -> { us, ranges: [{ slot, side, k0, k1 }] }  band edges made into columns
//   surfaceRows(samples, profile, us)       -> R rows of K world points (float64), as mesh.js places its vertices
//   mapStrip(strip, settings, opts)         -> { uv: Float64Array(R·K·2), along: R rows of K metres }
//
// ALONG: each lateral line's OWN arc length, not the centreline's. On a line u metres from the centre, the surface is
// (1 − κ·q) times the centreline's length (the fold margin, mesh.js), so a texture laid by centreline distance is
// squashed on the inside of a turn and stretched on the outside, by that factor. Here each column k accumulates the
// distance its own vertices travel, row to row, so one tile is one tileLength of THAT line, wherever the line is.
// ACROSS: the profile's own arc length u (profile.js: u IS arc length, on walls past 90° and on a tube's roof alike),
// measured outward from the band's inner edge. So the left and the right kerb run outward from the road, mirror images,
// as kerbs are. The floor spans both sides and runs right to left.
//
// SETTINGS (src/doc/textures.js): texture coordinates are
//   t_along  = (along + offset) / tileLength
//   t_across = fit === 'fit' ? across / (band width) : across / tileWidth
// and dir 'along' gives (u, v) = (t_across, t_along); dir 'across' swaps them.
//
// WHAT THIS DOES NOT DO. Along is continuous within a piece; each piece starts at `startAlong` (default 0), because a
// piece's mesh is a function of its own handles (mesh.js), so a tile may break where one piece meets the next unless the
// caller passes the running distance. 'fit' stretches across by the band's width on EACH row, so on a font ramp (where
// the width changes) the texture's across density changes with it; that is what fit means. 'tile' keeps it constant.
'use strict';

const { normalize, offsetAt, psiAt } = require('../geom/profile.js');
const { SLOTS } = require('../doc/textures.js');

const DEG = Math.PI / 180;
// The widths of the edge strips, and the angle at which floor becomes wall. Inferred defaults (a kerb about a metre, a
// painted line a hand's width, a glow strip half a metre, the 30° at which a surface stops reading as floor); a caller
// may pass its own.
const BAND_DEFAULTS = Object.freeze({ wallPsiDeg: 30, kerbM: 1, linesM: 0.3, glowM: 0.5 });

/** Where, walking outward on one side (sgn = +1 left, −1 right), |ψ| first reaches `lim`; the edge if it never does. */
function wallStart(P, sgn, lim) {
  const knots = P.u.filter((u) => (sgn > 0 ? u >= 0 : u <= 0)).sort((a, b) => sgn * (a - b));
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1], b = knots[i], pa = Math.abs(psiAt(P, a)), pb = Math.abs(psiAt(P, b));
    if (pb >= lim) return pa >= lim ? a : a + (b - a) * (lim - pa) / (pb - pa);
  }
  return knots[knots.length - 1];
}

/**
 * The slots' bands across a profile, ascending in u, no gaps, no overlaps. On each side, from the edge inward: the edge
 * glow (the last glowM of the profile), the wall (from where |ψ| reaches wallPsiDeg to the glow), then the kerb and the
 * line on the floor just inside the wall (or inside the glow, where there is no wall). The floor is the rest, one band
 * across the centre. A band narrower than 1 µm is dropped.
 */
function bandsOf(profile, opts = {}) {
  const P = normalize(profile), o = { ...BAND_DEFAULTS, ...opts };
  for (const k of ['kerbM', 'linesM', 'glowM']) if (!(Number.isFinite(o[k]) && o[k] >= 0)) throw new Error(`bandsOf: ${k} must be a length ≥ 0`);
  const side = (sgn) => {
    const edge = sgn > 0 ? P.u[P.u.length - 1] : -P.u[0];       // the side's width, ≥ 0
    const w = Math.abs(wallStart(P, sgn, o.wallPsiDeg * DEG));
    const glow0 = Math.max(0, edge - o.glowM), wall0 = Math.min(w, glow0);
    const kerb0 = Math.max(0, wall0 - o.kerbM), line0 = Math.max(0, kerb0 - o.linesM);
    return { floor: line0, list: [['lines', line0, kerb0], ['kerbs', kerb0, wall0], ['walls', wall0, glow0], ['edgeGlow', glow0, edge]] };
  };
  const L = side(1), R = side(-1), out = [];
  const keep = (b) => b.u1 - b.u0 > 1e-6;
  for (const [slot, a, b] of R.list.slice().reverse()) out.push({ slot, side: 'R', u0: -b, u1: -a });
  out.push({ slot: 'floor', side: 'C', u0: -R.floor, u1: L.floor });
  for (const [slot, a, b] of L.list) out.push({ slot, side: 'L', u0: a, u1: b });
  return out.filter(keep);
}

/**
 * The across samples with every band edge made a column, and each band's column range [k0, k1] (inclusive). A band's
 * first and last columns are its edges, so a mesh cut per band shares the edge's position and gives each band its own
 * vertex there (its own UV). Columns closer than 1e-6 m to an edge are moved onto it.
 */
function splitColumns(Us, bands) {
  const edges = [...new Set(bands.flatMap((b) => [b.u0, b.u1]))];
  const us = [...Us];
  for (const e of edges) { const i = us.findIndex((x) => Math.abs(x - e) < 1e-6); if (i >= 0) us[i] = e; else us.push(e); }
  us.sort((a, b) => a - b);
  const ranges = bands.map((b) => ({ slot: b.slot, side: b.side, k0: us.indexOf(b.u0), k1: us.indexOf(b.u1) }));
  for (const r of ranges) if (r.k0 < 0 || r.k1 <= r.k0) throw new Error(`splitColumns: band ${r.slot}/${r.side} does not lie on the samples`);
  return { us, ranges };
}

/** World positions of the profile at `us`, at each sample: pos + X·L + Y·U, as mesh.js's vertex(). Float64. */
function surfaceRows(samples, profile, us) {
  const P = normalize(profile), off = us.map((u) => offsetAt(P, u));
  return samples.map((sm) => off.map(([X, Y]) => [sm.pos[0] + sm.L[0] * X + sm.U[0] * Y, sm.pos[1] + sm.L[1] * X + sm.U[1] * Y, sm.pos[2] + sm.L[2] * X + sm.U[2] * Y]));
}

const perRow = (x, r) => (Array.isArray(x) || ArrayBuffer.isView(x) ? (Array.isArray(x[0]) || ArrayBuffer.isView(x[0]) ? x[r] : x) : x);
const at = (x, r) => (typeof x === 'number' ? x : x[r]);

/**
 * Texture coordinates for one band (strip) of a piece.
 *   strip: { rows: R rows of K points, us: K u-values (or R rows of them, on a font ramp), u0, u1: the band's edges
 *            (numbers, or R-arrays on a ramp), side: 'C' | 'L' | 'R' }
 *   settings: a slot's effective settings (textures.js DEFAULT's keys)
 *   opts: { startAlong = 0 } metres already travelled when the piece starts
 */
function mapStrip(strip, settings, { startAlong = 0 } = {}) {
  const { rows, side } = strip, R = rows.length, K = R ? rows[0].length : 0;
  if (!R || K < 2) throw new Error('mapStrip: a strip needs at least one row of two columns');
  if (!['C', 'L', 'R'].includes(side)) throw new Error(`mapStrip: side is C, L or R, not ${side}`);
  const { tileLength, tileWidth, fit, offset, dir } = settings;
  if (!(tileLength > 0) || !(tileWidth > 0)) throw new Error('mapStrip: tileLength and tileWidth must be > 0');
  const along = [rows[0].map(() => startAlong)];
  for (let r = 1; r < R; r++) along.push(rows[r].map((p, k) => { const q = rows[r - 1][k]; return along[r - 1][k] + Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }));
  const uv = new Float64Array(R * K * 2);
  for (let r = 0; r < R; r++) {
    const us = perRow(strip.us, r), u0 = at(strip.u0, r), u1 = at(strip.u1, r), w = u1 - u0;
    if (!(w > 0)) throw new Error(`mapStrip: row ${r}: the band has no width`);
    for (let k = 0; k < K; k++) {
      const across = side === 'R' ? u1 - us[k] : us[k] - u0;       // outward from the road on each side; right to left across the floor
      const ta = (along[r][k] + offset) / tileLength, tc = fit === 'fit' ? across / w : across / tileWidth;
      const o = (r * K + k) * 2;
      if (dir === 'across') { uv[o] = ta; uv[o + 1] = tc; } else { uv[o] = tc; uv[o + 1] = ta; }
    }
  }
  return { uv, along };
}

module.exports = { BAND_DEFAULTS, SLOTS, bandsOf, splitColumns, surfaceRows, mapStrip };
