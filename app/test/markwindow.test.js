// markwindow.test.js: node --test app/test/markwindow.test.js
// L242 (the user, 2026-11-26 00:58: "we should also incorporate the themes for those windows for each theme u know?"): the small windows on the view (a mark's label,
// a handle's readout) and the marks' colours are each theme's own, through tokens that app/core/markwindow.js reads. These rows read the REAL tokens: SIGIL's :root in
// app/index.html and each skin's [data-theme] blocks in app/themes/<look>.css, var() substituted as the browser does, through app/lib/tokens.js itself.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ADIR = path.join(__dirname, '..');
const MW = require('../core/markwindow.js');
const HD = require('../core/handles.js');
const { createTokens } = require('../lib/tokens.js');
const TH = require('../lib/theme.js');

// a theme's custom properties: SIGIL's :root, then (for a skin) its own blocks over them; var(--x) resolved against the same map
function varsOf(look) {
  const html = fs.readFileSync(path.join(ADIR, 'index.html'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rootBlock = /:root\s*\{([\s\S]*?)\}/.exec(html)[1], vars = {};
  const take = (body) => { for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim(); };
  take(rootBlock);
  if (look !== 'sigil') { const css = fs.readFileSync(path.join(ADIR, 'themes', `${look}.css`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); for (const m of css.matchAll(new RegExp(`\\[data-theme="${look}"\\]\\s*\\{([^{}]*)\\}`, 'g'))) take(m[1]); }
  const resolve = (v, depth = 0) => (depth > 5 ? v : v.replace(/var\((--[\w-]+)(?:,\s*([^)]*))?\)/g, (all, n, fb) => (n in vars ? resolve(vars[n], depth + 1) : fb || '')));
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, resolve(v)]));
}
const winOf = (vars) => { const el = {}; return { document: { documentElement: el }, getComputedStyle: () => ({ getPropertyValue: (n) => vars[n] || '' }), console: { error() {} } }; };
const tokensFor = (look) => createTokens(winOf(varsOf(look)), { log: () => {} });
// a context that records what one window draws
function ctxRec() {
  const rec = { calls: [], font: null, lineWidths: [], round: [] };
  const ctx = { set font(v) { rec.font = v; }, get font() { return rec.font; }, set lineWidth(v) { rec.lineWidths.push(v); }, get lineWidth() { return rec.lineWidths.at(-1); },
    fillStyle: '', strokeStyle: '', shadowColor: '', shadowBlur: 0, shadowOffsetY: 0, textBaseline: '',
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {}, closePath() {}, fill() { rec.calls.push('fill'); }, stroke() { rec.calls.push('stroke'); },
    roundRect(x, y, w, h, r) { rec.round.push(r); }, fillRect() { rec.calls.push('fillRect'); }, strokeRect() { rec.calls.push('strokeRect'); }, fillText(t) { rec.calls.push(`text:${t}`); } };
  return { ctx, rec };
}
const LOOKS = ['sigil', ...TH.LOOKS];

test('W1: each look\'s window takes that look\'s own font and corner radius (read from its tokens, drawn)', () => {
  const seen = {};
  for (const look of LOOKS) {
    const T = tokensFor(look), v = varsOf(look), { ctx, rec } = ctxRec();
    MW.drawWindow(ctx, T, { x: 10, y: 10, w: 200, h: 42 }, ['Extra bank · 380.00 m', 'drag to start earlier or later'], '#4d86ff', { edge: 1.5 });
    assert.ok(v['--mark-win-font'], `${look} sets its window font`);
    assert.equal(rec.font, `${v['--mark-win-weight'] || 'bold'} 12px ${v['--mark-win-font']}`, `${look}: the font drawn is its own`);
    const r = Number(v['--mark-win-radius']);
    if (r > 0) assert.deepEqual(rec.round, [r, r], `${look}: its box is rounded at ${r} px (fill and edge)`);
    else assert.ok(rec.calls.includes('fillRect') && rec.calls.includes('strokeRect'), `${look}: square corners`);
    seen[look] = `${rec.font}|${r}|${v['--mark-win-bg'] || ''}|${v['--mark-win-glow'] || ''}`;
  }
  assert.equal(new Set(Object.values(seen)).size, LOOKS.length, `no two looks draw the same window: ${JSON.stringify(seen)}`);
});

test('W2: a page with no window tokens draws today\'s box: square, the veil, a 1.5 px edge in the mark\'s colour, bold 12px system-ui, the words at +6 px', () => {
  const T = createTokens(winOf({}), { log: () => {} }), { ctx, rec } = ctxRec();
  MW.drawWindow(ctx, T, { x: 0, y: 0, w: 100, h: 24 }, ['one'], '#b968ff', { edge: 1.5 });
  assert.deepEqual(rec.calls, ['fillRect', 'strokeRect', 'text:one']);
  assert.equal(rec.font, 'bold 12px system-ui, "Segoe UI", sans-serif'); assert.deepEqual(rec.lineWidths, [1.5]);
  const lit = ctxRec(); MW.drawWindow(lit.ctx, T, { x: 0, y: 0, w: 100, h: 24 }, ['one'], '#b968ff', { edge: 1.5, lit: true }); assert.deepEqual(lit.rec.lineWidths, [2.5], 'lit: 2.5, as before');
});

test('W3: a look that sets no mark colours draws today\'s; a --mark-<field> token is what the field, its extra handles and its corner kind draw', () => {
  const none = createTokens(winOf({}), { log: () => {} });
  for (const [kind, c] of [['bank', '#4d86ff'], ['turn', '#b968ff'], ['turnDeg', '#b968ff'], ['climbDeg', '#ffd23d'], ['width', '#ff5a5a'], ['cup', '#3ddc6e'], ['length', '#ffffff'], ['extra:bank:0', '#4d86ff'], ['extra:turnDeg:1', '#b968ff']])
    assert.equal(HD.paintOf(none, kind), c, `${kind}: today's`);
  const set = createTokens(winOf({ '--mark-bank': '#123456', '--mark-turn': '#654321' }), { log: () => {} });
  assert.equal(HD.paintOf(set, 'bank'), '#123456'); assert.equal(HD.paintOf(set, 'extra:bank:2'), '#123456');
  assert.equal(HD.paintOf(set, 'turnDeg'), '#654321'); assert.equal(HD.paintOf(set, 'extra:turnDeg:0'), '#654321'); assert.equal(HD.paintOf(set, 'width'), '#ff5a5a', 'a field the look leaves alone stays today\'s');
});

test('W4: on every look, bank and turn are told apart (their colours at least 60 apart in RGB), and each window\'s words read on its fill (contrast 4.5:1 or better)', () => {
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  for (const look of LOOKS) {
    const T = tokensFor(look), b = T.rgba('--mark-bank', HD.paintOf(T, 'bank')), t = T.rgba('--mark-turn', HD.paintOf(T, 'turn'));
    assert.ok(Math.hypot(b[0] - t[0], b[1] - t[1], b[2] - t[2]) >= 60, `${look}: bank ${b} and turn ${t} are apart`);
    // the fill over the road: taken as opaque here (its alpha is .8 or more on every look), the words over it
    const fill = T.rgba('--mark-win-bg', T.alpha('--veil', 0.92, '#0b0d11')), text = T.rgba('--mark-win-text', T.css('--on-ink', '#eef1f6'));
    const [hi, lo] = [lum(fill), lum(text)].sort((p, q) => q - p);
    assert.ok((hi + 0.05) / (lo + 0.05) >= 4.5, `${look}: its words on its window read at ${((hi + 0.05) / (lo + 0.05)).toFixed(2)}:1`);
  }
});
