// validate_heap.test.js: node --test test/validate_heap.test.js   (each row runs the check in its own node process, about 15-40 s)
// The validator's heap: what the track checker keeps alive after a check, measured in a fresh process the way the check worker runs it
// (app/validate-ui/checkjob.js: the PATH-ONLY track model, then the validation controller, leanLines, CSP on). The figure is V8's used heap PLUS
// ArrayBuffer backing stores, after a full GC, above the model alone: a typed array over 64 bytes keeps its numbers outside the V8 heap, so a
// heap-only figure (or --max-old-space-size) would pass a cut that only moved memory out of sight.
// What held it: the module's per-segment memos, not the findings. The cup blends'
// constants (one object per u: ELYSIUM's 13,799 cross-sections kept 483 MB) and the stacked check's lateral points (an [X, Y] array per point: the
// 100 km stadium's 50,034 segments kept 205 MB) are now one Float64Array each (src/validate/index.js constOf, latOf). Rows:
//   1  the 100 km stadium (test/fixtures/stadium-100km.t180track, a synthetic lap: two straights and two R 1500 m bowl half circles, closed)
//      keeps under STADIUM_CEILING_MB above the model after its check
//   2  ELYSIUM (test/fixtures/elysium-2026-10-22.t180track), the user's cup track, keeps under ELYSIUM_CEILING_MB above the model after its check
// The findings themselves are unchanged by the cut; that proof is byte-for-byte over ELYSIUM, the nine F fixtures and the stadium (the hand-back §3).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path'), { spawnSync } = require('child_process');

const STADIUM_CEILING_MB = 380;   // measured (the hand-back §2): 476 MB before the cut, 295 after
const ELYSIUM_CEILING_MB = 700;   // 1,016 MB before, 506 after

/** The check worker's job on one document in a fresh node process; returns { aboveModelMB, red, amber, info } or throws with the child's stderr. */
function retained(fixture) {
  const repo = JSON.stringify(path.join(__dirname, '..')), doc = JSON.stringify(path.join(__dirname, 'fixtures', fixture));
  const code = `
const fs = require('fs'), path = require('path'), v8 = require('v8'), R = ${repo}, rq = (p) => require(path.join(R, p));
const D = rq('src/core/document.js'), AD = rq('src/core/adapter.js');
const { createTrackModel } = rq('app/preview/trackmodel.js'), { PATH_ONLY } = rq('app/validate-ui/checkjob.js'), { createValidationController } = rq('app/validate-ui/panel.js');
const live = () => { global.gc(); global.gc(); return v8.getHeapStatistics().used_heap_size + process.memoryUsage().arrayBuffers; };
const doc = D.parse(fs.readFileSync(${doc}, 'utf8'));
const segments = AD.toSegments(doc, { cache: new WeakMap() });
const resolved = Object.freeze({ segments, closed: !!doc.closed, start: { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch }, lift: (p) => AD.offsetPath(doc, segments, p) });
const track = createTrackModel({ geom: PATH_ONLY }).update(resolved);
const base = live();
const state = { resolved, resolveError: null, history: { dragBase: null } };
const ctl = createValidationController({ getState: () => state, subscribe() { return () => {}; } }, { csp: true, sharedPath: () => track, colours: false, validate: { leanLines: true } });
const r = ctl.state.result, held = live() - base;
process.stdout.write(JSON.stringify({ aboveModelMB: held / 1048576, red: r.red.length, amber: r.amber.length, info: r.info.length, lines: r.lines.length, keep: !!track }));`;
  const env = { ...process.env, NODE_OPTIONS: (process.env.NODE_OPTIONS || '').replace(/--max-old-space-size=\d+/g, '').trim() };
  const run = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=8192', '-e', code], { env, encoding: 'utf8', maxBuffer: 1 << 24 });
  assert.equal(run.status, 0, `the check did not finish: ${String(run.stderr).slice(0, 400)}`);
  return JSON.parse(run.stdout);
}

test('row 1: the 100 km stadium keeps under the ceiling above the model after its check', () => {
  const m = retained('stadium-100km.t180track');
  assert.ok(m.lines > 100000, `control: the check read the stadium's 50,035 stations (${m.lines} lines kept)`);
  assert.ok(m.aboveModelMB < STADIUM_CEILING_MB, `the check kept ${m.aboveModelMB.toFixed(1)} MB above the model, the ceiling is ${STADIUM_CEILING_MB} MB`);
});

test('row 2: ELYSIUM keeps under the ceiling above the model after its check', () => {
  const m = retained('elysium-2026-10-22.t180track');
  assert.ok(m.amber > 0, 'control: ELYSIUM\'s check reads its ambers');
  assert.ok(m.aboveModelMB < ELYSIUM_CEILING_MB, `the check kept ${m.aboveModelMB.toFixed(1)} MB above the model, the ceiling is ${ELYSIUM_CEILING_MB} MB`);
});
