// geom_mesh_stalekey.test.js: node --test test/geom_mesh_stalekey.test.js
// D483 part 2: a sculpt keeps a later piece's mesh only when that piece's handles are the same (mesh.js handleKey). The key is now made faster by keeping the text of
// a DEEPLY FROZEN part of a segment (a profile the core froze) by identity, so these rows state what must never happen: a segment that changed reusing the mesh made
// from what it was. Each row changes one later piece in a different way, sculpts an earlier piece, and asks that the result is the full rebuild of the changed track
// and that the changed piece really changed shape (so a stale reuse could not pass). The last row is the control: with nothing else changed, every later piece is kept.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const GDIR = process.env.GEOM_DIR || path.join(__dirname, '..', 'src', 'geom');
const G = require(GDIR);
const PATH = require(path.join(GDIR, 'path.js'));

const D = Math.PI / 180;
const children = (m) => m.scene.root.children;
const maxDiff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return d; };
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { for (const k of Object.keys(o)) deepFreeze(o[k]); Object.freeze(o); } return o; };
const wall = (deg) => ({ font: 'half-pipe', u: [-13, -5, 0, 5, 13], psi: [deg * D, 0, 0, 0, deg * D], material: 'ROAD' });
const N = 10, G0 = 2, J = 6;   // ten pieces, the sculpt at piece 2, the piece that changes is piece 6
/** ten flat straights with the same wall and no font ramps (rampM 0: a changed profile would otherwise give the NEXT piece a ramp and this one a new key by another road),
 *  so a later piece is kept exactly when its own handles read the same; `prof` makes each piece's profile */
const track = (prof) => Array.from({ length: N }, (_, i) => ({ id: `p${i}`, kind: 'road', length: 30 + i, rampM: 0, profile: prof(i) }));

function sameAsFull(sm, full) {
  const A = children(sm), B = children(full);
  assert.deepStrictEqual(A.map((c) => c.name), B.map((c) => c.name), 'cell names');
  for (let i = 0; i < A.length; i++) {
    assert.ok(maxDiff(A[i].matrix, B[i].matrix) <= 1e-9, `${A[i].name} matrix`);
    for (const f of ['positions', 'normals', 'uvs']) assert.ok(maxDiff(A[i].children[0][f], B[i].children[0][f]) <= 1e-5, `${A[i].name}.${f}`);
    assert.deepStrictEqual(Array.from(A[i].children[0].indices), Array.from(B[i].children[0].indices));
  }
}
const cellOf = (m, id) => children(m).find((c) => c.name === `CELL_${id}_0`).children[0];
/** mesh `segs`; then `change(segs)` (in place, or returning a new list); then sculpt piece G0's length; the result against the full rebuild */
function run(segs, change) {
  const p = G.buildPath(segs), m = G.buildMesh(p, segs), old = Float32Array.from(cellOf(m, `p${J}`).positions);
  const changed = change(segs) || segs, edited = changed.slice(); edited[G0] = { ...changed[G0], length: changed[G0].length + 7 };
  PATH.rebuildPathFrom(p, edited, G0); const sm = G.sculptMesh(m, p, edited, G0);
  return { sm, full: G.buildMesh(G.buildPath(edited), edited), old };
}
function changedAndRebuilt({ sm, full, old }) {
  sameAsFull(sm, full);
  const now = cellOf(full, `p${J}`).positions;
  assert.ok(now.length !== old.length || maxDiff(now, old) > 1, 'the change must really change piece 6 (else a stale reuse would pass)');
  assert.ok(sm.stats.reused < N - 1 - G0, `piece 6 was kept (reused ${sm.stats.reused} of ${N - 1 - G0})`);
}

test('a later piece whose FROZEN profile is replaced by another frozen profile is meshed again, never kept', () => {
  changedAndRebuilt(run(track(() => deepFreeze(wall(60))), (s) => { const t = s.slice(); t[J] = { ...s[J], profile: deepFreeze(wall(95)) }; return t; }));
});
test('a later FROZEN segment replaced by a frozen one with a new profile is meshed again, never kept', () => {
  changedAndRebuilt(run(track(() => deepFreeze(wall(60))).map(deepFreeze), (s) => { const t = s.slice(); t[J] = deepFreeze({ ...s[J], profile: wall(95) }); return t; }));
});
test('a number changed IN PLACE inside a later piece\'s unfrozen profile: the piece is meshed again, never kept', () => {
  changedAndRebuilt(run(track(() => wall(60)), (s) => { s[J].profile.psi[0] = 95 * D; s[J].profile.psi[4] = 95 * D; }));
});
test('a frozen profile whose ARRAYS are not frozen, changed in place: the piece is meshed again, never kept', () => {
  changedAndRebuilt(run(track(() => Object.freeze(wall(60))), (s) => { s[J].profile.psi[0] = 95 * D; s[J].profile.psi[4] = 95 * D; }));
});
test('a frozen profile inside an unfrozen nested object (a blend\'s from), swapped in place: the piece is meshed again, never kept', () => {
  const blendOf = () => ({ from: deepFreeze(wall(60)), s0: 0, length: 10 });
  changedAndRebuilt(run(track(() => deepFreeze(wall(60))).map((g) => ({ ...g, blend: blendOf() })), (s) => { s[J].blend.from = deepFreeze(wall(95)); s[J].profile = deepFreeze(wall(95)); }));
});
test('a frozen profile that reads its angles through a GETTER, whose answer changed: the piece is meshed again, never kept', () => {
  const psi = Array.from({ length: N }, () => Object.freeze(wall(60).psi));   // each piece its own angles, so only piece 6's change; each answer frozen, so only the getter tells it can change
  const viaGetter = (i) => Object.freeze({ font: 'half-pipe', u: Object.freeze([-13, -5, 0, 5, 13]), get psi() { return psi[i]; }, material: 'ROAD' });
  changedAndRebuilt(run(track(viaGetter), () => { psi[J] = Object.freeze(wall(95).psi); }));
});
test('the control: with nothing else changed, every later piece keeps its mesh (frozen and unfrozen profiles alike)', () => {
  for (const prof of [() => deepFreeze(wall(60)), () => wall(60)]) {
    const { sm, full } = run(track(prof), () => null);
    sameAsFull(sm, full);
    assert.strictEqual(sm.stats.reused, N - 1 - G0, 'every later piece is reused');
  }
});
