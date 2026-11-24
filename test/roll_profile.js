// roll_profile.js: the roll and the turn read along a road, for the smooth-bank rows (test/roll_profile.test.js holds it to known answers). Test code only.
// Plan: lighthouse exo_memory/loop/plan_t180_smooth_banked_turns_2026-11-24.md, Part 0. The builder's checker (src/validate) reads the roll over a 20 m chord, which
// averages away a roll that halts at a mark and starts again (the flow lap measured nine such halts on a piece the checker passed clean); this reads it over 4 m.
//   docBank(P, step)        the document's bank of road piece P every `step` m: [{ s, v }] (s from the piece's start, v in degrees, + = left side up)
//   builtBank(doc, step)    the BUILT bank (the adapter's roll, src/core/adapter.js toPath) every `step` m: [{ s, v }] (s from the track's start, degrees)
//   rateOn(profile, chord)  the roll rate over a chord centred on each sample: [{ s, r }] in degrees per metre, signed
//   stops(profile, ref, o)  where the roll halts inside a roll: a local minimum of |rate| over a 4 m chord that falls under half of ref(s), wherever |ref(s)|
//                           is over 0.15 °/m (ref: the roll rate the road should have there, °/m). Halts within 6 m of each other are one. [{ s, e, r, want }]
//   turnOf(doc, a, b)       the turn between track metres a and b, read from the plan positions over 8 m chords: { deg (+ left), span (the middle 80 % of
//                           the turn, m), radius (span over 0.8 of the angle, m), s10, s90 }
'use strict';
const D = require('../src/core/document.js');
const A = require('../src/core/adapter.js');

const DEG = Math.PI / 180;
const STOP_CHORD = 4, STOP_SHARE = 0.5, STOP_FLOOR = 0.15, STOP_MERGE = 6, TURN_CHORD = 8;
const tooShort = (what) => new D.CoreError('TOO_SHORT', what);

function docBank(P, step = 0.5) {
  const out = [], n = Math.max(1, Math.round(P.length / step));
  for (let k = 0; k <= n; k++) { const s = (P.length * k) / n; out.push({ s, v: D.channelValue(P, 'phi', s) / DEG }); }
  return out;
}
function builtBank(doc, step = 0.5) {
  return A.toPath(doc, { step }).path.samples.map((x) => ({ s: x.s, v: x.roll / DEG }));
}
/** The sample nearest s (the profile is ordered by s). */
function near(p, s) {
  let lo = 0, hi = p.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m].s <= s) lo = m; else hi = m; }
  return Math.abs(p[hi].s - s) < Math.abs(p[lo].s - s) ? p[hi] : p[lo];
}
function rateOn(p, chord) {
  if (!Array.isArray(p) || p.length < 2 || p[p.length - 1].s - p[0].s < 2 * chord) throw tooShort(`a profile shorter than two chords (${2 * chord} m) has no rate to read`);
  const h = chord / 2, s0 = p[0].s, s1 = p[p.length - 1].s;
  return p.map((x) => { const a = near(p, Math.max(s0, x.s - h)), b = near(p, Math.min(s1, x.s + h)); return { s: x.s, r: b.s > a.s ? (b.v - a.v) / (b.s - a.s) : 0 }; });
}
function stops(p, ref) {
  const r = rateOn(p, STOP_CHORD), out = [], s0 = p[0].s + STOP_CHORD, s1 = p[p.length - 1].s - STOP_CHORD;
  for (let i = 1; i < r.length - 1; i++) {
    const x = r[i]; if (x.s < s0 || x.s > s1) continue;
    const m = Math.abs(x.r);
    if (!(m <= Math.abs(r[i - 1].r) && m < Math.abs(r[i + 1].r))) continue;   // a local minimum of the roll's size
    const want = Math.abs(ref(x.s));
    if (!(want > STOP_FLOOR && m < STOP_SHARE * want)) continue;
    const last = out[out.length - 1];
    if (last && x.s - last.e < STOP_MERGE) { last.e = x.s; if (m < last.r) last.r = m; continue; }
    out.push({ s: x.s, e: x.s, r: m, want });
  }
  return out;
}
function turnOf(doc, a, b) {
  if (!(b - a >= 2 * TURN_CHORD)) throw tooShort(`a turn shorter than two chords (${2 * TURN_CHORD} m) cannot be read`);
  const S = A.toPath(doc, { step: 0.5 }).path.samples, P = S.map((x) => ({ s: x.s, x: x.pos[0], z: x.pos[2] }));
  const at = (s) => near(P, s), h = TURN_CHORD / 2;
  // the heading of the chord centred on s, unwrapped as it accumulates; + = left (the builder's world: L = up × T, so a left turn turns T toward L)
  const rows = []; let prev = null, acc = 0;
  for (let s = a; s <= b + 1e-9; s += 0.5) {
    const p = at(s - h), q = at(s + h), th = Math.atan2(-(q.z - p.z), q.x - p.x);
    if (prev !== null) { let d = th - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; acc += d; }
    prev = th; rows.push({ s, h: acc });
  }
  const tot = rows[rows.length - 1].h, at10 = rows.find((r) => Math.abs(r.h) >= 0.1 * Math.abs(tot)), at90 = rows.find((r) => Math.abs(r.h) >= 0.9 * Math.abs(tot));
  const span = at90.s - at10.s;
  return { deg: tot / DEG, span, radius: span / (0.8 * Math.abs(tot)), s10: at10.s, s90: at90.s };
}

module.exports = { docBank, builtBank, near, rateOn, stops, turnOf, STOP_CHORD, STOP_SHARE, STOP_FLOOR, STOP_MERGE, TURN_CHORD };
