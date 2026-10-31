// xsec.js: the CROSS-SECTION channels' names as the app uses them, in ONE place: the edge curve's angle and start,
// and the tube's sweep. The panel, the shell's head state
// and the tests read the core through these names only, so a name the core settles on differently is a one-line change here.
//
//   CHANNEL   the core channel each Extend field targets. `e` and `s` are the core's own names (both are in CHANNELS).
//             The tube's channel is `t`, the core's own symbol for
//             the sweep ("sweep t°"), a stand-in until the core names it.
//   UNITS     e and t are DEGREES (as the cup's c is), s is a SHARE of the half-width.
//   READOUT   the readout keys: edgeFromDeg/edgeToDeg and sliceFrom/sliceTo are the core's; tubeFromDeg/tubeToDeg are a stand-in.
//   DEFAULTS  what a piece without the channel reads: e 0 (off), s 0.64 (the crease), t 0 (no tube). A document from before the
//             lap carries none of them (V3: /1–/3 migrate with e = 0, s = 0.64, no tube).
'use strict';

const CHANNEL = Object.freeze({ edge: 'e', start: 's', tube: 't' });
const READOUT = Object.freeze({ edge: ['edgeFromDeg', 'edgeToDeg'], start: ['sliceFrom', 'sliceTo'], tube: ['tubeFromDeg', 'tubeToDeg'] });
const DEFAULTS = Object.freeze({ edge: 0, start: 0.64, tube: 0 });

/**
 * The head's value of each cross-section channel from D.endState's result (null on an empty track): the channel's `.v`, else the default.
 * THE TUBE: the sweep is the head's only when the head piece IS a tube (`headIsTube`); at any other head the
 * field shows 0 ("none"), as the contract says, whatever the core keeps internally to start a later tube from (endState held
 * t = 2 × the rendered edge, 31 at a bowl's head; from 9f92a324 that value is the INTERNAL key `tNext`, which the app never reads, and t is
 * 0 at a non-tube head). That is the rule the core's own readout uses (src/core/readout.js: `P.tube ? … : 0`).
 */
function headOf(end, headIsTube = false) {
  const out = {};
  for (const [k, ch] of Object.entries(CHANNEL)) {
    const has = end && end[ch] && Number.isFinite(end[ch].v) && (k !== 'tube' || headIsTube);
    out[ch] = has ? end[ch].v : DEFAULTS[k];
  }
  return out;
}

module.exports = { CHANNEL, READOUT, DEFAULTS, headOf };
