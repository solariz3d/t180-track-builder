// sky-budget.test.js: node --test app/test/sky-budget.test.js
// D495: the sky's GPU budget and its fallback, and the aurora's colour cycle, in node: the renderer is driven with a recording WebGL stand-in (as
// sky.test.js) given a fake EXT_disjoint_timer_query_webgl2 whose readings the test chooses, so what the renderer does with them can be pinned
// without a GPU (the real GPU's readings are sky-gpu.test.js's). Rows:
//   1  the meter: no verdict during the warm-up or before its samples are in; then one verdict, the 95th percentile against the budget (equal fits);
//      later readings change nothing; a reading or an option that is not a number throws
//   2  over budget, the renderer draws the aurora's flat fallback from then on (compiled once, the near curtain no longer a volume) and says so once
//   3  within budget it keeps the volume sky, compiles nothing more and stops timing
//   4  a disjoint reading is dropped (it is not counted), and a reading not ready yet is waited for
//   5  without the timer query nothing is timed and the sky is drawn as it is (skyState says why); a style with no fallback is never timed
//   6  the cycle: at t = 0 the pass gets the skin's own colours (so reduced motion holds them); later --sky-b's strength drifts, --sky-a's green and
//      --sky-c (the fog) never change; a style without the cycle keeps the skin's colours at every t
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ADIR = process.env.APP_DIR || path.join(__dirname, '..');
const R = require(path.join(ADIR, 'preview', 'renderer.js'));
const SKY = require(path.join(ADIR, 'preview', 'sky', 'index.js'));
const BUDGET = require(path.join(ADIR, 'preview', 'sky', 'budget.js'));

/** a recording WebGL stand-in (sky-fixture.js's, widened): `timer` false leaves the extension out; reading(i) gives the i-th query's ms (or
 *  { ms, disjoint, ready }) */
function fakeGL({ timer = true, reading = () => 1 } = {}) {
  const calls = [], programs = []; let id = 0; const q = new Map(); let disjointNext = false;
  const ext = { TIME_ELAPSED_EXT: 'TIME_ELAPSED_EXT', GPU_DISJOINT_EXT: 'GPU_DISJOINT_EXT' };
  const answers = {
    createShader: () => ({ id: ++id }), createProgram: () => { const p = { id: ++id }; programs.push(p); return p; }, createBuffer: () => ({ id: ++id }), createTexture: () => ({ id: ++id }),
    getShaderParameter: () => true, getProgramParameter: () => true, getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    getUniformLocation: (p, n) => n, getAttribLocation: (p, n) => ({ aPos: 0, aNrm: 1, aUv: 2, aTan: 3 }[n] ?? -1),
    getExtension: (n) => (timer && n === 'EXT_disjoint_timer_query_webgl2' ? ext : null),
    createQuery: () => { const o = { id: ++id, n: q.size }; const r = reading(o.n); q.set(o, typeof r === 'number' ? { ms: r, ready: true, disjoint: false } : { ready: true, disjoint: false, ...r }); return o; },
    getQueryParameter: (o, k) => { const r = q.get(o); if (k === 'QUERY_RESULT_AVAILABLE') { if (r.ready) disjointNext = r.disjoint; return r.ready; } if (k === 'QUERY_RESULT') return Math.round(r.ms * 1e6); throw new Error(k); },
    getParameter: (k) => (k === 'GPU_DISJOINT_EXT' ? disjointNext : undefined),
  };
  const gl = new Proxy({}, { get(t, k) {
    if (typeof k !== 'string') return undefined;
    if (/^[A-Z_0-9]+$/.test(k)) return k;
    return (...args) => { calls.push([k, ...args]); return answers[k] ? answers[k](...args) : undefined; };
  } });
  return { gl, calls, queries: q, programs };
}
const AURORA = { sky: [0.03, 0.035, 0.11], fog: [0.07, 0.08, 0.2], skyStyle: 'aurora', skyA: [0.31, 1, 0.69], skyB: [0.67, 0.43, 1], skyC: [0.07, 0.08, 0.2] };
const POSE = { eye: [0, 2, 0], target: [0, 8, -10], up: [0, 1, 0], fov: Math.PI / 3 };
const frames = (r, n, t = 0) => { for (let i = 0; i < n; i++) r.draw([], POSE, { width: 640, height: 360 }, { look: 'words', time: t }); };
const fragSources = (calls) => calls.filter((c) => c[0] === 'shaderSource' && /skyPattern/.test(c[2])).map((c) => c[2]);
const quiet = (f) => { const w = console.warn, said = []; console.warn = (m) => said.push(m); try { f(); } finally { console.warn = w; } return said; };

test('row 1: the meter waits out its warm-up and its samples, then gives one verdict: the p95 against the budget', () => {
  const m = BUDGET.createSkyMeter({ budgetMs: 1.5, warm: 3, samples: 20 });
  for (let i = 0; i < 3; i++) assert.equal(m.add(99), null, 'a warm-up frame, however slow, is not counted');
  for (let i = 0; i < 19; i++) assert.equal(m.add(i < 18 ? 1.0 : 2.0), null, 'no verdict before 20 samples');
  const v = m.add(2.0);   // 18 of 1.0 and 2 of 2.0: the p95 (nearest rank of 20) is 2.0
  assert.deepEqual(v, { over: true, p95: 2.0, budgetMs: 1.5, samples: 20 });
  assert.equal(m.add(0.1), v, 'later readings change nothing'); assert.equal(m.verdict, v);
  const e = BUDGET.createSkyMeter({ budgetMs: 1.5, warm: 0, samples: 4 }); [1.5, 1.5, 1.5].forEach((x) => e.add(x));
  assert.equal(e.add(1.5).over, false, 'a p95 equal to the budget fits');
  assert.throws(() => BUDGET.createSkyMeter().add(NaN), /number of ms/);
  assert.throws(() => BUDGET.createSkyMeter().add(-1), /number of ms/);
  assert.throws(() => BUDGET.createSkyMeter({ budgetMs: 0 }), /over 0/);
  assert.throws(() => BUDGET.createSkyMeter({ samples: 0 }), /over 0/);
  assert.throws(() => BUDGET.createSkyMeter({ warm: 1.5 }), /whole number/);
  assert.equal(BUDGET.BUDGET_MS, 1.5, 'the budget is the sky\'s share of the frame, D489 §7');
});

test('row 2: over budget, the aurora falls back to its flat form, compiled once, drawn from then on, said once', () => {
  const { gl, calls, programs } = fakeGL({ reading: () => 2.4 }), r = R.createRenderer(gl);
  r.setTheme(AURORA);
  assert.equal(r.skyState().measure, 'measuring');
  const before = fragSources(calls); assert.equal(before.length, 1); assert.match(before[0], /aurora_volume\(d, dq/, 'the aurora is drawn with its near curtain a volume');
  let said = quiet(() => frames(r, 119));
  assert.equal(r.skyState().measure, 'measuring', 'no verdict before 30 warm-up frames and 90 samples'); assert.deepEqual(said, []);
  said = quiet(() => frames(r, 1));
  const st = r.skyState(); assert.equal(st.measure, 'fell back'); assert.equal(st.p95, 2.4); assert.equal(st.budgetMs, 1.5);
  const after = fragSources(calls); assert.equal(after.length, 2, 'the fallback is compiled once');
  assert.doesNotMatch(after[1], /aurora_volume\(d, dq/, 'the fallback draws no volume');
  assert.ok(after[1].includes(SKY.fallbackSource('aurora')), 'the fallback is the module\'s fallback()');
  assert.equal(said.length, 1); assert.match(said[0], /aurora sky took 2\.40 ms .* over its 1\.5 ms budget; it is drawn in its flat form/);
  const at = calls.length; said = quiet(() => frames(r, 50));
  assert.deepEqual(said, [], 'said once'); assert.equal(fragSources(calls.slice(at)).length, 0, 'nothing more compiled');
  assert.equal(calls.slice(at).filter((c) => c[0] === 'createQuery').length, 0, 'timing stops');
  // and it is the fallback that is drawn: the program in use at each full-screen strip (the sky's draw) is the one compiled last, the flat one
  const flat = programs[programs.length - 1], late = calls.slice(at), skyUses = late.map((c, i) => (c[0] === 'drawArrays' && c[1] === 'TRIANGLE_STRIP' ? late.slice(0, i).reverse().find((d) => d[0] === 'useProgram') : null)).filter(Boolean);
  assert.ok(skyUses.length >= 50 && skyUses.every((c) => c[1] === flat), 'every frame after the verdict draws the sky with the flat program');
});

test('row 3: within budget the volume sky stays, nothing more is compiled, and timing stops', () => {
  const { gl, calls } = fakeGL({ reading: (i) => (i % 25 === 0 ? 3 : 1.2) }), r = R.createRenderer(gl);   // a slow frame in 25 (4%): the p95 is still 1.2
  r.setTheme(AURORA); frames(r, 120);
  assert.equal(r.skyState().measure, 'fits'); assert.equal(r.skyState().p95, 1.2);
  assert.equal(fragSources(calls).length, 1);
  const at = calls.length; frames(r, 20);
  assert.equal(calls.slice(at).filter((c) => c[0] === 'createQuery').length, 0);
  assert.ok(calls.slice(at).some((c) => c[0] === 'drawArrays'), 'the sky is still drawn');
});

test('row 4: a disjoint reading is dropped and a reading not ready yet is waited for', () => {
  const ready = new Set();
  const { gl } = fakeGL({ reading: (i) => (i < 60 ? { ms: 9, disjoint: true } : { ms: 1, ready: true }) }), r = R.createRenderer(gl);
  r.setTheme(AURORA); frames(r, 120);
  assert.equal(r.skyState().measure, 'measuring', 'the 60 disjoint readings (all 9 ms) are not counted');
  frames(r, 60); assert.equal(r.skyState().measure, 'fits'); assert.equal(r.skyState().p95, 1);
  const g2 = fakeGL({ reading: (i) => ({ ms: 5, ready: ready.has(i) }) }), r2 = R.createRenderer(g2.gl);
  r2.setTheme(AURORA); frames(r2, 200);
  assert.equal(r2.skyState().measure, 'measuring', 'nothing ready, nothing read');
  assert.ok(g2.calls.filter((c) => c[0] === 'createQuery').length <= 4, 'at most four queries in flight');
});

test('row 5: without the timer query nothing is timed and the sky is drawn as it is; a style with no fallback is never timed', () => {
  const { gl, calls } = fakeGL({ timer: false }), r = R.createRenderer(gl);
  r.setTheme(AURORA); frames(r, 200);
  assert.equal(r.skyState().measure, 'unmeasured: no GPU timer query here');
  assert.equal(calls.filter((c) => c[0] === 'createQuery').length, 0); assert.equal(fragSources(calls).length, 1);
  const g2 = fakeGL(), r2 = R.createRenderer(g2.gl);
  r2.setTheme({ ...AURORA, skyStyle: 'caustics' }); frames(r2, 200);
  assert.equal(r2.skyState().measure, 'none'); assert.equal(SKY.fallbackSource('caustics'), null);
  assert.equal(g2.calls.filter((c) => c[0] === 'createQuery').length, 0);
});

test('row 6: the cycle: the skin\'s own colours at t = 0, then --sky-b drifts while --sky-a and --sky-c (the fog) stay', () => {
  const sent = (style, t) => {
    const { gl, calls } = fakeGL({ timer: false }), r = R.createRenderer(gl); r.setTheme({ ...AURORA, skyStyle: style });
    const at = calls.length; frames(r, 1, t);
    const u = (n) => calls.slice(at).filter((c) => c[0] === 'uniform3f' && c[1] === n).map((c) => c.slice(2))[0];
    return { a: u('uSkyA'), b: u('uSkyB'), c: u('uSkyC') };
  };
  assert.equal(SKY.cycleOf('aurora'), 'a'); assert.equal(SKY.cycleOf('caustics'), 'none'); assert.equal(SKY.cycleOf('none'), 'none');
  assert.deepEqual(sent('aurora', 0), { a: AURORA.skyA, b: AURORA.skyB, c: AURORA.skyC }, 't = 0 (and so reduced motion): the skin\'s own colours');
  for (const t of [180, 360, 540, 1234.5]) {
    const s = sent('aurora', t);
    assert.deepEqual(s.a, AURORA.skyA, `t = ${t}: the hem's green stays`); assert.deepEqual(s.c, AURORA.skyC, `t = ${t}: --sky-c stays the fog`);
    assert.ok(s.b.every((v, i) => v <= AURORA.skyB[i] + 1e-12 && v >= 0), `t = ${t}: --sky-b only fades`);
  }
  assert.ok(sent('aurora', 360).b[2] < 0.5 * AURORA.skyB[2], 'at 6 minutes the red tops have faded to under half');
  assert.deepEqual(sent('caustics', 360), { a: AURORA.skyA, b: AURORA.skyB, c: AURORA.skyC }, 'a style without the cycle keeps the skin\'s colours');
});
