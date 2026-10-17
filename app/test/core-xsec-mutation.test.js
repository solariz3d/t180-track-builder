// core-xsec-mutation.test.js: node --test app/test/core-xsec-mutation.test.js
// Mutation testing of the CROSS-SECTION app half (lap D225, pane C): each row plants one defect in a TEMP COPY of app/ (the tracked files are
// never touched), runs app/test/core-xsec.test.js there, and must see the named test fail. A row whose `from` text is not in the file exactly
// once is NOT APPLIED and fails here, so a moved anchor is never counted as caught. E's seal plants (KE7-1, KE7-2, KS1-2) are among them in
// the app's terms; B plants the seal's own controls in the combined tree.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const IR = require('../../test/inner_run.js');   // D352: a crashed inner run reads NOT TESTED
const ROOT = path.join(__dirname, '..', '..');
const TESTS = ['core-xsec.test.js'];

const MUTATIONS = [
  { id: 'X1 the edge angle sent in radians', file: 'core/panel.js', from: 'if (e !== null) targets[XS.CHANNEL.edge] = e;', to: 'if (e !== null) targets[XS.CHANNEL.edge] = e * DEG;', caughtBy: 'xsec extendOptions: each field is its channel target' },
  { id: 'X2 the panel clamps the edge, hiding the core guard (KE2-2)', file: 'core/panel.js', from: 'if (e !== null) targets[XS.CHANNEL.edge] = e;', to: 'if (e !== null) targets[XS.CHANNEL.edge] = Math.min(150, Math.max(0, e));', caughtBy: 'xsec extendOptions: nothing is clamped' },
  { id: 'X3 the tube field is not sent', file: 'core/panel.js', from: 'if (tb !== null) targets[XS.CHANNEL.tube] = tb;', to: '', caughtBy: 'xsec extendOptions: each field is its channel target' },
  { id: 'X4 the edge start sent on the edge channel', file: 'core/panel.js', from: 'if (sl !== null) targets[XS.CHANNEL.start] = sl;', to: 'if (sl !== null) targets[XS.CHANNEL.edge] = sl;', caughtBy: 'xsec extendOptions: each field is its channel target' },
  { id: 'X5 the bank wrapped to ±180 (S1)', file: 'core/panel.js', from: 'if (b !== null) targets.phi = b * DEG;', to: 'if (b !== null) targets.phi = Math.atan2(Math.sin(b * DEG), Math.cos(b * DEG));', caughtBy: 'xsec extendOptions: bank winds past' },
  { id: 'X6 (KS1-2) max="180" on the bank input', file: 'core/panel.js', from: '  const shown = {};', to: "  bank.setAttribute('max', '180'); const shown = {};", caughtBy: 'xsec panel: the bank field takes any number' },   // CHANGED D259: the row was renamed from 'xsec panel: the bank field takes 360 and −540 and reads them back (S1 iv)'; same row, same max/min check
  { id: 'X7 (KE7-1, UI) the edge cell shows the typed target', file: 'core/panel.js', from: 'edge: pairOf(r, XS.READOUT.edge, fmtCup)', to: "edge: edge.value === '' ? pairOf(r, XS.READOUT.edge, fmtCup) : `${fmtCup(r[XS.READOUT.edge[0]])} → ${fmtCup(Number(edge.value))}`", caughtBy: 'xsec panel: a changed field is a target' },
  { id: 'X8 (KE7-2) the edge cell wired to the cup values', file: 'core/panel.js', from: 'edge: pairOf(r, XS.READOUT.edge, fmtCup)', to: "edge: pairOf(r, ['cupFromDeg', 'cupToDeg'], fmtCup)", caughtBy: 'xsec panel (A' },
  { id: 'X9 the edge start shown to one decimal', file: 'core/panel.js', from: 'Math.round(Math.abs(x) * 100 + 1e-7) / 100', to: 'Math.round(Math.abs(x) * 10 + 1e-7) / 10', caughtBy: 'xsec panel: a changed field is a target' },
  { id: 'X10 the edge field is not on the panel', file: 'core/panel.js', from: "fieldAt('edge angle °', edge, 'edge'), ", to: '', caughtBy: 'xsec panel: the three fields are on the panel' },
  { id: 'X11 the new fields do not redraw the readout', file: 'core/panel.js', from: 'for (const f of [edge, edgeR, start, tube]) f.oninput', to: 'for (const f of []) f.oninput', caughtBy: 'xsec panel: the edge angle and the edge start each redraw' },   // C, 2026-10-05: survived since the undo guard (8926789); its own row now
  { id: 'X12 an untouched edge field is sent as a target', file: 'core/panel.js', from: "edge: asTyped('edge')", to: 'edge: HEAD.edge[0].value', caughtBy: 'xsec panel: the three fields are on the panel' },
  { id: 'X13 the edge has no "at start"', file: 'core/panel.js', from: "cup: 'c', edge: XS.CHANNEL.edge, ", to: "cup: 'c', ", caughtBy: 'xsec extendOptions: the new fields take the "at start" box' },
  { id: 'X14 the head state drops the cross-section channels', file: 'core/coreshell.js', from: 'c: e.c.v, ...XS.headOf(e, headIsTube) }', to: 'c: e.c.v }', caughtBy: 'xsec headState' },
  { id: 'X15 the default edge start is the plan\'s stale 0.70', file: 'core/xsec.js', from: 'start: 0.64', to: 'start: 0.7', caughtBy: 'xsec headState' },
  { id: 'X16 (X2 ii) the mast stands on world y', file: 'preview/look.js', from: '...at(U, mast)', to: '...at([0, 1, 0], mast)', caughtBy: 'xsec head marker: the mast follows the road\'s U' },
  { id: 'X17 the mast is not held below the roof', file: 'preview/look.js', from: 'const mast = clear ? Math.min(size * 10 / 3, clear.up) : size * 10 / 3', to: 'const mast = size * 10 / 3', caughtBy: 'xsec head marker: inside a closed tube' },
  { id: 'X18 the cross and ring reach through the wall', file: 'preview/look.js', from: 'side = (k) => (clear ? Math.sign(k) * Math.min(Math.abs(k), clear.lat) : k)', to: 'side = (k) => k', caughtBy: 'xsec head marker: inside a closed tube' },
  { id: 'X19 an open tube read as closed', file: 'preview/preview.js', from: 'psiAt(P, uL) >= Math.PI - 1e-6 && psiAt(P, uR) >= Math.PI - 1e-6', to: 'psiAt(P, uL) >= Math.PI / 2 && psiAt(P, uR) >= Math.PI / 2', caughtBy: 'xsec head marker: the clearance of a closed tube' },
  { id: 'X20 the roof read sideways', file: 'preview/preview.js', from: 'Math.min(offsetAt(P, uL)[1], offsetAt(P, uR)[1])', to: 'Math.min(offsetAt(P, uL)[0], offsetAt(P, uR)[0])', caughtBy: 'xsec head marker: the clearance of a closed tube' },
  { id: 'X21 the preview never hands the room to the marker', file: 'preview/preview.js', from: ', clearanceAtHead(track && track.path ? track.segments : ghost && ghost.segments))', to: ')', caughtBy: 'xsec head marker: the preview hands' },
  { id: 'X22 the tube-too-narrow red has no words', file: 'validate-ui/labels.js', from: "    'tube-too-narrow': ", to: "    'tube-too-narrow-x': ", caughtBy: 'xsec validation words' },
  { id: 'X23 the roll-rate red has no words', file: 'validate-ui/labels.js', from: "    'roll-rate': ", to: "    'roll-rate-x': ", caughtBy: 'xsec validation words' },
  { id: 'X24 the readout swallows the refusal\'s name', file: 'core/panel.js', from: '    roBox.title = why;', to: "    roBox.title = why.replace(/^[A-Z][A-Z_]+: /, '');", caughtBy: 'xsec panel: a core refusal is shown by its name' },
  { id: 'X25 a typed tube leaves the cup enabled', file: 'core/panel.js', from: 'other.value = shown[ko]; other.disabled = true;', to: 'other.value = shown[ko];', caughtBy: 'xsec panel: a piece is a cup OR a tube' },
  { id: 'X29 a non-tube head shows the sweep the core keeps internally (RULING 2)', file: 'core/xsec.js', from: "(k !== 'tube' || headIsTube)", to: 'true', caughtBy: 'xsec headState' },
  { id: 'X30 the head piece is never read as a tube', file: 'core/coreshell.js', from: 'headIsTube = !!(roads.length && roads[roads.length - 1].tube)', to: 'headIsTube = false', caughtBy: 'xsec headState' },
  { id: 'X31 the tube-too-narrow words keep the first, wrong 9.43 m', file: 'validate-ui/labels.js', from: 'narrower than 9.74 m', to: 'narrower than 9.43 m', caughtBy: 'xsec validation words' },
  // (X26, "the other field is not put back", is EQUIVALENT and is not run: the other field is disabled whenever this one holds a target, so
  //  when this one is changed the other already shows its head value; putting it back is a defence with no reachable effect in a browser)
  { id: 'X27 a new document leaves a field disabled', file: 'core/panel.js', from: "for (const [k, f] of [['cup', cup], ['tube', tube]]) { f.disabled = false;", to: "for (const [k, f] of [['cup', cup], ['tube', tube]]) {", caughtBy: 'xsec panel: a piece is a cup OR a tube' },
  { id: 'X28 the cup-or-tube rule is never wired', file: 'core/panel.js', from: 'f.oninput = f.onchange = () => { exclusive(f); ghost(); };', to: 'f.oninput = f.onchange = ghost;', caughtBy: 'xsec panel: a piece is a cup OR a tube' },
];

function runMutant(m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-xsec-mut-')), app = path.join(dir, 'app');
  try {
    for (const d of fs.readdirSync(path.join(ROOT, 'app'), { withFileTypes: true })) if (d.isDirectory() && d.name !== 'test') fs.cpSync(path.join(ROOT, 'app', d.name), path.join(app, d.name), { recursive: true });
    for (const f of fs.readdirSync(path.join(ROOT, 'app'), { withFileTypes: true })) if (f.isFile()) fs.copyFileSync(path.join(ROOT, 'app', f.name), path.join(app, f.name));
    fs.mkdirSync(path.join(app, 'test'));
    for (const t of TESTS) fs.copyFileSync(path.join(__dirname, t), path.join(app, 'test', t));
    fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'tools'), path.join(dir, 'tools'), { recursive: true });
    const f = path.join(app, m.file), src = m.from === null ? '' : fs.readFileSync(f, 'utf8'), n = m.from === null ? 1 : src.split(m.from).length - 1, applied = n === 1;
    if (applied && m.from !== null) fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const tap = path.join(dir, '.inner-run.tap');   // D352: a TAP copy, the only place a dead file's exit code shows
    const r = spawnSync(process.execPath, ['--test', ...IR.reporterArgs(tap), '--test-concurrency=1', ...TESTS.map((t) => path.join(app, 'test', t))],
      { env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), encoding: 'utf8', timeout: 600000 });
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
      if (!exits.length || TESTS.length > 1) throw new Error(IR.neverReported(crashed, exits, TESTS.length));
    }
    return { applied, n, caught, failed: [...new Set(failed)] };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('control: the unmutated temp copy passes every cross-section test', () => {
  const r = runMutant({ id: 'control', file: 'core/panel.js', from: null, to: null, caughtBy: '(no test is named this)' });
  assert.deepEqual(r.failed, [], `the unmutated copy fails: ${r.failed.join(' | ')}`);
});
// D352: a crashed inner run is no verdict. The stand-in puts the machine's crash (test/inner_run.js STANDIN) at the top of the first mutant's file;
// it looks for '.test.js', which every dead file's own ✖ line contains, so a dead file's line must not count as the catch
test('a crashed inner run reads NOT TESTED, never a verdict (the crash stand-in, D352)', () => {
  const m0 = MUTATIONS[0], first = fs.readFileSync(path.join(ROOT, 'app', m0.file), 'utf8').split(/\r?\n/)[0];
  const said = IR.reading(() => { const r = runMutant({ ...m0, id: 'crash stand-in', caughtBy: '.test.js', from: first, to: IR.STANDIN + first }); return r.caught ? 'caught' : `NOT CAUGHT; failing tests on the mutant: ${r.failed.join(' | ') || 'none'}`; });
  assert.match(said, IR.NOT_TESTED);
});
// D353: a crash AFTER an unrelated failing row leaves no file-level entry in the TAP, so only the named test's silence shows it. The second
// stand-in (test/inner_run.js STANDIN_AFTER_FAIL) fails a row and then dies, in every file that loads the first mutant's file; caughtBy is the real one
test('a crash after an unrelated failing row reads NOT TESTED, never NOT CAUGHT (the second stand-in, D353)', () => {
  const m0 = MUTATIONS[0], first = fs.readFileSync(path.join(ROOT, 'app', m0.file), 'utf8').split(/\r?\n/)[0];
  const said = IR.reading(() => { const r = runMutant({ ...m0, id: 'crash after a failing row', from: first, to: IR.STANDIN_AFTER_FAIL + first }); return r.caught ? 'caught' : `NOT CAUGHT; failing tests on the mutant: ${r.failed.join(' | ') || 'none'}`; });
  assert.match(said, IR.NOT_TESTED_ANY);
});
// D354: a mutant that makes a module throw on load, in a run of one file, is a verdict as before D353: NOT CAUGHT, naming the file. This row
// guards the exemption on the D353 line (M2: without it the row reads NOT TESTED)
test('a load throw in a run of one file reads NOT CAUGHT as before, never NOT TESTED (the load-throw stand-in, D354)', () => {
  const m0 = MUTATIONS[0], first = fs.readFileSync(path.join(ROOT, 'app', m0.file), 'utf8').split(/\r?\n/)[0];
  const said = IR.reading(() => { const r = runMutant({ ...m0, id: 'load throw', from: first, to: IR.LOAD_THROW + first }); return r.caught ? 'caught' : `NOT CAUGHT; failing tests on the mutant: ${r.failed.join(' | ') || 'none'}`; });
  assert.match(said, IR.NOT_CAUGHT_LOAD);
});
for (const m of MUTATIONS) {
  test(`mutation ${m.id}: applied, and caught by "${m.caughtBy}…"`, () => {
    const r = runMutant(m);
    assert.ok(r.applied, `NOT APPLIED: "${m.from}" occurs ${r.n} times in app/${m.file}`);
    assert.ok(r.caught, `NOT CAUGHT; failing tests on the mutant: ${r.failed.join(' | ') || 'none'}`);
  });
}
module.exports = { MUTATIONS, runMutant };
