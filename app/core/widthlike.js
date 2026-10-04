// widthlike.js: the "width like…" drop-down's entries (D232), from src/doc/widths.json (numbers only; tools/widths.cjs makes it from the reads).
//
//   entries(tube) -> [{ value, label }]    the first is the placeholder (value ''), then one per known track, narrowest first: value = the median as text.
//                                          label "Thunderhead, 24 m (21–28)": the median, then the 10th to 90th percentile of what that track's reads measure.
//                                          For a TUBE piece (the tube sweep t = 360) the figures are the distance ROUND the tube, and the entry adds how wide that
//                                          is across: "Thunderhead, 24 m round (21–28), a tube 7.6 m across".
//   tubeNote(w)   -> string                the line under the drop-down for a tube: w is the distance ROUND it (the circumference, u runs −w/2 to +w/2 round the
//                                          ring, src/texture/flow.js), so a tube's width across is w/π.
//   isTube(sweep) -> bool                  the sweep field's value (degrees) says a closed pipe: 360.
//
// A UNIT TRAP (the plan, D232): on the known tracks "width" is the flat road across. In the builder a closed tube's `w` is the CIRCUMFERENCE, so a 31 m tube is
// about 9.9 m across. The reader's width is ray hits left to right (whole metres; FINDINGS §7f lists its biases): a reference, not a rule.
'use strict';
const W = require('../../src/doc/widths.json');

const fmt = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 10) / 10));
const across = (w) => (w / Math.PI).toFixed(1);
const isTube = (sweep) => Number.isFinite(Number(sweep)) && String(sweep).trim() !== '' && Number(sweep) >= 360 - 1e-9;

function label(t, tube) {
  const band = `(${fmt(t.p10_m)}–${fmt(t.p90_m)})`;
  return tube ? `${t.name}, ${fmt(t.median_m)} m round ${band}, a tube ${across(t.median_m)} m across` : `${t.name}, ${fmt(t.median_m)} m ${band}`;
}
function entries(tube = false) {
  return [{ value: '', label: tube ? 'width like… (a tube: metres round)' : 'width like…' }, ...W.tracks.map((t) => ({ value: String(t.median_m), label: label(t, tube) }))];
}
function tubeNote(w) {
  const n = Number(w);
  return `A tube's width is the distance ROUND it, not across.${Number.isFinite(n) && n > 0 ? ` ${fmt(n)} m round is a tube ${across(n)} m across (w/π).` : ''}`;
}

module.exports = { entries, tubeNote, isTube, label, across };
