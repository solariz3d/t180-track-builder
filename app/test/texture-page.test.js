// texture-page.test.js: node --test app/test/texture-page.test.js
// D399: EACH LOOK'S OWN TEXTURE, AND THE EMPTY BUILDER IN CHARACTERS, tested on the real page (app/index.html) in HEADLESS Chrome (never a window), served
// from this checkout, each look chosen through Settings ▸ Theme's saved value (t180.settings.theme). Skipped, with the reason, where there is no Chrome
// (CHROME_PATH or the usual place). Rows:
//   1  each look's texture tile (app/themes/tex/<look>.png, through the --tex token) is the top background layer of the header, the left panel and an
//      open menu, and the tile loads; the 3D view (#stage, #preview and its canvas) carries none
//   2  the texture costs no text its contrast: with a six-piece track placed, in the builder and with the File menu open, no text that reads at least
//      4.5:1 (WCAG) with the texture switched off (--tex: none) reads under it with the texture on. The probe is E's D389/D397 one: each visible text's glyph
//      boxes and colour, then the glyphs hidden and the surfaces shot again, the text against the 2nd and 98th percentile background pixel in its boxes
//   3  the empty builder shows the track in characters (#empty-art) only while there are no pieces: shown at the start, hidden once a piece is placed,
//      shown again when the last one is undone
//   4  (A's review 12) the art sits in the free area right of the left panel: no overlap with #left at window widths 900, 1100 and 1400
//   5  (A's review 12) at display scales 1.25 and 1.5 each fine tile (SIGIL, Skyline, Glass, Aurora) is drawn one tile pixel per device pixel, so it lands
//      unresampled (resampled, Aurora's dots smeared into uneven two-pixel smudges)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
const { chromePath } = require('./soundrender.js');
const { decode } = require('./png.js');

const REPO = path.join(__dirname, '..', '..');
const CHROME = chromePath();
const skip = CHROME ? false : 'no Chrome here (set CHROME_PATH): the textures are tested in headless Chrome';
const LOOKS = ['sigil', 'aqua', 'skyline', 'glass', 'aurora'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.cjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.css': 'text/css' };

let srv, ch, ws, dir, base, send, ev, errors = [];
test.before(async () => {
  if (skip) return;
  srv = http.createServer((q, s) => {
    const p = path.normalize(path.join(REPO, decodeURIComponent(q.url.split('?')[0])));
    if (!p.startsWith(REPO)) { s.writeHead(403); s.end(); return; }
    fs.readFile(p, (e, b) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); s.end(b); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}/app/index.html`;
  const port = 9300 + Math.floor(Math.random() * 600); dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180tex-'));
  ch = spawn(CHROME, ['--headless=new', '--mute-audio', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--window-size=1400,860', 'about:blank'], { stdio: 'ignore' });
  let tgt; for (let i = 0; i < 100 && !tgt; i++) { await sleep(200); try { tgt = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch (e) { /* not up yet */ } }
  if (!tgt) throw new Error(`headless Chrome did not answer on port ${port}`);
  ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('the DevTools socket failed')); });
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text); };
  send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  ev = async (expr) => { const d = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (!d.result || d.result.exceptionDetails) throw new Error(`page: ${JSON.stringify(d.result ? d.result.exceptionDetails : d).slice(0, 500)}`); return d.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 860, deviceScaleFactor: 1, mobile: false });
});
test.after(async () => { try { ws && ws.close(); } catch (e) { /* closing */ } if (ch) ch.kill(); if (srv) srv.close(); await sleep(300); try { dir && fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may hold it */ } });

/** a fresh page in `look`, nothing else saved, the guide closed */
async function load(look) {
  errors = [];
  await send('Page.navigate', { url: base.replace('index.html', 'lib/cjs.js') }); await sleep(300);
  await ev(`localStorage.clear(); localStorage.setItem('t180.settings.theme', ${JSON.stringify(JSON.stringify(look))}); return true;`);
  await send('Page.navigate', { url: base });
  for (let i = 0; i < 150; i++) { await sleep(200); try { if (await ev("return document.documentElement.dataset.menubar === 'ready';")) break; } catch (e) { /* loading */ } }
  assert.equal(await ev("return document.documentElement.dataset.menubar || 'not mounted';"), 'ready', `${look}: the menus mounted (page errors: ${errors.join(' | ') || 'none'})`);
  await ev("const b = [...document.querySelectorAll('#guide button')].find((x) => x.textContent.trim() === '✕'); if (b) b.click(); return true;"); await sleep(300);
}
const pieces = () => ev("return Number((document.querySelector('#palette .head').textContent.match(/^(\\d+) piece/) || [0, -1])[1]);");
const extend = (n) => ev(`const b = [...document.querySelectorAll('#palette button')].find((x) => x.textContent.trim() === 'Extend'); for (let i = 0; i < ${n}; i++) { b.click(); await new Promise((r) => setTimeout(r, 250)); } return true;`);
const undo = (n) => ev(`const b = [...document.querySelectorAll('#palette button')].find((x) => x.textContent.trim() === 'Undo'); for (let i = 0; i < ${n}; i++) { b.click(); await new Promise((r) => setTimeout(r, 200)); } return true;`);
const shot = async () => Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64');

test('row 1: each look\'s tile is the top background layer of the header, the left panel and an open menu, and it loads; the 3D view carries none', { skip }, async () => {
  for (const look of LOOKS) {
    await load(look);
    await ev("document.getElementById('m-file').open = true; await new Promise((r) => setTimeout(r, 150)); return true;");
    const got = await ev(`const first = (el) => { const b = getComputedStyle(el).backgroundImage; return b === 'none' ? 'none' : b.split(/,(?![^(]*\\))/)[0].trim(); };
      const m = document.querySelector('#m-file .more-menu'), out = { header: first(document.querySelector('header')), left: first(document.getElementById('left')), menu: first(m) };
      out.view = ['#stage', '#preview', '#preview canvas'].map((s) => [...document.querySelectorAll(s)].map((e) => getComputedStyle(e).backgroundImage)).flat();
      const url = (out.header.match(/url\\("?([^")]+)"?\\)/) || [])[1]; out.loaded = url ? await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i.naturalWidth); i.onerror = () => ok(0); i.src = url; }) : 0;
      return out;`);
    await ev("document.getElementById('m-file').open = false; return true;");
    for (const s of ['header', 'left', 'menu']) assert.match(got[s], new RegExp(`^url\\("?[^"]*/app/themes/tex/${look}\\.png"?\\)$`), `${look}: the ${s}'s top layer is its tile (${got[s]})`);
    assert.ok(got.loaded > 0, `${look}: the tile loads`);
    for (const b of got.view) assert.ok(!/themes\/tex\//.test(b), `${look}: the 3D view carries no tile (${b})`);
    assert.deepEqual(errors, [], `${look}: no page errors`);
  }
});

// the probe (app_cdp.js, D381-D389, with its HUD correction; tex.js, D397)
const TEXTS = `const out = [];
  for (const e of document.body.querySelectorAll('*')) {
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || ((e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') && e.value && !['range', 'checkbox', 'radio'].includes(e.type));
    if (!own || e.closest('[aria-hidden="true"]')) continue;
    let hidden = false; for (let p = e; p && p.parentElement; p = p.parentElement) { const d = p.parentElement; if (d.tagName === 'DETAILS' && !d.open && p.tagName !== 'SUMMARY') { hidden = true; break; } }
    const s = getComputedStyle(e), b = e.getBoundingClientRect();
    if (hidden || b.width < 2 || b.height < 2 || b.right <= 0 || b.bottom <= 0 || b.left >= innerWidth || b.top >= innerHeight || s.visibility !== 'visible') continue;
    let o = 1; for (let p = e; p; p = p.parentElement) o *= +getComputedStyle(p).opacity; if (o === 0) continue;
    const rects = []; for (const n of e.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { const g = document.createRange(); g.selectNodeContents(n); for (const q of g.getClientRects()) if (q.width >= 1 && q.height >= 1) rects.push([q.left, q.top, q.width, q.height]); }
    const clip = (q) => { let [x0, y0, x1, y1] = [q[0], q[1], q[0] + q[2], q[1] + q[3]]; for (let p = e; p && p !== document.documentElement; p = p.parentElement) { const ps = getComputedStyle(p); if (ps.overflowX === 'visible' && ps.overflowY === 'visible') continue; const c = p.getBoundingClientRect(), il = c.left + p.clientLeft, it = c.top + p.clientTop; x0 = Math.max(x0, il); y0 = Math.max(y0, it); x1 = Math.min(x1, il + p.clientWidth); y1 = Math.min(y1, it + p.clientHeight); } x0 = Math.max(x0, 0); y0 = Math.max(y0, 0); x1 = Math.min(x1, innerWidth); y1 = Math.min(y1, innerHeight); return x1 - x0 >= 1 && y1 - y0 >= 1 ? [x0, y0, x1 - x0, y1 - y0] : null; };
    if (!rects.length) { const px = (k) => parseFloat(s.getPropertyValue(k)) || 0, l = px('border-left-width') + px('padding-left'), t = px('border-top-width') + px('padding-top'); rects.push([b.left + l, b.top + t, b.width - l - px('border-right-width') - px('padding-right'), b.height - t - px('border-bottom-width') - px('padding-bottom')]); }
    const seen = (q) => { let n = 0; for (const fx of [.2, .5, .8]) for (const fy of [.25, .5, .75]) { const t = document.elementFromPoint(q[0] + q[2] * fx, q[1] + q[3] * fy); if (t && (t === e || e.contains(t) || (t.tagName === 'CANVAS' && getComputedStyle(e).pointerEvents === 'none'))) n++; } return n > 0; };
    const shown = rects.map(clip).filter(Boolean).filter(seen); if (!shown.length) continue;
    const text = ([...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('') || e.value || '').trim().slice(0, 40);
    out.push({ key: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '|' + text, disabled: !!e.closest('[disabled]') || e.matches(':disabled'), color: s.color, opacity: o, rects: shown });
  } return out;`;
const HIDE = "const st = document.createElement('style'); st.id = 'hide-text'; st.textContent = '*, *::before, *::after, ::placeholder { -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }'; document.head.appendChild(st); return true;";
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const L = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
async function contrasts() {
  await sleep(400); const texts = await ev(TEXTS); await ev(HIDE); await sleep(250); const bg = decode(await shot()); await ev("document.getElementById('hide-text').remove(); return true;");
  const out = new Map();
  for (const t of texts.filter((x) => !x.disabled)) {
    const m = /rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\)/.exec(t.color); if (!m) continue;
    const c = [+m[1], +m[2], +m[3]], a = (m[4] === undefined ? 1 : +m[4]) * t.opacity, ls = [];
    for (const q of t.rects) for (let y = Math.max(0, Math.floor(q[1])); y < Math.min(bg.h, Math.ceil(q[1] + q[3])); y++) for (let x = Math.max(0, Math.floor(q[0])); x < Math.min(bg.w, Math.ceil(q[0] + q[2])); x++) { const p = bg.px(x, y); ls.push([L(p), p]); }
    if (!ls.length) continue; ls.sort((u, v) => u[0] - v[0]);
    const dark = ls[Math.floor(ls.length * 0.02)][1], light = ls[Math.min(ls.length - 1, Math.floor(ls.length * 0.98))][1], over = (b) => c.map((v, i) => v * a + b[i] * (1 - a));
    const w = Math.min(ratio(over(dark), dark), ratio(over(light), light));
    if (!out.has(t.key)) out.set(t.key, []); out.get(t.key).push(w);
  }
  return out;
}
const NOTEX = "const st = document.createElement('style'); st.id = 'notex'; st.textContent = ':root, :root[data-theme] { --tex: none !important; }'; document.head.appendChild(st); return true;";
test('row 2: the texture pushes no text under 4.5:1 in any look, in the builder and with the File menu open', { skip }, async (t) => {
  const report = [];
  for (const look of LOOKS) {
    await load(look);
    await ev("const lab = [...document.querySelectorAll('#palette *')].find((e) => e.childNodes.length && e.firstChild.nodeType === 3 && e.firstChild.textContent.trim() === 'turn °'); const i = lab && (lab.querySelector('input') || lab.parentElement.querySelector('input:not([type=checkbox])')); if (i) { i.value = '30'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); } return !!i;");
    await extend(6); await sleep(1200);
    assert.equal(await pieces(), 6, `${look}: six pieces placed`);
    for (const state of ['builder', 'file']) {
      if (state === 'file') { await ev("document.getElementById('m-file').open = true; return true;"); await sleep(250); }
      const on = await contrasts(); await ev(NOTEX); const off = await contrasts(); await ev("document.getElementById('notex').remove(); return true;");
      const pushed = []; let n = 0;
      for (const [k, list] of on) { const b = off.get(k) || []; list.forEach((w, i) => { if (i < b.length) { n++; if (w < 4.5 && b[i] >= 4.5) pushed.push(`${k.split('|')[1]} ${b[i].toFixed(2)} -> ${w.toFixed(2)}`); } }); }
      report.push(`${look} ${state}: ${n} texts compared, ${pushed.length} pushed under`);
      assert.ok(n > 20, `${look} ${state}: the probe found the page's texts (${n})`);
      assert.deepEqual(pushed, [], `${look} ${state}: texts the texture pushes under 4.5:1`);
      if (state === 'file') await ev("document.getElementById('m-file').open = false; return true;");
    }
  }
  t.diagnostic(report.join('; '));
});

test('row 3: the empty builder shows the track in characters only while there are no pieces', { skip }, async () => {
  for (const look of ['sigil', 'aurora']) {
    await load(look);
    const shown = () => ev("const e = document.getElementById('empty-art'); if (!e) return 'missing'; const r = e.getBoundingClientRect(); return !e.hidden && getComputedStyle(e).display !== 'none' && r.width > 100 && r.height > 50;");
    assert.equal(await pieces(), 0, `${look}: a fresh start has no pieces`);
    assert.equal(await shown(), true, `${look}: no pieces: the art is shown`);
    const art = await ev("const e = document.getElementById('empty-art'), p = document.createElement('p'); p.style.color = 'var(--dim)'; document.body.append(p); const dim = getComputedStyle(p).color; p.remove(); return { hidden: e.getAttribute('aria-hidden'), events: getComputedStyle(e).pointerEvents, color: getComputedStyle(e).color, dim };");
    assert.equal(art.hidden, 'true', `${look}: the art is decorative (aria-hidden)`); assert.equal(art.events, 'none', `${look}: it never takes a press`);
    assert.equal(art.color, art.dim, `${look}: it is in the look's dim colour`);
    await extend(1); await sleep(500);
    assert.equal(await shown(), false, `${look}: one piece: the art is hidden`);
    await undo(1); await sleep(500);
    assert.equal(await pieces(), 0); assert.equal(await shown(), true, `${look}: the last piece undone: shown again`);
  }
});

// D399 fixes (A's review 12): the art sits in the free area right of the left panel at every window width the app allows, and the fine tiles land one
// tile pixel per device pixel at Windows' fractional display scales
test('row 4: the empty builder\'s art never sits under the left panel: no overlap with #left at window widths 900, 1100 and 1400', { skip }, async (t) => {
  await load('sigil');
  const got = [];
  try {
    for (const w of [900, 1100, 1400]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 860, deviceScaleFactor: 1, mobile: false }); await sleep(400);
      const r = await ev("const a = document.getElementById('empty-art').getBoundingClientRect(), l = document.getElementById('left').getBoundingClientRect(); return { art: [a.left, a.right, a.top, a.bottom].map(Math.round), left: [l.left, l.right, l.top, l.bottom].map(Math.round), inner: innerWidth };");
      const overlap = Math.max(0, Math.min(r.art[1], r.left[1]) - Math.max(r.art[0], r.left[0])) * Math.max(0, Math.min(r.art[3], r.left[3]) - Math.max(r.art[2], r.left[2]));
      got.push(`${w}: art x ${r.art[0]}-${r.art[1]}, #left x ${r.left[0]}-${r.left[1]}, overlap ${overlap} px²`);
      assert.equal(overlap, 0, `window ${w}: the art (x ${r.art[0]}-${r.art[1]}) overlaps #left (x ${r.left[0]}-${r.left[1]}) by ${overlap} px²`);
      assert.ok(r.art[1] <= r.inner, `window ${w}: the art ends inside the window (${r.art[1]} of ${r.inner})`);
    }
  } finally { await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 860, deviceScaleFactor: 1, mobile: false }); }
  t.diagnostic(got.join('; '));
});

// the fine tiles' own sizes in pixels (scripts/texture_tiles.js); Aqua's soft noise has no pixel structure to keep and is sized in CSS px
const FINE = { sigil: [128, 128], skyline: [128, 128], glass: [8, 300], aurora: [3, 3] };
test('row 5: at display scales 1.25 and 1.5, each fine tile is drawn one tile pixel per device pixel (its size times the pixel ratio is its own size)', { skip }, async (t) => {
  const got = [];
  try {
    for (const scale of [1.25, 1.5]) {
      await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 860, deviceScaleFactor: scale, mobile: false });
      for (const [look, [w, h]] of Object.entries(FINE)) {
        await load(look);
        await ev("document.getElementById('m-file').open = true; await new Promise((r) => setTimeout(r, 150)); return true;");
        const sizes = await ev(`const one = (el) => getComputedStyle(el).backgroundSize.split(',')[0].trim().split(/\\s+/).map(parseFloat).map((v) => +(v * devicePixelRatio).toFixed(3));
          return { dpr: devicePixelRatio, header: one(document.querySelector('header')), left: one(document.getElementById('left')), menu: one(document.querySelector('#m-file .more-menu')) };`);
        await ev("document.getElementById('m-file').open = false; return true;");
        got.push(`${scale} ${look}: ${JSON.stringify(sizes)}`);
        for (const s of ['header', 'left', 'menu']) assert.deepEqual(sizes[s], [w, h], `${look} at ${scale}: the ${s}'s tile covers ${sizes[s].join(' x ')} device px, not its own ${w} x ${h}`);
      }
    }
  } finally { await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 860, deviceScaleFactor: 1, mobile: false }); }
  t.diagnostic(got.join('; '));
});
