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

// D250 item 4 (the keeper: "Short way across start"; C's look F1 on 62f5d39: the last piece then p1 selected the whole lap)
test('row 1c: on a CLOSED lap a shift-click across the start line takes the SHORT way: the pieces either side of the line; Save keeps them, Delete says CLOSED', async () => {
  const st = store(), s = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 }); s.adopt(lap());
  const d = s.getState().history.present, n = d.pieces.length; assert.equal(d.closed, true);
  s.selectPiece(n - 1); s.selectPiece(0, { extend: true }); let i = s.selectionInfo();
  assert.deepEqual([i.from, i.to, i.count, [...i.ids]], [n - 1, 0, 2, [d.pieces[n - 1].id, d.pieces[0].id]], 'last piece then p1: the two pieces either side of the line');
  assert.equal(i.lengthM, d.pieces[n - 1].length + d.pieces[0].length); assert.equal(i.saveProblem, null);
  await s.savePiece('across'); assert.match(s.getState().message, /saved the piece "across": 2 pieces/); assert.equal(PC.parse(st.pieces.get('across')).pieces.length, 2);
  s.selectPiece(n - 1); s.selectPiece(0, { extend: true }); s.deleteSelection(); assert.match(s.getState().message, /^CLOSED/); assert.equal(s.getState().history.present, d, 'nothing deleted');
  s.selectPiece(1); s.selectPiece(n - 2, { extend: true }); i = s.selectionInfo(); assert.equal(i.from > i.to, true, 'p2 then the last but one: across the line is shorter');
  s.selectPiece(1); s.selectPiece(3, { extend: true }); i = s.selectionInfo(); assert.deepEqual([i.from, i.to], [1, 3], 'a run shorter inside the lap stays inside it');
  const o = await track(); o.selectPiece(4); o.selectPiece(0, { extend: true }); i = o.selectionInfo(); assert.deepEqual([i.from, i.to, i.count], [0, 4, 5], 'control: an OPEN track never wraps');
});
// A's look at f13cded, finding A: on TEST 1 (a cup at the end of the lap, a plain piece at its start) EVERY run across the line is MIXED_RUN, so the short way cost him
// 191 shift-click pairs he could save before. The short way is taken only where it can be kept; otherwise the inside run, and the line says why
test('row 1d: where the run across the start line CANNOT be saved (a cup at one side of it, a plain piece at the other) and the inside run can, the inside run is selected and the line says why', async () => {
  const H = lap(), o = JSON.parse(D.serialize(H)), n = o.pieces.length, last = o.pieces[n - 1], prevEnd = D.pieceEnd(H.pieces[n - 2]).c.v;
  o.pieces[n - 1] = { ...last, cup: true, channels: { ...last.channels, c: last.channels.w.map(() => prevEnd) } };   // the lap's last piece a cup, as TEST 1's p46
  const P = await mountPanel(), s = P.shell; s.adopt(D.parse(JSON.stringify(o)));   // the panel mounted, so the selection LINE is read too
  const d = s.getState().history.present; assert.equal(d.closed, true); assert.equal(D.kindOf(d.pieces[n - 1]), 'cup'); assert.equal(D.kindOf(d.pieces[0]), 'legacy');
  assert.throws(() => PC.saveRun(d, n - 2, 0, { name: 'x' }), (e) => e.code === 'MIXED_RUN', 'control: the run across the line cannot be kept');
  s.selectPiece(0); s.selectPiece(n - 2, { extend: true }); let i = s.selectionInfo();
  assert.deepEqual([i.from, i.to, i.saveProblem], [0, n - 2, null], 'p1 then the last but one: the INSIDE run, which saves');
  assert.equal(i.longWay, 'the long way round: the short way crosses the start line between a cup and a plain piece');
  assert.match(P.text('selection'), /^Selected: p1 to p\d+ \(\d+ pieces\) · .* · the long way round: the short way crosses the start line between a cup and a plain piece/);
  s.selectPiece(n - 1); s.selectPiece(1, { extend: true }); i = s.selectionInfo();
  assert.deepEqual([i.from > i.to, i.longWay], [true, null], 'control: the inside run (the cup and plain pieces) cannot be saved either, so the short way is kept');
  s.selectPiece(1); s.selectPiece(3, { extend: true }); assert.equal(s.selectionInfo().longWay, null, 'control: inside is the short way already');
});
// A's look, finding B: the tie compared float sums; lengths 327.7, 170.3, 327.7, 257.4 make an EXACT tie read as 755.3999999999999 < 755.4
test('row 1e: a tie stays inside the lap even when the lengths are decimals whose sums differ in the last bit (A\'s tiefloat case)', async () => {
  let d = D.createDoc('tie'); for (const L of [327.7, 170.3, 327.7, 257.4]) d = extend(d, { length: L, family: 'bowl' });
  const s = await createCoreShell({ brushFn: null, storage: store(), autosaveMs: 0 }); s.adopt({ ...d, closed: true });
  assert.ok(s.getState().history.present.closed);
  s.selectPiece(1); s.selectPiece(3, { extend: true }); const i = s.selectionInfo();
  assert.deepEqual([i.from, i.to, i.count], [1, 3, 3], '170.3 + 327.7 + 257.4 against 257.4 + 327.7 + 170.3 is a tie: it stays inside');
});
test('row 1: select a piece, shift-click a run (the first piece selected stays the anchor), an out-of-range piece is refused, and any change of the document drops the selection', async () => {
  const s = await track();
  assert.equal(s.selectionInfo(), null);
  s.selectPiece(1); assert.deepEqual({ ...s.selectionInfo(), ids: [...s.selectionInfo().ids] }, { from: 1, to: 1, count: 1, ids: ['p2'], lengthM: 150, atEnd: false, closed: false, longWay: null, saveProblem: null });
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
  // D250 item 4: on a closed lap a shift-click takes the SHORT way round, so "the rest of the lap" (more than half of it) is saved as two runs that each stay inside it
  const n = H.pieces.length;
  a.selectPiece(1); a.selectPiece(3, { extend: true }); assert.deepEqual([a.selectionInfo().from, a.selectionInfo().to], [1, 3]); await a.savePiece('middle of the lap'); assert.equal(a.getState().messageKind, 'ok', a.getState().message);
  a.selectPiece(4); a.selectPiece(n - 1, { extend: true }); assert.deepEqual([a.selectionInfo().from, a.selectionInfo().to], [4, n - 1]); await a.savePiece('end of the lap'); assert.equal(a.getState().messageKind, 'ok', a.getState().message);
  const b = await createCoreShell({ brushFn: null, storage: st, exporter: ex, autosaveMs: 0 }); b.adopt({ ...H, pieces: H.pieces.slice(0, 1), nextId: 2, closed: false });
  for (const name of ['middle of the lap', 'end of the lap']) { await b.insertPiece(name); assert.equal(b.getState().messageKind, 'ok', b.getState().message); }
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
  j.commitDoc(D.appendPiece(j.getState().history.present, D.flightPiece({ forward: 25, up: -1, pitch: -2 * DEG }))); j.extend({ length: 150 });
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
async function mountPanel(st = store(), { bin = false } = {}) {
  const { doc, win, tick: frame } = fakeWindow();
  let menuEl = null, binEl = null;   // D269: the top bar's Pieces menu (index.html: <details id="pieces"><div id="pieces-bin">), found by the panel by id as #preview is
  if (bin) { menuEl = doc.createElement('details'); menuEl.setAttribute('id', 'pieces'); menuEl.open = false; binEl = doc.createElement('div'); binEl.setAttribute('id', 'pieces-bin'); menuEl.append(binEl); }
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
  const binAll = () => (binEl ? binEl.all() : []), binRows = () => binAll().filter((e) => e.attrs['data-piece']), binButton = (t) => binAll().find((e) => e.tagName === 'BUTTON' && e.textContent === t), binButtons = (t) => binAll().filter((e) => e.tagName === 'BUTTON' && e.textContent === t);
  return { doc, win, frame, stage, root, shell, panel, st, T, button, buttons, pointer, click, input, rows, text, all, menuEl, binEl, binAll, binRows, binButton, binButtons };
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
  doc.addEventListener('t180-ghost', (ev) => { if (S.deaf) return; const c = ev.detail.candidate; S.ghosts++; S.ghost = build(c.segments, c.start); S.ghostSegs = c.segments; S.ghostJump = !!c.jump; S.lastCandidate = c; (S.cheaps = S.cheaps || []).push(!!ev.detail.cheap); S.ghostFor = shell.getState().history.present; if (typeof ev.detail.reply === 'function') ev.detail.reply({ ok: true }); });
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
let STAMP = 0;   // each event a second apart: two presses on one handle are never taken for a double-click here unless a row says so (D251: two presses within 400 ms are)
function fire(P1, type, x, y, extra = {}) {
  const ev = { clientX: x, clientY: y, button: 0, pointerId: 1, timeStamp: (STAMP += 1000), stopped: false, preventDefault() {}, stopImmediatePropagation() { this.stopped = true; }, ...extra };
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
/** Drag the handle `id` by `px` PIXELS along its own on-screen axis (from where it was pressed; D251: the speed is per pixel, so a drag is told in pixels), release. */
function dragBy(P1, id, px, extra = {}) {
  const h = handleOf(P1, id), a = h.screen, k = px / a.len;
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
  assert.equal(len.value, '100'); const ghosts0 = S.ghosts; dragBy(P1, 'length:0', 50); assert.equal(len.value, '121', 'length: 50 px along the road, 0.42 m each'); assert.ok(S.ghosts > ghosts0, 'the ghost followed the field (typed)');
  assert.equal(shell.getState().history.present, d0, 'a drag is no document edit'); assert.equal(shell.getState().history.past.length, past0, 'nothing in Undo');
  // width: either side's handle, 1 m OUTWARD, is the same change of the one field
  const w0 = Number(width.value); dragBy(P1, 'width:1', 20); const wl = Number(width.value); width.value = String(w0); width.oninput(); P1.frame(); dragBy(P1, 'width:-1', 20); const wr = Number(width.value);
  assert.equal(wl, Number((w0 + 1.4).toFixed(1))); assert.equal(wr, wl, 'the right edge, 20 px outward, is the same 1.4 m of width');
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
  dragBy(P1, 'bank:1', 20); const b1 = Number(bank.value); assert.ok(b1 > 0, `bank rose: ${b1}`); bank.value = '0'; bank.oninput(); P1.frame(); dragBy(P1, 'bank:-1', 20); assert.equal(Number(bank.value), b1, 'the right edge dragged DOWN 20 px is the same bank');
  bank.value = '0'; bank.oninput(); P1.frame(); dragBy(P1, 'bank:1', 20, { shiftKey: true }); assert.ok(Math.abs(Number(bank.value) - b1 / 10) < 0.06, `Shift is a tenth: ${bank.value} against ${b1 / 10}`);
  // turn: toward the left on either side; cup outward
  const t0 = Number(turn.value); dragBy(P1, 'turn:1', 40); const t1 = Number(turn.value); assert.equal(t1, Math.round((t0 + 3.32) * 10) / 10, 'today\'s speed at the default camera: 0.083 a degree per 100 m per pixel'); turn.value = String(t0); turn.oninput(); P1.frame(); dragBy(P1, 'turn:-1', 40); assert.equal(Number(turn.value), t1, 'the same value from the right-hand handle');
  const c0 = Number(cup.value); dragBy(P1, 'cup:1', 30); assert.equal(Number(cup.value), Number((c0 + 7.2).toFixed(1))); assert.equal(shell.getState().history.present, d0, 'still no document edit after all of it');
  // the readout follows the drag (as typed), and Extend places what was dragged: the piece is new, and it carries the width that was dragged
  width.value = String(w0 + 4); width.oninput(); P1.frame(); assert.match(P1.root.all().find((e) => e.attrs['data-readout'] === 'length').textContent, /121/, 'the readout shows the dragged length');
  P1.button('Extend').onclick(); const d1 = shell.getState().history.present; assert.equal(d1.pieces.length, n0 + 1, 'Extend adds the piece'); assert.equal(shell.getState().history.past.length, past0 + 1, 'ONE undo step');
  const placed = d1.pieces[d1.pieces.length - 1]; assert.equal(placed.length, 121); assert.ok(Math.abs(D.channelAt(placed, 'w', placed.length).v - (w0 + 4)) < 1e-6, 'the width that was dragged is the width the piece ends at');
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
  const lenField = fieldOf(P1, 'length m'); dragBy(P1, 'length:0', 50); assert.equal(lenField.value, '121', 'a whole drag on a handle with the brush armed edits the field'); assert.equal(shell.getState().brush, null); assert.ok(!shell.getState().lastStep || !/brush/.test(shell.getState().lastStep.op), 'and no brush stroke ran');
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
  dragBy(P1, 'bank:1', 20); P1.frame();
  const d1 = shell.getState().history.present; assert.notEqual(d1, d0, 'the piece changed'); assert.equal(shell.getState().history.past.length, past0 + 1, 'ONE undo step for the whole drag');
  assert.equal(CLN.pathMoved(snap, shell.getState().resolved), null, 'the centreline did not move'); assert.ok(shell.sculptInfo().values.phi > phi0 + 1, `its bank rose at the middle: ${phi0} to ${shell.sculptInfo().values.phi}`);
  d1.pieces.forEach((p, i) => { if (i !== 1) assert.equal(p, d0.pieces[i], `piece ${i} is the same object`); });
  assert.equal(shell.sculptInfo().index, 1, 'still selected: the handles stay on the piece'); assert.equal(shell.getState().message, null);
  // a width drag from the right edge, outward, widens it; then Undo twice gives the original back
  const w0 = shell.sculptInfo().values.w; dragBy(P1, 'width:-1', 20); P1.frame(); assert.ok(shell.sculptInfo().values.w > w0 + 0.5, `width grew: ${w0} to ${shell.sculptInfo().values.w}`);
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
test('row 14: the Jump button (D258, the free jump): beside Extend; the old Add-jump fields are gone; hover shows a jump ghost with no Extend handles on it; a click is ONE undo step with the note; a refusal says why; Undo gives the fields back', async () => {
  const P1 = await handlePanel(), { shell, S } = P1, labels = P1.all().filter((e) => e.tagName === 'LABEL' && e.children[0]).map((e) => e.children[0].textContent);
  for (const gone of ['jump gap m', 'drop m (+ down)', 'landing °']) assert.ok(!labels.includes(gone), `${gone} is gone`);
  assert.equal(P1.button('Add jump'), undefined, 'no Add jump button'); const ext = P1.button('Extend'), jmp = P1.button('Jump'); assert.ok(jmp); assert.equal(P1.all().indexOf(jmp), P1.all().indexOf(ext) + 1, 'the Jump button is beside Extend');
  assert.equal(P1.text('jump note'), '', 'D267: no help paragraph under the button'); assert.match(jmp.attrs.title, /free landing.*drive it in AC and move the landing until it works/, 'its sense is the button\'s tooltip');
  assert.equal(P1.panel.handles.handles().length, 10, 'the Extend handles are up'); jmp.onmouseenter();
  assert.equal(S.ghostJump, true, 'the ghost is a jump\'s'); assert.equal(S.lastCandidate.jump, true); assert.ok(S.lastCandidate.segments.some((g) => g.kind === 'gap'));
  for (let i = 0; i < 3; i++) P1.frame(); assert.deepEqual(P1.panel.handles.handles(), [], 'no Extend handles on a jump\'s ghost'); assert.equal(P1.panel.flights.flights().length, 1, 'the flight layer reads the ghost\'s flight'); assert.equal(P1.panel.flights.lines().length, 1, 'one dashed line');
  jmp.onmouseleave(); assert.equal(S.ghost, null); for (let i = 0; i < 40; i++) P1.frame(); assert.equal(P1.panel.handles.handles().length, 10, 'the Extend handles are back');
  // a click: the piece the fields describe, the flight and the landing, one undo step, the note
  const len = fieldOf(P1, 'length m'); len.value = '120'; len.oninput(); const d0 = shell.getState().history.present, past0 = shell.getState().history.past.length; jmp.onclick();
  const d1 = shell.getState().history.present; assert.deepEqual(d1.pieces.slice(d0.pieces.length).map((p) => p.type), ['road', 'flight', 'road']); assert.equal(d1.pieces[d0.pieces.length].length, 120, 'the take-off is what Extend would place');
  assert.equal(shell.getState().history.past.length, past0 + 1, 'ONE undo step'); assert.match(statusOf(P1), /^Jump placed: move its landing by hand\.$/); assert.equal(P1.text('jump note'), '', 'D267: still no paragraph once the jump is placed');
  // Undo gives the fields back (as after an Extend)
  len.value = '77'; shell.undo(); assert.equal(shell.getState().history.present, d0); assert.equal(len.value, '120', 'the length the jump was made with');
  // after a flight the Jump button's own Extend lays the landing road, so Jump again is allowed; a closed loop has no open end: the button is off (the core's words for it are in jump-ui row 1b)
  shell.extend({ length: 100 }); shell.commitDoc(D.appendPiece(shell.getState().history.present, D.flightPiece({ forward: 30, left: 0, up: 0, heading: 0, pitch: 0, bank: 0 }))); jmp.onclick(); assert.deepEqual(shell.getState().history.present.pieces.slice(-4).map((p) => p.type), ['flight', 'road', 'flight', 'road'], 'the old landing road, then a new flight and landing');
  const lap = await handlePanel(); lap.shell.extend({ length: 300, family: 'bowl' }); for (let i = 0; i < 4; i++) lap.shell.extend({ length: Q, transition: 40, targets: { kh: 1 / R } }); lap.shell.extend({ length: 60, transition: 40, targets: { kh: 0 } }); lap.shell.close(); assert.ok(lap.shell.getState().history.present.closed, 'a closed lap'); assert.equal(lap.button('Jump').disabled, true, 'a closed loop has no open end to jump from'); lap.panel.unmount();
  P1.panel.unmount();
});

const landingBoxOf = (P1) => P1.all().find((e) => e.attrs['aria-label'] === 'landing');
test('row 14b: the landing boxes appear while a landing is the head, show the pose in metres and degrees, a typed value is ONE undo step, a refusal says why in words, and an Extend fixes the landing', async () => {
  const P1 = await handlePanel(), { shell } = P1, box = landingBoxOf(P1); assert.equal(box.style.display, 'none', 'no landing, no boxes');
  P1.button('Jump').onclick(); assert.equal(box.style.display, '', 'the boxes are up'); const LB = (n) => P1.input(`landing ${n}`), V = () => ['forward', 'left', 'up', 'heading', 'pitch', 'bank'].map((n) => LB(n).value);   // (by aria-label: the landing's bank box has the Extend bank field's label)
  assert.deepEqual(V(), ['40', '0', '0', '0', '0', '0'], 'lined up, 40 m ahead, the same height'); assert.deepEqual(['landing forward', 'landing left', 'landing up', 'landing heading', 'landing pitch', 'landing bank'].map((n) => !!P1.input(n)), [true, true, true, true, true, true]);
  assert.equal(P1.text('landing hint'), null, 'D267: the landing hint is not a paragraph any more'); assert.match(box.attrs.title, /^Move the landing: drag its arrows on the track \(white forward, orange sideways, yellow height, purple heading\) or type below\. Shift is fine, Ctrl snaps\./, 'it is the block\'s tooltip');
  const past0 = shell.getState().history.past.length; LB('forward').value = '55'; LB('forward').onchange(); assert.equal(shell.landing().pose.forward, 55); assert.equal(shell.getState().history.past.length, past0 + 1, 'ONE undo step for a typed value'); assert.equal(LB('forward').value, '55');
  LB('heading').value = '20'; LB('heading').onchange(); const fl = shell.getState().history.present.pieces.find((p) => p.type === 'flight'); assert.ok(Math.abs(fl.heading - 20 * Math.PI / 180) < 1e-9, 'degrees typed, radians in the document');
  LB('left').value = '-8'; LB('left').onchange(); LB('up').value = '3.5'; LB('up').onchange(); LB('pitch').value = '-2'; LB('pitch').onchange(); LB('bank').value = '6'; LB('bank').onchange();
  assert.deepEqual(V(), ['55', '-8', '3.5', '20', '-2', '6']); assert.deepEqual(shell.landing().pose, { forward: 55, left: -8, up: 3.5, heading: 20, pitch: -2, bank: 6 });
  // a blank or a word changes nothing and the box goes back to what the track says; a landing too close is refused in words
  const n1 = shell.getState().history.past.length; LB('forward').value = ''; LB('forward').onchange(); assert.equal(LB('forward').value, '55'); assert.equal(shell.getState().history.past.length, n1);
  LB('left').value = '0'; LB('left').onchange(); LB('up').value = '0'; LB('up').onchange(); LB('forward').value = '0.2'; LB('forward').onchange(); assert.match(statusOf(P1), /^The landing is too close to the take-off: put it at least 1 m away\.$|^The landing/); assert.equal(shell.landing().pose.forward, 55, 'nothing moved'); assert.equal(LB('forward').value, '55', 'the box shows the track again');
  // an Extend fixes the landing: the boxes go, and a late typed value is refused in words
  P1.button('Extend').onclick(); assert.equal(box.style.display, 'none'); LB('forward').value = '70'; const d = shell.getState().history.present; LB('forward').onchange(); assert.match(statusOf(P1), /^The landing can only be moved while it is the last piece of the track\./); assert.equal(shell.getState().history.present, d);
  // deleting back to it brings them back
  shell.removeHead(); assert.equal(box.style.display, '', 'the boxes are back'); assert.equal(LB('forward').value, '55');
  P1.panel.unmount();
});

test('row 14c: the landing\'s four handles (D278: BESIDE the Extend ghost\'s, where D258 had them replace it: row 14d); a drag moves the number of its box in ONE undo step; Shift is fine, Ctrl snaps; two quick presses reset one; an Extend takes them away', async () => {
  const P1 = await handlePanel(), { shell } = P1; P1.button('Jump').onclick(); for (let i = 0; i < 3; i++) P1.frame();
  assert.deepEqual(P1.panel.handles.handles().map((h) => h.id).filter((i) => i.startsWith('land')), ['landfwd:0', 'landleft:0', 'landup:0', 'landturn:0'], 'the four landing handles (D278: the Extend ghost\'s ten are up beside them, row 14d)'); assert.ok(P1.panel.handles.handles().every((h) => h.screen), 'all on screen');
  let seen = null; P1.doc.dispatchEvent(new P1.win.CustomEvent('t180:handles-request', { detail: { reply: (l) => { seen = l; } } })); assert.deepEqual(seen.map((h) => h.kind).filter((k) => k.startsWith('land')), ['landfwd', 'landleft', 'landup', 'landturn'], 'the read-only request lists them too');
  const pose = () => shell.landing().pose, past = () => shell.getState().history.past.length, n0 = past();
  dragBy(P1, 'landfwd:0', 100); assert.equal(pose().forward, 55, '100 px along the arrow at 0.15 m a pixel'); assert.equal(past(), n0 + 1, 'ONE undo step for the whole drag'); assert.equal(P1.input('landing forward').value, '55', 'the box shows it');
  assert.deepEqual([pose().left, pose().up, pose().heading], [0, 0, 0], 'only forward moved');
  dragBy(P1, 'landup:0', 200, { shiftKey: true }); assert.equal(pose().up, 1, 'Shift: a tenth: 200 px at 0.05 m is 10 m, a tenth of it 1 m'); dragBy(P1, 'landfwd:0', 33, { ctrlKey: true }); assert.equal(pose().forward, 60, 'Ctrl snaps forward to 5 m: 55 + 4.95 is 60');
  dragBy(P1, 'landturn:0', 100); assert.equal(pose().heading, 10, 'the heading handle: 0.1 degree a pixel'); dragBy(P1, 'landleft:0', 100); assert.equal(pose().left, 10, 'sideways: 0.1 m a pixel');
  const dl = shell.getState().history.present; assert.equal(shell.getState().history.past.length, n0 + 5);
  // two quick presses reset: sideways to 0 (and heading and height too: the zero kinds); forward is not reset to 0 but to what it was before its last drag (60 was its snap's, 55 before)
  const quick = (id, t0) => { const a = handleOf(P1, id).screen; fire(P1, 'pointerdown', a.x, a.y, { timeStamp: t0 }); fire(P1, 'pointerup', a.x, a.y, { timeStamp: t0 + 40 }); fire(P1, 'pointerdown', a.x, a.y, { timeStamp: t0 + 200 }); fire(P1, 'pointerup', a.x, a.y, { timeStamp: t0 + 240 }); P1.frame(); };
  quick('landleft:0', STAMP + 1e5); assert.equal(pose().left, 0, 'sideways reset to 0'); quick('landturn:0', STAMP + 3e5); assert.equal(pose().heading, 0); quick('landup:0', STAMP + 6e5); assert.equal(pose().up, 0);
  assert.ok(past() > n0 + 5, 'each reset is an undo step'); P1.shell.undo(); assert.equal(pose().up, 1, 'Undo gives the reset back');
  // an Extend fixes the landing: its handles go, the Extend ghost's come back
  P1.button('Extend').onclick(); for (let i = 0; i < 40; i++) P1.frame(); assert.equal(P1.panel.handles.handles().length, 10, 'the Extend handles are back, the landing\'s are gone'); assert.ok(!P1.panel.handles.handles().some((h) => h.kind.startsWith('land')));
  // the switch turns them off
  shell.removeHead(); for (let i = 0; i < 3; i++) P1.frame(); assert.equal(P1.panel.handles.handles().filter((h) => h.kind.startsWith('land')).length, 4, 'back on the landing'); P1.input('drag handles').checked = false; P1.input('drag handles').onchange(); for (let i = 0; i < 3; i++) P1.frame(); assert.deepEqual(P1.panel.handles.handles(), [], 'the switch is off');
  P1.panel.unmount();
});

test('row 14d (D278, the keeper: "after placing jump piece, it doesnt go back to regular track manipulation with the base equation, it stays the heading, sideways, and height"): right after Jump the Extend ghost\'s handles are up BESIDE the landing\'s four; an Extend handle types into its field and edits no document; a landing handle still moves the landing in ONE undo step; Extend fixes the landing, and its handles go', async () => {
  const P1 = await handlePanel(), { shell } = P1, box = landingBoxOf(P1);
  const EXT = ['length:0', 'width:1', 'width:-1', 'bank:1', 'bank:-1', 'cup:1', 'cup:-1', 'turn:1', 'turn:-1', 'climb:0'], LAND = ['landfwd:0', 'landleft:0', 'landup:0', 'landturn:0'];
  const settle = () => { for (let i = 0; i < 40; i++) P1.frame(); }, idsOf = () => P1.panel.handles.handles().map((h) => h.id);
  P1.button('Jump').onclick(); settle();
  // 1  both sets: the landing's four (the landing is the head, still tunable) AND the Extend ghost's ten (the base equation's controls for the piece that comes next)
  assert.deepEqual(idsOf().filter((i) => i.startsWith('land')), LAND, 'the landing\'s four are up'); assert.deepEqual(idsOf().filter((i) => !i.startsWith('land')), EXT, 'and the Extend ghost\'s ten, as before the jump');
  assert.ok(P1.panel.handles.handles().every((h) => h.screen), 'all on screen'); assert.equal(box.style.display, '', 'the landing\'s boxes are up too');
  let seen = null; P1.doc.dispatchEvent(new P1.win.CustomEvent('t180:handles-request', { detail: { reply: (l) => { seen = l; } } })); assert.deepEqual(seen.map((h) => h.id).sort(), [...LAND, ...EXT].sort(), 'the read-only request lists all fourteen');
  // 2  an Extend handle types into its field: no document edit, nothing in Undo, the landing where it was
  const d0 = shell.getState().history.present, past0 = shell.getState().history.past.length, pose0 = shell.landing().pose, turn = fieldOf(P1, 'turn °/100m'), len = fieldOf(P1, 'length m');
  const t0 = Number(turn.value); dragBy(P1, 'turn:1', 40); assert.equal(Number(turn.value), Math.round((t0 + 3.32) * 10) / 10, 'the turn field took the drag (0.083 a degree per 100 m per pixel)');
  const l0 = len.value; dragBy(P1, 'length:0', 50); assert.notEqual(len.value, l0, 'the length field took the drag');
  assert.equal(shell.getState().history.present, d0, 'an Extend handle is no document edit'); assert.equal(shell.getState().history.past.length, past0, 'nothing in Undo'); assert.deepEqual(shell.landing().pose, pose0, 'the landing did not move');
  settle(); assert.equal(idsOf().length, 14, 'both sets are still up after the drags');
  // 3  a landing handle still moves the landing, in ONE undo step, and leaves the fields alone
  const turnTyped = turn.value; dragBy(P1, 'landfwd:0', 100); assert.equal(shell.landing().pose.forward, 55, '100 px along the arrow at 0.15 m a pixel'); assert.equal(shell.getState().history.past.length, past0 + 1, 'ONE undo step for the whole drag'); assert.equal(turn.value, turnTyped, 'the Extend fields are untouched');
  settle(); assert.equal(idsOf().length, 14);
  // 4  the landing's number boxes still tune it while it is the head, with the Extend handles up
  const LB = (n) => P1.input(`landing ${n}`); LB('up').value = '2'; LB('up').onchange(); assert.equal(shell.landing().pose.up, 2); settle(); assert.equal(idsOf().length, 14);
  // 4b what was typed or dragged into the Extend fields survives a landing move (the move is a new document, and the panel used to refill every field from the head); a field nobody touched follows the head
  const bank = fieldOf(P1, 'bank °'), bank0 = bank.value, turnKept = turn.value, lenKept = len.value; assert.notEqual(turnKept, String(t0), 'control: the turn field holds the dragged value');
  LB('bank').value = '6'; LB('bank').onchange(); settle(); assert.equal(turn.value, turnKept, 'the dragged turn survived the landing move'); assert.equal(len.value, lenKept, 'and the dragged length');
  assert.notEqual(bank.value, bank0, 'the bank nobody typed follows the head: the landing road\'s bank moved with the landing\'s'); assert.equal(idsOf().length, 14);
  // 5  Extend places the piece the fields (and the dragged handles) describe, FIXES the landing: its boxes and handles go, the Extend ghost's ten stay
  const n = shell.getState().history.present.pieces.length; P1.button('Extend').onclick(); settle();
  assert.equal(shell.getState().history.present.pieces.length, n + 1, 'Extend placed a piece after the landing'); assert.equal(shell.landing(), null, 'the landing is not the head any more'); assert.equal(box.style.display, 'none', 'the landing\'s boxes are gone');
  assert.deepEqual(idsOf(), EXT, 'the road\'s handles only, no landing arrows'); assert.ok(!P1.panel.handles.handles().some((h) => h.kind.startsWith('land')));
  // 6  deleting back to the landing makes it the head again: its boxes and its handles come back beside the Extend ghost's
  shell.removeHead(); settle(); assert.equal(box.style.display, ''); assert.deepEqual(idsOf().filter((i) => i.startsWith('land')), LAND); assert.equal(idsOf().length, 14);
  // 7  the switch turns every one of them off
  P1.input('drag handles').checked = false; P1.input('drag handles').onchange(); settle(); assert.deepEqual(idsOf(), [], 'the switch is off: no handles at all');
  P1.panel.unmount();
});

test('row 14e (D278): a hover on Jump shows the jump ghost with no Extend handles on it, while a landing\'s own handles stay; a hover on Extend with a landing as the head shows the Extend ghost\'s handles; Sculpt takes the landing\'s handles away as before', async () => {
  const P1 = await handlePanel(), { shell } = P1, settle = () => { for (let i = 0; i < 40; i++) P1.frame(); }, idsOf = () => P1.panel.handles.handles().map((h) => h.id);
  P1.button('Jump').onclick(); settle(); assert.equal(idsOf().length, 14);
  // a jump's ghost (hover on Jump) is not Extend's: no Extend handles on it; the landing of the track that is already placed keeps its four
  P1.button('Jump').onmouseenter(); settle(); assert.deepEqual(idsOf(), ['landfwd:0', 'landleft:0', 'landup:0', 'landturn:0'], 'a jump\'s ghost carries none of Extend\'s handles');
  P1.button('Jump').onmouseleave(); settle(); assert.equal(idsOf().length, 14, 'the Extend handles come back with the ghost gone');
  // sculpt: the landing is not a sculpt target; the handles are the selected piece\'s or none
  P1.input('sculpt on').checked = true; P1.input('sculpt on').onchange(); settle(); assert.ok(!idsOf().some((i) => i.startsWith('land')), 'no landing arrows while sculpting');
  P1.panel.unmount();
});

const gripsOf = (shell) => shell.getState().history.present.pieces.map((p) => D.gripOf(p));
test('row 16: the Grip field in Extend (D261): it shows the head\'s grip, "grip like…" fills it from a known track, a changed value is the new piece\'s grip and the next piece keeps it, the words say untested outside 60 to 110 and that the checker does not model grip; 49, 151 and 100.5 are refused; Undo gives the head\'s back', async () => {
  const P1 = await handlePanel(), { shell } = P1, grip = P1.input('grip'), like = P1.all().find((e) => e.tagName === 'SELECT' && e.attrs['aria-label'] === 'grip like known track'), note = () => P1.text('what the grip means');
  assert.equal(grip.value, '100', 'a track with no grip set: AC\'s own road'); assert.ok(like, 'a "grip like…" drop-down beside it'); assert.deepEqual(P1.all().filter((e) => e.tagName === 'LABEL' && e.children[0] && /^grip/.test(e.children[0].textContent)).map((e) => e.children[0].textContent).slice(0, 2), ['grip %', 'grip like…'], 'the grip box and its drop-down side by side in Extend (the selection has its own pair further down)');
  const opts = like.children.map((o) => [o.value, o.textContent]); assert.deepEqual(opts[0], ['', 'grip like…'], 'the placeholder first'); assert.ok(opts.some(([v, t]) => v === '82' && t === 'Thunderhead, 82%'), 'a known track with its measured grip'); assert.ok(opts.every(([v]) => v === '' || (Number.isInteger(Number(v)) && Number(v) >= 50 && Number(v) <= 150)), 'every entry is a grip the field takes');
  assert.equal(note(), 'Grip 100%', 'D267: just the grip'); assert.match(grip.attrs.title, /100% is AC's own road/, 'the explanation is the field\'s tooltip');
  // a pick fills the field, and its words follow
  like.value = '82'; like.onchange(); assert.equal(grip.value, '82', 'the pick filled the field'); assert.equal(like.value, '', 'the drop-down goes back to its placeholder'); assert.equal(note(), 'Grip 82%');
  // outside 60 to 110: untested, in words; and the checker is always said not to model it
  for (const [v, untested] of [['59', true], ['60', false], ['110', false], ['111', true], ['50', true], ['150', true]]) { grip.value = v; grip.oninput(); assert.equal(/untested/.test(note()), untested, `${v}%`); assert.doesNotMatch(note(), /checker|drive it in AC/, 'D267: the sentence about the checker is cut, not moved'); }
  // refused in words: 49, 151, 100.5, a word
  for (const [v, re] of [['49', /from 50 to 150 percent \(49 is outside it\)/], ['151', /from 50 to 150 percent \(151 is outside it\)/], ['100.5', /WHOLE percent \(100\.5 is not\): try 101/], ['abc', /whole percent from 50 to 150: type a number/]]) { grip.value = v; grip.oninput(); assert.match(note(), re, v); }
  // a refused value is not an Extend: nothing placed, the core's refusal said
  const n0 = shell.getState().history.present.pieces.length; for (const v of ['49', '151', '100.5']) { grip.value = v; grip.oninput(); P1.button('Extend').onclick(); assert.equal(shell.getState().history.present.pieces.length, n0, `${v}: nothing placed`); assert.match(shell.getState().message, /grip/i, v); }
  // 85: the new piece's grip; the field then shows it, and the next Extend keeps it with no typing
  grip.value = '85'; grip.oninput(); P1.button('Extend').onclick(); assert.deepEqual(gripsOf(shell).slice(5), [85]); assert.equal(grip.value, '85', 'the head\'s grip is shown'); assert.equal(shell.pieceReadouts()[5].gripPct, 85, 'the readout carries it');
  P1.button('Extend').onclick(); assert.deepEqual(gripsOf(shell).slice(5), [85, 85], 'left as shown, the next piece keeps the head\'s grip');
  grip.value = '100'; grip.oninput(); P1.button('Extend').onclick(); assert.deepEqual(gripsOf(shell).slice(5), [85, 85, 100]); assert.ok(!('grip' in shell.getState().history.present.pieces[7]), '100 writes no grip at all');
  // Undo gives the head's grip back
  shell.undo(); assert.equal(grip.value, '85', 'after Undo the field shows the head\'s grip again'); shell.undo(); shell.undo(); assert.equal(grip.value, '100', 'back to the track as it was');
  // blank: the new piece keeps the head's
  grip.value = ''; grip.oninput(); P1.button('Extend').onclick(); assert.deepEqual(gripsOf(shell).slice(5), [100]);
  P1.panel.unmount();
});

test('row 16b: the selected pieces\' grip (D261): the box shows the pieces\' grip (blank where they differ), Set grip is ONE undo step on the road pieces and keeps the selection, "grip like…" fills the box, 49/151/100.5 are refused in words, 100 writes no grip, a flight alone is refused, Undo restores', async () => {
  const P1 = await mountPanel(), { shell } = P1;   // (a five-piece track)
  const box = P1.input('selection grip'), setBtn = P1.button('Set grip'), like = P1.all().find((e) => e.tagName === 'SELECT' && e.attrs['aria-label'] === 'selection grip like');
  assert.equal(setBtn.disabled, true, 'nothing selected: no grip to set'); assert.equal(box.disabled, true);
  shell.selectPiece(1); shell.selectPiece(3, { extend: true }); assert.equal(setBtn.disabled, false); assert.equal(box.value, '100', 'the selected pieces\' grip');
  const past0 = shell.getState().history.past.length, d0 = shell.getState().history.present;
  box.value = '85'; setBtn.onclick(); assert.deepEqual(gripsOf(shell), [100, 85, 85, 85, 100], 'the three selected road pieces'); assert.equal(shell.getState().history.past.length, past0 + 1, 'ONE undo step'); assert.equal(shell.selectionInfo().count, 3, 'the selection is kept');
  assert.match(shell.getState().message, /^grip 85% on 3 pieces$/); assert.equal(shell.getState().messageKind, 'ok'); assert.equal(box.value, '85', 'the box shows the new grip');
  // Undo restores the very same document
  shell.undo(); assert.equal(shell.getState().history.present, d0, 'Undo gives the same document back'); assert.deepEqual(gripsOf(shell), [100, 100, 100, 100, 100]);
  // a mixed selection: blank
  shell.selectPiece(1); box.value = '90'; setBtn.onclick(); shell.selectPiece(0); shell.selectPiece(2, { extend: true }); assert.equal(box.value, '', 'the pieces differ: blank'); assert.deepEqual(gripsOf(shell), [100, 90, 100, 100, 100]);
  // untested outside 60 to 110, said in the message
  box.value = '55'; setBtn.onclick(); assert.match(shell.getState().message, /^grip 55% on 3 pieces \(untested: drive it\)$/); box.value = '120'; setBtn.onclick(); assert.match(shell.getState().message, /untested: drive it/);
  // 100 writes no grip at all
  box.value = '100'; setBtn.onclick(); assert.ok(shell.getState().history.present.pieces.slice(0, 3).every((p) => !('grip' in p)), '100 is the plain piece'); const same = shell.getState().history.present; box.value = '100'; setBtn.onclick(); assert.equal(shell.getState().history.present, same); assert.match(shell.getState().message, /already have grip 100%/);
  // refused in words, nothing changed, no undo step
  const keep = shell.getState().history.present, n = shell.getState().history.past.length;
  for (const [v, re] of [['49', /from 50 to 150 percent \(49 is outside it\)/], ['151', /from 50 to 150 percent \(151 is outside it\)/], ['100.5', /WHOLE percent/], ['', /type a number/]]) { box.value = v; setBtn.onclick(); assert.match(shell.getState().message, re, v); assert.equal(shell.getState().history.present, keep, `${v}: nothing changed`); assert.equal(shell.getState().history.past.length, n); }
  // a pick from "grip like…" fills the box (it is not a Set grip)
  like.value = '82'; like.onchange(); assert.equal(box.value, '82'); assert.equal(like.value, ''); assert.equal(shell.getState().history.present, keep, 'a pick changes nothing until Set grip'); setBtn.onclick(); assert.deepEqual(gripsOf(shell).slice(0, 3), [82, 82, 82]);
  assert.ok(like.children.length > 5 && like.children[0].textContent === 'grip like…');
  // a flight: the road next to it is set, the flight alone is refused
  const j = await mountPanel(); j.shell.jump(null); const jd = j.shell.getState().history.present; assert.deepEqual(jd.pieces.map((p) => p.type).slice(-2), ['flight', 'road']);
  j.shell.selectPiece(5); j.input('selection grip').value = '90'; j.button('Set grip').onclick(); assert.match(j.shell.getState().message, /^the selection has no road piece: only road has grip$/); assert.equal(j.shell.getState().history.present, jd);
  j.shell.selectPiece(5); j.shell.selectPiece(6, { extend: true }); j.input('selection grip').value = '90'; j.button('Set grip').onclick(); assert.deepEqual(j.shell.getState().history.present.pieces.map((p) => D.gripOf(p)), [100, 100, 100, 100, 100, 100, 90], 'the landing road is set; the flight has no grip to set');
  // no selection: said in words
  const e = await mountPanel(); e.shell.extend({ length: 100 }); e.shell.setGrip(90); assert.match(e.shell.getState().message, /^select the pieces first/);
  P1.panel.unmount(); j.panel.unmount(); e.panel.unmount();
});

test('row 16c: the track coloured by grip (D261): blue below 100, white at 100, orange above; the layer draws each road piece in its colour only while "colour by grip" is ticked; the hover label says "grip 85%" for a piece off 100 (always while the view is on) and nothing for a plain piece', async () => {
  const GR = require('../core/griplayer.js'), LB = require('../core/labels.js');
  assert.equal(GR.gripColour(100), '#ffffff', 'AC\'s own road is white'); assert.equal(GR.gripColour(50), '#2678ff', 'the least grip: full blue'); assert.equal(GR.gripColour(150), '#ff8c14', 'the most: full orange'); assert.equal(GR.gripColour(1000), GR.gripColour(150)); assert.equal(GR.gripColour(0), GR.gripColour(50), 'clamped');
  const ch = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const b75 = ch(GR.gripColour(75)), w = ch('#ffffff'), lo = ch('#2678ff'); assert.ok(b75.every((v, i) => v >= Math.min(w[i], lo[i]) && v <= Math.max(w[i], lo[i])), '75% is between blue and white');
  assert.ok(ch(GR.gripColour(125))[2] < ch(GR.gripColour(100))[2] && ch(GR.gripColour(125))[0] === 255, '125% is orange-ward');
  const P1 = await handlePanel(), { shell } = P1; shell.selectPiece(1); shell.selectPiece(2, { extend: true }); P1.input('selection grip').value = '70'; P1.button('Set grip').onclick(); shell.selectPiece(3); P1.input('selection grip').value = '130'; P1.button('Set grip').onclick();
  assert.deepEqual(gripsOf(shell), [100, 70, 70, 130, 100]); for (let i = 0; i < 3; i++) P1.frame();
  // the pure lines: one per road piece, with its grip and colour
  const tr = { segments: shell.getState().resolved.segments, path: G.buildPath(shell.getState().resolved.segments, { step: 2, closed: false, start: shell.getState().resolved.start }) }, pose = { eye: [0, 400, -300], target: [0, 0, 100], up: [0, 1, 0], fov: 1 };
  const lines = GR.gripLines(tr, shell.getState().history.present, pose, 900, 600); assert.ok(lines.length >= 5, 'every road piece is drawn'); for (const l of lines) { assert.equal(l.grip, gripsOf(shell)[Number(l.id.slice(1)) - 1]); assert.equal(l.colour, GR.gripColour(l.grip)); }
  assert.deepEqual(GR.gripLines(tr, null, pose, 900, 600), []); assert.deepEqual(GR.gripLines(null, shell.getState().history.present, pose, 900, 600), []);
  // the layer: off until ticked
  const layer = P1.panel.gripLayer, box = P1.input('colour by grip'); assert.equal(layer.visible(), false); P1.frame(); assert.deepEqual(layer.lines(), [], 'off: nothing drawn');
  box.checked = true; box.onchange(); assert.equal(layer.visible(), true); P1.frame(); P1.frame(); assert.ok(layer.lines().length >= 1, 'on: the pieces in view are drawn (the stub preview looks at the end of the track)'); assert.ok(layer.lines().every((l) => l.colour === GR.gripColour(l.grip) && [70, 100, 130].includes(l.grip)), 'each in the colour of its grip');
  box.checked = false; box.onchange(); P1.frame(); assert.deepEqual(layer.lines(), [], 'off again');
  // the hover label's words: a piece off 100 says its grip; a plain one does not, unless the view is on
  const reads = shell.pieceReadouts(); assert.deepEqual(LB.labelText(reads[0]), ['300.0 m', 'turn 0.0° · climb 0.0° · bank 0.0°'], 'a plain piece: the label is as it was'); assert.match(LB.labelText(reads[1])[1], /· grip 70%$/); assert.match(LB.labelText(reads[3])[1], /· grip 130%$/);
  assert.match(LB.labelText(reads[0], true)[1], /· grip 100%$/, 'the view on: every piece says it'); assert.deepEqual(LB.labelText({ ...reads[0], gripPct: undefined }, true), LB.labelText(reads[0]), 'a readout without a grip adds nothing');
  P1.panel.unmount();
});

test('row 17: the grip UI modules load in the webview loader with NO node built-in (D263: piecesui and griplayer required src/core/document.js, which pulls tools/piecewise.cjs and node\'s fs, and the panel failed to load), and their copy of the grip numbers is the core\'s', async () => {
  const { loadCjs } = require('../lib/cjs.js');
  for (const f of ['app/core/gripvals.js', 'app/core/griplike.js', 'app/core/griplayer.js', 'app/core/piecesui.js', 'app/core/labels.js', 'app/core/panel.js']) {
    const M = await loadCjs(f, async (p) => fs.readFileSync(path.join(REPO, p), 'utf8'));   // no builtins: any `fs` require anywhere below it is a refusal
    assert.ok(M && typeof M === 'object', f);
  }
  const GV = require('../core/gripvals.js'), GL = require('../core/griplike.js');
  assert.deepEqual([GV.GRIP_MIN, GV.GRIP_MAX, GV.GRIP_DEFAULT], [D.GRIP_MIN, D.GRIP_MAX, D.GRIP_DEFAULT], 'the numbers are the core\'s');
  assert.deepEqual([GL.GRIP_MIN, GL.GRIP_MAX], [D.GRIP_MIN, D.GRIP_MAX]);
  const plain = D.createDoc('g'), withG = D.setGrip(extend(plain, { length: 100, family: 'bowl' }), [0], 85);
  for (const P of [...extend(plain, { length: 100, family: 'bowl' }).pieces, ...withG.pieces, { type: 'flight' }, null]) assert.equal(GV.gripOf(P), P ? D.gripOf(P) : 100, 'gripOf agrees with the core\'s on a plain piece, a piece with grip, a flight and nothing');
});

test('row 18: the CHEAP ghost while a handle is dragged (D266 item 2): every step of a drag asks the preview for a cheap ghost, the release asks for the full one, typing in a field and hovering Extend ask for the full one', async () => {
  const P1 = await handlePanel(), { S } = P1, cheaps = () => (S.cheaps || []).slice();
  P1.input('grip').oninput(); const typed = cheaps(); assert.ok(typed.length >= 1 && typed.every((c) => c === false), 'typing in a field: the full ghost');
  const n0 = cheaps().length, a = handleOf(P1, 'turn:1').screen; fire(P1, 'pointerdown', a.x, a.y); assert.equal(cheaps().length, n0, 'a press alone asks for nothing');
  for (const k of [10, 20, 30]) { fire(P1, 'pointermove', a.x - k, a.y); P1.frame(); }
  const during = cheaps().slice(n0); assert.ok(during.length >= 3, 'a ghost per step: ' + during.length); assert.ok(during.every((c) => c === true), 'every step of the drag is cheap: ' + JSON.stringify(during));
  const m = cheaps().length; fire(P1, 'pointerup', a.x - 30, a.y); const after = cheaps().slice(m); assert.ok(after.length >= 1, 'the release builds a ghost'); assert.equal(after[after.length - 1], false, 'the LAST one is the full ghost');
  // the next hover/typing is full again
  const k = cheaps().length; P1.input('grip').oninput(); assert.equal(cheaps()[k], false); P1.button('Extend').onmouseenter(); assert.equal(cheaps()[cheaps().length - 1], false, 'hovering Extend: the full ghost');
  // a second drag is cheap again, and Extend after it places the track and clears the ghost
  const b = handleOf(P1, 'length:0').screen; fire(P1, 'pointerdown', b.x, b.y); fire(P1, 'pointermove', b.x + b.dx * 5, b.y + b.dy * 5); P1.frame(); assert.equal(cheaps()[cheaps().length - 1], true, 'the second drag is cheap too'); fire(P1, 'pointerup', b.x + b.dx * 5, b.y + b.dy * 5); assert.equal(cheaps()[cheaps().length - 1], false);
  P1.panel.unmount();
});

// D267 (the keeper, relaying a tester: "too much damn text on the left side that overwhelmed chase ... what tf is the copy code paste code t180 code here??? the values or degrees for the track needs to be in a better spot to be seen")
const leafText = (P1) => P1.all().filter((e) => !(e.children && e.children.length) && e.textContent).map((e) => e.textContent).join('\n');
test('row 19: no help paragraph stays in the left column (D267): the tube width, the grip, the turn-0 hint, the jump and the landing show only a few words or nothing, and the words are tooltips', async () => {
  const P1 = await handlePanel(), { shell } = P1, field = (t) => fieldOf(P1, t), tube = field('tube sweep °'), width = field('width m'), grip = P1.input('grip');
  const GONE = [/does not model grip/, /drive it in AC/, /eases over the whole piece/, /distance ROUND it/, /Move the landing: drag/, /Jump places the piece above/, /paste a t180 code here/, /Set the piece's climb first/];
  const check = (what) => { const t = leafText(P1); for (const re of GONE) assert.doesNotMatch(t, re, `${what}: no paragraph says ${re}`); };
  check('at the start');
  // the tube width: a few words under the field, the explanation a tooltip
  tube.value = '360'; tube.oninput(); width.value = '45'; width.oninput(); const wn = () => P1.text('what the width means for a tube'); assert.equal(wn(), '≈ 14.3 m across'); check('a tube');
  assert.match(width.attrs.title, /distance ROUND it, not across\. 45 m round is a tube 14\.3 m across \(w\/π\)\./, 'the width field\'s tooltip carries the explanation'); tube.value = '0'; tube.oninput(); assert.equal(wn(), '', 'not a tube: nothing'); assert.doesNotMatch(width.attrs.title, /distance ROUND/, 'and the tooltip is the plain one again');
  // grip: just the grip; the tooltip has what 100% is
  grip.value = '130'; grip.oninput(); assert.equal(P1.text('what the grip means'), 'Grip 130% · untested'); check('grip 130'); assert.match(grip.attrs.title, /100% is AC's own road.*untested: drive it/);
  // the turn-0 hint: the "at start" box's tooltip, no paragraph
  P1.shell.extend({ length: 100, targets: { kh: 30 * Math.PI / 180 / 100 } }); P1.frame(); field('turn °/100m').value = '0'; field('turn °/100m').oninput(); check('turn 0'); assert.match(P1.all().find((e) => e.attrs['aria-label'] === 'turn at the start').attrs.title, /turn 0 eases over the whole piece: tick "at start"/);
  // the jump and the landing: no text; their words are the button's and the block's tooltips
  P1.button('Jump').onclick(); P1.frame(); check('a landing'); assert.equal(P1.text('jump note'), ''); assert.match(P1.button('Jump').attrs.title, /drive it in AC/);
  P1.panel.unmount();
});

test('row 19b: the values of the piece being edited are drawn LARGE over the 3D view (D267): length, turn, climb, bank and width, updated as a handle is dragged or a field is typed, hidden on a closed loop', async () => {
  const VO = require('../core/valuesoverlay.js'), P1 = await handlePanel(), { shell } = P1, layer = P1.panel.values;
  assert.ok(layer, 'the panel mounts the overlay on the preview stage'); const shown = () => layer.entries() && Object.fromEntries(layer.entries().map((e) => [e.key, e.value]));
  P1.frame(); const first = shown(); assert.ok(first && ['length', 'turn', 'climb', 'bank', 'width'].every((k) => typeof first[k] === 'string' && first[k] !== ''), JSON.stringify(first)); assert.equal(first.length, '100.0 m'); assert.equal(first.width, '31 m');
  // typing: it follows at once
  fieldOf(P1, 'length m').value = '250'; fieldOf(P1, 'length m').oninput(); assert.equal(shown().length, '250.0 m'); fieldOf(P1, 'turn °/100m').value = '12'; fieldOf(P1, 'turn °/100m').oninput(); assert.equal(shown().turn, P1.all().find((e) => e.attrs['data-readout'] === 'turn').textContent, 'the overlay says what the panel\'s own readout says'); assert.notEqual(shown().turn, '0.0°', 'a typed turn shows');
  fieldOf(P1, 'bank °').value = '20'; fieldOf(P1, 'bank °').oninput(); assert.match(shown().bank, /^\+/); fieldOf(P1, 'width m').value = '40'; fieldOf(P1, 'width m').oninput(); assert.equal(shown().width, '40 m');
  // a handle drag: the numbers move with each step
  fieldOf(P1, 'turn °/100m').value = '0'; fieldOf(P1, 'turn °/100m').oninput(); const before = shown().turn, a = handleOf(P1, 'turn:1').screen; fire(P1, 'pointerdown', a.x, a.y); fire(P1, 'pointermove', a.x - 40, a.y); P1.frame(); const mid = shown().turn; fire(P1, 'pointermove', a.x - 80, a.y); P1.frame(); const later = shown().turn; fire(P1, 'pointerup', a.x - 80, a.y);
  assert.notEqual(mid, before, 'the first step changed the turn on screen'); assert.notEqual(later, mid, 'the next step changed it again');
  // the layer: a big font, over the view, not in the way of a click, at the one spot
  assert.match(layer.layer.style.cssText, /font:bold 2[0-9]px/, 'large type'); assert.ok(layer.layer.style.cssText.includes(VO.SPOT_CSS), 'at the spot the constant names'); assert.match(layer.layer.style.cssText, /pointer-events:none/);
  // the pure part, and nothing to show: hidden
  assert.deepEqual(VO.entries({ length: '10.0 m', turn: '0.0°', climb: '0.0°', bank: '0.0°' }, '31 m').map((e) => e.key), ['length', 'turn', 'climb', 'bank', 'width']); assert.equal(VO.entries(null, '31 m'), null); assert.deepEqual(VO.entries({ length: '10.0 m' }, '').map((e) => e.key), ['length']);
  const lap = await handlePanel(); lap.shell.extend({ length: 300, family: 'bowl' }); for (let i = 0; i < 4; i++) lap.shell.extend({ length: Q, transition: 40, targets: { kh: 1 / R } }); lap.shell.extend({ length: 60, transition: 40, targets: { kh: 0 } }); lap.shell.close(); assert.ok(lap.shell.getState().history.present.closed); lap.frame();
  assert.equal(lap.panel.values.visible(), false, 'a closed loop has no piece being edited: hidden'); lap.panel.unmount(); P1.panel.unmount();
});

test('row 19c: the share codes are in the ⋯ menu as "Copy track code" and "Paste track code…" (D267), not a section of the left column; the code itself is unchanged', async () => {
  const html = fs.readFileSync(path.join(REPO, 'app/index.html'), 'utf8'), menu = html.slice(html.indexOf('<details id="more"'), html.indexOf('</details>', html.indexOf('<details id="more"')));   // (D269 added the Pieces menu before it: the ⋯ menu is found by its own id)
  assert.ok(menu.includes('id="share"'), 'the share block is inside the ⋯ menu'); assert.ok(!/<aside id="side">[\s\S]*id="share"[\s\S]*<\/aside>/.test(html), 'and not in the left column');
  const src = fs.readFileSync(path.join(REPO, 'app/share/index.js'), 'utf8'); assert.ok(src.includes("textContent: 'Copy track code'") && src.includes("textContent: 'Paste track code…'"), 'the buttons are named for what they are'); assert.ok(!/paste a t180 code here/.test(src), 'the box does not say "t180 code"');
  // unchanged: a code made and read exactly as before (share-install.test.js has the full set)
  const { createShare } = require('../share/share.js'), a = await track(), code = await createShare(a).copyTrack(), b = await createCoreShell({ brushFn: null }); b.extend({ length: 50 });
  const r = await createShare(b).paste(code); assert.equal(r.kind, 'e', r.message); assert.equal(D.serialize(b.getState().history.present), D.serialize(a.getState().history.present));
});

// D269 (the keeper, 10:26: "take the saved pieces off the side, and add it somewhere to the top bar, and it will have like a drop down menu where all the saved pieces will be, think of like a sony vegas or something")
test('row 20: the saved pieces are a drop-down bin in the top bar, not a section of the left column (D269): a row per piece with its thumbnail, name and summary; Add at head, Add mirrored, Rename and Delete; a click on the row adds it; the empty words are in the menu; Save as piece stays with the selection', async () => {
  const st = store(), P1 = await mountPanel(st, { bin: true }), { shell } = P1, tick = () => new Promise((r) => setImmediate(r));
  // the library is not in the left column
  assert.deepEqual(P1.all().filter((e) => e.attrs['aria-label'] === 'saved pieces' || e.attrs['data-piece'] || e.attrs['aria-label'] === 'mirror on insert'), [], 'nothing of the library is under the panel root'); assert.ok(!P1.all().some((e) => e.tagName === 'H3' && /Pieces library/.test(e.textContent)), 'no "Pieces library" heading in the left column');
  assert.ok(P1.binAll().some((e) => e.attrs['aria-label'] === 'saved pieces'), 'the list is in the menu'); await tick(); assert.match(P1.binAll().map((e) => e.textContent).join('|'), /No saved pieces yet: select pieces on the track and press Save as piece\./, 'the empty words are in the menu');
  // Save as piece stays with the selection; after a save the piece is in the menu
  P1.click(400); P1.click(550, { shiftKey: true }); assert.equal(P1.button('Save as piece').disabled, false, 'Save as piece is in the left column, with the selection'); assert.equal(P1.binButton('Save as piece'), undefined);
  P1.input('piece name').value = 'two turns'; P1.button('Save as piece').onclick(); await tick(); await tick(); await tick();
  const row = () => P1.binRows()[0]; assert.equal(P1.binRows().length, 1); assert.equal(row().attrs['data-piece'], 'two turns');
  assert.ok(row().all().some((e) => e.tagName === 'CANVAS' && e.attrs['aria-label'] === 'plan view of two turns'), 'its thumbnail'); assert.match(P1.binAll().find((e) => e.attrs['aria-label'] === 'two turns details').textContent, /^2 pieces · 300 m · turn \+\d+\.\d° · climb 0\.0° · plain$/, 'its one-line summary'); assert.ok(row().textContent.includes('two turns'), 'its name');
  // Add at head: one undo step
  const n0 = shell.getState().history.present.pieces.length, past0 = shell.getState().history.past.length;
  P1.binButton('Add at head').onclick(); await tick(); await tick(); assert.equal(shell.getState().history.present.pieces.length, n0 + 2); assert.equal(shell.getState().history.past.length, past0 + 1, 'ONE undo step');
  // Add mirrored: its own button on the row, the mirror image
  const n1 = shell.getState().history.present.pieces.length; P1.binButton('Add mirrored').onclick(); await tick(); await tick(); assert.equal(shell.getState().history.present.pieces.length, n1 + 2); assert.match(shell.getState().message, /mirrored/);
  // a click on the row (not on a button) adds it at the head; a click on one of its buttons is that button's only
  const n2 = shell.getState().history.present.pieces.length; row().onclick({ target: row() }); await tick(); await tick(); assert.equal(shell.getState().history.present.pieces.length, n2 + 2, 'a click on the row adds it at the head');
  const n3 = shell.getState().history.present.pieces.length, b = P1.binButton('Rename'); row().onclick({ target: b }); await tick(); assert.equal(shell.getState().history.present.pieces.length, n3, 'a click that began on a button is not a row click');
  // Rename and Delete from the menu, as before
  P1.binButton('Rename').onclick(); const nin = P1.binAll().find((e) => e.attrs['aria-label'] === 'new name'); assert.ok(nin); nin.value = 'bends'; P1.binButton('OK').onclick(); await tick(); await tick(); await tick(); assert.deepEqual(await st.listPieces(), ['bends'], 'renamed'); assert.equal(P1.binRows()[0].attrs['data-piece'], 'bends');
  P1.binButtons('Delete').find((x) => x.attrs['aria-label'] === 'delete the saved piece bends').onclick(); assert.ok(P1.binButton('Yes, delete') && P1.binButton('No'), 'it asks first'); P1.binButton('No').onclick(); assert.deepEqual(await st.listPieces(), ['bends']);
  P1.binButtons('Delete').find((x) => x.attrs['aria-label'] === 'delete the saved piece bends').onclick(); P1.binButton('Yes, delete').onclick(); await tick(); await tick(); await tick(); assert.deepEqual(await st.listPieces(), []); assert.match(P1.binAll().map((e) => e.textContent).join('|'), /No saved pieces yet/);
  P1.panel.unmount();
});

test('row 20b: the Pieces menu opens and closes: it lists the pieces when opened, Esc closes it, a press outside closes it, a press inside does not; Esc with it closed does nothing; the top bar has the button beside Open… and Previous versions…', async () => {
  const st = store(), base = await track(); await st.savePiece('one', PC.serialize(PC.saveRun(base.getState().history.present, 0, 1, { name: 'one' })));
  const P1 = await mountPanel(st, { bin: true }), menu = P1.menuEl, tick = () => new Promise((r) => setImmediate(r));
  assert.equal(menu.open, false); menu.open = true; for (const f of (menu.listeners.toggle || []).slice()) f({}); await tick(); await tick(); assert.equal(P1.binRows().length, 1, 'opening it lists the saved pieces');
  P1.doc.dispatchEvent({ type: 'keydown', key: 'a' }); assert.equal(menu.open, true, 'another key leaves it'); P1.doc.dispatchEvent({ type: 'keydown', key: 'Escape' }); assert.equal(menu.open, false, 'Esc closes it');
  P1.doc.dispatchEvent({ type: 'keydown', key: 'Escape' }); assert.equal(menu.open, false, 'Esc with it closed does nothing');
  menu.open = true; P1.doc.dispatchEvent({ type: 'pointerdown', target: P1.binRows()[0] }); assert.equal(menu.open, true, 'a press inside the menu keeps it open'); P1.doc.dispatchEvent({ type: 'pointerdown', target: P1.stage }); assert.equal(menu.open, false, 'a press outside (on the 3D view) closes it');
  menu.open = true; P1.doc.dispatchEvent({ type: 'pointerdown', target: menu }); assert.equal(menu.open, true, 'a press on the Pieces button itself is the browser\'s own toggle'); menu.open = false;
  P1.panel.unmount(); P1.doc.dispatchEvent({ type: 'keydown', key: 'Escape' });   // after unmount the listeners are gone: nothing throws
  // the top bar: <details id="pieces"> beside Open and Previous versions, before the ⋯ menu; the bin inside it
  const html = fs.readFileSync(path.join(REPO, 'app/index.html'), 'utf8'), bar = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.ok(/id="open"[\s\S]*id="versions"[\s\S]*<details id="pieces"[^>]*><summary[^>]*>Pieces ▾<\/summary><div class="more-menu" id="pieces-bin"><\/div><\/details>[\s\S]*id="more"/.test(bar), 'Pieces ▾ is in the top bar between Previous versions and ⋯');
  assert.ok(!/<aside id="palette">[\s\S]*pieces-bin/.test(html.replace(bar, '')), 'and not in the left column');
});

test('row 15: the preview\'s ghostInfo says whether the ghost is a jump\'s and carries its segments (what the handles and the flight overlay read)', async () => {
  const s = await track(), pv = headlessPreview(s);
  pv.showGhost(s.candidate({ length: 100 })); let g = pv.ghostInfo(); assert.equal(g.jump, false, 'an Extend ghost is not a jump'); assert.ok(Array.isArray(g.segments) && g.segments.length > 0);
  pv.showGhost(s.candidateJump({ length: 50 })); g = pv.ghostInfo(); assert.equal(g.jump, true); assert.ok(g.segments.some((x) => x.kind === 'gap'), 'the flight is among the ghost\'s segments'); assert.ok(g.samples.length > pv.track().path.samples.length);
  pv.clearGhost(); assert.equal(pv.ghostInfo(), null); pv.dispose();
});

// D259, the keeper (18:21-18:24): the bank "continues after 360 forever instead of resetting back to 0 ... same for -360 if it banks the other way". The bank keeps within
// ONE turn and keeps its SIGN, shown and applied (370 -> 10, -370 -> -10, 300 stays 300, 400 -> 40), in the Extend field and ghost handle, Sculpt's bank handle and the bank
// brush; no nearest-equivalent rewrite; the stored winding of existing tracks and the core are untouched.
const headBank = (shell) => shell.headState().phi * 180 / Math.PI;
const extendWithBank = (P1, v) => { const b = fieldOf(P1, 'bank °'); b.value = String(v); b.oninput(); P1.frame(); P1.button('Extend').onclick(); P1.frame(); };
test('D259: a typed 300 stays 300 (one full turn either way is allowed), and a typed 400 becomes 40; the field shows them so', async () => {
  const P1 = await handlePanel(), { shell } = P1, bank = fieldOf(P1, 'bank °'); assert.ok(Math.abs(headBank(shell)) < 1e-6, 'control: the track starts upright');
  extendWithBank(P1, 300); assert.ok(Math.abs(headBank(shell) - 300) < 1e-6, `300 rolls 300: ${headBank(shell)}`); assert.equal(bank.value, '300');
  extendWithBank(P1, 400); assert.ok(Math.abs(headBank(shell) - 40) < 1e-6, `400 becomes 40: ${headBank(shell)}`); assert.equal(bank.value, '40');
});
test('D259: dragging the bank handle from 350 by about +20 gives about 10 (not 370), and from -350 by about -20 gives about -10; Extend applies what the field shows', async () => {
  for (const [from, dir] of [[350, 1], [-350, -1]]) {
    const P1 = await handlePanel(), { shell } = P1, bank = fieldOf(P1, 'bank °');
    bank.value = String(from); bank.oninput(); P1.frame();
    let steps = 0; while (Math.abs(Number(bank.value)) > 300) { if (++steps > 400) break; dragBy(P1, 'bank:1', 10 * dir); P1.frame(); }
    const shown = Number(bank.value); assert.ok(Math.sign(shown) === dir && Math.abs(shown) < 30, `from ${from} the drag wrapped back from 0, its sign kept: ${bank.value} after ${steps} drags`);
    P1.button('Extend').onclick(); P1.frame(); assert.ok(Math.abs(headBank(shell) - shown) < 0.11, `applied as shown: ${headBank(shell)} for ${shown}`);
  }
});
