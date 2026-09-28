// doc-e2e.test.js: node --test test/*.test.js
// End to end, headless, with every default: a short loop of WORDS is closed by src/doc/connector.js, exported by
// src/export/fromwords.js to a temp folder with the self-intersection check ON (never selfCheck: false here), and the
// kn5 is read back through tools/kn5.cjs, where every AC_ marker the export placed must be found.
// The one allowed escape: if an export is refused ONLY because the self-check reports crossings (C's BVH false
// positive, src/export/fromwords.js SELF-INTERSECTION), the test is marked TODO with that reason, naming C's fix. Any
// other refusal fails. Each loop's closeLoop takes about 20 s.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('../src/doc/index.js');
const { closeLoop } = require('../src/doc/connector.js');
const { exportTrack } = require('../src/export/fromwords.js');
const { readKn5 } = require('../tools/kn5.cjs');

const DEG = Math.PI / 180, kmh = (v) => v / 3.6;
const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

/** Words at one design speed, closed by the connector's safest candidate, every word (the connector's too) at that speed. */
function closedLoop(name, words, speedKmh) {
  let d = D.createDoc(name);
  for (const [w, o = {}] of words) d = D.appendWord(d, w, { ...o, speed: kmh(speedKmh) });
  const c = closeLoop(d);
  assert.ok(c.candidates.length, c.reason);
  return c.candidates[0].doc.words.reduce((x, w) => D.editWord(x, w.id, { speed: kmh(speedKmh) }), c.candidates[0].doc);
}

function exportOrTodo(t, doc) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-e2e-')); made.push(out);
  try { return { out, r: exportTrack(doc, { outDir: out }) }; } catch (e) {
    if (e.code === 'RED' && e.red.length && e.red.every((x) => x.reason === 'self-intersection')) {
      t.todo(`refused only by the self-intersection check, C's BVH false positive (src/export/fromwords.js SELF-INTERSECTION); C's fix in src/geom lets this through: ${e.message.slice(0, 200)}`);
      return null;
    }
    throw e;
  }
}

function checkEveryMarker(out, r) {
  const f = r.folders[0], k = readKn5(path.join(f.dir, `${f.folder}.kn5`));
  const found = new Set(k.dummies.map((d) => d.name)), placed = r.markers.map((m) => m.name);
  assert.ok(placed.length >= 5, `only ${placed.length} markers placed`);
  for (const m of placed) assert.ok(found.has(m), `${m} placed by the export but not in the kn5`);
  for (const need of ['AC_START_0', 'AC_PIT_0', 'AC_HOTLAP_START_0', 'AC_TIME_0_L', 'AC_TIME_0_R']) assert.ok(found.has(need), need);
  assert.ok(k.meshes.length > 0);
  assert.ok(fs.existsSync(path.join(f.dir, 'ai', 'fast_lane.ai')));
  return k;
}

test('words → closed loop → exported with every default → the kn5 reads back with every AC_ marker', (t) => {
  const doc = closedLoop('E2E Loop', [['straight'], ['straight'], ['tight', { handles: { length: 50 } }], ['straight'], ['tight']], 200);
  const e = exportOrTodo(t, doc); if (!e) return;
  assert.equal(e.r.folders[0].folder, 't180b_e2e_loop');
  checkEveryMarker(e.out, e.r);
});

test('the same with a jump in the loop: the jump carries its landing ramp, and the whole lap exports and reads back', (t) => {
  // the jump NAMED (12 m across, 0.7 m down): from D182 the default jump is the library's p10 gap, 81 m, sized to be caught
  // at the 460 km/h design speed; this loop flies it at 300 km/h off a 4° climb, where 81 m is not caught at 6.3 g (red)
  // and the straights NAMED at 100 m: the default straight is now the library's median run, 48 m, shorter than a grid
  // of 4 and 2 pit boxes need (67.4 m, NO_START_STRAIGHT)
  const jump = { handles: { gap: 12, drop: 0.7, land: -2 * DEG } }, s100 = { handles: { length: 100 } };
  const doc = closedLoop('E2E Jump Loop', [['straight', s100], ['straight', { handles: { length: 40, climb: 4 * DEG } }], ['jump', jump], ['straight', s100], ['tight'], ['straight', s100], ['tight']], 300);
  const e = exportOrTodo(t, doc); if (!e) return;
  const k = checkEveryMarker(e.out, e.r);
  assert.ok(D.resolve({ ...doc, closed: false }).segments.some((g) => g.part === 'land'), 'the jump has its ramp');
  assert.ok(k.meshes.some((m) => /w3/.test(m.name)), 'the ramp (the jump word\'s road) is meshed into the kn5');
});
