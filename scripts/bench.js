#!/usr/bin/env node
// bench.js: a RAINBOW-SCALE track, timed along the app's own edit path (ARCHITECTURE §11.1: Rainbow is ONE loop of
// 43.3 km; FINDINGS: 696 words).
//
//   node scripts/bench.js [--km 40] [--seed 17] [--json]
//
// THE EDIT PATH, as the app runs it on every change (headless, the same modules the window loads): A's shell (the
// document, resolveFrom) → C's preview track model (app/preview/trackmodel.js: extend / sculpt / full) → E's validation
// controller (app/validate-ui/panel.js: append / sculpt / full revalidation). Each is timed, and the total.
//
// "FAST ENOUGH", written BEFORE measuring. ARCHITECTURE states no latency figure (§1.5 says users hate "slow updates";
// §9 gives only the IPC cost, about 200 ms for 10 MB). So these budgets are mine, INFERRED:
//   · one DRAG STEP (a sculpt handle moved one step, the preview and the revalidation included): ≤ 50 ms, so a drag
//     updates at 20 Hz or better and stays live under the hand;
//   · PLACING one word at the head: ≤ 100 ms (the usual "instant" threshold for a discrete action);
//   · a FULL REVALIDATE (a new speed or export setting): ≤ 1 s, a deliberate action that must not break flow;
//   · MEMORY for a Rainbow-scale track: ≤ 1 GB for the whole UI process (WebView2 runs the geometry in it, §9).
// Each number printed says whether it is inside its budget. Wall times are medians of repeated runs on one machine,
// shared with other work; they are indicative, not a benchmark suite.
'use strict';

const path = require('path');
const R = path.join(__dirname, '..');
const D = require(path.join(R, 'src/doc/index.js'));
const { createShell } = require(path.join(R, 'app/shell.js'));
const { createTrackModel } = require(path.join(R, 'app/preview/trackmodel.js'));
const { createValidationController } = require(path.join(R, 'app/validate-ui/panel.js'));

const BUDGET = Object.freeze({ dragMs: 50, placeMs: 100, fullRevalidateMs: 1000, memoryMB: 1024 });
/** A small seeded PRNG (mulberry32): the same seed gives the same track. */
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const WORDS = ['straight', 'straight', 'sweep', 'sweep', 'turn', 'tight', 'wall-ride', 'jump'];
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const memStore = () => { const m = new Map(); return { saveDoc: async (n, t) => m.set(n, t), openDoc: async (n) => m.get(n), listDocs: async () => [...m.keys()], saveLibrary: async () => {}, openLibrary: async () => null, saveAutosave: async () => {}, openAutosave: async () => null }; };

/** A shell with the preview model and the validation controller subscribed, as the window has them. */
async function rig() {
  const shell = await createShell({ storage: memStore(), autosaveMs: 0 });
  const model = createTrackModel(), times = { preview: 0, validate: 0 };
  shell.subscribe((st) => { const t = process.hrtime.bigint(); if (st.resolved) model.update(st.resolved); times.preview = ms(t); });
  let tv = null;
  const ctl = createValidationController(shell, { onUpdate: () => { if (tv) times.validate = ms(tv); }, schedule: (fn) => { tv = process.hrtime.bigint(); fn(); } });
  return { shell, model, ctl, times };
}
/** Place seeded words until the track is `km` long. Returns the timings of the last placements. */
async function buildTrack(r, km, seed) {
  const rnd = prng(seed), placeMs = [];
  while (!(r.model.path && r.model.path.lengthM >= km * 1000)) {
    const w = WORDS[Math.floor(rnd() * WORDS.length)], dir = rnd() < 0.5 ? 'L' : 'R';
    r.shell.setPicker('dir', dir);
    const t = process.hrtime.bigint(); r.shell.place(w); placeMs.push(ms(t));
    if (r.shell.getState().message) throw new Error(`place ${w}: ${r.shell.getState().message}`);
  }
  return placeMs;
}

async function main(argv) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };
  const km = arg('--km', 40), seed = arg('--seed', 17);
  const r = await rig(), t0 = process.hrtime.bigint();
  const placeAll = await buildTrack(r, km, seed);
  const buildS = ms(t0) / 1000, doc = r.shell.getState().history.present, words = doc.words.length, lengthKm = r.model.path.lengthM / 1000;

  // 1. placing one word at the head of the finished track (median of 7, each undone)
  const place = [], placePreview = [], placeValidate = [];
  for (let k = 0; k < 7; k++) {
    const t = process.hrtime.bigint(); r.shell.place('straight'); place.push(ms(t)); placePreview.push(r.times.preview); placeValidate.push(r.times.validate);
    r.shell.undo();
  }
  // 2. one drag step of a sculpt handle: a word near the head, and one in the middle (everything after it moves)
  const drag = {};
  // a straight mid-track only TRANSLATES what follows; a curved word mid-track also turns it, and on a pitched stretch the
  // rotation-minimising frame then leaves every later piece banked by a hair, so the preview remeshes them (D166 §5)
  const ws = r.shell.getState().history.present.words, midCurve = ws.findIndex((x, k) => k >= Math.floor(words / 2) && x.word !== 'straight');
  for (const [where, idx] of [['near the head', words - 3], ['in the middle (a straight)', ws.findIndex((x, k) => k >= Math.floor(words / 2) && x.word === 'straight')], ['in the middle (a curved word)', midCurve]]) {
    const w = r.shell.getState().history.present.words[idx], len0 = w.handles.length, steps = [], pv = [], vl = [];
    r.shell.beginDrag();
    for (let k = 1; k <= 7; k++) { const t = process.hrtime.bigint(); r.shell.dragTo(w.id, { handles: { length: len0 + k * 0.5 } }); steps.push(ms(t)); pv.push(r.times.preview); vl.push(r.times.validate); }
    r.shell.endDrag(); r.shell.undo();
    drag[where] = { word: `${w.id} (${w.word})`, stepMs: median(steps), previewMs: median(pv), validateMs: median(vl), how: r.ctl.state.how };
  }
  // 3. a full revalidate (the export setting flipped twice: each re-validates the whole track)
  const full = [];
  for (let k = 0; k < 3; k++) { const t = process.hrtime.bigint(); r.ctl.setCsp(k % 2 === 0 ? false : true); full.push(ms(t)); }
  // 4. memory, after a GC if exposed
  if (global.gc) global.gc();
  const mem = process.memoryUsage(), mb = (b) => Math.round(b / 1048576);
  const cells = r.model.mesh.cells.length, verts = r.model.mesh.cells.reduce((a, c) => a + c.vertices, 0);
  const out = {
    track: { seed, words, lengthKm: +lengthKm.toFixed(2), cells, vertices: verts, buildSeconds: +buildS.toFixed(1), placeWhileBuildingMs: { median: +median(placeAll).toFixed(1), last: +placeAll[placeAll.length - 1].toFixed(1) } },
    placeMs: { total: +median(place).toFixed(1), preview: +median(placePreview).toFixed(1), validate: +median(placeValidate).toFixed(1), budget: BUDGET.placeMs, ok: median(place) <= BUDGET.placeMs },
    dragStep: Object.fromEntries(Object.entries(drag).map(([k, v]) => [k, { ...v, stepMs: +v.stepMs.toFixed(1), previewMs: +v.previewMs.toFixed(1), validateMs: +v.validateMs.toFixed(1), budget: BUDGET.dragMs, ok: v.stepMs <= BUDGET.dragMs }])),
    fullRevalidateMs: { median: +median(full).toFixed(1), budget: BUDGET.fullRevalidateMs, ok: median(full) <= BUDGET.fullRevalidateMs },
    memoryMB: { heapUsed: mb(mem.heapUsed), rss: mb(mem.rss), arrayBuffers: mb(mem.arrayBuffers), budget: BUDGET.memoryMB, ok: mb(mem.rss) <= BUDGET.memoryMB, gc: !!global.gc },
    command: `node ${global.gc ? '--expose-gc ' : ''}scripts/bench.js --km ${km} --seed ${seed}`,
  };
  r.ctl.dispose();
  return out;
}

if (require.main === module) main(process.argv.slice(2)).then((o) => console.log(JSON.stringify(o, null, 1))).catch((e) => { console.error(`bench: ${e.stack || e.message}`); process.exit(1); });
module.exports = { main, buildTrack, rig, prng, BUDGET, WORDS };
