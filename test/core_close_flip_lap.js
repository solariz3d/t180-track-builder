// A lap end in the FLIPPED frame (2026-10-14, ELYSIUM): up a half loop, rolled upright at the top, turned 180 degrees flat. Its end is physically level,
// upright and facing the way it started, but the channels hold it as heading 180°, pitch 180°, bank −180°: the same frame written the other way.
// The loop's pitch rate and the turn's heading rate are scaled so the net pitch and net heading are exactly 180°. Shared by the close and finish tests.
'use strict';
const D = require('../src/core/document.js'), { extend } = require('../src/core/extend.js'), C = require('../src/core/close.js');
function build(kvTarget, khTarget) {
  let d = extend(D.createDoc('flip'), { length: 300 });
  d = extend(d, { length: 500, targets: { kv: kvTarget } });
  d = extend(d, { length: 60, targets: { kv: 0 } });
  d = extend(d, { length: 200, targets: { phi: -Math.PI } });
  d = extend(d, { length: 600, targets: { kh: khTarget } });
  d = extend(d, { length: 60, targets: { kh: 0 } });
  return d;
}
const netOf = (d) => { const rows = C.netRows(d), net = { kh: rows.khBase, kv: rows.kvBase }; for (const ch of ['kh', 'kv']) for (const [key, w] of rows[ch]) { const [p, i] = key.split(':').map(Number); net[ch] += w * d.pieces[p].channels[ch][i]; } return net; };
const unit = netOf(build(1e-3, 1e-3));   // the nets are linear in the two targets
function flippedLap() { return build(1e-3 * Math.PI / unit.kv, 1e-3 * Math.PI / unit.kh); }
module.exports = { flippedLap, netOf };
