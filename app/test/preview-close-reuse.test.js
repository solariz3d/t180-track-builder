// preview-close-reuse.test.js: node --test app/test/preview-close-reuse.test.js
// 2026-10-15, reported: Close with "new road from the end to the start" froze the window white on a 24 km track. The preview built the proposal's ghost
// and, after Apply, the closed track IN FULL (6.4 s and 6.7 s), though Finish to start adds road and moves nothing placed. Both now keep the placed
// mesh and make only the new road and the closing joint (geom.reuseMesh, grow). This row holds that what is drawn is what a full build draws. D339: Close is one
// press (no preview), so the row closes with it, on an end only new road closes; the preview-ghost row went with the preview.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const { createTrackModel } = require('../preview/trackmodel.js');

const DEG = Math.PI / 180;
async function finishedByPress() {
  const s = await createCoreShell({ brushFn: null, autosaveMs: 0, overlapRunner: { run: () => new Promise(() => {}), cancel() {} } });
  s.extend({ length: 400 }); s.extend({ length: 300, targets: { kh: 90 * DEG / 300 } }); s.extend({ length: 600, targets: { kh: 0 } }); s.extend({ length: 300, targets: { kh: 90 * DEG / 300 } }); s.extend({ length: 300, targets: { kh: 0 } });
  const open = s.getState().resolved;
  await s.closeBest();
  assert.match(s.getState().message, /^closed: laid [0-9]+ m of new road/, 'this end closes with new road (the row is about drawing it on the placed mesh)');
  return { open, closedResolved: s.getState().resolved };
}
const flat = (batches) => batches.flatMap((b) => { const out = []; for (let i = 0; i < b.positions.length; i += 3) out.push([b.positions[i], b.positions[i + 1], b.positions[i + 2]].map((v, k) => v * b.model[k * 5] + b.model[12 + k])); return out; });
const worstGap = (a, b) => { assert.equal(a.length, b.length, `the same number of vertices (${a.length} vs ${b.length})`); let w = 0; for (let i = 0; i < a.length; i++) w = Math.max(w, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1], a[i][2] - b[i][2])); return w; };

test('the closed track after Close, built from the open one, is the closed track a full build draws', async () => {
  const { open, closedResolved } = await finishedByPress();
  const tm = createTrackModel(); tm.update(open);
  const kept = tm.update(closedResolved), fresh = createTrackModel().update(closedResolved);
  assert.ok(kept.batches.length === fresh.batches.length, `${kept.batches.length} batches vs ${fresh.batches.length}`);
  assert.ok(worstGap(flat(kept.batches), flat(fresh.batches)) < 1e-6, 'every vertex where a full build puts it');
  assert.ok(kept.path.closed, 'and it is the closed loop');
  // D453 (amended by name; its rule changed, it is not weakened): Close now BANKS the placed curves it closes (D447), so it no longer "moves nothing placed". The row's
  // premise is now: every placed segment whose geometry Close did not change is kept, and the ones it changed are remade, counted from the two resolved states by the
  // track model's own segment key (segkey.js). Before (0c73322..7717b81) a banking Close kept 0 of 950, the straights too: the reuse was all or nothing on the prefix.
  const { keyOf } = require('../preview/segkey.js'), same = open.segments.filter((g, j) => keyOf(g) === keyOf(closedResolved.segments[j])).length, changed = open.segments.length - same;
  assert.ok(same > 0 && changed > 0, `control: Close banked some placed segments and left others (${changed} changed, ${same} not)`);
  assert.equal(kept.mesh.stats.reused, same, `every placed segment Close did not change is kept (${same}), the ${changed} it changed remade: kept ${kept.mesh.stats.reused}`);
});

// D453: CLOSE'S REBUILD ON A 24 KM TRACK, timed. A rectangle of 6 km straight sides laid as 1 km pieces with three upright 90° corners (R 300), its fourth side 2 km short:
// Close lays new road and banks the three corners (D447), and nothing else placed changes. Node, through createTrackModel, best of three, as a share of a full build of the
// closed track in the same run (so the machine's load cancels): at ff88d85 (no banking Close) 0.24–0.26 (231–281 ms against 968–1,075); at 7717b81 (every placed segment
// remade) 0.91–1.16; with D453 0.27–0.38 (p-d453-O_2026-10-24_evidence/close-rebuild-rect.out). The bound is twice ff88d85's share: the freeze he reported was a full rebuild.
test('Close\'s rebuild of a 24 km track it closes with new road costs at most half a full build: the placed straights are kept', async () => {
  const D = require('../../src/core/document.js'), { extend } = require('../../src/core/extend.js'), { extendTurnBy } = require('../../src/core/turnby.js');
  let d = D.createDoc('rect'); d = extend(d, { length: 300, family: 'bowl' });
  for (let side = 0; side < 4; side++) { for (let k = 0; k < (side === 3 ? 4 : 6); k++) d = extend(d, { length: 1000 }); if (side < 3) d = extendTurnBy(d, { length: 150 * Math.PI }, 90 * DEG); }
  d = extend(d, { length: 200 });
  const text = D.serialize(d), s = await createCoreShell({ storage: { openDoc: async () => text }, brushFn: null, autosaveMs: 0, overlapRunner: { run: () => new Promise(() => {}), cancel() {} } });
  await s.open('rect'); const open = s.getState().resolved;
  await s.closeBest(); assert.match(s.getState().message, /^closed: laid [0-9]+ m of new road/, 'control: Close lays new road'); const closed = s.getState().resolved;
  let rebuild = Infinity, full = Infinity, reused = 0;
  for (let r = 0; r < 3; r++) {
    const tm = createTrackModel(); tm.update(open);
    let t = process.hrtime.bigint(); const kept = tm.update(closed); rebuild = Math.min(rebuild, Number(process.hrtime.bigint() - t) / 1e6); reused = kept.mesh.stats.reused;
    t = process.hrtime.bigint(); createTrackModel().update(closed); full = Math.min(full, Number(process.hrtime.bigint() - t) / 1e6);
  }
  assert.ok(open.segments.length > 10000, `control: a long track (${open.segments.length} placed segments)`);
  assert.ok(rebuild <= 0.5 * full, `Close's rebuild ${rebuild.toFixed(0)} ms against a full build's ${full.toFixed(0)} ms (share ${(rebuild / full).toFixed(2)}, bound 0.5); kept ${reused} of ${open.segments.length}`);
});
