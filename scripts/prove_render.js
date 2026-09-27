#!/usr/bin/env node
// prove_render.js: drive the REAL app window, place a real track through the palette, and capture the window in each
// camera mode with PrintWindow (scripts/prove_render.ps1). D169: "PROVE THE RENDERING in the real window".
//
//   node scripts/prove_render.js --exe <path to the built app .exe> --out <folder outside the repo>
//        [--port 9340] [--timeout 600] [--shim-timers]
//
// --shim-timers (D170, DISCLOSED in the report): before the page's scripts run, window.setTimeout / clearTimeout are
// wrapped so they work when called as a method of another object. A's in-progress app/shell.js (D169) calls
// timers.setTimeout() on a { setTimeout, clearTimeout } object, which a browser rejects ("Illegal invocation"), so no word
// can be placed in the window until A fixes it. The shim changes nothing else; the report says whether it was used.
//
// HOW IT DRIVES THE WINDOW, without a line in A's page: WebView2 reads WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS from the
// environment of the process that creates it, so the app is started with --remote-debugging-port=<port> in that
// variable, and this script speaks the DevTools protocol to the page (Node's own WebSocket; no dependency).
//   · Words are placed by CLICKING the palette's own buttons (a real mouse event at the button's centre); the font is
//     set on the palette's own <select> (value + change event: a native dropdown cannot be clicked open over CDP).
//   · Camera keys are real key events (Input.dispatchKeyEvent), so they go through the preview's own key handler;
//     Ctrl+C is sent too, and must NOT move the camera.
//   · In each mode the preview answers a read-only probe (app/testhook/probe.js) and the window is captured.
// SAFETY: the app runs with a hard timeout (--timeout, default 600 s) and is killed at it, or at the end, by the PID
// this script started (taskkill /PID <pid> /T /F) and nothing else. No AC is involved.
// Captures are PrintWindow of the app's own window only; if the window cannot be found or is minimised, nothing is saved.
'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');

/**
 * The track the D169 packet names: straight, sweep, half-pipe turn, wall-ride, jump. Font 'auto' = the word's own.
 * `capture` takes the build view right after that word. `ghost` then shows the NEXT word as a ghost at the head (the
 * preview's 't180-ghost' event, D170) and captures the build view with it, and clears it before the next word is placed.
 */
const PLAN = Object.freeze([
  { word: 'straight', font: 'auto' }, { word: 'sweep', font: 'auto' }, { word: 'turn', font: 'half-pipe' },
  { word: 'wall-ride', font: 'auto', capture: 'wallride-lit', ghost: { word: 'jump', capture: 'build-ghost' } }, { word: 'jump', font: 'auto', capture: 'after-jump' },
]);
/** The views to capture, and the camera keys that reach each from the previous one (C cycles: build → overhead → side → chase → free). */
const VIEWS = Object.freeze([
  { mode: 'build', keys: [] }, { mode: 'overhead', keys: ['c'] }, { mode: 'chase', keys: ['c', 'c'] }, { mode: 'free', keys: ['c'] },
]);

function parseArgs(argv) {
  const o = { port: 9340, timeout: 600, shimTimers: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--exe') { o.exe = v; i++; } else if (k === '--out') { o.out = v; i++; } else if (k === '--port') { o.port = Number(v); i++; } else if (k === '--timeout') { o.timeout = Number(v); i++; } else if (k === '--shim-timers') o.shimTimers = true;
    else throw new Error(`prove_render: unknown argument ${k}`);
  }
  if (!o.exe || !o.out) throw new Error('prove_render: needs --exe <app.exe> and --out <folder>');
  if (!(Number.isInteger(o.port) && o.port > 1024 && o.port < 65536)) throw new Error('prove_render: --port must be 1025..65535');
  if (!(o.timeout > 0 && o.timeout <= 600)) throw new Error('prove_render: --timeout is 1..600 s (the night\'s hard cap is 10 min)');
  return o;
}

/**
 * The checks for one view, from the preview's probe and the window capture. Each is { name, pass, detail }.
 *   track visible        the capture found drawn (non-background) pixels inside the preview's rectangle: ≥ 1% of it
 *   head in frame        the head's NDC x and y are inside (−1, 1), in front of the camera (w > 0) and the far plane
 *   looks along growth   build view only: view direction · T ≥ 0.9
 *   dpr                  the canvas backing store is css size × DPR (rounded)
 */
function judge(mode, probe, cap) {
  const out = [];
  const frac = cap && cap.rectPixels > 0 ? cap.drawn / cap.rectPixels : 0;
  out.push({ name: 'track visible', pass: !!cap && cap.ok && frac >= 0.01, detail: cap && cap.ok ? `${cap.drawn} of ${cap.rectPixels} sampled pixels drawn (${(100 * frac).toFixed(1)}%)` : `no capture: ${cap && cap.reason}` });
  const n = probe && probe.headNdc;
  out.push({ name: 'head in frame', pass: !!n && Math.abs(n[0]) < 1 && Math.abs(n[1]) < 1 && n[2] < 1, detail: n ? `head at NDC (${n.map((x) => x.toFixed(3)).join(', ')})` : 'head behind the camera or no track' });
  if (mode === 'build') out.push({ name: 'looks along growth', pass: !!probe && probe.lookAlongT >= 0.9, detail: probe ? `view · T = ${probe.lookAlongT && probe.lookAlongT.toFixed(4)}` : 'no probe' });
  const c = probe && probe.canvas;
  if (probe && probe.ghostExpected) out.push({ name: 'ghost shown', pass: probe.ghost > 0, detail: `${probe.ghost} ghost batches` });
  out.push({ name: 'dpr', pass: !!c && c.width === Math.round(c.cssWidth * c.dpr) && c.height === Math.round(c.cssHeight * c.dpr), detail: c ? `${c.width}×${c.height} backing for ${c.cssWidth}×${c.cssHeight} css at DPR ${c.dpr}` : 'no probe' });
  return out;
}

// ── the run ──
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function cdpConnect(port, deadline) {
  let page = null;
  while (!page && Date.now() < deadline) {
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); page = list.find((t) => t.type === 'page' && /app\/index\.html/.test(t.url)); } catch { /* not up yet */ }
    if (!page) await sleep(300);
  }
  if (!page) throw new Error(`no app page on the DevTools port ${port} (is WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS honoured?)`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('DevTools websocket failed')); });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, (d) => (d.error ? rej(new Error(`${method}: ${d.error.message}`)) : res(d.result))); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text}`); return r.result.value; };
  return { send, evaluate, close: () => ws.close() };
}
async function until(fn, what, ms = 20000) { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(200); } throw new Error(`timed out waiting for ${what}`); }

async function run(o) {
  fs.mkdirSync(o.out, { recursive: true });
  const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${o.port}` };
  const app = spawn(o.exe, [], { env, stdio: 'ignore', windowsHide: false });
  const kill = () => { if (app.exitCode === null) spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); };
  const hard = setTimeout(() => { kill(); process.stderr.write(`prove_render: hard timeout ${o.timeout} s, killed PID ${app.pid}\n`); process.exit(2); }, o.timeout * 1000);
  const report = { pid: app.pid, started: new Date().toISOString(), placed: [], views: {}, ctrlC: null, ok: false };
  try {
    const cdp = await cdpConnect(o.port, Date.now() + 60000);
    report.shimTimers = o.shimTimers;
    if (o.shimTimers) {
      await cdp.send('Page.enable');
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: '(() => { const s = window.setTimeout, c = window.clearTimeout; window.setTimeout = function (f, ms, ...a) { return s.call(window, f, ms, ...a); }; window.clearTimeout = function (t) { return c.call(window, t); }; })();' });
      await cdp.send('Page.reload', { ignoreCache: true }); await sleep(1500);
    }
    await until(() => cdp.evaluate(`document.querySelectorAll('#palette button.piece').length >= 7 && !!document.querySelector('#preview canvas')`), 'the palette and the preview');
    const click = async (sel, text) => {
      const r = await cdp.evaluate(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent === ${JSON.stringify(text)}); if (!b) return null; b.scrollIntoView({ block: 'center' }); const q = b.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`);
      if (!r) throw new Error(`no ${sel} button "${text}"`);
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
    };
    /** Point at a palette piece without clicking: A's page shows that piece's ghost (app/index.html, 't180-ghost'). */
    const hover = async (text) => {
      const r = await cdp.evaluate(`(() => { const b = [...document.querySelectorAll('#palette button.piece')].find((x) => x.textContent === ${JSON.stringify(text)}); const q = b.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
    };
    /** Move the pointer off the palette (onto the preview), so no hover ghost is left showing. */
    const away = async () => {
      const r = await cdp.evaluate(`(() => { const q = document.querySelector('#preview canvas').getBoundingClientRect(); return { x: q.left + 12, y: q.top + 12 }; })()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
      await cdp.evaluate(`document.dispatchEvent(new CustomEvent('t180-ghost-clear')); true`);
    };
    const trackLen = () => cdp.evaluate(`document.querySelectorAll('#palette ol.track li').length`);
    const probe = () => cdp.evaluate(`new Promise((res) => { document.dispatchEvent(new CustomEvent('t180-probe', { detail: { reply: res } })); setTimeout(() => res(null), 2000); })`);
    const rect = () => cdp.evaluate(`(() => { const c = document.querySelector('#preview canvas').getBoundingClientRect(), d = devicePixelRatio; return [c.left * d, c.top * d, c.width * d, c.height * d].map(Math.round).join(','); })()`);
    /** Probe the preview, capture the app's window (PrintWindow), and judge the view. */
    const shoot = async (name, mode, expect = {}) => {
      await sleep(2500);                                   // the eased camera arrives (rate 8/s: 99.99% in 1.2 s)
      const p = { ...(await probe()), ...expect };
      if (!p || p.mode !== mode) throw new Error(`expected the ${mode} view, the preview says ${p && p.mode}`);
      const file = path.join(o.out, `window-${name}.png`);
      const ps = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'prove_render.ps1'), '-ProcId', String(app.pid), '-Out', file, '-Rect', await rect()], { encoding: 'utf8', timeout: 60000 });
      let cap; try { cap = JSON.parse(ps.stdout.trim().split('\n').pop()); } catch { cap = { ok: false, reason: `capture script: ${ps.stderr || ps.stdout}` }; }
      if (cap.ok && cap.title !== 'T-180 Track Builder') { fs.rmSync(file, { force: true }); cap = { ok: false, reason: `captured window "${cap.title}" is not the app; deleted` }; }
      report.views[name] = { file: cap.ok ? file : null, probe: p, capture: cap, checks: judge(mode, p, cap) };
    };
    for (const step of PLAN) {
      const set = await cdp.evaluate(`(() => { const s = document.querySelector('#palette select[aria-label="Font"]'); if (!s) return false; s.value = ${JSON.stringify(step.font)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value === ${JSON.stringify(step.font)}; })()`);
      if (!set) throw new Error(`could not set the font to ${step.font}`);
      const before = await trackLen();
      await click('#palette button.piece', step.word);
      await until(async () => (await trackLen()) === before + 1, `"${step.word}" to be placed`);
      await away();
      report.placed.push({ ...step, track: await cdp.evaluate(`[...document.querySelectorAll('#palette ol.track li')].map((l) => l.textContent)`) });
      if (step.capture) await shoot(step.capture, 'build');
      if (step.ghost) {
        // the real path first: point at the palette piece, and A's page sends the shell's candidate as the ghost
        await hover(step.ghost.word); await sleep(400);
        let via = "palette hover (A's app/index.html)";
        if (!((await probe()) || {}).ghost) {                // fallback, reported: the preview's own event with the word
          const g = await cdp.evaluate(`new Promise((res) => { document.dispatchEvent(new CustomEvent('t180-ghost', { detail: { word: ${JSON.stringify(step.ghost.word)}, reply: res } })); setTimeout(() => res({ error: 'no reply' }), 3000); })`);
          if (!g || !g.ok) throw new Error(`the ghost of "${step.ghost.word}" was refused: ${g && g.error}`);
          via = "the preview's t180-ghost event (fallback: hovering showed none)";
        }
        await shoot(step.ghost.capture, 'build', { ghostExpected: true });
        report.views[step.ghost.capture].ghostVia = via;
        await away();
      }
    }
    report.messages = await cdp.evaluate(`[...document.querySelectorAll('#palette .message')].map((m) => m.textContent)`);
    await cdp.evaluate(`document.activeElement && document.activeElement.blur(); document.body.focus(); true`);   // keys go to the page, not a <select>
    const key = (k, modifiers = 0) => Promise.all(['keyDown', 'keyUp'].map((type) => cdp.send('Input.dispatchKeyEvent', { type, key: k, code: `Key${k.toUpperCase()}`, text: modifiers ? undefined : k, modifiers, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) })));
    // Ctrl+C must not move the camera (B's D168 defect 4)
    const m0 = (await probe()).mode; await key('c', 2); await sleep(300); report.ctrlC = { before: m0, after: (await probe()).mode };
    for (const v of VIEWS) {
      for (const k of v.keys) { await key(k); await sleep(150); }
      await shoot(v.mode, v.mode);
    }
    // DPR in the real window: emulate a 1.5× display (the page's devicePixelRatio changes, as it does when the window moves
    // to a scaled monitor); the canvas backing store must follow on the next frame, then go back when the emulation ends
    const dprAt = async (f) => { await cdp.send('Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor: f, mobile: false }); await sleep(800); return (await probe()).canvas; };
    const c15 = await dprAt(1.5); await cdp.send('Emulation.clearDeviceMetricsOverride'); await sleep(800); const c1 = (await probe()).canvas;
    const follows = (c, d) => c.dpr === d && c.width === Math.round(c.cssWidth * d) && c.height === Math.round(c.cssHeight * d);
    report.dpr = { at15: c15, after: c1, pass: follows(c15, 1.5) && c1.width === Math.round(c1.cssWidth * c1.dpr) };
    report.ok = report.ctrlC.before === report.ctrlC.after && report.dpr.pass && Object.values(report.views).every((v) => v.checks.every((c) => c.pass));
    cdp.close();
  } finally { clearTimeout(hard); kill(); report.ended = new Date().toISOString(); }
  fs.writeFileSync(path.join(o.out, 'prove_render.json'), JSON.stringify(report, null, 1));
  return report;
}

/**
 * THE FULL FLOW (--flow): build a short track through the palette, press "Close the loop", press "Export…", and check
 * the folder was written. The native folder dialog is outside the page (the DevTools protocol cannot reach it, and
 * Tauri's JS objects are frozen, so it cannot be stood in for from the page), so scripts/prove_render_dialog.ps1 answers
 * it with UI Automation: it finds the dialog OWNED BY THIS PROCESS, types `<out>/export` and presses Select Folder. The
 * export itself is the app's own, end to end. The folder is then listed, and its kn5 read back with tools/kn5.cjs.
 */
const FLOW_WORDS = Object.freeze(['straight', 'straight', 'tight', 'straight', 'tight']);
async function runFlow(o) {
  fs.mkdirSync(o.out, { recursive: true });
  const exportDir = path.join(o.out, 'export'); fs.mkdirSync(exportDir, { recursive: true });
  const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${o.port}` };
  const app = spawn(o.exe, [], { env, stdio: 'ignore', windowsHide: false });
  const kill = () => { if (app.exitCode === null) spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); };
  const hard = setTimeout(() => { kill(); process.stderr.write(`prove_render: hard timeout ${o.timeout} s, killed PID ${app.pid}\n`); process.exit(2); }, o.timeout * 1000);
  const report = { pid: app.pid, started: new Date().toISOString(), flow: true, shimTimers: o.shimTimers, exportDir, steps: [], captures: {}, ok: false };
  try {
    const cdp = await cdpConnect(o.port, Date.now() + 60000);
    await cdp.send('Page.enable');
    if (o.shimTimers) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: '(() => { const s = window.setTimeout, c = window.clearTimeout; window.setTimeout = function (f, ms, ...a) { return s.call(window, f, ms, ...a); }; window.clearTimeout = function (t) { return c.call(window, t); }; })();' });
    await cdp.send('Page.reload', { ignoreCache: true }); await sleep(1500);
    await until(() => cdp.evaluate(`document.querySelectorAll('#palette button.piece').length >= 7 && !!document.querySelector('#preview canvas') && !!(window.__TAURI__ && window.__TAURI__.core)`), 'the app');
    const at = (sel, text) => cdp.evaluate(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return null; b.scrollIntoView({ block: 'center' }); const q = b.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2, disabled: !!b.disabled }; })()`);
    const click = async (sel, text) => { const r = await at(sel, text); if (!r) throw new Error(`no ${sel} "${text}"`); if (r.disabled) throw new Error(`"${text}" is disabled`); for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 }); };
    const away = async () => { const r = await cdp.evaluate(`(() => { const q = document.querySelector('#preview canvas').getBoundingClientRect(); return { x: q.left + 12, y: q.top + 12 }; })()`); await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y }); };
    const texts = () => cdp.evaluate(`JSON.stringify({ status: (document.getElementById('status') || {}).textContent || '', messages: [...document.querySelectorAll('[role=alert], .message')].map((m) => m.textContent), words: document.querySelectorAll('#palette ol.track li').length })`).then(JSON.parse);
    const capture = async (name) => {
      const file = path.join(o.out, `window-${name}.png`);
      const ps = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'prove_render.ps1'), '-ProcId', String(app.pid), '-Out', file], { encoding: 'utf8', timeout: 60000 });
      let cap; try { cap = JSON.parse(ps.stdout.trim().split('\n').pop()); } catch { cap = { ok: false, reason: ps.stderr || ps.stdout }; }
      if (cap.ok && cap.title !== 'T-180 Track Builder') { fs.rmSync(file, { force: true }); cap = { ok: false, reason: `captured window "${cap.title}" is not the app; deleted` }; }
      report.captures[name] = { file: cap.ok ? file : null, capture: cap, texts: await texts() };
    };
    for (const w of FLOW_WORDS) { const n0 = (await texts()).words; await click('#palette button.piece', w); await until(async () => (await texts()).words === n0 + 1, `"${w}" to be placed`); await away(); }
    report.steps.push({ step: 'placed', ...(await texts()) });
    await click('#palette button', 'Close the loop');
    await until(async () => / · closed loop/.test((await texts()).status), 'the loop to close', 120000);
    report.steps.push({ step: 'closed', ...(await texts()) });
    await cdp.evaluate(`document.dispatchEvent(new CustomEvent('t180-camera', { detail: { mode: 'overhead' } })); true`); await sleep(2500);
    await capture('flow-closed-overhead');
    await click('button', 'Export…');
    const dlg = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'prove_render_dialog.ps1'), '-ProcId', String(app.pid), '-Dir', exportDir, '-TimeoutSec', '30'], { encoding: 'utf8', timeout: 60000 });
    let d; try { d = JSON.parse(dlg.stdout.trim().split(/\r?\n/).pop()); } catch { d = { ok: false, reason: dlg.stderr || dlg.stdout }; }
    report.steps.push({ step: 'folder dialog', ...d });
    if (!d.ok) throw new Error(`the folder dialog: ${d.reason}`);
    const done = await until(async () => { const t = await texts(); return t.messages.find((m) => /^exported |Not exported|export failed/.test(m)) || (/export failed/.test(t.status) ? t.status : null); }, 'the export to finish', 180000);
    report.steps.push({ step: 'export', result: done, ...(await texts()) });
    await capture('flow-exported');
    cdp.close();
  } catch (e) { report.error = e.message; } finally { clearTimeout(hard); kill(); report.ended = new Date().toISOString(); }
  // the folder, listed and read back outside the app
  const folders = fs.readdirSync(exportDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  report.folders = folders.map((f) => {
    const list = []; const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(p, r); else list.push({ path: r, bytes: fs.statSync(p).size }); } };
    walk(path.join(exportDir, f), '');
    const kn5 = list.find((x) => x.path === `${f}.kn5`);
    let read = null;
    if (kn5) { try { const k = require(path.join(__dirname, '..', 'tools', 'kn5.cjs')).readKn5(path.join(exportDir, f, kn5.path)); read = summarise(k); } catch (e) { read = { error: e.message }; } }
    return { folder: f, files: list, kn5: read };
  });
  report.ok = !report.error && report.folders.length > 0 && report.folders.every((f) => f.kn5 && !f.kn5.error && f.kn5.meshes > 0) && Object.values(report.captures).every((c) => c.file);
  fs.writeFileSync(path.join(o.out, 'prove_flow.json'), JSON.stringify(report, null, 1));
  return report;
}
/** A kn5 as tools/kn5.cjs reads it ({ version, materials, meshes, dummies }), in numbers, with the AC_ markers. */
function summarise(k) {
  const vcount = (m) => (m.pos ? (Array.isArray(m.pos[0]) ? m.pos.length : m.pos.length / 3) : 0);
  return { version: k.version, materials: (k.materials || []).length, meshes: (k.meshes || []).length, vertices: (k.meshes || []).reduce((a, m) => a + vcount(m), 0),
    markers: (k.dummies || []).map((d) => d.name).filter((x) => /^AC_/.test(x || '')).sort() };
}

if (require.main === module && process.argv.includes('--flow')) {
  let o; try { o = parseArgs(process.argv.slice(2).filter((a) => a !== '--flow')); } catch (e) { console.error(e.message); process.exit(1); }
  runFlow(o).then((r) => { console.log(JSON.stringify({ ok: r.ok, error: r.error, steps: r.steps.map((s) => ({ step: s.step, status: s.status, result: s.result })), folders: r.folders.map((f) => ({ folder: f.folder, files: f.files.length, kn5: f.kn5 })) }, null, 1)); process.exit(r.ok ? 0 : 3); })
    .catch((e) => { console.error(`prove_render --flow: ${e.message}`); process.exit(1); });
} else if (require.main === module) {
  let o; try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
  run(o).then((r) => { console.log(JSON.stringify({ ok: r.ok, ctrlC: r.ctrlC, dpr: r.dpr, views: Object.fromEntries(Object.entries(r.views).map(([k, v]) => [k, v.checks])) }, null, 1)); process.exit(r.ok ? 0 : 3); })
    .catch((e) => { console.error(`prove_render: ${e.message}`); process.exit(1); });
}
module.exports = { PLAN, VIEWS, FLOW_WORDS, parseArgs, judge, summarise };
