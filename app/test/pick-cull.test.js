// pick-cull.test.js: node --test app/test/pick-cull.test.js   (about two minutes: the reference pick reads every station)
// The hover pick (app/preview/preview.js pickAcross) projected every station of the track on every pointer move and worked out the half-width of each one's segment:
// the first hover over the user's 24 km ELYSIUM took about 20 s, and every move over a 100 km track 23 to 50 ms. It now skips the stations that cannot be within reach
// (boxes of stations, then a lower bound per station) and reads the half-width from a sealed copy of the cross-section. The answer must not change. Rows:
//   1  the half-width read from the sealed copy is the plain one to the bit, for every segment of the fixtures, the ELYSIUM fixture and a 100 km track
//   2  the pick with the cull is the pick without it (cull: false, which reads every station as before), field for field, at a fixed set of pointer positions in
//      several views of each track: an overview, three views above the road, and one low along the road (part of the track behind the eye)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const D = require('../../src/core/document.js');
const G = require('../../src/geom/index.js');
const { spanOf, sealed, readAt } = require('../../src/geom/profile.js');
const { createCoreShell } = require('../core/coreshell.js');
const { pickAcross } = require('../preview/preview.js');
const M = require('../camera/math.js');

const FX = path.join(__dirname, '..', '..', 'test', 'fixtures');
const W = 1160, H = 860;
async function resolvedOf(text) {
  const s = await createCoreShell({ storage: { openDoc: async () => text, listDocs: async () => [], openUndo: async () => null, saveAutosave: async () => {} }, autosaveMs: 0 });
  await s.open('T'); const r = s.getState().resolved; assert.ok(r, `the track resolves: ${s.getState().message}`); return r;
}
async function long100() {
  const s = await createCoreShell({ autosaveMs: 0 }), R = 400, Q = (Math.PI * R) / 2; let m = 0, i = 0;
  while (m < 100000) { if (i % 4 === 3) { s.extend({ length: Q, transition: 60, targets: { kh: (i % 8 === 3 ? 1 : -1) / R } }); m += Q; } else { s.extend({ length: 800, ...(i === 0 ? { family: 'bowl' } : {}) }); m += 800; } i++; }
  return s.getState().resolved;
}
/** the path the preview reads: the track model's (step 2, its start, closed or not, lifted by the offsets) */
function shownPath(r) { const p = G.buildPath(r.segments, { step: 2, closed: !!r.closed, ...(r.start ? { start: r.start } : {}) }); return typeof r.lift === 'function' ? r.lift(p) : p; }
let TRACKS = null;
async function tracks() {
  if (TRACKS) return TRACKS;
  const out = [];
  for (const f of fs.readdirSync(FX).filter((n) => /^F\d.*\.core2\.json$/.test(n) && !/empty/.test(n)).sort()) out.push({ name: f, r: await resolvedOf(fs.readFileSync(path.join(FX, f), 'utf8')) });
  out.push({ name: 'elysium-2026-10-22', r: await resolvedOf(fs.readFileSync(path.join(FX, 'elysium-2026-10-22.t180track'), 'utf8')) });
  out.push({ name: '100 km', r: await long100() });
  for (const t of out) t.path = shownPath(t.r);
  return (TRACKS = out);
}
/** the views: an overview of the whole track, three above the road, one low along it (some of the track behind the eye) */
function poses(p) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const m of p.samples) for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], m.pos[d]); hi[d] = Math.max(hi[d], m.pos[d]); }
  const c = [0, 1, 2].map((d) => (lo[d] + hi[d]) / 2), span = Math.max(hi[0] - lo[0], hi[2] - lo[2], 50), fov = Math.PI / 3, out = [{ eye: [c[0], c[1] + span * 0.9, c[2] - span * 0.3], target: c, up: [0, 1, 0], fov }];
  for (const f of [0.1, 0.37, 0.8]) { const m = p.samples[Math.floor((p.samples.length - 1) * f)]; out.push({ eye: [m.pos[0] - 30 * m.T[0], m.pos[1] + 25, m.pos[2] - 30 * m.T[2]], target: m.pos, up: [0, 1, 0], fov }); }
  const m = p.samples[Math.floor((p.samples.length - 1) * 0.5)];
  out.push({ eye: [m.pos[0] + 2 * m.U[0], m.pos[1] + 2 * m.U[1], m.pos[2] + 2 * m.U[2]], target: [m.pos[0] + 50 * m.T[0], m.pos[1] + 50 * m.T[1] + 1, m.pos[2] + 50 * m.T[2]], up: [0, 1, 0], fov });
  return out;
}
/** the pointer positions: a 16 x 10 grid over the view, and beside every 97th station on screen at 0, 12 and 30 px */
function pointers(p, pose) {
  const out = []; for (let i = 0; i < 16; i++) for (let j = 0; j < 10; j++) out.push([(i + 0.5) * W / 16, (j + 0.5) * H / 10]);
  const VP = M.viewProj(pose, W / H);
  for (let i = 0; i < p.samples.length; i += 97) {
    const c = M.apply(VP, p.samples[i].pos); if (!(c[3] > 0)) continue;
    const x = (c[0] / c[3] * 0.5 + 0.5) * W, y = (1 - (c[1] / c[3] * 0.5 + 0.5)) * H; if (x < 0 || x > W || y < 0 || y > H) continue;
    out.push([x, y], [x + 12, y - 5], [x - 30, y + 3]);
  }
  return out;
}

test('row 1: the half-width read from the sealed cross-section is the plain one to the bit, for every segment', async (tc) => {
  let n = 0;
  for (const t of await tracks()) for (const g of t.r.segments) {
    if (!g || !g.profile) continue;
    const plain = spanOf(readAt(g, 0)) / 2, fast = spanOf(sealed(readAt(g, 0))) / 2;
    assert.ok(Object.is(plain, fast), `${t.name} ${g.id}: ${plain} and ${fast}`); n++;
  }
  tc.diagnostic(`${n} segments read`); assert.ok(n > 60000, `${n} segments read`);
});

test('row 2: the pick with the cull is the pick without it, field for field, at every pointer position of every view of every track', async (tc) => {
  let picks = 0, hits = 0;
  for (const t of await tracks()) {
    for (const pose of poses(t.path)) for (const [x, y] of pointers(t.path, pose)) {
      const a = pickAcross(t.path, t.r.segments, pose, x, y, W, H), b = pickAcross(t.path, t.r.segments, pose, x, y, W, H, 40, { cull: false });
      assert.deepStrictEqual(a, b, `${t.name} at (${x.toFixed(1)}, ${y.toFixed(1)}) from ${JSON.stringify(pose.eye.map((v) => +v.toFixed(1)))}`);
      picks++; if (b) hits++;
    }
  }
  tc.diagnostic(`${picks} pointer positions, ${hits} on the road`);
  assert.ok(picks > 5000 && hits > 1000, `${picks} pointer positions, ${hits} of them on the road`);
});
