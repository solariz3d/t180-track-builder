// preview-close-reuse.test.js: node --test app/test/preview-close-reuse.test.js
// 2026-10-15, reported: Close with "new road from the end to the start" froze the window white on a 24 km track. The preview built the proposal's ghost
// and, after Apply, the closed track IN FULL (6.4 s and 6.7 s), though Finish to start adds road and moves nothing placed. Both now keep the placed
// mesh and make only the new road and the closing joint (geom.reuseMesh, grow). These rows hold that what is drawn is what a full build draws.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const { createTrackModel } = require('../preview/trackmodel.js');

const DEG = Math.PI / 180;
async function finishProposal() {
  const s = await createCoreShell({ brushFn: null, autosaveMs: 0, overlapRunner: { run: () => new Promise(() => {}), cancel() {} } });
  s.extend({ length: 400 }); s.extend({ length: 300, targets: { kh: 90 * DEG / 300 } }); s.extend({ length: 600, targets: { kh: 0 } }); s.extend({ length: 300, targets: { kh: 90 * DEG / 300 } }); s.extend({ length: 300, targets: { kh: 0 } });
  const open = s.getState().resolved;
  s.proposeClose({ finish: true });
  const p = s.getState().closeProposal; assert.ok(p, s.getState().message);
  return { open, closedResolved: p.resolved };
}
const flat = (batches) => batches.flatMap((b) => { const out = []; for (let i = 0; i < b.positions.length; i += 3) out.push([b.positions[i], b.positions[i + 1], b.positions[i + 2]].map((v, k) => v * b.model[k * 5] + b.model[12 + k])); return out; });
const worstGap = (a, b) => { assert.equal(a.length, b.length, `the same number of vertices (${a.length} vs ${b.length})`); let w = 0; for (let i = 0; i < a.length; i++) w = Math.max(w, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1], a[i][2] - b[i][2])); return w; };

test('the closed track after Apply, built from the open one, is the closed track a full build draws', async () => {
  const { open, closedResolved } = await finishProposal();
  const tm = createTrackModel(); tm.update(open);
  const kept = tm.update(closedResolved), fresh = createTrackModel().update(closedResolved);
  assert.ok(kept.batches.length === fresh.batches.length, `${kept.batches.length} batches vs ${fresh.batches.length}`);
  assert.ok(worstGap(flat(kept.batches), flat(fresh.batches)) < 1e-6, 'every vertex where a full build puts it');
  assert.ok(kept.path.closed, 'and it is the closed loop');
  assert.ok(kept.mesh.stats.reused >= open.segments.length, `every placed segment kept, not remade: ${kept.mesh.stats.reused} of ${open.segments.length}`);
});

test('the close preview\'s ghost, built from the placed mesh, is the ghost a full build draws', async () => {
  const { open, closedResolved } = await finishProposal();
  const tm = createTrackModel(); tm.update(open);
  const g = tm.proposalGhost(closedResolved);
  assert.equal(g.from, open.segments.length, 'the ghost is the new road: from the first new segment');
  assert.ok(worstGap(flat(g.batches), flat(createTrackModel().update(closedResolved).batches).slice(-flat(g.batches).length)) < 1e-6, 'its vertices are the full closed build\'s last ones');
  assert.ok(g.batches.length > 0, 'the new road is drawn');
});
