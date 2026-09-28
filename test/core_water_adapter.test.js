// core_water_adapter.test.js: node --test --test-concurrency=4 test/core_water_adapter.test.js
// TEST 5 (B's sealed registration, exo_memory/loop/d185_registration_2026-09-28.md, sha256 978be18b57033d6d) THROUGH THE
// CORE: a closed flat ring built as a core document (src/core/document.js), emitted by A's adapter (src/core/adapter.js
// toPath), and poured by the water (src/core/water.js). While the document or the adapter is not in this checkout, it
// reports SKIPPED, never passed.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const HAVE = ['document.js', 'adapter.js'].every((f) => fs.existsSync(path.join(__dirname, '..', 'src', 'core', f)));
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} (±${tol})`);

const R = 500, V = 70.0357, D0 = [-14, -7, 0, 7, 14];
const T5A = { '-14': [-14, -4.6874], '-7': [-7, -2.3385], 7: [2.3282, 7], 14: [4.6463, 14] };
const T5B = [187.24, 163.02, 134.56, 98.23, 34.72];
function pour(theta, run) {
  const Dc = require('../src/core/document.js'), AD = require('../src/core/adapter.js'), W = require('../src/core/water.js');
  const doc = { ...Dc.appendPiece(Dc.createDoc('ring'), Dc.roadPiece({ length: 2 * Math.PI * R, family: 'flat', channels: { kh: () => 1 / R, kv: () => 0, phi: () => -theta, w: () => 30, r: () => 0 } })), closed: true };
  const { segments, path: p } = AD.toPath(doc);
  return W.pour(W.surfaceFrom({ samples: p.samples, closed: true, lengthM: p.lengthM, profileAt: (m) => segments[m.seg].profile }), { speed: V, streams: D0.map((d) => ({ u: -d })), ...run });
}

test('TEST 5a through the core: the balanced 45° ring, as B sealed it', { skip: HAVE ? false : 'src/core/document.js or adapter.js is not in this checkout' }, () => {
  const r = pour(Math.PI / 4, { laps: 1 });
  assert.deepEqual(r.reds.filter((x) => x.type !== 'shock'), []);
  r.streams.forEach((st, k) => { const d = st.track.u.map((u) => -u);
    assert.equal(st.outcome, 'ran'); assert.ok(Math.min(...st.track.N) > 0);
    if (D0[k] === 0) assert.ok(Math.max(...d.map(Math.abs)) <= 0.10);
    else { close(Math.min(...d), T5A[D0[k]][0], 0.5); close(Math.max(...d), T5A[D0[k]][1], 0.5); }
    assert.ok(st.energy.maxAbsDrift / Math.abs(st.energy.E0) <= 0.005); });
});
test('TEST 5b through the core: the 10° ring spills every stream over the OUTER lip, RED, within ±5% / ±5 m', { skip: HAVE ? false : 'src/core/document.js or adapter.js is not in this checkout' }, () => {
  const r = pour(10 * Math.PI / 180, { distance: 400 });
  r.streams.forEach((st, k) => { assert.equal(st.outcome, 'spill'); close(-st.at.u, 15, 1e-9, 'over the OUTER lip'); close(st.at.s, T5B[k], Math.max(0.05 * T5B[k], 5));
    assert.ok(Math.min(...st.track.N) > 0); assert.ok(r.reds.some((x) => x.type === 'spill' && x.streams[0] === k)); });
});
