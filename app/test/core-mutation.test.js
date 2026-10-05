// core-mutation.test.js: node --test app/test/core-mutation.test.js
// The equation core's app side (D186, pane C), mutated. Each mutation copies app/ (core, preview, camera, export, lib, testhook,
// and core-shell.test.js), src/ and tools/ to a temp folder, applies ONE source patch, and runs the COPIED core-shell.test.js
// there, so its relative requires reach the mutant. "Applied" means the patch text was found exactly once; "caught" means the
// named test FAILED on the mutant. A CONTROL runs the unmutated copy first. The originals are never touched.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
// the tests every mutant is run against (L130 adds the readout display's)
const TESTS = ['core-shell.test.js', 'core-readout-display.test.js'];

const MUTATIONS = [
  // L130, the readout display (app/core/labels.js, app/core/panel.js)
  { id: 'R1 the sign of an angle flipped', file: 'core/labels.js', from: "return `${v > 0 ? '+' : MINUS}", to: "return `${v > 0 ? MINUS : '+'}", caughtBy: 'the strings' },
  { id: 'R2 zero is signed', file: 'core/labels.js', from: "if (v === 0) return '0.0°';", to: '', caughtBy: 'the strings' },
  { id: 'R3 bank shown as its end value, not the change', file: 'core/labels.js', from: 'bank: fmtDeg(r.bankToDeg - r.bankFromDeg)', to: 'bank: fmtDeg(r.bankToDeg)', caughtBy: 'the strings' },
  { id: 'R4 rounding without the binary guard', file: 'core/labels.js', from: 'Math.abs(x) * 10 + 1e-7', to: 'Math.abs(x) * 10', caughtBy: 'the strings' },
  { id: 'R5 the head keep-out ignored', file: 'core/labels.js', from: 'if (keep && hits(rect, keep)) continue;', to: '', caughtBy: 'the layout' },
  { id: 'R6 labels may overlap', file: 'core/labels.js', from: 'if (drawn.some((d) => hits(rect, d.rect))) continue;', to: '', caughtBy: 'the layout' },
  { id: 'R7 anchors cached by the path object', file: 'core/labels.js', from: 'if (anchorsFor !== track.segments) { anchors = anchorsOf(track); anchorsFor = track.segments; }', to: 'if (anchorsFor !== track.path) { anchors = anchorsOf(track); anchorsFor = track.path; }', caughtBy: 'the labels follow a path the preview extends IN PLACE' },
  { id: 'R8 the layer is not put back in the page', file: 'core/labels.js', from: 'if (!layer.isConnected) stage.append(layer);', to: '', caughtBy: 'the labels follow a path the preview extends IN PLACE' },
  { id: 'R11 a label never slides off its piece\'s middle', file: 'core/labels.js', from: 'for (const a of cands) {', to: 'for (const a of cands.slice(0, 1)) {', caughtBy: 'a piece whose middle is behind the camera' },
  // D187, B's M5 score: the head's own label is never culled, and the label box holds only an opaque background and its text
  { id: "R13 the head's label may be culled", file: 'core/labels.js', from: 'if (!placed && it.head) placed = headPlace(it, view, keep);', to: '', caughtBy: "the layout: the head's own label is never culled" },
  { id: 'R14 a head piece with nothing on screen has no label', file: 'core/labels.js', from: 'if (!p && isHead) p = hp ?', to: 'if (false) p = hp ?', caughtBy: "the head's own piece is labelled even when none of it is on screen" },
  { id: 'R15 the road bleeds through the label', file: 'core/labels.js', from: 'background:#0b0d11;', to: 'background:rgba(11,13,17,0.94);', caughtBy: 'the label box holds only' },
  { id: 'R16 the label box has a border and round corners again', file: 'core/labels.js', from: 'border:0;border-radius:0;', to: 'border:1px solid #3a4250;border-radius:4px;', caughtBy: 'the label box holds only' },
  { id: "R17 the head's fallback place may cover the head", file: 'core/labels.js', from: 'for (const avoid of [keep, core])', to: 'for (const avoid of [null])', caughtBy: "the layout: the head's own label is never culled" },
  { id: 'R12 no ring clears a large head keep-out', file: 'core/labels.js', from: 'if (view.head) { const d = Math.hypot(it.x - view.head.x, it.y - view.head.y); gaps.push(view.head.r + d + 12, 2 * view.head.r + d + 12); }', to: '', caughtBy: 'the layout: a label anchored on a large head keep-out' },
  { id: 'R9 the panel readout waits for the next state change', file: 'core/panel.js', from: 'readout();   // first, and synchronously', to: '//', caughtBy: 'the panel shows the ghost' },
  { id: 'R10 the ghost readout is the LAST placed piece, not the candidate', file: 'core/coreshell.js', from: 'candidateReadout: (opts) => RD.candidateReadout(doc(), opts),', to: "candidateReadout: (opts) => RD.pieceReadout(doc(), doc().pieces.length - 1),", caughtBy: 'the panel shows the ghost' },
  // D190, the CUP UI (E's seal row 7, the UI half; K7-3 and K7-4 are the seal's own planted controls, here on the panel)
  { id: 'U1 the cup field is not sent to the core', file: 'core/panel.js', from: 'if (k !== null) targets.c = k;', to: '', caughtBy: 'extendOptions: the cup field is the target c' },
  { id: 'U2 the cup is sent in radians', file: 'core/panel.js', from: 'if (k !== null) targets.c = k;', to: 'if (k !== null) targets.c = k * DEG;', caughtBy: 'extendOptions: the cup field is the target c' },
  { id: 'U3 the panel clamps the cup, hiding the core guard', file: 'core/panel.js', from: 'if (k !== null) targets.c = k;', to: 'if (k !== null) targets.c = Math.min(150, Math.max(0, k));', caughtBy: 'extendOptions: the cup field is the target c' },
  { id: 'U4 the cup cell shows the typed target, not the document', file: 'core/panel.js', from: 'cup: `${fmtCup(r.cupFromDeg)} → ${fmtCup(r.cupToDeg)}`', to: 'cup: `${fmtCup(r.cupFromDeg)} → ${fmtCup(cup.value === \'\' ? r.cupToDeg : Number(cup.value))}`', caughtBy: 'the readout shows cup from → to' },
  { id: 'U5 (K7-4) the cup cell wired to the bank values', file: 'core/panel.js', from: 'cup: `${fmtCup(r.cupFromDeg)} → ${fmtCup(r.cupToDeg)}`', to: 'cup: `${fmtCup(r.bankFromDeg)} → ${fmtCup(r.bankToDeg)}`', caughtBy: 'the readout shows cup from → to' },
  { id: 'U6 (K7-3) the cup shown in radians', file: 'core/panel.js', from: 'const fmtCup = (x) => LB.fmtDeg(x)', to: 'const fmtCup = (x) => LB.fmtDeg(x * DEG)', caughtBy: 'the readout shows cup from → to' },
  { id: 'U7 the cup field does not redraw the readout', file: 'core/panel.js', from: 'f.oninput = f.onchange = () => { exclusive(f); ghost(); };', to: 'f.oninput = f.onchange = () => { exclusive(f); };', caughtBy: 'the cup cell follows the cup field' },
  { id: 'U8 the brush has no cup channel', file: 'core/panel.js', from: "['kv', 'kh', 'phi', 'w', 'r', 'c', 'e', 's', 't']", to: "['kv', 'kh', 'phi', 'w', 'r', 'e', 's', 't']", caughtBy: 'the brush\'s channel list gains cup' },
  { id: 'U9 the cup field is not on the panel', file: 'core/panel.js', from: "fieldAt('cup °', cup, 'cup'), ", to: '', caughtBy: 'the Extend panel has a "cup °" field' },
  // D194b, "at start": a ticked field with a target goes in transition as { channel: min(20 m, length) }; nothing else changes
  { id: 'V1 the at-start boxes are ignored', file: 'core/panel.js', from: 'if (Object.keys(transition).length) out.transition = transition;', to: '', caughtBy: 'extendOptions "at start"' },
  { id: 'V2 an untouched field is sent at start', file: 'core/panel.js', from: 'if (atStart[f] && targets[ch] !== undefined) transition[ch]', to: 'if (atStart[f]) transition[ch]', caughtBy: 'extendOptions "at start"' },
  { id: 'V3 the span is not held to the piece', file: 'core/panel.js', from: 'transition[ch] = Math.min(AT_START_M, out.length);', to: 'transition[ch] = AT_START_M;', caughtBy: 'extendOptions "at start"' },
  { id: 'V4 transition sent as one number for all channels', file: 'core/panel.js', from: 'if (Object.keys(transition).length) out.transition = transition;', to: 'if (Object.keys(transition).length) out.transition = AT_START_M;', caughtBy: 'extendOptions "at start"' },
  { id: 'V5 a field sent on the wrong channel', file: 'core/panel.js', from: "bank: 'phi', width: 'w'", to: "bank: 'w', width: 'phi'", caughtBy: 'extendOptions "at start"' },
  { id: 'V6 the panel never passes the boxes', file: 'core/panel.js', from: 'atStart: Object.fromEntries(Object.entries(atStart).map(([k, box]) => [k, box.checked])),', to: '', caughtBy: 'the panel: an "at start" box' },
  { id: 'V7 ticking a box does not redraw', file: 'core/panel.js', from: 'width, ...Object.values(atStart)]) f.oninput', to: 'width]) f.oninput', caughtBy: 'the panel: an "at start" box' },  { id: 'C1 a brush frame builds on the last frame, not the drag\'s base', file: 'core/coreshell.js',
    from: 'const t0 = now(), res = brushed(b, delta)', to: 'const t0 = now(), res = brushed({ ...b, base: doc() }, delta)', caughtBy: 'the rate brush' },
  { id: 'C2 the drag never ends in the history', file: 'core/coreshell.js',
    from: 'history: D.endDrag(st.history), brush: null', to: 'history: st.history, brush: null', caughtBy: 'the rate brush' },
  { id: 'C3 the local brush is not the default', file: 'core/coreshell.js',
    from: "beginBrush({ mode = brushFn ? 'local' : 'rate',", to: "beginBrush({ mode = 'rate',", caughtBy: 'the local (height / sideways) brush' },
  { id: 'C20 sideways is sent as a hill', file: 'core/coreshell.js',
    from: "mode: b.channel === 'lateral' ? 'swerve' : 'hill'", to: "mode: 'hill'", caughtBy: 'the local (height / sideways) brush' },
  { id: 'C21 with E\'s brush, every channel is sent as rate', file: 'core/coreshell.js',
    from: "mode: b.channel === 'kh' || b.channel === 'kv' ? 'rate' : 'value'", to: "mode: 'rate'", caughtBy: 'with E\'s brush, the rate brush goes through it' },
  { id: 'C4 a second close runs again', file: 'core/coreshell.js',
    from: "if (doc().closed) return set({ message: 'the loop is already closed' });", to: '', caughtBy: 'close: one click' },
  { id: 'C5 the heading brush may open a closed loop', file: 'core/coreshell.js',
    from: "if (!brushFn && doc().closed && mode === 'rate' && (channel === 'kh' || channel === 'kv'))", to: 'if (false)', caughtBy: 'close: one click' },
  { id: 'C7 export runs on an open track', file: 'core/coreshell.js',
    from: "if (!doc().closed) throw exportError('OPEN_LOOP', 'the loop is not closed: close it first (one click), then export');", to: '', caughtBy: 'export: an open track is refused' },   // D234: re-pointed, the refusal now leaves through stop() (it removes the picked empty folder); D239: re-pointed again, the check now lives in buildExport, which Export and Install to AC share
  { id: 'C8 the list shows the piece builder\'s tracks too', file: 'core/coreshell.js',
    from: '.filter((n) => n.startsWith(PREFIX))', to: '', caughtBy: 'save and open use their own prefix' },
  { id: 'C12 turn is degrees per metre, not per 100 m', file: 'core/panel.js',
    from: 'targets.kh = t * DEG / 100;', to: 'targets.kh = t * DEG;', caughtBy: 'extendOptions' },
  { id: 'C14 the pick takes the farthest station', file: 'preview/preview.js',
    from: 'if (d <= maxPx && (!best || d < best.px))', to: 'if (d <= maxPx && (!best || d > best.px))', caughtBy: 'the pick' },
  { id: 'C15 the pick sees through the back of the camera', file: 'preview/preview.js',
    from: 'const c = M.apply(VP, m.pos); if (!(c[3] > 0)) continue;', to: 'const c = M.apply(VP, m.pos);', caughtBy: 'the pick' },
  { id: 'C16 the ghost is not what extend builds', file: 'core/coreshell.js',
    from: 'const d = extend(doc(), opts); return { segments: segmentsOf(d)', to: 'const d = extend(doc(), { ...opts, targets: {} }); return { segments: segmentsOf(d)', caughtBy: 'the ghost of an extension' },
  { id: 'C17 export goes to the word exporter', file: 'export/export.js',
    from: 'const result = fromwords.exportSegments(segments, meta, { outDir: OUT, variant, textures, markers });', to: 'const result = fromwords.exportTrack(segments, { outDir: OUT, variant, textures });', caughtBy: 'export: an open track is refused' },
  { id: 'C18 the close does not go round the user\'s straights', file: 'core/coreshell.js',
    from: '...(st.lastEdited || [last]), ...straightPieces(doc())', to: '...(st.lastEdited || [last])', caughtBy: 'close: one click' },
  { id: 'C19 the export is handed no start layout', file: 'core/coreshell.js',
    from: "{ ...opts, markers }", to: '{ ...opts }', caughtBy: 'export: an open track is refused' },
  { id: 'C22 the widened radius is not shown', file: 'core/coreshell.js',
    from: 'used !== null && used > b.r + 1e-9 ?', to: 'false ?', caughtBy: 'a brush E widened says so' },
  { id: 'L1 the track model ignores the lift', file: 'preview/trackmodel.js',
    from: "lift = typeof resolved.lift === 'function' ? resolved.lift : null;", to: 'lift = null;', caughtBy: 'the track model draws the LIFTED road' },
  { id: 'L2 a lift-only change is taken as the same track', file: 'preview/trackmodel.js',
    from: "if (a === lk.length && a === liftKeys.length) how = 'same';", to: "if (true) how = 'same';", caughtBy: 'the track model draws the LIFTED road' },
  { id: 'L3 the mesh is not keyed by the lift', file: 'preview/trackmodel.js',
    from: 'const meshSegs = (segs, lk) => segs.map((s, j) => (lk[j] === null ? s : { ...s, _lift: lk[j] }));', to: 'const meshSegs = (segs) => segs;', caughtBy: 'the track model draws the LIFTED road' },
  { id: 'L4 the export does not lift the path', root: 'src', file: 'export/fromwords.js',
    from: "if (typeof meta.liftPath === 'function') p = meta.liftPath(p);", to: '', caughtBy: 'the export lifts the path' },
  { id: 'C23 the radiusUsed E reports is not read', file: 'core/coreshell.js',
    from: 'Number.isFinite(res.radiusUsed) ? res.radiusUsed :', to: '', caughtBy: 'landed core: a narrow brush' },
  { id: 'C24 sharp is never passed to E', file: 'core/coreshell.js',
    from: '...(b.sharp ? { sharp: true } : {})', to: '', caughtBy: 'the sharp opt-in' },
  { id: 'P1 the export starts at the origin', root: 'src', file: 'export/fromwords.js',
    from: '...(meta.start ? { start: meta.start } : {})', to: '', caughtBy: 'a lap that starts pitched' },
  { id: 'P2 the preview starts at the origin', file: 'preview/trackmodel.js',
    from: "...(startOpt ? { start: startOpt } : {})", to: '', caughtBy: 'a lap that starts pitched' },
  { id: 'P3 the shell does not hand on the start', file: 'core/coreshell.js',
    from: 'closed: !!d.closed, start: startOf(d),', to: 'closed: !!d.closed,', caughtBy: 'a lap that starts pitched' },
];

function runMutant(m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-core-mut-')), app = path.join(dir, 'app');
  try {
    for (const d of ['core', 'preview', 'camera', 'export', 'lib', 'testhook']) fs.cpSync(path.join(ROOT, 'app', d), path.join(app, d), { recursive: true });
    fs.mkdirSync(path.join(app, 'test'));
    for (const t of TESTS) fs.copyFileSync(path.join(__dirname, t), path.join(app, 'test', t));
    fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'tools'), path.join(dir, 'tools'), { recursive: true });
    const f = m.root === 'src' ? path.join(dir, 'src', m.file) : path.join(app, m.file), src = fs.readFileSync(f, 'utf8'), n = m.from === null ? 1 : src.split(m.from).length - 1, applied = n === 1;
    if (applied && m.from !== null) fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const r = spawnSync(process.execPath, ['--test', '--test-concurrency=4', ...TESTS.map((t) => path.join(app, 'test', t))],
      { env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), encoding: 'utf8', timeout: 600000 });
    if (r.error) throw r.error;
    const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
    if (!/ℹ tests \d+/.test(out)) throw new Error('the mutant test run printed no summary:\n' + out.slice(0, 2000));
    const failed = out.split('\n').filter((l) => /^✖ /.test(l) && !/^✖ failing tests:/.test(l)).map((l) => l.slice(2));
    return { applied, n, caught: failed.some((l) => l.includes(m.caughtBy)), failed: [...new Set(failed)] };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('control: the unmutated temp copy passes every core-shell test', () => {
  const r = runMutant({ id: 'control', file: 'core/panel.js', from: null, to: null, caughtBy: '(no test is named this)' });
  assert.deepEqual(r.failed, [], `the unmutated copy fails: ${r.failed.join(' | ')}`);
});
for (const m of MUTATIONS) {
  test(`mutation ${m.id}: applied, and caught by "${m.caughtBy}…"`, () => {
    const r = runMutant(m);
    assert.ok(r.applied, `NOT APPLIED: "${m.from}" occurs ${r.n} times in app/${m.file}`);
    assert.ok(r.caught, `NOT CAUGHT; failing tests on the mutant: ${r.failed.join(' | ') || 'none'}`);
  });
}
module.exports = { MUTATIONS, runMutant };
