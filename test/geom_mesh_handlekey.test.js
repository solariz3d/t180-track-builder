// geom_mesh_handlekey.test.js: node --test test/geom_mesh_handlekey.test.js
// A long track's preview ran the page out of memory (the user's 24 km ELYSIUM: about 900 MB of JavaScript heap for one mesh). Each piece keeps the key a sculpt
// compares to decide whether it can keep the piece's mesh (mesh.js handleKey), and that key was the piece's whole JSON text, kilobytes per 2 m chord, kept per piece and
// again per frozen profile for as long as the segments live. These rows state what the key must be: small whatever the cross-section, and the same comparison as before
// (equal for equal content, ids aside, frozen or not; different for any changed number). Which pieces a sculpt keeps is test/geom_mesh_stalekey.test.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const v8 = require('v8'), vm = require('vm');
const GDIR = process.env.GEOM_DIR || path.join(__dirname, '..', 'src', 'geom');
const G = require(GDIR);

const D = Math.PI / 180;
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { for (const k of Object.keys(o)) deepFreeze(o[k]); Object.freeze(o); } return o; };
/** a tube-like cross-section of n knots, each piece its own (as a core track's chords are), so nothing is shared between pieces */
// flat in the middle and rising to 60 degrees over its outer tenth each side, a little different per piece: about a hundred vertices across, as a core track's tube chords
const big = (n, seed) => ({ font: 'half-pipe', u: Array.from({ length: n }, (_, i) => -20 + 40 * i / (n - 1)), psi: Array.from({ length: n }, (_, i) => (Math.max(0, Math.abs(i - (n - 1) / 2) - 0.4 * (n - 1)) / (0.1 * (n - 1)) * 60 + seed * 1e-6) * D), material: 'ROAD' });
const track = (count, n, freeze) => Array.from({ length: count }, (_, i) => ({ id: `p${i}`, kind: 'road', length: 4, rampM: 0, profile: freeze ? deepFreeze(big(n, i)) : big(n, i) }));
const keysOf = (segs) => G.buildMesh(G.buildPath(segs), segs)._state.pieces.map((pc) => pc.handles);

test('the key a piece keeps is small, whatever its cross-section (a 400-knot profile, frozen or not)', () => {
  for (const freeze of [true, false]) {
    const keys = keysOf(track(3, 400, freeze));
    for (const k of keys) assert.ok(typeof k === 'string' && k.length <= 64, `a ${freeze ? 'frozen' : 'plain'} 400-knot profile's key is ${typeof k === 'string' ? k.length : typeof k} characters`);
  }
});

test('the key is the same for the same content, frozen or not and whatever the ids, and differs for one changed number', () => {
  const a = track(2, 50, true), b = track(2, 50, false).map((g) => ({ ...g, id: `other-${g.id}` }));
  assert.deepStrictEqual(keysOf(a), keysOf(b), 'equal content, one frozen and one not, other ids');
  const c = track(2, 50, false); c[1].profile.psi[17] = c[1].profile.psi[17] * (1 + 2 ** -50);
  const kc = keysOf(c), ka = keysOf(a);
  assert.strictEqual(kc[0], ka[0], 'the unchanged piece keeps its key');
  assert.notStrictEqual(kc[1], ka[1], 'one number one ulp away gives another key');
  const d = track(2, 50, false); d[1] = { ...d[1], length: 4.000000001 };
  assert.notStrictEqual(keysOf(d)[1], ka[1], 'a changed length gives another key');
  const e = track(2, 50, false); e[1] = { ...e[1], profile: { ...e[1].profile, u: [...e[1].profile.u], psi: [...e[1].profile.psi] } }; { const q = e[1].profile.psi, t = q[0]; q[0] = q[25]; q[25] = t; }   // two different angles swapped
  assert.notStrictEqual(keysOf(e)[1], ka[1], 'the same angles in another order give another key');
});

test('a mesh made and dropped leaves no per-piece text behind while its segments live (6,000 pieces of 300-knot frozen profiles)', () => {
  v8.setFlagsFromString('--expose-gc'); const gc = vm.runInNewContext('gc');
  const segs = track(6000, 300, true), p = G.buildPath(segs);
  gc(); gc(); const h0 = process.memoryUsage().heapUsed;
  let m = G.buildMesh(p, segs); m = null;
  gc(); gc(); const kept = (process.memoryUsage().heapUsed - h0) / 1048576;
  // before the key was a key and the mesher's memos were bounded, 638.6 MB stayed here (about 106 kB a piece); now about 85 MB, most of it the bounded memos
  assert.ok(kept < 120, `${kept.toFixed(1)} MB stayed after the mesh was dropped (the segments are still alive)`);
  assert.ok(segs.length === 6000);   // the segments live to here
});
