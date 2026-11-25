// shaperead.js: what a placed ROAD piece does, read off its BUILT road, for a piece whose typed values were not kept (a track from before the undo file kept them, a shared or pasted track).
// The user, 2026-11-25: "if you can see the shape, you can derive the values as well". These are READ numbers, not the typed ones: the readout that shows them says so.
//   readFromShape(doc, i) -> { lengthM, turns: [{ fromM, toM, deg }], climbDeg, bank: [{ atM, deg }], bankAt(m), partial }
//     turns   the stretches where the heading turns faster than TURN_RATE degrees per metre (the plan's heading over an 8 m chord, as test/roll_profile.js turnOf reads it), each with
//             where it starts and ends (metres from the piece's start) and the degrees it turns (+ left)
//     climbDeg  the pitch at the piece's end less the pitch at its start
//     bank    the built roll at the piece's start, at each turning point of it (a local extreme of at least BANK_STEP degrees), and at its end
//     bankAt(m) the built roll at m metres into the piece (for comparing with marks that are not turning points, such as a flowing bank's zero crossing)
// Only the last READ_PIECES pieces up to and including piece i are built (a whole 24 km track is not rebuilt to read one piece); the heading, pitch and roll read are relative or
// absolute in the road itself, so the answer does not depend on where the slice starts, except that the bank carried INTO the first of them is as the slice lays it.
'use strict';
const A = require('./adapter.js');
const DEG = Math.PI / 180, TURN_CHORD = 8, TURN_RATE = 0.15, GAP_M = 6, BANK_STEP = 0.5, READ_PIECES = 3, STEP = 0.5;
function nearest(S, s) { let lo = 0, hi = S.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].s <= s) lo = m; else hi = m; } return Math.abs(S[hi].s - s) < Math.abs(S[lo].s - s) ? S[hi] : S[lo]; }
function readFromShape(doc, i) {
  const P = doc.pieces[i];
  if (!P || P.type !== 'road') return null;
  const k0 = Math.max(0, i - (READ_PIECES - 1)), slice = { ...doc, pieces: doc.pieces.slice(k0, i + 1) };
  const s0 = doc.pieces.slice(k0, i).reduce((a, Q) => a + Q.length, 0), s1 = s0 + P.length;
  let S; try { S = A.toPath(slice, { step: STEP }).path.samples; } catch (e) { return null; }
  const h = TURN_CHORD / 2, rows = []; let prev = null, acc = 0;
  for (let s = Math.max(h, s0); s <= Math.min(s1, S[S.length - 1].s - h) + 1e-9; s += STEP) {
    const p = nearest(S, s - h), q = nearest(S, s + h), th = Math.atan2(-(q.pos[2] - p.pos[2]), q.pos[0] - p.pos[0]);
    if (prev !== null) { let d = th - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; acc += d; }
    prev = th; rows.push({ s: s - s0, h: acc / DEG });
  }
  const turns = []; let cur = null;
  for (let j = 2; j < rows.length - 2; j++) {
    const r = (rows[j + 2].h - rows[j - 2].h) / (rows[j + 2].s - rows[j - 2].s), on = Math.abs(r) > TURN_RATE;
    if (on && !(cur && Math.sign(r) !== cur.sign)) { if (!cur) cur = { sign: Math.sign(r), a: j, b: j, off: null }; cur.b = j; cur.off = null; }
    else if (cur) { if (cur.off === null) cur.off = rows[j].s; if (rows[j].s - cur.off > GAP_M || (on && Math.sign(r) !== cur.sign)) { turns.push(cur); cur = on ? { sign: Math.sign(r), a: j, b: j, off: null } : null; } }
  }
  if (cur) turns.push(cur);
  const outTurns = turns.map((t) => ({ fromM: rows[t.a].s, toM: rows[t.b].s, deg: rows[t.b].h - rows[t.a].h })).filter((t) => Math.abs(t.deg) >= 1);
  const pitch = (m) => Math.asin(Math.max(-1, Math.min(1, nearest(S, s0 + m).T[1]))) / DEG;
  const bankAt = (m) => nearest(S, s0 + m).roll / DEG;
  const bank = [{ atM: 0, deg: bankAt(0) }];
  const roll = []; for (let m = 0; m <= P.length + 1e-9; m += STEP) roll.push({ m, v: bankAt(m) });
  // a turning point: where the roll stops falling and starts rising or the reverse (steps under 1e-6 degree are flat and skipped); a roll that merely levels off is not one
  { let dir = 0, at = 0; for (let j = 1; j < roll.length; j++) { const d = roll[j].v - roll[j - 1].v; if (Math.abs(d) < 1e-6) continue; const sg = Math.sign(d); if (dir !== 0 && sg !== dir && Math.abs(roll[j - 1].v - bank[bank.length - 1].deg) >= BANK_STEP && roll[j - 1].m - bank[bank.length - 1].atM > GAP_M) bank.push({ atM: roll[j - 1].m, deg: roll[j - 1].v }); dir = sg; at = j; } void at; }
  bank.push({ atM: P.length, deg: bankAt(P.length) });
  return { lengthM: P.length, turns: outTurns, climbDeg: pitch(P.length) - pitch(0), bank, bankAt, partial: k0 > 0 && i - k0 + 1 < READ_PIECES ? false : k0 > 0 };
}
/** The words for the readout: what was read, said to be read from the shape. */
function shapeWords(r) {
  if (!r) return 'read from the shape: not readable';
  const f = (x, d = 1) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d);
  const turns = r.turns.length ? r.turns.map((t) => `${f(t.deg)}° from ${t.fromM.toFixed(0)} to ${t.toM.toFixed(0)} m`).join(', ') : 'straight';
  const bank = r.bank.map((b) => `${f(b.deg)}° at ${b.atM.toFixed(0)} m`).join(', ');
  return `read from the shape, not the typed values: ${r.lengthM.toFixed(0)} m; turns ${turns}; climb ${f(r.climbDeg)}°; bank ${bank}`;
}
module.exports = { readFromShape, shapeWords, TURN_RATE, BANK_STEP, READ_PIECES };
