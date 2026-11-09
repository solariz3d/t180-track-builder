// level-refusal-page.test.js: node --test app/test/level-refusal-page.test.js   (headless Chrome, muted, titled zz-headless-test)
// The user, 2026-11-09, on Level: "throw a turn or climb into it, and it just disappears". Reproduced on the installed build at a 1536 x 864 window: with
// a piece selected the side panel is long, the refusal's words are written at its foot, below the window's edge, and nothing on screen changes. The
// rule: a refusal always says why ON SCREEN. The page (app/index.html) is served from the repository; his track (test/fixtures/level-end-2026-11-09.t180track)
// is opened by its share code, its last piece selected the page's own way (a click on the track, its pick answered inside that piece), a turn of −540
// typed over a 100 m piece (which cannot be laid without the road passing too close over itself), and Build ▸ Level pressed.
//   1  the refusal's words are in the panel, inside the window, and are what is drawn at their own middle (not under anything, not scrolled away)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http'), fs = require('fs'), path = require('path');
const { chromePath, launchChrome, connect } = require('./soundrender.js');
const D = require('../../src/core/document.js'), C = require('../../src/doc/code.js');

const REPO = path.join(__dirname, '..', '..');
const CHROME = chromePath();
const skip = (CHROME ? false : 'no Chrome here (set CHROME_PATH): the page is drawn in headless Chrome') || require('../../test/on_github.js').onGitHub('the page does not mount within the wait on the shared runner (as texture-page)');
const W = 1536, H = 864;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.cjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.css': 'text/css' };
const CODE = C.coreToCode(D.parse(fs.readFileSync(path.join(REPO, 'test', 'fixtures', 'level-end-2026-11-09.t180track'), 'utf8')));

let srv, ch, ws, dir, base, send, ev;
test.before(async () => {
  if (skip) return;
  srv = http.createServer((q, s) => {
    const p = path.normalize(path.join(REPO, decodeURIComponent(q.url.split('?')[0])));
    if (!p.startsWith(REPO)) { s.writeHead(403); s.end(); return; }
    fs.readFile(p, (e, b) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); s.end(b); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}/app/index.html`;
  let tgt; ({ ch, dir, tgt } = await launchChrome(CHROME, ['--hide-scrollbars', `--window-size=${W},${H}`], 't180levelref-'));
  ({ ws, send } = await connect(tgt.webSocketDebuggerUrl));
  ev = async (expr) => { const d = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (!d.result || d.result.exceptionDetails) throw new Error(`page: ${JSON.stringify(d.result ? d.result.exceptionDetails : d)}`); return d.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
});
test.after(async () => { try { ws && ws.close(); } catch (e) { /* closing */ } if (ch) ch.kill(); if (srv) srv.close(); await sleep(300); try { dir && fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may hold it */ } });

test('row 1: Level refused with a piece selected says why on screen, in a 1536 x 864 window', { skip }, async () => {
  await send('Page.navigate', { url: base });
  for (let i = 0; i < 150; i++) { await sleep(200); try { if (await ev("return document.documentElement.dataset.menubar === 'ready';")) break; } catch (e) { /* loading */ } }
  await ev("document.title = 'zz-headless-test'; return true;");
  await ev("const b = [...document.querySelectorAll('#guide button')].find((x) => x.textContent.trim() === '✕'); if (b) b.click(); return true;");
  const opened = await ev(`const box = [...document.querySelectorAll('textarea')].find((t) => t.placeholder === 'paste a track code here'), b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Paste track code…');
    box.value = ${JSON.stringify(CODE)}; b.click(); await new Promise((r) => setTimeout(r, 1500)); return box.parentNode.textContent;`);
  assert.match(opened, /opened "untitled" from its code/, 'control: his track is open');
  const selected = await ev(`const st = document.getElementById('preview'), at = (e) => e.detail.reply({ s: 2500 }); document.addEventListener('t180-pick', at);
    const c = st.querySelector('canvas') || st, r = c.getBoundingClientRect(), o = { bubbles: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1 };
    c.dispatchEvent(new PointerEvent('pointerdown', o)); c.dispatchEvent(new PointerEvent('pointerup', o)); document.removeEventListener('t180-pick', at); await new Promise((r) => setTimeout(r, 800));
    return [...document.querySelectorAll('p.head')].map((x) => x.textContent).join(' | ');`);
  assert.match(selected, /Selected: p3/, `control: his last piece is selected (${selected})`);
  await ev(`const fld = (t) => [...document.querySelectorAll('span')].find((x) => x.textContent === t && x.getBoundingClientRect().width > 0).parentNode.querySelector('input');
    for (const [t, v] of [['length m', '100'], ['turn °', '-540']]) { const f = fld(t); f.value = v; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); } return true;`);
  await sleep(800);
  assert.equal(await ev("const m = document.querySelector('p.message[role=status]'); return m.textContent;"), '', 'control: no message before Level');
  await ev(`const top = [...document.querySelectorAll('button, summary')].find((x) => /^Build/.test(x.textContent.trim()) && x.getBoundingClientRect().top < 60); top.click(); await new Promise((r) => setTimeout(r, 500));
    [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Level' && x.getBoundingClientRect().width > 0 && x.getBoundingClientRect().top > 40).click(); return true;`);
  let seen = null;
  for (let i = 0; i < 50 && !(seen && seen.text); i++) {
    await sleep(200);
    seen = await ev(`const m = document.querySelector('p.message[role=status]'), r = m.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + Math.min(r.height, 16) / 2, at = document.elementFromPoint(x, y);
      return { text: m.textContent, rect: [r.left, r.top, r.width, r.height], drawn: !!at && (at === m || m.contains(at)) };`);
  }
  assert.ok(seen.text, 'Level was refused, with words');
  const [, top, , h] = seen.rect;
  assert.ok(top >= 0 && top + Math.min(h, 16) <= H, `the refusal is inside the window: its top at ${Math.round(top)} px of ${H} ("${seen.text.slice(0, 60)}…")`);
  assert.ok(seen.drawn, 'and it is what is drawn there');
});
