// export-isolated-page.test.js: node --test app/test/export-isolated-page.test.js
// D437b, THE EXPORT IN ITS OWN PROCESS, IN A REAL BROWSER (headless Chrome, --mute-audio through soundrender.js launchChrome; never a window). The page is
// the worktree served over a local port; it loads the core shell, the road surface and the exporter through the app's own loader (app/lib/cjs.js), as
// app/index.html does, and builds export-isolated.test.js's test lap. Rows:
//   1  a page with a document and Web Workers exports through its own process without being told to (app/export/export.js makes the runner: a hidden
//      sandboxed iframe, a worker inside it), and the textured lap and the open TEST export are b6969da's bytes (export-isolated.test.js's PIN)
//   2  A REAL HEAP OUT-OF-MEMORY in that process, building the pit-lane check (the worker's text is wrapped, through makeExporter's runner factory, so
//      that when it reports that stage it fills its V8 heap): a renderer process dies, the PAGE does not (the same document, still answering, its
//      canvas still drawn), Export's message says the export ran out of memory building the pit-lane check, nothing is handed to be written, and
//      the next export, in a fresh process, writes b6969da's bytes. Skipped where there is no Chrome
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), http = require('http');
const { chromePath, launchChrome, connect } = require('./soundrender.js');
const CHROME = chromePath();
const REPO = path.resolve(__dirname, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// local-0.4.15 (seat A, D441 landing): the lap pin moved from b6969da's 00588932b76e738a to 36ba2c6869a3d1d0 because D438 (9233a93,
// src/geom/pitlane.js, the pit lane level from leave to rejoin) changes the lap's pit lane; pitlane.js put back to 9861c69's gives 00588932
// again, so the isolation did not move it. The open TEST export has no pit lane and is unchanged. The row titles still say b6969da's;
// they are left as they are because the mutation harness names its rows by them.
const PIN = { lap: 'sha256 36ba2c6869a3d1d0 files 10', open: 'sha256 a257c20e84e68897 files 11' };   // export-isolated.test.js row 1, from 498e735 (see there)
const TYPES = { '.js': 'text/javascript', '.cjs': 'text/javascript', '.json': 'application/json', '.html': 'text/html' };

// The page: the app's modules from the served worktree, export-isolated.test.js's laps, and the same digest of an export's files
const PAGE = `<!doctype html><meta charset="utf-8"><title>d437b</title><body><canvas id="c" width="64" height="32"></canvas>
<script src="/app/lib/cjs.js"></script><script>
'use strict';
window.born = Math.random();
document.getElementById('c').getContext('2d').fillStyle = '#ff0000'; document.getElementById('c').getContext('2d').fillRect(0, 0, 64, 32);
const get = (p) => fetch('/' + p).then((r) => { if (!r.ok) throw new Error(r.status + ' ' + p); return r.text(); });
const R = 180, Q = Math.PI * R / 2, AUTHOR = () => 'D437b test';
window.boot = async () => {
  const shim = (await loadCjs('app/export/node-shim.js', get)).createShim(), co = { builtins: shim.builtins, globals: { Buffer: shim.Buffer } };
  window.T = { C: await loadCjs('app/core/coreshell.js', get, co), TX: await loadCjs('app/core/textures.js', get, co), D: await loadCjs('src/core/document.js', get, co),
    EX: await loadCjs('app/export/export.js', get), RN: await loadCjs('app/export/exportrunner.js', get) };
  return 'booted';
};
window.pitLap = async (opts) => {
  const s = await T.C.createCoreShell({ brushFn: null, autosaveMs: 0, ...opts });
  s.extend({ length: 600, family: 'bowl' });
  for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  s.extend({ length: 60, transition: 40, targets: { kh: 0 } });
  s.close();
  s.setPitLane({ ...T.D.PIT_DEFAULT, side: 'R', leave: { word: 'p1', along: 60 }, rejoin: { word: 'p1', along: 540 } });
  return s;
};
window.openRun = async (opts) => {
  const s = await T.C.createCoreShell({ brushFn: null, autosaveMs: 0, ...opts });
  s.extend({ length: 300, family: 'bowl' });
  for (let i = 0; i < 2; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  return s;
};
window.asphaltOf = (s) => T.TX.createCoreTextures({ segments: () => s.getState().resolved.segments, closed: () => !!s.getState().resolved.closed, edge: true }).current();
window.digestOf = async (out) => {
  const enc = new TextEncoder(), parts = []; let n = 0, len = 0;
  for (const f of out.folders) for (const file of f.files) {
    let b = file.bytes;
    if (file.path.endsWith('.t180b-builder.json')) b = enc.encode(new TextDecoder().decode(b).replace(/"written": "[^"]*"/, '"written": "-"'));
    const head = enc.encode(f.folder + '/' + file.path + '\\0' + b.length + '\\0'); parts.push(head, b); len += head.length + b.length; n++;
  }
  const all = new Uint8Array(len); let at = 0; for (const p of parts) { all.set(p, at); at += p.length; }
  const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', all))].map((x) => x.toString(16).padStart(2, '0')).join('');
  return 'sha256 ' + hex.slice(0, 16) + ' files ' + n;
};
window.pixel = () => Array.from(document.getElementById('c').getContext('2d').getImageData(4, 4, 1, 1).data).join(',');
</script>`;

// Wrapped onto the export worker's text for row 2: when the export reports the pit-lane stage, the worker fills its V8 heap until the process dies
const OOM_PRELUDE = "{ const post = self.postMessage.bind(self); self.postMessage = (m, t) => { post(m, t); if (m && m.stage === 'building the pit-lane check') { const a = []; for (let n = 0; ; n++) a.push({ n, s: 'x' + n, v: [n, n + 1, n + 2] }); } }; }\n";

test('the export runs in its own process in a real page: b6969da\'s bytes, and a real heap out-of-memory there leaves the page drawn', { skip: CHROME ? false : 'no Chrome on this machine' }, async (t) => {
  const srv = http.createServer((q, s) => {
    const u = decodeURIComponent(q.url.split('?')[0]);
    if (u === '/d437b.html') { s.writeHead(200, { 'content-type': 'text/html' }); s.end(PAGE); return; }
    const p = path.normalize(path.join(REPO, u));
    if (!p.startsWith(REPO)) { s.writeHead(403); s.end(); return; }
    fs.readFile(p, (e, b) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); s.end(b); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { ch, dir, port, tgt } = await launchChrome(CHROME, ['--hide-scrollbars'], 't180b-d437b-');
  const browser = await connect((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);
  const page = await connect(tgt.webSocketDebuggerUrl);
  const renderers = async () => new Set(((await browser.send('SystemInfo.getProcessInfo')).result.processInfo || []).filter((p) => p.type === 'renderer').map((p) => p.id));
  const ev = async (expr, ms = 600000) => {
    let timer;
    const d = await Promise.race([page.send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }), new Promise((r) => { timer = setTimeout(() => r({ timeout: true }), ms); })]);
    clearTimeout(timer);   // a timer left waiting would hold the test process open
    if (d.timeout) throw new Error(`the page did not answer within ${ms} ms: ${expr.slice(0, 80)}`);
    if (!d.result || d.result.exceptionDetails) throw new Error(`page: ${JSON.stringify(d.result ? d.result.exceptionDetails : d).slice(0, 600)}`);
    return d.result.result.value;
  };
  try {
    await page.send('Page.enable');
    await page.send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/d437b.html` });
    for (let i = 0; i < 100; i++) { await sleep(200); try { if (await ev("return typeof window.boot === 'function';", 2000)) break; } catch (e) { /* loading */ } }
    assert.equal(await ev('return boot();'), 'booted');
    const born = await ev('return window.born;');

    await t.test('row 1: the page exports through a sandboxed iframe of its own, and writes b6969da\'s bytes', async () => {
      const got = await ev(`
        window.ex = await T.EX.makeExporter(get, { author: AUTHOR });
        const s = await pitLap({ exporter: ex }), lap = await digestOf(await s.buildExportAsync({ textures: asphaltOf(s) }));
        const o = await openRun({ exporter: ex }), open = await digestOf(await o.buildExportAsync({ test: true }));
        const f = [...document.querySelectorAll('iframe')];
        return { lap, open, frames: f.length, sandbox: f.map((x) => x.getAttribute('sandbox')) };`);
      assert.deepEqual({ lap: got.lap, open: got.open }, PIN);
      assert.deepEqual({ frames: got.frames, sandbox: got.sandbox }, { frames: 1, sandbox: ['allow-scripts'] }, 'one export host, sandboxed with scripts only (an opaque origin, a process of its own)');
    });

    await t.test('row 2: a real heap out-of-memory in the export\'s process ends the export with the stage; the page stays drawn and the next export works', async () => {
      const before = await renderers();
      await ev(`
        let first = true;
        window.writes = [];
        const storage = { writeExport: async (dir, folder) => { writes.push(folder); }, folderIsEmpty: async () => false, removeEmptyFolder: async () => {} };
        window.exOom = await T.EX.makeExporter(get, { author: AUTHOR, runner: (sources) => T.RN.createExportRunner({ document, sources: async () => { const s = await sources(); if (!first) return s; first = false; return { ...s, worker: ${JSON.stringify(OOM_PRELUDE)} + s.worker }; } }) });
        window.s2 = await pitLap({ exporter: exOom, storage });
        window.pressed = s2.exportTo('C:/d437b-fake/assettocorsa/content/tracks', { textures: asphaltOf(s2) }).then(() => 'settled', (e) => 'threw ' + e.message);
        return true;`);
      // while the export's process fills its heap the page keeps answering
      let during = new Set(), answered = 0;
      for (let i = 0; i < 120; i++) {
        await sleep(1000);
        for (const id of await renderers()) during.add(id);
        const st = await ev("return s2.getState().message || '';", 5000); answered++;
        if (!/^exporting/.test(st)) break;
      }
      assert.equal(await ev('return pressed;', 5000), 'settled');
      const message = await ev("return s2.getState().message;", 5000), after = await renderers();
      assert.match(message, /the export ran out of memory building the pit-lane check/, message);
      assert.match(message, /nothing was written/i);
      assert.deepEqual(await ev('return writes;', 5000), [], 'nothing was handed to the native side to write');
      const died = [...during].filter((id) => !after.has(id));
      assert.ok(died.length >= 1, `a renderer process died (before ${[...before]}, during ${[...during]}, after ${[...after]})`);
      assert.equal(await ev('return window.born;', 5000), born, 'the same page: it was not reloaded');
      assert.equal(await ev('return pixel();', 5000), '255,0,0,255', 'the page is still drawn');
      assert.ok(answered >= 2, `the page answered while the export ran (${answered} times)`);
      // the next export, through the same exporter: a fresh process, b6969da's bytes
      assert.equal(await ev('return digestOf(await s2.buildExportAsync({ textures: asphaltOf(s2) }));'), PIN.lap);
    });
  } finally {
    try { page.ws.close(); browser.ws.close(); } catch (e) { /* closing */ }
    ch.kill(); srv.closeAllConnections(); srv.close(); await sleep(500);   // the page's keep-alive sockets would hold the test process open
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may still hold it */ }
  }
});
