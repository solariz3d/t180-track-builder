// equation.js: a track as ONE equation (the keeper's design notes §12, M4), and the LOADER that opens one as an example
// document.
//
// THE EQUATION ('t180b.equation/1'). Every function of the lap is a Fourier series in the arc length s over one lap L:
//   f(s) = net·s/L + c0 + Σ_{k=1..N} a_k cos(2πks/L) + b_k sin(2πks/L)
// The angles (heading θ, pitch p, roll φ, radians, in the geometry's own conventions: src/geom/path.js CURVE MODEL and
// FRAME) carry `net`, their whole turns over a lap (a multiple of 2π), so a lap is closed in angle by construction; their
// RATES (the heading and pitch curvature the geometry integrates) are the exact derivatives of the series. The
// cross-section functions (wl, wr in m; psiL, psiR: the tilt at ¼, ½, ¾ and the edge of each side, in degrees, as the
// track reader measures them) have net 0.
//   { schema, track, lapM, N, start: { pos, theta, p }, series: { theta, pitch, roll, wl, wr, psiL: [4], psiR: [4] },
//     jumps: [{ s, gap, drop }] }
//
// PRIVACY (design notes §12): an equation fitted to a real track IS that track's layout, another author's work. Such files
// live in the gitignored reads/ folder and are never committed (tools/fourier.cjs refuses to write anywhere else, and
// test/fourier.test.js checks no tracked path holds one). This file holds no track: only the arithmetic.
//
// THE LOADER, equationToDoc(eq): the equation as an ordinary document, so the keeper can open a reverse-engineered track
// in the builder as an example and edit it word by word.
// - One road word per `wordM` metres (default 25). Each opens its curvature over its whole length (easeIn 1, easeOut 0),
//   so the document's curvature is piecewise linear and continuous: each word's turn is chosen so its curvature ARRIVES
//   at the series' heading rate at the word's end, from the curvature it actually started with (resolve.js's own rule,
//   turn = (k_in + k)·L/2), and likewise its climb for the pitch rate. So the document follows the series' rates, and its
//   heading and pitch at every word end are the trapezoid integrals of the series' rates.
// - Roll: roll0/roll1 are the series' roll at the word's ends (a continuous roll, as resolve requires).
// - The cross-section maps LOSSILY onto the builder's font (a floor with equal walls, a linearly rising tilt): on each
//   side the floor runs to where the tilt reaches 3°, the wall is the mean of the two sides' remainders, the floor
//   width is the rest, and ψL/ψR are the edge tilts.
// - A jump in the equation becomes a jump word (gap = the take-off-to-landing chord's horizontal length, drop, and the
//   landing pitch from the series), then the series resumes past the landing ramp that resolve adds.
// - The document is OPEN: it starts at the origin, heading 0 and pitch 0 (every document does), and ends where the lap
//   meets its start. Closing it is the connector's job (connector.js), as for any document.
'use strict';

const { createDoc, appendWord } = require('./document.js');
const { resolve } = require('./resolve.js');

const TAU = 2 * Math.PI, DEG = Math.PI / 180;
const SCHEMA = 't180b.equation/1';
const ANGLES = ['theta', 'pitch', 'roll'];

/** The series' value at s. */
function value(f, L, s) {
  let v = (f.net || 0) * s / L + f.c0;
  for (let k = 1; k <= f.a.length; k++) { const w = TAU * k * s / L; v += f.a[k - 1] * Math.cos(w) + f.b[k - 1] * Math.sin(w); }
  return v;
}
/** The series' derivative at s (the rate: 1/m for an angle). */
function rate(f, L, s) {
  let v = (f.net || 0) / L;
  for (let k = 1; k <= f.a.length; k++) { const c = TAU * k / L, w = c * s; v += c * (f.b[k - 1] * Math.cos(w) - f.a[k - 1] * Math.sin(w)); }
  return v;
}

/** Refuse anything that is not a well-formed equation, by name. */
function checkEquation(eq) {
  const bad = (m) => { throw new Error(`equation: ${m}`); };
  if (!eq || eq.schema !== SCHEMA) bad(`schema must be ${SCHEMA}`);
  if (!(eq.lapM > 0)) bad('lapM must be positive');
  const one = (f, at) => {
    if (!f || !Number.isFinite(f.c0) || !Array.isArray(f.a) || !Array.isArray(f.b) || f.a.length !== f.b.length) bad(`${at}: needs c0 and equal-length a, b`);
    if (![...f.a, ...f.b, f.net || 0].every(Number.isFinite)) bad(`${at}: a coefficient is not finite`);
  };
  for (const k of ANGLES) { one(eq.series[k], k); if (Math.abs(eq.series[k].net / TAU - Math.round(eq.series[k].net / TAU)) > 1e-9) bad(`${k}: net must be whole turns`); }
  for (const k of ['wl', 'wr']) one(eq.series[k], k);
  for (const k of ['psiL', 'psiR']) { if (!Array.isArray(eq.series[k]) || eq.series[k].length !== 4) bad(`${k}: four series`); eq.series[k].forEach((f, i) => one(f, `${k}[${i}]`)); }
  if (!Array.isArray(eq.jumps)) bad('jumps must be a list');
  for (const j of eq.jumps) if (!(j.s >= 0 && j.s < eq.lapM && j.gap > 0 && Number.isFinite(j.drop))) bad('a jump needs 0 ≤ s < lapM, gap > 0, drop');
  return eq;
}

/** The builder font's handles from the cross-section series at s (see THE LOADER). SI: m and radians. */
function profileAt(eq, s) {
  const L = eq.lapM, side = (w, psi) => {
    const t = psi.map((f) => Math.max(0, value(f, L, s))), q = [0, 0.25, 0.5, 0.75, 1], y = [0, ...t];
    let floor = 1; for (let i = 1; i < 5; i++) if (y[i] >= 3) { floor = q[i - 1] + (q[i] - q[i - 1]) * (y[i] - 3 > 0 && y[i] - y[i - 1] > 0 ? (3 - y[i - 1]) / (y[i] - y[i - 1]) : 1); break; }
    return { w: Math.max(0.5, w), wall: Math.max(0.5, w) * (1 - Math.max(0, Math.min(1, floor))), edge: t[3] };
  };
  const l = side(value(eq.series.wl, L, s), eq.series.psiL), r = side(value(eq.series.wr, L, s), eq.series.psiR);
  const wall = (l.wall + r.wall) / 2, width = Math.max(1, l.w + r.w - 2 * wall);
  return { width: Math.min(200, width), wall: Math.min(100, wall), psiL: Math.min(175, l.edge) * DEG, psiR: Math.min(175, r.edge) * DEG };
}

/**
 * The equation as an open document (see THE LOADER). opts: { wordM = 25, name }. Returns { doc, words, jumps }.
 */
function equationToDoc(eq, opts = {}) {
  checkEquation(eq);
  const L = eq.lapM, wordM = opts.wordM || 25, S = eq.series, jumps = [...eq.jumps].sort((x, y) => x.s - y.s);
  let doc = createDoc(opts.name || (eq.track ? `${eq.track} (equation)` : 'equation')), s = 0, kIn = 0, kpIn = 0, ji = 0, words = 0;
  const roll = (x) => value(S.roll, L, x);   // absolute: the bank against gravity (the first word may start banked)
  let th = 0, p = 0, lastRoll = roll(0), catchUp = true;   // the document's own heading (from 0), pitch and roll so far
  while (s < L - 1e-6) {
    const J = jumps[ji];
    if (J && s >= J.s - 1e-6) {   // the jump: a jump word, then the series resumes past resolve's landing ramp
      const land = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, value(S.pitch, L, J.s + J.gap)));
      doc = appendWord(doc, 'jump', { handles: { gap: J.gap, drop: J.drop, land } }); words++;
      const segs = resolve(doc).segments, ramp = segs[segs.length - 1];
      s = J.s + J.gap + (ramp.part === 'land' ? ramp.length : 0); kIn = 0; kpIn = 0; ji++; p = land; catchUp = true;
      continue;
    }
    const end = Math.min(L, s + wordM, J ? J.s : Infinity), len = end - s;
    if (len < 1e-3) { s = end; continue; }
    // Rate-following: turn = (k_in + k)·len/2 makes the word END at the series' rate k (resolve: peak = 2·turn/len − k_in).
    // At the start, and after a jump (which flies straight in plan and lands at its own pitch), the step is instead TWO
    // half-length words that CATCH UP the heading and pitch to the series' AND end at its rates: the middle curvature
    // kA = (2Δ/l − k_in − k)/2 makes the pair turn by exactly Δ. A kink the document shows where the equation jumps.
    const k = rate(S.theta, L, end), kp = rate(S.pitch, L, end);
    const put = (a, b, turn, climb) => {
      doc = appendWord(doc, 'straight', { font: 'half-pipe', handles: { length: b - a, turn, climb: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, climb)), easeIn: 1, easeOut: 0, roll0: lastRoll, roll1: roll(b), heartline: 0, ramp: Math.min(20, Math.max(1, b - a)), ...profileAt(eq, (a + b) / 2) } });
      words++;
      // the curvature this word actually ends at, from its QUANTISED turn and climb (resolve.js: k = 2·turn/L − k_in)
      const h = doc.words[doc.words.length - 1].handles;
      kIn = 2 * h.turn / h.length - kIn; kpIn = 2 * h.climb / h.length - kpIn;
      th += h.turn; p += h.climb; lastRoll = h.roll1;
    };
    if (catchUp) {
      const l = len / 2, dT = value(S.theta, L, end) - value(S.theta, L, 0) - th, dP = value(S.pitch, L, end) - p;
      const kA = (2 * dT / l - kIn - k) / 2, kpA = (2 * dP / l - kpIn - kp) / 2;
      put(s, s + l, (kIn + kA) * l / 2, (kpIn + kpA) * l / 2);
      put(s + l, end, (kIn + k) * l / 2, (kpIn + kp) * l / 2);
    } else put(s, end, (kIn + k) * len / 2, (kpIn + kp) * len / 2);
    catchUp = false; s = end;
  }
  return { doc, words, jumps: jumps.length };
}

module.exports = { SCHEMA, value, rate, checkEquation, profileAt, equationToDoc };
