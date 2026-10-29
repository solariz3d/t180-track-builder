// core-bankswing.test.js: node --test app/test/core-bankswing.test.js
// Bank the bend in the app: the shell's preview, Apply and Cancel (app/core/coreshell.js proposeBankSwing, applyBankSwing, cancelBankSwing) over the core's swingBank
// (src/core/bankswing.js, tested on its own in test/core_bankswing.test.js). Rows:
//   1  a preview leaves the track as it is and quotes the roll rate; Apply copies the track to its backups first, then banks as ONE undo step; Undo gives it back
//   2  the preview drops when the track changes under it (an Extend, an Undo) and when the selection changes; Cancel drops it
//   3  a stretch the core refuses (a jump inside it) says the core's own words and previews nothing
//   4  a run that ends in a jump: a sane stretch or the core's words, never NaN (the shell read a flight's length, which it has none of)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const D = require('../../src/core/document.js');
const SC = require('../../src/core/sculpt.js');
const BS = require('../../src/core/bankswing.js');

const DEG = Math.PI / 180;
function store({ backupFails = false } = {}) {
  const st = { backups: [] };
  return Object.assign(st, { backupDoc: async (name, text) => { if (backupFails) throw new Error('the disk is full'); st.backups.push({ name, text }); return `${name}.bak`; } });
}
/** An open track of three 100 m road pieces, no bank, the middle one selected. */
async function three(st = store()) {
  const s = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 });
  for (let i = 0; i < 3; i++) s.extend({ length: 100, family: 'bowl' });
  s.selectPiece(1);
  return s;
}
const present = (s) => s.getState().history.present;
const phiAt = (d, x) => { const off = SC.pieceOffsets(d), i = d.pieces.findIndex((P, k) => x >= off[k] && x <= off[k] + P.length); return D.channelAt(d.pieces[i], 'phi', x - off[i]).v / DEG; };

test('a preview changes nothing and gives the roll rate; Apply backs up first and is one undo step', async () => {
  const st = store(), s = await three(st), before = present(s), n = s.getState().history.past.length;
  s.proposeBankSwing({ peakDeg: 30, peakAt: 0.5, leadIn: 80, runOut: 80 });
  const p = s.getState().bankProposal;
  assert.ok(p, s.getState().message);
  assert.equal(present(s), before, 'the preview leaves the track as it is');
  assert.deepEqual([p.s0, p.peakS, p.s1], [20, 150, 280], 'the run 100-200 m with 80 m either side, the peak at its middle');
  assert.match(s.getState().message, /peak roll \d+\.\d\d °\/m; amber above 0\.93, red above 1\.21/);
  assert.ok(Math.abs(phiAt(p.doc, 150) - 30) < 1, `the proposal banks about 30° at the peak (${phiAt(p.doc, 150)})`);
  await s.applyBankSwing();
  assert.equal(s.getState().history.past.length, n + 1, 'one undo step');
  assert.equal(present(s), p.doc, 'the track is the one previewed');
  assert.equal(s.getState().bankProposal, null);
  assert.equal(st.backups.length, 1, 'one copy of the track written first');
  assert.equal(D.parse(st.backups[0].text).pieces[1].channels.phi.every((v) => v === 0), true, 'the copy is the track from before');
  for (let i = 0; i < 3; i++) for (const ch of ['kh', 'kv', 'w']) assert.deepEqual(present(s).pieces[i].channels[ch], before.pieces[i].channels[ch], `piece ${i} ${ch} unchanged`);
  s.undo();
  assert.equal(present(s), before, 'Undo gives the track back');
});

test('a copy that cannot be written refuses Apply by name, with nothing changed', async () => {
  const s = await three(store({ backupFails: true })), before = present(s);
  s.proposeBankSwing({ peakDeg: 30 });
  await s.applyBankSwing();
  assert.equal(present(s), before);
  assert.match(s.getState().message, /^not banked: the copy from before could not be written \(the disk is full\); nothing changed$/);
});

test('the preview drops when the track or the selection changes, and on Cancel', async () => {
  const s = await three();
  s.proposeBankSwing({ peakDeg: 30 }); assert.ok(s.getState().bankProposal);
  s.extend({ length: 100, family: 'bowl' }); assert.equal(s.getState().bankProposal, null, 'an Extend drops it');
  s.selectPiece(1); s.proposeBankSwing({ peakDeg: 30 }); assert.ok(s.getState().bankProposal);
  s.undo(); assert.equal(s.getState().bankProposal, null, 'an Undo drops it');
  s.selectPiece(1); s.proposeBankSwing({ peakDeg: 30 }); s.selectPiece(0); assert.equal(s.getState().bankProposal, null, 'a new selection drops it');
  s.selectPiece(1); s.proposeBankSwing({ peakDeg: 30 }); s.cancelBankSwing(); assert.equal(s.getState().bankProposal, null, 'Cancel drops it');
  const p = present(s); await s.applyBankSwing(); assert.equal(present(s), p, 'Apply with nothing previewed changes nothing');
});

test('a stretch the core refuses says the core\'s words and previews nothing', async () => {
  const s = await createCoreShell({ brushFn: null, storage: store(), autosaveMs: 0 });
  s.extend({ length: 100, family: 'bowl' }); s.jump(null); s.extend({ length: 100, family: 'bowl' });
  const d = present(s), last = d.pieces.length - 1;
  assert.ok(d.pieces.some((P) => P.type !== 'road'), 'the track has a jump');
  s.selectPiece(last); s.proposeBankSwing({ peakDeg: 20, leadIn: 300, runOut: 0 });
  const off = SC.pieceOffsets(d), r0 = off[last], r1 = r0 + d.pieces[last].length;
  let words = null; try { BS.swingBank(d, { s0: Math.max(0, r0 - 300), s1: r1, peakS: (r0 + r1) / 2, peakDeg: 20, exitDeg: null, shape: 'rounded' }); } catch (e) { words = e.message; }
  assert.ok(words, 'the core refuses a stretch with a jump inside');
  assert.equal(s.getState().bankProposal, null);
  assert.equal(s.getState().message, words);
});

test('a run that ends in a jump either previews over a sane stretch or refuses in the core\'s words, never with NaN', async () => {
  const s = await createCoreShell({ brushFn: null, storage: store(), autosaveMs: 0 });
  s.extend({ length: 100, family: 'bowl' }); s.extend({ length: 100, family: 'bowl' }); s.jump(null);
  const d = present(s), fi = d.pieces.findIndex((P) => P.type !== 'road');
  assert.ok(fi > 0, 'the track has a flight');
  s.selectPiece(0); s.selectPiece(fi, { extend: true }); s.proposeBankSwing({ peakDeg: 20 });
  const msg = s.getState().message || '', p = s.getState().bankProposal;
  assert.doesNotMatch(msg, /NaN/, `no NaN in the words: ${msg}`);
  if (p) assert.ok([p.s0, p.s1, p.peakS].every(Number.isFinite) && p.s0 < p.peakS && p.peakS < p.s1, `a sane stretch: ${p.s0}, ${p.peakS}, ${p.s1}`);
  else assert.match(msg, /^[A-Z_]+: /, `refused in the core's own words: ${msg}`);
});
