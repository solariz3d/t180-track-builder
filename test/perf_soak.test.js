// perf_soak.test.js: node --test --test-concurrency=4 test/perf_soak.test.js. The soak (scripts/soak.js), short in the
// default suite. THE FULL SOAK, under the heavy-run lock:
//   T180_SOAK=10000 node --test --test-concurrency=4 test/perf_soak.test.js        (T180_SOAK_SEED to change the seed)
// Stated before the first run: no crash; every intermediate document round-trips; undo byte-identical where checked;
// save and open give the same text; the incremental preview equals a full build at the end; and a failure's message
// names the seed and the op index and gives the command that replays it.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const R = path.join(__dirname, '..');
const { runSoak, SoakFailure } = require(path.join(R, 'scripts/soak.js'));
const D = require(path.join(R, 'src/doc/index.js'));

const FULL = Number(process.env.T180_SOAK || 0), SEED = Number(process.env.T180_SOAK_SEED || 1);

test(`soak: ${FULL || 60} seeded random edits${FULL ? ' (the FULL soak)' : ''}: no crash, round-trips, byte-exact undo, save/open, preview = full build`, { timeout: FULL ? 7200000 : 120000 }, async () => {
  const r = await runSoak({ seed: FULL ? SEED : 7, ops: FULL || 60, maxWords: 6, fullEvery: FULL ? 250 : 10 });
  console.log(`# soak ${JSON.stringify(r)}`);
  assert.equal(r.ops, FULL || 60);
  assert.ok(r.committed > 0 && r.undoChecks > 0 && r.fullChecks > 0, 'the checks actually ran');
  // COVERAGE: a soak spent on a torn (unresolvable) document tests nothing; the first 10k run did exactly that, and passed
  assert.ok(r.geometryOps >= 0.8 * r.ops, `only ${r.geometryOps} of ${r.ops} ops ran on a track that resolves`);
});
test('soak: a failure names the seed and the op index, and gives the command that replays it', () => {
  const e = new SoakFailure(42, 1337, 'sculpt', 'undo is not byte-identical');
  assert.match(e.message, /seed 42, op #1337 \(sculpt\)/);
  assert.match(e.message, /replay: node scripts\/soak\.js --seed 42 --ops 1338/);
});
// FOUND BY THE SOAK, routed to A (src/doc, app/shell.js): a sculpt of a word's END ROLL to a value inside its own range
// is committed, and leaves the document unable to resolve ("ROLL_STEP … the surface would tear"). The shell's contract is
// "A FAILED ACTION changes nothing and says why". Either the edit is refused, or the next word follows; A's call.
test('A: a sculpt that would tear the surface is refused, or the document still resolves', async () => {
  const { createShell } = require(path.join(R, 'app/shell.js'));
  const st = { saveDoc: async () => {}, openDoc: async () => null, listDocs: async () => [], saveLibrary: async () => {}, openLibrary: async () => null, saveAutosave: async () => {}, openAutosave: async () => null };
  const s = await createShell({ storage: st, autosaveMs: 0 });
  s.place('straight'); s.place('straight');
  const before = D.serialize(s.getState().history.present);
  s.sculpt('w1', { handles: { roll1: 0.74 } });
  const refused = s.getState().message && D.serialize(s.getState().history.present) === before;
  assert.ok(refused || !s.getState().resolveError, `committed and unresolvable: ${s.getState().resolveError}`);
});

// D179 (routed by A, p-d179-soakfix-A §1): since the phrasebook a top-level entry can be a PHRASE, which the soak must not
// sculpt as a word (the shell and the handles panel do not edit a phrase's words). The shortest of A's three reproducers.
test('soak: a phrase in the track is not sculpted as a word (seed 17, 29 ops: NO_SUCH_WORD before D179)', async () => {
  const r = await runSoak({ seed: 17, ops: 29, maxWords: 6, fullEvery: 10 });
  assert.equal(r.ops, 29);
});

test('soak: --progress holds the LAST op begun, with its index, its name and the memory (D181: a native crash prints nothing)', async () => {
  const fs = require('fs'), os = require('os');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't180-soak-')), 'progress.txt');
  await runSoak({ seed: 7, ops: 12, maxWords: 6, fullEvery: 10, progress: f });
  assert.match(fs.readFileSync(f, 'utf8'), /^11 (place|sculpt|undo|redo|removeHead|save|open|picker) rss=\d+\.\d heap=\d+\.\d external=\d+\.\d arrayBuffers=\d+\.\d\n$/);
});
