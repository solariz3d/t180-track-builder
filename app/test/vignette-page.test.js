// vignette-page.test.js: node --test app/test/vignette-page.test.js   (under the heavy-run lock; about a minute)
// The rings under the view's vignette, judged on the REAL PAGE as the user saw them (the user, 2026-11-02: "a persistant render artifact below the red
// line i drew that traces it it follows me where eveer i go"; his shots were the space and underwater skins). The page (app/index.html), served from
// this checkout, in HEADLESS Chrome (never a window, muted), at 1920 x 1080, each skin chosen through Settings ▸ Theme's saved value; an empty track,
// the Free view, the camera flown back and up (S, Space and Shift held, as a person would) so the lower view is open sky under the vignette; then
// the page's own screenshot. Down columns of that lower view clear of the panels (x 300, 1500, 1700; rows 760 to 1030):
//   * the RAW column, where the vignette darkens (its k >= 0.05, from the canvas's own place on the page): no channel holds one value for more than 4
//     rows, a channel at black (0) excepted, since nothing can dither below it (before: 10 to 16 rows; 270 in aqua). Where the vignette does not reach,
//     the sky keeps its own half-step dither, which holds a value for up to about 10 rows (sky-dither.test.js allows 12); a full step there widened the
//     stars past sky-crisp.test.js, so that part of the column is reported, not judged
//   * the MEAN (a 4 x 4 block's, so the dither is averaged out): no step, i.e. no stretch of >= 12 rows held within 0.25 of a level that then moves
//     >= 0.6 of a level within 6 rows (before: 6 such steps at x 1700 with the first renderer vignette, whose blend rounded the darkened sky with no
//     dither; app/preview/renderer.js THE VIGNETTE)
// Skipped, with the reason, where there is no Chrome, and on GitHub's runner (the page does not mount there in time; test/on_github.js). Rows: 1 glass, 2 aqua.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const { chromePath, launchChrome, connect } = require('./soundrender.js');

const REPO = path.join(__dirname, '..', '..');
const CHROME = chromePath();
const skip = (CHROME ? false : 'no Chrome here (set CHROME_PATH): the page is drawn in headless Chrome') || require('../../test/on_github.js').onGitHub('the page does not mount within the wait on the shared runner (as texture-page)');
const W = 1920, H = 1080, COLS = [300, 1500, 1700], Y0 = 760, Y1 = 1030;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.cjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.css': 'text/css' };

/** Chrome's screenshot PNG (8-bit RGB or RGBA, not interlaced) as { w, h, px } with 4 bytes a pixel. */
function decode(buf) {
  let p = 8, w, h, ct; const idat = [];
  while (p < buf.length) { const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); if (d[8] !== 8 || d[12] !== 0) throw new Error('png: not 8-bit, not interlaced'); ct = d[9]; }
    else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break; p += 12 + len; }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0; if (!bpp) throw new Error(`png: colour type ${ct}`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(w * h * 4), stride = w * bpp; let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      line[i] = (line[i] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) out[(y * w + x) * 4 + k] = k < bpp ? line[x * bpp + k] : 255;
    prev = line;
  }
  return { w, h, px: out };
}
/** the vignette's k at a page pixel, from the canvas's rectangle (renderer.js VIGNETTE_K: centre 55% across and 38% down, radii 120% and 90%) */
const kAt = (r, x, y) => { const u = (x + 0.5 - r.x) / r.w, v = 1 - (y + 0.5 - r.y) / r.h, d = Math.hypot((u - 0.55) / 1.2, (v - 0.62) / 0.9); return 0.55 * Math.min(1, Math.max(0, (d - 0.55) / 0.45)); };
/** Down column x, rows y0..y1: the longest run of one value in any channel where the vignette darkens (a run at 0 excepted), the same over the whole
 *  column (reported only), and the 4 x 4 mean's steps (per channel, summed). */
function column(img, rect, x, y0, y1) {
  let longest = 0, whole = 0, steps = 0;
  for (let ch = 0; ch < 3; ch++) {
    let n = 1, m = 1;
    for (let y = y0 + 1; y < y1; y++) {
      const v = img.px[(y * img.w + x) * 4 + ch], same = v === img.px[((y - 1) * img.w + x) * 4 + ch];
      m = same ? m + 1 : 1; whole = Math.max(whole, m);
      n = same && v > 0 && kAt(rect, x, y) >= 0.05 && kAt(rect, x, y - 1) >= 0.05 ? n + 1 : 1; longest = Math.max(longest, n);
    }
    const mean = []; for (let y = y0; y < y1; y++) { let s = 0; for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) s += img.px[((y + j) * img.w + x + k) * 4 + ch]; mean.push(s / 16); }
    for (let i = 12; i + 6 < mean.length; i++) { const held = mean.slice(i - 12, i).every((v) => Math.abs(v - mean[i - 12]) <= 0.25); if (held && Math.abs(mean[i + 6] - mean[i]) >= 0.6) { steps++; i += 12; } }
  }
  return { longest, whole, steps };
}

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
  let tgt; ({ ch, dir, tgt } = await launchChrome(CHROME, ['--hide-scrollbars', `--window-size=${W},${H}`], 't180vigpage-'));
  ({ ws, send } = await connect(tgt.webSocketDebuggerUrl));
  ev = async (expr) => { const d = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (!d.result || d.result.exceptionDetails) throw new Error(`page: ${JSON.stringify(d.result ? d.result.exceptionDetails : d)}`); return d.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
});
test.after(async () => { try { ws && ws.close(); } catch (e) { /* closing */ } if (ch) ch.kill(); if (srv) srv.close(); await sleep(300); try { dir && fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may hold it */ } });

/** the page in `look`, the Free view flown back and up, its screenshot decoded */
async function shot(look) {
  await send('Page.navigate', { url: base.replace('index.html', 'lib/cjs.js') }); await sleep(300);
  await ev(`localStorage.clear(); localStorage.setItem('t180.settings.theme', ${JSON.stringify(JSON.stringify(look))}); return true;`);
  await send('Page.navigate', { url: base });
  for (let i = 0; i < 150; i++) { await sleep(200); try { if (await ev("return document.documentElement.dataset.menubar === 'ready';")) break; } catch (e) { /* loading */ } }
  await ev("document.title = 'zz-headless-test'; return true;");
  assert.equal(await ev("return document.documentElement.dataset.menubar || 'not mounted';"), 'ready', `${look}: the menus mounted`);
  assert.equal(await ev("return document.documentElement.getAttribute('data-theme');"), look, `${look}: the skin is on`);
  await ev("const b = [...document.querySelectorAll('#guide button')].find((x) => x.textContent.trim() === '✕'); if (b) b.click(); return true;"); await sleep(300);
  assert.ok(await ev("const b = [...document.querySelectorAll('#camera button')].find((x) => x.textContent.trim() === 'Free'); if (b) b.click(); return !!b;"), 'the Free view is chosen');
  await sleep(1000);
  const key = (type, code, k, vk) => send('Input.dispatchKeyEvent', { type, code, key: k, windowsVirtualKeyCode: vk, modifiers: 0 });
  await key('keyDown', 'ShiftLeft', 'Shift', 16); await key('keyDown', 'KeyS', 's', 83); await key('keyDown', 'Space', ' ', 32); await sleep(4000);
  await key('keyUp', 'Space', ' ', 32); await key('keyUp', 'KeyS', 's', 83); await key('keyUp', 'ShiftLeft', 'Shift', 16); await sleep(1500);
  const pose = await ev("let got = null; document.dispatchEvent(new CustomEvent('t180:view', { detail: { reply: (v) => { got = v; } } })); return got && got.pose;");
  assert.ok(pose && pose.eye[1] > 20, `${look}: the camera flew up (eye ${JSON.stringify(pose && pose.eye)}), so the lower view is open sky`);
  const rect = await ev("const r = document.querySelector('#preview canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };");
  return { img: decode(Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')), rect };
}

for (const [row, look] of [[1, 'glass'], [2, 'aqua']]) {
  test(`row ${row}: ${look}, the lower view under the vignette: where it darkens no channel holds one value for more than 4 rows, and the 4 x 4 mean never steps`, { skip }, async (t) => {
    const { img, rect } = await shot(look), got = {};
    for (const x of COLS) got[x] = column(img, rect, x, Y0, Y1);
    t.diagnostic(`${look}: ${JSON.stringify(got)}`);
    for (const x of COLS) {
      assert.ok(got[x].longest <= 4, `${look}, x ${x}: one value held for ${got[x].longest} rows (all: ${JSON.stringify(got)})`);
      assert.equal(got[x].steps, 0, `${look}, x ${x}: the mean steps ${got[x].steps} times (all: ${JSON.stringify(got)})`);
    }
  });
}
