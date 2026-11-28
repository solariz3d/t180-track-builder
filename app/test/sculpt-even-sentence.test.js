// sculpt-even-sentence.test.js: node --test app/test/sculpt-even-sentence.test.js
// Even's sentence AFTER the release, off the page (D678 repair, item 1; lighthouse exo_memory/handback/p-d678-even-build-A_2026-11-27.md, section 3.2, rows E1, E2,
// E4 and E5). On a 27.6 km closed lap the release waited 33 s for the check of the new middle's line; now the release (and a typed width) says the first sentence
// at once and the check runs as a job (here, with no runner, on the page in a timer after the release). Its words must be the on-page check's, character for
// character (evenwords.js evenWords on the same two documents, the whole track read), and they are said only on the document they were asked about.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../src/core/document.js');
const EV = require('../../src/core/even.js');
const EVW = require('../core/evenwords.js');
const F = require('../../test/even_fixtures.js');

const LEAVES = /leaves the road on the new middle/;
const msg = (sh) => sh.getState().message || '';
function evenDrag(sh, { from, to }, hold, value) {
  sh.selectPiece(from); if (to !== from) sh.selectPiece(to, { extend: true });
  sh.beginSculpt({ tool: 'even', hold });
  const b = sh.getState().brush; assert.ok(b && b.mode === 'even', `the drag opened: ${sh.getState().message}`);
  sh.sculptTo(value - b.value0); return sh.endSculpt();
}
/** The on-page check: the level made here, and its words read along the whole track. */
function onPage(base) { const res = EV.even(base, { ...F.runPieces(base), value: 16, hold: 'left' }); return { res, words: EVW.evenWords(base, res) }; }

for (const fx of ['B+', 'B+0', 'Bhold']) {
  test(`E1 and E2: ${fx}: the release says the first sentence at once with the check pending, and the check's words, when they land, are the on-page check's`, async () => {
    const base = F.fixture(fx), sh = await F.shellOn(base), { res, words } = onPage(base);
    const st = evenDrag(sh, F.runPieces(base), 'left', 16);
    assert.equal(D.serialize(F.present(sh)), D.serialize(res.doc), 'control: the drag laid the same level as the one made here');
    assert.ok(st.evenCheck && st.evenCheck.status === 'checking', 'E1: the check is pending after the release');
    assert.equal(msg(sh), EVW.evenDone(res), 'E1: the release says the first sentence only');
    assert.doesNotMatch(msg(sh), LEAVES, 'E1: and not the second');
    const after = await sh.whenEvenChecked();
    assert.equal(after.evenCheck, null, 'E2: the check has landed');
    assert.equal(msg(sh), words.message, 'E2: the words are the on-page check\'s, character for character');
    assert.deepEqual(sh.getState().evenLeaves, words.leaves, 'E2: and the figures behind them');
    if (fx === 'Bhold') assert.doesNotMatch(msg(sh), LEAVES, 'control: on Bhold there is no second sentence');
    else assert.match(msg(sh), LEAVES, 'control: on B+ and B+0 there is one');
  });
}

test('E4: an Undo before the check lands drops its words: the message stays the Undo\'s', async () => {
  const base = F.fixture('B+'), sh = await F.shellOn(base);
  evenDrag(sh, F.runPieces(base), 'left', 16);
  assert.ok(sh.getState().evenCheck, 'control: a check is pending');
  sh.undo(); const said = msg(sh);
  assert.equal(D.serialize(F.present(sh)), D.serialize(base), 'control: the Undo gave the track back');
  await sh.whenEvenChecked();
  assert.equal(msg(sh), said, 'the message is still the Undo\'s');
  assert.doesNotMatch(msg(sh), LEAVES);
  assert.equal(sh.getState().evenLeaves, null, 'no figures');
  assert.equal(sh.getState().evenCheck, null, 'nothing pending');
});

/** A Worker stand-in for createEvenRunner: the request is cloned as postMessage clones it, and answered later through the check job's evenCheck. */
class EvenWorker {
  constructor(url) { this.url = url; EvenWorker.made.push(this); }
  postMessage(m) { const c = structuredClone(m); setTimeout(() => { if (this.dead) return; try { this.onmessage({ data: { serial: c.serial, ok: true, even: structuredClone(JOB.evenCheck(c.even)), ms: 0 } }); } catch (e) { this.onmessage({ data: { serial: c.serial, ok: false, error: e.message } }); } }, 0); }
  terminate() { this.dead = true; }
}
EvenWorker.made = [];
const JOB = require('../validate-ui/checkjob.js');
const { createEvenRunner } = require('../validate-ui/checkrunner.js');

test('E6: B+0: with the page\'s runner, the request goes to a worker of its own as plain data, the words that come back are the on-page check\'s, and the worker is ended', async () => {
  const base = F.fixture('B+0'), { words } = onPage(base);
  EvenWorker.made = [];
  const { createCoreShell } = require('../core/coreshell.js');
  const sh = await createCoreShell({ evenRunner: createEvenRunner({ WorkerCtor: EvenWorker }) }); sh.commitDoc(base); sh.setSculpt(true);
  const st = evenDrag(sh, F.runPieces(base), 'left', 16);
  assert.equal(st.evenCheck && st.evenCheck.via, 'worker', 'the check went to the worker');
  assert.equal(EvenWorker.made.length, 1); assert.equal(EvenWorker.made[0].url, 'validate-ui/checkworker.js');
  assert.doesNotMatch(msg(sh), LEAVES, 'not said yet');
  await sh.whenEvenChecked();
  assert.equal(msg(sh), words.message, 'the on-page check\'s words');
  assert.deepEqual(sh.getState().evenLeaves, words.leaves);
  assert.equal(EvenWorker.made[0].dead, true, 'the worker was ended on its answer');
});

test('E6: the worker script answers an Even request through the check job\'s evenCheck, beside the newest-only track check', async () => {
  const fs = require('fs'), path = require('path'), vm = require('vm');
  const src = fs.readFileSync(path.join(__dirname, '..', 'validate-ui', 'checkworker.js'), 'utf8'), posted = [];
  const self = { location: { href: 'http://x/app/validate-ui/checkworker.js' }, postMessage: (m) => posted.push(m) };
  const ctx = vm.createContext({ self, importScripts: () => {}, performance, setTimeout, URL, Promise,
    loadCjs: async (p) => (p.endsWith('node-shim.js') ? { createShim: () => ({ builtins: {}, Buffer }) } : { createCheckJob: () => ({ run: (m) => ({ ran: m.serial }) }), evenCheck: (req) => ({ message: `said ${req.value}`, leaves: null }) }) });
  vm.runInContext(src, ctx);
  self.onmessage({ data: { serial: 1, even: { value: 16 } } }); self.onmessage({ data: { serial: 7 } });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(posted.filter((m) => m.even).map((m) => [m.serial, m.ok, m.even.message]), [[1, true, 'said 16']], 'the Even request was answered');
  assert.deepEqual(posted.filter((m) => m.out).map((m) => m.out.ran), [7], 'and the track check still ran its own');
});

test('E6: a request the worker cannot take is checked on the page, and a check that throws says so, keeping the first sentence', async () => {
  const base = F.fixture('B+'), { res } = onPage(base);
  const { createCoreShell } = require('../core/coreshell.js');
  class Refuses { postMessage() { throw Object.assign(new Error('could not be cloned'), { name: 'DataCloneError' }); } terminate() { this.dead = true; } }
  const sh = await createCoreShell({ evenRunner: createEvenRunner({ WorkerCtor: Refuses }) }); sh.commitDoc(base); sh.setSculpt(true);
  const st = evenDrag(sh, F.runPieces(base), 'left', 16);
  assert.equal(st.evenCheck && st.evenCheck.via, 'page', 'checked on the page');
  await sh.whenEvenChecked(); assert.match(msg(sh), LEAVES, 'and said');
  class Fails { postMessage(m) { setTimeout(() => this.onmessage({ data: { serial: m.serial, ok: false, error: 'boom' } }), 0); } terminate() {} }
  const sh2 = await createCoreShell({ evenRunner: createEvenRunner({ WorkerCtor: Fails }) }); sh2.commitDoc(base); sh2.setSculpt(true);
  evenDrag(sh2, F.runPieces(base), 'left', 16);
  await sh2.whenEvenChecked();
  assert.ok(msg(sh2).startsWith(EVW.evenDone(res)), 'the first sentence stays');
  assert.match(msg(sh2), /could not be made: boom/, 'and the failure is said');
  assert.equal(sh2.getState().messageKind, 'error');
});

test('E5: B+: a typed width says the first sentence at once, and the check\'s words, when they land, are the on-page check\'s', async () => {
  const base = F.fixture('B+'), sh = await F.shellOn(base), run = F.runPieces(base), { res, words } = onPage(base);
  sh.selectPiece(run.from); if (run.to !== run.from) sh.selectPiece(run.to, { extend: true });
  const st = sh.evenRun({ value: 16, hold: 'left' });
  assert.equal(D.serialize(F.present(sh)), D.serialize(res.doc), 'control: the same level');
  assert.ok(st.evenCheck && st.evenCheck.status === 'checking', 'the check is pending');
  assert.equal(msg(sh), EVW.evenDone(res), 'the first sentence only');
  await sh.whenEvenChecked();
  assert.equal(msg(sh), words.message, 'the on-page check\'s words');
  assert.deepEqual(sh.getState().evenLeaves, words.leaves);
});

// W1 and W2 (D678 repair, the librarian's 15:4x ruling item 3; B's read, lighthouse exo_memory/handback/p-d678-even-read-B_2026-11-27.md, 2.5): the words are
// made true to the code. The kept edge is laid where Even reads the road's own edge from the stretch's ends, and can move by metres (3.96 m on the flat turn after
// one grab), so no sentence says it "stays where it is" or "was"; and the stretch is 20 m at the width beyond each end, then a 30 m ease, not a "50 m" ease.
// the first sentence, said at once after a typed width (the check is left to land on its own)
const said = async (base, run, hold) => { const sh = await F.shellOn(base); sh.selectPiece(run.from); if (run.to !== run.from) sh.selectPiece(run.to, { extend: true }); sh.evenRun({ value: '16', hold }); return msg(sh); };
// W1 AMENDED BY NAME (D678, the packet's "Amended 17:4x" item 3, B on d678-even-b): B keeps the kept edge where it is (core_even.test.js Y1, within 0.01 m over the
// run) and the middle where it is (Y2), so the words say so: the kept edge stays and the other moves; the middle stays and both edges move. No sentence says the
// edge is read from the stretch's ends, as A0's did
test('W1: the message says the kept edge stays where it is and the other edge moves, or the middle stays and both edges move; never that Even reads the road', async () => {
  const base = F.fixture('flat'), run = F.runPieces(base);
  for (const [hold, other] of [['left', 'right'], ['right', 'left']]) {
    const m = await said(base, run, hold);
    assert.match(m, new RegExp(`the ${hold} edge stays where it is and the ${other} edge moves`), `${hold}: ${m}`);
    assert.doesNotMatch(m, /reads the road|laid smooth/, `${hold}: no A0 words`);
  }
  const m = await said(base, run, 'centre');
  assert.match(m, /the middle stays where it is, and both edges move/, m);
  assert.doesNotMatch(m, /reads the road|laid smooth/, 'centre: no A0 words');
});
// W2: not "20 m at the width, then a 30 m ease" either: where a piece's knots are coarse the width starts to ease inside the margin (13.28 m at 460 on the flat
// turn for a value of 16; the hand-back's 4.4), so the message promises only that the road is back WITHIN the window's reach, which the outside rows hold.
test('W2: the message says the road is back within the window\'s reach beyond each end (not "over" it), and where a window end is cut short by the track\'s start or the open end, that', async () => {
  const base = F.fixture('flat'), n = base.pieces.length;
  assert.match(await said(base, F.runPieces(base), 'left'), /m wide from 0\.20 km to 0\.44 km, back to the road within 50 m either side;/);
  assert.match(await said(base, { from: n - 1, to: n - 1 }, 'left'), /, back to the road within 50 m before it, and to the open end;/);
  assert.match(await said(base, { from: 0, to: 1 }, 'left'), /, from the track's start, and back to the road within 50 m after it;/);
  assert.doesNotMatch(await said(base, F.runPieces(base), 'right'), /over the 50 m|for 20 m/);
});
// W3 (D678, the packet's "Amended 17:4x" item 1, row X10 of the hand-back's 5.1): the words say what holds outside the stretch, and it holds there: beyond the
// window every channel within one stored step (a tenth of a millimetre in width, offset and height; measured on a 27.6 km closed lap, the built road 0.0123 mm).
// Not "20 m at the width": a road far from the value beyond the margin leaks into its outer metre (0.0288 m for a 31 m lead to 16; the hand-back's 5.3).
test('W3: the message says the road\'s width, line and height beyond the stretch are as they were to a tenth of a millimetre, and outside the window nothing moves past one stored step', async () => {
  const base = F.fixture('flat'), run = F.runPieces(base);
  for (const hold of ['left', 'centre']) {
    const sh = await F.shellOn(base); sh.selectPiece(run.from); sh.selectPiece(run.to, { extend: true }); sh.evenRun({ value: '16', hold });
    assert.match(msg(sh), /; beyond the stretch the road's width, line and height are as they were, to a tenth of a millimetre \(Ctrl\+Z puts it back\)\./, `${hold}: ${msg(sh)}`);
    assert.doesNotMatch(msg(sh), /20 m at|for 20 m/, `${hold}: no promise of 20 m at the width`);
    assert.deepEqual(F.outsideChanges(F.present(sh), base).slice(0, 5), [], `${hold}: outside the window`);
  }
});
