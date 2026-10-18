// sky-caustics-aurora.test.js: node --test app/test/sky-caustics-aurora.test.js
// D384 part 2: Aqua's 'caustics' sky and Aurora's 'aurora' sky, as style modules of app/preview/sky (the contract is in sky/index.js). Node has no
// GPU, so this checks what can be read from the text; the drawn result is measured in the real app (the hand-back's shots from two headings).
// Rows:
//   1  each style builds: the registry returns GLSL that defines vec3 skyPattern(vec3 dir, float t) (red while the module was a stub)
//   2  each source keeps to the contract: helpers named with the style's prefix, reads only the uniforms the pass declares (uSky, uSkyA, uSkyB,
//      uSkyC), declares no uniform, precision or #version of its own, and loops only to a constant bound (GLSL ES 1.0)
//   3  each skin names its style with --sky-style and sets every colour that style reads (one left unset would quietly fall back to --sky)
//   4  the screen-pinned layers are gone: neither skin draws on #preview::after (the sky moved into the world)
//   4b each skin's --sky-c is its --fog (D384 widened: under 10 degrees the sky pales only to the fog, so the far road fogs into the sky it meets)
//   4c Aqua's --bad is SIGIL's red hue made lighter, at least 4.5:1 on --panel, --bg and --raise (D384, A's review 6 finding 2)
//   5  the contract check is not vacuous: a helper without the prefix, a stray uniform, a declared uniform and a loop to a variable are each refused
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');

const APP = path.join(__dirname, '..');
const SKY = require(path.join(APP, 'preview', 'sky', 'index.js'));
const SKINS = { caustics: 'aqua', aurora: 'aurora' };
const PASS_UNIFORMS = ['uSky', 'uSkyA', 'uSkyB', 'uSkyC'];
const TOKEN_OF = { uSkyA: '--sky-a', uSkyB: '--sky-b', uSkyC: '--sky-c' };

const strip = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
/** Every way a style's GLSL breaks the module contract, as readable lines (empty: it keeps it). */
function contractProblems(style, src) {
  const s = strip(src), out = [];
  for (const m of s.matchAll(/\b(?:float|vec[234]|mat[234]|int|bool|void)\s+(\w+)\s*\(/g)) if (m[1] !== 'skyPattern' && !m[1].startsWith(style + '_')) out.push(`helper ${m[1]} lacks the prefix ${style}_`);
  for (const m of new Set([...s.matchAll(/\bu[A-Z]\w*/g)].map((x) => x[0]))) if (!PASS_UNIFORMS.includes(m)) out.push(`reads ${m}, which the pass does not declare`);
  if (/\buniform\b/.test(s)) out.push('declares a uniform (the pass declares them)');
  if (/\bprecision\b|#version/.test(s)) out.push('sets a precision or #version (the pass does)');
  for (const m of s.matchAll(/for\s*\(([^;]*);([^;]*);/g)) if (!/^\s*\w+\s*<=?\s*\d+(\.\d+)?\s*$/.test(m[2])) out.push(`a loop to a bound that is not a constant: ${m[2].trim()}`);
  return out;
}
const used = (src) => PASS_UNIFORMS.filter((u) => new RegExp(`\\b${u}\\b`).test(strip(src)));
const css = (skin) => fs.readFileSync(path.join(APP, 'themes', `${skin}.css`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

for (const style of Object.keys(SKINS)) {
  test(`${style}: the registry builds it, GLSL defining vec3 skyPattern(vec3 dir, float t)`, () => {
    const src = SKY.patternSource(style);   // red at 66b243c: "sky: the <style> style is not built yet"
    assert.match(src, /vec3\s+skyPattern\s*\(\s*vec3\s+dir\s*,\s*float\s+t\s*\)/);
  });
  test(`${style}: keeps the module contract (prefixed helpers, the pass's uniforms only, nothing declared, constant loops)`, () => {
    assert.deepEqual(contractProblems(style, SKY.patternSource(style)), []);
  });
  test(`${SKINS[style]}.css names the ${style} sky and sets every colour it reads`, () => {
    const c = css(SKINS[style]);
    assert.match(c, new RegExp(`--sky-style:\\s*${style}\\s*;`));
    for (const u of used(SKY.patternSource(style))) if (TOKEN_OF[u]) assert.match(c, new RegExp(`${TOKEN_OF[u]}:\\s*color\\(srgb [\\d.]+ [\\d.]+ [\\d.]+\\)`), `${style} reads ${u}, so ${SKINS[style]}.css sets ${TOKEN_OF[u]}`);
  });
}
for (const skin of Object.values(SKINS)) test(`${skin}.css: --sky-c is its --fog, so the sky meets the far road in the fog colour under 10 degrees`, () => {
  const c = css(skin), val = (k) => { const m = new RegExp(`${k}:\\s*(color\\(srgb [\\d. ]+\\))`).exec(c); assert.ok(m, `${skin}.css sets ${k}`); return m[1]; };
  assert.equal(val('--sky-c'), val('--fog'));
});
test('aqua.css: --bad is SIGIL\'s red, only lighter, and reads at least 4.5:1 on --panel, --bg and --raise (D384, A\'s review 6 finding 2)', () => {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const Y = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
  const ratio = (a, b) => { const x = Y(a), y = Y(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hue = ([r, g, b]) => { const M = Math.max(r, g, b), m = Math.min(r, g, b), d = M - m; let h = M === r ? ((g - b) / d) % 6 : M === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; return h < 0 ? h + 360 : h; };
  const c = css('aqua'), tok = (k) => { const m = new RegExp(`${k}:\\s*(#[0-9a-f]{6})\\b`, 'i').exec(c); assert.ok(m, `aqua.css sets ${k}`); return hex(m[1]); };
  const sigil = /--bad:\s*(#[0-9a-f]{6})/i.exec(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'));
  assert.ok(sigil, 'SIGIL sets --bad in app/index.html');
  const bad = tok('--bad');
  assert.ok(Math.abs(hue(bad) - hue(hex(sigil[1]))) < 1, `the same red hue as SIGIL's ${sigil[1]}: ${hue(bad).toFixed(2)} against ${hue(hex(sigil[1])).toFixed(2)}`);
  for (const k of ['--panel', '--bg', '--raise']) assert.ok(ratio(bad, tok(k)) >= 4.5, `--bad on ${k}: ${ratio(bad, tok(k)).toFixed(2)}:1`);
});
test('neither skin draws a screen-pinned layer on #preview::after any more (the sky is in the world)', () => {
  for (const skin of Object.values(SKINS)) assert.doesNotMatch(css(skin), /#preview::after/, `${skin}.css`);
});
test('the contract check refuses each kind of break (it is not vacuous)', () => {
  const ok = 'float caustics_a(float x) { return x; }\nvec3 skyPattern(vec3 dir, float t) { for (int k = 0; k < 4; k++) {} return uSky + uSkyA; }';
  assert.deepEqual(contractProblems('caustics', ok), []);
  for (const bad of [
    'float a(float x) { return x; }\nvec3 skyPattern(vec3 dir, float t) { return uSky; }',
    'vec3 skyPattern(vec3 dir, float t) { return uSky * uTime; }',
    'uniform vec3 uSky;\nvec3 skyPattern(vec3 dir, float t) { return uSky; }',
    'precision mediump float;\nvec3 skyPattern(vec3 dir, float t) { return uSky; }',
    'vec3 skyPattern(vec3 dir, float t) { int n = 3; for (int k = 0; k < n; k++) {} return uSky; }',
  ]) assert.ok(contractProblems('caustics', bad).length > 0, `refused: ${bad}`);
});
