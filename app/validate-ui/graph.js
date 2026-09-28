// graph.js: the load graph in the validation panel (the librarian's item 5, 2026-09-27: "The right panel's graph area is
// an empty grey bar"). Before D169 there were no loads, so the old colour ribbon painted every station the same grey.
//
//   graphModel(state, { car })  -> null while there is no load to show (no speed model: nothing to draw, so hidden)
//                                  | { s: [...], fN: [...], top, lines: [{ g, label, source }], bands: [{ s0, s1, level }] }
//   drawGraph(canvas, model)     one polyline of the hardest line's load along the track, the limit lines, and the
//                                red and amber stretches shaded behind it
//
// THE CURVE is, per station, the HIGHEST load into the road across its lateral lines (the line that is hit hardest: on
// a half-pipe that is the wall, not the floor). THE LIMIT LINES are the car's, read from validation's car object:
// the suspension stop (FINDINGS.md:103-104) and the proven load (FINDINGS.md:105). THE Y SCALE runs from 0 to the
// larger of the highest load and 1.1 × the proven load, so the 90 g line is always on the graph (1.1: inferred, a
// display margin).
'use strict';
const { MACH6 } = require('../../src/validate/limits.js');
const { LEVEL, PALETTE } = require('./colour.js');

function graphModel(state, { car = MACH6 } = {}) {
  const r = state && state.result;
  if (!r || !r.lines.length) return null;
  const s = [], fN = [];
  for (const l of r.lines) {
    if (s.length && s[s.length - 1] === l.s) { if (l.fN_g > fN[fN.length - 1]) fN[fN.length - 1] = l.fN_g; }
    else { s.push(l.s); fN.push(l.fN_g); }
  }
  const top = Math.max(fN.reduce((m, x) => Math.max(m, x), -Infinity), 1.1 * car.provenG);
  const pending = r.pendingFrom != null, sEnd = pending && state.path ? Math.max(state.path.lengthM, s[s.length - 1]) : s[s.length - 1];
  return {
    s, fN, top,
    lines: [{ g: car.suspensionStopG, label: `${car.suspensionStopG} g stop`, source: 'FINDINGS.md:103-104' }, { g: car.provenG, label: `${car.provenG} g proven`, source: 'FINDINGS.md:105' }],
    bands: [...r.red.map((x) => ({ s0: x.s0, s1: x.s1, level: LEVEL.RED })), ...r.amber.map((x) => ({ s0: x.s0, s1: x.s1, level: LEVEL.AMBER })),
      // D179: while a drag is open the stretch past the window is not checked yet; it is shaded PENDING to the track's end
      ...(pending ? [{ s0: r.pendingFrom, s1: sEnd, level: LEVEL.PENDING }] : [])],
    sEnd,
  };
}

function drawGraph(canvas, m) {
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  if (!m) return;
  const last = m.sEnd != null ? m.sEnd : m.s[m.s.length - 1], s0 = m.s[0], s1 = last > s0 ? last : s0 + 1;
  const X = (s) => ((s - s0) / (s1 - s0)) * (W - 1), Y = (v) => H - 1 - (Math.max(0, v) / m.top) * (H - 2);
  const rgba = (c, a) => `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;
  for (const b of m.bands) { g.fillStyle = rgba(PALETTE[b.level], 0.25); g.fillRect(X(b.s0), 0, Math.max(1, X(b.s1) - X(b.s0)), H); }
  const k = canvas.clientWidth > 0 ? W / canvas.clientWidth : 1;   // backing pixels per css pixel: labels stay 10 css px
  g.font = `${Math.round(10 * k)}px sans-serif`;
  for (const [k, l] of m.lines.entries()) {
    g.strokeStyle = rgba(PALETTE[k ? LEVEL.AMBER : LEVEL.INFO], 0.9); g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(0, Y(l.g)); g.lineTo(W, Y(l.g)); g.stroke();
    g.fillStyle = g.strokeStyle; g.fillText(l.label, 2, Y(l.g) - 2);
  }
  g.setLineDash([]); g.strokeStyle = rgba(PALETTE[LEVEL.CLEAR], 1); g.lineWidth = 1.5;
  g.beginPath(); m.s.forEach((s, i) => (i ? g.lineTo(X(s), Y(m.fN[i])) : g.moveTo(X(s), Y(m.fN[i])))); g.stroke();
}

module.exports = { graphModel, drawGraph };
