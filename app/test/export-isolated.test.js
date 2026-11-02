// export-isolated.test.js: node --test app/test/export-isolated.test.js
// THE EXPORT OFF THE PAGE. The user's white window (2026-10-22 19:38) was the page's renderer dying of a V8 heap out-of-memory inside the
// export: the export ran synchronously on the page's main thread (coreshell.js buildExport into
// export.js runSegments), so when it ran out of memory the page went with it. The export now runs in its own process when the page has one to
// give (app/export/exportrunner.js: a sandboxed iframe, which Chromium puts in a process of its own, with the export in a worker inside it; a
// bare Web Worker shares the page's process and a heap OOM there kills the page too, measured in headless Chrome and Edge 155), and ends with a
// message naming the stage when it fails or its process dies. Nothing is written until the export has fully succeeded. Rows:
//   1  the export's bytes are b6969da's (the synchronous path, kept for the layouts export and the tests), a textured lap with a pit lane and an
//      open TEST export; the folders' files hashed, the ownership marker's `written` time left out
//   2  through the runner, every message structured-cloned both ways (as a postMessage does), the same two exports give the same bytes
//   2b a LIFTED lap (a 1 m hill brushed in, so the core's offset lift is not the identity) gives the same bytes through the runner as on the page
//   3  an export that THROWS inside the host: Export and Export to Assetto Corsa both write nothing, the AC folder is byte-identical, and the
//      message names the stage and the reason
//   4  an export whose host DIES (stops answering, as a process killed by a heap OOM does): the same, and the message says it ran out of memory
//      building that stage; the next export gets a fresh host and succeeds
//   5  the runner: one job at a time (a newer start cancels the older), a reply that is not the current job's is ignored, cancel replaces the host
//   6  an export the exporter REFUSES inside the host (an author name too long) is the same ExportError the page's own export throws: its name, code and
//      words; and the host is kept for the next export (a refusal is an answer, not a failure)
// The real host (the sandboxed iframe and its worker, a real heap OOM, the page still drawn) is app/test/export-isolated-page.test.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { createCoreShell } = require('../core/coreshell.js');
const { makeExporter } = require('../export/export.js');
const { createCoreTextures } = require('../core/textures.js');
const D = require('../../src/core/document.js');
const FW = require('../../src/export/fromwords.js');

const REPO = path.resolve(__dirname, '..', '..');
const fromDisk = async (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-d437b-')); made.push(d); return d; };
const R = 180, Q = Math.PI * R / 2;
const AUTHOR = () => 'D437b test';

/** The test lap (core-pitlane.test.js's): a 600 m start straight, four quarter turns, 60 m, closed; with a pit lane on the right. */
async function pitLap(opts) {
  const s = await createCoreShell({ brushFn: null, autosaveMs: 0, ...opts });
  s.extend({ length: 600, family: 'bowl' });
  for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  s.extend({ length: 60, transition: 40, targets: { kh: 0 } });
  s.close();
  assert.equal(s.getState().history.present.closed, true, s.getState().message);
  s.setPitLane({ ...D.PIT_DEFAULT, side: 'R', leave: { word: 'p1', along: 60 }, rejoin: { word: 'p1', along: 540 } });
  assert.equal(s.spawnsInfo().laneError, null);
  return s;
}
/** An unfinished lap, for the TEST export: the straight and two quarter turns, open. */
async function openRun(opts) {
  const s = await createCoreShell({ brushFn: null, autosaveMs: 0, ...opts });
  s.extend({ length: 300, family: 'bowl' });
  for (let i = 0; i < 2; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  return s;
}
/** The road surface the page exports by default: the asphalt preset, edge fit on (app/core/textures.js). */
const asphaltOf = (s) => createCoreTextures({ segments: () => s.getState().resolved.segments, closed: () => !!s.getState().resolved.closed, edge: true }).current();
/** One digest of every file of every folder an export made, in order; the ownership marker's write time is the clock's, not the export's. */
function digestOf(out) {
  const h = crypto.createHash('sha256'); let n = 0;
  for (const f of out.folders) for (const file of f.files) {
    let b = Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength);
    if (file.path.endsWith(FW.MARKER_FILE)) b = Buffer.from(b.toString('utf8').replace(/"written": "[^"]*"/, '"written": "-"'));
    h.update(`${f.folder}/${file.path}\0${b.length}\0`); h.update(b); n++;
  }
  return `sha256 ${h.digest('hex').slice(0, 16)} files ${n}`;
}
// b6969da's bytes for the two exports, from row 1 run there (node --test --test-name-pattern="row 1" app/test/export-isolated.test.js, PRINT_D437B=1)
// local-0.4.15: the lap pin moved from b6969da's 00588932b76e738a to 36ba2c6869a3d1d0 because a pit lane change (9233a93,
// src/geom/pitlane.js, the pit lane level from leave to rejoin) changes the lap's pit lane; pitlane.js put back to 9861c69's gives 00588932
// again, so the isolation did not move it. The open TEST export has no pit lane and is unchanged. The row titles still say b6969da's;
// they are left as they are because the mutation harness names its rows by them.
// Later: the lap pin moved from 36ba2c6869a3d1d0 (v0.4.19, 496c347, read there with PRINT_D437B=1) to 9f3a7040bf4356e9 because the seam
// zipper pairs by lateral position (src/geom/mesh.js meshSeam) and the weld drops a standing seam triangle (src/export/acready.js); the lap's seams change
// their index arrays only (compared mesh by mesh). The open TEST export is unchanged.
// AMENDED BY NAME (2026-10-31, the merge of the firm road and the edge apron): both pins moved from ab7ea68c80621a84 / b59349993f6e9440 (the firm
// road alone) and from ace32da6e9890964 / bfb1bda31e289ce1 (the apron alone) to the values below, because the merged exporter writes both: data/surfaces.ini's
// soft block with SOFT_CFM=0.00005 (src/export/trackfiles.js) and an edge apron outside the road's open edges (src/export/apron.js). Each alone was proven the
// only cause of its own move against 9f3a7040bf4356e9 / a257c20e84e68897; the pair below was read with PRINT_D437B=1 on the merged tree.
// AMENDED BY NAME (2026-11-01, D593, the apron reads as part of the road): both pins moved from 257d550e6870bdf1 / 2b6ad34e0f135050 (a93ae51, read there with
// PRINT_D437B=1) to the values below. Compared with a93ae51 node by node and material by material (test/fixtures/kn5nodes.js), in both exports: every road
// physics, paint and edge-apron node (the plank and its join) is the same bytes, and the materials are the same names in the same order, of which only t180b_apron's
// own record changed: it is now the road's own asphalt a little darker (the road material's texture, its ambient, diffuse and specular at 0.88). On the lap only: the
// pit lane's in, out and fill surfaces (its taper starts 0.5 m wide, src/geom/pitlane.js TAPER_MIN_W, and its uvs follow its width), its new skins and its
// outline's drawn plank and join (1ROAD_APRON_PIT_R, APRONSIDE_PIT_R), the road skin's vertices within 0.5 m of the lane hung again, and the map (data/map.ini,
// map.png, ui/outline.png) 2 m wider on the lane's side, where that plank lies. The file counts are the same. (Two pairs between, 60e346e18df0144b / 7b587edcbcefc314
// and 0e8de6cd745039cb / 4dba6b610fc6010e, carried a drawn lip over a hidden plank and then a filled side face; both were removed at the user's word, 2026-10-31
// 21:54-21:58.)
// AMENDED BY NAME (2026-11-01, D604, the road a solid slab): both pins moved from 74130c5b646222a5 / e15aed9879bf1ca0 (8b573dd, read there with PRINT_D437B=1) to the
// values below, because the underside skin now follows the road at the apron plank's drop (0.93 m, was 0.5 m) and wears the road's asphalt at 0.88, so each apron's
// join is the slab's bottom. Compared with 8b573dd node by node and material by material (test/fixtures/kn5nodes.js), in both exports: the road physics, the paint,
// every physics plank and the lane's own surfaces are the same bytes; the skins (UNDERSKIN_*, the lane's too) and the joins (APRONSIDE_*, the outline's too) moved;
// of the materials only t180b_underskin's own record changed. Only the kn5 files changed; the file counts are the same.
// AMENDED BY NAME (2026-11-01, D604 redo, the user 10:32: "the apron itself connects right to the other one without having an extra thicker bottom than we need"):
// both pins moved again, from 099861d8a5eac6ec / caa673fa562c20af to the values below: the skin hangs along each row's section up (the plank's own drop) and each
// plank's run under it is in the skin's mesh, so the core join nodes are gone into the skins. Compared with 8b573dd node by node (test/fixtures/kn5nodes.js), in both
// exports: the road physics, the paint, every physics plank and the lane's own surfaces are the same bytes; the skins and the pit outline's join moved; the core
// joins (APRONSIDE_p*) are gone. Only the kn5 files changed; the file counts are the same.
// And again for the hull (the user's red line, 10:44: the bottom one smooth curve from tip to tip, 1.5 m under the road, deeper under an edge that rises): the
// same comparison holds, with the skins and the pit outline's run as the hull's.
// AMENDED BY NAME (2026-11-02, the notch the user marked at the pit's rejoin, "looks small but is fatal", and the seam under its leave): the lap pin moved from
// 7048f2db72b8191c (e911792) to the value below; the open pin is unchanged. The lane's ends are 0.1 m wide again (src/geom/pitlane.js TAPER_MIN_W; 0.5 m since
// 8fb6ecc made the step), the outline's plank no longer walks across the lane's end (a fan in the road's plane covers it), and the hull eases out to the plain
// depth beside the lane (apron.js padEase). Compared with e911792 node by node (test/fixtures/kn5nodes.js): the road physics, the paint and every other physics plank
// are the same bytes; the lane's in, out and fill surfaces and their skins, the outline's plank and run (1ROAD_APRON_PIT_R, APRONSIDE_PIT_R) and three road skins
// beside the lane moved; of the lap's files the kn5, map.png and ui/outline.png changed (the lane's ends narrower); the counts are the same.
// AMENDED BY NAME again (2026-11-02, the tube's joints and openings, the tube test): the lap pin moved from 03d805db106b31b6 (a48e41e) to the value below; the open
// pin is unchanged. A skin hangs by its section's middle, and a row on a seam keeps every column (src/export/underskin.js). Compared with a48e41e node by node: every
// physics node, the paint, the lane and the outline are the same bytes; two drawn skins moved (UNDERSKIN_p1_chunk_0, UNDERSKIN_p5_chunk_3); only the kn5 changed.
// AMENDED BY NAME again (2026-11-02, the apron hung from the road's own centre line and the underside swept evenly from each plank's tip): both pins moved from
// 4dd44dff31b0a8f9 / 50248bc3a07ddd32 (f1f3416) to the values below. The skin and the planks take their section from the column on the centre line, not the middle
// column by count, each plank's run into the skin is an even arc from its tip, and the pit outline's plank and run follow the same arc. Compared with f1f3416 node by
// node: the road physics, the paint and every road plank are the same bytes; the lap's four road skins and the outline's plank and run (1ROAD_APRON_PIT_R,
// APRONSIDE_PIT_R) moved, and the open run's three skins; of each export's files only the kn5 changed; no node or material was added, removed or changed.
const PIN = { lap: 'sha256 d89c835f5f103a8c files 10', open: 'sha256 4e1404430764e540 files 11' };

test('row 1: the export\'s bytes are b6969da\'s, a textured lap with a pit lane and an open TEST export', async () => {
  const ex = await makeExporter(fromDisk, { author: AUTHOR });
  const s = await pitLap({ exporter: ex }), lap = digestOf(s.buildExport({ textures: asphaltOf(s) }));
  const o = await openRun({ exporter: ex }), open = digestOf(o.buildExport({ test: true }));
  if (process.env.PRINT_D437B) console.log('D437B PIN', JSON.stringify({ lap, open }));
  assert.deepEqual({ lap, open }, PIN);
});

// ---- the runner, with a host that does what the sandboxed iframe does: its own thread answers pings, and the export runs in a worker beside it ----
const { Worker } = require('worker_threads');
// The worker: app/export/exportjob.js through the app's own loader (app/lib/cjs.js) and the node shim, from the disk, as app/export/exportworker.js loads it from
// its boot texts; then the same job loop. `fail` puts a fault at one stage: 'throw' (an ordinary error, which the worker reports) or 'die' (it tells the host,
// which goes silent at once, pings included, and ends the thread: as a process killed by a heap out-of-memory ends, right after the stage it last said).
const JOB_THREAD = `
const { parentPort, workerData } = require('worker_threads'), fs = require('fs'), path = require('path');
const { loadCjs } = require(workerData.cjs), get = async (p) => fs.readFileSync(path.join(workerData.repo, p), 'utf8');
const R = (async () => { const J = await loadCjs('app/export/exportjob.js', get); return { J, env: await J.loadEnv(loadCjs, get) }; })();
parentPort.on('message', async (m) => {
  const { J, env } = await R, fail = workerData.fail; let stage = J.STARTING;
  try {
    const out = J.runJob(env, m.job, (st) => {
      stage = st; parentPort.postMessage({ serial: m.serial, stage: st });
      if (fail && fail.at === st) { if (fail.how === 'die') { parentPort.postMessage({ died: true }); for (;;) { /* until the host ends this thread */ } } throw new Error('a fault the test put here'); }
    });
    parentPort.postMessage({ serial: m.serial, ok: true, out }, J.transferOf(out));
  } catch (e) { parentPort.postMessage({ serial: m.serial, ok: false, error: J.errorOf(e, stage) }); }
});`;
const threads = [];
test.after(() => Promise.all(threads.map((w) => w.terminate())));
/** Hosts for createExportRunner({ makeHost }); every one made is kept in `hosts`, with what it was sent. */
function cloneHosts({ fail = null } = {}) {
  const hosts = [];
  const makeHost = () => {
    const w = new Worker(JOB_THREAD, { eval: true, workerData: { repo: REPO, cjs: path.join(REPO, 'app/lib/cjs.js'), fail } });
    w.unref(); threads.push(w);   // a warm host does not hold the test process open; test.after ends them all
    const h = { dead: false, destroyed: false, sent: [], onmessage: null };
    const deliver = (m) => { if (!h.dead && !h.destroyed && h.onmessage) h.onmessage(m); };
    w.on('message', (m) => { if (m && m.died) { h.dead = true; w.terminate(); return; } deliver(m); });
    w.on('error', (e) => deliver({ hostError: e.message }));
    h.post = (msg) => {
      h.sent.push(structuredClone(msg));
      if (h.dead || h.destroyed) return;
      if (msg.ping !== undefined) return setImmediate(() => deliver({ pong: msg.ping }));   // the host's own thread answers, as the iframe's page does
      w.postMessage(msg);
    };
    h.destroy = () => { h.destroyed = true; w.terminate(); };
    hosts.push(h);
    return h;
  };
  return { makeHost, hosts };
}
const quick = { pingMs: 20, lostMs: 400 };   // the real host is pinged every second and lost after 8 s of silence; here, milliseconds
const live = [];   // every run started, cancelled at the end: a run that never settles (a broken runner) must not hold the test process open
test.after(() => { for (const r of live) r.cancel(); });
const watched = (runner) => { const start = runner.start; runner.start = (a) => { const r = start(a); live.push(r); r.promise.catch(() => {}); return r; }; return runner; };
async function isolatedExporter(hostOpts) {
  const { createExportRunner } = require('../export/exportrunner.js');
  const H = cloneHosts(hostOpts);
  const runner = watched(createExportRunner({ makeHost: H.makeHost, ...quick }));
  return { ex: await makeExporter(fromDisk, { author: AUTHOR, runner }), H, runner };
}

test('row 2: through the runner (every message structured-cloned) the textured lap and the open TEST export are the same bytes', async () => {
  const { ex, H } = await isolatedExporter();
  const s = await pitLap({ exporter: ex }), lap = digestOf(await s.buildExportAsync({ textures: asphaltOf(s) }));
  const o = await openRun({ exporter: ex }), open = digestOf(await o.buildExportAsync({ test: true }));
  assert.deepEqual({ lap, open }, PIN);
  assert.equal(H.hosts.length, 1, 'one host, kept warm between exports');
  assert.equal(H.hosts[0].sent.filter((m) => m.job).length, 2, 'both exports ran in the host');
});

test('row 2b: a LIFTED lap (a 1 m hill, the offset lift of the core not the identity) gives the same bytes through the runner as on the page', { timeout: 120000 }, async () => {
  const SC = require('../../src/core/sculpt.js'), { ex } = await isolatedExporter();
  const s = await createCoreShell({ brushFn: SC.brush, autosaveMs: 0, exporter: ex });
  s.extend({ length: 300, family: 'bowl' }); for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } }); s.extend({ length: 60, transition: 40, targets: { kh: 0 } }); s.close();
  const flat = digestOf(s.buildExport());
  // 1 m over r 140 inside the 300 m straight: a crest the car holds (core-shell.test.js's landed-core hill)
  s.beginBrush({ channel: 'height', s0: 150, r: 140 }); s.brushTo(1); s.endBrush();
  assert.equal(s.getState().history.present.closed, true, s.getState().message);
  const page = digestOf(s.buildExport()), isolated = digestOf(await s.buildExportAsync());
  assert.notEqual(page, flat, 'control: the hill is in the export');
  assert.equal(isolated, page);
});

/** An Assetto Corsa folder in a temp directory, holding a track the builder exported before (its folder and its ownership marker). */
function acFolder() {
  const root = path.join(tmp(), 'assettocorsa'), tracks = path.join(root, 'content', 'tracks'), old = path.join(tracks, 't180b_untitled');
  fs.mkdirSync(path.join(old, 'ai'), { recursive: true });
  fs.writeFileSync(path.join(old, 't180b_untitled.kn5'), Buffer.from('the kn5 of an earlier export'));
  fs.writeFileSync(path.join(old, 'ai', 'fast_lane.ai'), Buffer.from([1, 2, 3, 4]));
  fs.writeFileSync(path.join(old, FW.MARKER_FILE), '{ "tool": "t180-track-builder" }\n');
  fs.mkdirSync(path.join(tracks, 'ks_monza'), { recursive: true }); fs.writeFileSync(path.join(tracks, 'ks_monza', 'monza.kn5'), Buffer.from('not ours'));
  return { root, tracks };
}
/** Every file and folder under `dir`, with its bytes' digest: equal before and after means the folder is byte-identical. */
function treeOf(dir) {
  const out = [];
  (function walk(d) { for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n), st = fs.statSync(p); if (st.isDirectory()) { out.push(`${path.relative(dir, p)}/`); walk(p); } else out.push(`${path.relative(dir, p)} ${crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}`); } })(dir);
  return out.join('\n');
}
/** storage.writeExport and the installer's native.installTrack as the native side does them, into the temp folder: every call counted. */
function writers(ac) {
  const calls = [];
  const write = (dir, folder, files) => { calls.push(folder); for (const f of files) { const p = path.join(dir, folder, f.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.bytes); } };
  return { calls, storage: { writeExport: async (dir, folder, files) => write(dir, folder, files), folderIsEmpty: async () => false, removeEmptyFolder: async () => {} },
    native: { getAcRoot: async () => ac.root, installTrack: async (folder, files) => { write(ac.tracks, folder, files); return { files: files.length }; } } };
}

for (const how of ['throw', 'die']) {
  const n = how === 'throw' ? 3 : 4;
  test(`row ${n}: an export that ${how === 'throw' ? 'throws' : 'dies'} inside its host building the pit-lane check writes nothing, leaves the AC folder byte-identical, and says the stage`, { timeout: 120000 }, async () => {
    const { createInstaller } = require('../install/install.js');
    const ac = acFolder(), before = treeOf(ac.root), W = writers(ac);
    const { ex, H } = await isolatedExporter({ fail: { at: 'building the pit-lane check', how } });
    const s = await pitLap({ exporter: ex, storage: W.storage });
    const want = how === 'throw' ? /building the pit-lane check.*a fault the test put here/ : /the export ran out of memory building the pit-lane check/;
    // Export (the folder picker's route): into content\tracks itself
    await s.exportTo(ac.tracks, { textures: asphaltOf(s) });
    assert.match(s.getState().message, want, s.getState().message);
    assert.match(s.getState().message, /nothing was written/i);
    // Export to Assetto Corsa (the user's press: app/install/index.js builds through the shell)
    const inst = createInstaller({ build: (o) => s.buildExportAsync(o), native: W.native, getDoc: () => ({ ...s.exportDoc(), name: 'untitled lap' }), getTextures: () => asphaltOf(s) });
    const r = await inst.install();
    assert.equal(r.ok, false); assert.match(r.message, want, r.message);
    assert.deepEqual(W.calls, [], 'nothing was handed to the native side to write');
    assert.equal(treeOf(ac.root), before, 'the AC folder is byte-identical');
    if (how === 'die') {
      assert.ok(H.hosts.length >= 2 && H.hosts.slice(0, -1).every((h) => h.destroyed), 'a host that died is thrown away and the next export gets a fresh one');
    }
  });
}

test('row 4b: after a host died, the next export gets a fresh host and writes the same bytes as b6969da\'s', { timeout: 120000 }, async () => {
  let dieOnce = true;
  const { createExportRunner } = require('../export/exportrunner.js');
  const dying = cloneHosts({ fail: { at: 'building the pit-lane check', how: 'die' } }), good = cloneHosts();
  const runner = watched(createExportRunner({ makeHost: () => (dieOnce ? (dieOnce = false, dying.makeHost()) : good.makeHost()), ...quick }));
  const ex = await makeExporter(fromDisk, { author: AUTHOR, runner });
  const s = await pitLap({ exporter: ex });
  await assert.rejects(s.buildExportAsync({ textures: asphaltOf(s) }), (e) => e.name === 'ExportError' && e.code === 'EXPORT_LOST' && /ran out of memory building the pit-lane check/.test(e.message));
  assert.equal(digestOf(await s.buildExportAsync({ textures: asphaltOf(s) })), PIN.lap);
  assert.equal(dying.hosts[0].destroyed, true);
});

test('row 5: the runner runs one job at a time; a newer start cancels the older; a stale reply is ignored; cancel replaces the host', async () => {
  const { createExportRunner } = require('../export/exportrunner.js');
  const hosts = [];
  const makeHost = () => { const h = { sent: [], onmessage: null, destroyed: false, post(m) { h.sent.push(structuredClone(m)); if (m.ping !== undefined) setImmediate(() => h.onmessage && h.onmessage({ pong: m.ping })); }, destroy() { h.destroyed = true; } }; hosts.push(h); return h; };
  const runner = createExportRunner({ makeHost, ...quick });
  const a = runner.start({ job: { n: 1 } }), b = runner.start({ job: { n: 2 } });
  await assert.rejects(a.promise, (e) => e.cancelled === true);
  const jobs = hosts.flatMap((h) => h.sent.filter((m) => m.job));
  assert.equal(jobs.length, 2);
  const live = hosts[hosts.length - 1];
  live.onmessage({ serial: jobs[0].serial, ok: true, out: { stale: true } });   // the cancelled job's answer, arriving late
  live.onmessage({ serial: jobs[1].serial, stage: 'writing the kn5' });
  live.onmessage({ serial: jobs[1].serial, ok: true, out: { result: { mine: true }, folders: [] } });
  assert.deepEqual(await b.promise, { out: { result: { mine: true }, folders: [] }, stage: 'writing the kn5' }, 'the current job\'s answer, with the last stage it said');
  const c = runner.start({ job: { n: 3 } }); c.cancel();
  await assert.rejects(c.promise, (e) => e.cancelled === true);
  assert.ok(hosts.filter((h) => h.destroyed).length >= 2, 'a cancel throws its host away (whatever it was computing is dropped)');
});

test('row 6: an export refused inside the host is the same ExportError as on the page, and the host is kept', { timeout: 120000 }, async () => {
  const long = 'x'.repeat(65), page = await makeExporter(fromDisk, { author: () => long });
  const p = await pitLap({ exporter: page });
  let want = null; try { p.buildExport(); } catch (e) { want = { name: e.name, code: e.code, message: e.message }; }
  assert.equal(want && want.code, 'BAD_AUTHOR', 'the page\'s own export refuses this name');
  const { createExportRunner } = require('../export/exportrunner.js');
  const H = cloneHosts(), ex = await makeExporter(fromDisk, { author: () => long, runner: createExportRunner({ makeHost: H.makeHost, ...quick }) });
  const s = await pitLap({ exporter: ex });
  let got = null; try { await s.buildExportAsync(); } catch (e) { got = { name: e.name, code: e.code, message: e.message }; }
  assert.deepEqual(got, want);
  try { await s.buildExportAsync(); } catch (e) { /* the same refusal */ }
  assert.equal(H.hosts.length, 1, 'a refusal keeps the host');
});
