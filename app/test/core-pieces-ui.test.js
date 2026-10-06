// core-pieces-ui.test.js: node --test app/test/core-pieces-ui.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D240, THE UI HALF OF SAVED PIECES (the core is src/core/piece.js, tested by test/core_piece.test.js; this is the app: app/core/coreshell.js, piecesui.js, selectionlayer.js, the
// preview's proposal ghost, and the native side's file commands through a storage in memory). FEEL tier: targeted rows, no mutation harness (the keeper's 09-29 rule). Rows:
//   1   select: a piece, a shift-click run (the first piece selected stays the anchor), out of range refused, any change of the document drops the selection
//   2   Save as piece: what is stored is exactly the core's text; a name already used is refused and the stored one is untouched; a bad name and a mixed run are refused by name
//   3   the library: name, length, turn, climb, thumbnail; an unreadable file and a whole track are LISTED with the reason, not hidden
//   4   Add at head: the core's insert, one undo step, mirrored on request; refused by name on a closed track or a missing or damaged file, with nothing changed
//   5   THE REQUIRED CHECK carried to the app: a track built by saving a run and adding it back through the shell is the same document and exports the SAME BYTES as the hand-built one
//   6   rename (the new name must be free; the file's own name changes) and delete of a saved piece
//   7   delete at the open end: simple, one undo step; a closed track refuses by name
//   8   delete in the MIDDLE is PREVIEWED: nothing changes until Apply; per-piece displacement; the overlap check; the backup is written first and a failed one refuses; one undo step;
//       Cancel; a stale preview is dropped; a join the core refuses (DELETE_REJOIN) shows no preview
//   9   the preview shows the delete's proposal as a ghost; the selection's highlight lands where the preview's own pick says the piece is
//  10   the panel, on a fake DOM: click and shift-click select (a drag and an armed brush do not), Save as piece, the list, Add at head with Mirror, Rename, Delete with its confirm,
//       the delete preview's words, Apply and Cancel
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createCoreShell, thumbOf } = require('../core/coreshell.js');
const D = require('../../src/core/document.js');
const PC = require('../../src/core/piece.js');
const { extend } = require('../../src/core/extend.js');
const { close } = require('../../src/core/close.js');
const AD = require('../../src/core/adapter.js');
const SL = require('../core/selectionlayer.js');
const PU = require('../core/piecesui.js');
const P = require('../preview/preview.js');
const { makeExporter } = require('../export/export.js');

const REPO = path.resolve(__dirname, '..', '..'), get = async (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const R = 180, Q = (Math.PI * R) / 2, TURN = 1 / R, DEG = Math.PI / 180;

/** The native side's storage, in memory: the pieces folder (a name already used is refused, as the native save is), the backups, the tracks. */
function store({ failBackup = false, caseBlind = false } = {}) {   // caseBlind: Windows names ("Run" and "run" are one file)
  const st = { pieces: new Map(), backups: [], log: [], failSave: null };
  const find = (n) => (caseBlind ? [...st.pieces.keys()].find((k) => k.toLowerCase() === n.toLowerCase()) : (st.pieces.has(n) ? n : undefined));
  return Object.assign(st, {
    listPieces: async () => [...st.pieces.keys()].sort(),
    openPiece: async (n) => { const k = find(n); if (k === undefined) throw new Error(`could not read the piece "${n}": not found`); return st.pieces.get(k); },
    savePiece: async (n, t) => { if (st.failSave && st.failSave(n)) throw new Error('disk full'); if (find(n) !== undefined) throw new Error(`a piece named "${n}" already exists; delete it first or use another name`); st.pieces.set(n, t); },
    deletePiece: async (n) => { const k = find(n); if (k === undefined) throw new Error(`could not delete the piece "${n}": not found`); st.pieces.delete(k); },
    backupDoc: async (name, text) => { if (failBackup) throw new Error('disk full'); st.backups.push({ name, text }); st.log.push('backup'); return `${name}.2026-10-05_120000.t180track`; },
  });
}
/** An open track of five pieces: a straight, two turns, a straight, a short straight. */
async function track(st = store(), opts = {}) {
  const s = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0, ...opts });
  s.extend({ length: 300, family: 'bowl' }); s.extend({ length: 150, transition: 60, targets: { kh: TURN } }); s.extend({ length: 150, transition: 60, targets: { kh: TURN } });
  s.extend({ length: 100, transition: 60, targets: { kh: 0 } }); s.extend({ length: 80 });
  assert.equal(s.getState().message, null, s.getState().message); assert.equal(s.getState().history.present.pieces.length, 5);
  return s;
}
/** A closed legacy lap whose pieces are the core's own adjusted ones (as test/core_piece.test.js). */
function lap() {
  let d = extend(D.createDoc('app lap'), { length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: TURN } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}
const tick = () => new Promise((r) => setImmediate(r));

test('row 1: select a piece, shift-click a run (the first piece selected stays the anchor), an out-of-range piece is refused, and any change of the document drops the selection', async () => {
  const s = await track();
  assert.equal(s.selectionInfo(), null);
  s.selectPiece(1); assert.deepEqual({ ...s.selectionInfo(), ids: [...s.selectionInfo().ids] }, { from: 1, to: 1, count: 1, ids: ['p2'], lengthM: 150, atEnd: false, closed: false, saveProblem: null });
  s.selectPiece(3, { extend: true }); let i = s.selectionInfo(); assert.deepEqual([i.from, i.to, i.count, i.lengthM], [1, 3, 3, 400]);
  s.selectPiece(0, { extend: true }); i = s.selectionInfo(); assert.deepEqual([i.from, i.to], [0, 1], 'the anchor is still piece 1, so the run goes up to piece 0');
  s.selectPiece(2, { extend: true }); i = s.selectionInfo(); assert.deepEqual([i.from, i.to], [1, 2]);
  s.selectPiece(4); assert.equal(s.selectionInfo().atEnd, true, 'the last piece is at the end of the track');
  s.selectPiece(0, { extend: true }); assert.deepEqual([s.selectionInfo().from, s.selectionInfo().to], [0, 4]);
  s.selectPiece(1, { extend: false }); s.selectPiece(9); assert.match(s.getState().message, /there is no piece 9: the track has pieces 0 to 4/); assert.equal(s.selectionInfo().from, 1, 'the selection stands');
  s.selectPiece(1); s.extend({ length: 20 }); assert.equal(s.selectionInfo(), null, 'an Extend drops it');
  s.selectPiece(1); s.undo(); assert.equal(s.getState().selection, null, 'an Undo drops it');
  s.selectPiece(1); s.adopt(lap()); assert.equal(s.getState().selection, null, 'opening another track drops it'); s.selectPiece(1); s.clearSelection(); assert.equal(s.selectionInfo(), null);
});

test('row 2: Save as piece stores exactly the core\'s text; a name already used is refused and the stored piece untouched; a bad name and a mixed run are refused by name', async () => {
  const st = store(), s = await track(st), d = s.getState().history.present;
  await s.savePiece('x'); assert.match(s.getState().message, /select the pieces to keep first/); assert.equal(st.pieces.size, 0);
  s.selectPiece(1); s.selectPiece(2, { extend: true });
  const stamp = s.getState().libraryStamp; await s.savePiece('two turns');
  assert.equal(s.getState().messageKind, 'ok', s.getState().message); assert.match(s.getState().message, /saved the piece "two turns": 2 pieces/);
  assert.equal(st.pieces.get('two turns'), PC.serialize(PC.saveRun(d, 1, 2, { name: 'two turns' })), 'the file is the core\'s canonical text');
  assert.equal(s.getState().libraryStamp, stamp + 1);
  const was = st.pieces.get('two turns'); await s.savePiece('two turns'); assert.match(s.getState().message, /the piece was not saved: a piece named "two turns" already exists/); assert.equal(st.pieces.get('two turns'), was); assert.equal(s.getState().libraryStamp, stamp + 1);
  for (const bad of ['', '../x', 'a/b', 'x'.repeat(61)]) { await s.savePiece(bad); assert.match(s.getState().message, /BAD_PIECE_NAME/, JSON.stringify(bad)); }
  assert.equal(st.pieces.size, 1);
  // a run that is not one cross-section is refused at the selection and at the save, with the reason
  const t = await track(); t.extend({ length: 100, transition: 40, targets: { c: 30 } }); t.selectPiece(4); t.selectPiece(5, { extend: true });
  assert.match(t.selectionInfo().saveProblem, /MIXED_RUN/); await t.savePiece('mixed'); assert.match(t.getState().message, /MIXED_RUN/);
  t.selectPiece(5); assert.equal(t.selectionInfo().saveProblem, null, 'the cup piece alone is a run of one kind');
});

test('row 3: the library lists name, length, turn, climb and a thumbnail; an unreadable file and a whole track are LISTED with the reason', async () => {
  const st = store(), s = await track(st);
  assert.deepEqual(await s.listPieces(), [], 'nothing saved yet');
  s.selectPiece(1); s.selectPiece(2, { extend: true }); await s.savePiece('b turns'); s.selectPiece(0); await s.savePiece('a straight');
  st.pieces.set('c broken', '{ not json'); st.pieces.set('d whole track', D.serialize(s.getState().history.present));
  const list = await s.listPieces();
  assert.deepEqual(list.map((x) => x.name), ['a straight', 'b turns', 'c broken', 'd whole track'], 'sorted by name');
  const [a, b, c, w] = list;
  assert.deepEqual(a.summary, PC.summary(PC.parse(st.pieces.get('a straight')))); assert.equal(a.summary.lengthM, 300); assert.equal(a.summary.turnDeg, 0);
  assert.ok(Math.abs(b.summary.turnDeg - (300 - 30) / R / DEG) < 0.5 && b.summary.lengthM === 300 && b.summary.pieces === 2, `two 150 m turns reaching ${TURN} rad/m: ${b.summary.turnDeg}°`);
  for (const x of [a, b]) { assert.ok(x.thumb.points.length >= 2 && x.thumb.points.length <= 48 + 1); assert.ok(x.thumb.points.every(([px, py]) => px >= 0 && px <= 100 && py >= 0 && py <= 60), 'inside the 100 x 60 box'); }
  assert.ok(b.thumb.points[b.thumb.points.length - 1][1] !== b.thumb.points[0][1], 'a turn is not drawn as a line');
  assert.match(c.error, /BAD_PIECE_JSON/); assert.equal(c.summary, null); assert.match(w.error, /BAD_PIECE_SCHEMA/);
  assert.match(PU.describe(a), /^1 piece · 300 m · turn 0\.0° · climb 0\.0° · plain$/); assert.match(PU.describe(b), /^2 pieces · 300 m · turn \+\d+\.\d° · climb 0\.0° · plain$/); assert.match(PU.describe(c), /^cannot be used: BAD_PIECE_JSON/);
  assert.equal(thumbOf(PC.parse(st.pieces.get('a straight'))).points.length >= 2, true);
});

test('row 4: Add at head is the core\'s insert as ONE undo step, mirrored on request; closed, missing and damaged are refused by name with nothing changed', async () => {
  const st = store(), a = await track(st); a.selectPiece(1); a.selectPiece(2, { extend: true }); await a.savePiece('bend');
  const b = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 }); b.extend({ length: 200, family: 'bowl' });
  const before = b.getState().history.present, piece = PC.parse(st.pieces.get('bend'));
  await b.insertPiece('bend'); assert.equal(b.getState().messageKind, 'ok', b.getState().message); assert.match(b.getState().message, /added the piece "bend" at the head: 2 pieces/);
  assert.deepEqual(b.getState().history.present, PC.insert(before, piece)); assert.equal(b.getState().history.past.length, 2, 'one undo step');
  b.undo(); assert.equal(b.getState().history.present, before, 'Undo gives the track back');
  await b.insertPiece('bend', { mirror: true }); const m = b.getState().history.present;
  assert.deepEqual(m, PC.insert(before, piece, { mirror: true })); const plain = PC.insert(before, piece); assert.deepEqual(m.pieces.slice(1).map((x) => x.channels.kh), plain.pieces.slice(1).map((x) => x.channels.kh.map((v) => (v === 0 ? 0 : -v))), 'the turn is flipped');
  assert.match(b.getState().message, /mirrored/);
  const keep = b.getState().history.present, n = b.getState().history.past.length;
  await b.insertPiece('nope'); assert.match(b.getState().message, /could not open the piece "nope"/); st.pieces.set('damaged', '{ no'); await b.insertPiece('damaged'); assert.match(b.getState().message, /BAD_PIECE_JSON/);
  assert.equal(b.getState().history.present, keep); assert.equal(b.getState().history.past.length, n);
  const c = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 }); c.adopt(lap()); const cd = c.getState().history.present; await c.insertPiece('bend');
  assert.match(c.getState().message, /CLOSED/); assert.equal(c.getState().history.present, cd);
});

test('row 5 (REQUIRED, through the app): a track built by saving a run and adding it back through the shell is the SAME DOCUMENT and exports the SAME BYTES', async () => {
  const H = lap(), st = store(), ex = await makeExporter(get);
  const a = await createCoreShell({ brushFn: null, storage: st, exporter: ex, autosaveMs: 0 }); a.adopt(H);
  const want = a.buildExport({}).folders;
  a.selectPiece(1); a.selectPiece(H.pieces.length - 1, { extend: true }); await a.savePiece('rest of the lap'); assert.equal(a.getState().messageKind, 'ok', a.getState().message);
  const b = await createCoreShell({ brushFn: null, storage: st, exporter: ex, autosaveMs: 0 }); b.adopt({ ...H, pieces: H.pieces.slice(0, 1), nextId: 2, closed: false });
  await b.insertPiece('rest of the lap'); assert.equal(b.getState().messageKind, 'ok', b.getState().message);
  b.commitDoc({ ...b.getState().history.present, closed: true, name: H.name }); assert.equal(b.getState().message, null, b.getState().message);
  assert.equal(D.serialize(b.getState().history.present), D.serialize(H), 'the same document text');
  const got = b.buildExport({}).folders, strip = (fl) => fl.flatMap((f) => f.files).filter((f) => f.path !== '.t180b-builder.json');   // that stamp carries the time it was made
  assert.deepEqual(got.map((f) => f.folder), want.map((f) => f.folder)); assert.equal(strip(got).length, strip(want).length); assert.ok(strip(want).length > 3, 'a real export came out');
  strip(want).forEach((f, k) => assert.ok(Buffer.from(f.bytes).equals(Buffer.from(strip(got)[k].bytes)), `${f.path} is the same bytes`));
});

test('row 6: rename (the new name must be free; the file\'s own name changes) and delete of a saved piece', async () => {
  const st = store(), s = await track(st); s.selectPiece(0); await s.savePiece('one'); s.selectPiece(1); await s.savePiece('two');
  await s.renamePiece('one', 'uno'); assert.equal(s.getState().messageKind, 'ok', s.getState().message); assert.deepEqual(await st.listPieces(), ['two', 'uno']); assert.equal(PC.parse(st.pieces.get('uno')).name, 'uno');
  const two = st.pieces.get('two'); await s.renamePiece('uno', 'two'); assert.match(s.getState().message, /not renamed: a piece named "two" already exists/); assert.deepEqual(await st.listPieces(), ['two', 'uno']); assert.equal(st.pieces.get('two'), two);
  await s.renamePiece('uno', '../x'); assert.match(s.getState().message, /could not rename|BAD_PIECE_NAME|not renamed/); assert.deepEqual(await st.listPieces(), ['two', 'uno']);
  await s.renamePiece('ghost', 'x'); assert.match(s.getState().message, /could not rename the piece "ghost"/);
  const stamp = s.getState().libraryStamp; await s.deletePieceFile('uno'); assert.deepEqual(await st.listPieces(), ['two']); assert.equal(s.getState().libraryStamp, stamp + 1); assert.equal(s.getState().history.present.pieces.length, 5, 'the track is untouched');
  await s.deletePieceFile('uno'); assert.match(s.getState().message, /the piece was not deleted/);
});

test('row 6b: a CASE-ONLY rename (Run to run) works where names are case-blind (C, look F2), on a case-sensitive store too, and a failure on the way never loses the piece', async () => {
  for (const caseBlind of [true, false]) {
    const st = store({ caseBlind }), s = await track(st); s.selectPiece(0); await s.savePiece('Run'); const was = st.pieces.get('Run');
    await s.renamePiece('Run', 'run'); assert.equal(s.getState().messageKind, 'ok', s.getState().message); assert.match(s.getState().message, /renamed the piece "Run" to "run"/);
    assert.deepEqual(await st.listPieces(), ['run'], `only the new name is left (case-blind ${caseBlind}), no temporary copy`); assert.equal(PC.parse(st.pieces.get('run')).name, 'run', 'the own name field of the file changed');
    assert.deepEqual({ ...PC.parse(st.pieces.get('run')), name: 'Run' }, PC.parse(was), 'and nothing else changed');
    s.selectPiece(1); await s.savePiece('Other'); await s.renamePiece('run', 'Other'); assert.match(s.getState().message, /not renamed: a piece named "Other" already exists/); assert.deepEqual(await st.listPieces(), ['Other', 'run'], 'a different name that is taken is still refused');
    // the last write fails: the old piece is put back as it was, and no temporary copy is left
    const text = st.pieces.get('run'); st.failSave = (n) => n === 'RUN'; await s.renamePiece('run', 'RUN');
    assert.match(s.getState().message, /not renamed: disk full; the piece is as it was/); assert.deepEqual(await st.listPieces(), ['Other', 'run']); assert.equal(st.pieces.get('run'), text);
    // the temporary copy cannot be written: nothing changed at all
    st.failSave = (n) => n === 'Run-r'; await s.renamePiece('run', 'Run'); assert.match(s.getState().message, /not renamed: disk full/); assert.deepEqual(await st.listPieces(), ['Other', 'run']);
    st.failSave = null;
  }
});

test('row 7: delete at the open end is simple (one undo step, ids kept); a closed track refuses by name', async () => {
  const s = await track(), d = s.getState().history.present;
  s.deleteSelection(); assert.match(s.getState().message, /select the pieces to delete first/);
  s.selectPiece(3); s.selectPiece(4, { extend: true }); s.deleteSelection();
  const e = s.getState().history.present; assert.equal(s.getState().deleteProposal, null, 'at the end there is no preview'); assert.equal(e.pieces.length, 3); assert.deepEqual(e.pieces, d.pieces.slice(0, 3)); assert.equal(e.nextId, d.nextId, 'an id is never reused');
  assert.match(s.getState().message, /deleted 2 pieces at the end of the track \(Ctrl\+Z puts them back\)/); assert.equal(s.getState().selection, null);
  s.undo(); assert.equal(s.getState().history.present, d, 'one Undo gives all of it back');
  s.selectPiece(4); s.deleteSelection(); assert.match(s.getState().message, /deleted 1 piece at the end/); s.undo();
  s.selectPiece(0); s.selectPiece(4, { extend: true }); s.deleteSelection(); assert.equal(s.getState().history.present.pieces.length, 0, 'every piece can go'); s.undo();
  const c = await createCoreShell({ brushFn: null, autosaveMs: 0 }); c.adopt(lap()); const cd = c.getState().history.present;
  c.selectPiece(c.getState().history.present.pieces.length - 1); c.deleteSelection(); assert.match(c.getState().message, /CLOSED/); assert.equal(c.getState().history.present, cd);
  c.selectPiece(1); c.deleteSelection(); assert.match(c.getState().message, /CLOSED/); assert.equal(c.getState().deleteProposal, null);
});

test('row 8: delete in the MIDDLE is previewed (displacement, overlap check); Apply writes the backup FIRST and is one undo step; a failed copy refuses; Cancel, a stale preview, and DELETE_REJOIN', async () => {
  const st = store(), s = await track(st), base = s.getState().history.present, pastBefore = s.getState().history.past.length;
  s.selectPiece(1); s.deleteSelection();
  const p = s.getState().deleteProposal; assert.ok(p, s.getState().message);
  assert.equal(s.getState().history.present, base, 'a preview changes nothing'); assert.equal(s.getState().history.past.length, pastBefore); assert.equal(st.backups.length, 0, 'and writes nothing');
  assert.deepEqual([...p.removed], ['p2']); assert.deepEqual([p.from, p.to], [1, 1]);
  const byId = Object.fromEntries(p.displacement.map((x) => [x.id, x.maxM]));
  assert.equal(byId.p1, 0, 'the piece before the gap does not move'); assert.deepEqual(Object.keys(byId), ['p1', 'p3', 'p4', 'p5'], 'the pieces still in the track, in order');
  assert.ok(byId.p3 > 50 && byId.p4 > 50 && byId.p5 > 50, `the far side moves along: ${JSON.stringify(byId)}`);
  // independent check: the end of the last piece moved by (at most) its station-wise maximum, and at least the distance between the two end points
  const end = (d) => { const smp = AD.toPath({ ...d, closed: false }).path.samples; return smp[smp.length - 1].pos; };
  const gap = Math.hypot(...[0, 1, 2].map((k) => end(p.doc)[k] - end(base)[k])); assert.ok(byId.p5 >= gap - 1e-6 && gap > 50, `the end moved ${gap} m and the piece's maximum is ${byId.p5}`);
  assert.ok(Array.isArray(p.check.overlaps) && Array.isArray(p.check.others), 'the overlap check ran'); assert.equal(p.check.overlaps.length, 0, 'this track does not run into itself'); assert.match(s.getState().message, /delete preview: 1 piece goes; 3 of the 3 pieces after the gap move\. Apply or cancel/);
  assert.deepEqual(p.doc.pieces.map((x) => x.id), ['p1', 'p3', 'p4', 'p5'], 'the other pieces keep their ids');
  // Apply: the copy of the track AS IT IS NOW first, then ONE undo step
  s.subscribe((x) => { if (x.history.present !== base && !st.log.includes('commit')) st.log.push('commit'); });
  await s.applyDelete(); assert.deepEqual(st.log, ['backup', 'commit'], 'the backup came first'); assert.deepEqual([st.backups[0].name, st.backups[0].text], ['eq-unsaved', D.serialize(base)]);
  assert.equal(s.getState().history.present, p.doc); assert.equal(s.getState().history.past.length, pastBefore + 1); assert.equal(s.getState().deleteProposal, null); assert.equal(s.getState().selection, null); assert.match(s.getState().message, /deleted 1 piece from the middle of the track/);
  s.undo(); assert.equal(s.getState().history.present, base, 'one Undo gives the track back');
  // a copy that fails refuses the delete by name; nothing changes and the preview stays
  const f = await track(store({ failBackup: true })), fb = f.getState().history.present; f.selectPiece(2); f.deleteSelection(); await f.applyDelete();
  assert.equal(f.getState().history.present, fb); assert.match(f.getState().message, /not deleted: the copy from before the delete could not be written \(disk full\); nothing changed/); assert.ok(f.getState().deleteProposal, 'the preview is still there to retry or cancel');
  // Cancel; an edit drops a stale preview; Apply with none says so; a new selection drops it
  s.selectPiece(1); s.deleteSelection(); s.cancelDelete(); assert.equal(s.getState().deleteProposal, null); assert.equal(s.getState().history.present, base);
  s.deleteSelection(); s.extend({ length: 20 }); assert.equal(s.getState().deleteProposal, null, 'an edit drops it'); await s.applyDelete(); assert.match(s.getState().message, /nothing to apply/); s.undo();
  s.selectPiece(1); s.deleteSelection(); s.selectPiece(2); assert.equal(s.getState().deleteProposal, null, 'another selection drops it');
  // an edit while the copy is being written: the stale delete is never committed over it
  const u = await track(); let release; u.backupNow = () => new Promise((r) => { release = r; }); u.selectPiece(1); u.deleteSelection(); const pending = u.applyDelete(); u.extend({ length: 20 }); const ub = u.getState().history.present; release(null); await pending;
  assert.equal(u.getState().history.present, ub); assert.match(u.getState().message, /changed while its copy was being written/);
  // a join the core refuses is DELETE_REJOIN: no preview, nothing changed (the jump would be first)
  const j = await createCoreShell({ brushFn: null, autosaveMs: 0 }); j.extend({ length: 200, family: 'bowl' }); j.extend({ length: 100, transition: 40, targets: { kh: 1 / 300 } });
  j.commitDoc(D.appendPiece(j.getState().history.present, D.flightPiece({ gap: 25, drop: 1, land: -2 * DEG }))); j.extend({ length: 150 });
  const jd = j.getState().history.present; j.selectPiece(0); j.selectPiece(1, { extend: true }); j.deleteSelection();
  assert.match(j.getState().message, /DELETE_REJOIN/); assert.equal(j.getState().deleteProposal, null); assert.equal(j.getState().history.present, jd);
});

test('row 8b: the delete preview\'s overlap check finds a road running into itself (a two-circle coil, as TEST 1 stacked) and reports where', async () => {
  const s = await createCoreShell({ brushFn: null, autosaveMs: 0 });
  s.extend({ length: 300, family: 'bowl' }); for (let i = 0; i < 8; i++) s.extend({ length: Q, transition: 40, targets: { kh: TURN } }); s.extend({ length: 60, transition: 40, targets: { kh: 0 } });
  s.selectPiece(1); s.deleteSelection();   // one quarter of the coil goes: three of the eight remain, so it does not overlap...
  const a = s.getState().deleteProposal; assert.ok(a, s.getState().message);
  s.cancelDelete(); s.selectPiece(0); s.deleteSelection(); const b = s.getState().deleteProposal; assert.ok(b, s.getState().message);   // ...and the straight at the start going leaves both circles
  assert.ok(b.check.overlaps.length > 0, 'the two circles on one another overlap'); assert.match(s.getState().message, /the track OVERLAPS ITSELF in \d+ place/);
  assert.ok(a.check.overlaps.length > 0, 'seven quarter turns still overlap: the check reports it for any delete that leaves the coil');
  const RG = require('../validate-ui/redgroups.js'), g = RG.groupReds(b.check.overlaps, b.resolved.segments); assert.equal(g[0].key, 'overlap'); assert.ok(g[0].items.every((it) => /^p\d+$/.test(it.piece)), 'each place names its piece');
});

function headlessPreview(s) {
  let q = [], now = 0;
  const win = { devicePixelRatio: 1, document: { hidden: false, activeElement: null, body: {}, addEventListener() {}, removeEventListener() {} }, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (fn) => { q.push(fn); return q.length; }, cancelAnimationFrame() {}, setTimeout: () => 0, clearTimeout() {} };
  const gl = new Proxy({ getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), getUniformLocation: (p, n) => n, getAttribLocation: () => 0 }, { get: (t, k) => (k in t ? t[k] : () => 0) });
  const canvas = { clientWidth: 800, clientHeight: 500, width: 0, height: 0, getContext: () => gl, addEventListener() {}, removeEventListener() {} };
  const pv = P.createPreview({ canvas, shell: s, win });
  pv.step = () => { const f = q; q = []; now += 16; for (const g of f) g(now); };
  return pv;
}
test('row 9: the preview shows a delete\'s proposal as a ghost (dropped on Cancel and on Apply), and the selection highlight lands where the preview\'s own pick says the piece is', async () => {
  const s = await track(), pv = headlessPreview(s);
  assert.equal(pv.view().ghost, 0); s.selectPiece(1); s.deleteSelection(); assert.ok(s.getState().deleteProposal, s.getState().message); assert.ok(pv.view().ghost > 0, 'the delete preview is drawn as a ghost');
  s.cancelDelete(); assert.equal(pv.view().ghost, 0, 'Cancel drops the ghost'); s.deleteSelection(); assert.ok(pv.view().ghost > 0); await s.applyDelete(); assert.equal(pv.view().ghost, 0, 'Apply drops it');
  // the highlight: project the selected piece (the preview's own pose and track), then ask the preview's own pick what is under its middle: it is that piece
  s.undo(); pv.focus(450); pv.step(); pv.step(); pv.step(); s.selectPiece(1);
  const v = pv.view(), track2 = pv.track(), ids = s.selectionInfo().ids, lines = SL.selectionLines(track2, ids, v.pose, 800, 500);
  assert.ok(lines.length >= 1 && lines.every((l) => l.id === 'p2'), 'only the selected piece is drawn'); assert.ok(lines[0].points.length >= 2);
  const inView = lines.flatMap((l) => l.points).filter((p) => p.x > 10 && p.y > 10 && p.x < 790 && p.y < 490), mid = inView[Math.floor(inView.length / 2)];
  assert.ok(mid, 'part of the selected piece is on screen'); const hit = pv.pick(mid.x, mid.y); assert.ok(hit, 'the preview picks something there');
  assert.equal(require('../core/labels.js').pieceAt(track2.segments, hit.s), 'p2', 'the pick under the highlight is the selected piece');
  assert.deepEqual(SL.selectionLines(track2, [], v.pose, 800, 500), []); assert.deepEqual(SL.selectionLines(null, ids, v.pose, 800, 500), []);
  pv.dispose();
});

// ── the panel, on a small fake DOM ──
class El {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.attrs = {}; this.style = {}; this._text = ''; this.listeners = {}; this.value = ''; this.checked = false; this.disabled = false; this.clientWidth = 0; this.clientHeight = 0; }
  append(...k) { for (const c of k) { if (c == null) continue; const n = typeof c === 'string' ? Object.assign(new El('#text', this.ownerDocument), { _text: c }) : c; n.parent = this; this.children.push(n); } }
  replaceChildren(...k) { for (const c of this.children) c.parent = null; this.children = []; this.append(...k); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.ownerDocument.ids[v] = this; }
  getAttribute(k) { return this.attrs[k]; }
  set textContent(t) { this._text = String(t); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  addEventListener(e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); }
  removeEventListener(e, f) { this.listeners[e] = (this.listeners[e] || []).filter((x) => x !== f); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  get isConnected() { let e = this; while (e.parent) e = e.parent; return !!e.isRoot; }
  get offsetWidth() { return this.isConnected ? 9 * Math.max(...this.textContent.split('\n').map((l) => l.length)) + 16 : 0; }
  get offsetHeight() { return this.isConnected ? 20 * this.textContent.split('\n').length + 8 : 0; }
  all() { return [this, ...this.children.flatMap((c) => (c.all ? c.all() : []))]; }
}
function fakeWindow() {
  const doc = { ids: {}, listeners: {}, createElement: (t) => new El(t, doc) };
  doc.getElementById = (id) => doc.ids[id] || null;
  doc.addEventListener = (e, f) => { (doc.listeners[e] = doc.listeners[e] || []).push(f); };
  doc.removeEventListener = (e, f) => { doc.listeners[e] = (doc.listeners[e] || []).filter((x) => x !== f); };
  doc.dispatchEvent = (ev) => { for (const f of (doc.listeners[ev.type] || []).slice()) f(ev); return true; };
  const frames = [];
  const win = { CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }, Option: class { constructor(t, v) { this.textContent = t; this.value = v; } },
    requestAnimationFrame: (f) => { frames.push(f); return frames.length; }, cancelAnimationFrame: () => {}, setTimeout: () => 0, clearTimeout: () => {}, frames };
  doc.defaultView = win;
  return { doc, win, tick: () => { const fs2 = frames.splice(0); for (const f of fs2) f(0); } };
}
async function mountPanel(st = store()) {
  const { doc, win, tick: frame } = fakeWindow();
  const stage = doc.createElement('div'); stage.setAttribute('id', 'preview'); stage.clientWidth = 900; stage.clientHeight = 600; stage.isRoot = true;
  const root = doc.createElement('div'), shell = await track(st);
  // the preview's side of the events the panel asks: a pick answers the station the test sets; the track is the shell's
  const T = { s: 100 };
  doc.addEventListener('t180-pick', (ev) => ev.detail.reply(T.s === null ? null : { s: T.s, pos: [0, 0, 0], px: 1 }));
  doc.addEventListener('t180:track-request', (ev) => ev.detail.reply({ segments: shell.getState().resolved.segments, path: { samples: [] } }));
  const panel = require('../core/panel.js').mount(root, shell);
  const all = () => root.all(), button = (text) => all().find((e) => e.tagName === 'BUTTON' && e.textContent === text);
  const buttons = (text) => all().filter((e) => e.tagName === 'BUTTON' && e.textContent === text);
  const pointer = (type, x, y, extra = {}) => { for (const f of (stage.listeners[type] || []).slice()) f({ clientX: x, clientY: y, button: 0, preventDefault() {}, ...extra }); };
  const click = (s, extra = {}) => { T.s = s; pointer('pointerdown', 50, 50, extra); pointer('pointerup', 50, 50, extra); };
  const input = (label) => all().find((e) => e.tagName === 'INPUT' && e.attrs['aria-label'] === label);
  const rows = () => all().filter((e) => e.attrs['data-piece']);
  const text = (aria) => (all().find((e) => e.attrs['aria-label'] === aria) || { textContent: null }).textContent;
  return { doc, win, frame, stage, root, shell, panel, st, T, button, buttons, pointer, click, input, rows, text, all };
}

test('row 10: the panel: a click selects the piece under it and a shift-click the run; a drag, an armed brush and a click on nothing do not select; Save as piece, the list, Add at head with Mirror, Rename, Delete with its confirm', async () => {
  const P1 = await mountPanel(), { shell, st } = P1;
  assert.equal(P1.button('Save as piece').disabled, true); assert.equal(P1.button('Delete selected').disabled, true); assert.match(P1.text('selection'), /^Nothing selected: click a piece on the track/);
  P1.click(100); assert.deepEqual([shell.selectionInfo().from, shell.selectionInfo().to], [0, 0]); assert.match(P1.text('selection'), /^Selected: p1 · 300 m/);
  P1.click(400, { shiftKey: true }); assert.deepEqual([shell.selectionInfo().from, shell.selectionInfo().to], [0, 1], 'the run from the first to the one clicked'); assert.match(P1.text('selection'), /^Selected: p1 to p2 \(2 pieces\)/);
  P1.click(400); assert.deepEqual([shell.selectionInfo().from, shell.selectionInfo().to], [1, 1], 'a plain click replaces it'); const kept = shell.getState().selection;
  P1.T.s = 700; P1.pointer('pointerdown', 50, 50); P1.pointer('pointerup', 80, 50); assert.equal(shell.getState().selection, kept, 'a drag (the camera\'s) selects nothing');
  const armed = P1.input('brush on'); armed.checked = true; P1.click(100); assert.equal(shell.getState().selection, kept, 'with the brush armed the click is the brush\'s'); armed.checked = false;
  P1.click(null); assert.equal(shell.getState().selection, null, 'a click on nothing clears the selection'); P1.click(100);
  // Save as piece: the name box, the button, the list
  P1.click(400); P1.click(550, { shiftKey: true }); assert.equal(P1.button('Save as piece').disabled, false);
  const name = P1.input('piece name'); name.value = 'two turns'; P1.button('Save as piece').onclick(); await tick(); await tick();
  assert.equal(st.pieces.has('two turns'), true); assert.equal(name.value, '', 'the name box is cleared after a save'); assert.equal(P1.rows().length, 1);
  assert.match(P1.rows()[0].textContent, /two turns/); assert.match(P1.text('two turns details'), /^2 pieces · 300 m · turn \+\d+\.\d° · climb 0\.0° · plain$/);
  // Add at head, plain then mirrored
  const n0 = shell.getState().history.present.pieces.length;
  P1.buttons('Add at head')[0].onclick(); await tick(); await tick(); assert.equal(shell.getState().history.present.pieces.length, n0 + 2);
  P1.input('mirror on insert').checked = true; P1.buttons('Add at head')[0].onclick(); await tick(); await tick(); assert.equal(shell.getState().history.present.pieces.length, n0 + 4); assert.match(shell.getState().message, /mirrored/);
  // Rename, with its own box; Delete, with its confirm
  P1.button('Rename').onclick(); assert.ok(P1.input('new name')); P1.input('new name').value = 'bends'; P1.button('OK').onclick(); await tick(); await tick(); await tick();
  assert.deepEqual(await st.listPieces(), ['bends']); assert.match(P1.rows()[0].textContent, /bends/);
  P1.buttons('Delete').find((b) => b.attrs['aria-label'] === 'delete the saved piece bends').onclick(); assert.ok(P1.button('Yes, delete') && P1.button('No'), 'it asks first'); P1.button('No').onclick(); assert.deepEqual(await st.listPieces(), ['bends'], 'No keeps it');
  P1.buttons('Delete').find((b) => b.attrs['aria-label'] === 'delete the saved piece bends').onclick(); P1.button('Yes, delete').onclick(); await tick(); await tick(); await tick();
  assert.deepEqual(await st.listPieces(), []); assert.equal(P1.rows().length, 0); assert.match(P1.all().map((e) => e.textContent).join('|'), /No saved pieces yet/);
  P1.panel.unmount();
});

test('row 10b: the panel: a middle delete shows the preview in words (what moves, the overlap check) with Apply and Cancel; a mixed run says why it cannot be saved', async () => {
  const P2 = await mountPanel(), { shell } = P2;
  P2.click(400); P2.button('Delete selected').onclick();
  const box = P2.text('delete preview'); assert.match(box, /^Preview: 1 piece \(p2\) would be taken out of the middle of the track\. The two sides are joined again at the gap, which changes the start of p3/);
  assert.match(box, /Moves: p5 up to \d+(\.\d+)? m, p3 up to \d+(\.\d+)? m, p4 up to/); assert.match(box, /everything before the gap is exactly as it was/); assert.match(box, /No overlap and no red on the track after the delete\.|OVERLAP/);
  assert.ok(shell.getState().deleteProposal); assert.notEqual(P2.button('Apply delete').style.display, 'none'); assert.notEqual(P2.button('Cancel delete').style.display, 'none');
  P2.button('Cancel delete').onclick(); assert.equal(shell.getState().deleteProposal, null); assert.equal(P2.button('Apply delete').style.display, 'none'); assert.equal(P2.text('delete preview'), '');
  const d0 = shell.getState().history.present; P2.button('Delete selected').onclick(); P2.button('Apply delete').onclick(); await tick(); await tick(); await tick();
  assert.equal(shell.getState().history.present.pieces.length, d0.pieces.length - 1); assert.equal(P2.st.backups.length, 1, 'the copy was written first'); assert.match(shell.getState().message, /deleted 1 piece from the middle/);
  // a mixed run says why
  const P3 = await mountPanel(); P3.shell.extend({ length: 100, transition: 40, targets: { c: 30 } }); P3.click(650); P3.click(800, { shiftKey: true });
  assert.equal(P3.button('Save as piece').disabled, true); assert.match(P3.text('why the selection cannot be saved'), /^Cannot be saved as a piece: MIXED_RUN/);
});

// ── D244 / D244b: the drag handles and Sculpt, through the panel on the same fake DOM (the pure rows are app/test/handles.test.js, the shell's Sculpt rows app/test/core-sculpt.test.js) ──
//   11  Extend's handles: they are on the ghost and only while there is one; a drag types its value into the matching field and nothing reaches the document or Undo until Extend; the two
//       mirrored handles change the same field; a press is the handle's only ON a handle (the armed brush and the camera keep theirs); Extend then places what was dragged; the switch turns them off
//   12  Sculpt through the panel: the brush offers only the shape channels; with ONE piece selected its handles appear; a drag of one reshapes that piece, is ONE undo step, and the centreline does not move
const G = require('../../src/geom/index.js');
const HD = require('../core/handles.js');
const CLN = require('../core/centreline.js');

/** The preview's side of the handle events, from the shell: a ghost built the way the preview builds it (and retired when the track changes), a camera above and behind it, the placed track's path. */
function stubPreview(P1) {
  const { doc, shell } = P1, S = { ghost: null, ghosts: 0, clears: 0, hide: false, ghostFor: null };
  const build = (segments, start) => G.buildPath(segments, { step: 2, closed: false, ...(start ? { start } : {}) });
  const placed = () => { const r = shell.getState().resolved; return r.segments.length ? build(r.segments, r.start) : { samples: [] }; };
  doc.addEventListener('t180-ghost', (ev) => { if (S.deaf) return; const c = ev.detail.candidate; S.ghosts++; S.ghost = build(c.segments, c.start); S.ghostSegs = c.segments; S.ghostJump = !!c.jump; S.lastCandidate = c; S.ghostFor = shell.getState().history.present; if (typeof ev.detail.reply === 'function') ev.detail.reply({ ok: true }); });
  doc.addEventListener('t180-ghost-clear', () => { S.clears++; S.ghost = null; });
  shell.subscribe((st) => { if (S.ghost && S.ghostFor !== st.history.present) S.ghost = null; });   // a change to the placed track retires the ghost (preview.js refresh)
  doc.addEventListener('t180:ghost-request', (ev) => { const p = placed(), last = p.samples.length ? p.samples[p.samples.length - 1].s : 0; ev.detail.reply(S.ghost && !S.hide ? { samples: S.ghost.samples, segments: S.ghostSegs, jump: S.ghostJump, s0: last } : null); });
  doc.addEventListener('t180:track-request', (ev) => ev.detail.reply({ segments: shell.getState().resolved.segments, path: placed() }));   // after the panel's own (empty) one: the last reply wins
  doc.addEventListener('t180:view', (ev) => {
    const si = shell.getState().sculpt ? shell.sculptInfo() : null;   // Sculpt: the camera looks at the selected piece, from behind and above
    if (si) { const segs = shell.getState().resolved.segments, mine = placed().samples.filter((m) => segs[m.seg] && segs[m.seg].id === si.id), m = mine[mine.length >> 1]; return ev.detail.reply({ pose: { eye: [m.pos[0] - m.T[0] * 70, m.pos[1] + 45, m.pos[2] - m.T[2] * 70], target: m.pos, up: [0, 1, 0], fov: 60 * Math.PI / 180 }, mode: 'free', head: null }); }
    const p = S.ghost || placed(), n = p.samples.length; if (!n) return ev.detail.reply({ pose: { eye: [0, 40, -60], target: [0, 0, 60], up: [0, 1, 0], fov: 1 }, mode: 'free', head: null });
    const a = p.samples[Math.max(0, n - 60)], b = p.samples[n - 1];
    ev.detail.reply({ pose: { eye: [a.pos[0] - a.T[0] * 70, a.pos[1] + 45, a.pos[2] - a.T[2] * 70], target: b.pos, up: [0, 1, 0], fov: 60 * Math.PI / 180 }, mode: 'free', head: null });
  });
  return S;
}
/** One pointer event through the stage's listeners, in the real DOM's order (the handles' capture-phase press first) and stopping where it is stopped. */
function fire(P1, type, x, y, extra = {}) {
  const ev = { clientX: x, clientY: y, button: 0, pointerId: 1, stopped: false, preventDefault() {}, stopImmediatePropagation() { this.stopped = true; }, ...extra };
  for (const f of (P1.stage.listeners[type] || []).slice()) { f(ev); if (ev.stopped) break; }
  return ev;
}
const fieldOf = (P1, text) => P1.all().find((e) => e.tagName === 'LABEL' && e.children[0] && e.children[0].textContent === text).children[1];
async function handlePanel({ deaf = false } = {}) {
  const P1 = await mountPanel(); P1.deaf = deaf; const S = stubPreview(P1); S.deaf = deaf;
  const l = P1.stage.listeners.pointerdown; l.unshift(l.pop());   // the handles' listener is the capture-phase one: first
  fieldOf(P1, 'length m').value = '100';   // (the fake DOM does not turn the value attribute into the value, a real input shows 100)
  P1.frame(); P1.frame(); return Object.assign(P1, { S });
}
const handleOf = (P1, id) => P1.panel.handles.handles().find((h) => h.id === id);
/** Drag the handle `id` by `m` metres along its own axis (on screen, from where it was pressed), release, and return what the field says. */
function dragBy(P1, id, m, extra = {}) {
  const h = handleOf(P1, id), a = h.screen, k = m * a.len / a.len;
  fire(P1, 'pointerdown', a.x, a.y);
  fire(P1, 'pointermove', a.x + a.dx * k, a.y + a.dy * k, extra); P1.frame();
  fire(P1, 'pointerup', a.x + a.dx * k, a.y + a.dy * k, extra);
}

test('row 11: Extend\'s handles: on the ghost and only while there is one; a drag types into the matching field and reaches no document until Extend; mirrored handles change the same field; Extend places what was dragged', async () => {
  const P1 = await handlePanel(), { shell, S } = P1, d0 = shell.getState().history.present, n0 = d0.pieces.length, past0 = shell.getState().history.past.length;
  const hs = P1.panel.handles.handles(); assert.deepEqual(hs.map((h) => h.id), ['length:0', 'width:1', 'width:-1', 'bank:1', 'bank:-1', 'cup:1', 'cup:-1', 'turn:1', 'turn:-1', 'climb:0'], 'ten handles on the ghost, both sides where there are sides');
  assert.ok(hs.every((h) => h.screen), 'all on screen'); assert.ok(S.ghosts >= 1, 'the ghost was shown for them');
  let seen = null; P1.doc.dispatchEvent(new P1.win.CustomEvent('t180:handles-request', { detail: { reply: (l) => { seen = l; } } }));
  assert.deepEqual(seen.map((h) => h.id), hs.map((h) => h.id), 'the read-only request (for the window proof) lists the same handles'); assert.ok(seen.every((h) => Number.isFinite(h.x) && Number.isFinite(h.dy)));
  // length: a drag along the road, 20 m
  const len = fieldOf(P1, 'length m'), width = fieldOf(P1, 'width m'), bank = fieldOf(P1, 'bank °'), turn = fieldOf(P1, 'turn °/100m'), cup = fieldOf(P1, 'cup °');
  assert.equal(len.value, '100'); const ghosts0 = S.ghosts; dragBy(P1, 'length:0', 20); assert.equal(len.value, '120', 'length: 20 m along the road'); assert.ok(S.ghosts > ghosts0, 'the ghost followed the field (typed)');
  assert.equal(shell.getState().history.present, d0, 'a drag is no document edit'); assert.equal(shell.getState().history.past.length, past0, 'nothing in Undo');
  // width: either side's handle, 1 m OUTWARD, is the same change of the one field
  const w0 = Number(width.value); dragBy(P1, 'width:1', 1); const wl = Number(width.value); width.value = String(w0); width.oninput(); P1.frame(); dragBy(P1, 'width:-1', 1); const wr = Number(width.value);
  assert.equal(wl, w0 + 2); assert.equal(wr, wl, 'the right edge, 1 m outward, is the same two metres of width');
  // D250 item 3, the keeper's picture: LENGTH and WIDTH are at the piece's NEAR end (the head, where the ghost starts); the width marks sit at the TARGET half-width, so they follow the drag
  const nearOf = () => { const r = shell.getState().resolved, placed = G.buildPath(r.segments, { step: 2, closed: false, start: r.start }).samples, end = placed[placed.length - 1].s; return S.ghost.samples.find((m) => m.s >= end - 1e-9); };
  const lat = (h, near) => (h.pos[0] - near.pos[0]) * near.L[0] + (h.pos[1] - near.pos[1]) * near.L[1] + (h.pos[2] - near.pos[2]) * near.L[2];
  width.value = String(w0); width.oninput(); P1.frame(); let near = nearOf(), now = Object.fromEntries(P1.panel.handles.handles().map((h) => [h.id, h]));
  for (const k of ['length:0', 'width:1', 'width:-1']) assert.ok(Math.hypot(now[k].pos[0] - near.pos[0] - (k === 'length:0' ? 0 : lat(now[k], near) * near.L[0]), now[k].pos[2] - near.pos[2] - (k === 'length:0' ? 0 : lat(now[k], near) * near.L[2])) < 1e-6, `${k} is on the ghost's first station`);
  const nearly = (x, y, eps) => assert.ok(Math.abs(x - y) <= eps, `${x} is not within ${eps} of ${y}`);
  near = nearOf(); nearly(lat(now['width:1'], near), w0 / 2, 1e-6); nearly(lat(now['width:-1'], near), -w0 / 2, 1e-6); width.value = String(w0 + 4); width.oninput(); P1.frame(); now = Object.fromEntries(P1.panel.handles.handles().map((h) => [h.id, h]));
  nearly(lat(now['width:1'], nearOf()), (w0 + 4) / 2, 1e-6); const turnNow = Object.fromEntries(P1.panel.handles.handles().map((h) => [h.id, h]))['turn:1']; assert.ok(Math.abs(lat(turnNow, nearOf())) > 0, 'control: the turn mark is a different handle, three quarters along');
  width.value = String(w0); width.oninput(); P1.frame();
  // bank: the left edge up, the right edge down are both positive; a drag is typed (Shift: a tenth)
  dragBy(P1, 'bank:1', 2); const b1 = Number(bank.value); assert.ok(b1 > 0, `bank rose: ${b1}`); bank.value = '0'; bank.oninput(); P1.frame(); dragBy(P1, 'bank:-1', 2); assert.equal(Number(bank.value), b1, 'the right edge dragged DOWN 2 m is the same bank');
  bank.value = '0'; bank.oninput(); P1.frame(); dragBy(P1, 'bank:1', 2, { shiftKey: true }); assert.ok(Math.abs(Number(bank.value) - b1 / 10) < 0.06, `Shift is a tenth: ${bank.value} against ${b1 / 10}`);
  // turn: toward the left on either side; cup outward
  const t0 = Number(turn.value); dragBy(P1, 'turn:1', 4); const t1 = Number(turn.value); assert.equal(t1, Math.round((t0 + 2) * 10) / 10, 'half a degree per 100 m per metre'); turn.value = String(t0); turn.oninput(); P1.frame(); dragBy(P1, 'turn:-1', 4); assert.equal(Number(turn.value), t1, 'the same value from the right-hand handle');
  const c0 = Number(cup.value); dragBy(P1, 'cup:1', 3); assert.equal(Number(cup.value), c0 + 6); assert.equal(shell.getState().history.present, d0, 'still no document edit after all of it');
  // the readout follows the drag (as typed), and Extend places what was dragged: the piece is new, and it carries the width that was dragged
  width.value = String(w0 + 4); width.oninput(); P1.frame(); assert.match(P1.root.all().find((e) => e.attrs['data-readout'] === 'length').textContent, /120/, 'the readout shows the dragged length');
  P1.button('Extend').onclick(); const d1 = shell.getState().history.present; assert.equal(d1.pieces.length, n0 + 1, 'Extend adds the piece'); assert.equal(shell.getState().history.past.length, past0 + 1, 'ONE undo step');
  const placed = d1.pieces[d1.pieces.length - 1]; assert.equal(placed.length, 120); assert.ok(Math.abs(D.channelAt(placed, 'w', placed.length).v - (w0 + 4)) < 1e-6, 'the width that was dragged is the width the piece ends at');
  P1.panel.unmount();
});

test('row 11b: no ghost, no handles; a press ON a handle is the handle\'s and the armed brush and the camera keep a press anywhere else; the cup\'s handles go with the cup field; the switch turns them off', async () => {
  const P1 = await handlePanel(), { shell, S } = P1;
  assert.equal(P1.panel.handles.handles().length, 10);
  S.hide = true; P1.frame(); assert.deepEqual(P1.panel.handles.handles(), [], 'the preview has no ghost: no handles');
  S.hide = false; P1.frame(); assert.equal(P1.panel.handles.handles().length, 10);
  // a press ON a handle with the brush armed is the handle's (no brush opens); a press elsewhere with it armed is the brush's
  const armed = P1.input('brush on'); armed.checked = true; const h = handleOf(P1, 'length:0'); P1.T.s = 100;
  for (const [aria, v] of [['brush mode', 'rate'], ['brush channel', 'phi']]) P1.all().find((e) => e.tagName === 'SELECT' && e.attrs['aria-label'] === aria).value = v;   // (the fake select has no value of its own)
  const on = fire(P1, 'pointerdown', h.screen.x, h.screen.y); assert.equal(on.stopped, true); assert.equal(shell.getState().brush, null, 'on a handle: not the brush\'s'); fire(P1, 'pointerup', h.screen.x, h.screen.y);
  const lenField = fieldOf(P1, 'length m'); dragBy(P1, 'length:0', 20); assert.equal(lenField.value, '120', 'a whole drag on a handle with the brush armed edits the field'); assert.equal(shell.getState().brush, null); assert.ok(!shell.getState().lastStep || !/brush/.test(shell.getState().lastStep.op), 'and no brush stroke ran');
  const off = fire(P1, 'pointerdown', 5, 5); assert.equal(off.stopped, false); assert.ok(shell.getState().brush, 'elsewhere: the brush opens'); fire(P1, 'pointerup', 5, 5); armed.checked = false;
  // cup or tube: a tube in use takes the cup's handles away (its field is disabled)
  const tube = fieldOf(P1, 'tube sweep °'); tube.value = '200'; tube.oninput(); P1.frame(); assert.equal(fieldOf(P1, 'cup °').disabled, true); assert.ok(!P1.panel.handles.handles().some((x) => x.kind === 'cup'), 'no cup handles while a tube is being made'); assert.equal(P1.panel.handles.handles().length, 8);
  // the switch: off clears the ghost and the handles; the Extend button's mouse-leave then clears as it always did
  const sw = P1.input('drag handles'); assert.equal(sw.checked, true); sw.checked = false; sw.onchange(); P1.frame(); assert.deepEqual(P1.panel.handles.handles(), []); const c0 = S.clears; P1.button('Extend').onmouseleave(); assert.equal(S.clears, c0 + 1);
  sw.checked = true; sw.onchange(); P1.frame(); P1.button('Extend').onmouseleave(); assert.equal(S.clears, c0 + 1, 'with the handles on, leaving the button keeps the ghost'); P1.frame(); P1.frame();
  assert.ok(P1.panel.handles.handles().length > 0, 'and the handles are back'); P1.panel.unmount();
});

test('row 11c: the preview mounts AFTER the panel, so the first ask for the ghost can go to nobody: the handles ask again about every half second and appear once it listens (found in the real window)', async () => {
  const P1 = await handlePanel({ deaf: true }), { S } = P1; assert.deepEqual(P1.panel.handles.handles(), [], 'nobody listens: no ghost, no handles');
  S.deaf = false; for (let i = 0; i < 20; i++) P1.frame(); assert.deepEqual(P1.panel.handles.handles(), [], 'not asked again on every frame');
  const asked = S.ghosts; for (let i = 0; i < 12; i++) P1.frame(); assert.ok(S.ghosts > asked, 'asked again'); assert.equal(P1.panel.handles.handles().length, 10, 'and the handles are there');
  P1.panel.unmount();
});

test('row 12: Sculpt through the panel: only the shape channels; ONE selected piece gets its handles; a drag reshapes that piece, is ONE undo step and the centreline does not move; Undo gives it back', async () => {
  const P1 = await handlePanel(), { shell } = P1, sw = P1.input('sculpt on');
  const options = () => P1.all().find((e) => e.tagName === 'SELECT' && e.attrs['aria-label'] === 'brush channel').children.map((o) => o.value);
  assert.ok(options().includes('kh') && options().includes('kv'), 'control: with Sculpt off the brush offers turn and climb');
  sw.checked = true; sw.onchange(); P1.frame(); assert.equal(shell.getState().sculpt, true);
  assert.deepEqual(options().sort(), ['c', 'e', 'phi', 'r', 's', 't', 'w'], 'Sculpt on: the shape channels only'); assert.equal(P1.all().find((e) => e.tagName === 'SELECT' && e.attrs['aria-label'] === 'brush mode').disabled, true);
  assert.deepEqual(P1.panel.handles.handles(), [], 'Sculpt on, nothing selected: no handles (and the Extend ghost is not drawn for them)'); assert.match(P1.text('sculpt hint'), /^Select ONE piece/);
  P1.click(400); P1.frame(); P1.frame(); assert.equal(shell.sculptInfo().index, 1); assert.match(P1.text('sculpt hint'), /^Sculpting p2: drag its handles \(bank, width\)/);
  assert.deepEqual(P1.panel.handles.handles().map((h) => h.id), ['bank:1', 'bank:-1', 'width:1', 'width:-1'], 'the legacy piece has no cup, so no cup handles; both sides of the rest');
  // drag the left edge up
  const d0 = shell.getState().history.present, past0 = shell.getState().history.past.length, snap = CLN.snapshot(shell.getState().resolved), phi0 = shell.sculptInfo().values.phi;
  dragBy(P1, 'bank:1', 2); P1.frame();
  const d1 = shell.getState().history.present; assert.notEqual(d1, d0, 'the piece changed'); assert.equal(shell.getState().history.past.length, past0 + 1, 'ONE undo step for the whole drag');
  assert.equal(CLN.pathMoved(snap, shell.getState().resolved), null, 'the centreline did not move'); assert.ok(shell.sculptInfo().values.phi > phi0 + 1, `its bank rose at the middle: ${phi0} to ${shell.sculptInfo().values.phi}`);
  d1.pieces.forEach((p, i) => { if (i !== 1) assert.equal(p, d0.pieces[i], `piece ${i} is the same object`); });
  assert.equal(shell.sculptInfo().index, 1, 'still selected: the handles stay on the piece'); assert.equal(shell.getState().message, null);
  // a width drag from the right edge, outward, widens it; then Undo twice gives the original back
  const w0 = shell.sculptInfo().values.w; dragBy(P1, 'width:-1', 1); P1.frame(); assert.ok(shell.sculptInfo().values.w > w0 + 0.5, `width grew: ${w0} to ${shell.sculptInfo().values.w}`);
  assert.equal(CLN.pathMoved(snap, shell.getState().resolved), null); shell.undo(); shell.undo(); assert.equal(shell.getState().history.present, d0, 'Undo gives back the very same document');
  // turn off: the shell and the brush go back
  sw.checked = false; sw.onchange(); P1.frame(); assert.equal(shell.getState().sculpt, false); assert.ok(options().includes('kh'), 'the turn brush is offered again'); assert.deepEqual(P1.panel.handles.handles().length > 0, true, 'the Extend handles are back');
  P1.panel.unmount();
});

test('row 13: the preview\'s ghostInfo (what the handles read): none without a ghost, the path\'s samples and where the new piece starts with one, none for a delete preview\'s ghost, none after clearGhost', async () => {
  const s = await track(), pv = headlessPreview(s);
  assert.equal(pv.ghostInfo(), null, 'no ghost, no info');
  const placedEnd = pv.track().path.samples[pv.track().path.samples.length - 1].s;
  pv.showGhost(s.candidate({ length: 120, targets: { kh: TURN } })); const g = pv.ghostInfo();
  assert.ok(g && g.samples.length > pv.track().path.samples.length, 'the ghost\'s samples are the placed track\'s and then the new piece\'s'); assert.equal(g.s0, placedEnd, 'the new piece starts where the placed track ends');
  assert.ok(Math.abs(g.samples[g.samples.length - 1].s - (placedEnd + 120)) < 2.5, 'and it is 120 m long (to the sample step)'); assert.ok(g.samples.every((m) => m.pos && m.T && m.L && m.U), 'each sample has the frame the handles sit in');
  pv.clearGhost(); assert.equal(pv.ghostInfo(), null);
  s.selectPiece(1); s.deleteSelection(); assert.ok(pv.view().ghost > 0); assert.equal(pv.ghostInfo(), null, 'a delete preview\'s ghost is not Extend\'s: no handles on it');
  s.cancelDelete(); pv.dispose();
  const e = await createCoreShell({ brushFn: null, autosaveMs: 0 }), pe = headlessPreview(e); pe.showGhost(e.candidate({ length: 100 })); const first = pe.ghostInfo(); assert.equal(first.s0, 0, 'on an empty track the new piece starts at 0'); assert.ok(first.samples.length > 10); pe.dispose();
});

// ── D243 item 1: the Add-jump control through the panel (the pure and shell rows are app/test/jump-ui.test.js) ──
//   14  the Jump block: its hint and the speed the ramp is sized for from the start; hover or typing shows the jump as a ghost (flagged, with the flight in words: which arc, the speed, where it comes down); a refused
//       jump says why and shows none; the drag handles stay off a jump's ghost and come back; Add jump adds it (one step), the next Extend lays the road; a refusal in plain words in the status line
//   15  the preview's ghostInfo carries the jump flag and the segments
const statusOf = (P1) => P1.all().find((e) => e.attrs.role === 'status').textContent;
test('row 14: the Jump block: the hint and the ramp speed from the start; a ghost with the flight in words; a refused jump says why; the handles stay off the jump ghost; Add jump is one step and the next Extend lays the landing road', async () => {
  const P1 = await handlePanel(), { shell, S } = P1, gap = fieldOf(P1, 'jump gap m'), drop = fieldOf(P1, 'drop m (+ down)'), land = fieldOf(P1, 'landing °');
  assert.match(P1.text('jump flight'), /^Add jump takes off from the end of the road/); assert.match(P1.text('jump flight'), /The landing ramp is sized for 460 km\/h, fixed today\.$/, 'the speed it is sized for, before any hover');
  gap.value = '15'; drop.value = '1'; land.value = '-2';   // (a flat take-off: at 460 km/h both measured falls clear 15 m)
  assert.equal(P1.panel.handles.handles().length, 10, 'the Extend handles are up'); P1.button('Add jump').onmouseenter();
  assert.equal(S.ghostJump, true, 'the ghost is a jump\'s'); assert.equal(S.lastCandidate.jump, true); assert.ok(S.lastCandidate.segments.some((g) => g.kind === 'gap'));
  const note = P1.text('jump flight'); assert.match(note, /ballistic, at 460 km\/h, falling at 3\.2 g and 6\.3 g/); assert.match(note, /3\.2 g: comes down \d+\.\d m after the lip/); assert.match(note, /6\.3 g: comes down \d+\.\d m after the lip/); assert.match(note, /The ramp is \d+\.\d m long\./); assert.match(note, /sized for 460 km\/h, fixed today; the keeper has not decided/);
  for (let i = 0; i < 3; i++) P1.frame(); assert.deepEqual(P1.panel.handles.handles(), [], 'no Extend handles on a jump\'s ghost');
  assert.equal(P1.panel.flights.flights().length, 1, 'the flight overlay reads the ghost\'s flight'); assert.equal(P1.panel.flights.lines().length, 2, 'two dashed arcs');
  // typing changes the ghost and the words
  const g0 = S.ghosts; gap.value = '120'; drop.value = '3'; land.value = '-3'; gap.oninput(); assert.ok(S.ghosts > g0, 'the ghost followed the field'); assert.match(P1.text('jump flight'), /6\.3 g: does NOT reach the landing at 460 km\/h \(it needs \d+ km\/h\): the jump is red\./);
  // a validation speed other than the ramp's is said
  shell.setDesignSpeed(300); gap.oninput(); assert.match(P1.text('jump flight'), /Validation is using 300 km\/h \(the design speed box\), so the jump can be red there even though the ramp is sized for 460\./); shell.setDesignSpeed(null);
  // a refused jump: the reason in plain words, no ghost
  gap.value = '0'; gap.oninput(); assert.match(P1.text('jump flight'), /^No preview of this jump: The gap must be more than 0 m: it is how far the car flies along the ground\./); assert.equal(S.ghost, null, 'no ghost for a refused jump');
  // leaving the button clears the ghost, and the Extend handles come back
  gap.value = '40'; gap.oninput(); P1.button('Add jump').onmouseleave(); assert.equal(S.ghost, null); for (let i = 0; i < 40; i++) P1.frame(); assert.equal(P1.panel.handles.handles().length, 10, 'the Extend handles are back');
  // Add jump: one undo step, the flight is the last piece, the message says what next
  const d0 = shell.getState().history.present, past0 = shell.getState().history.past.length; P1.button('Add jump').onclick();
  const d1 = shell.getState().history.present; assert.equal(d1.pieces.length, d0.pieces.length + 1); assert.equal(d1.pieces[d1.pieces.length - 1].type, 'flight'); assert.equal(shell.getState().history.past.length, past0 + 1, 'ONE undo step'); assert.match(statusOf(P1), /^Jump added\. Press Extend to lay the road it lands on\.$/);
  // the same again is refused in plain words, in the status line, with nothing added
  P1.button('Add jump').onclick(); assert.match(statusOf(P1), /^The track already ends in a jump\. Press Extend first, so the car has road to land on, then add the next one\.$/); assert.equal(shell.getState().history.present, d1);
  // the next Extend lays the landing road
  P1.button('Extend').onclick(); const d2 = shell.getState().history.present; assert.deepEqual(d2.pieces.slice(-2).map((p) => p.type), ['flight', 'road']); assert.equal(shell.getState().message, null, shell.getState().message);
  P1.panel.unmount();
});

test('row 15: the preview\'s ghostInfo says whether the ghost is a jump\'s and carries its segments (what the handles and the flight overlay read)', async () => {
  const s = await track(), pv = headlessPreview(s);
  pv.showGhost(s.candidate({ length: 100 })); let g = pv.ghostInfo(); assert.equal(g.jump, false, 'an Extend ghost is not a jump'); assert.ok(Array.isArray(g.segments) && g.segments.length > 0);
  pv.showGhost(s.candidateJump({ gap: 30, drop: 1, landDeg: -2 })); g = pv.ghostInfo(); assert.equal(g.jump, true); assert.ok(g.segments.some((x) => x.kind === 'gap'), 'the flight is among the ghost\'s segments'); assert.ok(g.samples.length > pv.track().path.samples.length);
  pv.clearGhost(); assert.equal(pv.ghostInfo(), null); pv.dispose();
});
