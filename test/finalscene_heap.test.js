// finalscene_heap.test.js: node --test test/finalscene_heap.test.js   (one row, ELYSIUM's whole export in its own node process, about 2 minutes)
// The final-scene check's memory (src/export/finalscene.js). It reads every triangle of the hull, and it runs inside the export, after the scene is built
// and while it is held: ELYSIUM's welded scene is about 1.5 GB of heap at that point. Held as one object per triangle and a string key per vertex, its 3.5
// million triangles added 3.6 GB of live heap (5.1 GB in all), and the export ran out of memory under a 4 GB heap (a batch export, 2026-11-02). They are
// now rows of typed arrays, read through a view made when a triangle is read: the check adds about 40 MB of heap and about 0.33 GB of typed arrays at its
// peak. Rows:
//   1  ELYSIUM (test/fixtures/elysium-2026-10-22.t180track) exports, the check run on its whole scene, in a node process whose heap is HEAP_MB: the export
//      alone fits it with room, and the check held as objects does not
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path'), { spawnSync } = require('child_process');

const HEAP_MB = 3072;   // measured: the old check ran out of memory under it; the export with the check now finishes under it, its peak heap 1.9 GB as without

test('row 1: ELYSIUM exports with the final-scene check under a 3 GB heap', () => {
  const repo = JSON.stringify(path.join(__dirname, '..')), doc = JSON.stringify(path.join(__dirname, 'fixtures', 'elysium-2026-10-22.t180track'));
  const code = `
const fs = require('fs'), path = require('path'), R = ${repo}, rq = (p) => require(path.join(R, p));
const FS = rq('src/export/finalscene.js'), real = FS.checkFinalScene; let ran = 0, tris = 0;
FS.checkFinalScene = (scene, o) => { ran++; for (const m of scene.root.children) if (m.type === 'mesh' && /^(1ROAD|UNDERSKIN)/.test(m.name)) tris += m.indices.length / 3; return real(scene, o); };
const D = rq('src/core/document.js'), A = rq('src/core/adapter.js'), FW = rq('src/export/fromwords.js'), { startLayout } = rq('app/core/coreshell.js');
const doc = D.parse(fs.readFileSync(${doc}, 'utf8'));
const segs = A.toSegments(doc), lift = (q) => A.offsetPath(doc, segs, q), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
const test = !doc.closed;
const b = FW.buildFromSegments(segs, { name: doc.name, via: 'finalscene_heap', liftPath: lift, start, pitLane: doc.pitLane }, { markers: startLayout(segs, lift, start, test ? { open: true } : undefined), test });
process.stdout.write(JSON.stringify({ ran, tris, refuse: b.sceneCheck.refuse.length, warn: b.sceneCheck.warn.length }));`;
  const env = { ...process.env, NODE_OPTIONS: (process.env.NODE_OPTIONS || '').replace(/--max-old-space-size=\d+/g, '').trim() };
  const run = spawnSync(process.execPath, [`--max-old-space-size=${HEAP_MB}`, '-e', code], { env, encoding: 'utf8', maxBuffer: 1 << 24, windowsHide: true });
  assert.equal(run.status, 0, `the export did not finish under a ${HEAP_MB} MB heap: ${String(run.stderr).slice(-600)}`);
  const m = JSON.parse(run.stdout);
  assert.equal(m.ran, 1, 'control: the export ran the final-scene check once');
  assert.ok(m.tris > 3e6, `control: the check was given ELYSIUM's whole road and skin (${m.tris} triangles)`);
});
