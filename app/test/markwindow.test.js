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
// L251: the windows are elements (app/core/markwindow.js layer), no longer drawn on a canvas. A stage just big enough for the layer, and the one window it shows for
// a box; win.matchMedia answers prefers-reduced-transparency (reduce: true or false)
function shownWindow(T, box, lines, colour, opts, { reduce = false } = {}) {
  const el = (tag) => ({ tagName: tag.toUpperCase(), style: {}, attrs: {}, children: [], setAttribute(k, v) { this.attrs[k] = String(v); }, append(...k) { this.children.push(...k); }, remove() { this.gone = true; }, isConnected: true, textContent: '' });
  const stage = { ownerDocument: { createElement: el }, append() {}, isConnected: true };
  const win = { matchMedia: (q) => ({ matches: reduce && q === '(prefers-reduced-transparency: reduce)', addEventListener() {}, removeEventListener() {} }) };
  const L = MW.layer(stage, win, T); L.begin(); L.put(box, lines, colour, opts); L.end();
  return L.nodes()[0];
}
const LOOKS = ['sigil', ...TH.LOOKS];

// W1 and W2 AMENDED BY NAME (L251, the rule changed: a window is an element over the view, so its look is read off the element's style, not off canvas calls; every
// promise is kept: the look's own font and corner, no two looks alike; with no tokens, square, the veil, the 1.5 px edge in the mark's colour, the type, the words at
// +6 px, lit 2.5 px. One promise moved with the packet's item 5: a page that sets no blur shows the veil SOLID, where the canvas drew it at 0.92)
test('W1: each look\'s window takes that look\'s own font and corner radius (read from its tokens, shown)', () => {
  const seen = {};
  for (const look of LOOKS) {
    const T = tokensFor(look), v = varsOf(look), w = shownWindow(T, { x: 10, y: 10, w: 200, h: 42 }, ['Extra bank · 380.00 m', 'drag to start earlier or later'], '#4d86ff', { edge: 1.5 });
    assert.ok(v['--mark-win-font'], `${look} sets its window font`);
    assert.equal(w.style.font, `${v['--mark-win-weight'] || 'bold'} 12px ${v['--mark-win-font']}`, `${look}: the font shown is its own`);
    const r = Number(v['--mark-win-radius']);
    assert.equal(w.style.borderRadius, `${r}px`, `${look}: its box is rounded at ${r} px (0: square corners)`);
    assert.equal(w.textContent, 'Extra bank · 380.00 m\ndrag to start earlier or later', `${look}: its two lines`);
    seen[look] = `${w.style.font}|${r}|${v['--mark-win-bg'] || ''}|${v['--mark-win-glow'] || ''}`;
  }
  assert.equal(new Set(Object.values(seen)).size, LOOKS.length, `no two looks draw the same window: ${JSON.stringify(seen)}`);
});

test('W2: a page with no window tokens shows today\'s box: square, the veil (solid, since it sets no blur: L251), a 1.5 px edge in the mark\'s colour, bold 12px system-ui, the words at +6 px', () => {
  const T = createTokens(winOf({}), { log: () => {} }), w = shownWindow(T, { x: 0, y: 0, w: 100, h: 24 }, ['one'], '#b968ff', { edge: 1.5 });
  assert.equal(w.textContent, 'one'); assert.equal(w.style.borderRadius, '0px', 'square');
  assert.equal(w.style.background, '#0b0d11', 'the veil, solid'); assert.equal(w.style.backdropFilter, 'none', 'nothing blurred');
  assert.equal(w.style.boxShadow, 'inset 0 0 0 1.5px #b968ff', 'a 1.5 px edge in the mark\'s colour, and no glow, sheen or shade');
  assert.equal(w.style.font, 'bold 12px system-ui, "Segoe UI", sans-serif'); assert.match(w.style.padding, / 6px$/, 'the words at +6 px');
  const lit = shownWindow(T, { x: 0, y: 0, w: 100, h: 24 }, ['one'], '#b968ff', { edge: 1.5, lit: true }); assert.equal(lit.style.boxShadow, 'inset 0 0 0 2.5px #b968ff', 'lit: 2.5, as before');
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

// L244 (the user, 2026-11-26 02:23: "yes handle colors per theme"): each look's own mark colours
const FIELDS = ['bank', 'turn', 'climb', 'width', 'cup', 'length', 'edge'];
const TODAY = { bank: '#4d86ff', turn: '#b968ff', climb: '#ffd23d', width: '#ff5a5a', cup: '#3ddc6e', length: '#ffffff', edge: '#3fd0c9' };
const rgbDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('W5: every look sets its own colour for each field, no two fields within 60 of each other (W4\'s unit), and each 60 or more off that look\'s road edges, grid, fog and sky', () => {
  const seen = new Set();
  for (const look of LOOKS) {
    const v = varsOf(look), T = tokensFor(look), c = {};
    for (const f of FIELDS) { assert.ok(v[`--mark-${f}`], `${look} sets --mark-${f}`); c[f] = T.rgba(`--mark-${f}`, TODAY[f]).slice(0, 3); }
    for (const [i, f] of FIELDS.entries()) for (const g of FIELDS.slice(i + 1)) assert.ok(rgbDist(c[f], c[g]) >= 60, `${look}: ${f} ${c[f]} and ${g} ${c[g]} are ${rgbDist(c[f], c[g]).toFixed(0)} apart`);
    for (const n of ['--road-edge', '--ground-grid', '--fog', '--sky']) {
      assert.ok(v[n], `${look} sets ${n}`); const back = T.floats(n, [0.5, 0.5, 0.5]).map((x) => x * 255);
      for (const f of FIELDS) assert.ok(rgbDist(c[f], back) >= 60, `${look}: ${f} ${c[f]} stands ${rgbDist(c[f], back).toFixed(0)} off ${n}`);
    }
    seen.add(FIELDS.map((f) => c[f].join(',')).join('|'));
  }
  assert.equal(seen.size, LOOKS.length, 'no two looks share their colours');
});

test('W6: a field\'s hue, wherever it comes from (Build, the landing, the Sculpt brush and Smooth\'s channel, the dots\' rows), draws as the look\'s colour for that field; a hue with no field, and every hue on a page with no tokens, as it is', () => {
  const none = createTokens(winOf({}), { log: () => {} }), set = createTokens(winOf({ '--mark-bank': '#000001', '--mark-turn': '#000002', '--mark-climb': '#000003', '--mark-width': '#000004', '--mark-cup': '#000005', '--mark-length': '#000006', '--mark-edge': '#000007' }), { log: () => {} });
  for (const [kind, want] of [['brush-twist', '#000001'], ['brush-bend', '#000002'], ['brush-climb', '#000003'], ['brush-width', '#000004'], ['brush-wall', '#000004'], ['brush-cup', '#000005'], ['brush-edge', '#000005'], ['landturn', '#000002'], ['landup', '#000003'], ['landfwd', '#000006'], ['landleft', '#ff9f43']]) {
    assert.equal(HD.paintOf(set, kind), want, `${kind}`); assert.equal(HD.paintOf(none, kind), HD.KINDS[kind].colour, `${kind}, no tokens: today's`);
  }
  assert.equal(HD.hueOf(set, HD.BRUSH_CHANNELS.phi.colour), '#000001', 'Smooth on bank'); assert.equal(HD.hueOf(set, HD.BRUSH_CHANNELS.lateral.colour), '#ffb020', 'the brush\'s sideways: no field');
  assert.equal(HD.hueOf(set, '#3FD0C9'), '#000007', 'the edge, in any case'); assert.equal(HD.hueOf(set, null), null); assert.equal(HD.hueOf(set, undefined), undefined);
  // drawn: a stage whose page sets the tokens; the dots' rows (white, red with the green inner half, green) and a bank brush glyph Smooth paints, through handles.js's own draw
  const strokes = [], ctx = new Proxy({ measureText: (t) => ({ width: String(t).length * 7 }), strokes }, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, val) => { if (k === 'strokeStyle') strokes.push(val); o[k] = val; return true; } });
  const vars = { '--mark-bank': '#000001', '--mark-width': '#000004', '--mark-cup': '#000005', '--mark-length': '#000006' }, frames = [];
  const canvas = { style: {}, setAttribute() {}, getContext: () => ctx, remove() {}, isConnected: true };
  // (L251: the brush box is an element now: the fixture's document gives one for any tag but the canvas)
  const box = (t) => ({ tagName: t.toUpperCase(), style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, append() {}, remove() {}, isConnected: true, textContent: '' });
  const stage = { clientWidth: 900, clientHeight: 600, style: {}, ownerDocument: { createElement: (t) => (t === 'canvas' ? canvas : box(t)) }, getBoundingClientRect: () => ({ left: 0, top: 0 }), isConnected: true, append() {}, addEventListener() {}, removeEventListener() {} };
  const win = { ...winOf(vars), devicePixelRatio: 1, requestAnimationFrame: (f) => { frames.push(f); return frames.length; }, cancelAnimationFrame() {} };
  const samples = Array.from({ length: 41 }, (_, i) => ({ s: i * 5, pos: [0, 0, i * 5], T: [0, 0, 1], L: [1, 0, 0], U: [0, 1, 0] }));
  const dots = { stations: Array.from({ length: 33 }, (_, i) => 40 + i * 5), run: { s0: 40, s1: 200 }, radius: 60, rows: [{ u: 0, colour: '#ffffff' }, { u: 1, colour: '#ff5a5a', inner: '#3ddc6e' }, { u: 0.5, colour: '#3ddc6e' }], at: (s, u) => ({ pos: [u * 10, 0, s], U: [0, 1, 0], L: [1, 0, 0] }) };
  const model = { samples, s0: 40, s1: 200, half: () => 10, kinds: ['brush-twist'], base: () => 0, ctx: () => ({ half: 10 }), dots, brush: { samples, s: 100, half: 10, colour: HD.BRUSH_CHANNELS.phi.colour } };
  const ov = HD.mount(stage, win, { model: () => model, pose: () => ({ eye: [0, 60, -40], target: [0, 0, 120], up: [0, 1, 0], fov: 60 * Math.PI / 180 }), begin() {}, apply() {}, end() {} });
  frames.splice(0).forEach((f) => f(0));
  assert.ok(ov.dots().length > 0 && ov.handles().some((h) => h.brush), 'dots and the glyph are laid out');
  for (const [lit, want] of [['#ffffff', '#000006'], ['#ff5a5a', '#000004'], ['#3ddc6e', '#000005'], ['#4d86ff', '#000001']]) {
    assert.ok(strokes.includes(want), `${want} is drawn (${lit}'s field)`); assert.ok(!strokes.includes(lit), `${lit} itself is not`);
  }
  ov.unmount();
});

// L249 (the chrome refactor; the packet: "Put their radius on the scale (r1 x the look's factor) and leave fill, sheen and glow as they are"): a label window's corner is
// the chrome's smallest step, r1 (2 px at factor 1), times the look's own --radius-factor. It is a plain number, since the canvas reads it with parseFloat (markwindow.js)
test('W7: each look\'s window corner is the chrome scale\'s r1 (2 px) times that look\'s radius factor, written as a plain number', () => {
  const got = {}, want = {};
  for (const look of LOOKS) {
    const v = varsOf(look);
    got[look] = v['--mark-win-radius']; want[look] = String(2 * Number(v['--radius-factor']));
    assert.match(String(v['--radius-factor']), /^\d+(\.\d+)?$|^\.\d+$/, `${look} sets its --radius-factor`);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(got).map(([k, x]) => [k, String(Number(x))])), want, 'the label window\'s radius per look');
});

// L251 (the user, 2026-11-26 04:49, on the blur mock: "I like the blur i think..."; the packet: each look's own blur, taken from its own panel's): a window is an element, so
// what is behind it is blurred. Each look's --mark-win-blur is its #left's backdrop-filter, word for word (SIGIL's in app/index.html, a skin's under its [data-theme]);
// under prefers-reduced-transparency, or where a page sets no blur (W2), the fill is solid and nothing is blurred
const css = (f) => fs.readFileSync(path.join(ADIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
function panelBlur(look) {
  const src = look === 'sigil' ? css('index.html') : css(path.join('themes', `${look}.css`)), head = look === 'sigil' ? '(?:^|[\\s}])' : `\\[data-theme="${look}"\\]\\s+`;
  const blocks = [...src.matchAll(new RegExp(`${head}#left\\s*\\{([^{}]*)\\}`, 'g'))].map((m) => /(?:^|;)\s*backdrop-filter\s*:\s*([^;]+);/.exec(m[1])).filter(Boolean);
  assert.equal(blocks.length, 1, `${look}: one #left rule sets a backdrop-filter`);
  return blocks[0][1].trim();
}
test('W8: each look\'s window blurs what is behind it with that look\'s own panel blur (its #left\'s backdrop-filter, word for word); under prefers-reduced-transparency the fill is solid and nothing is blurred', () => {
  const got = {};
  for (const look of LOOKS) {
    const v = varsOf(look), T = tokensFor(look), want = panelBlur(look);
    assert.equal(v['--mark-win-blur'], want, `${look}: --mark-win-blur is its panel's blur`);
    const w = shownWindow(T, { x: 10, y: 10, w: 200, h: 24 }, ['bank 12.00°'], '#4d86ff', { edge: 1.5 });
    assert.equal(w.style.backdropFilter, want, `${look}: the window blurs what is behind it`); assert.equal(w.style.webkitBackdropFilter, want);
    assert.equal(w.style.background, T.css('--mark-win-bg', T.alpha('--veil', 0.92, '#0b0d11')), `${look}: its own fill, as the canvas drew it (SIGIL's: the veil at 0.92)`);
    const r = shownWindow(T, { x: 10, y: 10, w: 200, h: 24 }, ['bank 12.00°'], '#4d86ff', { edge: 1.5 }, { reduce: true });
    assert.equal(r.style.backdropFilter, 'none', `${look}, less transparency: no blur`);
    assert.equal(r.style.background, T.solid('--mark-win-bg', T.solid('--veil', '#0b0d11')), `${look}, less transparency: the fill solid`); assert.match(r.style.background, /^#[0-9a-f]{6}$/);
    got[look] = want;
  }
  assert.equal(new Set(Object.values(got)).size >= 5, true, `the looks' blurs: ${JSON.stringify(got)}`);
});

test('W9: a window already shown takes a new look at once, without another draw: the skin changed (the tokens refreshed), or the person asked for less transparency', () => {
  const vars = { ...varsOf('aqua') }, T = createTokens(winOf(vars), { log: () => {} }), listeners = [], q = { matches: false, addEventListener: (t, f) => listeners.push(f), removeEventListener() {} };
  const el = (tag) => ({ tagName: tag.toUpperCase(), style: {}, attrs: {}, children: [], setAttribute(k, v) { this.attrs[k] = String(v); }, append(...k) { this.children.push(...k); }, remove() { this.gone = true; }, isConnected: true, textContent: '' });
  const L = MW.layer({ ownerDocument: { createElement: el }, append() {}, isConnected: true }, { matchMedia: () => q }, T);
  L.begin(); L.put({ x: 1, y: 2, w: 90, h: 24 }, ['width 31.00 m'], '#ff5a5a', { edge: 1.5 }); L.end();
  const w = L.nodes()[0]; assert.equal(w.style.backdropFilter, 'blur(14px) saturate(170%)');
  Object.assign(vars, varsOf('aurora')); T.refresh();
  assert.equal(w.style.backdropFilter, 'blur(16px) saturate(1.4)', 'the skin changed: the shown window is aurora\'s'); assert.equal(w.style.borderRadius, '1.5px');
  q.matches = true; listeners.forEach((f) => f());
  assert.equal(w.style.backdropFilter, 'none', 'less transparency: no blur'); assert.match(w.style.background, /^#[0-9a-f]{6}$/, 'and the fill solid');
  assert.equal(w.textContent, 'width 31.00 m'); assert.equal(w.style.left, '1px'); assert.equal(w.style.display, 'block', 'the same window, still shown where it was');
  L.remove();
});
