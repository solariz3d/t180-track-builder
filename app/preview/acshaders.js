// acshaders.js: the preview's AC shaders, in GLSL ES 1.00 (WebGL 1 and 2): ksPerPixel, ksPerPixelNM and ksMultilayer.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LICENCE OF THIS FILE: Microsoft Public License (Ms-PL). The complete text is app/preview/ACTOOLS-MS-PL.txt, copied
// verbatim from actools. This file is distributed under that licence because it PORTS, from HLSL to GLSL, parts of:
//     actools (Content Manager / Custom Showroom), https://github.com/gro-ove/actools, Ms-PL,
//     AcTools.Render/Shaders/Includes/DarkMaterial.Lighting.Complex.fx   CalculateLight, CalculateSpecularLight, GetNDotH
//     AcTools.Render/Shaders/Includes/DarkMaterial.Base.fx               NormalSampleToWorldSpace (tangent-space normals)
//     AcTools.Render/Shaders/Includes/DarkMaterial.Unpack.fx             Unpack (txDiffuse), Unpack_Nm (txNormal)
// What is ported: the lighting sum colour = tx·(Ambient·ambient + Diffuse·diffuse + Emissive) + specular, the specular
// pow(saturate(n·h), max(exp, 0.1))·level, and the normal-map unpacking (2x−1, 1−2y, 2z−1) into the tangent frame.
// What is NOT from actools, and so not under its copyright: the ksMultilayer layer blend (actools has no ksMultilayer
// class; this blend is inferred from community documentation, see app/preview/aclook.js), the hemisphere ambient's blend
// by n.y, the fog, and the GLSL scaffolding.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//
// The uniforms are what app/preview/aclook.js uniformsFor() returns, under the same names (u + the AC name). Missing
// textures are bound to a 1×1 white texel by the renderer, so an untextured ksPerPixel material (the road today) shows its
// lighting on white, as its properties say.
'use strict';

const VS = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUv; attribute vec3 aTan;
uniform mat4 uVP; uniform mat4 uModel;
varying vec3 vPosW; varying vec3 vN; varying vec3 vT; varying vec2 vUv; varying float vDepth;
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  vPosW = w.xyz;
  vN = mat3(uModel) * aNrm;
  vT = mat3(uModel) * aTan;
  vUv = aUv;
  gl_Position = uVP * w;
  vDepth = gl_Position.w;
}`;

/* the lighting, ported from actools CalculateLight / CalculateSpecularLight / GetNDotH (Ms-PL, see the header) */
const LIGHTING = `
uniform float ksAmbient; uniform float ksDiffuse; uniform float ksSpecular; uniform float ksSpecularEXP;
uniform vec3 ksEmissive; uniform float ksAlphaRef; uniform float uAlphaTested;
uniform vec3 uToSun; uniform vec3 uSun; uniform vec3 uAmbientDown; uniform vec3 uAmbientRange; uniform vec3 uEye;
uniform vec3 uFog; uniform float uFogDensity;
varying vec3 vPosW; varying vec3 vN; varying vec3 vT; varying vec2 vUv; varying float vDepth;
vec3 calculateLight(vec3 txColor, vec3 normal) {
  vec3 ambient = uAmbientDown + uAmbientRange * (normal.y * 0.5 + 0.5);
  vec3 diffuse = max(dot(normal, uToSun), 0.0) * uSun;
  vec3 toEye = normalize(uEye - vPosW);
  float nDotH = clamp(dot(normalize(toEye + uToSun), normal), 0.0, 1.0);
  vec3 specular = pow(nDotH, max(ksSpecularEXP, 0.1)) * ksSpecular * uSun;
  return txColor * (ksAmbient * ambient + ksDiffuse * diffuse + ksEmissive) + specular;
}
vec4 finish(vec3 c) { float fog = clamp(exp(-uFogDensity * vDepth), 0.0, 1.0); return vec4(mix(uFog, c, fog), 1.0); }
void alphaTest(float a) { if (uAlphaTested > 0.5 && a < ksAlphaRef) discard; }`;

const FS_PERPIXEL = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D txDiffuse;
${LIGHTING}
void main(){
  vec4 t = texture2D(txDiffuse, vUv);
  alphaTest(t.a);
  gl_FragColor = finish(calculateLight(t.rgb, normalize(vN)));
}`;

/* Unpack_Nm and NormalSampleToWorldSpace, ported (Ms-PL): the alpha comes from the normal map, as in Unpack_Nm */
const FS_NM = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D txDiffuse; uniform sampler2D txNormal; uniform float nmObjectSpace;
${LIGHTING}
vec3 normalSampleToWorldSpace(vec3 s, vec3 n, vec3 t) {
  vec3 m = vec3(2.0 * s.x - 1.0, 1.0 - 2.0 * s.y, 2.0 * s.z - 1.0);
  if (nmObjectSpace > 0.5) return normalize(vec3(m.x, m.z, m.y));
  vec3 tt = normalize(t - dot(t, n) * n), b = cross(n, tt);
  return normalize(m.x * tt + m.y * b + m.z * n);
}
void main(){
  vec4 d = texture2D(txDiffuse, vUv), s = texture2D(txNormal, vUv);
  alphaTest(s.a);
  gl_FragColor = finish(calculateLight(d.rgb, normalSampleToWorldSpace(s.xyz, normalize(vN), vT)));
}`;

/* ksMultilayer: the layer blend is INFERRED (not from actools, not verified against AC; see aclook.js) */
const FS_MULTILAYER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D txDiffuse; uniform sampler2D txMask;
uniform sampler2D txDetailR; uniform sampler2D txDetailG; uniform sampler2D txDetailB; uniform sampler2D txDetailA;
uniform float multR; uniform float multG; uniform float multB; uniform float multA; uniform float magicMult;
${LIGHTING}
void main(){
  vec4 base = texture2D(txDiffuse, vUv), mask = texture2D(txMask, vUv);
  vec3 detail = mask.r * texture2D(txDetailR, vUv * multR).rgb + mask.g * texture2D(txDetailG, vUv * multG).rgb
              + mask.b * texture2D(txDetailB, vUv * multB).rgb + mask.a * texture2D(txDetailA, vUv * multA).rgb;
  float w = mask.r + mask.g + mask.b + mask.a;
  vec3 layered = w > 0.001 ? detail / w : vec3(1.0);
  gl_FragColor = finish(calculateLight(base.rgb * layered * magicMult, normalize(vN)));
}`;

const PROGRAMS = Object.freeze({ ksPerPixel: FS_PERPIXEL, ksPerPixelNM: FS_NM, ksMultilayer: FS_MULTILAYER });
/** The sampler names each program binds, in texture-unit order. */
const SAMPLERS = Object.freeze({
  ksPerPixel: ['txDiffuse'], ksPerPixelNM: ['txDiffuse', 'txNormal'],
  ksMultilayer: ['txDiffuse', 'txMask', 'txDetailR', 'txDetailG', 'txDetailB', 'txDetailA'],
});

module.exports = { VS, PROGRAMS, SAMPLERS, FS_PERPIXEL, FS_NM, FS_MULTILAYER };
