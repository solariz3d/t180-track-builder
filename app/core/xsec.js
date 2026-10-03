// xsec.js: the CROSS-SECTION channels' names as the app uses them (lap D225, pane C), in ONE place: the edge curve's angle and start,
// and the tube's sweep (E's seal, cross_section_seal_registration_2026-10-03.md, V3/V4/E4/E7/T1). The panel, the shell's head state
// and the tests read the core through these names only, so a name A's core settles on differently is a one-line change here.
//
//   CHANNEL   the core channel each Extend field targets. `e` and `s` are the seal's own names (V3: "channels `e` and `s`", E4: "`e` and
//             `s` are in CHANNELS"). The tube's channel is NOT named in the seal ("the tube's channel"); `t` is the seal's own symbol for
//             the sweep (§1: "sweep t°"), a stand-in until A names it.
//   UNITS     e and t are DEGREES (as the cup's c is: D190), s is a SHARE of the half-width.
//   READOUT   the readout keys: edgeFromDeg/edgeToDeg and sliceFrom/sliceTo are the seal's (E7); tubeFromDeg/tubeToDeg are a stand-in.
//   DEFAULTS  what a piece without the channel reads: e 0 (off), s 0.64 (V4, C's crease), t 0 (no tube). A document from before the
//             lap carries none of them (V3: /1–/3 migrate with e = 0, s = 0.64, no tube).
'use strict';

const CHANNEL = Object.freeze({ edge: 'e', start: 's', tube: 't' });
const READOUT = Object.freeze({ edge: ['edgeFromDeg', 'edgeToDeg'], start: ['sliceFrom', 'sliceTo'], tube: ['tubeFromDeg', 'tubeToDeg'] });
const DEFAULTS = Object.freeze({ edge: 0, start: 0.64, tube: 0 });

/** The head's value of each cross-section channel from D.endState's result (null on an empty track): the channel's `.v`, else the default. */
function headOf(end) {
  const out = {};
  for (const [k, ch] of Object.entries(CHANNEL)) out[ch] = end && end[ch] && Number.isFinite(end[ch].v) ? end[ch].v : DEFAULTS[k];
  return out;
}

module.exports = { CHANNEL, READOUT, DEFAULTS, headOf };
