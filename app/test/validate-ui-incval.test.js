// Incremental validation (D177, the librarian's ruling 18:10): an edit revalidates only what it can change, over ONE
// shared path, and the result equals a full revalidate EXACTLY. Seeded property tests print their seed on failure.
// Run: node --test --test-concurrency=4 app/test/validate-ui-incval.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createShell } = require('../shell.js');
const { createTrackModel } = require('../preview/trackmodel.js');
const G = require('../../src/geom/index.js');
const P = require('../../src/geom/profile.js');
const { validate, revalidate, lapOf } = require('../../src/validate/index.js');
const D = require('../../src/doc/index.js');
const { MACH6 } = require('../../src/validate/limits.js');
const { colourMap, rangeLevel, rangeLevels, LEVEL } = require('../validate-ui/colour.js');
const { createValidationController, STEP } = require('../validate-ui/panel.js');
const { viewOf } = require('../validate-ui/pathview.js');

const mem = () => { const docs = new Map(); let lib = null; return { saveDoc: async (n, t) => docs.set(n, t), openDoc: async (n) => docs.get(n), listDocs: async () => [...docs.keys()], saveLibrary: async (t) => { lib = t; }, openLibrary: async () => lib }; };
/** mulberry32: the same seed, the same edits. */
const prng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
// CHANGED D256 BUILD: the reference is the controller's own default, FULL SPEED now (no slider), where it was the picker's 460 km/h
const OPTS = { csp: true, fullSpeed: true };
const WORDS = ['straight', 'sweep', 'turn', 'tight', 'tight', 'wall-ride', 'jump'];

/**
 * A shell with the preview's track model subscribed FIRST (as the window mounts it) and the controller after it. The
 * shared path is what C's seam replies ('t180:track-request': the model's own update result, { path, segments, … }).
 */
async function rig({ share }) {
  const shell = await createShell({ storage: mem(), autosaveMs: 0 });
  const model = createTrackModel();
  let last = null;
  shell.subscribe((st) => { try { last = model.update(st.resolved); } catch (e) { last = null; } });
  const ctl = createValidationController(shell, share ? { sharedPath: () => last } : {});
  return { shell, model, ctl };
}
/**
 * The reference: a FULL validate of the path the controller validated, with the lap as the controller asks. "Exactly" is
 * about VALIDATION: the incremental result equals a full validate of the same stations, bit for bit. Whether a path grown
 * or re-placed in place equals a fresh buildPath is the geometry's claim (C's rigid re-placement, src/geom/path.js, holds
 * it to RIGID_TOL 1e-12, not to the bit), so the path is taken as it is, and checked against a fresh build for its
 * stations' count, segments and positions (samePath).
 */
function reference(shell, ctl) {
  const st = shell.getState(), r = st.resolved, p = ctl.state.path;
  return { p, result: validate(p, r.segments, { ...OPTS, lap: !(st.history && st.history.dragBase) }) };
}
/** The controller's path is the document's: the same stations as a fresh 2 m build, within the geometry's tolerance. */
function samePath(shell, p, at) {
  const r = shell.getState().resolved, f = G.buildPath(r.segments, { step: STEP, closed: !!r.closed });
  assert.strictEqual(p.samples.length, f.samples.length, `${at}: station count`);
  for (let i = 0; i < f.samples.length; i++) {
    const a = p.samples[i], b = f.samples[i];
    const d = Math.max(Math.abs(a.s - b.s), ...[0, 1, 2].map((k) => Math.abs(a.pos[k] - b.pos[k])));
    if (!(a.seg === b.seg && d < 1e-6)) assert.fail(`${at}: station ${i} is not the document's (seg ${a.seg}/${b.seg}, off by ${d} m)`);
  }
}

const levelsOf = (map) => map.stations.map((e) => Array.from(e.levels));
/**
 * The controller's state against a full validate of the same path (D179 drag window included):
 *   · no pending stretch: the result equals a full validate exactly, and so do the colours;
 *   · a pending stretch (a drag is open): the result equals a full validate BOUNDED at the same point exactly; every
 *     station before it has the colour an UNBOUNDED full validate gives it (nothing stale), and every station from it on
 *     is PENDING (never shown clean).
 */
function checkState(shell, ctl, at) {
  assert.strictEqual(ctl.state.error, null, `${at}: ${ctl.state.error}`);
  samePath(shell, ctl.state.path, at);
  const ref = reference(shell, ctl), res = ctl.state.result, pend = res.pendingFrom;
  if (pend == null) {
    assert.deepStrictEqual(res, ref.result, `${at}: the incremental result differs from a full validate`);
    assert.deepStrictEqual(levelsOf(ctl.state.map), levelsOf(colourMap(ref.result, { path: ref.p })), `${at}: the colours differ`);
    return 'full';
  }
  assert.ok(shell.getState().history.dragBase, `${at}: a pending stretch without an open drag`);
  // the contract: a windowed result reports nothing at or past pendingFrom (those stations are PENDING, not judged)
  for (const x of [...res.red, ...res.amber, ...res.info]) assert.ok(x.s0 < pend - 1e-9, `${at}: a ${x.reason} finding at s ${x.s0}, inside the pending stretch from ${pend}`);
  const r = shell.getState().resolved;
  assert.deepStrictEqual(res, validate(ref.p, r.segments, { ...OPTS, lap: false, uptoS: pend }), `${at}: the windowed result differs from a full validate bounded at the same window`);
  const truth = levelsOf(colourMap(ref.result, { path: ref.p })), shown = levelsOf(ctl.state.map);
  ref.p.samples.forEach((smp, k) => {
    if (smp.s < pend - 1e-9) assert.deepStrictEqual(shown[k], truth[k], `${at}: station ${k} (s ${smp.s}) before the window's end is not what a full validate says`);
    else assert.deepStrictEqual(shown[k], [LEVEL.PENDING], `${at}: station ${k} (s ${smp.s}) past the window is not shown PENDING`);
  });
  return 'windowed';
}

/** One random edit, the way a user makes them. Returns what it did, for the failure message. */
function edit(shell, rnd) {
  const doc = shell.getState().history.present, n = doc.words.length, x = rnd();
  const pick = () => doc.words[Math.floor(rnd() * n)];
  if (n < 3 || x < 0.4) { const w = WORDS[Math.floor(rnd() * WORDS.length)]; shell.setPicker('dir', rnd() < 0.75 ? 'L' : 'R'); shell.place(w); return `place ${w}`; }
  if (x < 0.65) {
    const w = pick(); if (!w.handles || w.handles.length == null) return 'drag (no length handle)';
    shell.beginDrag(); const steps = 1 + Math.floor(rnd() * 3), d = (rnd() - 0.5) * 20;
    for (let k = 1; k <= steps; k++) shell.dragTo(w.id, { handles: { length: Math.max(5, w.handles.length + d * k / steps) } });
    if (rnd() < 0.8) shell.endDrag(); else return `drag ${w.id} (left OPEN)`;
    return `drag ${w.id} by ${d.toFixed(2)} m`;
  }
  if (x < 0.75) { const w = pick(); if (!w.handles || w.handles.length == null) return 'sculpt (no length handle)'; shell.sculpt(w.id, { handles: { length: Math.max(5, w.handles.length * (0.7 + rnd() * 0.6)) } }); return `sculpt ${w.id}`; }
  if (x < 0.85) { shell.removeHead(); return 'remove head'; }
  if (x < 0.95) { shell.undo(); return 'undo'; }
  shell.redo(); return 'redo';
}
const closeDrag = (shell) => { if (shell.getState().history.dragBase) shell.endDrag(); };

for (const share of [true, false]) {
  test(`property (${share ? 'the preview\'s SHARED path' : 'the controller\'s own path'}): after every random edit the result equals a full validate exactly`, async () => {
    for (const seed of [11, 12, 13, 14]) {
      const { shell, ctl } = await rig({ share }), rnd = prng(seed);
      const hows = new Set(), from = new Set();
      for (let k = 0; k < 22; k++) {
        const did = edit(shell, rnd);
        const st = shell.getState();
        if (!st.resolved || !st.resolved.segments.length) { closeDrag(shell); continue; }
        const at = `seed ${seed}, edit ${k} (${did})`;
        checkState(shell, ctl, at);
        hows.add(ctl.state.how); from.add(ctl.state.pathFrom);
        if (shell.getState().history.dragBase) { closeDrag(shell); checkState(shell, ctl, `${at}, after the drag ended`); }
      }
      assert.ok(hows.has('append') && hows.has('sculpt'), `seed ${seed}: the edits exercised ${[...hows]}`);
      assert.deepStrictEqual([...from], [share ? 'shared' : 'own'], `seed ${seed}: the path came from ${[...from]}`);
    }
  });
}

test('the property test reaches STACKED road: the edits lay road over road, and it still equals a full validate', async () => {
  // tight left turns only, so the track winds back over itself
  const { shell, ctl } = await rig({ share: true });
  shell.setPicker('dir', 'L');
  let stacked = 0;
  for (let k = 0; k < 16; k++) { shell.place(k % 4 === 3 ? 'straight' : 'tight'); stacked = Math.max(stacked, ctl.state.result._raw.stacked.size); assert.deepStrictEqual(ctl.state.result, reference(shell, ctl).result, `tight loop, word ${k}`); }
  assert.ok(stacked > 0, 'no stacked station was ever found: the test did not reach the stacking check');
});

test('a STALE shared path (built for another document) is not used: the controller grows its own, and stays exact', async () => {
  // the preview is one edit behind: it answers with the path and document of the edit before
  const shell = await createShell({ storage: mem(), autosaveMs: 0 }), model = createTrackModel();
  let built = null, lagging = null;
  shell.subscribe((st) => { if (built) lagging = { path: model.path, resolved: built }; model.update(st.resolved); built = st.resolved; });
  const ctl = createValidationController(shell, { sharedPath: () => lagging });
  for (const w of ['straight', 'turn', 'straight', 'tight']) shell.place(w);
  assert.strictEqual(ctl.state.pathFrom, 'own');
  samePath(shell, ctl.state.path, 'stale preview');
  assert.deepStrictEqual(ctl.state.result, reference(shell, ctl).result);
});
test('a shared path the preview REBUILT (a new object) is viewed afresh, never spliced onto the old view', async () => {
  const shell = await createShell({ storage: mem(), autosaveMs: 0 });
  let model = createTrackModel(), built = null;
  shell.subscribe((st) => { model.update(st.resolved); built = st.resolved; });
  const ctl = createValidationController(shell, { sharedPath: () => ({ path: model.path, resolved: built }) });
  for (const w of ['straight', 'turn', 'straight']) shell.place(w);
  // the preview starts over with a new model (as after its own full rebuild); the next edit must not reuse the old view
  model = createTrackModel(); model.update(shell.getState().resolved);
  shell.place('sweep');
  assert.deepStrictEqual([ctl.state.pathFrom, ctl.state.how], ['shared', 'full']);
  samePath(shell, ctl.state.path, 'a rebuilt preview path');
  assert.deepStrictEqual(ctl.state.result, reference(shell, ctl).result);
});

// ── the drag window (D179): the dragged word and the next are live, the rest is pending until the drag ends ──
test('a drag held OPEN on a mid-track word: every tick is windowed and exact where settled, and ending it equals a full validate', async () => {
  for (const seed of [21, 22, 23]) {
    const { shell, ctl } = await rig({ share: true }), rnd = prng(seed);
    for (let k = 0; k < 14; k++) { shell.setPicker('dir', rnd() < 0.6 ? 'L' : 'R'); shell.place(WORDS[Math.floor(rnd() * WORDS.length)]); }
    const ws = shell.getState().history.present.words, w = ws.find((x, i) => i >= 2 && i < ws.length - 3 && x.handles && x.handles.length != null);
    shell.beginDrag();
    let windowed = 0;
    for (let t = 1; t <= 4; t++) {
      shell.dragTo(w.id, { handles: { length: Math.max(5, w.handles.length + (rnd() - 0.4) * 8 * t) } });
      if (checkState(shell, ctl, `seed ${seed}, drag ${w.id} tick ${t}`) === 'windowed') windowed++;
    }
    shell.endDrag();
    assert.strictEqual(checkState(shell, ctl, `seed ${seed}, the drag of ${w.id} ended`), 'full');
    assert.strictEqual(ctl.state.how, 'drag-end');
    assert.ok(windowed >= 3, `seed ${seed}: only ${windowed} of 4 ticks were windowed`);
  }
});
test('never a stale "clean": a settled station stacked on road that the drag moved shows RED during the drag, and the moved road shows PENDING', async () => {
  // the tight left spiral stacks on itself; dragging an early word swings the whole tail over the road before it
  const { shell, ctl } = await rig({ share: true });
  shell.setPicker('dir', 'L');
  for (let k = 0; k < 16; k++) shell.place(k % 4 === 3 ? 'straight' : 'tight');
  const w = shell.getState().history.present.words[1];
  shell.beginDrag(); shell.dragTo(w.id, { handles: { length: w.handles.length * 1.3 } });
  assert.strictEqual(checkState(shell, ctl, 'the spiral, w2 dragged'), 'windowed');
  const S = ctl.state.path.samples, pend = ctl.state.result.pendingFrom, end = S.findIndex((p) => p.s >= pend - 1e-9);
  const onMoved = [...ctl.state.result._raw.stacked.values()].filter((e) => e.i < end && e.p >= end);
  assert.ok(onMoved.length > 0, 'a settled station is stacked on a partner in the pending stretch: that pair was measured, not deferred');
  for (const e of onMoved) assert.strictEqual(Array.from(ctl.state.map.stations[e.i].levels).every((v) => v === LEVEL.RED), true, `station ${e.i} (s ${e.s}) shows red`);
  shell.endDrag();
  assert.strictEqual(checkState(shell, ctl, 'the spiral, drag ended'), 'full');
});
test('a windowed result revalidated from BEYOND its pending start still finishes the whole track exactly', () => {
  // revalidate never carries past a windowed prev's pendingFrom, whatever fromS it is given
  let d = D.createDoc('w'); for (const w of ['straight', 'turn', 'straight', 'sweep', 'straight', 'turn', 'straight', 'tight']) d = D.appendWord(d, w);
  const segs = D.resolve(d).segments, p = G.buildPath(segs, { step: STEP }), mid = p.samples[Math.floor(p.samples.length / 3)].s, late = p.samples[Math.floor(p.samples.length * 0.8)].s;
  const windowed = validate(p, segs, { ...OPTS, uptoS: mid });
  assert.ok(windowed.pendingFrom != null && windowed.pendingFrom < late);
  assert.deepStrictEqual(revalidate(windowed, p, segs, late, OPTS), validate(p, segs, OPTS));
});
test('the panel says what is pending: the load graph shades it to the track end, the summary counts no deferred jump as waiting', async () => {
  const { graphModel } = require('../validate-ui/graph.js'), { summary } = require('../validate-ui/panel.js');
  const { shell, ctl } = await rig({ share: true });
  for (const w of ['straight', 'turn', 'straight', 'jump', 'straight', 'sweep', 'straight', 'turn']) shell.place(w);
  const w = shell.getState().history.present.words[1];
  shell.beginDrag(); shell.dragTo(w.id, { handles: { length: w.handles.length + 2 } });
  const st = ctl.state, pend = st.result.pendingFrom;
  assert.ok(pend != null);
  const band = graphModel(st).bands.find((b) => b.level === LEVEL.PENDING);
  assert.deepStrictEqual([band.s0, band.s1], [pend, st.path.lengthM]);
  const s = summary(st);
  assert.strictEqual(s.pendingFrom, pend);
  assert.ok(st.result.jumps.some((j) => j.deferred), 'the jump past the window is deferred');
  assert.strictEqual(s.jumpsPending, 0, 'a deferred jump is not "waiting for its landing"');
  shell.endDrag();
  assert.strictEqual(summary(ctl.state).pendingFrom, null);
});
test('the window ends at the second word after the dragged one; none when that is past the end', async () => {
  const { windowEnd } = require('../validate-ui/panel.js');
  const segs = ['a', 'a', 'b', 'c', 'c', 'd'].map((id) => ({ id }));
  const path = { samples: segs.map((g, k) => ({ s: k * 10, seg: k })), lengthM: 60 };
  assert.strictEqual(windowEnd(path, segs, 0), 30, 'a, then b, checked; c on is pending');
  assert.strictEqual(windowEnd(path, segs, 3), null, 'c, then d: nothing after, so nothing pending');
});

// ── the path view ──
/** A station's values (the fields validation reads, and the frame's private ones), without the path's bookkeeping. */
const values = (samples) => samples.map((p) => ({ s: p.s, seg: p.seg, pos: p.pos, T: p.T, L: p.L, U: p.U, kvec: p.kvec, roll: p.roll, bankG: p.bankG, grade: p.grade, _x: p._x, _R: p._R }));
test('the preview\'s 0.5 m path viewed at 2 m IS buildPath at 2 m, value for value; grown in place, the view follows it exactly', async () => {
  const shell = await createShell({ storage: mem(), autosaveMs: 0 }), rnd = prng(7);
  for (let k = 0; k < 12; k++) { shell.setPicker('dir', rnd() < 0.5 ? 'L' : 'R'); shell.place(WORDS[Math.floor(rnd() * WORDS.length)]); }
  const segs = shell.getState().resolved.segments;
  const fine = G.buildPath(segs, { step: 0.5 }), v = viewOf(fine, 2);
  assert.deepStrictEqual(values(v.samples), values(G.buildPath(segs, { step: 2 }).samples));
  // grown in place, the way the preview grows it: extend by one segment, then sculpt from segment 3. The view carried
  // from before must be the view built fresh from the grown path (what the geometry grew is the geometry's to prove)
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const grow = G.buildPath(segs.slice(0, -1), { step: 0.5 }); let view = viewOf(grow, 2);
  G.extendPath(grow, segs); view = viewOf(grow, 2, view, segs.length - 1);
  assert.ok(same(view.samples, viewOf(grow, 2).samples), 'after an append: the same station objects as a fresh view');
  assert.deepStrictEqual(values(view.samples), values(G.buildPath(segs, { step: 2 }).samples), 'an append grows what a full build grows');
  const edited = segs.map((g, j) => (j === 3 ? { ...g, length: g.length + 1.5 } : g));
  G.rebuildPathFrom(grow, edited, 3); view = viewOf(grow, 2, view, 3);
  assert.ok(same(view.samples, viewOf(grow, 2).samples), 'after a sculpt: the same station objects as a fresh view');
});
test('a path that cannot be viewed exactly is refused (null), so the controller grows its own', () => {
  const segs = [{ id: 'a', kind: 'road', word: 'straight', length: 40, k0: 0, k1: 0, profile: { u: [-5, 5] } }];
  assert.strictEqual(viewOf(G.buildPath(segs, { step: 0.75 }), 2), null, '0.75 does not divide 2');
  // 0.03 / 0.01 is exactly 3, but 33 × 0.01 = 0.33 while 11 × 0.03 = 0.32999999999999996: not the same station
  assert.strictEqual(viewOf(G.buildPath(segs, { step: 0.01 }), 0.03), null, 'the steps divide, the stations do not agree');
  assert.strictEqual(viewOf(null, 2), null);
  assert.strictEqual(viewOf({ samples: [], step: 0.5 }, 2), null, 'no segFirst');
});

// ── the stacking check, against the point-by-point algorithm it replaced ──
/** HEAD's stacked() before D177, kept here as the reference: every surface point in a 2 m grid, every pair measured. */
function referenceStacked(path, segments, car = MACH6, sep = 25) {
  const S = path.samples, cell = car.stackedM, L = path.lengthM, out = new Map(), grid = new Map(), pts = [];
  const isRoad = (i) => segments[S[i].seg].kind !== 'gap', key = (a, b, c) => `${a},${b},${c}`;
  for (let i = 0; i < S.length; i++) {
    if (!isRoad(i)) continue;
    const prof = P.normalize(segments[S[i].seg].profile), us = [];
    for (let k = 0; k < prof.u.length; k++) { us.push(prof.u[k]); if (k + 1 < prof.u.length) { const m = Math.ceil(prof.u[k + 1] - prof.u[k]); for (let j = 1; j < m; j++) us.push(prof.u[k] + (prof.u[k + 1] - prof.u[k]) * j / m); } }
    for (const u of us) {
      const [X, Y] = P.offsetAt(prof, u), q = [0, 1, 2].map((d) => S[i].pos[d] + (S[i].L[d] * X + S[i].U[d] * Y));
      const pt = { q, s: S[i].s, u, i }; pts.push(pt);
      const k = key(...q.map((x) => Math.floor(x / cell))); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(pt);
    }
  }
  const mark = (pt, worst) => { const e = out.get(pt.i); if (!e || worst > e.worst || (worst === e.worst && pt.u < e.u)) out.set(pt.i, { s: pt.s, u: pt.u, worst }); };
  for (const pt of pts) {
    const c = pt.q.map((x) => Math.floor(x / cell));
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) for (const o of grid.get(key(c[0] + a, c[1] + b, c[2] + d)) || []) {
      let ds = Math.abs(o.s - pt.s); if (path.closed) ds = Math.min(ds, L - ds);
      const dist = Math.hypot(o.q[0] - pt.q[0], o.q[1] - pt.q[1], o.q[2] - pt.q[2]);
      if (ds < sep || dist >= cell) continue;
      mark(pt, cell - dist); mark(o, cell - dist);
    }
  }
  return out;
}
test('the station-pair stacking check finds exactly what measuring every surface point finds, on tracks that stack', async () => {
  let total = 0;
  for (const seed of [1, 2, 3]) {
    const shell = await createShell({ storage: mem(), autosaveMs: 0 }), rnd = prng(seed);
    for (let k = 0; k < 30; k++) { shell.setPicker('dir', rnd() < 0.8 ? 'L' : 'R'); shell.place(['tight', 'tight', 'turn', 'straight', 'sweep', 'wall-ride'][Math.floor(rnd() * 6)]); }
    const segs = shell.getState().resolved.segments, p = G.buildPath(segs, { step: STEP });
    const got = new Map([...validate(p, segs, OPTS)._raw.stacked].map(([i, e]) => [i, { s: e.s, u: e.u, worst: e.worst }]));
    const want = referenceStacked(p, segs);
    assert.deepStrictEqual(got, want, `seed ${seed}`);
    total += want.size;
  }
  assert.ok(total > 20, `the tracks stacked at ${total} stations: enough to test`);
});

test('the stacking check on a CLOSED loop: the start and end are one pass (s wraps), exactly as measuring every point', async () => {
  const shell = await createShell({ storage: mem(), autosaveMs: 0 });
  for (const w of ['straight', 'straight', 'turn', 'straight', 'turn']) shell.place(w);
  shell.beginDrag(); shell.dragTo('w1', { handles: { length: 120 } }); shell.endDrag(); shell.closeLoop();
  const r = shell.getState().resolved, p = G.buildPath(r.segments, { step: STEP, closed: true });
  assert.strictEqual(p.closed, true);
  const got = new Map([...validate(p, r.segments, OPTS)._raw.stacked].map(([i, e]) => [i, { s: e.s, u: e.u, worst: e.worst }]));
  assert.deepStrictEqual(got, referenceStacked(p, r.segments));
});

// ── the loads the per-segment constants give (pinned by physics, not by the code they replaced) ──
test('on a level straight at a constant speed only gravity acts: each line reads fN = cos ψ and fLat = sign(u)·sin ψ', async () => {
  // the bowl's walls differ (60° on the left, 15° on the right), so a sign lost on one side cannot hide in a symmetry
  const shell = await createShell({ storage: mem(), autosaveMs: 0 });
  shell.setPicker('font', 'bowl'); shell.place('straight');
  const segs = shell.getState().resolved.segments, p = G.buildPath(segs, { step: STEP }), prof = P.normalize(segs[0].profile);
  const r = validate(p, segs, { designSpeed: 100 }), mid = r.lines.filter((l) => l.s === p.samples[5].s);
  assert.ok(mid.some((l) => l.u < 0 && Math.abs(P.psiAt(prof, l.u)) > 0.1) && mid.some((l) => l.u > 0 && Math.abs(P.psiAt(prof, l.u)) > 0.1), 'walls on both sides');
  for (const l of mid) {
    const psi = P.psiAt(prof, l.u), sg = Math.sign(l.u);
    assert.ok(Math.abs(l.fN_g - Math.cos(psi)) < 1e-9, `u ${l.u}: fN ${l.fN_g}, cos ψ ${Math.cos(psi)}`);
    assert.ok(Math.abs(l.fLat_g - sg * Math.sin(psi)) < 1e-9, `u ${l.u}: fLat ${l.fLat_g}, sign(u)·sin ψ ${sg * Math.sin(psi)}`);
  }
});

// ── the lap, never on a drag tick ──
test('a closed loop: every drag tick defers the lap, and ending the drag proves it, equal to a full validate\'s lap', async () => {
  const { shell, ctl } = await rig({ share: true });
  for (const w of ['straight', 'straight', 'turn', 'straight', 'turn']) shell.place(w);
  shell.beginDrag(); shell.dragTo('w1', { handles: { length: 120 } }); shell.endDrag();
  shell.closeLoop();
  assert.strictEqual(shell.getState().history.present.closed, true, shell.getState().message);
  const proven = ctl.state.result.lap;
  assert.notStrictEqual(proven.reason, 'deferred');
  // a SPEED drag: it keeps the loop closed (a length drag opens it by the change, which A's document does not re-close:
  // routed in the D177 hand-back) and changes every load and the lap time, so the proof after it is not the old one
  const first = shell.getState().history.present.words[1], before = shell.getState().resolved;
  shell.beginDrag(); shell.dragTo(first.id, { speed: 90 });
  assert.notStrictEqual(shell.getState().resolved, before, 'the drag changed the document');
  if (shell.getState().resolved && shell.getState().resolved.closed) {
    assert.deepStrictEqual(ctl.state.result.lap, { ok: null, reason: 'deferred' }, 'a drag tick does not prove the lap');
    shell.endDrag();
    assert.deepStrictEqual(ctl.state.result.lap, reference(shell, ctl).result.lap, 'the drag\'s end proves it');
  } else { shell.endDrag(); assert.fail('the dragged loop did not stay closed; pick another handle'); }
});
test('lapOf proves a deferred lap exactly as an undeferred validate does, and returns any other lap unchanged', async () => {
  const shell = await createShell({ storage: mem(), autosaveMs: 0 });
  for (const w of ['straight', 'straight', 'turn', 'straight', 'turn']) shell.place(w);
  shell.beginDrag(); shell.dragTo('w1', { handles: { length: 120 } }); shell.endDrag(); shell.closeLoop();
  const r = shell.getState().resolved, p = G.buildPath(r.segments, { step: STEP, closed: true });
  const deferred = validate(p, r.segments, { ...OPTS, lap: false }), full = validate(p, r.segments, OPTS);
  assert.strictEqual(deferred.lap.reason, 'deferred');
  assert.deepStrictEqual(lapOf(p, r.segments, deferred), full.lap);
  assert.strictEqual(lapOf(p, r.segments, full), full.lap);
});

// ── the colours: every station's range level at once ──
test('rangeLevels gives every station the level rangeLevel gives it, ranges touching, nested and out of order', () => {
  const rnd = prng(3), ss = Array.from({ length: 400 }, (_, k) => k * 0.5), mk = () => { const a = rnd() * 200, b = a + rnd() * 20; return { s0: a, s1: b }; };
  for (let t = 0; t < 20; t++) {
    const result = { red: Array.from({ length: Math.floor(rnd() * 6) }, mk), amber: Array.from({ length: Math.floor(rnd() * 8) }, mk) };
    result.red.push({ s0: 10, s1: 10 }); result.amber.push({ s0: 12.5 + 1e-10, s1: 12.5 - 1e-10 });
    assert.deepStrictEqual(Array.from(rangeLevels(result, ss)), ss.map((s) => rangeLevel(result, s)), `trial ${t}`);
  }
  // a station EXACTLY on a range's closed end (s1 + 1e-9, the tolerance rangeLevel allows) is inside it
  const edge = [0.5, 1, 1 + 1e-9, 1.5], one = { red: [{ s0: 0.5, s1: 1 }], amber: [] };
  assert.deepStrictEqual(Array.from(rangeLevels(one, edge)), edge.map((s) => rangeLevel(one, s)));
  const unsorted = [5, 1, 3];
  assert.deepStrictEqual(Array.from(rangeLevels({ red: [{ s0: 0, s1: 2 }], amber: [] }, unsorted)), unsorted.map((s) => rangeLevel({ red: [{ s0: 0, s1: 2 }], amber: [] }, s)));
});
