// core_bank_flow_unmoved.test.js: node --test test/core_bank_flow_unmoved.test.js
// THE OTHER CALLERS OF extend DO NOT MOVE with the flowing bank (plan: lighthouse exo_memory/loop/plan_t180_smooth_banked_turns_2026-11-24.md, "What must not move",
// item 4). Each row lays a document through one caller (Close, Finish, smoothRamps, and extendCorner with no flowing bank), and its serialized sha256 is the one the
// SAME code gave on t180 main 3b33b38, before the flowing bank (read there on 2026-11-24 by pane O, from this very file run in a worktree of that commit).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const TB = require('../src/core/turnby.js');
const { close } = require('../src/core/close.js');
const F = require('../src/core/finish.js');
const { smoothRamps } = require('../src/core/smoothramps.js');

const DEG = Math.PI / 180;
const sha = (d) => crypto.createHash('sha256').update(D.serialize(d)).digest('hex');
const BASE = {
  close: '524565e01c18ba13a5ff9a846ac35d614cf2daaae89ac640f601157088114097',
  finish: '83bb1548e31e65f29dc2dcdec7f37fc8c4f47252e640f04ef174c5228439697a',
  smoothRamps: '2547d0a6bce09210e39cb57e004bf969253ffbfa0cdff7302b795d3d3e71d745',
  extendCorner: '42464da881bc32c7aa5fe9a741e94458bde28f3f19e86a07b290f08a7daabf7c',
};
/** A straight, then a banked left corner with a rounded bank and a change, then a straight: the pieces every row starts from. */
function banked(name) {
  let d = extend(D.createDoc(name), { length: 300, family: 'bowl' });
  d = TB.extendCorner(d, { length: 400, turnDeg: 100, targets: { phi: 15 * DEG }, transition: { phi: 120 }, bankShape: 'rounded', changes: { phi: [{ from: 250, target: 0 }] } });
  return extend(d, { length: 200 });
}

test('unmoved: Close lays the same bytes as on main 3b33b38', () => {
  let d = banked('close');
  d = TB.extendCorner(d, { length: 700, turnDeg: 130 }); d = extend(d, { length: 300 }); d = TB.extendCorner(d, { length: 700, turnDeg: 130 }); d = extend(d, { length: 200 });
  const r = close(d, { edited: [d.pieces.length - 1] });
  assert.equal(sha(r.doc), BASE.close);
});

test('unmoved: Finish lays the same bytes as on main 3b33b38', () => {
  assert.equal(sha(F.finishToStart(banked('finish')).doc), BASE.finish);
});

test('unmoved: smoothRamps lays the same bytes as on main 3b33b38', () => {
  let d = banked('ramps');
  d = extend(d, { length: 200, targets: { phi: -10 * DEG, w: 30 }, transition: { phi: 60, w: 40 } });
  assert.equal(sha(smoothRamps(d).doc), BASE.smoothRamps);
});

test('unmoved: extendCorner with no flowing bank (two corners, a swell bank, a second bank) lays the same bytes as on main 3b33b38', () => {
  const d = TB.extendCorner(extend(D.createDoc('corner'), { length: 300, family: 'bowl' }), { length: 400, turnDeg: 0, changes: { turnDeg: [{ from: 100, deg: 70 }, { from: 250, deg: -60 }] },
    targets: { phi: 12 * DEG }, transition: { phi: 150 }, bankShape: 'swell', second: { phi: { from: 250, target: -8 * DEG } } });
  assert.equal(sha(d), BASE.extendCorner);
});
