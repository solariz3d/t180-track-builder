// core-shell.test.js: node --test app/test/core-shell.test.js
// The equation core's shell (app/core/coreshell.js), its panel's pure parts (app/core/panel.js) and the preview's pick
// (app/preview/preview.js pickAt), headless (D186, pane C). The export runs the real exporter through the in-memory shim, as
// the webview does (app/export/export.js runSegments), with the self-intersection check on.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createCoreShell, PREFIX, STRAIGHT_K, startLayout } = require('../core/coreshell.js');
const { extendOptions } = require('../core/panel.js');
const { pickAt } = require('../preview/preview.js');
const { makeExporter } = require('../export/export.js');
const { toPath } = require('../../src/core/adapter.js');
const D = require('../../src/core/document.js');
const { headCamera } = require('../../src/geom/index.js');

const REPO = path.resolve(__dirname, '..', '..');
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b} (±${tol})`);
const fromDisk = async (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
function memStorage() {
  const docs = new Map(), s = { writes: [], removed: [] };
  // the native side's two folder commands (D226): only an EMPTY real folder directly in content/tracks, not t180b_*, reads empty or is removed
  const direct = (d) => { const p = String(d).replace(/\\/g, '/').split('/').filter(Boolean), i = p.findIndex((x, k) => x.toLowerCase() === 'content' && (p[k + 1] || '').toLowerCase() === 'tracks' && p.length === k + 3); return i >= 0 && !/^t180b_/i.test(p[i + 2]); };
  s.folderIsEmpty = async (d) => direct(d) && fs.existsSync(d) && fs.lstatSync(d).isDirectory() && fs.readdirSync(d).length === 0;
  s.removeEmptyFolder = async (d) => { if (!(await s.folderIsEmpty(d))) throw new Error('not an empty folder directly in content\\tracks: nothing removed'); fs.rmdirSync(d); s.removed.push(d); };
  return Object.assign(s, {
    saveDoc: async (n, t) => { docs.set(n, t); }, openDoc: async (n) => { if (!docs.has(n)) throw new Error(`no track ${n}`); return docs.get(n); }, listDocs: async () => [...docs.keys()],
    writeExport: async (dir, folder, files) => { s.writes.push({ dir, folder, n: files.length }); for (const f of files) { const p = path.join(dir, folder, ...f.path.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.bytes); } },
  });
}
const text = (s) => D.serialize(s.getState().history.present);
const R = 180, Q = Math.PI * R / 2;
/** A lap one click from closed: a 300 m straight, four quarter turns (each reaching 1/R over 40 m), and a straightening. */
async function lap(opts = {}) {
  const s = await createCoreShell({ brushFn: null, ...opts });
  s.extend({ length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  s.extend({ length: 60, transition: 40, targets: { kh: 0 } });
  assert.equal(s.getState().message, null);
  return s;
}

// found in the real window (D186): the core reaches tools/piecewise.cjs, which requires fs, and the webview's loader refuses a
// node built-in; node's own require hides that. The page (app/index.html startCore) gives it the exporter's in-memory shim.
test('the core loads through the WEBVIEW\'s loader with the node shim, builds the same track as node\'s, and is refused without the shim', async () => {
  const { loadCjs } = require('../lib/cjs.js'), { createShim } = require('../export/node-shim.js');
  await assert.rejects(loadCjs('app/core/coreshell.js', fromDisk), /"fs"/);
  const shim = createShim(), C = await loadCjs('app/core/coreshell.js', fromDisk, { builtins: shim.builtins, globals: { Buffer: shim.Buffer } });
  const a = await C.createCoreShell({ brushFn: null }), b = await createCoreShell({ brushFn: null });
  for (const s of [a, b]) { s.extend({ length: 200 }); s.extend({ length: 150, targets: { kh: 0.01, phi: 0.1 } }); }
  assert.equal(a.text(), b.text());
});

test('extend: a piece is added at the head, the segments are the adapter\'s, and undo / redo walk it back and forth exactly', async () => {
  const s = await createCoreShell({ brushFn: null });
  assert.deepEqual(s.getState().resolved.segments, [], 'an empty track has no segments');
  s.extend({ length: 120 });
  const st = s.getState(), d = st.history.present;
  assert.equal(d.pieces.length, 1); assert.deepEqual(st.resolved.segments, toPath(d).segments);
  assert.equal(st.lastStep.op, 'extend'); assert.ok(st.lastStep.ms >= 0);
  const one = text(s); s.extend({ length: 80, targets: { kh: 0.01 } }); const two = text(s);
  s.undo(); assert.equal(text(s), one); s.redo(); assert.equal(text(s), two);
});

test('the ghost of an extension is exactly what the click then builds', async () => {
  const s = await createCoreShell({ brushFn: null });
  s.extend({ length: 100 });
  const o = extendOptions({ length: 150, turn: 20, climb: '', bank: 5, width: '' }), ghost = s.candidate(o);
  s.extend(o); assert.deepEqual(ghost.segments, s.getState().resolved.segments);
});

test('extendOptions: empty fields continue; turn and climb are degrees per 100 m, bank degrees, width metres', () => {
  assert.deepEqual(extendOptions({ length: '50', turn: '', climb: '', bank: '', width: '' }), { length: 50, targets: {} });
  const o = extendOptions({ length: 50, turn: 18, climb: -9, bank: 10, width: 30 });
  assert.ok(Math.abs(o.targets.kh - Math.PI / 1000) < 1e-15); assert.ok(Math.abs(o.targets.kv + Math.PI / 2000) < 1e-15);
  assert.ok(Math.abs(o.targets.phi - Math.PI / 18) < 1e-15); assert.equal(o.targets.w, 30);
});

test('a failed extend changes nothing and says why', async () => {
  const s = await createCoreShell({ brushFn: null }); s.extend({ length: 100 }); const before = text(s);
  s.extend({ length: -5 }); assert.match(s.getState().message, /length/); assert.equal(text(s), before);
});

test('the rate brush: one drag is one undo step, every frame applies the WHOLE delta to the drag\'s base, and undo restores the track exactly', async () => {
  const s = await createCoreShell({ brushFn: null }); s.extend({ length: 400 }); const before = text(s);
  s.beginBrush({ mode: 'rate', channel: 'kv', s0: 200, r: 80 });
  s.brushTo(0.004); s.brushTo(0.001); const dragged = text(s);
  s.endBrush(); assert.equal(s.getState().brush, null);
  const once = await createCoreShell({ brushFn: null }); once.extend({ length: 400 }); once.sculptOnce({ channel: 'kv', s0: 200, r: 80, delta: 0.001 });
  assert.equal(dragged, text(once), 'the last frame equals one stroke of that delta from the base');
  assert.notEqual(dragged, before); s.undo(); assert.equal(text(s), before, 'one undo takes the whole drag back');
});

test('the local (height / sideways) brush: refused by name while E\'s brush is not in the build; E\'s hill and swerve when it is', async () => {
  const s = await createCoreShell({ brushFn: null }); s.extend({ length: 300 }); const before = text(s);
  assert.deepEqual(s.brushModes(), ['rate']);
  s.beginBrush({ mode: 'local', channel: 'height', s0: 150, r: 50 }); assert.match(s.getState().message, /not in this build yet/); assert.equal(text(s), before);
  const calls = [], fake = (doc, o) => { calls.push(o); return { doc }; };
  const t = await createCoreShell({ brushFn: fake }); t.extend({ length: 300 });
  assert.deepEqual(t.brushModes(), ['local', 'rate']);
  t.beginBrush({ channel: 'height', s0: 150, r: 50 }); t.brushTo(2); t.endBrush();
  t.beginBrush({ mode: 'local', channel: 'lateral', s0: 100, r: 40 }); t.brushTo(-1.5); t.endBrush();
  assert.deepEqual(calls, [{ mode: 'hill', s0: 150, r: 50, delta: 2 }, { mode: 'swerve', s0: 100, r: 40, delta: -1.5 }], 'the default is the local brush: height is E\'s hill, sideways its swerve');
});

test('with E\'s brush, the rate brush goes through it: kh and kv as its rate mode, bank, width and rise as its value mode', async () => {
  const calls = [], fake = (doc, o) => { calls.push(o); return { doc }; };
  const s = await createCoreShell({ brushFn: fake }); s.extend({ length: 300 });
  for (const channel of ['kv', 'phi']) { s.beginBrush({ mode: 'rate', channel, s0: 150, r: 60 }); s.brushTo(0.01); s.endBrush(); }
  assert.deepEqual(calls, [{ mode: 'rate', channel: 'kv', s0: 150, r: 60, delta: 0.01 }, { mode: 'value', channel: 'phi', s0: 150, r: 60, delta: 0.01 }]);
});

test('a brush E widened says so, with the radius it really used (the chair\'s ruling 2: always shown)', async () => {
  const s = await createCoreShell({ brushFn: (doc) => ({ doc, rUsed: 57 }) }); s.extend({ length: 300 });
  s.beginBrush({ channel: 'height', s0: 150, r: 20 }); s.brushTo(1);
  assert.match(s.getState().message, /widened to 57 m \(asked 20 m\)/); assert.equal(s.getState().brush.rUsed, 57); s.endBrush();
  const t = await createCoreShell({ brushFn: (doc) => ({ doc, rUsed: 60 }) }); t.extend({ length: 300 });
  t.beginBrush({ channel: 'height', s0: 150, r: 60 }); t.brushTo(1); assert.equal(t.getState().message, null, 'not widened: nothing to say');
});

test('the sharp opt-in reaches E\'s brush only when asked; the default is off (the chair\'s ruling 2: widen by default)', async () => {
  const calls = [], s = await createCoreShell({ brushFn: (doc, o) => { calls.push(o); return { doc }; } }); s.extend({ length: 300 });
  s.beginBrush({ channel: 'height', s0: 150, r: 20 }); s.brushTo(1); s.endBrush();
  s.beginBrush({ channel: 'height', s0: 150, r: 20, sharp: true }); s.brushTo(1); s.endBrush();
  assert.equal(calls[0].sharp, undefined, 'off by default'); assert.equal(calls[1].sharp, true, 'on when asked');
});

test('E\'s refusal (a hill with no offset channel yet) is the message, and nothing changes', async () => {
  const refuse = () => { throw new D.CoreError('NOT_YET', 'the document has no h channel'); };
  const s = await createCoreShell({ brushFn: refuse }); s.extend({ length: 300 }); const before = text(s);
  s.beginBrush({ channel: 'height', s0: 150, r: 50 }); s.brushTo(3);
  assert.match(s.getState().message, /NOT_YET: the document has no h channel/); s.endBrush(); assert.equal(text(s), before);
});

test('close: one click closes the lap; extending a closed loop is refused; the rate brush on heading refuses to open it', async () => {
  const s = await lap();
  s.close();
  assert.equal(s.getState().messageKind, 'ok', s.getState().message); assert.equal(s.getState().history.present.closed, true);
  assert.equal(s.getState().resolved.closed, true);
  // the close goes round the user's straight: it stays nearly straight (radius ≥ 5 km), where unguarded it bent to ~370 m
  const straightKh = Math.max(...s.getState().history.present.pieces[0].channels.kh.map(Math.abs));
  assert.ok(straightKh <= STRAIGHT_K, `the straight bent to |κh| ${straightKh}`);
  const closedText = text(s);
  s.close(); assert.match(s.getState().message, /already closed/); assert.equal(text(s), closedText, 'a second close changes nothing');
  s.extend({ length: 50 }); assert.ok(s.getState().message); assert.equal(text(s), closedText);
  s.beginBrush({ mode: 'rate', channel: 'kh', s0: 400, r: 60 }); assert.match(s.getState().message, /would open it/); assert.equal(s.getState().brush, null);
  s.undo(); assert.equal(s.getState().history.present.closed, false, 'undo takes the close back');
});

test('export: an open track is refused before anything runs; a closed lap goes through the SAME exporter and its files are written', async () => {
  const st = memStorage(), ex = await makeExporter(fromDisk);
  const s = await lap({ storage: st, exporter: ex });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-core-export-')); made.push(dir);
  await s.exportTo(dir); assert.match(s.getState().message, /not closed/); assert.equal(st.writes.length, 0);
  s.close(); await s.exportTo(dir);
  assert.equal(s.getState().messageKind, 'ok', s.getState().message);
  assert.ok(st.writes.length >= 1 && st.writes[0].folder.startsWith('t180b_'));
  const folder = path.join(dir, st.writes[0].folder);
  assert.ok(fs.readdirSync(folder).some((f) => f.endsWith('.kn5'))); assert.ok(fs.existsSync(path.join(folder, 'ai', 'fast_lane.ai')));
});

test('save and open use their own prefix, so the piece builder\'s tracks are neither listed nor opened here', async () => {
  const st = memStorage(); await st.saveDoc('a piece track', 'not a core document');
  const s = await createCoreShell({ storage: st, brushFn: null }); s.extend({ length: 90 }); const t = text(s);
  await s.save('my lap'); assert.deepEqual(await s.list(), ['my lap']); assert.ok((await st.listDocs()).includes(`${PREFIX}my lap`));
  s.newDoc(); await s.open('my lap'); assert.equal(text(s), t); assert.equal(s.getState().name, 'my lap');
  await s.save('../bad'); assert.match(s.getState().message, /track name/);
});

test('openExample refuses files that are not a fit and a read, and changes nothing', async () => {
  const s = await createCoreShell({ brushFn: null }); s.extend({ length: 50 }); const before = text(s);
  s.openExample('{', '{}'); assert.match(s.getState().message, /not JSON/); assert.equal(text(s), before);
  s.openExample('{"schema":"nope"}', '{}'); assert.match(s.getState().message, /BAD_FIT/); assert.equal(text(s), before);
});

// THE LIFT (D186, the chair's ruling 1): A's offsets live in adapter.offsetPath, applied to a PATH, not in the segments. The
// track model must draw the lifted road and re-mesh when only the offsets change. A stand-in lift with offsetPath's contract (an
// unlifted sample is the SAME object; a lifted one is new) raises the samples between two s by a smooth bump.
const liftBy = (H, a, b) => (p) => {
  const up = (m) => { if (m.s <= a || m.s >= b) return m; const t = (m.s - a) / (b - a), y = H * Math.sin(Math.PI * t) ** 2; return { s: m.s, seg: m.seg, pos: [m.pos[0], m.pos[1] + y, m.pos[2]], T: m.T, L: m.L, U: m.U, kvec: m.kvec, roll: m.roll, bankG: m.bankG, grade: m.grade }; };
  const samples = p.samples.map(up), segEnd = p.segEnd.map(up), e = samples[samples.length - 1];
  return { ...p, samples, segEnd, head: { s: e.s, seg: e.seg, pos: e.pos.slice(), T: e.T.slice(), L: e.L.slice(), U: e.U.slice() } };
};
const verts = (r) => r.batches.map((b) => Array.from(b.positions).map((x) => Math.round(x * 1e6)).join(',')).join('|');
test('the track model draws the LIFTED road, re-meshes a lift-only change to exactly a full build, and keeps the lift through an extend', () => {
  const { createTrackModel } = require('../preview/trackmodel.js');
  const d = D.appendPiece(D.createDoc('l'), D.roadPiece({ length: 400, family: 'bowl', channels: { kh: () => 0.002, kv: () => 0, phi: () => 0, w: () => 30, r: () => 3 } }));
  const segs = toPath(d).segments, tm = createTrackModel();
  const flat = tm.update({ segments: segs, closed: false });
  assert.ok(Math.max(...flat.path.samples.map((m) => m.pos[1])) < 1e-9, 'no lift: level');
  const hill = tm.update({ segments: segs, closed: false, lift: liftBy(5, 100, 300) });
  assert.equal(hill.how, 'sculpt', 'a lift-only change is not "same"');
  assert.ok(Math.abs(Math.max(...hill.path.samples.map((m) => m.pos[1])) - 5) < 0.05, 'the shown path is lifted');
  const fresh = createTrackModel().update({ segments: segs, closed: false, lift: liftBy(5, 100, 300) });
  assert.equal(verts(hill), verts(fresh), 'the incremental mesh equals a full build of the lifted road');
  const moved = tm.update({ segments: segs, closed: false, lift: liftBy(3, 150, 350) });
  assert.equal(verts(moved), verts(createTrackModel().update({ segments: segs, closed: false, lift: liftBy(3, 150, 350) })), 'a moved hill too');
  const d2 = D.appendPiece(d, D.roadPiece({ length: 100, family: 'bowl', from: D.endState(d), channels: { kh: () => 0.002, kv: () => 0, phi: () => 0, w: () => 30, r: () => 3 } }));
  const segs2 = toPath(d2).segments, ext = tm.update({ segments: segs2, closed: false, lift: liftBy(3, 150, 350) });
  assert.equal(ext.how, 'extend'); assert.equal(verts(ext), verts(createTrackModel().update({ segments: segs2, closed: false, lift: liftBy(3, 150, 350) })), 'the extend keeps the lift');
  assert.equal(tm.update({ segments: segs2, closed: false, lift: liftBy(3, 150, 350) }).how, 'same', 'the same lift again: nothing to do');
});

test('the export lifts the path before it meshes it (meta.liftPath), so an exported hill is in the kn5', async () => {
  const { buildFromSegments } = require('../../src/export/fromwords.js');
  const s = await lap(); s.close(); const segs = s.getState().resolved.segments;
  // a core track has no straight WORDS: its grid layout is the shell's (startLayout), as exportTo passes it
  const lift = liftBy(4, 900, 1100), base = buildFromSegments(segs, { name: 'lift' }, { markers: startLayout(segs) });
  const lifted = buildFromSegments(segs, { name: 'lift', liftPath: lift }, { markers: startLayout(segs, lift) });
  const top = (b) => Math.max(...b.path.samples.map((m) => m.pos[1]));
  assert.ok(top(base) < 1e-6); assert.ok(Math.abs(top(lifted) - 4) < 0.05, `the exported path is lifted (${top(lifted)})`);
});

// THE LANDED CORE (9714b83: A's h/l offsets and offsetPath, E's brush), end to end through the app's shell, NO fakes. SKIPPED on
// a tree without them.
const SC = require('../../src/core/sculpt.js'), AD = require('../../src/core/adapter.js');
const LANDED = typeof SC.brush === 'function' && typeof AD.offsetPath === 'function' && D.CHANNELS.includes('h');
test('landed core: a 1 m hill brushed in the app is in the preview\'s path and the export\'s', { skip: LANDED ? false : 'E\'s brush / A\'s offsets are not in this tree' }, async () => {
  const { createTrackModel } = require('../preview/trackmodel.js');
  const s = await lap({ brushFn: SC.brush }); s.close(); const tm = createTrackModel(); tm.update(s.getState().resolved);   // lap() defaults to no E brush
  // 1 m over r 140 inside the 300 m straight: a crest the car holds (a 5 m / 100 m hill makes the export's lap proof refuse it,
  // 'leaves-surface': correct, and not what this test is about)
  s.beginBrush({ channel: 'height', s0: 150, r: 140 }); s.brushTo(1);
  assert.ok(!s.getState().message || s.getState().messageKind === 'ok', `the hill brush was accepted: ${s.getState().message}`); s.endBrush();
  assert.equal(s.getState().history.present.closed, true, 'a hill keeps the loop closed (offsets move nothing downstream)');
  const shown = tm.update(s.getState().resolved);
  assert.notEqual(shown.how, 'same', 'the preview rebuilds on a hill-only change (a closed loop is rebuilt in full)');
  const top = Math.max(...shown.path.samples.map((m) => m.pos[1])); assert.ok(Math.abs(top - 1) < 0.02, `the preview draws the hill (${top})`);
  // the export's path, built as buildFromSegments builds it (closed, from the start pose) and lifted by meta.liftPath, carries the
  // hill (the export's own lap proof may refuse a crest the car cannot hold: that is validation's call, tested by it)
  const st = s.getState(), { buildPath } = require('../../src/geom/index.js'), ep = st.resolved.lift(buildPath(st.resolved.segments, { step: 2, closed: true, start: st.resolved.start }));
  assert.ok(Math.abs(Math.max(...ep.samples.map((m) => m.pos[1])) - 1) < 0.02, 'the export path carries the hill');
});
test('landed core: a narrow brush that E widened says so, with the radius it used (E reports radiusUsed)', { skip: LANDED ? false : 'E\'s brush is not in this tree' }, async () => {
  const s = await createCoreShell(); s.extend({ length: 600 });
  s.beginBrush({ channel: 'height', s0: 300, r: 10 }); s.brushTo(2);
  assert.match(s.getState().message || '', /widened to \d+ m \(asked 10 m\)/); s.endBrush();
});

// found by TEST 1 (D186): a real track's document starts where its first station is, turned and PITCHED, and the geometry's shape
// depends on the start pitch. The export, the grid layout and the preview built from the origin, level, so a lap the close had shut
// to 0.05 mm was 8.49 m open in the export (Serpents) and 1.7 km open (Thunderhead). The start pose now travels with the segments.
test('a lap that starts pitched, turned and off the origin: the preview starts and ends where the adapter does, and it closes and exports', async () => {
  const { createTrackModel } = require('../preview/trackmodel.js'), st = memStorage(), ex = await makeExporter(fromDisk);
  const s = await createCoreShell({ storage: st, exporter: ex, brushFn: null });
  s.adopt(D.createDoc('pitched', { start: { pos: [40, 12, -25], heading: 0.9, pitch: 0.06 } }));
  s.extend({ length: 300, family: 'bowl', targets: { kv: 0 } });
  for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  s.extend({ length: 60, transition: 40, targets: { kh: 0 } });
  const d = s.getState().history.present, ref = toPath(d).path, tm = createTrackModel(), shown = tm.update(s.getState().resolved).path;
  for (let c = 0; c < 3; c++) { close(shown.samples[0].pos[c], d.start.pos[c], 1e-9, 'start'); close(shown.head.pos[c], ref.head.pos[c], 1e-6, 'head'); }
  s.close(); assert.equal(s.getState().history.present.closed, true, s.getState().message);
  // the lap the close shut is the lap the export builds: the grid layout builds it closed from the start pose (it threw "does not
  // close" before), and the export is never refused for not closing (its lap proof may still refuse a crest: validation's call)
  const sr = s.getState().resolved; assert.doesNotThrow(() => startLayout(sr.segments, sr.lift, sr.start));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-core-pitched-')); made.push(dir);
  await s.exportTo(dir); assert.doesNotMatch(s.getState().message || '', /does not close|NOT_CLOSED/);
});

test('the pick: the station under a canvas point, as the renderer projects it; nothing when the point is off the track', () => {
  const d = D.appendPiece(D.createDoc('p'), D.roadPiece({ length: 200, family: 'bowl', channels: { kh: () => 0, kv: () => 0, phi: () => 0, w: () => 30, r: () => 4 } }));
  // the build view as the preview frames it, from the station at s = 100, looking along the road at s = 120 ahead of it
  const p = toPath(d).path, W = 800, H = 600, at = p.samples.find((x) => x.s === 100), pose = { ...headCamera(at, { back: 15, up: 6 }), fov: Math.PI / 3 };
  const M = require('../camera/math.js'), VP = M.viewProj(pose, W / H), m = p.samples.find((x) => x.s === 120), c = M.apply(VP, m.pos);
  const x = (c[0] / c[3] * 0.5 + 0.5) * W, y = (1 - (c[1] / c[3] * 0.5 + 0.5)) * H;
  assert.ok(c[3] > 0 && x > 0 && x < W && y > 0 && y < H, 'the station is on screen');
  const hit = pickAt(p, pose, x, y, W, H); assert.ok(hit); assert.equal(hit.s, 120); assert.ok(hit.px < 1e-6);
  assert.equal(pickAt(p, pose, -500, -500, W, H), null);
  // a station BEHIND the camera projects through the eye (w < 0) to a mirrored point on screen: it is never picked there
  const back = p.samples.find((x) => x.s === 40), cb = M.apply(VP, back.pos); assert.ok(cb[3] < 0, 'it is behind the eye');
  const bx = (cb[0] / cb[3] * 0.5 + 0.5) * W, by = (1 - (cb[1] / cb[3] * 0.5 + 0.5)) * H, h2 = pickAt(p, pose, bx, by, W, H, 1e9);
  assert.ok(!h2 || h2.s > 85, `a station behind the eye was picked (${h2 && h2.s})`);
});

test('D226 export (core): an EMPTY folder made directly in content\\tracks exports to content\\tracks and is removed; a folder with anything in it is refused and kept', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-core-empty-')); made.push(root);
  const tracks = path.join(root, 'content', 'tracks'), empty = path.join(tracks, 'T-180 TUBE OVAL'), full = path.join(tracks, 'T180 OVAL');
  fs.mkdirSync(empty, { recursive: true }); fs.mkdirSync(full, { recursive: true }); fs.writeFileSync(path.join(full, 'notes.txt'), 'mine');
  const st = memStorage(), ex = await makeExporter(fromDisk), s = await lap({ storage: st, exporter: ex }); s.close();
  await s.exportTo(full);
  assert.match(s.getState().message, /another track's folder/); assert.equal(st.writes.length, 0); assert.deepEqual(st.removed, []); assert.equal(fs.readFileSync(path.join(full, 'notes.txt'), 'utf8'), 'mine');
  await s.exportTo(empty);
  assert.equal(s.getState().messageKind, 'ok', s.getState().message); assert.deepEqual(st.writes.map((w) => w.dir), [tracks]); assert.ok(st.writes[0].folder.startsWith('t180b_'));
  assert.deepEqual(st.removed, [empty]); assert.ok(!fs.existsSync(empty)); assert.ok(fs.existsSync(path.join(tracks, st.writes[0].folder, 'ai', 'fast_lane.ai'))); assert.ok(fs.existsSync(full));
  assert.match(s.getState().message, /removed the empty folder "T-180 TUBE OVAL"/);
});

// ── D234: the EMPTY folder the user made in the picker goes whatever the outcome (the keeper: "when ever I export by myself, the track is errored in content manager") ──
const acTreeCore = (...inside) => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-core-refused-')); made.push(root); const tracks = path.join(root, 'content', 'tracks'); fs.mkdirSync(tracks, { recursive: true }); for (const n of inside) fs.mkdirSync(path.join(tracks, n), { recursive: true }); return tracks; };
/** A closed lap (the plain bowl lap) whose first piece may carry options, with the real exporter; `exporter` is swappable to stand in for a red. */
async function closedLap(st, ex, first = undefined) {
  const s = await createCoreShell({ brushFn: null, storage: st, exporter: ex });
  s.extend({ length: 300, family: 'bowl', ...(first ? { first } : {}) });
  for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  s.extend({ length: 60, transition: 40, targets: { kh: 0 } }); assert.equal(s.getState().message, null); s.close(); assert.equal(s.getState().history.present.closed, true, s.getState().message); return s;
}
const GONE = /removed the empty folder "T180 TUBE V2" so Content Manager does not list it/;
const refusedAndGone = (s, st, picked, why) => {
  const x = s.getState();
  assert.notEqual(x.messageKind, 'ok', why); assert.match(x.message, why); assert.match(x.message, GONE, 'the message says the empty folder was removed'); assert.equal(x.exportRefusal, x.message, 'the refusal is kept for the page to show where it cannot be missed');
  assert.deepEqual(st.writes, [], 'nothing written'); assert.deepEqual(st.removed, [picked]); assert.ok(!fs.existsSync(picked), 'the folder the user made is GONE');
};

test('D234 an OPEN loop exported into an EMPTY picked folder is refused, the message and the refusal are shown, and the folder is GONE', async () => {
  const tracks = acTreeCore('T180 TUBE V2'), picked = path.join(tracks, 'T180 TUBE V2'), st = memStorage(), s = await lap({ storage: st, exporter: await makeExporter(fromDisk) });   // not closed
  await s.exportTo(picked); refusedAndGone(s, st, picked, /the loop is not closed: close it first/); assert.deepEqual(fs.readdirSync(tracks), [], 'content\\tracks holds nothing the builder did not write');
  // after another action the old refusal is no longer THE message, which is how the page stops showing it
  s.newDoc(); assert.notEqual(s.getState().exportRefusal, s.getState().message);
});

test('D234 a REFUSED GRID (a tube too narrow for even one slot) and a RED lap into an empty picked folder: refused, shown, folder gone', async () => {
  const ex = await makeExporter(fromDisk);
  { const tracks = acTreeCore('T180 TUBE V2'), picked = path.join(tracks, 'T180 TUBE V2'), st = memStorage(), s = await closedLap(st, ex, { w: 20, t: 360 });
    await s.exportTo(picked); refusedAndGone(s, st, picked, /not exported: .*too narrow for even one grid slot/); }
  { const tracks = acTreeCore('T180 TUBE V2'), picked = path.join(tracks, 'T180 TUBE V2'), st = memStorage();
    const red = { ...ex, runSegments() { throw new ex.ExportError('RED', 'the lap has a red', { red: [{ reason: 'steep-without-raycast', s0: 12, s1: 20, source: 'validation' }] }); } };   // a red lap, stood in for: the real reds are core_cup_export's
    const s = await closedLap(st, red); await s.exportTo(picked); refusedAndGone(s, st, picked, /^not exported: a surface is steeper than 50°.* \(1\): at 0\.01–0\.02 km \(p1\)/); assert.equal(s.getState().exportReds.length, 1, 'the red box has the red'); }   // D242: the red refusal is in plain words, every red with where (was: the export's own "RED: the lap has a red")
});

test('D234 a NON-EMPTY foreign folder is untouched in every case (open loop, refused grid, red): the target is refused first, nothing is removed or written', async () => {
  const ex = await makeExporter(fromDisk), red = { ...ex, runSegments() { throw new ex.ExportError('RED', 'the lap has a red', { red: [{ reason: 'x', s0: 1 }] }); } };
  const cases = [['an open loop', async (st) => lap({ storage: st, exporter: ex })], ['a refused grid', (st) => closedLap(st, ex, { w: 20, t: 360 })], ['a red', (st) => closedLap(st, red)]];
  for (const [what, make] of cases) for (const put of [(d) => fs.writeFileSync(path.join(d, 'notes.txt'), 'mine'), (d) => fs.mkdirSync(path.join(d, 'sub'))]) {
    const tracks = acTreeCore('T180 TUBE V2'), picked = path.join(tracks, 'T180 TUBE V2'); put(picked); const before = fs.readdirSync(picked).sort(), st = memStorage(), s = await make(st);
    await s.exportTo(picked);
    assert.match(s.getState().message, /another track's folder/, what); assert.deepEqual(st.writes, [], what); assert.deepEqual(st.removed, [], what); assert.deepEqual(fs.readdirSync(picked).sort(), before, what); assert.ok(fs.existsSync(picked), what);
    assert.equal(s.getState().exportRefusal, s.getState().message, `${what}: the target's refusal is shown too`);
  }
});

test('D234 a successful export is unchanged: written to content\\tracks, the empty folder removed once, no refusal left; and a failed WRITE still removes the empty folder', async () => {
  const tracks = acTreeCore('T180 TUBE V2'), picked = path.join(tracks, 'T180 TUBE V2'), st = memStorage(), s = await closedLap(st, await makeExporter(fromDisk));
  await s.exportTo(picked);
  assert.equal(s.getState().messageKind, 'ok', s.getState().message); assert.match(s.getState().message, GONE); assert.equal(s.getState().exportRefusal, null); assert.deepEqual(st.removed, [picked]); assert.deepEqual(st.writes.map((w) => w.dir), [tracks]); assert.ok(!fs.existsSync(picked));
  const tracks2 = acTreeCore('T180 TUBE V2'), picked2 = path.join(tracks2, 'T180 TUBE V2'), st2 = memStorage(); st2.writeExport = async () => { throw new Error('disk full'); };
  const s2 = await closedLap(st2, await makeExporter(fromDisk)); await assert.rejects(() => s2.exportTo(picked2), /disk full/);
  assert.deepEqual(st2.removed, [picked2], 'the failure was unplanned and the empty folder still went'); assert.ok(!fs.existsSync(picked2));
});

// ── D243a: the Test export (unfinished) through the SHELL, which is what the page's button calls (exportTo(dir, { test: true })), with the real exporter ──
test('D243a the TEST export of an OPEN lap goes through the shell and the exporter: written open as a test folder, its reds listed, the loop not refused', async () => {
  const st = memStorage(), s = await lap({ storage: st, exporter: await makeExporter(fromDisk) });   // not closed
  assert.equal(s.getState().history.present.closed, false, 'control: the lap is open');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-core-testexport-')); made.push(dir);
  await s.exportTo(dir, { test: true });
  assert.equal(s.getState().messageKind, 'ok', s.getState().message);
  assert.equal(st.writes.length, 1, 'one folder'); assert.match(st.writes[0].folder, /^t180b_.+_test$/, 'named as a test, never a real export\'s folder');
  const folder = path.join(dir, st.writes[0].folder);
  assert.ok(fs.existsSync(path.join(folder, 't180b_TEST_UNFINISHED.txt')), 'the folder says it is unfinished');
  assert.ok(fs.existsSync(path.join(folder, 'ai', 'fast_lane.ai')));
  await s.exportTo(dir); assert.match(s.getState().message, /the loop is not closed: close it first/, 'control: a normal export of the same lap still refuses');
});

test('D243a the TEST export of a CLOSED lap is refused by name, and nothing is written (the lap would be built open with its end wall at the seam)', async () => {
  const st = memStorage(), s = await closedLap(st, await makeExporter(fromDisk));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-core-testexport-')); made.push(dir);
  await s.exportTo(dir, { test: true });
  assert.match(s.getState().message, /this track is closed: use Export/); assert.deepEqual(st.writes, [], 'nothing written');
  await s.exportTo(dir); assert.equal(s.getState().messageKind, 'ok', `control: a normal export of the closed lap goes through: ${s.getState().message}`);
});
