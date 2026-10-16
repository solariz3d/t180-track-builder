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
  assert.ok(kept.mesh.stats.reused >= open.segments.length, `every placed segment kept, not remade: ${kept.mesh.stats.reused} of ${open.segments.length}`);
});
