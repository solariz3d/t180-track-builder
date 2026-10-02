// aclook.js: the AC look in the preview (ARCHITECTURE §5.2: "The preview uses AC's shader set … ported with Content
// Manager's Custom Showroom (actools, Ms-PL) as the reference"; §5.1: "Geometry and materials are exactly what is
// exported"). Pure numbers, no GL: each AC material becomes the uniforms its shader takes, and the same function is the
// one the tests check. The GLSL is app/preview/acshaders.js.
//
//   LIGHT                     the ONE reference light and time of day (stated, inferred; see below)
//   programFor(material)      'ksPerPixel' | 'ksPerPixelNM' | 'ksMultilayer', as actools picks a material class
//   uniformsFor(material)     { program, ambient, diffuse, specular, specularExp, emissive[3], alphaRef, alphaTested,
//                               textures: { txDiffuse, txNormal, txMask, txDetailR/G/B/A }, nmObjectSpace,
//                               detail: { multR, multG, multB, multA, magicMult } }
//   shade(u, tex, n, toLight, toEye)   the lit colour, in JS, line for line with the fragment shader (for the tests)
//   lookList(drawn)           the materials and textures the preview draws, as the kn5 names them
//   resolveLook(scene, set, images)   { materialOf(batch), textures }: what the renderer draws each batch with
//
// THE PROPERTY MAPPING is actools' (AcTools.Render/Kn5SpecificForwardDark/Materials/Kn5MaterialDark.cs): Ambient =
// ksAmbient (A), Diffuse = ksDiffuse (A), Specular = ksSpecular (A), SpecularExp = ksSpecularEXP (A), Emissive =
// ksEmissive (C, three floats); txDiffuse, and txNormal for the NM shaders (Kn5MaterialDarkNm.cs; nmObjectSpace). A
// property the material lacks reads 0, as actools' GetPropertyValue*ByName does.
// THE SHADER CHOICE follows actools' MaterialsProviderDark.cs: ksPerPixel, ksPerPixelAT, ksPerPixelAT_NS and ksTree are
// ksPerPixel; ksPerPixelNM and ksPerPixelNM_UV2 are NM; an unknown shader with a txNormal sampler is NM, otherwise
// ksPerPixel. ksMULTILAYER: actools has NO class for it (it falls to the default, i.e. ksPerPixel). Its layer blend here is
// INFERRED from the AC modding community's description (txMask's R/G/B/A weight txDetailR/G/B/A, each tiled by
// multR/G/B/A; magicMult scales how much of the detail shows, 0 black, 1 as is): NOT verified against AC (§5.3 parked).
//
// THE REFERENCE LIGHT (stated, INFERRED: not measured in AC; the look-match number §5.3 is parked, the keeper 12:17 "No in
// game testing needed"): one sun at 14:00 track time, elevation 42°, azimuth 225° (from +z towards +x), colour
// (1.00, 0.95, 0.86); a hemisphere ambient, ambientDown (0.30, 0.33, 0.38) + ambientRange (0.22, 0.24, 0.30) ×
// (n.y·0.5 + 0.5), after actools' gAmbientDown / gAmbientRange (Base.fx; the exact GetAmbient body was not found, so the
// blend by n.y is mine). The lighting itself is actools' CalculateLight (DarkMaterial.Lighting.Complex.fx):
//   colour = tx · (Ambient·ambientLight + Diffuse·max(n·l, 0)·sun + Emissive) + pow(max(n·h, 0), max(SpecularExp, 0.1))·Specular·sun
'use strict';

const DEG = Math.PI / 180;
const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return v.map((x) => x / l); };
const sunDir = (elev, azim) => unit([Math.cos(elev) * Math.sin(azim), Math.sin(elev), Math.cos(elev) * Math.cos(azim)]);
const LIGHT = Object.freeze({
  time: '14:00', elevationDeg: 42, azimuthDeg: 225, toSun: sunDir(42 * DEG, 225 * DEG),
  sun: [1.0, 0.95, 0.86], ambientDown: [0.30, 0.33, 0.38], ambientRange: [0.22, 0.24, 0.30],
});

const PER_PIXEL = new Set(['ksPerPixel', 'ksPerPixelAT', 'ksPerPixelAT_NS', 'ksTree']);
const NM = new Set(['ksPerPixelNM', 'ksPerPixelNM_UV2']);
function programFor(m) {
  if (!m || typeof m.shader !== 'string') throw new Error('aclook: a material needs a shader');
  if (m.shader === 'ksMultilayer') return 'ksMultilayer';
  if (NM.has(m.shader)) return 'ksPerPixelNM';
  if (PER_PIXEL.has(m.shader)) return 'ksPerPixel';
  return (m.samplers || []).some((s) => s.name === 'txNormal') ? 'ksPerPixelNM' : 'ksPerPixel';
}
const propA = (m, name) => { const p = (m.props || []).find((x) => x.name === name); return p ? p.value[0] : 0; };
const propC = (m, name) => { const p = (m.props || []).find((x) => x.name === name); return p ? [0, 1, 2].map((k) => (p.value[k] === undefined ? 0 : p.value[k])) : [0, 0, 0]; };
const tex = (m, name) => { const s = (m.samplers || []).find((x) => x.name === name); return s ? s.texture : null; };

function uniformsFor(m) {
  const program = programFor(m);
  const u = {
    program, ambient: propA(m, 'ksAmbient'), diffuse: propA(m, 'ksDiffuse'), specular: propA(m, 'ksSpecular'),
    specularExp: propA(m, 'ksSpecularEXP'), emissive: propC(m, 'ksEmissive'), alphaRef: propA(m, 'ksAlphaRef'), alphaTested: !!m.alphaTested,
    textures: { txDiffuse: tex(m, 'txDiffuse') }, nmObjectSpace: false, detail: null,
  };
  if (program === 'ksPerPixelNM') { u.textures.txNormal = tex(m, 'txNormal'); u.nmObjectSpace = propA(m, 'nmObjectSpace') !== 0; }
  if (program === 'ksMultilayer') {
    for (const c of ['R', 'G', 'B', 'A']) u.textures[`txDetail${c}`] = tex(m, `txDetail${c}`);
    u.textures.txMask = tex(m, 'txMask');
    u.detail = { multR: propA(m, 'multR'), multG: propA(m, 'multG'), multB: propA(m, 'multB'), multA: propA(m, 'multA'), magicMult: propA(m, 'magicMult') };
  }
  return u;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** The lit colour, line for line with acshaders.js's fragment shader (ksPerPixel's lighting; tex already unpacked). */
function shade(u, texRgb, n, toLight = LIGHT.toSun, toEye = [0, 1, 0]) {
  const N = unit(n), L = unit(toLight), V = unit(toEye), H = unit([L[0] + V[0], L[1] + V[1], L[2] + V[2]]);
  const hemi = N[1] * 0.5 + 0.5, nl = Math.max(dot(N, L), 0), nh = Math.max(dot(N, H), 0);
  const spec = Math.pow(nh, Math.max(u.specularExp, 0.1)) * u.specular;
  return [0, 1, 2].map((c) => {
    const amb = LIGHT.ambientDown[c] + LIGHT.ambientRange[c] * hemi;
    return texRgb[c] * (u.ambient * amb + u.diffuse * nl * LIGHT.sun[c] + u.emissive[c]) + spec * LIGHT.sun[c];
  });
}

/**
 * The materials and textures the preview draws, as the kn5 names them: for each drawn batch, its material (the scene's
 * material at the mesh's index, or the texture set's slot material that replaces it) and the textures its samplers name.
 * `drawn` is [{ key, material }]. Returns { byMesh: { key: materialName }, materials: [material] (unique, first seen
 * order), textures: [name] (unique, sorted) }.
 */
const { ensureDiffuse } = require('../../src/export/acready.js');
const { ddsLevel } = require('../../src/texture/dds.js');
function lookList(drawn) {
  const byMesh = {}, mats = new Map();
  for (const d of drawn) { byMesh[d.key] = d.material.name; if (!mats.has(d.material.name)) mats.set(d.material.name, d.material); }
  const textures = new Set();
  for (const m of mats.values()) for (const s of m.samplers || []) textures.add(s.texture);
  return { byMesh, materials: [...mats.values()], textures: [...textures].sort() };
}

/**
 * What each batch is drawn with: `scene` is the track mesh's scene (src/geom, the materials the export writes today);
 * `set` is A's texture set (src/texture/set.js) or null, and `images` its previewTextures() (level 0 read back from the
 * DDS bytes the export writes). With a set, a batch whose segment's floor slot names a texture (an image or a made one)
 * wears that slot's material (the set's own material object, the one applyToScene appends); otherwise it wears the
 * scene's material at its index, so an untextured track shows exactly the kn5's t180b_road and not the set's untextured
 * t180b_floor, which the export does not write. NOTE (D177): src/export/fromwords.js does not apply the set yet, so for
 * a TEXTURED floor the preview is ahead of the kn5 until it does (routed to A). Returns { materialOf(batch), textures: Map(file -> { width, height, rgba }) }.
 */
function resolveLook(scene0, set = null, images0 = []) {
  if (!scene0 || !Array.isArray(scene0.materials)) throw new Error('aclook: resolveLook needs a scene with materials');
  // the export gives every material without a diffuse a solid one (src/export/acready.js, AC draws ksPerPixel black
  // without it); the preview draws the same materials and textures, read back from the same DDS bytes
  const ready = ensureDiffuse({ textures: [], materials: scene0.materials }), scene = { ...scene0, materials: ready.materials };
  const images = [...images0, ...ready.textures.map((t) => ({ file: t.name, ...ddsLevel(t.data, 0) }))];
  const byName = new Map(set ? set.materials.map((x) => [x.material.name, x.material]) : []);
  const materialOf = (b) => {
    const slots = set && b.segId != null ? set.bySegment(b.segId) : null;
    if (slots && slots.floor && (slots.floor.settings.texture || slots.floor.settings.make)) {
      const m = byName.get(slots.floor.material);
      if (!m) throw new Error(`aclook: the set names material ${slots.floor.material} for ${b.segId} but does not carry it`);
      return m;
    }
    const m = scene.materials[b.materialIndex];
    if (!m) throw new Error(`aclook: ${b.key} has material ${b.materialIndex}, not one of the scene's ${scene.materials.length}`);
    return m;
  };
  return { materialOf, textures: new Map(images.map((t) => [t.file, { width: t.width, height: t.height, rgba: t.rgba }])) };
}

module.exports = { LIGHT, programFor, uniformsFor, shade, lookList, resolveLook };
