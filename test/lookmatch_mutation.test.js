// lookmatch_mutation.test.js: node --test test/lookmatch_mutation.test.js (D179)
// Each mutation copies src/, app/preview/ and scripts/lookmatch.js to a temp folder (the look-match modules require across
// them), applies ONE source patch, and runs test/lookmatch.test.js against the copy. "Applied" means the patch text was
// found and changed; "caught" means the named test FAILED on the mutant. The originals are never touched.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

const MUTATIONS = [
  { id: 'K1 CIEDE2000 without its lightness weight SL', file: 'src/lookmatch/metric.js', from: 'const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2)', to: 'const SL = 1', caughtBy: 'metric: CIEDE2000 gives Sharma' },
  { id: 'K2 CIEDE2000 without the a* rescaling G', file: 'src/lookmatch/metric.js', from: 'const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + P25)));', to: 'const G = 0;', caughtBy: 'metric: CIEDE2000 gives Sharma' },
  { id: 'K3 CIEDE2000 without the blue-region rotation term RT', file: 'src/lookmatch/metric.js', from: 'return Math.sqrt(l * l + c * c + hh * hh + RT * c * hh);', to: 'return Math.sqrt(l * l + c * c + hh * hh);', caughtBy: 'metric: CIEDE2000 gives Sharma' },
  { id: 'K4 the mask reads only one image\'s alpha', file: 'src/lookmatch/metric.js', from: 'if (A[i + 3] < 128 || B[i + 3] < 128) continue;', to: 'if (B[i + 3] < 128) continue;', caughtBy: 'metric: sRGB white and black' },
  { id: 'K5 an anchor pointing backwards is not turned round', file: 'src/lookmatch/cameras.js', from: 'if (race && dot(F, race) < 0) F = mul(F, -1);', to: '', caughtBy: 'cameras: an anchor whose axis points backwards' },
  { id: 'K6 yaw turns right, not left', file: 'src/lookmatch/cameras.js', from: 'const H = add(mul(F, Math.cos(yaw)), mul(L, Math.sin(yaw)))', to: 'const H = add(mul(F, Math.cos(yaw)), mul(R, Math.sin(yaw)))', caughtBy: 'cameras: forward and right move the eye' },
  { id: 'K7 meshes AC flags invisible are drawn', file: 'src/lookmatch/kn5scene.js', from: 'if (visible && renderable) meshes.push', to: 'meshes.push', caughtBy: 'kn5 reader: a mesh AC flags not visible' },
  { id: 'K8 the kn5 v is flipped on reading (a texture upside down)', file: 'src/lookmatch/kn5scene.js', from: 'uv[v * 2 + 1] = b.readFloatLE(o + 28);', to: 'uv[v * 2 + 1] = 1 - b.readFloatLE(o + 28);', caughtBy: 'kn5 reader: what the export writes reads back' },
  { id: 'K9 DXT1 without its 3-colour mode', file: 'src/lookmatch/dds.js', from: 'if (!dxt1 || c0 > c1) {', to: 'if (true) {', caughtBy: 'dds: a DXT1 block decodes' },
  { id: 'K10 the mip level ignores maxSide', file: 'src/lookmatch/dds.js', from: 'while (level < mips - 1 && Math.max(w, hh) > maxSide)', to: 'while (false)', caughtBy: 'dds: an uncompressed 32-bit DDS' },
  { id: 'K11 no depth test', file: 'src/lookmatch/raster.js', from: 'if (zv >= depth[di]) continue;', to: '', caughtBy: 'raster: the nearer surface wins' },
  { id: 'K12 a triangle through the near plane is dropped, not clipped', file: 'src/lookmatch/raster.js', from: 'if (poly.some((v) => v[2] > -near)) {', to: 'if (poly.some((v) => v[2] > -near)) { continue;', caughtBy: 'raster: a triangle through the near plane' },
  { id: 'K13 the alpha test ignored', file: 'src/lookmatch/raster.js', from: 'if (M.un.alphaTested && tx[3] / 255 < M.un.alphaRef) continue;', to: '', caughtBy: 'raster: an alpha-tested material' },
  { id: 'K14 no fog', file: 'src/lookmatch/raster.js', from: 'k2 = Math.min(1, Math.max(0, Math.exp(-fogDensity * zv)))', to: 'k2 = 1', caughtBy: 'raster: far away' },
  { id: 'K15 a render into the repository is allowed', file: 'scripts/lookmatch.js', from: 'function insideRepo(p) {', to: 'function insideRepo(p) { return false;', caughtBy: 'cli: a render into the repository is refused' },
];

function runMutant(m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-lookmatch-mut-'));
  try {
    fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'app', 'preview'), path.join(dir, 'app', 'preview'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'scripts')); fs.copyFileSync(path.join(ROOT, 'scripts', 'lookmatch.js'), path.join(dir, 'scripts', 'lookmatch.js'));
    const f = path.join(dir, m.file), src = fs.readFileSync(f, 'utf8'), applied = m.from === null || src.includes(m.from);
    if (applied && m.from !== null) fs.writeFileSync(f, src.replace(m.from, m.to));
    const r = spawnSync(process.execPath, ['--test', '--test-concurrency=4', path.join(__dirname, 'lookmatch.test.js')],
      { env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), LOOKMATCH_DIR: path.join(dir, 'src', 'lookmatch'), LOOKMATCH_CLI: path.join(dir, 'scripts', 'lookmatch.js'), ACLOOK: path.join(dir, 'app', 'preview', 'aclook.js') }, encoding: 'utf8', timeout: 300000 });
    if (r.error) throw r.error;
    const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
    if (!/ℹ tests \d+/.test(out)) throw new Error('the mutant test run printed no summary:\n' + out.slice(0, 2000));
    const failed = out.split('\n').filter((l) => /^✖ /.test(l) && !/^✖ failing tests:/.test(l) && !/# TODO/.test(l)).map((l) => l.slice(2));
    return { applied, caught: failed.some((l) => l.includes(m.caughtBy)), failed: [...new Set(failed)] };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('control: the unmutated copy passes every look-match test', () => {
  const r = runMutant({ file: 'src/lookmatch/metric.js', from: null, to: null, caughtBy: '(no test is named this)' });
  assert.deepEqual(r.failed, [], `the unmutated copy fails: ${r.failed.join(' | ')}`);
});
for (const m of MUTATIONS) {
  test(`mutation ${m.id}: applied, and caught by "${m.caughtBy}…"`, () => {
    const r = runMutant(m);
    assert.ok(r.applied, `NOT APPLIED: "${m.from}" is not in ${m.file}`);
    assert.ok(r.caught, `NOT CAUGHT; failing tests on the mutant: ${r.failed.join(' | ') || 'none'}`);
  });
}
module.exports = { MUTATIONS, runMutant };
