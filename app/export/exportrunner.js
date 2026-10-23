// exportrunner.js: runs the export IN A PROCESS OF ITS OWN, so an export that runs out of memory ends with a message and the page stays drawn (D437b,
// the user: "figure out that crash to prevent it from ever happening"). The shape is the close runner's (app/core/closerunner.js): one warm host, a job
// at a time, every message carrying the job's serial. The HOST is not a bare Web Worker:
//   MEASURED (headless Chrome, and headless Edge 155, the engine of the user's WebView2 155.0.4283.62; exo_memory/handback/p-d437b-B_2026-10-22.md):
//   a dedicated worker shares its page's renderer process, and a V8 heap out-of-memory in the worker kills that process, page and all. A SANDBOXED iframe
//   (sandbox="allow-scripts", an opaque origin) is given a renderer process of its own, and the same out-of-memory in a worker inside it ends only that
//   process: the page answers, its canvas still drawn. So the host is a hidden sandboxed iframe, and the export runs in a worker inside it
//   (app/export/exportworker.js), which keeps the iframe's own thread free to answer pings while the export works.
//
//   const runner = createExportRunner({ document, get })      the page's document; get(path) -> the text of one of the app's files (the worker's boot)
//   runner.start({ job }) -> { promise, cancel() }             job: app/export/exportjob.js packJob(...)
//     promise  resolves { out, stage } (runJob's answer, after the postMessage) or { error, stage } (the export refused or failed inside the host: exportjob.js
//              errorOf); rejects { lost: true, stage } when the host went SILENT for lostMs while the job ran (its process died: a heap out-of-memory ends it
//              without a word), with the last stage it reported; or { cancelled: true } after cancel
//     cancel() throws the host away at once (whatever it was computing is dropped); the next job gets a fresh one. So does any failure but a refusal
//   The host is pinged every pingMs; any message from it (a pong, a stage) counts as alive.
//   createExportRunner({ makeHost }) takes any host instead: { post(msg, transfer), onmessage(data), destroy() } (the tests' in-process host).
// The constructor THROWS when there is neither a document nor a host; app/export/export.js then exports on the page, as it always did.
'use strict';

const STARTING = 'starting';

// The sandboxed frame's own page: it answers pings, makes the worker from the text it is sent, and passes messages both ways (the file bytes transferred).
// It reaches the page only by postMessage, to the page's origin, which the boot message carries.
const RELAY = `<!doctype html><meta charset="utf-8"><script>
'use strict';
let w = null, to = '*';
const moved = (m) => { const s = new Set(); if (m && m.out && m.out.folders) for (const f of m.out.folders) for (const x of f.files || []) if (x.bytes && x.bytes.buffer) s.add(x.bytes.buffer); return [...s]; };
addEventListener('message', (e) => {
  if (e.source !== parent) return;
  const m = e.data || {};
  if (m.ping !== undefined) { parent.postMessage({ pong: m.ping }, to); return; }
  if (m.boot) {
    to = m.boot.origin || '*';
    w = new Worker(URL.createObjectURL(new Blob([m.boot.worker], { type: 'text/javascript' })));
    w.onmessage = (x) => parent.postMessage(x.data, to, moved(x.data));
    w.onerror = (x) => { x.preventDefault(); parent.postMessage({ hostError: String(x.message || 'the export worker failed') }, to); };
    w.postMessage({ boot: m.boot.sources });
    return;
  }
  if (w) w.postMessage(m);
});
parent.postMessage({ relayReady: true }, '*');
</script>`;

/** The real host: a hidden sandboxed iframe in `doc`, booted with the worker's text and the exporter's files once its page is up. */
function frameHost({ doc, sources }) {
  const win = doc.defaultView, f = doc.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts');   // NOT allow-same-origin: an opaque origin is what gets the frame a process of its own
  f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1; f.title = 'export';
  f.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
  f.srcdoc = RELAY;
  // up: the frame's page answers (pings may go); ready: the worker was booted (jobs may go). Jobs sent before are kept, in order
  const h = { onmessage: null, queue: [], up: false, ready: false, gone: false };
  const send = (msg, transfer) => f.contentWindow.postMessage(msg, '*', transfer || []);
  const onMsg = (e) => {
    if (h.gone || e.source !== f.contentWindow) return;
    const m = e.data || {};
    if (m.relayReady) {
      if (h.up) return;
      h.up = true;
      if (h.onmessage) h.onmessage({ pong: 'up' });   // a sign of life, as a pong is
      Promise.resolve(sources()).then((s) => { if (h.gone) return; send({ boot: { origin: win.location.origin === 'null' ? '*' : win.location.origin, worker: s.worker, sources: s.files } }); h.ready = true; for (const [msg, tr] of h.queue.splice(0)) send(msg, tr); },
        (err) => { if (h.onmessage) h.onmessage({ hostError: `the export's files could not be read: ${String((err && err.message) || err)}` }); });
      return;
    }
    if (h.onmessage) h.onmessage(m);
  };
  win.addEventListener('message', onMsg);
  (doc.body || doc.documentElement).append(f);
  h.post = (msg, transfer) => {
    if (h.gone) return;
    if (msg && msg.ping !== undefined) { if (h.up) send(msg); return; }   // the frame's page answers pings before the worker is booted
    if (h.ready) send(msg, transfer); else h.queue.push([msg, transfer]);
  };
  h.destroy = () => { h.gone = true; win.removeEventListener('message', onMsg); f.remove(); };
  return h;
}

function createExportRunner({ document: doc = null, sources = null, makeHost = null, pingMs = 1000, lostMs = 8000 } = {}) {
  if (!makeHost && !(doc && doc.defaultView && typeof doc.createElement === 'function' && typeof sources === 'function')) throw new Error('the export runner needs a page (its document and the exporter\'s files) or a host');
  const make = makeHost || (() => frameHost({ doc, sources }));
  let host = null, running = null, serial = 0, listen = null;
  const drop = () => { if (host) { try { host.destroy(); } catch (e) { /* gone already */ } } host = null; };
  const warm = () => { if (!host) { host = make(); host.onmessage = (m) => { if (listen) listen(m || {}); }; } return host; };
  return {
    /** The host now in use, or null (for the tests). */
    host: () => host,
    start({ job }) {
      if (running) running.cancel();   // one export at a time; the page asks for one at a time, this is only a guard
      const h = warm(), mySerial = ++serial, out = { promise: null, cancel: null };
      let settled = false, stage = STARTING, heard = Date.now(), tick = null, resolve, reject;
      const finish = () => { settled = true; clearInterval(tick); listen = null; running = null; };
      const fail = (err) => { if (settled) return; finish(); drop(); reject(err); };
      out.promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      listen = (m) => {
        if (settled) return;
        heard = Date.now();
        if (m.pong !== undefined) return;
        if (m.hostError) return fail(Object.assign(new Error(m.hostError), { hostError: true, stage }));
        if (m.serial !== mySerial) return;   // not this job's
        if (m.stage) { stage = m.stage; return; }
        finish();
        if (m.ok) resolve({ out: m.out, stage });
        else { if (!m.error || m.error.name !== 'ExportError') drop(); resolve({ error: m.error || { name: 'Error', message: 'the export failed', stage }, stage }); }
      };
      tick = setInterval(() => {
        if (settled) return;
        if (Date.now() - heard > lostMs) return fail(Object.assign(new Error(`the export's process went silent ${stage}`), { lost: true, stage }));
        h.post({ ping: mySerial });
      }, pingMs);
      h.post({ serial: mySerial, job });
      out.cancel = () => fail(Object.assign(new Error('cancelled'), { cancelled: true, stage }));
      running = out;
      return out;
    },
  };
}

module.exports = { createExportRunner, STARTING, _internal: { RELAY } };
