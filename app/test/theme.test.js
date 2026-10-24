// theme.test.js: node --test app/test/theme.test.js
// D381 part 2a (pane B): a skin per melody. The melody the launch picked sets <html data-theme> (app/lib/theme.js), before the first paint from the same
// pick the player uses; the canvas layers and the 3D view read their colours from the page's tokens (app/lib/tokens.js) instead of literals. Stated first:
//   · aqua, skyline, glass and aurora each set their own skin; any other name, or none, leaves SIGIL (no data-theme)
//   · the head script and the player draw the SAME melody from one number
//   · the reader understands every colour form a skin may write, falls back to today's literal when the page has no token (and says so, once), and
//     reads again when data-theme changes
//   · SIGIL's tokens ARE today's literals, so SIGIL draws exactly as before: the 3D view's calls are identical with and without the tokens
//   · (D394) Settings ▸ Theme: the head reads the saved choice; a fixed theme sets its own skin and its own melody, music (or nothing saved, or saved text
//     that is broken) keeps the random pick, sigil keeps the random melody under SIGIL; the head never throws
//   · (D405) Skyline Night: a sixth look on Skyline's melody (the melodies stay four): its own skin, chosen by name or landed on by the random pick in the
//     lower half of Skyline's quarter, and the boot keeps it over the player's skyline melody
//   · (D402) SIGIL has its own melody, Obsidian, sound.js's fifth ('sigil'): saved, SIGIL plays it; the random pick lands on SIGIL's look and melody in the
//     last fifth; SIGIL is still no skin (no data-theme). The skins stay four, so THEMES is MELODY_NAMES without 'sigil'
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const ADIR = process.env.APP_DIR || path.join(__dirname, '..');
const TH = require(path.join(ADIR, 'lib', 'theme.js'));
const TK = require(path.join(ADIR, 'lib', 'tokens.js'));
const R = require(path.join(ADIR, 'preview', 'renderer.js'));
const SOUND = require(path.join(ADIR, 'sound.js'));
const HTML = fs.readFileSync(path.join(ADIR, 'index.html'), 'utf8');

/** A stand-in <html> element: attributes only. */
function fakeRoot() {
  const attrs = new Map();
  return { setAttribute: (k, v) => attrs.set(k, String(v)), removeAttribute: (k) => attrs.delete(k), getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null), hasAttribute: (k) => attrs.has(k) };
}
/** SIGIL's :root tokens, read from the page itself. */
const sigilTokens = () => {
  const root = /:root\s*\{([^}]*)\}/.exec(HTML)[1], out = {};
  for (const m of root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
};
/** A stand-in window whose computed tokens are a map per data-theme ('' = SIGIL), with a MutationObserver the test can fire. */
function fakeWin(byTheme) {
  const root = fakeRoot(), observers = [];
  const win = {
    document: { documentElement: root },
    getComputedStyle: (el) => ({ getPropertyValue: (k) => { const t = root.getAttribute('data-theme') || ''; const v = (byTheme[t] || {})[k] ?? (byTheme[''] || {})[k]; return v === undefined ? '' : ` ${v}`; } }),
    MutationObserver: class { constructor(cb) { this.cb = cb; observers.push(this); } observe(target, opts) { this.target = target; this.opts = opts; } disconnect() { this.gone = true; } },
    console: { errors: [], error(m) { this.errors.push(String(m)); } },
  };
  const setTheme = (t) => { if (t) root.setAttribute('data-theme', t); else root.removeAttribute('data-theme'); for (const o of observers) if (!o.gone) o.cb([{ type: 'attributes', attributeName: 'data-theme' }]); };
  return { win, root, setTheme, observers };
}

test('each melody sets its own skin on <html data-theme>; an unknown or missing melody leaves SIGIL', () => {
  // AMENDED (D402): the rule changed by name: SIGIL's melody, Obsidian, is the fifth melody and SIGIL is no skin, so every melody but 'sigil' has its skin
  assert.deepEqual([...TH.THEMES, 'sigil'], [...SOUND.MELODY_NAMES], 'a skin for every melody but SIGIL’s, by the same names; SIGIL’s is last');
  for (const m of TH.THEMES) {
    const root = fakeRoot();
    assert.equal(TH.applyTheme({ documentElement: root }, m), m);
    assert.equal(root.getAttribute('data-theme'), m, `${m} sets data-theme="${m}"`);
  }
  for (const m of ['zzz', '', undefined, null, 'Aqua', 'sigil', 3]) {
    const root = fakeRoot(); root.setAttribute('data-theme', 'glass');
    assert.equal(TH.applyTheme({ documentElement: root }, m), 'sigil', `${String(m)} gives SIGIL`);
    assert.equal(root.hasAttribute('data-theme'), false, `${String(m)} removes data-theme`);
  }
});

test('the page sets the skin in its head, before the first paint, from the same number the player draws its melody from', () => {
  const head = HTML.slice(0, HTML.indexOf('</head>')), scripts = [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => /data-theme/.test(s));
  assert.equal(scripts.length, 1, 'one inline script in <head> sets data-theme');
  // AMENDED (D402): five names, so 0.15 and 0.85 are added: there a rounded pick (names[Math.round(r * 4)]) lands in another fifth than the floored one
  for (const r of [0, 0.15, 0.2499, 0.25, 0.5, 0.7501, 0.85, 0.9999]) {
    const root = fakeRoot(), win = {}, ctx = { window: win, document: { documentElement: root }, Math: Object.assign(Object.create(Math), { random: () => r }) };
    vm.runInNewContext(scripts[0], ctx);
    assert.equal(win.__t180MelodyPick, r, 'the head keeps the number for the player');
    const sound = SOUND.createSound({}, { pick: () => win.__t180MelodyPick, log: () => {} });
    // AMENDED (D405): the rule changed by name: the head's skin is a LOOK, and Skyline Night is a look on Skyline's melody, so the skin's melody is the player's
    // AMENDED (D402): no data-theme is SIGIL's look, whose melody is now its own ('sigil')
    assert.equal(TH.melodyOf(root.getAttribute('data-theme') || 'sigil'), sound.melody, `r = ${r}: the head's skin is a look of the player's melody`);
  }
  // the boot hands that number to the player and sets the skin from sound.melody (the player's word is the last one)
  assert.match(HTML, /createSound\(window, \{[^}]*pick: \(\) => \(typeof window\.__t180MelodyPick === 'number' \? window\.__t180MelodyPick : Math\.random\(\)\)/);
  // AMENDED (D394): the rule changed by name: a saved Settings ▸ Theme of sigil shows SIGIL over the player's melody, so the boot sets the skin from the
  // saved choice and sound.melody together (theme.js skinFor); with no fixed theme saved (music), skinFor gives sound.melody, as before
  // AMENDED (D405): the boot also hands over the head's look (window.__t180Look), so a random start on Skyline Night is not turned back into Skyline
  assert.match(HTML, /applyTheme\(document, \w+\.skinFor\(window\.__t180Theme, sound\.melody, window\.__t180Look\)\)/);
});

const SETTINGS = require(path.join(ADIR, 'settings.js'));
const headScript = () => [...HTML.slice(0, HTML.indexOf('</head>')).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => /data-theme/.test(s));
/** Run the head script with Math.random() = r over `win` (its localStorage, or none); what it set, and the melody the player then draws from its pick. */
function runHead(r, win = {}) {
  const root = fakeRoot(), ctx = { window: win, document: { documentElement: root }, Math: Object.assign(Object.create(Math), { random: () => r }), JSON };
  assert.doesNotThrow(() => vm.runInNewContext(headScript(), ctx), 'the head script never throws before the first paint');
  const sound = SOUND.createSound({}, { pick: () => win.__t180MelodyPick, log: () => {} });
  return { skin: root.getAttribute('data-theme'), melody: sound.melody, pick: win.__t180MelodyPick, theme: win.__t180Theme };
}
const savedTheme = (text) => ({ localStorage: { getItem: (k) => (k === 't180.settings.theme' ? text : null), setItem() {} } });

// AMENDED (D405): the rule changed by name: seven choices, Skyline Night after Skyline
test('D394: Settings ▸ Theme has seven choices: music follows the melody, each of the four is its own skin, Skyline Night is its own, sigil is none', () => {
  assert.deepEqual([...TH.CHOICES], ['music', 'aqua', 'skyline', 'skyline-night', 'glass', 'aurora', 'sigil']);
  assert.deepEqual([...TH.CHOICES], [...SETTINGS.CHOICES.theme], 'the setting takes the same seven names');
  for (const m of SOUND.MELODY_NAMES) {
    assert.equal(TH.skinFor('music', m), m, `music: the melody's skin (${m})`);
    // AMENDED (D402): the fixed skins are THEMES (SIGIL's melody is a melody, not a skin)
    for (const t of TH.THEMES) assert.equal(TH.skinFor(t, m), t, `${t} over ${m}: ${t}'s skin`);
    assert.equal(TH.skinFor('sigil', m), null, 'sigil: no skin');
    for (const other of ['zzz', undefined, null, 3, 'Aqua']) assert.equal(TH.skinFor(other, m), m, `${String(other)} is read as music`);
  }
});

// AMENDED (D402): the rule changed by name: a saved sigil now plays SIGIL's own melody (its pick inside the last fifth), as a fixed theme plays its own
test('D394: the head reads the saved theme: a fixed theme sets its own skin AND melody; music, nothing saved and broken saved text keep the random pick; sigil plays its own melody under SIGIL', () => {
  const NAMES = SOUND.MELODY_NAMES;
  // AMENDED (D405): the random pick's SKIN is a look: in the lower half of Skyline's quarter (r 0.25 to 0.375) it is Skyline Night, on Skyline's melody
  // AMENDED (D402): five names, so Skyline's share is a fifth (r 0.2 to 0.4, the night 0.2 to 0.3), and the last fifth is SIGIL's look (no skin)
  const lookAt = (r) => { const m = NAMES[Math.floor(r * NAMES.length)]; return m === 'sigil' ? null : m === 'skyline' && r * NAMES.length - 1 < 0.5 ? 'skyline-night' : m; };
  for (const r of [0, 0.3, 0.6, 0.9999]) {
    const random = NAMES[Math.floor(r * NAMES.length)];
    for (const t of TH.THEMES) {
      const x = runHead(r, savedTheme(JSON.stringify(t)));
      assert.equal(x.skin, t, `r = ${r}, saved ${t}: the skin`); assert.equal(x.melody, t, `r = ${r}, saved ${t}: the melody is the theme's own`); assert.equal(x.theme, t);
    }
    for (const [why, win] of [['music', savedTheme('"music"')], ['nothing saved', savedTheme(null)], ['no storage', {}], ['not JSON', savedTheme('glass')], ['an unknown name', savedTheme('"neon"')],
      ['a number', savedTheme('42')], ['an object', savedTheme('{"theme":"glass"}')], ['null', savedTheme('null')], ['the wrong case', savedTheme('"Glass"')],
      ['a store that throws', { localStorage: { getItem() { throw new Error('SecurityError: blocked'); } } }],
      ['reading localStorage throws', Object.defineProperty({}, 'localStorage', { get() { throw new Error('SecurityError: no storage'); } })]]) {
      const x = runHead(r, win);
      assert.equal(x.pick, r, `${why}: the random pick is kept`); assert.equal(x.melody, random, `${why}: the random melody`); assert.equal(x.skin, lookAt(r), `${why}: its look`);
      assert.equal(x.theme, 'music', `${why}: read as music`);
    }
    const s = runHead(r, savedTheme('"sigil"'));
    assert.equal(s.skin, null, 'sigil: no data-theme (SIGIL)'); assert.equal(s.pick, 4.5 / 5, 'sigil: the pick is inside its own fifth'); assert.equal(s.melody, 'sigil', 'sigil: its own melody, Obsidian'); assert.equal(s.theme, 'sigil');
  }
});

test('D405: Skyline Night is a sixth look on Skyline\'s melody: its own skin, chosen by name or by the random pick, kept by the boot', () => {
  // AMENDED (D402): the skins' looks are THEMES' (SIGIL's melody is the fifth, and SIGIL is no skin)
  assert.deepEqual([...TH.LOOKS], [...TH.THEMES, 'skyline-night'], 'the four skins’ looks and Skyline Night');
  assert.equal(TH.melodyOf('skyline-night'), 'skyline'); for (const m of SOUND.MELODY_NAMES) assert.equal(TH.melodyOf(m), m);
  // AMENDED (D402): SIGIL's look names its own melody now
  assert.equal(TH.melodyOf('sigil'), 'sigil');
  for (const x of ['music', 'zzz', undefined, null, 'Skyline-Night']) assert.equal(TH.melodyOf(x), null, `${String(x)} is no look`);
  const root = fakeRoot(); assert.equal(TH.applyTheme({ documentElement: root }, 'skyline-night'), 'skyline-night'); assert.equal(root.getAttribute('data-theme'), 'skyline-night');
  for (const m of SOUND.MELODY_NAMES) assert.equal(TH.skinFor('skyline-night', m), 'skyline-night', `chosen by name, over ${m}`);
  assert.equal(TH.skinFor('music', 'skyline', 'skyline-night'), 'skyline-night', 'a random start on Skyline Night keeps it over the skyline melody');
  assert.equal(TH.skinFor('music', 'glass', 'skyline-night'), 'glass', 'a look that is not the melody\'s is not kept');
  assert.equal(TH.skinFor('sigil', 'skyline', 'skyline-night'), null, 'sigil stays none'); assert.equal(TH.skinFor('skyline', 'skyline', 'skyline-night'), 'skyline', 'a fixed theme is its own');
  assert.deepEqual([...SETTINGS.CHOICES.theme], [...TH.CHOICES], 'the setting takes it');
  for (const r of [0, 0.3, 0.6, 0.9999]) { const x = runHead(r, savedTheme('"skyline-night"')); assert.deepEqual([x.skin, x.melody, x.theme], ['skyline-night', 'skyline', 'skyline-night'], `r = ${r}, saved skyline-night`); }
  // AMENDED (D402): five names, so Skyline's fifth is r 0.2 to 0.4 and its night the lower half, 0.2 to 0.3; the last fifth is SIGIL's look (null: no skin)
  for (const [r, skin] of [[0.1, 'aqua'], [0.2, 'skyline-night'], [0.25, 'skyline-night'], [0.2999, 'skyline-night'], [0.3, 'skyline'], [0.35, 'skyline'], [0.5, 'glass'], [0.7, 'aurora'], [0.9, null]]) {
    const x = runHead(r, {}); assert.equal(x.skin, skin, `r = ${r}, nothing saved: ${skin}`); assert.equal(x.melody, TH.melodyOf(skin || 'sigil'), `r = ${r}: its melody`); assert.equal(x.pick, r, 'the pick is kept');
  }
  for (const r of [0.25, 0.3]) assert.equal(runHead(r, savedTheme('"skyline"')).skin, 'skyline', `r = ${r}, saved skyline: Skyline, never the night`);
  assert.ok(HTML.includes('<link rel="stylesheet" href="themes/skyline-night.css">'), 'the page links its skin');
});

test('the reader understands every colour form a skin may write', () => {
  const { win } = fakeWin({ '': { '--a': '#0b0d11', '--b': '#fff', '--c': 'rgb(1, 2, 3)', '--d': 'rgba(255, 255, 255, .14)', '--e': 'color(srgb 0.07 0.08 0.1)', '--f': 'rgb(10 20 30 / 0.5)', '--g': '#11223380' } });
  const T = TK.createTokens(win);
  assert.deepEqual(T.rgba('--a', '#000'), [11, 13, 17, 1]);
  assert.equal(T.css('--a', '#000'), '#0b0d11', 'an opaque colour comes back as #rrggbb');
  assert.equal(T.css('--b', '#000'), '#ffffff');
  assert.deepEqual(T.rgba('--c', '#000'), [1, 2, 3, 1]);
  assert.deepEqual(T.rgba('--d', '#000'), [255, 255, 255, 0.14]);
  assert.equal(T.css('--d', '#000'), 'rgba(255, 255, 255, 0.14)');
  assert.deepEqual(T.floats('--e', [0, 0, 0]), [0.07, 0.08, 0.1], 'color(srgb …) gives its floats exactly');
  assert.deepEqual(T.floats('--a', [0, 0, 0]), [11 / 255, 13 / 255, 17 / 255]);
  assert.deepEqual(T.rgba('--f', '#000'), [10, 20, 30, 0.5]);
  assert.deepEqual(T.rgba('--g', '#000'), [17, 34, 51, 128 / 255]);
  assert.equal(T.alpha('--a', 0.92, '#000'), 'rgba(11, 13, 17, 0.92)', 'a translucent backing: the token at the site\'s alpha');
  assert.equal(T.solid('--d', '#000'), '#ffffff', 'solid() drops a skin\'s alpha (the hover label stays opaque)');
});

test('the reader falls back to today\'s literal where the page has no such token or cannot read it, and says so once per token', () => {
  const { win } = fakeWin({ '': { '--bad': 'not a colour' } });
  const T = TK.createTokens(win);
  assert.equal(T.css('--missing', '#0b0d11'), '#0b0d11');
  assert.deepEqual(T.floats('--missing', [0.07, 0.08, 0.1]), [0.07, 0.08, 0.1], 'float fallbacks come back as given');
  assert.equal(T.css('--bad', '#eef1f6'), '#eef1f6');
  T.css('--bad', '#eef1f6');
  assert.equal(win.console.errors.filter((e) => e.includes('--bad')).length, 1, 'an unreadable token is reported once');
  // no window at all (a test stand-in, the smoke page): every read is the literal
  const bare = TK.createTokens({});
  assert.equal(bare.css('--ink', '#0b0d11'), '#0b0d11'); assert.deepEqual(bare.floats('--sky', [1, 2, 3]), [1, 2, 3]);
  assert.throws(() => T.css('--x'), /needs today's colour as its fallback/);
});

test('the reader reads again when data-theme changes, and tells whoever listens', () => {
  const { win, setTheme, observers } = fakeWin({ '': { '--ink': '#0b0d11' }, aurora: { '--ink': '#080a1a' } });
  const T = TK.createTokens(win); let told = 0; T.onChange(() => told++);
  assert.equal(T.css('--ink', '#000'), '#0b0d11');
  assert.equal(observers.length, 1); assert.deepEqual(observers[0].opts, { attributes: true, attributeFilter: ['data-theme'] });
  const v0 = T.version;
  setTheme('aurora');
  assert.equal(T.css('--ink', '#000'), '#080a1a', 'the new skin\'s value, not the cached one');
  assert.ok(T.version > v0, 'the version moves on, so a frame loop can tell'); assert.equal(told, 1);
  setTheme(null); assert.equal(T.css('--ink', '#000'), '#0b0d11'); assert.equal(told, 2);
  assert.equal(TK.tokensOf(win), TK.tokensOf(win), 'one reader per window, shared by every layer');
});

test('SIGIL\'s tokens are today\'s literals, so SIGIL draws exactly as before', () => {
  const S = sigilTokens(), { win } = fakeWin({ '': S }), T = TK.createTokens(win);
  const want = { '--ink': '#0b0d11', '--on-ink': '#eef1f6', '--on-ink-strong': '#ffffff', '--veil': '#0b0d11', '--veil-rule': 'rgba(255, 255, 255, 0.14)',
    '--guide-bg': 'rgba(20, 22, 28, 0.94)', '--guide-text': '#e8eaee', '--guide-label': '#9fb4d0' };
  for (const [k, v] of Object.entries(want)) assert.equal(T.css(k, '#123456'), v, `${k} is today's ${v}`);
  // the 3D view: the literals renderer.js held until D381 (0.4.2)
  const floats = { '--sky': [0.024, 0.023, 0.021], '--fog': [0.07, 0.08, 0.1], '--road-edge': [0.93, 0.93, 0.88], '--road-tie': [0.06, 0.07, 0.09], '--ground-grid': [0.2, 0.23, 0.28] };
  for (const [k, v] of Object.entries(floats)) assert.deepEqual(T.floats(k, [9, 9, 9]), v, `${k} is today's ${v}`);
  assert.deepEqual([...R.CLEAR], floats['--sky']); assert.deepEqual([...R.COLOURS.edge], floats['--road-edge']);
});

/** A recording WebGL stand-in: every colour the 3D view sends (clear, fog, line and surface colours), in order. */
function colourGL() {
  const log = []; let id = 0;
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, ELEMENT_ARRAY_BUFFER: 6, STATIC_DRAW: 7, COLOR_BUFFER_BIT: 8, DEPTH_BUFFER_BIT: 16,
    DEPTH_TEST: 9, CULL_FACE: 10, TRIANGLES: 11, FLOAT: 12, UNSIGNED_SHORT: 13, BLEND: 14, LINES: 15, SRC_ALPHA: 17, ONE_MINUS_SRC_ALPHA: 18,
    depthMask() {}, blendFunc() {}, disableVertexAttribArray() {}, createShader: () => ({ id: ++id }), shaderSource() {}, compileShader() {}, getShaderParameter: () => true,
    getShaderInfoLog: () => '', createProgram: () => ({ id: ++id }), attachShader() {}, linkProgram() {}, getProgramParameter: () => true, getProgramInfoLog: () => '',
    getAttribLocation: () => 0, getUniformLocation: (p, n) => n, useProgram() {}, viewport() {}, clear() {}, enable() {}, disable() {}, uniformMatrix4fv() {}, uniform1f() {},
    uniform2f() {}, enableVertexAttribArray() {}, vertexAttribPointer() {}, createBuffer: () => ({ id: ++id }), bindBuffer() {}, bufferData() {}, deleteBuffer() {}, deleteProgram() {},
    drawElements() {}, drawArrays() {},
    clearColor: (...c) => log.push(['clear', ...c]), uniform3f: (n, ...c) => log.push([n, ...c]),
  };
  return { gl, log };
}
const pose = { eye: [0, 50, -50], target: [0, 0, 0], up: [0, 1, 0], fov: 1 };
const lines = { positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 10]) };

test('SIGIL\'s 3D frame is the same, call for call, with its tokens applied; a skin\'s tokens change it', () => {
  const base = colourGL(); R.createRenderer(base.gl).draw([], pose, { width: 800, height: 600 }, { look: 'words', grid: lines });
  const { win } = fakeWin({ '': sigilTokens(), skyline: { '--sky': 'color(srgb 0.3 0.6 0.95)', '--ground-grid': 'color(srgb 0.5 0.7 0.9)', '--fog': 'color(srgb 0.6 0.8 1)' } });
  const T = TK.createTokens(win), themed = colourGL(), r = R.createRenderer(themed.gl);
  r.setTheme(R.themeFrom(T)); r.draw([], pose, { width: 800, height: 600 }, { look: 'words', grid: lines });
  assert.ok(base.log.length > 1, 'the frame sends colours'); assert.deepEqual(themed.log, base.log, 'SIGIL: identical colour calls');
  win.document.documentElement.setAttribute('data-theme', 'skyline'); T.refresh();
  const sky = colourGL(), r2 = R.createRenderer(sky.gl); r2.setTheme(R.themeFrom(T)); r2.draw([], pose, { width: 800, height: 600 }, { look: 'words', grid: lines });
  assert.deepEqual(sky.log[0], ['clear', 0.3, 0.6, 0.95, 1], 'the skin\'s sky is the clear colour');
  assert.ok(sky.log.some((c) => c[0] === 'uColour' && c[1] === 0.5 && c[2] === 0.7 && c[3] === 0.9), 'the skin\'s grid colour is drawn');
  assert.ok(sky.log.some((c) => c[0] === 'uFog' && c[1] === 0.6), 'the skin\'s fog');
  assert.throws(() => r2.setTheme({ sky: [1, 2] }), /three numbers from 0 to 1/);
});

// AMENDED (D405): the rule changed by name: a skin is named for a LOOK (Skyline Night is a look on Skyline's melody), not only for a melody
test('a skin is styling only: no theme file sets a property that moves or sizes a box, and each skin the page links is a look\'s', () => {
  const dir = path.join(ADIR, 'themes'), files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.css')) : [];
  const BOX = /^(width|height|min-width|max-width|min-height|max-height|margin(-\w+)?|padding(-\w+)?|border(-top|-right|-bottom|-left)?|border(-top|-right|-bottom|-left)?-width|border-width|font(-\w+)?|letter-spacing|word-spacing|line-height|text-transform|white-space|top|left|right|bottom|inset(-\w+)?|position|display|flex(-\w+)?|grid(-\w+)?|gap|row-gap|column-gap|order|align-\w+|justify-\w+|place-\w+|float|box-sizing|transform|translate|rotate|scale|zoom|content|overflow(-\w+)?|writing-mode|direction)$/;
  for (const f of files) {
    const css = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''), name = f.slice(0, -4);
    assert.ok(TH.LOOKS.includes(name), `${f} is named for a look`);
    for (const m of css.matchAll(/(?:^|[;{])\s*([a-z-]+)\s*:/g)) assert.ok(!BOX.test(m[1]), `${f} sets ${m[1]}, which can move or size a box`);
    for (const sel of css.replace(/@[^{]+\{/g, '').matchAll(/(^|\})\s*([^{}@]+)\{/g)) for (const one of sel[2].split(',')) if (!/^\s*(from|to|\d+%)/.test(one)) assert.match(one, new RegExp(`\\[data-theme="${name}"\\]`), `${f}: every rule is scoped to its own skin (${one.trim()})`);
    assert.ok(HTML.includes(`<link rel="stylesheet" href="themes/${f}">`), `the page links ${f}`);
  }
  // the rows above can only fail on a file that exists: this one cannot pass by finding none
  assert.ok(files.includes('skyline.css') && files.includes('aurora.css'), 'pane B\'s two skins are in app/themes');
});

test('the canvas layers and overlays name no chrome colour of their own: they read the tokens (the meaning colours stay literal)', () => {
  const read = (f) => fs.readFileSync(path.join(ADIR, f), 'utf8');
  for (const f of ['core/flightlayer.js', 'core/griplayer.js', 'core/handles.js', 'core/labels.js', 'core/panel.js', 'core/piecesui.js', 'core/selectionlayer.js', 'core/spawnslayer.js', 'core/valuesoverlay.js', 'onboarding/index.js', 'preview/guideslayer.js', 'preview/index.js']) {
    const src = read(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    for (const lit of ['#0b0d11', '#eef1f6', '#e8eaee', '#9fb4d0', 'rgba(11,13,17', 'rgba(10,12,16', 'rgba(20, 22, 28', 'rgba(255,255,255,0.14)', '#ffb31a'])
      for (let i = src.indexOf(lit); i >= 0; i = src.indexOf(lit, i + 1))   // only as the fallback beside a token: var(--x, lit) or ('--x', 'lit')
        assert.match(src.slice(Math.max(0, i - 40), i), /(var\(--[\w-]+, ?|\('--[\w-]+', (?:[\d.]+, )?')$/, `${f} still draws ${lit} itself: …${src.slice(Math.max(0, i - 40), i + lit.length)}`);
  }
  // spawns' amber and green are the page's warn and ok (the meaning stays: amber is a warning, green is all clear)
  assert.match(read('core/spawnsui.js'), /var\(--warn, #ffb347\)/); assert.match(read('core/spawnsui.js'), /var\(--ok, #8fd18f\)/);
  // the handle and spawn kinds, grip's scale, the selection amber and the flight cyan are unchanged
  assert.match(read('core/handles.js'), /width: Object\.freeze\(\{ label: 'width', unit: 'm', colour: '#ff5a5a'/);
  assert.match(read('core/spawnslayer.js'), /const COLOUR = \{ line: '#ffffff', grid: '#5fd3ff', pit: '#d6dbe3', hotlap: '#ff9a2e', lane: '#a8b0bd', bad: '#ff4d4d' \}/);
  assert.match(read('core/selectionlayer.js'), /'#ffb020'/); assert.match(read('core/flightlayer.js'), /'#7fd8ff'/);
});
