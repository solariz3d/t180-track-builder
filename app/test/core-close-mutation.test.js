// core-close-mutation.test.js: node --test app/test/core-close-mutation.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D242, the safe Close and the plain-word reds (pane B), mutated. Each mutation copies app/ (every folder but test/, and its files), src/, tools/ and
// the mutant's own test files to a temp folder, applies ONE source patch, and runs those COPIED tests there, so their relative requires reach the
// mutant. "Applied" means the patch text was found exactly once; "caught" means the named test FAILED on the mutant. A CONTROL runs the unmutated
// copy of every test file first. The originals are never touched.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const IR = require('../../test/inner_run.js');   // D352: a crashed inner run reads NOT TESTED
const ROOT = path.join(__dirname, '..', '..');
const LOCAL = 'test/core_close_local.test.js', PREVIEW = 'app/test/core-close-preview.test.js', GROUPS = 'app/test/redgroups.test.js', DISPLAY = 'app/test/core-readout-display.test.js', BEST = 'test/core_close_best.test.js', WORKER = 'app/test/close-worker.test.js', FIN = 'test/core_finish.test.js', C2 = 'test/core_joint_c2.test.js';

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
  { id: 'N1 a laid road Close refuses is never taken as laid (the lone straight is lost to a loop again)', file: 'src/core/finish.js', from: 'res = metAsLaid(laid); if (!res) { best = best || err.message; continue; }', to: 'best = best || err.message; continue;', tests: [FIN], caughtBy: 'row 17: an end straight behind the start' },
  // D459 3c: the closure's curvature rows (close.js): the seam's, and the moved joints'
  { id: 'Q8 the seam gets no curvature row (the closure meets value and slope only, as before 3c)', file: 'src/core/close.js', from: "J.push(valueRow(ch, 'curv')); }   // D459 3c: the seam's curvature rows", to: "void 0; }   // D459 3c: the seam's curvature rows", tests: [C2], caughtBy: 'row 9: the closure is C2' },
  { id: 'Q9 the joints the close moves get no curvature row (only the seam)', file: 'src/core/close.js', from: 'for (const [a, b, ch] of c2Pairs) { const row = new Float64Array(N); curvRow(ch, a, b, row); J.push(row); }', to: 'for (const [a, b, ch] of []) { const row = new Float64Array(N); curvRow(ch, a, b, row); J.push(row); }', tests: [C2], caughtBy: 'row 9: the closure is C2' },
  // D459: the closer brings the cup home by the C2 quintic where the closer is long enough for its peak rate (finish.js cupHome)
  { id: "Q5 the closer's cup fade is linear whatever its length (its curvature steps at the user's last joint and at the seam)", file: 'src/core/finish.js', from: 'const ease = c2 ? smoother : (x) => Math.max(0, Math.min(1, x));', to: 'const ease = (x) => Math.max(0, Math.min(1, x));', tests: [C2], caughtBy: 'row 6: through Close' },
  { id: 'N2 a route that is only a straight is not laid under 10 m', file: 'src/core/finish.js', from: 'else if (alone && r.straightM >= MIN_STRAIGHT_ALONE_M)', to: 'else if (false)', tests: [FIN], caughtBy: 'row 17: an end straight behind the start' },
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

// D412: `extra` is IR.narrowArgs(caughtBy) for a run narrowed to the named test; empty, the run is whole, as before
function runMutant(m, extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-close-mut-'));
  try {
    for (const d of fs.readdirSync(path.join(ROOT, 'app'), { withFileTypes: true })) {
      if (d.isDirectory() && d.name !== 'test') fs.cpSync(path.join(ROOT, 'app', d.name), path.join(dir, 'app', d.name), { recursive: true });
      else if (d.isFile()) { fs.mkdirSync(path.join(dir, 'app'), { recursive: true }); fs.copyFileSync(path.join(ROOT, 'app', d.name), path.join(dir, 'app', d.name)); }
    }
    for (const d of ['src', 'tools']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
    for (const t of m.tests) { fs.mkdirSync(path.dirname(path.join(dir, t)), { recursive: true }); fs.copyFileSync(path.join(ROOT, t), path.join(dir, t)); }
    if (fs.existsSync(path.join(ROOT, 'test', 'fixtures'))) fs.cpSync(path.join(ROOT, 'test', 'fixtures'), path.join(dir, 'test', 'fixtures'), { recursive: true });   // D357: the tests' own fixtures (core_finish row 11 reads one)
    const f = path.join(dir, m.file), src = fs.readFileSync(f, 'utf8'), n = m.from === null ? 1 : src.split(m.from).length - 1, applied = n === 1;
    if (applied && m.from !== null) fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const tap = path.join(dir, '.inner-run.tap');   // D352: a TAP copy, the only place a dead file's exit code shows
    const r = spawnSync(process.execPath, ['--max-old-space-size=4096', '--test', ...IR.reporterArgs(tap), ...extra, '--test-concurrency=1', ...m.tests.map((t) => path.join(dir, t))],
      { cwd: dir, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 28 });   // a failing mutant can print whole documents
    if (r.error) throw r.error;
    const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
    if (!/ℹ tests \d+/.test(out)) throw new Error('the mutant test run printed no summary:\n' + out.slice(0, 2000));
    const failed = out.split('\n').filter((l) => /^✖ /.test(l) && !/^✖ failing tests:/.test(l)).map((l) => l.slice(2));
    // D352: a file that died natively ran none of its tests; its own ✖ line is no catch, and a run with no catch but a dead file tested nothing
    const crashed = IR.crashesIn(tap), caught = failed.some((l) => !crashed.some((c) => l.startsWith(c.file + ' (')) && l.includes(m.caughtBy));
    if (crashed.length && !caught) throw new Error(IR.notTested(crashed));
    // D353: a crash after a failing row leaves no trace in the TAP, only the named test's silence; a file that exited on its own (a module that
    // threw on load, exit 1) reads as before, and a control (from: null) names no test
    // D354 (pane E, review 4, F1): a file's own exit is a verdict only when the run had one file; in a run of more, another file's load throw
    // says nothing about the named test's file, so the silence reads NOT TESTED and names the files that ended on their own
    if (!caught && m.from !== null && !IR.reported(out, m.caughtBy)) {
      const exits = IR.fileExitsIn(tap);
      if (!exits.length || m.tests.length > 1) throw new Error(IR.neverReported(crashed, exits, m.tests.length));
    }
    return { applied, n, caught, failed: [...new Set(failed)], ran: IR.ran(out), reported: IR.reported(out, m.caughtBy) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// D412: the (caughtBy, test files) pairs whose mutants may run narrowed, filled by the control below. Each mutant names its own files, so the
// narrowed control runs on the mutant's files. A pair missing here (the control did not run, or its narrowed control failed, ran no row, or
// never reported the named test) keeps its mutants whole
const NARROW = new Map(), narrowKey = (m) => `${m.caughtBy}\u0000${m.tests.join('|')}`;
test('control: the unmutated temp copy passes every test file the mutants use', (t) => {
  const r = runMutant({ id: 'control', file: 'app/core/panel.js', from: null, to: null, tests: [LOCAL, PREVIEW, GROUPS, DISPLAY, BEST, WORKER, FIN], caughtBy: '(no test is named this)' });   // D357: FIN too (N1, N2), so a catch there is never a row that fails unmutated
  assert.deepEqual(r.failed, [], `the unmutated copy fails: ${r.failed.join(' | ')}`);
  // D412: and narrowed once per distinct pair; each must pass alone, or its mutants stay whole (said, not failed: whole is the safe reading)
  for (const m of new Map(MUTATIONS.map((x) => [narrowKey(x), x])).values()) {
    const n = runMutant({ id: 'control', file: 'app/core/panel.js', from: null, to: null, tests: m.tests, caughtBy: m.caughtBy }, IR.narrowArgs(m.caughtBy));
    NARROW.set(narrowKey(m), n.failed.length === 0 && n.ran.tests > 0 && n.reported);
    if (!NARROW.get(narrowKey(m))) t.diagnostic(`D412 whole: "${m.caughtBy}" on ${m.tests.join(', ')} (narrowed control: ${n.failed.length} failing, ${n.ran.tests} rows ran, named test reported ${n.reported})`);
    else if (n.ran.tests > 1 || n.ran.suites) t.diagnostic(`D412 wide: "${m.caughtBy}" on ${m.tests.join(', ')} runs ${n.ran.tests} rows${n.ran.suites ? ` and ${n.ran.suites} suite(s)` : ''}`);
  }
});
// D352: a crashed inner run is no verdict. The stand-in puts the machine's crash (test/inner_run.js STANDIN) at the top of the first mutant's file;
// it looks for '.test.js', which every dead file's own ✖ line contains, so a dead file's line must not count as the catch
test('a crashed inner run reads NOT TESTED, never a verdict (the crash stand-in, D352)', () => {
  const m0 = MUTATIONS[0], first = fs.readFileSync(path.join(ROOT, m0.file), 'utf8').split(/\r?\n/)[0];
  const said = IR.reading(() => { const r = runMutant({ ...m0, id: 'crash stand-in', caughtBy: '.test.js', from: first, to: IR.STANDIN + first }); return r.caught ? 'caught' : `NOT CAUGHT; failing tests on the mutant: ${r.failed.join(' | ') || 'none'}`; });
  assert.match(said, IR.NOT_TESTED);
});
// D353: a crash AFTER an unrelated failing row leaves no file-level entry in the TAP, so only the named test's silence shows it. The second
// stand-in (test/inner_run.js STANDIN_AFTER_FAIL) fails a row and then dies, in every file that loads the first mutant's file; caughtBy is the real one
test('a crash after an unrelated failing row reads NOT TESTED, never NOT CAUGHT (the second stand-in, D353)', () => {
  const m0 = MUTATIONS[0], first = fs.readFileSync(path.join(ROOT, m0.file), 'utf8').split(/\r?\n/)[0];
  const said = IR.reading(() => { const r = runMutant({ ...m0, id: 'crash after a failing row', from: first, to: IR.STANDIN_AFTER_FAIL + first }); return r.caught ? 'caught' : `NOT CAUGHT; failing tests on the mutant: ${r.failed.join(' | ') || 'none'}`; });
  assert.match(said, IR.NOT_TESTED_ANY);
});
// D354: a mutant that makes a module throw on load, in a run of one file, is a verdict as before D353: NOT CAUGHT, naming the file. This row
// guards the exemption on the D353 line (M2: without it the row reads NOT TESTED)
test('a load throw in a run of one file reads NOT CAUGHT as before, never NOT TESTED (the load-throw stand-in, D354)', () => {
  const m0 = MUTATIONS[0], first = fs.readFileSync(path.join(ROOT, m0.file), 'utf8').split(/\r?\n/)[0];
  const said = IR.reading(() => { const r = runMutant({ ...m0, id: 'load throw', from: first, to: IR.LOAD_THROW + first }); return r.caught ? 'caught' : `NOT CAUGHT; failing tests on the mutant: ${r.failed.join(' | ') || 'none'}`; });
  assert.match(said, IR.NOT_CAUGHT_LOAD);
});
for (const m of MUTATIONS) {
  test(`mutation ${m.id}: applied, and caught by "${m.caughtBy}…"`, (t) => {
    const r = IR.narrowedFirst(runMutant, m, NARROW.get(narrowKey(m)) === true);   // D412: narrowed first; any miss is re-run whole, and that verdict stands
    t.diagnostic(`D412 path: ${r.narrowed ? 'narrowed' : 'whole'}`);   // which run gave the verdict: a duration cannot tell a slow narrowed run from a re-run
    assert.ok(r.applied, `NOT APPLIED: "${m.from}" occurs ${r.n} times in ${m.file}`);
    assert.ok(r.caught, `NOT CAUGHT; failing tests on the mutant: ${r.failed.join(' | ') || 'none'}`);
  });
}
module.exports = { MUTATIONS, runMutant };
