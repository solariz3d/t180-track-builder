// exportjob.js: THE EXPORT AS ONE JOB THAT CROSSES A postMessage (D437b: the user's white window was the page dying of a V8 heap out-of-memory inside
// the export, which ran on the page's own thread; exo_memory/handback/p-d437-P_2026-10-22.md). The page packs the export's arguments as plain data,
// the export's own process (app/export/exportrunner.js, app/export/exportworker.js) unpacks them and runs src/export/fromwords.js exportSegments
// UNCHANGED, the same call app/export/export.js runSegments makes, so the files are the same bytes either way (app/test/export-isolated.test.js).
//
//   packJob(segments, meta, opts)        (the page) -> { segments, meta, opts }: plain data. Two things in the export's arguments are functions and cannot cross:
//     meta.liftPath  the core's offset lift (coreshell.js resolvedOf: (p) => offsetPath(doc, segments, p)); it goes as meta.liftDoc, the document it lifts by,
//                    and the far side makes the same function from src/core/adapter.js offsetPath and the same segments. A liftPath without its liftDoc throws
//     opts.textures  the texture set (src/texture/set.js): its bySegment(id) goes as the slots of every segment id the export has
//   loadEnv(loadCjs, get)                (the far side) -> env: the exporter's modules through the app's own loader and the in-memory node shim
//   runJob(env, job, onStage)            (the far side) -> { result, folders: [{ folder, files: [{ path, bytes }] }] }, as runSegments returns; onStage(words) is
//                                         told each stage as the export reaches it (fromwords.js opts.onStage)
//   errorOf(e, stage)                    a thrown error as plain data: { name, code, message, stage, red?, markerChecks? }
//   transferOf(out)                      the file bytes' buffers, each once, to transfer instead of copy (a kn5 can be 200 MB)
'use strict';

const OUT = '/export';
const STARTING = 'starting';

function packSet(set, segments) {
  const out = {};
  for (const k of Object.keys(set)) if (typeof set[k] !== 'function') out[k] = set[k];
  const ids = [...new Set((segments || []).map((g) => g && g.id).filter((id) => id !== undefined && id !== null))];
  out.slotsById = ids.map((id) => [id, set.bySegment(id)]).filter(([, v]) => v !== null && v !== undefined);
  return out;
}
function unpackSet(p) {
  const { slotsById, ...set } = p, byId = new Map(slotsById || []);
  return { ...set, bySegment: (id) => (byId.has(id) ? byId.get(id) : null) };
}

function packJob(segments, meta = {}, opts = {}) {
  const { liftPath, liftDoc, ...m } = meta;
  if (typeof liftPath === 'function' && !liftDoc) throw new Error('packJob: the export lifts its path (meta.liftPath), so it needs the document it lifts by (meta.liftDoc)');
  const o = { ...opts };
  if (o.textures) o.textures = packSet(o.textures, segments);
  return { segments, meta: typeof liftPath === 'function' ? { ...m, liftDoc } : m, opts: o };
}

async function loadEnv(loadCjs, get) {
  const shim = (await loadCjs('app/export/node-shim.js', get)).createShim();
  const with_ = { builtins: shim.builtins, globals: { Buffer: shim.Buffer } };
  const fromwords = await loadCjs('src/export/fromwords.js', get, with_);
  const adapter = await loadCjs('src/core/adapter.js', get, with_);
  return { shim, fromwords, adapter };
}

function runJob(env, job, onStage = () => {}) {
  const { shim, fromwords, adapter } = env;
  const { liftDoc, ...meta } = job.meta || {};
  if (liftDoc) {
    if (typeof adapter.offsetPath !== 'function') throw new Error('the export lifts its path, and this src/core/adapter.js has no offsetPath');
    meta.liftPath = (p) => adapter.offsetPath(liftDoc, job.segments, p);
  }
  const { variant = 'block', textures = null, markers, test = false, author } = job.opts || {};
  shim.reset();
  const result = fromwords.exportSegments(job.segments, meta, { outDir: OUT, variant, textures: textures ? unpackSet(textures) : null, markers, author, ...(test ? { test: true } : {}), onStage });
  return { result, folders: result.folders.map((f) => ({ folder: f.folder, files: shim.files(`${OUT}/${f.folder}`) })) };
}

function errorOf(e, stage) {
  const o = { name: (e && e.name) || 'Error', code: (e && e.code) || null, message: String((e && e.message) || e), stage: stage || STARTING };
  if (e && Array.isArray(e.red)) o.red = e.red;
  if (e && e.markerChecks) o.markerChecks = e.markerChecks;
  return o;
}

function transferOf(out) {
  const seen = new Set();
  for (const f of (out && out.folders) || []) for (const file of f.files || []) if (file.bytes && file.bytes.buffer) seen.add(file.bytes.buffer);
  return [...seen];
}

module.exports = { packJob, loadEnv, runJob, errorOf, transferOf, STARTING, _internal: { packSet, unpackSet } };
