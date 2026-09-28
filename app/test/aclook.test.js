// Tests for the AC look in the preview (D177, ARCHITECTURE §5.2): app/preview/aclook.js (the material → uniform mapping,
// the one reference light, what each batch is drawn with), app/preview/acshaders.js (the GLSL, checked statically here;
// it is compiled for real in the app window, see the D177 hand-back), app/preview/renderer.js's AC path (against a
// recording fake GL), and the list test: the preview draws the materials and textures the export writes, read back from
// real kn5 bytes (app/preview/kn5look.js). node --test, no dependencies.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
// the modules under test come from APP_DIR when the mutation harness (app/test/mutation.test.js) runs this file on a copy
const ADIR = process.env.APP_DIR || path.join(__dirname, '..'), SRC = path.join(ADIR, '..', 'src');
const A = require(path.join(ADIR, 'preview', 'aclook.js'));
const S = require(path.join(ADIR, 'preview', 'acshaders.js'));
const { createRenderer } = require(path.join(ADIR, 'preview', 'renderer.js'));
const { readLook, propSlots } = require(path.join(ADIR, 'preview', 'kn5look.js'));
const { createTrackModel } = require(path.join(ADIR, 'preview', 'trackmodel.js'));
const D = require(path.join(SRC, 'doc/index.js'));
const { closeLoop } = require(path.join(SRC, 'doc/connector.js'));
const { buildExport } = require(path.join(SRC, 'export/fromwords.js'));
const { writeKn5 } = require(path.join(SRC, 'export/kn5write.js'));
const T = require(path.join(SRC, 'texture/set.js'));
const { ddsLevel } = require(path.join(SRC, 'texture/dds.js'));
const TM = require(path.join(SRC, 'texmaker/text.js'));
const { PRESETS } = require(path.join(SRC, 'texmaker/presets.js'));
const { readKn5 } = require('../../tools/kn5.cjs');

const mat = (shader, props, samplers = [], extra = {}) => ({ name: 'm', shader, alphaBlend: 0, alphaTested: false, depthMode: 0,
  props: Object.entries(props).map(([name, value]) => ({ name, value: Array.isArray(value) ? value : [value] })),
  samplers: samplers.map(([name, texture], slot) => ({ name, slot, texture })), ...extra });

// ── the parameter mapping ────────────────────────────────────────────────────────────────────────────────────────────
test('mapping: ksAmbient, ksDiffuse, ksSpecular, ksSpecularEXP, ksEmissive and ksAlphaRef become the uniforms, value for value', () => {
  const u = A.uniformsFor(mat('ksPerPixel', { ksAmbient: 0.31, ksDiffuse: 0.62, ksSpecular: 0.17, ksSpecularEXP: 33, ksEmissive: [0.1, 0.2, 0.3], ksAlphaRef: 0.4 }));
  assert.deepStrictEqual([u.program, u.ambient, u.diffuse, u.specular, u.specularExp, u.emissive, u.alphaRef], ['ksPerPixel', 0.31, 0.62, 0.17, 33, [0.1, 0.2, 0.3], 0.4]);
});
test('mapping: a property the material lacks reads 0, as actools GetPropertyValue*ByName does', () => {
  const u = A.uniformsFor(mat('ksPerPixel', { ksDiffuse: 0.5 }));
  assert.deepStrictEqual([u.ambient, u.specular, u.specularExp, u.emissive, u.alphaRef], [0, 0, 0, [0, 0, 0], 0]);
});
test('mapping: txDiffuse is the texture the material\'s sampler names', () => {
  assert.strictEqual(A.uniformsFor(mat('ksPerPixel', {}, [['txDiffuse', 'a.dds']])).textures.txDiffuse, 'a.dds');
});
test('mapping: ksPerPixelNM takes txNormal and nmObjectSpace', () => {
  const u = A.uniformsFor(mat('ksPerPixelNM', { nmObjectSpace: 1 }, [['txDiffuse', 'd.dds'], ['txNormal', 'n.dds']]));
  assert.deepStrictEqual([u.program, u.textures.txNormal, u.nmObjectSpace], ['ksPerPixelNM', 'n.dds', true]);
});
test('mapping: ksMultilayer takes the mask, the four detail textures and their scales, and magicMult', () => {
  const u = A.uniformsFor(mat('ksMultilayer', { multR: 11, multG: 12, multB: 13, multA: 14, magicMult: 0.7 },
    [['txDiffuse', 'd.dds'], ['txMask', 'mask.dds'], ['txDetailR', 'r.dds'], ['txDetailG', 'g.dds'], ['txDetailB', 'b.dds'], ['txDetailA', 'x.dds']]));
  assert.deepStrictEqual({ program: u.program, detail: u.detail, textures: u.textures }, { program: 'ksMultilayer',
    detail: { multR: 11, multG: 12, multB: 13, multA: 14, magicMult: 0.7 },
    textures: { txDiffuse: 'd.dds', txMask: 'mask.dds', txDetailR: 'r.dds', txDetailG: 'g.dds', txDetailB: 'b.dds', txDetailA: 'x.dds' } });
});
test('mapping: the shader picks the program the way actools MaterialsProviderDark does', () => {
  const pick = (shader, samplers) => A.programFor(mat(shader, {}, samplers));
  assert.deepStrictEqual([pick('ksPerPixel'), pick('ksPerPixelAT'), pick('ksPerPixelAT_NS'), pick('ksTree'), pick('ksPerPixelNM'), pick('ksPerPixelNM_UV2'),
    pick('ksMultilayer'), pick('ksSomethingElse', [['txNormal', 'n.dds']]), pick('ksSomethingElse')],
  ['ksPerPixel', 'ksPerPixel', 'ksPerPixel', 'ksPerPixel', 'ksPerPixelNM', 'ksPerPixelNM', 'ksMultilayer', 'ksPerPixelNM', 'ksPerPixel']);
});
test('mapping: a material without a shader is refused', () => {
  assert.throws(() => A.uniformsFor({ name: 'x' }), /needs a shader/);
});

// ── the light, and the lighting sum ──────────────────────────────────────────────────────────────────────────────────
test('light: one sun, stated: 14:00, 42° up, and toSun is a unit vector at that elevation', () => {
  const L = A.LIGHT;
  assert.deepStrictEqual([L.time, L.elevationDeg, L.azimuthDeg, +Math.hypot(...L.toSun).toFixed(12), +Math.asin(L.toSun[1]).toFixed(12)], ['14:00', 42, 225, 1, +(42 * Math.PI / 180).toFixed(12)]);
});
test('shade: a white surface facing the sun, seen from the sun, is tx·(Ambient·ambient + Diffuse·sun) + Specular·sun', () => {
  const u = A.uniformsFor(mat('ksPerPixel', { ksAmbient: 0.4, ksDiffuse: 0.5, ksSpecular: 0.2, ksSpecularEXP: 10 })), n = A.LIGHT.toSun;
  const hemi = n[1] * 0.5 + 0.5, want = [0, 1, 2].map((c) => 0.4 * (A.LIGHT.ambientDown[c] + A.LIGHT.ambientRange[c] * hemi) + 0.5 * A.LIGHT.sun[c] + 0.2 * A.LIGHT.sun[c]);
  A.shade(u, [1, 1, 1], n, n, n).forEach((v, c) => assert.ok(Math.abs(v - want[c]) < 1e-12, `${c}: ${v} vs ${want[c]}`));
});
test('shade: a surface facing away from the sun gets ambient only (no diffuse, no specular)', () => {
  const u = A.uniformsFor(mat('ksPerPixel', { ksAmbient: 1, ksDiffuse: 1, ksSpecular: 1, ksSpecularEXP: 1 })), n = A.LIGHT.toSun.map((x) => -x);
  const hemi = n[1] * 0.5 + 0.5;
  A.shade(u, [1, 1, 1], n, A.LIGHT.toSun, [0, 1, 0]).forEach((v, c) => assert.ok(Math.abs(v - (A.LIGHT.ambientDown[c] + A.LIGHT.ambientRange[c] * hemi)) < 1e-12));
});

// ── the GLSL, statically (a real compile needs a GL context: the app window, see the hand-back) ─────────────────────
const declared = (src, kind, name) => new RegExp(`\\b${kind}\\b[^;]*\\b${name}\\b`).test(src);
test('shaders: every uniform the renderer sets is declared in each program it sets it for', () => {
  const common = ['ksAmbient', 'ksDiffuse', 'ksSpecular', 'ksSpecularEXP', 'ksEmissive', 'ksAlphaRef', 'uAlphaTested', 'uToSun', 'uSun', 'uAmbientDown', 'uAmbientRange', 'uEye', 'uFog', 'uFogDensity'];
  const own = { ksPerPixel: [], ksPerPixelNM: ['nmObjectSpace'], ksMultilayer: ['multR', 'multG', 'multB', 'multA', 'magicMult'] };
  const missing = [];
  for (const [p, fs] of Object.entries(S.PROGRAMS)) for (const n of [...common, ...own[p], ...S.SAMPLERS[p]]) if (!declared(fs, 'uniform', n)) missing.push(`${p}.${n}`);
  for (const n of ['uVP', 'uModel']) if (!declared(S.VS, 'uniform', n)) missing.push(`VS.${n}`);
  for (const n of ['aPos', 'aNrm', 'aUv', 'aTan']) if (!declared(S.VS, 'attribute', n)) missing.push(`VS.${n}`);
  assert.deepStrictEqual(missing, []);
});
test('shaders: the three programs are the three the packet names, and each fragment shader has a precision', () => {
  assert.deepStrictEqual(Object.keys(S.PROGRAMS), ['ksPerPixel', 'ksPerPixelNM', 'ksMultilayer']);
  for (const fs of Object.values(S.PROGRAMS)) assert.match(fs, /precision (highp|mediump) float;/);
});
test('shaders: the ported file carries the Ms-PL notice, and the licence text sits beside it', () => {
  const src = fs.readFileSync(path.join(ADIR, 'preview', 'acshaders.js'), 'utf8'), lic = fs.readFileSync(path.join(ADIR, 'preview', 'ACTOOLS-MS-PL.txt'), 'utf8');
  assert.ok(/Microsoft Public License \(Ms-PL\)/.test(src) && /github\.com\/gro-ove\/actools/.test(src) && /Microsoft Public License \(Ms-PL\)/.test(lic));
});

// ── the renderer's AC path, against a recording fake GL ──────────────────────────────────────────────────────────────
function recGL() {
  const log = { u: {}, tex: [], bound: {}, unit: 0, draws: 0 };
  let id = 0;
  const gl = new Proxy({
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, TEXTURE_2D: 3, TEXTURE0: 100, ARRAY_BUFFER: 5, ELEMENT_ARRAY_BUFFER: 6,
    getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({ id: ++id }), createProgram: () => ({ id: ++id }),
    createBuffer: () => ({ id: ++id }), createTexture: () => ({ tex: ++id }), getUniformLocation: (p, n) => n, getAttribLocation: () => 0,
    uniform1f: (n, v) => { log.u[n] = v; }, uniform3f: (n, a, b, c) => { log.u[n] = [a, b, c]; }, uniform1i: (n, v) => { log.u[n] = v; },
    activeTexture: (t) => { log.unit = t - 100; }, bindTexture: (t, x) => { log.bound[log.unit] = x; },
    texImage2D: (t, l, f, w, h) => { log.tex.push([w, h]); }, drawElements: () => { log.draws++; },
  }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  return { gl, log };
}
const tri = (extra = {}) => ({ key: 'k', positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
  uvs: new Float32Array([0, 0, 1, 0, 0, 1]), indices: new Uint16Array([0, 1, 2]), model: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], colour: [1, 1, 1], ...extra });
const pose = { eye: [3, 4, 5], target: [0, 0, 0], up: [0, 1, 0], fov: 1 };
test('renderer: an AC material\'s properties reach the shader as the mapped uniforms', () => {
  const { gl, log } = recGL(), r = createRenderer(gl);
  const m = mat('ksPerPixel', { ksAmbient: 0.31, ksDiffuse: 0.62, ksSpecular: 0.17, ksSpecularEXP: 33, ksEmissive: [0.1, 0.2, 0.3] });
  r.draw([tri()], pose, { width: 10, height: 10 }, { materialOf: () => m, lines: false });
  assert.deepStrictEqual([log.u.ksAmbient, log.u.ksDiffuse, log.u.ksSpecular, log.u.ksSpecularEXP, log.u.ksEmissive, log.u.uEye, r.stats().acDraws], [0.31, 0.62, 0.17, 33, [0.1, 0.2, 0.3], [3, 4, 5], 1]);
});
test('renderer: the multilayer scales and magicMult reach the shader', () => {
  const { gl, log } = recGL(), r = createRenderer(gl);
  r.draw([tri()], pose, { width: 10, height: 10 }, { materialOf: () => mat('ksMultilayer', { multR: 2, multG: 3, multB: 4, multA: 5, magicMult: 0.25 }), lines: false });
  assert.deepStrictEqual([log.u.multR, log.u.multG, log.u.multB, log.u.multA, log.u.magicMult], [2, 3, 4, 5, 0.25]);
});
test('renderer: a named texture is uploaded at its size and bound to its sampler; an absent one gets a 1×1 white texel', () => {
  const { gl, log } = recGL(), r = createRenderer(gl);
  const img = { width: 8, height: 4, rgba: new Uint8Array(8 * 4 * 4) };
  r.draw([tri()], pose, { width: 10, height: 10 }, { materialOf: () => mat('ksPerPixelNM', {}, [['txDiffuse', 'd.dds'], ['txNormal', 'missing.dds']]), textures: new Map([['d.dds', img]]), lines: false });
  assert.deepStrictEqual({ tex: log.tex, samplers: [log.u.txDiffuse, log.u.txNormal], textures: r.stats().textures }, { tex: [[8, 4], [1, 1]], samplers: [0, 1], textures: 1 });
});
test('renderer: a texture no longer drawn is deleted after the frame, like a buffer', () => {
  const { gl } = recGL(); let deleted = 0; gl.deleteTexture = () => { deleted++; };
  const r = createRenderer(gl), img = { width: 2, height: 2, rgba: new Uint8Array(16) }, textures = new Map([['d.dds', img]]);
  r.draw([tri()], pose, { width: 10, height: 10 }, { materialOf: () => mat('ksPerPixel', {}, [['txDiffuse', 'd.dds']]), textures, lines: false });
  r.draw([tri()], pose, { width: 10, height: 10 }, { materialOf: () => mat('ksPerPixel', {}), textures, lines: false });
  assert.deepStrictEqual([deleted, r.stats().textures], [1, 0]);
});
test('renderer: look "words" draws the per-word colours even when materials are given', () => {
  const { gl, log } = recGL(), r = createRenderer(gl);
  r.draw([tri()], pose, { width: 10, height: 10 }, { look: 'words', materialOf: () => mat('ksPerPixel', { ksAmbient: 9 }), lines: false });
  assert.deepStrictEqual([r.stats().acDraws, log.draws, log.u.ksAmbient], [0, 1, undefined]);
});
test('renderer: an unknown look is refused', () => {
  const { gl } = recGL(), r = createRenderer(gl);
  assert.throws(() => r.draw([tri()], pose, { width: 10, height: 10 }, { look: 'photoreal' }), /unknown look/);
});
test('renderer: a batch with no material is refused, not drawn in some default', () => {
  const { gl } = recGL(), r = createRenderer(gl);
  assert.throws(() => r.draw([tri()], pose, { width: 10, height: 10 }, { materialOf: () => null, lines: false }), /no material for k/);
});

// ── the list: the preview draws what the export writes ───────────────────────────────────────────────────────────────
/** The export_words sample (two straights, a 50 m tight, a straight, a tight, closed by the shortest candidate). */
function closedSample() {
  let d = D.createDoc('Look');
  for (const w of ['straight', 'straight', 'tight', 'straight', 'tight']) d = D.appendWord(d, w, { speed: 55 });
  d = D.editWord(d, 'w3', { handles: { length: 50 } });
  const c = closeLoop(d); assert.ok(c.candidates.length, c.reason);
  return c.candidates.slice().sort((a, b) => a.lengthM - b.lengthM)[0].doc;
}
/** What the app's shell resolves for it: a closed document resolves open when the close is not built (CLOSE_NOT_BUILT). */
const resolveAsApp = (d) => { try { return D.resolve(d); } catch (e) { if (e.code !== 'CLOSE_NOT_BUILT') throw e; return D.resolve({ ...d, closed: false }); } };
let LOOP = null;
const loop = () => {
  if (!LOOP) {
    const doc = closedSample(), b = buildExport(doc), f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't180b-aclook-')), 'track.kn5');
    fs.writeFileSync(f, b.kn5); const k = readKn5(f); fs.rmSync(path.dirname(f), { recursive: true, force: true });
    const t = createTrackModel().update(resolveAsApp(doc)), look = A.resolveLook(t.mesh.scene);
    LOOP = { doc, kn5: readLook(b.kn5), meshes: new Map(k.meshes.map((m) => [m.name, m.material])), t, look, list: A.lookList(t.batches.map((x) => ({ key: x.key, material: look.materialOf(x) }))) };
  }
  return LOOP;
};
const asKn5 = (m) => ({ name: m.name, shader: m.shader, alphaBlend: m.alphaBlend, alphaTested: !!m.alphaTested, depthMode: m.depthMode, props: m.props.map(propSlots), samplers: m.samplers });
const fromKn5 = (m) => ({ name: m.name, shader: m.shader, alphaBlend: m.alphaBlend, alphaTested: m.alphaTested, depthMode: m.depthMode, props: m.props, samplers: m.samplers });

test('list: every mesh the preview draws is in the kn5, under the same name, with the same material', () => {
  const L = loop();
  assert.deepStrictEqual(L.t.batches.filter((b) => L.meshes.get(b.key) !== L.list.byMesh[b.key]).map((b) => `${b.key}: ${L.list.byMesh[b.key]} vs ${L.meshes.get(b.key)}`), []);
});
test('list: each material the preview draws equals the kn5\'s, property for property at float32, sampler for sampler', () => {
  const L = loop(), inKn5 = new Map(L.kn5.materials.map((m) => [m.name, fromKn5(m)]));
  assert.deepStrictEqual(L.list.materials.map(asKn5), L.list.materials.map((m) => inKn5.get(m.name)));
});
test('list: the textures the preview draws equal the kn5\'s (none today: the export writes no texture yet)', () => {
  const L = loop();
  assert.deepStrictEqual([L.list.textures, L.look.textures.size], [L.kn5.textures.map((t) => t.name).sort(), 0]);
});
test('list: the preview\'s material and texture list EQUALS the kn5\'s', { todo: 'the preview does not draw the start and grid paint (t180b_paint, PAINT_* meshes) or the closing seam the export builds (D177 §3)' }, () => {
  const L = loop();
  assert.deepStrictEqual([L.list.materials.map((m) => m.name).sort(), [...L.meshes.keys()].sort()], [L.kn5.materials.map((m) => m.name).sort(), L.t.batches.map((b) => b.key).sort()]);
});

// ── the textured path: A's texture set, a made texture, read back through the kn5 the set writes ────────────────────
function texturedCase() {
  let d = D.createDoc('Textured');
  for (const w of ['straight', 'straight']) d = D.appendWord(d, w, { speed: 30 });
  d = D.editWord(d, 'w1', { textures: { floor: { make: TM.serialize(PRESETS.lanes), size: 64 } } });
  const set = T.buildTextureSet(d, {}), t = createTrackModel().update(D.resolve(d));
  const look = A.resolveLook(t.mesh.scene, set, T.previewTextures(set)), list = A.lookList(t.batches.map((x) => ({ key: x.key, material: look.materialOf(x) })));
  const kn5 = readLook(writeKn5(T.applyToScene(t.mesh.scene, set).scene));
  return { set, t, look, list, kn5 };
}
test('textured: a word whose floor names a made texture is drawn with the set\'s material; the others keep the scene\'s', () => {
  const { t, list } = texturedCase(), by = (id) => [...new Set(t.batches.filter((b) => b.segId === id && !b.seam).map((b) => list.byMesh[b.key]))];
  assert.deepStrictEqual([by('w1').length, /^t180b_floor_made-[0-9a-f]{16}-64$/.test(by('w1')[0]), by('w2')], [1, true, ['t180b_road']]);
});
test('textured: the textured material the preview draws equals the one the set writes into the kn5', () => {
  const { list, kn5 } = texturedCase(), m = list.materials.find((x) => x.name.startsWith('t180b_floor_'));
  assert.deepStrictEqual(asKn5(m), fromKn5(kn5.materials.find((x) => x.name === m.name)));
});
test('textured: the preview\'s texels are the kn5\'s DDS level 0, byte for byte', () => {
  const { list, look, kn5 } = texturedCase(), file = list.textures[0], inKn5 = kn5.textures.find((x) => x.name === file);
  const l0 = ddsLevel(new Uint8Array(inKn5.bytes), 0), mine = look.textures.get(file);
  assert.deepStrictEqual([list.textures.length, mine.width, mine.height, Buffer.from(mine.rgba).equals(Buffer.from(l0.rgba))], [1, l0.width, l0.height, true]);
});
test('textured: an untextured floor in a set still draws the scene\'s material, not the set\'s untextured one the export does not write', () => {
  let d = D.createDoc('Plain'); d = D.appendWord(d, 'straight', { speed: 30 });
  const set = T.buildTextureSet(d, {}), t = createTrackModel().update(D.resolve(d)), look = A.resolveLook(t.mesh.scene, set, T.previewTextures(set));
  assert.deepStrictEqual([...new Set(t.batches.map((b) => look.materialOf(b).name))], ['t180b_road']);
});

// ── the preview: the AC look is the default, and the texture set reaches the GPU ─────────────────────────────────────
const { createPreview } = require(path.join(ADIR, 'preview', 'preview.js'));
function previewOn(doc) {
  const { gl, log } = recGL(); let q = [];
  const win = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (f) => q.push(f), cancelAnimationFrame() {}, step() { const f = q; q = []; for (const g of f) g(16); } };
  const canvas = { clientWidth: 320, clientHeight: 200, width: 0, height: 0, getContext: () => gl, addEventListener() {}, removeEventListener() {} };
  const shell = { subscribe: () => () => {}, getState: () => ({ resolved: D.resolve(doc) }) };
  return { p: createPreview({ canvas, shell, win }), win, log };
}
test('preview: the AC look is the default: every placed batch is drawn with its exported material', () => {
  let d = D.createDoc('P'); d = D.appendWord(d, 'straight', { speed: 30 });
  const { p, win } = previewOn(d); win.step();
  const s = p.renderer.stats(), n = p.view().track.batches.length;
  p.dispose();
  assert.deepStrictEqual([p.view().look, s.acDraws], ['ac', n]);
});
test('preview: a texture set with a made floor texture is uploaded at its size and drawn', () => {
  let d = D.createDoc('P'); d = D.appendWord(d, 'straight', { speed: 30 });
  d = D.editWord(d, 'w1', { textures: { floor: { make: TM.serialize(PRESETS.lanes), size: 64 } } });
  const { p, win, log } = previewOn(d);
  const n = p.setTextureSet(T.buildTextureSet(d, {})); win.step(); p.dispose();
  assert.deepStrictEqual([n, log.tex.filter(([w, h]) => w === 64 && h === 64).length], [1, 1]);
});

test('preview: L toggles the look between the AC shaders and the colour per word (ARCHITECTURE §4 feedback layer), and the HUD says which', () => {
  const { keyAction } = require(path.join(ADIR, 'preview', 'preview.js'));
  let d = D.createDoc('P'); d = D.appendWord(d, 'straight', { speed: 30 });
  const keys = new Map(), { gl } = recGL(); let q = [];
  const win = { devicePixelRatio: 1, addEventListener: (t, f) => keys.set(t, f), removeEventListener() {}, requestAnimationFrame: (f) => q.push(f), cancelAnimationFrame() {}, step() { const f = q; q = []; for (const g of f) g(16); } };
  const canvas = { clientWidth: 320, clientHeight: 200, width: 0, height: 0, getContext: () => gl, addEventListener() {}, removeEventListener() {} };
  const hud = { textContent: '' }, shell = { subscribe: () => () => {}, getState: () => ({ resolved: D.resolve(d) }) };
  const p = createPreview({ canvas, shell, win, hud }), press = (key) => keys.get('keydown')({ key, preventDefault() {}, target: null });
  win.step(); const a = [p.view().look, p.renderer.stats().acDraws > 0, hud.textContent];
  press('l'); win.step(); const b = [p.view().look, p.renderer.stats().acDraws, hud.textContent];
  press('L'); win.step(); const c = p.view().look;
  p.dispose();
  assert.deepStrictEqual([keyAction('l'), keyAction('l', { ctrlKey: true }), a, b, c],
    [{ look: true }, null, ['ac', true, 'build view · AC look (L)'], ['words', 0, 'build view · word colours (L)'], 'ac']);
});

// D179, the usability pass: the ties fade with distance (they hatched the road dark from overhead), and the canvas is
// cleared darker than the fog colour (a tube's ceiling had merged into the background)
function lineGL() {
  const log = { fades: [], blend: [], clear: null }; let id = 0;
  const gl = new Proxy({ BLEND: 7, getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({ id: ++id }), createProgram: () => ({ id: ++id }),
    createBuffer: () => ({ id: ++id }), createTexture: () => ({}), getUniformLocation: (p, n) => n, getAttribLocation: () => 0,
    uniform2f: (n, a, b) => { if (n === 'uFade') log.fades.push([a, b]); }, enable: (c) => { if (c === 7) log.blend.push('on'); }, disable: (c) => { if (c === 7) log.blend.push('off'); },
    clearColor: (r, g, b) => { log.clear = [r, g, b]; } }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  return { gl, log };
}
const cell = () => { const b = tri({ key: '1ROAD_w1_0', seam: false, cols: 3 }); return b; };
test('renderer: the ties fade out between TIE_FADE\'s distances, with blending; the edges do not fade', () => {
  const { createRenderer: mk, TIE_FADE } = require(path.join(ADIR, 'preview', 'renderer.js')), LK = require(path.join(ADIR, 'preview', 'look.js'));
  const { gl, log } = lineGL(), r = mk(gl), b = { ...cell(), positions: new Float32Array([-1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 5, 0, 0, 5, 1, 0, 5]), normals: new Float32Array(18).map((_, i) => (i % 3 === 1 ? 1 : 0)), uvs: new Float32Array(12), indices: new Uint16Array([0, 3, 1, 1, 3, 4, 1, 4, 2, 2, 4, 5]), cols: 3, us: [-1, 0, 1], rowS: [0, 5] };
  const L = LK.linesFor(b);
  r.draw([b], pose, { width: 10, height: 10 }, { materialOf: () => mat('ksPerPixel', {}) });
  assert.deepStrictEqual([!!(L && L.ties && L.ties.length), log.fades.some(([a, c]) => a === TIE_FADE[0] && c === TIE_FADE[1]), log.fades.some(([a, c]) => a === 0 && c === 0), log.blend.includes('on') && log.blend[log.blend.length - 1] === 'off'], [true, true, true, true]);
});
test('renderer: the canvas is cleared to CLEAR, darker than the fog colour (the fog colour is the look and is unchanged)', () => {
  const { createRenderer: mk, CLEAR } = require(path.join(ADIR, 'preview', 'renderer.js')), { gl, log } = lineGL(), r = mk(gl);
  r.draw([tri()], pose, { width: 10, height: 10 }, { lines: false });
  assert.deepStrictEqual([log.clear, CLEAR.every((c, i) => c < [0.07, 0.08, 0.1][i])], [CLEAR.slice(), true]);
});
