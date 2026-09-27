// mutation.test.js: node --test app/test/mutation.test.js
// Each mutation copies app/camera and app/preview (and src/geom, which they require by relative path) to a temp folder,
// applies ONE source patch, and runs the preview and camera tests against the mutant (APP_DIR). "Applied" means the
// patch text was found and changed; "caught" means the named test FAILED on the mutant. The originals are never touched.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');

const MUTATIONS = [
  { id: 'A1 the build view looks backward', file: 'camera/cameras.js',
    from: 'return { eye: c.eye, target: c.target, up: c.up, fov };', to: 'return { eye: c.target, target: c.eye, up: c.up, fov };', caughtBy: 'build view (default)' },
  { id: 'A2 the build key does nothing from free mode', file: 'camera/cameras.js',
    from: "if (k === keys.build) mode = 'build';", to: "if (k === keys.build && mode !== 'free') mode = 'build';", caughtBy: 'the build view is ONE key away' },
  { id: 'A3 the switch key skips a mode', file: 'camera/cameras.js',
    from: 'mode = order[(order.indexOf(mode) + 1) % order.length];', to: 'mode = order[(order.indexOf(mode) + 2) % order.length];', caughtBy: 'the switch key walks' },
  { id: 'A4 chase ignores its lag (sits on the head)', file: 'camera/cameras.js',
    from: 'e = sampleAt(path, head.s - o.lag)', to: 'e = sampleAt(path, head.s)', caughtBy: 'chase: 25 m behind' },
  { id: 'A5 chase lifts along world up, not the road\'s up', file: 'camera/cameras.js',
    from: 'return { eye: add(e.pos, mul(e.U, o.height)), target, up: e.U, fov };', to: 'return { eye: add(e.pos, [0, o.height, 0]), target, up: [0, 1, 0], fov };', caughtBy: 'chase through a loop-the-loop' },
  { id: 'A6 overhead\'s loop fallback is a fixed north', file: 'camera/cameras.js',
    from: 'return horiz(cross(head.L, WORLD_UP)) || [0, 0, 1];', to: 'return [0, 0, 1];', caughtBy: 'overhead: inside a loop' },
  { id: 'A7 free mode follows the head like the build view', file: 'camera/cameras.js',
    from: "const p = mode === 'free' ? freePose() : poseFor(mode, ctx, opts);", to: "const p = poseFor(mode === 'free' ? 'build' : mode, ctx, opts);", caughtBy: 'after an append' },
  { id: 'A8 entering free does not take over the view', file: 'camera/cameras.js',
    from: "if (mode === 'free' && was !== 'free') enterFree(shown", to: "if (false) enterFree(shown", caughtBy: 'entering free keeps the view' },
  { id: 'A9 the shown pose snaps instead of easing', file: 'camera/cameras.js',
    from: 'const k = 1 - Math.exp(', to: 'const k = 1 || Math.exp(', caughtBy: 'the shown pose eases' },
  { id: 'A10 the renderer re-uploads every array every frame', file: 'preview/renderer.js',
    from: 'let e = buffers.get(arr);', to: 'let e = null;', caughtBy: 'renderer: every array is uploaded once' },
  { id: 'A11 the renderer never deletes a stale buffer', file: 'preview/renderer.js',
    from: 'if (e.gen !== gen) {', to: 'if (false) {', caughtBy: 'renderer: after a sculpt' },
  { id: 'A12 batches copy the arrays (a sculpt re-uploads everything)', file: 'preview/batches.js',
    from: 'positions: m.positions,', to: 'positions: Float32Array.from(m.positions),', caughtBy: 'renderer: after a sculpt' },
  { id: 'A13 the track model never extends (always a full build)', file: 'preview/trackmodel.js',
    from: 'else if (g === keys.length) {', to: 'else if (false) {', caughtBy: 'track model: append' },
  { id: 'A14 the model matrix transposed', file: 'preview/batches.js',
    from: 'model: node.matrix,', to: 'model: [0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3].map((c) => node.matrix[c * 4 + r])),', caughtBy: 'batches: the node matrix' },
];

function runMutant(m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-app-mut-')), app = path.join(dir, 'app');
  try {
    for (const d of ['camera', 'preview']) fs.cpSync(path.join(ROOT, 'app', d), path.join(app, d), { recursive: true });
    fs.cpSync(path.join(ROOT, 'src', 'geom'), path.join(dir, 'src', 'geom'), { recursive: true });   // required as ../../src/geom
    const f = path.join(app, m.file), src = fs.readFileSync(f, 'utf8'), applied = src.includes(m.from);
    if (applied) fs.writeFileSync(f, src.replace(m.from, m.to));
    const r = spawnSync(process.execPath, ['--test', path.join(__dirname, 'camera.test.js'), path.join(__dirname, 'preview.test.js')],
      { env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), APP_DIR: app }, encoding: 'utf8', timeout: 300000 });
    if (r.error) throw r.error;
    const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
    if (!/ℹ tests \d+/.test(out)) throw new Error('the mutant test run printed no summary:\n' + out.slice(0, 2000));
    const failed = out.split('\n').filter((l) => /^✖ /.test(l)).map((l) => l.slice(2));
    return { applied, caught: failed.some((l) => l.includes(m.caughtBy)), failed: [...new Set(failed)] };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

for (const m of MUTATIONS) {
  test(`mutation ${m.id}: applied, and caught by "${m.caughtBy}…"`, () => {
    const r = runMutant(m);
    assert.ok(r.applied, `NOT APPLIED: "${m.from}" is not in app/${m.file}`);
    assert.ok(r.caught, `NOT CAUGHT; failing tests on the mutant: ${r.failed.join(' | ') || 'none'}`);
  });
}
module.exports = { MUTATIONS, runMutant };
