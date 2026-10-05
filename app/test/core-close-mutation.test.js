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
const LOCAL = 'test/core_close_local.test.js', PREVIEW = 'app/test/core-close-preview.test.js', GROUPS = 'app/test/redgroups.test.js', DISPLAY = 'app/test/core-readout-display.test.js';

const MUTATIONS = [
  // src/core/close.js: the LOCAL close (items 1 and the refusal by name)
  { id: 'K1 the columns outside the window are not fixed', file: 'src/core/close.js', from: 'fixedOf = (p) => !!free && !free.has(p);', to: 'fixedOf = (p) => false;', tests: [LOCAL], caughtBy: 'row 1: a close confined to the LAST piece' },
  { id: 'K2 the pieces outside the window are recomputed, not kept', file: 'src/core/close.js', from: "if (P.type !== 'road' || (keep && keep.has(p))) return P;", to: "if (P.type !== 'road') return P;", tests: [LOCAL], caughtBy: 'row 1: a close confined to the LAST piece' },
  { id: 'K3 a local close that does not close is handed back, not refused', file: 'src/core/close.js', from: 'if (local && !converged) throw refuse(', to: 'if (false) throw refuse(', tests: [LOCAL], caughtBy: 'row 3: a window that cannot close the loop' },
  { id: 'K4 the roll-rate bar is not read', file: 'src/core/close.js', from: 'if (after > V.ROLL_RED_DEG_M) {', to: 'if (false) {', tests: [LOCAL], caughtBy: 'row 4: a local close may not push the window past the roll-rate bar' },
  { id: 'K5 the window is not named for a person', file: 'src/core/close.js', from: "${contiguousTail ? 'the last ' : ''}", to: '', tests: [LOCAL], caughtBy: 'row 1: a close confined to the LAST piece' },
  { id: 'K6 the default window ignores the fraction (the last piece only)', file: 'src/core/close.js', from: 'want = Math.max(0, Math.min(1, fraction)) * total', to: 'want = 0', tests: [LOCAL], caughtBy: 'row 2: the default window' },
  { id: 'K7 an empty window is accepted', file: 'src/core/close.js', from: "if (!set.size) throw new D.CoreError('CLOSE_WINDOW'", to: "if (false) throw new D.CoreError('CLOSE_WINDOW'", tests: [LOCAL], caughtBy: 'row 5: a window with no road piece' },
  // app/core/coreshell.js: the PREVIEW (items 2 and 3)
  { id: 'A1 the app close is the whole-lap close again', file: 'app/core/coreshell.js', from: 'close(base, { window: closeWindow(base, { fraction, last }) })', to: 'close(base, { edited: wholeLapEdited(base) })', tests: [PREVIEW], caughtBy: 'row 1: Close PROPOSES' },
  { id: 'A2 an edit keeps a stale preview', file: 'app/core/coreshell.js', from: 'patch.history.present !== st.closeProposal.base)', to: 'false)', tests: [PREVIEW], caughtBy: 'row 2: Cancel drops the preview' },
  { id: 'A3 the overlap check has no mesh self-check (no folds)', file: 'app/core/overlapjob.js', from: 'folds: mesh.folds, roadMesh,', to: 'roadMesh,', tests: [PREVIEW], caughtBy: 'row 4: the preview\'s OVERLAP CHECK' },
  { id: 'A4 the overlap check is skipped', file: 'app/core/coreshell.js', from: 'Object.freeze(overlapCheck(r.resolved, st.designSpeedKmh))', to: 'Object.freeze({ overlaps: [], others: [], amber: 0 })', tests: [PREVIEW], caughtBy: 'row 4: the preview\'s OVERLAP CHECK' },
  { id: 'A5 Apply commits the base, not the proposal', file: 'app/core/coreshell.js', from: 'history: D.commit(st.history, p.doc), resolved: p.resolved,', to: 'history: D.commit(st.history, p.base), resolved: p.resolved,', tests: [PREVIEW], caughtBy: 'row 1: Close PROPOSES' },
  { id: 'A6 the refused export keeps the export\'s own message (ids)', file: 'app/core/coreshell.js', from: "e.code === 'RED' && Array.isArray(e.red) ? `not exported:", to: "false ? `not exported:", tests: [PREVIEW], caughtBy: 'row 6: a refused export names EVERY red' },
  { id: 'A9 Apply writes no copy from before the close', file: 'app/core/coreshell.js', from: "try { await api.backupNow('pre-close'); }", to: 'try { }', tests: [PREVIEW], caughtBy: 'row 7: Apply writes the copy from BEFORE the close' },
  { id: 'A11 an edit during the copy still gets the stale close committed', file: 'app/core/coreshell.js', from: 'if (st.closeProposal !== p || p.base !== doc()) return set(', to: 'if (false) return set(', tests: [PREVIEW], caughtBy: 'row 7: Apply writes the copy from BEFORE the close' },
  { id: 'A10 a failed backup still closes', file: 'app/core/coreshell.js', from: "catch (e) { return set({ message: `not closed: the copy", to: "catch (e) { set({ message: `not closed: the copy", tests: [PREVIEW], caughtBy: 'row 7: Apply writes the copy from BEFORE the close' },
  // app/preview: the ghost
  { id: 'A7 the proposal is not drawn as a ghost', file: 'app/preview/preview.js', from: 'if (prop) { try { ghost = { ...model.proposalGhost(prop.resolved), proposal: true }; } catch (e) { ghost = null; } }', to: '', tests: [PREVIEW], caughtBy: 'row 5: the preview shows the proposal as a GHOST' },
  { id: 'A8 focus looks from the station, not at it', file: 'app/preview/preview.js', from: 'rig.free.lookFrom(eye, m.pos.slice())', to: 'rig.free.lookFrom(eye, eye.map((v, k) => v + m.T[k]))', tests: [PREVIEW], caughtBy: 'row 5: the preview shows the proposal as a GHOST' },
  // app/validate-ui/redgroups.js: every red in plain words (item 4)
  { id: 'G1 a ray red on an overlap keeps its own words', file: 'app/validate-ui/redgroups.js', from: "(reason === 'downforce-ray-gap' && nearOverlap(r))", to: 'false', tests: [GROUPS], caughtBy: 'the overlap is ONE group' },
  { id: 'G2 every ray red is called an overlap', file: 'app/validate-ui/redgroups.js', from: "(reason === 'downforce-ray-gap' && nearOverlap(r))", to: "(reason === 'downforce-ray-gap')", tests: [GROUPS], caughtBy: 'a downforce-ray-gap with NO overlap near it' },
  { id: 'G3 the text names only the first place of a group', file: 'app/validate-ui/redgroups.js', from: '[...new Set(g.items.map(placeText))]', to: '[...new Set(g.items.slice(0, 1).map(placeText))]', tests: [GROUPS], caughtBy: 'groupsText names EVERY red' },
  { id: 'G4 the piece is read at the range\'s end', file: 'app/validate-ui/redgroups.js', from: 'piece = pieceAt(segments, r.s0)', to: 'piece = pieceAt(segments, r.s1)', tests: [GROUPS], caughtBy: 'where: s in km and the piece' },
  { id: 'G5 s past the lap does not wrap', file: 'app/validate-ui/redgroups.js', from: 'let x = L > 0 ? ((s % L) + L) % L : s', to: 'let x = s', tests: [GROUPS], caughtBy: 'pieceAt wraps' },
  // app/core/labels.js: on hover only (item 5)
  { id: 'L1 every piece is labelled again', file: 'app/core/labels.js', from: 'if (r.id !== headId && r.id !== hoverId) return;', to: '', tests: [DISPLAY], caughtBy: 'the labels on the track' },
  { id: 'L2 the hovered piece is never labelled', file: 'app/core/labels.js', from: 'if (r.id !== headId && r.id !== hoverId) return;', to: 'if (r.id !== headId) return;', tests: [DISPLAY], caughtBy: 'the labels on the track' },
  { id: 'L3 a still pointer is not asked again after the track changes', file: 'app/core/labels.js', from: 'anchorsFor = track.segments; pickedFor = undefined; }', to: 'anchorsFor = track.segments; }', tests: [DISPLAY], caughtBy: 'the labels follow a path the preview extends IN PLACE' },
  // app/core/panel.js: Undo gives back the undone piece's values (item 7)
  { id: 'U1 Undo shows the head only (the bug)', file: 'app/core/panel.js', from: 'showHead(); if (undone) putBack(m.made); shownFor = d;', to: 'showHead(); shownFor = d;', tests: [DISPLAY], caughtBy: 'D242 item 7' },
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
  const r = runMutant({ id: 'control', file: 'app/core/panel.js', from: null, to: null, tests: [LOCAL, PREVIEW, GROUPS, DISPLAY], caughtBy: '(no test is named this)' });
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
