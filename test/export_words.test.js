// Tests for src/export/fromwords.js and scripts/export_words.js: a document of words becomes an AC track folder,
// through A's resolve and closeLoop, C's geometry, E's validation, T1's kn5 writer and the export files. No game.
// node --test, no dependencies. The sample loop is closed once by A's connector (about 20 s), then reused.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const D = require('../src/doc/index.js');
const { closeLoop } = require('../src/doc/connector.js');
const { exportTrack, ExportError, MARKER_FILE } = require('../src/export/fromwords.js');
const { readAiLine } = require('../src/export/ailine.js');
const { readKn5 } = require('../tools/kn5.cjs');

const REPO = path.resolve(__dirname, '..');
// CHANGED 2026-09-27 (D170 follow-up): every test here runs with the self-check ON (the default). The OPTS workaround
// (selfCheck: false) is gone: C fixed the BVH's false crossings at source (src/geom/bvh.js, p-d170-look-ghost-C §0).
const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-export-test-')); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

// A document's speed is m/s (its text form is speedKmh, src/doc/serial.js).
const kmh = (v) => v / 3.6;
const withSpeed = (doc, speed) => doc.words.reduce((d, w) => D.editWord(d, w.id, { speed }), doc);
/** The sample: two straights, a tight word shortened to 50 m, a straight, a tight word, closed by the shortest
 *  candidate A's connector offers, every word at 200 km/h. The tight words are bowls with a 60° wall (vocab default). */
function sampleDoc() {
  let d = D.createDoc('Sample Loop');
  for (const w of ['straight', 'straight', 'tight', 'straight', 'tight']) d = D.appendWord(d, w, { speed: kmh(200) });
  d = D.editWord(d, 'w3', { handles: { length: 50 } });
  const c = closeLoop(d);
  assert.ok(c.candidates.length, c.reason);
  return withSpeed(c.candidates.slice().sort((a, b) => a.lengthM - b.lengthM)[0].doc, kmh(200));
}
const SAMPLE = sampleDoc();

let sample;   // one export of the sample, shared by the read-only tests below
test('the sample exports: the kn5 reads back through tools/kn5.cjs with every AC_ marker', () => {
  const out = tmp();
  sample = { out, r: exportTrack(SAMPLE, { outDir: out }) };
  const f = sample.r.folders[0];
  assert.strictEqual(f.folder, 't180b_sample_loop');
  const back = readKn5(path.join(f.dir, 't180b_sample_loop.kn5'));
  const names = back.dummies.map((d) => d.name).filter((n) => /^AC_/.test(n)).sort();
  assert.deepStrictEqual(names, ['AC_HOTLAP_START_0', 'AC_PIT_0', 'AC_PIT_1', 'AC_START_0', 'AC_START_1', 'AC_START_2', 'AC_START_3', 'AC_TIME_0_L', 'AC_TIME_0_R']);
  // and the export's own read-back, taken before the folder was written, saw the same markers
  assert.deepStrictEqual(sample.r.readback.dummies.filter((n) => /^AC_/.test(n)).sort(), names);
});

test('ui_track.json pitboxes equals the AC_PIT_n count in the written kn5', () => {
  const f = sample.r.folders[0];
  const ui = JSON.parse(fs.readFileSync(path.join(f.dir, 'ui', 'ui_track.json'), 'utf8'));
  const pits = readKn5(path.join(f.dir, 't180b_sample_loop.kn5')).dummies.filter((d) => /^AC_PIT_\d+$/.test(d.name)).length;
  assert.strictEqual(+ui.pitboxes, pits);
});

test('the folder holds every file of a track, and nothing it did not list', () => {
  const f = sample.r.folders[0];
  const want = ['t180b_sample_loop.kn5', 'data/surfaces.ini', 'models.ini', 'ui/ui_track.json', 'ui/preview.png', 'ui/outline.png', 'map.png', 'data/map.ini', 'ai/fast_lane.ai'];
  assert.deepStrictEqual(f.files.slice().sort(), want.slice().sort());
  const onDisk = [];
  (function walk(d, rel) { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name), rel + e.name + '/') : onDisk.push(rel + e.name); })(f.dir, '');
  assert.deepStrictEqual(onDisk.sort(), [...want, MARKER_FILE].sort());
});

test('the AI line runs the whole loop: its length is the path length within 0.5% (tolerance stated before the run)', () => {
  const line = readAiLine(fs.readFileSync(path.join(sample.r.folders[0].dir, 'ai', 'fast_lane.ai')));
  const L = line.points[line.points.length - 1].length + line.extra[line.extra.length - 1].length;
  assert.ok(Math.abs(L - sample.r.lengthM) / sample.r.lengthM < 0.005, `${L} vs ${sample.r.lengthM}`);
});

test('the AI line runs at the design speed when every word has one (200 km/h here)', () => {
  const line = readAiLine(fs.readFileSync(path.join(sample.r.folders[0].dir, 'ai', 'fast_lane.ai')));
  assert.ok(line.extra.every((e) => Math.abs(e.speed - 200 / 3.6) < 1e-3), line.extra[0].speed);
});

test('the markers stand on the start straight, pole nearest the line, the hotlap start behind every slot', () => {
  const m = Object.fromEntries(sample.r.markers.map((x) => [x.name, x]));
  const line = m.AC_TIME_0_L.s;
  assert.strictEqual(m.AC_TIME_0_R.s, line);
  const order = ['AC_START_0', 'AC_START_1', 'AC_START_2', 'AC_START_3', 'AC_PIT_0', 'AC_PIT_1', 'AC_HOTLAP_START_0'].map((n) => m[n].s);
  for (let k = 1; k < order.length; k++) assert.ok(order[k] < order[k - 1], order.join(' '));
  assert.ok(order[0] < line);
});

test('a red document is refused, the reason named, and nothing written (the 60° bowl walls, for vanilla AC)', () => {
  const out = tmp();
  assert.throws(() => exportTrack(SAMPLE, { outDir: out, csp: false }), (e) => e instanceof ExportError && e.code === 'RED'
    && e.red.some((r) => r.reason === 'steep-without-raycast') && /steep-without-raycast/.test(e.message));
  assert.deepStrictEqual(fs.readdirSync(out), []);
});

// CHANGED 2026-09-27 (D170): was 300 km/h. Validation then measured a jump one station long (a 12 m gap as 13 m), and
// the 6.3 g landing needed about 311 km/h. Measured from the lip, it needs 287 km/h (D170 hand-back §2), so 300 now
// lands it, and the jump is taken at 250 km/h instead: still below what the 6.3 g landing needs.
test('a lap the proof fails is refused: a jump taken below the speed its 6.3 g landing needs, each failing point named', () => {
  let d = D.createDoc('Jump Loop');
  for (const w of ['straight', 'straight', 'jump', 'straight', 'tight', 'straight', 'tight']) d = D.appendWord(d, w, { speed: kmh(250) });
  const c = closeLoop(d);
  assert.ok(c.candidates.length, c.reason);
  const jl = withSpeed(c.candidates.slice().sort((a, b) => a.lengthM - b.lengthM)[0].doc, kmh(250));
  const out = tmp();
  assert.throws(() => exportTrack(jl, { outDir: out }), (e) => e.code === 'RED'
    && e.red.some((r) => r.reason === 'lap-proof' && r.where.some((x) => x.reason === 'jump-not-caught-6.3g'))
    && /lap-proof \[jump-not-caught-6\.3g at s \d/.test(e.message));
  assert.deepStrictEqual(fs.readdirSync(out), []);
});

test('an empty document is refused and nothing written', () => {
  const out = tmp();
  assert.throws(() => exportTrack(D.createDoc('Empty'), { outDir: out }), (e) => e.code === 'EMPTY_DOC');
  assert.deepStrictEqual(fs.readdirSync(out), []);
});

test('an open track is refused: an AC lap and the AI line need a closed loop', () => {
  const out = tmp();
  const open = D.appendWord(D.appendWord(D.createDoc('Open'), 'straight'), 'turn');
  assert.throws(() => exportTrack(open, { outDir: out }), (e) => e.code === 'OPEN_TRACK');
  assert.deepStrictEqual(fs.readdirSync(out), []);
});

test('an amber document exports, and the amber is in the warnings with its source (745 km/h through the 50 m tight)', () => {
  const r = exportTrack(withSpeed(SAMPLE, kmh(745)), { outDir: tmp() });
  assert.ok(r.warnings.some((w) => /^amber: load-above-proven .*FINDINGS\.md/.test(w)), r.warnings.join('\n'));
});

test('both variants: the same kn5 bytes, the soft-collision block only in the first, and the noblock red said', () => {
  const out = tmp();
  const r = exportTrack(SAMPLE, { outDir: out, variant: 'both' });
  assert.deepStrictEqual(r.folders.map((f) => f.folder), ['t180b_sample_loop', 't180b_sample_loop_noblock']);
  const kn5 = r.folders.map((f) => fs.readFileSync(path.join(f.dir, 't180b_sample_loop.kn5')));
  assert.ok(kn5[0].equals(kn5[1]));
  const ini = r.folders.map((f) => fs.readFileSync(path.join(f.dir, 'data', 'surfaces.ini'), 'utf8'));
  assert.deepStrictEqual(ini.map((t) => /COLLISION_PARAMS/.test(t)), [true, false]);
  assert.ok(r.warnings.some((w) => /^noblock: .*RED/.test(w)));
});

test('only block is written by default', () => {
  assert.deepStrictEqual(sample.r.folders.map((f) => f.variant), ['block']);
  assert.ok(!sample.r.warnings.some((w) => /^noblock/.test(w)));
});

test('a folder this builder did not write is refused, untouched', () => {
  const out = tmp(), dir = path.join(out, 't180b_sample_loop');
  fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'theirs.txt'), 'x');
  assert.throws(() => exportTrack(SAMPLE, { outDir: out }), (e) => e.code === 'NOT_OURS');
  assert.deepStrictEqual(fs.readdirSync(dir), ['theirs.txt']);
});

test('turning the self-check off is said in the warnings', () => {
  // this one tests the switch itself, so it turns it off by name
  const r = exportTrack(SAMPLE, { outDir: tmp(), selfCheck: false });
  assert.ok(r.warnings.some((w) => /self-intersection NOT checked/.test(w)));
});

test('the CLI writes the folder from a document file, and refuses an empty one with exit 1', () => {
  const dir = tmp(), file = path.join(dir, 'sample.json'), empty = path.join(dir, 'empty.json'), out = path.join(dir, 'out');
  fs.writeFileSync(file, D.serialize(SAMPLE)); fs.writeFileSync(empty, D.serialize(D.createDoc('Empty')));
  const ok = spawnSync(process.execPath, ['scripts/export_words.js', file, '--out', out], { cwd: REPO, encoding: 'utf8' });
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.ok(fs.existsSync(path.join(out, 't180b_sample_loop', 't180b_sample_loop.kn5')));
  const bad = spawnSync(process.execPath, ['scripts/export_words.js', empty, '--out', out], { cwd: REPO, encoding: 'utf8' });
  assert.strictEqual(bad.status, 1); assert.match(bad.stderr, /EMPTY_DOC/);
});

// Was todo until D167's landing: C's BVH reported crossings its own rules exclude while a word's parts shared one cell
// name (INTERFACES §2 DEFECT). Pieces are now named by (id, part) in src/geom/mesh.js safeId, so it runs for real. It
// also asserts the defect's two symptoms are gone: no repeated node names, and the self-check was actually run.
test('with the self-check on (the default), the sample exports', () => {
  const r = exportTrack(SAMPLE, { outDir: tmp() });
  assert.ok(r.folders.length >= 1);
  const w = r.warnings || [];
  assert.ok(!w.some((x) => /names repeat/.test(x)), `repeated node names: ${w.join(' | ')}`);
  assert.ok(!w.some((x) => /self-intersection NOT checked/.test(x)), 'the self-check must have run');
});

test('the §5c marker checks guard the output: markers 3 m above the road (band 1–2 m) are refused, nothing written', () => {
  const out = tmp();
  assert.throws(() => exportTrack(SAMPLE, { outDir: out, height: 3 }), (e) => e.code === 'MARKERS' && /3\.00 m above the surface \(1–2 m required\)/.test(e.message));
  assert.deepStrictEqual(fs.readdirSync(out), []);
});

test('a grid longer than the longest straight is refused with the lengths named', () => {
  const out = tmp();
  assert.throws(() => exportTrack(SAMPLE, { outDir: out, grid: 20 }), (e) => e.code === 'NO_START_STRAIGHT' && /the longest straight is \d+\.\d m; a grid of 20/.test(e.message));
  assert.deepStrictEqual(fs.readdirSync(out), []);
});

test('one station per s: the closed loop does not repeat s = 0 at its end', () => {
  const { buildPath } = require('../src/geom/index.js');
  const { stations } = require('../src/export/fromwords.js')._internal;
  const segs = D.resolve({ ...SAMPLE, closed: false }).segments, p = buildPath(segs, { step: 2, closed: true });
  const st = stations(p);
  assert.strictEqual(p.samples.length, st.length + 1);   // the raw closed path does carry its return to s = L
  for (let i = 1; i < st.length; i++) assert.ok(st[i].s > st[i - 1].s, `station ${i} at s ${st[i].s}`);
  assert.ok(st[st.length - 1].s < p.lengthM - 1e-6);
});
