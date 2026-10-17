// core-close-mutation.test.js: node --test app/test/core-close-mutation.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D242, the safe Close and the plain-word reds (pane B), mutated. Each mutation copies app/ (every folder but test/, and its files), src/, tools/ and
// the mutant's own test files to a temp folder, applies ONE source patch, and runs those COPIED tests there, so their relative requires reach the
// mutant. "Applied" means the patch text was found exactly once; "caught" means the named test FAILED on the mutant. A CONTROL runs the unmutated
// copy of every test file first. The originals are never touched.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const LOCAL = 'test/core_close_local.test.js', PREVIEW = 'app/test/core-close-preview.test.js', GROUPS = 'app/test/redgroups.test.js', DISPLAY = 'app/test/core-readout-display.test.js', BEST = 'test/core_close_best.test.js', WORKER = 'app/test/close-worker.test.js';

const MUTATIONS = [
  // src/core/close.js: the LOCAL close (items 1 and the refusal by name)
  { id: 'K1 the columns outside the window are not fixed', file: 'src/core/close.js', from: 'fixedOf = (p) => !!free && !free.has(p);', to: 'fixedOf = (p) => false;', tests: [LOCAL], caughtBy: 'row 1: a close confined to the LAST piece' },
  { id: 'K2 the pieces outside the window are recomputed, not kept', file: 'src/core/close.js', from: "if (P.type !== 'road' || (keep && keep.has(p))) return P;", to: "if (P.type !== 'road') return P;", tests: [LOCAL], caughtBy: 'row 1: a close confined to the LAST piece' },
  { id: 'K3 a local close that does not close is handed back, not refused', file: 'src/core/close.js', from: 'if (local && !converged) throw refuse(', to: 'if (false) throw refuse(', tests: [LOCAL], caughtBy: 'row 3: a window that cannot close the loop' },
  { id: 'K4 the roll-rate bar is not read', file: 'src/core/close.js', from: 'if (after > V.ROLL_RED_DEG_M) {', to: 'if (false) {', tests: [LOCAL], caughtBy: 'row 4: a local close may not push the window past the roll-rate bar' },
  { id: 'K5 the window is not named for a person', file: 'src/core/close.js', from: "${contiguousTail ? 'the last ' : ''}", to: '', tests: [LOCAL], caughtBy: 'row 1: a close confined to the LAST piece' },
  { id: 'K6 the default window ignores the fraction (the last piece only)', file: 'src/core/close.js', from: 'want = Math.max(0, Math.min(1, fraction)) * total', to: 'want = 0', tests: [LOCAL], caughtBy: 'row 2: the default window' },
  { id: 'K7 an empty window is accepted', file: 'src/core/close.js', from: "if (!set.size) throw new D.CoreError('CLOSE_WINDOW'", to: "if (false) throw new D.CoreError('CLOSE_WINDOW'", tests: [LOCAL], caughtBy: 'row 5: a window with no road piece' },
  { id: 'A6 the refused export keeps the export\'s own message (ids)', file: 'app/core/coreshell.js', from: "e.code === 'RED' && Array.isArray(e.red) ? `not exported:", to: "false ? `not exported:", tests: [PREVIEW], caughtBy: 'row 6: a refused export names EVERY red' },
  // D339, Close is ONE press (app/core/closejob.js runCloseBest, app/core/coreshell.js closeBest). The preview's mutants went with it: A1 (the default window), A2 (a stale
  // preview kept), A3 (the preview's overlap check without folds), A4 (the overlap check skipped), A5 (Apply committing the base), A7 (the ghost) and A8 (focus on a place).
  // A9, A10 and A11 are the press's own now: its copy first, a failed copy, an edit while the copy is written. B1 to B9 are the picker's rules, one each.
  { id: 'A9 the press writes no copy from before the close', file: 'app/core/coreshell.js', from: "try { await api.backupNow('pre-close'); }", to: 'try { }', tests: [PREVIEW], caughtBy: 'row 7: the press writes the copy from BEFORE the close first' },
  { id: 'A10 a failed copy still closes', file: 'app/core/coreshell.js', from: 'catch (e) { return set({ closePending: null, message: `not closed: the copy', to: 'catch (e) { set({ closePending: null, message: `not closed: the copy', tests: [PREVIEW], caughtBy: 'row 7: the press writes the copy from BEFORE the close first' },
  { id: 'A11 an edit while the copy is written is closed over', file: 'app/core/coreshell.js', from: 'if (doc() !== base) return changed();   // an edit while the copy was written', to: 'if (false) return changed();   // an edit while the copy was written', tests: [PREVIEW], caughtBy: 'row 7: the press writes the copy from BEFORE the close first' },
  { id: 'B1 a way that does not prove is picked', file: 'app/core/closejob.js', from: 'if (c.lap && c.lap.ok === true && !t.newReds.length) return true;', to: 'return true;', tests: [BEST], caughtBy: 'row 4: when no way proves' },
  { id: 'B2 a way that adds a red is picked', file: 'app/core/closejob.js', from: 'if (c.lap && c.lap.ok === true && !t.newReds.length) return true;', to: 'if (c.lap && c.lap.ok === true) return true;', tests: [BEST], caughtBy: 'row 4: when no way proves' },
  { id: 'B3 new road is not put last', file: 'app/core/closejob.js', from: '((a.newPieces > 0) - (b.newPieces > 0)) || ', to: '', tests: [BEST], caughtBy: 'row 8: the order' },
  { id: 'B4 the most movement is tried first', file: 'app/core/closejob.js', from: 'a.maxMoveM - b.maxMoveM : a.rank - b.rank', to: 'b.maxMoveM - a.maxMoveM : a.rank - b.rank', tests: [BEST], caughtBy: 'row 7: the pick is the least-moving way that proves' },
  { id: 'B5 Finish is tried when the end is already at the start', file: 'app/core/closejob.js', from: "if (!near) routes.push({ route: 'finish'", to: "if (true) routes.push({ route: 'finish'", tests: [BEST], caughtBy: 'row 1: an end already at the start' },
  { id: 'B6 a bend may reshape the track (no move cap)', file: 'app/core/closejob.js', from: 'if (newPieces === 0 && maxMoveM > moveCap) return done(', to: 'if (false) return done(', tests: [BEST], caughtBy: 'row 5: a bend that would move the track further' },
  { id: 'B7 a press that finds no way still applies', file: 'app/core/coreshell.js', from: 'if (!out.converged) return set({ closePending: null, message: out.report });', to: '', tests: [PREVIEW], caughtBy: 'row 2: when no way of closing proves, nothing changes' },
  { id: 'B8 the press commits the open track', file: 'app/core/coreshell.js', from: 'history: D.commit(st.history, out.doc), ...resolvedOf(out.doc)', to: 'history: D.commit(st.history, base), ...resolvedOf(base)', tests: [PREVIEW], caughtBy: 'row 1: one press closes a near lap AT ONCE' },
  { id: 'F5 the worker\'s document is not frozen (the residual memo misses)', file: 'app/core/closejob.js', from: '  deepFreeze(doc);', to: '', tests: [BEST], caughtBy: 'row 13: the worker\'s press on a structuredClone' },
  { id: 'B9 a tie is not broken by the route order (micro-metres decide)', file: 'app/core/closejob.js', from: 'Math.abs(a.maxMoveM - b.maxMoveM) > MOVE_TIE_M ? a.maxMoveM - b.maxMoveM : a.rank - b.rank', to: 'a.maxMoveM - b.maxMoveM', tests: [BEST], caughtBy: 'row 8: the order' },
  // D343, the press made fast: the near bend first (and nothing else when it proves), and the live checker's reds for the open track
  { id: 'F1 the near bend is not checked first (every route runs)', file: 'app/core/closejob.js', from: 'if (near && !exhaustive) {', to: 'if (false) {', tests: [BEST], caughtBy: 'row 9: when the end is at the start' },
  { id: 'F2 the given open-track reds are ignored (it is checked again)', file: 'app/core/closejob.js', from: 'let open = openReds ? { reds: openReds } : null;', to: 'let open = null;', tests: [BEST], caughtBy: 'row 11: given the open track' },
  { id: 'F3 the press hands the worker no reds', file: 'app/core/coreshell.js', from: 'openReds: known && known.csp ? known.red : null', to: 'openReds: null', tests: [WORKER], caughtBy: 'row 7: a press hands the worker the reds' },
  { id: 'F4 a check made with CSP off is used', file: 'app/core/coreshell.js', from: 'openReds: known && known.csp ? known.red : null', to: 'openReds: known ? known.red : null', tests: [WORKER], caughtBy: 'row 7: a press hands the worker the reds' },
  // app/validate-ui/redgroups.js: every red in plain words (item 4)
  { id: 'G1 a ray red on an overlap keeps its own words', file: 'app/validate-ui/redgroups.js', from: "(reason === 'downforce-ray-gap' && nearOverlap(r))", to: 'false', tests: [GROUPS], caughtBy: 'the overlap is ONE group' },
  { id: 'G2 every ray red is called an overlap', file: 'app/validate-ui/redgroups.js', from: "(reason === 'downforce-ray-gap' && nearOverlap(r))", to: "(reason === 'downforce-ray-gap')", tests: [GROUPS], caughtBy: 'a downforce-ray-gap with NO overlap near it' },
  { id: 'G3 the text names only the first place of a group', file: 'app/validate-ui/redgroups.js', from: "g.places.map(placeText).join(', ')", to: "g.places.slice(0, 1).map(placeText).join(', ')", tests: [GROUPS], caughtBy: 'groupsText names one line per PLACE' },   // D248: re-anchored (the text now lists places)
  // D248: the places merge (E's note B on the D242 look)
  { id: 'G6 places are never merged', file: 'app/validate-ui/redgroups.js', from: 'if (last && (it.s0 < last.s1 || (it.s0 <= last.s1 + TOUCH_M && it.piece === endPiece(segments, last.s0, last.s1, o)))) {', to: 'if (false) {', tests: [GROUPS], caughtBy: 'D248: overlapping reds on one piece are ONE place' },
  { id: 'G7 places merge across pieces', file: 'app/validate-ui/redgroups.js', from: 'if (last && (it.s0 < last.s1 || (it.s0 <= last.s1 + TOUCH_M && it.piece === endPiece(segments, last.s0, last.s1, o)))) {', to: 'if (last && it.s0 <= last.s1 + TOUCH_M) {', tests: [GROUPS], caughtBy: 'D248: TOUCHING reds merge' },
  { id: 'G10 places merge only on the same STARTING piece (the rule the real window caught)', file: 'app/validate-ui/redgroups.js', from: 'if (last && (it.s0 < last.s1 || (it.s0 <= last.s1 + TOUCH_M && it.piece === endPiece(segments, last.s0, last.s1, o)))) {', to: 'if (last && last.piece === it.piece && it.s0 <= last.s1 + TOUCH_M) {', tests: [GROUPS], caughtBy: 'D248: a red inside a place that spans two pieces' },
  { id: 'G8 touching reds do not merge (no tolerance)', file: 'app/validate-ui/redgroups.js', from: 'const OVERLAP_NEAR_M = 30, TOUCH_M = 2;', to: 'const OVERLAP_NEAR_M = 30, TOUCH_M = 0;', tests: [GROUPS], caughtBy: 'D248: TOUCHING reds merge' },
  { id: 'G9 the count is of reds, not places', file: 'app/validate-ui/redgroups.js', from: 'const n = (g.places || []).length;', to: 'const n = g.count;', tests: [GROUPS], caughtBy: 'D248: overlapping reds on one piece are ONE place' },
  { id: 'G4 the piece is read at the range\'s end', file: 'app/validate-ui/redgroups.js', from: 'piece = pieceAt(segments, r.s0, o)', to: 'piece = pieceAt(segments, r.s1, o)', tests: [GROUPS], caughtBy: 'where: s in km and the piece' },
  { id: 'G5 s past the lap does not wrap', file: 'app/validate-ui/redgroups.js', from: 'let x = L > 0 && closed ? ((s % L) + L) % L : s', to: 'let x = s', tests: [GROUPS], caughtBy: 'pieceAt wraps' },
  // app/core/labels.js: on hover only (item 5)
  { id: 'L1 every piece is labelled again', file: 'app/core/labels.js', from: 'if (r.id !== headId && r.id !== hoverId) return;', to: '', tests: [DISPLAY], caughtBy: 'the labels on the track' },
  { id: 'L2 the hovered piece is never labelled', file: 'app/core/labels.js', from: 'if (r.id !== headId && r.id !== hoverId) return;', to: 'if (r.id !== headId) return;', tests: [DISPLAY], caughtBy: 'the labels on the track' },
  { id: 'L3 a still pointer is not asked again after the track changes', file: 'app/core/labels.js', from: 'anchorsFor = track.segments; pickedFor = undefined; }', to: 'anchorsFor = track.segments; }', tests: [DISPLAY], caughtBy: 'the labels follow a path the preview extends IN PLACE' },
  // app/core/panel.js: Undo gives back the undone piece's values (item 7)
  { id: 'U1 Undo shows the head only (the bug)', file: 'app/core/panel.js', from: 'showHead(); if (undone) putBack(m.made); for', to: 'showHead(); for', tests: [DISPLAY], caughtBy: 'D242 item 7' },
  { id: 'U2 the ticks are not put back', file: 'app/core/panel.js', from: 'for (const [k, b] of Object.entries(atStart)) b.checked = !!m.ticks[k];', to: '', tests: [DISPLAY], caughtBy: 'D242 item 7' },
  // app/core/panel.js: Straight (item 6)
  { id: 'S1 Straight does not tick turn "at start"', file: 'app/core/panel.js', from: 'atStart.turn.checked = true; atStart.climb.checked = true;', to: 'atStart.climb.checked = true;', tests: [DISPLAY], caughtBy: 'D242: after a 30°/100m turn, Straight' },
  { id: 'S2 Straight leaves the boxes ticked', file: 'app/core/panel.js', from: 'atStart.turn.checked = was.turn; atStart.climb.checked = was.climb;', to: '', tests: [DISPLAY], caughtBy: 'D242: after a 30°/100m turn, Straight' },
  { id: 'S3 the straight hint never shows', file: 'app/core/panel.js', from: "&& !atStart.turn.checked ? `turn 0 eases", to: "&& false ? `turn 0 eases", tests: [DISPLAY], caughtBy: 'D242: after a 30°/100m turn, Straight' },
];

function runMutant(m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-close-mut-'));
  try {
    for (const d of fs.readdirSync(path.join(ROOT, 'app'), { withFileTypes: true })) {
      if (d.isDirectory() && d.name !== 'test') fs.cpSync(path.join(ROOT, 'app', d.name), path.join(dir, 'app', d.name), { recursive: true });
      else if (d.isFile()) { fs.mkdirSync(path.join(dir, 'app'), { recursive: true }); fs.copyFileSync(path.join(ROOT, 'app', d.name), path.join(dir, 'app', d.name)); }
    }
    for (const d of ['src', 'tools']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
    for (const t of m.tests) { fs.mkdirSync(path.dirname(path.join(dir, t)), { recursive: true }); fs.copyFileSync(path.join(ROOT, t), path.join(dir, t)); }
    const f = path.join(dir, m.file), src = fs.readFileSync(f, 'utf8'), n = m.from === null ? 1 : src.split(m.from).length - 1, applied = n === 1;
    if (applied && m.from !== null) fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const r = spawnSync(process.execPath, ['--max-old-space-size=4096', '--test', '--test-concurrency=1', ...m.tests.map((t) => path.join(dir, t))],
      { cwd: dir, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 28 });   // a failing mutant can print whole documents
    if (r.error) throw r.error;
    const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
    if (!/ℹ tests \d+/.test(out)) throw new Error('the mutant test run printed no summary:\n' + out.slice(0, 2000));
    const failed = out.split('\n').filter((l) => /^✖ /.test(l) && !/^✖ failing tests:/.test(l)).map((l) => l.slice(2));
    return { applied, n, caught: failed.some((l) => l.includes(m.caughtBy)), failed: [...new Set(failed)] };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('control: the unmutated temp copy passes every test file the mutants use', () => {
  const r = runMutant({ id: 'control', file: 'app/core/panel.js', from: null, to: null, tests: [LOCAL, PREVIEW, GROUPS, DISPLAY, BEST, WORKER], caughtBy: '(no test is named this)' });
  assert.deepEqual(r.failed, [], `the unmutated copy fails: ${r.failed.join(' | ')}`);
});
for (const m of MUTATIONS) {
  test(`mutation ${m.id}: applied, and caught by "${m.caughtBy}…"`, () => {
    const r = runMutant(m);
    assert.ok(r.applied, `NOT APPLIED: "${m.from}" occurs ${r.n} times in ${m.file}`);
    assert.ok(r.caught, `NOT CAUGHT; failing tests on the mutant: ${r.failed.join(' | ') || 'none'}`);
  });
}
module.exports = { MUTATIONS, runMutant };
