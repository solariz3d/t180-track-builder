#!/usr/bin/env node
// soak.js: thousands of random edits through the app's own modules, with a fixed seed, checking that nothing breaks.
//
//   node scripts/soak.js [--seed 1] [--ops 10000] [--max-words 12] [--quiet]
//   (the default suite runs a short soak; the full one is `T180_SOAK=10000 node --test --test-concurrency=4 test/perf_soak.test.js`,
//    under the heavy-run lock)
//
// THE RIG: A's real shell (the document, undo, save and open through an in-memory store), with C's preview track model
// subscribed as in the window. E's validation (src/validate) runs on the current track every 50 ops.
// THE OPERATIONS, seeded: place a palette word (random pickers), sculpt a random handle of a random word by a drag-sized
// step (±25% of its value, ±0.5 rad for an angle) clamped to that handle's own range (src/doc/library.js handleInfo), undo, redo, remove the head, save, open, set a picker.
// THE TRACK IS KEPT SHORT (6 words by default, --max-words; measured 0.18 s an op at 6, 0.37 at 12): past that, places turn into removals, so 10,000 ops stay
// minutes, not hours. Long tracks are the bench's job (scripts/bench.js), not the soak's.
// THE CHECKS:
//   · no crash: anything the shell THROWS (rather than turning into its message) fails the soak;
//   · every intermediate document round-trips: serialize(parse(text)) === text, after every op;
//   · undo is byte-identical: every 25th committing op is undone (the text must equal the one before it) and redone
//     (it must equal the one after it);
//   · save then open gives the same text;
//   · the preview's incremental track equals a full build of the same segments, every `fullEvery` ops (250) and at the end;
//   · E's validate runs without throwing, every 50 ops.
// A FAILURE prints the seed, the op index and the op, and a command that replays exactly up to it.
'use strict';

const path = require('path');
const R = path.join(__dirname, '..');
const D = require(path.join(R, 'src/doc/index.js'));
const L = require(path.join(R, 'src/doc/library.js'));
const G = require(path.join(R, 'src/geom/index.js'));
const { validate } = require(path.join(R, 'src/validate/index.js'));
const { createShell } = require(path.join(R, 'app/shell.js'));
const APP = process.env.APP_DIR || path.join(R, 'app');   // the mutation harness points this at a mutant copy
const { createTrackModel, STEP } = require(path.join(APP, 'preview/trackmodel.js'));
const { batchesOf } = require(path.join(APP, 'preview/batches.js'));

function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const OPS = [['place', 30], ['sculpt', 25], ['undo', 12], ['redo', 8], ['removeHead', 5], ['save', 5], ['open', 5], ['picker', 10]];
const MAX_WORDS = 6;

class SoakFailure extends Error {
  constructor(seed, index, op, msg) { super(`soak: seed ${seed}, op #${index} (${op}): ${msg}\n  replay: node scripts/soak.js --seed ${seed} --ops ${index + 1} --max-words ${SoakFailure.maxWords}`); this.name = 'SoakFailure'; this.seed = seed; this.index = index; this.op = op; }
}

/** The incremental preview must equal a full build: same batches and indices, matrices 1e-9, positions 1e-5 m. */
function sameAsFull(model, resolved) {
  if (!resolved || !resolved.segments.length || !model.mesh) return null;
  const segs = resolved.segments, full = batchesOf(G.buildMesh(G.buildPath(segs, { step: STEP, closed: !!resolved.closed }), segs)), inc = batchesOf(model.mesh);
  if (inc.length !== full.length) return `${inc.length} batches incrementally, ${full.length} in a full build`;
  for (let i = 0; i < inc.length; i++) {
    if (inc[i].key !== full[i].key) return `batch ${i}: ${inc[i].key} vs ${full[i].key}`;
    for (let k = 0; k < 16; k++) if (Math.abs(inc[i].model[k] - full[i].model[k]) > 1e-9) return `${inc[i].key}: matrix differs`;
    const a = inc[i].positions, b = full[i].positions;
    if (a.length !== b.length) return `${inc[i].key}: ${a.length} vs ${b.length} position values`;
    for (let k = 0; k < a.length; k++) if (Math.abs(a[k] - b[k]) > 1e-5) return `${inc[i].key}: position ${k} differs by ${Math.abs(a[k] - b[k])}`;
  }
  return null;
}

async function runSoak({ seed = 1, ops = 10000, maxWords = MAX_WORDS, fullEvery = 250, quiet = true, log = () => {} } = {}) {
  SoakFailure.maxWords = maxWords;
  const rnd = prng(seed), pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const store = new Map();
  const storage = { saveDoc: async (n, t) => { store.set(n, t); }, openDoc: async (n) => { if (!store.has(n)) throw new Error(`no track ${n}`); return store.get(n); }, listDocs: async () => [...store.keys()],
    saveLibrary: async () => {}, openLibrary: async () => null, saveAutosave: async () => {}, openAutosave: async () => null };
  const shell = await createShell({ storage, autosaveMs: 0 }), model = createTrackModel();
  let modelError = null;
  shell.subscribe((st) => { try { if (st.resolved) model.update(st.resolved); } catch (e) { modelError = e; } });
  const text = () => D.serialize(shell.getState().history.present);
  const words = () => shell.getState().history.present.words;
  const total = OPS.reduce((a, [, w]) => a + w, 0), stats = { ops: 0, committed: 0, undoChecks: 0, fullChecks: 0, validations: 0, refused: 0, byOp: {}, unresolvedOps: 0, firstUnresolved: null, tornAfterOther: 0, geometryOps: 0 };
  let committing = 0;
  for (let i = 0; i < ops; i++) {
    let r = rnd() * total, op = OPS[0][0]; for (const [name, w] of OPS) { if (r < w) { op = name; break; } r -= w; }
    if (op === 'place' && words().length >= maxWords) op = 'removeHead';
    const before = text(), fail = (msg) => { throw new SoakFailure(seed, i, op, msg); };
    let committed = false;
    try {
      if (op === 'place') { const p = pick(shell.palette().filter((x) => x.builtin)); shell.place(p.name); committed = !shell.getState().message; }
      else if (op === 'sculpt') {
        // only top-level words: the shell sculpts a word through editWord, which refuses a phrase (B, D178 read: a starter
        // phrase in the palette made this pick a phrase id, and handleInfo threw NO_SUCH_WORD at seed 1, op #33)
        const ws = words().filter((e) => e.phrase === undefined); if (!ws.length) { op = 'sculpt (no word)'; }
        else {
          const w = pick(ws), info = L.handleInfo(shell.getState().history.present, w.id), keys = Object.keys(info.handles).filter((k) => info.handles[k].range);
          if (keys.length) {
            // a drag-sized move from the current value (±25%, or ±0.5 rad), clamped to the handle's own range: the ranges are
            // the model's limits (a length may be up to 100 km), not what a hand does
            const k = pick(keys), h = info.handles[k], [lo, hi] = h.range, span = h.unit === 'rad' ? 0.5 : Math.max(0.05, Math.abs(h.value) * 0.25);
            const v = Math.min(hi, Math.max(lo, h.value + (rnd() * 2 - 1) * span));
            shell.sculpt(w.id, { handles: { [k]: v } }); committed = !shell.getState().message;
          }
        }
      }
      else if (op === 'undo') shell.undo();
      else if (op === 'redo') shell.redo();
      else if (op === 'removeHead') { if (words().length) { shell.removeHead(); committed = !shell.getState().message; } }
      else if (op === 'save') { await shell.save('soak'); if (store.get('soak') !== text()) fail('the saved text differs from the document'); }
      else if (op === 'open') { if (store.has('soak')) { const want = store.get('soak'); await shell.open('soak'); if (text() !== want) fail('opening gave a different text than was saved'); } }
      else if (op === 'picker') { const k = pick(['font', 'tempo', 'dir']); shell.setPicker(k, pick(shell.pickers()[k])); }
    } catch (e) { if (e instanceof SoakFailure) throw e; fail(`CRASH: ${e.stack || e.message}`); }
    if (modelError) fail(`the preview's track model threw: ${modelError.stack || modelError.message}`);
    if (shell.getState().message && !committed) stats.refused++;
    stats.ops++; stats.byOp[op] = (stats.byOp[op] || 0) + 1;
    const after = text();
    // AN EDIT THAT LEAVES THE DOCUMENT UNRESOLVABLE (the shell commits it and says why in resolveError; A's, routed in the
    // D175 hand-back): counted, the first kept with its op, and then UNDONE as a user would, the undo checked byte-exact,
    // so the rest of the soak goes on exercising a track that resolves.
    if (shell.getState().resolveError && committed) {
      stats.unresolvedOps++; if (!stats.firstUnresolved) stats.firstUnresolved = { index: i, op, error: shell.getState().resolveError.slice(0, 200) };
      shell.undo(); if (text() !== before) fail('undoing an edit that tore the document is not byte-identical'); stats.undoChecks++;
      continue;
    }
    // any OTHER op that leaves it torn (a redo re-applying a torn edit, an open of a torn save): undo until it resolves,
    // as a user would, so the soak keeps exercising a track that resolves (the first 10k run did not, and is void)
    if (shell.getState().resolveError) {
      stats.tornAfterOther++;
      for (let k = 0; k < 20 && shell.getState().resolveError; k++) shell.undo();
      if (shell.getState().resolveError) { shell.newDoc(); }
      continue;
    }
    if (shell.getState().resolved && shell.getState().resolved.segments.length) stats.geometryOps++;
    if (D.serialize(D.parse(after)) !== after) fail('the document does not round-trip through its text');
    if (committed) {
      stats.committed++; committing++;
      if (committing % 25 === 0) {                     // byte-identical undo, and redo back
        shell.undo(); if (text() !== before) fail('undo is not byte-identical to the document before the edit');
        shell.redo(); if (text() !== after) fail('redo does not restore the edit byte for byte');
        stats.undoChecks++;
      }
    }
    if (modelError) fail(`the preview's track model threw: ${modelError.stack || modelError.message}`);
    if ((i + 1) % fullEvery === 0) { const d = sameAsFull(model, shell.getState().resolved); if (d) fail(`the incremental preview differs from a full build: ${d}`); stats.fullChecks++; }
    if ((i + 1) % 50 === 0 && shell.getState().resolved && shell.getState().resolved.segments.length) {
      const segs = shell.getState().resolved.segments;
      try { validate(G.buildPath(segs, { step: STEP, closed: !!shell.getState().resolved.closed }), segs, { csp: true }); stats.validations++; } catch (e) { fail(`validate threw: ${e.stack || e.message}`); }
    }
    if (!quiet && (i + 1) % 1000 === 0) log(`soak: ${i + 1}/${ops} ops, ${words().length} words, ${stats.committed} committed, ${stats.undoChecks} undo checks`);
  }
  // and always once at the end, so a short soak checks the geometry too
  const d = sameAsFull(model, shell.getState().resolved); if (d) throw new SoakFailure(seed, ops, 'end', `the incremental preview differs from a full build: ${d}`);
  stats.fullChecks++;
  return { seed, ...stats, finalWords: words().length };
}

if (require.main === module) {
  const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };
  const t0 = Date.now();
  runSoak({ seed: arg('--seed', 1), ops: arg('--ops', 10000), maxWords: arg('--max-words', MAX_WORDS), quiet: argv.includes('--quiet'), log: (s) => console.log(s) })
    .then((r) => { console.log(JSON.stringify({ ...r, seconds: +((Date.now() - t0) / 1000).toFixed(1) })); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
module.exports = { runSoak, SoakFailure, sameAsFull, prng, OPS, MAX_WORDS };
