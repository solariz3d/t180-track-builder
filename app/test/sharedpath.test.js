// Tests for the ONE SHARED PATH (D177, the librarian's ruling: "ONE shared path between the preview and validation"):
// app/preview/trackmodel.js keeps the track's path and reports what changed (how, g, fromS), app/preview/preview.js
// hands it on (onTrack; app/preview/index.js publishes it as 't180:track'), and validation reads that path instead of
// growing a second one. node --test, no dependencies.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const ADIR = process.env.APP_DIR || path.join(__dirname, '..'), SRC = path.join(ADIR, '..', 'src');
const { createTrackModel, STEP } = require(path.join(ADIR, 'preview', 'trackmodel.js'));
const { createPreview } = require(path.join(ADIR, 'preview', 'preview.js'));
const D = require(path.join(SRC, 'doc', 'index.js'));
const G = require(path.join(SRC, 'geom', 'index.js'));
const { validate } = require(path.join(SRC, 'validate', 'index.js'));
const { createLive } = require(path.join(ADIR, 'validate-ui', 'live.js'));
const { buildExport } = require(path.join(SRC, 'export', 'fromwords.js'));
const { closeLoop } = require(path.join(SRC, 'doc', 'connector.js'));

const doc = (words) => words.reduce((d, w) => D.appendWord(d, w, { speed: 30 }), D.createDoc('shared'));
const WORDS = ['straight', 'sweep', 'turn', 'straight', 'sweep', 'straight'];

test('shared path: the track model\'s path is at the export\'s step (the stations the kn5 is meshed from)', () => {
  let d = doc(['straight', 'straight', 'tight', 'straight', 'tight']); d = D.editWord(d, 'w3', { handles: { length: 50 } });
  const c = closeLoop(d), closed = c.candidates.slice().sort((a, b) => a.lengthM - b.lengthM)[0].doc;
  const tm = createTrackModel(), t = tm.update(D.resolve(doc(WORDS)));
  assert.deepStrictEqual([STEP, t.path.step], [buildExport(closed).path.step, buildExport(closed).path.step]);
});
test('shared path: an append reports how "extend", the first new segment, and the OLD end as fromS', () => {
  const tm = createTrackModel(), d = doc(WORDS), t0 = tm.update(D.resolve(d)), end0 = t0.path.lengthM, n0 = t0.segments.length;
  const t = tm.update(D.resolve(D.appendWord(d, 'turn', { speed: 30 })));
  assert.deepStrictEqual([t.how, t.g, t.fromS], ['extend', n0, end0]);
});
test('shared path: a sculpt reports how "sculpt", the edited word\'s first segment, and where it starts', () => {
  const tm = createTrackModel(), d = doc(WORDS); tm.update(D.resolve(d));
  const r2 = D.resolve(D.editWord(d, 'w4', { handles: { length: 90 } })), t = tm.update(r2), g = r2.segments.findIndex((x) => x.id === 'w4');
  assert.deepStrictEqual([t.how, t.g, t.fromS], ['sculpt', g, t.path.starts[g].s]);
});
test('shared path: validating the shared path gives what validation gets from its own path at the same step', () => {
  const tm = createTrackModel(), r = D.resolve(doc(WORDS)), t = tm.update(r);
  const own = G.buildPath(r.segments, { step: STEP });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(validate(t.path, r.segments))), JSON.parse(JSON.stringify(validate(own, r.segments))));
});
test('shared path: incremental validation from fromS on the re-placed path equals a full validation of it', () => {
  const tm = createTrackModel(), d = doc(WORDS), r = D.resolve(d), live = createLive();
  live.update(tm.update(r).path, r.segments);
  const r2 = D.resolve(D.editWord(d, 'w2', { handles: { length: 140 } })), t = tm.update(r2);
  const inc = live.update(t.path, r2.segments, { fromS: t.fromS });
  assert.deepStrictEqual([t.path.replaced > 0, inc.full, JSON.stringify(inc.result)], [true, false, JSON.stringify(validate(t.path, r2.segments))]);
});

function previewOn(onTrack) {
  const gl = new Proxy({ getShaderParameter: () => true, getProgramParameter: () => true, getUniformLocation: (p, n) => n, getAttribLocation: () => 0,
    createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), createTexture: () => ({}) }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  let st = { resolved: D.resolve(doc(WORDS)) }; const subs = new Set();
  const shell = { subscribe: (f) => { subs.add(f); return () => subs.delete(f); }, getState: () => st, set(r) { st = { resolved: r }; for (const f of subs) f(st); } };
  const win = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {} };
  const canvas = { clientWidth: 100, clientHeight: 100, width: 0, height: 0, getContext: () => gl, addEventListener() {}, removeEventListener() {} };
  return { p: createPreview({ canvas, shell, win, onTrack }), shell };
}
test('shared path: the preview hands on its OWN path object after every change that moved the track', () => {
  const got = [], { p, shell } = previewOn((t) => got.push(t));
  shell.set(D.resolve(D.appendWord(doc(WORDS), 'turn', { speed: 30 })));
  assert.deepStrictEqual([got.map((t) => t.how), got[1].path === p.view().track.path, p.track().path === got[1].path], [['full', 'extend'], true, true]);
});
test('shared path: a change that did not move the track is not handed on again', () => {
  const got = [], { shell } = previewOn((t) => got.push(t));
  shell.set(D.resolve(doc(WORDS)));
  assert.deepStrictEqual(got.map((t) => t.how), ['full']);
});
