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
  // D169: DPR, modifier keys, the mount error, the probe, and the window proof's judge
  { id: 'A15 the backing store ignores devicePixelRatio', file: 'preview/preview.js',
    from: 'backingSize(canvas.clientWidth, canvas.clientHeight, win.devicePixelRatio)', to: 'backingSize(canvas.clientWidth, canvas.clientHeight, 1)', caughtBy: 'DPR: the backing store is the css size' },
  { id: 'A16 the size cap drops the aspect (one side clamped alone)', file: 'preview/preview.js',
    from: 'if (over > 1) { w = Math.round(w / over); h = Math.round(h / over); }', to: 'if (over > 1) { w = Math.min(w, MAX_SIDE); }', caughtBy: 'DPR edges' },
  { id: 'A17 Ctrl/Alt/Meta ignored by keyAction', file: 'preview/preview.js',
    from: 'if (mods && (mods.ctrlKey || mods.altKey || mods.metaKey)) return null;', to: '', caughtBy: 'keys: Ctrl, Alt or Meta' },
  { id: 'A18 the frame loop passes no modifiers (Ctrl+C cycles the camera)', file: 'preview/preview.js',
    from: 'const a = keyAction(e.key, e);', to: 'const a = keyAction(e.key);', caughtBy: 'keys in the frame loop' },
  { id: 'A19 a failed mount is swallowed', file: 'preview/index.js',
    from: 'throw new PreviewMountError(msg, e);', to: 'return null;', caughtBy: 'mount failure' },
  { id: 'A20 the probe skips the perspective divide', file: 'testhook/probe.js',
    from: 'headNdc: clip[3] > 0 ? [clip[0] / clip[3], clip[1] / clip[3], clip[2] / clip[3]] : null,', to: 'headNdc: clip[3] > 0 ? [clip[0], clip[1], clip[2]] : null,', caughtBy: 'probe: the head lands in the middle' },
  { id: 'A21 the judge accepts a view with nothing drawn', root: 'scripts', file: 'prove_render.js',
    from: 'frac >= 0.01', to: 'frac >= 0', caughtBy: 'judge: each failure' },
  { id: 'A22 the judge never checks DPR', root: 'scripts', file: 'prove_render.js',
    from: 'c.width === Math.round(c.cssWidth * c.dpr)', to: 'c.width > 0', caughtBy: 'judge: each failure' },
  // D170: light, road lines, the overhead fit, the ghost, the grid and the marker
  { id: 'B1 no key light (only ambient and fill)', file: 'preview/look.js',
    from: 'keyK: 0.72,', to: 'keyK: 0,', caughtBy: 'light: a floor and a vertical wall' },
  { id: 'B2 one-sided light (an overhang goes dark)', file: 'preview/look.js',
    from: 'const m = d(n, LIGHT.key) < 0 && d(n, LIGHT.fill) < 0 ? n.map((x) => -x) : n;', to: 'const m = n;', caughtBy: 'light: two-sided' },
  { id: 'B3 the shader key strength drifts from look.js', file: 'preview/renderer.js',
    from: '${LIGHT.keyK.toFixed(6)} * max(dot(n, key), 0.0)', to: '0.5 * max(dot(n, key), 0.0)', caughtBy: 'light: the fragment shader carries' },
  { id: 'B4 the edge lines one vertex in from the edges', file: 'preview/look.js',
    from: 'for (const k of [0, kc, K - 1])', to: 'for (const k of [1, kc, K - 2])', caughtBy: 'edge lines: through the two edge vertices' },
  { id: 'B5 the lines not lifted off the surface (they would z-fight)', file: 'preview/look.js',
    from: 'return [P[i] + N[i] * LIFT, P[i + 1] + N[i + 1] * LIFT, P[i + 2] + N[i + 2] * LIFT];', to: 'return [P[i], P[i + 1], P[i + 2]];', caughtBy: 'edge lines: through the two edge vertices' },
  { id: 'B6 no ties across the road', file: 'preview/look.js',
    from: 'if (!(r === 0 || Math.floor(b.rowS[r] / TIE_M) !== Math.floor(b.rowS[r - 1] / TIE_M))) continue;', to: 'continue;', caughtBy: 'edge lines: a tie across the road' },
  { id: 'B7 the overhead fit ignores the aspect', file: 'camera/cameras.js',
    from: 'hr / (t * aspect)', to: 'hr / t', caughtBy: 'overhead fit (aspect 0.6)' },
  { id: 'B8 the overhead fit measures from the box bottom (the top is clipped)', file: 'camera/cameras.js',
    from: 'const eye = [c[0], bounds.max[1] + dist, c[2]];', to: 'const eye = [c[0], bounds.min[1] + dist * 0.85, c[2]];', caughtBy: 'overhead fit' },
  { id: 'B9 the world box takes one corner of each local box', file: 'preview/look.js',
    from: 'for (let c = 0; c < 8; c++) {', to: 'for (let c = 0; c < 1; c++) {', caughtBy: 'overhead fit' },
  { id: 'B10 the ghost is built on the live path (no copy)', file: 'preview/trackmodel.js',
    from: 'const p = { ...path, samples: path.samples.slice(), starts: path.starts.slice(), segFirst: path.segFirst.slice(), segEnd: path.segEnd.slice(), blocks };', to: 'const p = path;', caughtBy: 'ghost: the ghost of a segment tail' },
  { id: 'B11 placing the word does not retire its ghost', file: 'preview/preview.js',
    from: "if (track.how !== 'same' && track.how !== 'kept') ghost = null;", to: '', caughtBy: 'preview: showGhost draws the ghost' },
  { id: 'B12 the candidate ignores the font picker', file: 'testhook/ghostword.js',
    from: "font: font === 'auto' || word === 'jump' ? undefined : font", to: 'font: undefined', caughtBy: 'ghost through A' },
  { id: 'B13 the grid floats above y = 0', file: 'preview/look.js',
    from: 'for (let x = x0; x <= x1 + 1e-9; x += sp) p.push(x, 0, z0, x, 0, z1);', to: 'for (let x = x0; x <= x1 + 1e-9; x += sp) p.push(x, 0.5, z0, x, 0.5, z1);', caughtBy: 'grid: every vertex at y = 0' },
  { id: 'B14 the ghost is never drawn', file: 'preview/renderer.js',
    from: 'drawSurfaces(extras.ghost, vp, GHOST_ALPHA, COLOURS.ghost);', to: '', caughtBy: 'preview: showGhost draws the ghost' },
  { id: 'B16 the head marker does not grow with distance (a speck from overhead)', file: 'preview/preview.js',
    from: 'Math.max(3, 0.02 * Math.hypot(', to: 'Math.max(3, 0 * Math.hypot(', caughtBy: 'head marker: it grows' },
  { id: 'B15 the head marker is never drawn', file: 'preview/renderer.js',
    from: 'if (extras.marker) {', to: 'if (false) {', caughtBy: 'preview: a frame draws the grid and the head marker' },
  // D175: hardening (the soak, per-cell rebuild, no mesh over IPC)
  { id: 'P1 a sculpt re-places the path but keeps the old mesh', file: 'preview/trackmodel.js', from: 'geom.rebuildPathFrom(path, segs, g); mesh = geom.sculptMesh(mesh, path, segs, g);', to: 'geom.rebuildPathFrom(path, segs, g);', caughtBy: 'soak:' },
  { id: 'P2 every change rebuilds the whole track (no per-cell reuse)', file: 'preview/trackmodel.js', from: 'else if (nk.length >= keys.length) {', to: 'else if (false) {', caughtBy: 'per-cell rebuild: a length sculpt' },
  { id: 'P3 the preview reaches for the native side', file: 'preview/preview.js', from: 'const FLY = ', to: 'const leak = (s) => s && s.storage.saveDoc; const FLY = ', caughtBy: 'no mesh over IPC: app/preview and app/camera' },
  // D173: the texture maker's editor and panel
  { id: 'T1 the editor ignores the value it is given', file: 'texmaker/model.js', from: 'L[i] = { ...L[i], [key]: value };', to: 'L[i] = { ...L[i], [key]: L[i][key] };', caughtBy: 'editor: an accepted edit changes the canonical text' },
  { id: 'T2 the panel never calls onChange', file: 'texmaker/index.js', from: 'if (onChange) onChange(now);', to: '', caughtBy: 'panel: an accepted edit calls onChange' },
  // D177: the AC look (app/preview/aclook.js, acshaders.js, the renderer's AC path, the preview's texture set)
  { id: 'L1 ksAmbient is read from ksDiffuse', file: 'preview/aclook.js', from: "ambient: propA(m, 'ksAmbient')", to: "ambient: propA(m, 'ksDiffuse')", caughtBy: 'mapping: ksAmbient, ksDiffuse' },
  { id: 'L2 a missing property reads 1, not 0', file: 'preview/aclook.js', from: 'return p ? p.value[0] : 0; };', to: 'return p ? p.value[0] : 1; };', caughtBy: 'mapping: a property the material lacks reads 0' },
  { id: 'L3 the multilayer R and G scales are swapped', file: 'preview/aclook.js', from: "multR: propA(m, 'multR'), multG: propA(m, 'multG')", to: "multR: propA(m, 'multG'), multG: propA(m, 'multR')", caughtBy: 'mapping: ksMultilayer takes' },
  { id: 'L4 ksPerPixelNM falls to ksPerPixel', file: 'preview/aclook.js', from: "if (NM.has(m.shader)) return 'ksPerPixelNM';", to: '', caughtBy: 'mapping: the shader picks the program' },
  { id: 'L5 the renderer never sets ksSpecular', file: 'preview/renderer.js', from: 'gl.uniform1f(pr.ksSpecular, u.specular);', to: '', caughtBy: 'renderer: an AC material' },
  { id: 'L6 every sampler gets the white texel', file: 'preview/renderer.js', from: 'textureFor(u.textures[name] && images ? images.get(u.textures[name]) : null)', to: 'textureFor(null)', caughtBy: 'renderer: a named texture is uploaded' },
  { id: 'L7 the multilayer scales never reach the shader', file: 'preview/renderer.js', from: 'if (u.detail) for (', to: 'if (false) for (', caughtBy: 'renderer: the multilayer scales' },
  { id: 'L8 textures are never deleted', file: 'preview/renderer.js', from: 'if (e.gen !== gen) { gl.deleteTexture(e.t);', to: 'if (false) { gl.deleteTexture(e.t);', caughtBy: 'renderer: a texture no longer drawn' },
  { id: 'L9 a shader loses a uniform declaration', file: 'preview/acshaders.js', from: 'uniform float ksSpecular;', to: 'float ksSpecular;', caughtBy: 'shaders: every uniform the renderer sets' },
  { id: 'L10 an untextured set slot replaces the exported material', file: 'preview/aclook.js', from: 'if (slots && slots.floor && (slots.floor.settings.texture || slots.floor.settings.make)) {', to: 'if (slots && slots.floor) {', caughtBy: 'textured: an untextured floor' },
  { id: 'L11 the set is ignored', file: 'preview/aclook.js', from: 'const slots = set && b.segId != null ? set.bySegment(b.segId) : null;', to: 'const slots = null;', caughtBy: 'textured: a word whose floor names' },
  { id: 'L12 textures are keyed by name, not by the kn5 file', file: 'preview/aclook.js', from: 'images.map((t) => [t.file,', to: 'images.map((t) => [t.name,', caughtBy: "textured: the preview's texels" },
  { id: 'L13 the default look is the word colours', file: 'preview/preview.js', from: "let set = null, images = [], look = 'ac'", to: "let set = null, images = [], look = 'words'", caughtBy: 'preview: the AC look is the default' },
  { id: 'L14 setTextureSet drops the set', file: 'preview/preview.js', from: 'set = s || null;', to: 'set = null;', caughtBy: 'preview: a texture set with a made floor' },
  { id: 'L15 a property is read from the wrong material', file: 'preview/aclook.js', from: 'const m = scene.materials[b.materialIndex];', to: 'const m = scene.materials[0] && { ...scene.materials[0], name: String(b.materialIndex) };', caughtBy: 'list: every mesh the preview draws is in the kn5' },
  { id: 'L16 L does not change the look (the colour per word is unreachable)', file: 'preview/preview.js', from: "if (a.look) { look = look === 'ac' ? 'words' : 'ac';", to: 'if (a.look) {', caughtBy: 'preview: L toggles the look' },
];

function runMutant(m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-app-mut-')), app = path.join(dir, 'app');
  try {
    for (const d of ['camera', 'preview', 'testhook', 'texmaker']) fs.cpSync(path.join(ROOT, 'app', d), path.join(app, d), { recursive: true });
    fs.mkdirSync(path.join(dir, 'scripts')); fs.copyFileSync(path.join(ROOT, 'scripts', 'prove_render.js'), path.join(dir, 'scripts', 'prove_render.js'));
    fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });   // all of src/: the modules reach across it (src/doc now requires src/validate)
    fs.cpSync(path.join(ROOT, 'tools'), path.join(dir, 'tools'), { recursive: true });   // src/export/fromwords.js reads its kn5 back with tools/kn5.cjs (D177: the export is in the look's list test)
    const f = m.root === 'scripts' ? path.join(dir, 'scripts', m.file) : path.join(app, m.file), src = fs.readFileSync(f, 'utf8'), applied = m.from === null || src.includes(m.from);
    if (applied && m.from !== null) fs.writeFileSync(f, src.replace(m.from, m.to));
    const r = spawnSync(process.execPath, ['--test', '--test-concurrency=4', path.join(__dirname, 'camera.test.js'), path.join(__dirname, 'preview.test.js'), path.join(__dirname, 'render_proof.test.js'), path.join(__dirname, 'look.test.js'), path.join(__dirname, 'texmaker-panel.test.js'), path.join(__dirname, 'aclook.test.js'), path.join(ROOT, 'test', 'perf.test.js'), path.join(ROOT, 'test', 'perf_soak.test.js'), path.join(ROOT, 'test', 'prove_render.test.js')],
      { env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), APP_DIR: app, SCRIPTS_DIR: path.join(dir, 'scripts') }, encoding: 'utf8', timeout: 300000 });
    if (r.error) throw r.error;
    const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
    if (!/ℹ tests \d+/.test(out)) throw new Error('the mutant test run printed no summary:\n' + out.slice(0, 2000));
    // a todo's failure is not a failure, and "✖ failing tests:" is only the summary's header
    const failed = out.split('\n').filter((l) => /^✖ /.test(l) && !/^✖ failing tests:/.test(l) && !/# TODO/.test(l)).map((l) => l.slice(2));
    return { applied, caught: failed.some((l) => l.includes(m.caughtBy)), failed: [...new Set(failed)] };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// THE CONTROL: the same temp copy with NO mutation must pass every test. A copy missing a file would fail everything,
// and every mutant would then look "caught"; this is the check that the catches mean something.
test('control: the unmutated temp copy passes every test the mutants are run against', () => {
  const r = runMutant({ id: 'control', file: 'preview/look.js', from: null, to: null, caughtBy: '(no test is named this)' });
  assert.deepEqual(r.failed, [], `the unmutated copy fails: ${r.failed.join(' | ')}`);
});
for (const m of MUTATIONS) {
  test(`mutation ${m.id}: applied, and caught by "${m.caughtBy}…"`, () => {
    const r = runMutant(m);
    assert.ok(r.applied, `NOT APPLIED: "${m.from}" is not in app/${m.file}`);
    assert.ok(r.caught, `NOT CAUGHT; failing tests on the mutant: ${r.failed.join(' | ') || 'none'}`);
  });
}
module.exports = { MUTATIONS, runMutant };
