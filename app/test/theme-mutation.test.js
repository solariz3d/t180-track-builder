// theme-mutation.test.js: node --test app/test/theme-mutation.test.js
// D381 part 2a (pane B): the skin pick and the token reader, mutated; D384 part 1 (pane B): the sky pass too (S1-S13, run against sky.test.js).
// D410 (pane B): Glass's crisp sky (P1-P4, run against sky-prism-crisp.test.js; P2-P4 skip where there is no Chrome, as that file's rows do).
// Each mutation copies app/ (all but its tests, plus theme.test.js and sky.test.js with its fixture), src/ and tools/ to a temp folder, applies ONE source patch, and runs the COPIED theme.test.js there. "Applied" means the patch text was
// found exactly once; "caught" means the named test FAILED on the mutant. A CONTROL runs the unmutated copy first. The originals are never touched.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');

const MUTATIONS = [
  // CHANGED D405: applyTheme takes a look (LOOKS: the melodies' and Skyline Night); the anchor follows the line
  { id: 'T1 any name sets a skin', file: 'lib/theme.js', from: "if (typeof melody === 'string' && LOOKS.includes(melody))", to: "if (typeof melody === 'string')", caughtBy: 'each melody sets its own skin' },
  { id: 'T2 the head rounds the pick', file: 'index.html', from: 'names[Math.floor(r * names.length)]', to: 'names[Math.round(r * (names.length - 1))]', caughtBy: 'the page sets the skin in its head' },
  { id: 'T3 the head names the melodies in another order', file: 'index.html', from: "names = ['aqua', 'skyline', 'glass', 'aurora']", to: "names = ['skyline', 'aqua', 'glass', 'aurora']", caughtBy: 'the page sets the skin in its head' },
  // AMENDED (D394): the rule changed by name: the boot sets the skin through theme.js skinFor (a saved sigil shows SIGIL over the melody), so the patch that
  // stops it following the player is made on that call; the same mutant, the same catching row
  // CHANGED D405: the boot also hands over the head's look; the anchor follows the line
  { id: 'T4 the boot does not follow the player', file: 'index.html', from: 'TH0.skinFor(window.__t180Theme, sound.melody, window.__t180Look)', to: 'TH0.skinFor(window.__t180Theme, null, null)', caughtBy: 'the page sets the skin in its head' },
  // D394: Settings ▸ Theme, read by the head and resolved by skinFor
  { id: 'T14 the head ignores a saved theme', file: 'index.html', from: 'if (names.indexOf(theme) >= 0) r = ', to: 'if (false) r = ', caughtBy: 'D394: the head reads the saved theme' },
  // CHANGED D405: the head also takes skyline-night; the anchor follows the line
  { id: 'T15 the head takes any saved text as a theme', file: 'index.html', from: "if (saved === 'sigil' || saved === 'skyline-night' || names.indexOf(saved) >= 0) theme = saved;", to: "theme = saved || 'music';", caughtBy: 'D394: the head reads the saved theme' },
  { id: 'T16 sigil shows a skin', file: 'lib/theme.js', from: "if (choice === 'sigil') return null;", to: '', caughtBy: 'D394: Settings ▸ Theme has seven choices' },   // CHANGED D405: the row's title says seven now
  { id: 'T17 Skyline Night plays a melody of its own name', file: 'lib/theme.js', from: "(NIGHT[look] || (THEMES.includes(look) ? look : null))", to: "(THEMES.includes(look) || look in NIGHT ? look : null)", caughtBy: 'D405: Skyline Night is a sixth look' },
  { id: 'T18 the random start never lands on the night', file: 'index.html', from: "look === 'skyline' && theme !== 'skyline' && ", to: "false && ", caughtBy: 'D405: Skyline Night is a sixth look' },
  { id: 'T19 the boot turns a random night back into Skyline', file: 'lib/theme.js', from: 'return melodyOf(look) !== null && melodyOf(look) === melody ? look : melody;', to: 'return melody;', caughtBy: 'D405: Skyline Night is a sixth look' },
  { id: 'T5 a skin change keeps the old colours', file: 'lib/tokens.js', from: 'refresh() { cache.clear(); version++;', to: 'refresh() { version++;', caughtBy: 'the reader reads again' },
  { id: 'T6 the reader watches the wrong attribute', file: 'lib/tokens.js', from: "attributeFilter: ['data-theme']", to: "attributeFilter: ['class']", caughtBy: 'the reader reads again' },
  { id: 'T7 a translucent token comes back opaque', file: 'lib/tokens.js', from: 'c.rgba[3] === 1 ? hexOf(c)', to: 'true ? hexOf(c)', caughtBy: 'the reader understands every colour form' },
  { id: 'T8 color(srgb) floats are rounded to bytes', file: 'lib/tokens.js', from: 'clamp01(a)], floats: fl };', to: 'clamp01(a)], floats: fl.map((v) => Math.round(v * 255) / 255) };', caughtBy: 'the reader understands every colour form' },
  { id: 'T9 solid keeps a skin\'s alpha', file: 'lib/tokens.js', from: 'solid(name, fallback) { return hexOf(', to: 'solid(name, fallback) { return api.css(name, fallback); return hexOf(', caughtBy: 'the reader understands every colour form' },
  { id: 'T10 a missing token is black, not today\'s colour', file: 'lib/tokens.js', from: 'if (!c) return fallback;', to: "if (!c) return '#000000';", caughtBy: 'the reader falls back' },
  { id: 'T11 an unreadable token is not reported', file: 'lib/tokens.js', from: "if (v && !c && !said.has(name)) { said.add(name); say(", to: 'if (false) { say(', caughtBy: 'the reader falls back' },
  { id: 'T12 the 3D sky ignores the skin', file: 'preview/renderer.js', from: 'if (t.sky) clear = t.sky;', to: '', caughtBy: 'SIGIL\'s 3D frame is the same' },
  { id: 'T13 SIGIL\'s grid token drifts from the literal', file: 'index.html', from: '--ground-grid: color(srgb 0.2 0.23 0.28)', to: '--ground-grid: color(srgb 0.2 0.23 0.29)', caughtBy: 'SIGIL\'s tokens are today\'s literals' },
  // D384: the sky pass (app/preview/renderer.js, app/preview/sky/, app/preview/preview.js, app/lib/tokens.js word())
  { id: 'S1 the sky follows the camera\'s position', test: 'sky.test.js', file: 'preview/renderer.js', from: 'eye: [0, 0, 0], target: pose.target.map((v, i) => v - pose.eye[i]) }', to: 'eye: pose.eye, target: pose.target }', caughtBy: 'moving or zooming without turning' },
  { id: 'S2 the rays turn the other way', test: 'sky.test.js', file: 'preview/renderer.js', from: 'right: r.map((v, i) => (v - c[i]) * s)', to: 'right: r.map((v, i) => (c[i] - v) * s)', caughtBy: 'a sky feature moves on screen' },
  { id: 'S3 the shader builds its rays without the basis', test: 'sky.test.js', file: 'preview/renderer.js', from: 'vRay = uFwd + aPos.x * uRight + aPos.y * uUp;', to: 'vRay = uFwd + aPos.x * uRight - aPos.y * uUp;', caughtBy: 'the sky pass runs before the track' },
  { id: 'S4 the sky writes depth', test: 'sky.test.js', file: 'preview/renderer.js', from: 'gl.disable(gl.DEPTH_TEST); gl.depthMask(false);', to: 'gl.disable(gl.DEPTH_TEST);', caughtBy: 'the sky pass runs before the track' },
  { id: 'S5 the pattern gets no time', test: 'sky.test.js', file: 'preview/renderer.js', from: 'gl.uniform1f(sp.time, time);', to: 'gl.uniform1f(sp.time, 0);', caughtBy: 'the sky pass runs before the track' },
  { id: 'S6 none still draws a sky', test: 'sky.test.js', file: 'preview/renderer.js', from: 'next = src ? program(SKY_VS, skyFS(src)) : null;', to: 'next = program(SKY_VS, skyFS(src || SKY.patternSource(\'sun\')));', caughtBy: '\'none\' draws the very calls cbd7a40 drew' },
  { id: 'S7 going back to none keeps the old sky', test: 'sky.test.js', file: 'preview/renderer.js', from: 'skyProg = next; skyStyle = t.skyStyle;', to: 'if (next) skyProg = next; skyStyle = t.skyStyle;', caughtBy: '\'none\' draws the very calls cbd7a40 drew' },
  { id: 'S8 an unknown style is quietly none', test: 'sky.test.js', file: 'preview/sky/index.js', from: 'if (!STYLES.includes(style)) throw', to: 'if (!STYLES.includes(style)) return null; if (0) throw', caughtBy: 'an unknown sky style fails loudly' },
  { id: 'S9 --sky-a falls back to black-ish, not the skin\'s sky', test: 'sky.test.js', file: 'preview/renderer.js', from: "skyA: T.floats('--sky-a', sky)", to: "skyA: T.floats('--sky-a', CLEAR)", caughtBy: 'the skin names its sky' },
  { id: 'S10 the style word keeps its quotes', test: 'sky.test.js', file: 'lib/tokens.js', from: ".replace(/^([\"'])(.*)\\1$/, '$2')", to: '', caughtBy: 'the skin names its sky' },
  { id: 'S11 reduced motion still drifts', test: 'sky.test.js', file: 'preview/preview.js', from: '(still && still.matches ? 0 : t / 1000)', to: '(t / 1000)', caughtBy: 'the drift stops under prefers-reduced-motion' },
  { id: 'S12 the preview hands the sky no time', test: 'sky.test.js', file: 'preview/preview.js', from: ', time: skyTime(t) });', to: ' });', caughtBy: 'the drift stops under prefers-reduced-motion' },
  { id: 'S13 Skyline names no sky', test: 'sky.test.js', file: 'themes/skyline.css', from: '--sky-style: sun;', to: '', caughtBy: 'the skin names its sky' },
  { id: 'S14 Glass names no sky (D384 widened)', test: 'sky.test.js', file: 'themes/glass.css', from: '--sky-style: prism;', to: '', caughtBy: 'Glass names the prism sky' },
  // CHANGED D405: the registry has city too; the anchor follows the line
  { id: 'S15 the registry leaves prism out (D384 widened)', test: 'sky.test.js', file: 'preview/sky/index.js', from: "['none', 'sun', 'prism', 'caustics', 'aurora', 'city']", to: "['none', 'sun', 'caustics', 'aurora', 'city']", caughtBy: 'Glass names the prism sky' },
  // D398: the sky pass's one-step dither (the banding itself is measured in headless Chrome by sky-dither.test.js, which this harness does not copy)
  { id: 'S16 the sky pass does not dither (D398)', test: 'sky.test.js', file: 'preview/renderer.js', from: 'clamp(c + (pass_bayer4(gl_FragCoord.xy) - 0.5) / 255.0, 0.0, 1.0)', to: 'c', caughtBy: 'D398: the shared sky pass dithers' },
  { id: 'S17 Skyline Night names no sky (D405)', test: 'sky.test.js', file: 'themes/skyline-night.css', from: '--sky-style: city;', to: '', caughtBy: 'D405: Skyline Night names the city sky' },
  // D410: Glass's sky is crisp (app/test/sky-prism-crisp.test.js; rows 1, 2 and 5 draw in headless Chrome, so those mutants need it)
  { id: 'P1 the sky pass sends no uPx', test: 'sky-prism-crisp.test.js', file: 'preview/renderer.js', from: "px: u('uPx')", to: 'px: null', caughtBy: 'row 3' },
  { id: 'P2 the moon\'s limb fades over 0.020 rad again', test: 'sky-prism-crisp.test.js', chrome: true, file: 'preview/sky/prism.js', from: 'float lw = 1.5 * prism_px();', to: 'float lw = 0.010;', caughtBy: 'row 2' },
  { id: 'P3 a star is the old gaussian', test: 'sky-prism-crisp.test.js', chrome: true, file: 'preview/sky/prism.js', from: 'max(0.0, 1.0 - length(dd) / (1.25 * prism_px()))', to: 'exp(-dot(dd, dd) / (2.0 * 0.0020 * 0.0020))', caughtBy: 'row 1' },
  { id: 'P4 the band has no filaments', test: 'sky-prism-crisp.test.js', chrome: true, file: 'preview/sky/prism.js', from: '(0.6 + 0.4 * toward) * fil;', to: '(0.6 + 0.4 * toward);', caughtBy: 'row 5' },
];
const HAS_CHROME = !!require('./soundrender.js').chromePath();

function runMutant(m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-theme-mut-')), app = path.join(dir, 'app');
  try {
    fs.cpSync(path.join(ROOT, 'app'), app, { recursive: true, filter: (s) => path.relative(path.join(ROOT, 'app'), s) !== 'test' });
    fs.mkdirSync(path.join(app, 'test'));
    for (const n of ['theme.test.js', 'sky.test.js', 'sky-fixture.js', 'sky-none-cbd7a40.json', 'sky-prism-crisp.test.js', 'soundrender.js']) fs.copyFileSync(path.join(__dirname, n), path.join(app, 'test', n));
    for (const d of ['src', 'tools']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
    const f = path.join(app, m.file), src = fs.readFileSync(f, 'utf8'), n = m.from === null ? 1 : src.split(m.from).length - 1, applied = n === 1;
    if (applied && m.from !== null) fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const r = spawnSync(process.execPath, ['--test', path.join(app, 'test', m.test || 'theme.test.js')],
      { env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT' && k !== 'APP_DIR')), encoding: 'utf8', timeout: 300000 });
    if (r.error) throw r.error;
    const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
    if (!/ℹ tests \d+/.test(out)) throw new Error('the mutant test run printed no summary:\n' + out.slice(0, 2000));
    const failed = out.split('\n').filter((l) => /^✖ /.test(l) && !/^✖ failing tests:/.test(l)).map((l) => l.slice(2));
    return { applied, n, caught: m.caughtBy ? failed.some((l) => l.includes(m.caughtBy)) : false, failed, passedAll: /ℹ fail 0/.test(out) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('control: the unmutated copy passes theme.test.js', () => {
  const r = runMutant({ id: 'control', file: 'lib/theme.js', from: null, to: null, caughtBy: null });
  assert.ok(r.passedAll, `the control failed: ${r.failed.join(' | ')}`);
});
test('control: the unmutated copy passes sky.test.js', () => {
  const r = runMutant({ id: 'control', test: 'sky.test.js', file: 'lib/theme.js', from: null, to: null, caughtBy: null });
  assert.ok(r.passedAll, `the control failed: ${r.failed.join(' | ')}`);
});
test('control: the unmutated copy passes sky-prism-crisp.test.js (D410)', () => {
  const r = runMutant({ id: 'control', test: 'sky-prism-crisp.test.js', file: 'lib/theme.js', from: null, to: null, caughtBy: null });
  assert.ok(r.passedAll, `the control failed: ${r.failed.join(' | ')}`);
});
for (const m of MUTATIONS) {
  const skip = m.chrome && !HAS_CHROME ? 'no Chrome here (set CHROME_PATH): the row that catches this mutant draws in headless Chrome' : false;
  test(`mutation ${m.id}: applied, and caught by "${m.caughtBy}…"`, { skip }, () => {
    const r = runMutant(m);
    assert.ok(r.applied, `NOT APPLIED: "${m.from}" occurs ${r.n} times in app/${m.file}`);
    assert.ok(r.caught, `NOT CAUGHT; failing tests on the mutant: ${r.failed.join(' | ') || 'none'}`);
  });
}
module.exports = { MUTATIONS, runMutant };
