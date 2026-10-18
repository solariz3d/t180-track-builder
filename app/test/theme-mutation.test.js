// theme-mutation.test.js: node --test app/test/theme-mutation.test.js
// D381 part 2a (pane B): the skin pick and the token reader, mutated. Each mutation copies app/ (all but its tests, plus
// theme.test.js), src/ and tools/ to a temp folder, applies ONE source patch, and runs the COPIED theme.test.js there. "Applied" means the patch text was
// found exactly once; "caught" means the named test FAILED on the mutant. A CONTROL runs the unmutated copy first. The originals are never touched.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');

const MUTATIONS = [
  { id: 'T1 any name sets a skin', file: 'lib/theme.js', from: "if (typeof melody === 'string' && THEMES.includes(melody))", to: "if (typeof melody === 'string')", caughtBy: 'each melody sets its own skin' },
  { id: 'T2 the head rounds the pick', file: 'index.html', from: 'names[Math.floor(r * names.length)]', to: 'names[Math.round(r * (names.length - 1))]', caughtBy: 'the page sets the skin in its head' },
  { id: 'T3 the head names the melodies in another order', file: 'index.html', from: "names = ['aqua', 'skyline', 'glass', 'aurora']", to: "names = ['skyline', 'aqua', 'glass', 'aurora']", caughtBy: 'the page sets the skin in its head' },
  { id: 'T4 the boot does not follow the player', file: 'index.html', from: 'applyTheme(document, sound.melody)', to: 'applyTheme(document, null)', caughtBy: 'the page sets the skin in its head' },
  { id: 'T5 a skin change keeps the old colours', file: 'lib/tokens.js', from: 'refresh() { cache.clear(); version++;', to: 'refresh() { version++;', caughtBy: 'the reader reads again' },
  { id: 'T6 the reader watches the wrong attribute', file: 'lib/tokens.js', from: "attributeFilter: ['data-theme']", to: "attributeFilter: ['class']", caughtBy: 'the reader reads again' },
  { id: 'T7 a translucent token comes back opaque', file: 'lib/tokens.js', from: 'c.rgba[3] === 1 ? hexOf(c)', to: 'true ? hexOf(c)', caughtBy: 'the reader understands every colour form' },
  { id: 'T8 color(srgb) floats are rounded to bytes', file: 'lib/tokens.js', from: 'clamp01(a)], floats: fl };', to: 'clamp01(a)], floats: fl.map((v) => Math.round(v * 255) / 255) };', caughtBy: 'the reader understands every colour form' },
  { id: 'T9 solid keeps a skin\'s alpha', file: 'lib/tokens.js', from: 'solid(name, fallback) { return hexOf(', to: 'solid(name, fallback) { return api.css(name, fallback); return hexOf(', caughtBy: 'the reader understands every colour form' },
  { id: 'T10 a missing token is black, not today\'s colour', file: 'lib/tokens.js', from: 'if (!c) return fallback;', to: "if (!c) return '#000000';", caughtBy: 'the reader falls back' },
  { id: 'T11 an unreadable token is not reported', file: 'lib/tokens.js', from: "if (v && !c && !said.has(name)) { said.add(name); say(", to: 'if (false) { say(', caughtBy: 'the reader falls back' },
  { id: 'T12 the 3D sky ignores the skin', file: 'preview/renderer.js', from: 'if (t.sky) clear = t.sky;', to: '', caughtBy: 'SIGIL\'s 3D frame is the same' },
  { id: 'T13 SIGIL\'s grid token drifts from the literal', file: 'index.html', from: '--ground-grid: color(srgb 0.2 0.23 0.28)', to: '--ground-grid: color(srgb 0.2 0.23 0.29)', caughtBy: 'SIGIL\'s tokens are today\'s literals' },
];

function runMutant(m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-theme-mut-')), app = path.join(dir, 'app');
  try {
    fs.cpSync(path.join(ROOT, 'app'), app, { recursive: true, filter: (s) => path.relative(path.join(ROOT, 'app'), s) !== 'test' });
    fs.mkdirSync(path.join(app, 'test')); fs.copyFileSync(path.join(__dirname, 'theme.test.js'), path.join(app, 'test', 'theme.test.js'));
    for (const d of ['src', 'tools']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
    const f = path.join(app, m.file), src = fs.readFileSync(f, 'utf8'), n = m.from === null ? 1 : src.split(m.from).length - 1, applied = n === 1;
    if (applied && m.from !== null) fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const r = spawnSync(process.execPath, ['--test', path.join(app, 'test', 'theme.test.js')],
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
for (const m of MUTATIONS) {
  test(`mutation ${m.id}: applied, and caught by "${m.caughtBy}…"`, () => {
    const r = runMutant(m);
    assert.ok(r.applied, `NOT APPLIED: "${m.from}" occurs ${r.n} times in app/${m.file}`);
    assert.ok(r.caught, `NOT CAUGHT; failing tests on the mutant: ${r.failed.join(' | ') || 'none'}`);
  });
}
module.exports = { MUTATIONS, runMutant };
