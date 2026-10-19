// renderer.js: draws the track batches (app/preview/batches.js) with WebGL. Started from blackbox's renderer
// (ui/glcore.js): a shader that fails to compile says so loudly instead of leaving a silent black canvas, and the camera
// math is column-major (app/camera/math.js). The track only: no environment. The ground grid at y = 0 and the
// head marker are editor UI (the D170 review, item 7), not scenery. A skin may name a SKY (D384, below), drawn at infinity behind the track.
// THE AC LOOK (D177) started from the same blackbox files: ui/glcore.js's per-material uniforms (ksSpecular /
// ksSpecularEXP / ksEmissive / ksAlphaRef from the kn5, a hemisphere ambient, the eye for the half vector) and ui/kn5.js's
// reading of the property block (ten floats, A B C D); the lighting itself is actools' (app/preview/acshaders.js).
//
//   const r = createRenderer(gl)            gl: a WebGL1 or WebGL2 context
//   r.draw(batches, pose, { width, height }, extras)      pose from app/camera/cameras.js ({ eye, target, up, fov, far? })
//       extras = { grid, marker, ghost, lines = true, overlay }   grid / marker from look.js (world lines); ghost = batches drawn
//                                                         see-through, with their own lines, after the placed track;
//                                                         overlay = [{ positions (world line pairs), colour, alpha? }] drawn last,
//                                                         over everything (D237: the mirror ghost)
//       extras.look = 'ac' (the default) with extras.materialOf(batch) -> the EXPORTED material ({ name, shader, props,
//                   samplers, alphaTested }) and extras.textures (a Map, texture file -> { width, height, rgba }): each
//                   batch is drawn with its AC shader (acshaders.js, the Ms-PL port) and the uniforms aclook.js
//                   uniformsFor gives, under aclook.js's ONE reference light. look 'words', or no materialOf, draws the
//                   D170 per-word colours instead. A sampler whose texture is not in extras.textures gets one white texel.
//   r.setTheme({ sky, fog, edge, tie, grid, skyStyle, skyA, skyB, skyC })   a skin's 3D colours and its sky (themeFrom(tokens) reads them)
//   extras.time = seconds, for the sky's drift (the preview hands 0 under prefers-reduced-motion)
//   r.stats()  -> { uploads, buffers, draws, lines, acDraws, textures, chunks }      uploads = bufferData + texImage2D calls;
//                 chunks = the placed track's merged chunks drawn last frame (CHUNKS below)
//   createRenderer(gl, { chunkVertices })   the most vertices in one chunk (default and maximum 65,535: Uint16 indices)
//   r.dispose()
//
// LIGHT (D170 item 1): the lighting is look.js `shade`, compiled into the fragment shader from the same constants, so a
// floor, a bank and a wall of one colour read as different surfaces. The ROAD LINES (edges, centre, ties across) come
// from look.js `linesFor`, in each cell's own frame, drawn with its model matrix.
//
// GPU BUFFERS ARE KEYED BY THE ARRAY OBJECT (since 2026-10-13 the arrays are the merged CHUNKS' arrays, below). The geometry hands the same Float32Array back for a piece it did not
// rebuild (extendMesh keeps old pieces, sculptMesh keeps pieces that only moved), and linesFor memoises by that array,
// so those cost no upload; only arrays new in this frame are uploaded, and arrays no longer drawn are deleted after the
// frame. Since the CHUNKS (below) a drag that sculpts one word re-merges and uploads the chunks holding its cells and every
// chunk it MOVED (a chunk is baked to world space, so a piece that only moved is new geometry to the GPU); chunks before
// the edit, and every chunk after an extend but the last, upload nothing.
'use strict';

const M = require('../camera/math.js');
const { LIGHT, linesFor, tangentsFor } = require('./look.js');
const AC = require('./acshaders.js');
const ACLOOK = require('./aclook.js');
const SKY = require('./sky/index.js');

const v3 = (v) => `vec3(${v.map((x) => x.toFixed(6)).join(', ')})`;
const VS = `
attribute vec3 aPos; attribute vec3 aNrm;
uniform mat4 uVP; uniform mat4 uModel;
varying vec3 vN; varying float vDepth;
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  vN = mat3(uModel) * aNrm;
  gl_Position = uVP * w;
  vDepth = gl_Position.w;
}`;
/* look.js shade(), line for line: two-sided (flip a normal that faces away from both lights), then ambient + key + fill */
const FS = `
precision mediump float;
varying vec3 vN; varying float vDepth;
uniform vec3 uColour; uniform float uAlpha; uniform vec3 uFog; uniform float uFogDensity;
void main(){
  vec3 n = normalize(vN);
  vec3 key = ${v3(LIGHT.key)}; vec3 fill = ${v3(LIGHT.fill)};
  if (dot(n, key) < 0.0 && dot(n, fill) < 0.0) n = -n;
  float lit = ${LIGHT.ambient.toFixed(6)} + ${LIGHT.keyK.toFixed(6)} * max(dot(n, key), 0.0) + ${LIGHT.fillK.toFixed(6)} * max(dot(n, fill), 0.0);
  float fog = clamp(exp(-uFogDensity * vDepth), 0.0, 1.0);
  gl_FragColor = vec4(mix(uFog, uColour * lit, fog), uAlpha);
}`;
const LVS = `
attribute vec3 aPos;
uniform mat4 uVP; uniform mat4 uModel;
varying float vDepth;
void main(){ gl_Position = uVP * uModel * vec4(aPos, 1.0); vDepth = gl_Position.w; }`;
const LFS = `
precision mediump float;
varying float vDepth;
uniform vec3 uColour; uniform float uAlpha; uniform vec3 uFog; uniform float uFogDensity; uniform vec2 uFade;
/* uFade = (near, far): the line fades out between them (D179: ties at a distance); far <= near: no fade */
void main(){ float fog = clamp(exp(-uFogDensity * vDepth), 0.0, 1.0); float f = uFade.y > uFade.x ? clamp((uFade.y - vDepth) / (uFade.y - uFade.x), 0.0, 1.0) : 1.0; gl_FragColor = vec4(mix(uFog, uColour, fog), uAlpha * f); }`;

// THE SKY (D384; the keeper, 2026-10-18: the skin's sky should stay put in the world as you move around, not follow the camera). A full-screen pass
// drawn after the clear and before everything else, without depth: each pixel's ray is the camera's ROTATION only (skyBasis, from the inverse of the
// view-projection with the eye at the origin), so turning moves the sky across the screen and moving or zooming does not. The pattern is the skin's style
// (app/preview/sky/<style>.js: vec3 skyPattern(vec3 dir, float t)); 'none' draws no pass, which is today's frame call for call.
// D398: the pass breaks its own 8-bit banding. A long, slow gradient written to 8 bits per channel shows as steps (down a column of open sky, one colour
// ran up to 174 px); the pass adds a 4x4 ordered (Bayer) offset on the pixel, half a step either way of one 8-bit step, so the steps break into a
// screen too fine to see. It is a fix, not a look: the quiet band near the horizon moves by at most 0.009 of its ratio to the fog
// (app/test/sky-dither.test.js). The pattern is the pass's own (pass_bayer2/4), so every style gets it and none carries a copy.
const SKY_VS = `
attribute vec2 aPos;
uniform vec3 uFwd; uniform vec3 uRight; uniform vec3 uUp;
varying vec3 vRay;
void main(){ vRay = uFwd + aPos.x * uRight + aPos.y * uUp; gl_Position = vec4(aPos, 0.0, 1.0); }`;
const skyFS = (pattern) => `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vRay;
uniform vec3 uSky; uniform vec3 uSkyA; uniform vec3 uSkyB; uniform vec3 uSkyC; uniform float uTime;
${pattern}
float pass_bayer2(vec2 a){ a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float pass_bayer4(vec2 a){ return pass_bayer2(0.5 * a) * 0.25 + pass_bayer2(a); }
void main(){ vec3 c = clamp(skyPattern(normalize(vRay), uTime), 0.0, 1.0); gl_FragColor = vec4(clamp(c + (pass_bayer4(gl_FragCoord.xy) - 0.5) / 255.0, 0.0, 1.0), 1.0); }`;
const SKY_STRIP = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
/** The inverse of a column-major 4×4 (cofactors); a singular matrix throws. */
function invert4(m) {
  const o = new Array(16);
  o[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  o[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  o[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  o[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  o[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  o[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  o[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  o[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  o[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  o[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  o[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  o[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  o[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  o[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  o[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  o[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const det = m[0] * o[0] + m[1] * o[4] + m[2] * o[8] + m[3] * o[12];
  if (!det) throw new Error('renderer: the view-projection has no inverse');
  return o.map((v) => v / det);
}
/** The sky's rays for a pose: { fwd, right, up }, so the ray at ndc (x, y) is fwd + x·right + y·up (fwd unit length). The eye is put at the origin
 *  first, so only the camera's rotation (and its fov and aspect) counts; each ray is the far-plane point the inverse view-projection gives. */
function skyBasis(pose, aspect) {
  const inv = invert4(M.viewProj({ ...pose, eye: [0, 0, 0], target: pose.target.map((v, i) => v - pose.eye[i]) }, aspect));
  const ray = (x, y) => { const p = M.apply(inv, [x, y, 1]); return [p[0] / p[3], p[1] / p[3], p[2] / p[3]]; };
  const c = ray(0, 0), r = ray(1, 0), u = ray(0, 1), s = 1 / Math.hypot(c[0], c[1], c[2]);
  return { fwd: c.map((v) => v * s), right: r.map((v, i) => (v - c[i]) * s), up: u.map((v, i) => (v - c[i]) * s) };
}

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

// CHUNKS (the keeper, 2026-10-13: "the preview is so damn laggy" on ELYSIUM, 24 km). A batch is one ~2 m cell, so a long
// track was 12,069 surface draws and 24,233 line draws a frame: 11 fps on an RTX 5080, ~87 ms of JS per frame issuing
// them (scratchpad perf/drive.js). Consecutive batches drawn alike (one material, or one colour) are now MERGED into a
// chunk of at most CHUNK_V vertices, baked to world space with each batch's own model matrix (the same arithmetic the
// shaders did with uModel), and the chunk is drawn once with the identity. ELYSIUM: 42 chunks, merged in ~80 ms.
// A chunk is kept while its batches are the same arrays under the same matrices, so an extend re-merges only the chunk at
// the end, and a sculpt the chunks it touched or moved; a chunk no longer drawn is dropped with its buffers (gen sweep).
const CHUNK_V = 65535;   // Uint16 indices
const colourKey = (b) => (b.colour ? b.colour.join(',') : '');   // the 'words' look: one colour per chunk
const sameModel = (a, b) => { for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false; return true; };
function bakePoints(dst, at, src, M, w) {   // world = local · M (row-vector; column-major GL reading), w = 1 points, 0 directions
  for (let k = 0; k < src.length; k += 3) {
    const x = src[k], y = src[k + 1], z = src[k + 2], o = at + k;
    dst[o] = x * M[0] + y * M[4] + z * M[8] + w * M[12]; dst[o + 1] = x * M[1] + y * M[5] + z * M[9] + w * M[13]; dst[o + 2] = x * M[2] + y * M[6] + z * M[10] + w * M[14];
  }
}
/** Consecutive batches with one `keyOf` value, at most CHUNK_V vertices each (a batch larger than that is a chunk alone). */
function groupBatches(batches, keyOf, maxV = CHUNK_V) {
  const out = []; let cur = null;
  for (const b of batches) {
    const k = keyOf(b), nv = b.positions.length / 3;
    if (!cur || cur.key !== k || cur.nv + nv > maxV) { cur = { key: k, list: [], nv: 0 }; out.push(cur); }
    cur.list.push(b); cur.nv += nv;
  }
  return out;
}
/** A chunk's merged arrays: positions, normals, uvs (when every batch has them), indices; tangents and lines on first use. */
function mergeChunk(g) {
  let ni = 0; for (const b of g.list) ni += b.indices.length;
  const P = new Float32Array(g.nv * 3), N = new Float32Array(g.nv * 3), I = new Uint16Array(ni), withUv = g.list.every((b) => b.uvs);
  const U = withUv ? new Float32Array(g.nv * 2) : null;
  let v = 0, i = 0;
  for (const b of g.list) {
    bakePoints(P, v * 3, b.positions, b.model, 1); bakePoints(N, v * 3, b.normals, b.model, 0);
    if (U) U.set(b.uvs, v * 2);
    const ix = b.indices; for (let k = 0; k < ix.length; k++) I[i + k] = ix[k] + v;
    i += ix.length; v += b.positions.length / 3;
  }
  return { positions: P, normals: N, uvs: U, indices: I, model: IDENTITY, key: g.list[0].key, list: g.list, members: g.list.map((b) => ({ p: b.positions, n: b.normals, u: b.uvs, i: b.indices, m: Array.from(b.model) })) };
}
function chunkTangents(c) {
  if (!c.tangents) { c.tangents = new Float32Array(c.positions.length); let at = 0; for (const b of c.list) { bakePoints(c.tangents, at, tangentsFor(b), b.model, 0); at += b.positions.length; } }
  return c.tangents;
}
function chunkLines(c) {
  if (c.lines === undefined) {
    const parts = c.list.map((b) => [b, linesFor(b)]).filter(([, L]) => L);
    if (!parts.length) c.lines = null;
    else {
      const join = (k) => { const out = new Float32Array(parts.reduce((a, [, L]) => a + L[k].length, 0)); let at = 0; for (const [b, L] of parts) { bakePoints(out, at, L[k], b.model, 1); at += L[k].length; } return out; };
      c.lines = { edges: join('edges'), ties: join('ties') };
    }
  }
  return c.lines;
}
const COLOURS = Object.freeze({ edge: [0.93, 0.93, 0.88], tie: [0.06, 0.07, 0.09], grid: [0.2, 0.23, 0.28], marker: [1.0, 0.62, 0.15], ghost: [0.73, 0.66, 1.0] });   // 2026-10-14, Sigil: the accent violet (#b9a8ff); was sky blue, which tinted the whole view
const GHOST_ALPHA = 0.42;
// D179, the usability pass (p-d179-lookpass-C §1): the ties are one near-black line per station; from overhead or far
// away they outnumber the pixels and hatch the lit road dark (measured: 42–51% of the overhead's drawn pixels near-black),
// so they fade out between 60 and 250 m (the edges stay). And the canvas is cleared darker than the FOG colour: surfaces
// facing away from the sun (a tube's ceiling, L* about 14) were only ΔE00 about 6 from a background that was the fog colour.
// The fog colour itself is part of the look and is unchanged (src/lookmatch/raster.js uses the same).
const TIE_FADE = Object.freeze([60, 250]);
const CLEAR = Object.freeze([0.024, 0.023, 0.021]);   // 2026-10-14, Sigil: a warm near-black (was a blue-black, 0.03 0.035 0.045); still darker than the fog

const FOG = Object.freeze([0.07, 0.08, 0.1]);
// D381: a skin's 3D colours, read from the page's tokens (app/lib/tokens.js); each falls back to the literal here, which is SIGIL's token value too
// D384: and its sky, --sky-style (none when the page has none) with --sky-a, --sky-b and --sky-c, each falling back to the skin's --sky
const themeFrom = (T) => { const sky = T.floats('--sky', CLEAR); return { sky, fog: T.floats('--fog', FOG), edge: T.floats('--road-edge', COLOURS.edge), tie: T.floats('--road-tie', COLOURS.tie), grid: T.floats('--ground-grid', COLOURS.grid),
  skyStyle: T.word('--sky-style', 'none'), skyA: T.floats('--sky-a', sky), skyB: T.floats('--sky-b', sky), skyC: T.floats('--sky-c', sky) }; };

function createRenderer(gl, { fog = FOG, fogDensity = 0.0012, clear = CLEAR, chunkVertices = CHUNK_V } = {}) {
  if (!gl) throw new Error('renderer: no WebGL context');
  let edge = COLOURS.edge, tie = COLOURS.tie, gridColour = COLOURS.grid;   // D381: setTheme replaces these, the clear colour and the fog
  let skyStyle = 'none', skyProg = null, skyBuf = null, skyA = null, skyB = null, skyC = null;   // D384: the sky; a colour left null is the clear colour
  if (!(Number.isInteger(chunkVertices) && chunkVertices > 0 && chunkVertices <= CHUNK_V)) throw new Error(`renderer: chunkVertices must be a whole number from 1 to ${CHUNK_V}`);
  const shader = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('renderer: shader compile failed:\n' + (gl.getShaderInfoLog(s) || '(no log)'));
    return s;
  };
  const program = (vs, fs) => {
    const p = gl.createProgram(); gl.attachShader(p, shader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('renderer: program link failed:\n' + (gl.getProgramInfoLog(p) || '(no log)'));
    const u = (n) => gl.getUniformLocation(p, n);
    return { p, pos: gl.getAttribLocation(p, 'aPos'), nrm: gl.getAttribLocation(p, 'aNrm'), vp: u('uVP'), model: u('uModel'), colour: u('uColour'), alpha: u('uAlpha'), fog: u('uFog'), fogD: u('uFogDensity') };
  };
  // the merged chunks, keyed by their first batch's positions array; a chunk is reused only when its group key, its batches'
  // arrays and their model matrices are all unchanged
  // and the chunks of the very same batches ARRAY drawn the same way (`how`) are the last frame's: the track model and the preview hand a new
  // array for any change, so a still frame does not re-group 12,069 cells and compare their matrices (~1.3 ms a frame on ELYSIUM)
  const chunkMemo = new WeakMap(), lastChunks = new WeakMap();
  function chunksOf(batches, keyOf, how) {
    const last = lastChunks.get(batches);
    if (last && last.how === how) return last.out;
    const out = chunksFresh(batches, keyOf);
    lastChunks.set(batches, { how, out });
    return out;
  }
  function chunksFresh(batches, keyOf) {
    return groupBatches(batches, keyOf, chunkVertices).map((g) => {
      const hit = chunkMemo.get(g.list[0].positions);
      if (hit && hit.group === g.key && hit.members.length === g.list.length && g.list.every((b, k) => {
        const m = hit.members[k]; return m.p === b.positions && m.n === b.normals && m.u === b.uvs && m.i === b.indices && sameModel(m.m, b.model);
      })) { hit.list = g.list; return hit; }
      const c = mergeChunk(g); c.group = g.key; c.colour = g.list[0].colour; chunkMemo.set(g.list[0].positions, c); return c;
    });
  }
  const surf = program(VS, FS), line = program(LVS, LFS);
  line.fade = gl.getUniformLocation(line.p, 'uFade');
  const buffers = new Map();   // typed array → { buf, gen }
  let gen = 0, uploads = 0, draws = 0, lines = 0, chunkCount = 0;
  function bufferFor(arr, target) {
    let e = buffers.get(arr);
    if (!e) { const buf = gl.createBuffer(); gl.bindBuffer(target, buf); gl.bufferData(target, arr, gl.STATIC_DRAW); uploads++; e = { buf, gen }; buffers.set(arr, e); }
    else gl.bindBuffer(target, e.buf);
    e.gen = gen; return e.buf;
  }
  // the AC programs, one per shader family, compiled at creation so a GLSL error is loud at once
  const acProgram = (name) => {
    const pr = program(AC.VS, AC.PROGRAMS[name]), u = (n) => gl.getUniformLocation(pr.p, n);
    Object.assign(pr, { uv: gl.getAttribLocation(pr.p, 'aUv'), tan: gl.getAttribLocation(pr.p, 'aTan'), samplers: AC.SAMPLERS[name].map(u) });
    for (const k of ['ksAmbient', 'ksDiffuse', 'ksSpecular', 'ksSpecularEXP', 'ksEmissive', 'ksAlphaRef', 'uAlphaTested', 'uToSun', 'uSun',
      'uAmbientDown', 'uAmbientRange', 'uEye', 'nmObjectSpace', 'multR', 'multG', 'multB', 'multA', 'magicMult']) pr[k] = u(k);
    return pr;
  };
  const ac = {}; for (const k of Object.keys(AC.PROGRAMS)) ac[k] = acProgram(k);
  // textures, keyed by their pixel array like the buffers and swept the same way; no texture → one white texel
  const texes = new Map(); let white = null, acDraws = 0;
  const pot = (x) => x > 0 && (x & (x - 1)) === 0;
  function textureFor(img) {
    if (!img) {
      if (!white) {
        white = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, white);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      }
      return white;
    }
    let e = texes.get(img.rgba);
    if (!e) {
      const t = gl.createTexture(), p = pot(img.width) && pot(img.height);   // WebGL1 repeats and mips power-of-two only
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, img.width, img.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, img.rgba);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, p ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, p ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, p ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      if (p) gl.generateMipmap(gl.TEXTURE_2D);
      uploads++; e = { t, gen }; texes.set(img.rgba, e);
    }
    e.gen = gen; return e.t;
  }
  function drawAc(chunks, vp, pose, images) {
    const L = ACLOOK.LIGHT;
    for (const b of chunks) {
      const m = b.group;
      if (!b.uvs) throw new Error(`renderer: ${b.key} has no uvs for its AC material`);
      const u = ACLOOK.uniformsFor(m), pr = ac[u.program];
      use(pr, vp);
      gl.uniform1f(pr.ksAmbient, u.ambient); gl.uniform1f(pr.ksDiffuse, u.diffuse); gl.uniform1f(pr.ksSpecular, u.specular);
      gl.uniform1f(pr.ksSpecularEXP, u.specularExp); gl.uniform3f(pr.ksEmissive, u.emissive[0], u.emissive[1], u.emissive[2]);
      gl.uniform1f(pr.ksAlphaRef, u.alphaRef); gl.uniform1f(pr.uAlphaTested, u.alphaTested ? 1 : 0);
      gl.uniform3f(pr.uToSun, L.toSun[0], L.toSun[1], L.toSun[2]); gl.uniform3f(pr.uSun, L.sun[0], L.sun[1], L.sun[2]);
      gl.uniform3f(pr.uAmbientDown, L.ambientDown[0], L.ambientDown[1], L.ambientDown[2]);
      gl.uniform3f(pr.uAmbientRange, L.ambientRange[0], L.ambientRange[1], L.ambientRange[2]);
      gl.uniform3f(pr.uEye, pose.eye[0], pose.eye[1], pose.eye[2]);
      if (u.program === 'ksPerPixelNM') gl.uniform1f(pr.nmObjectSpace, u.nmObjectSpace ? 1 : 0);
      if (u.detail) for (const k of ['multR', 'multG', 'multB', 'multA', 'magicMult']) gl.uniform1f(pr[k], u.detail[k]);
      AC.SAMPLERS[u.program].forEach((name, unit) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, textureFor(u.textures[name] && images ? images.get(u.textures[name]) : null));
        gl.uniform1i(pr.samplers[unit], unit);
      });
      gl.enableVertexAttribArray(pr.pos); gl.enableVertexAttribArray(pr.nrm); gl.enableVertexAttribArray(pr.uv); gl.enableVertexAttribArray(pr.tan);
      bufferFor(b.positions, gl.ARRAY_BUFFER); gl.vertexAttribPointer(pr.pos, 3, gl.FLOAT, false, 0, 0);
      bufferFor(b.normals, gl.ARRAY_BUFFER); gl.vertexAttribPointer(pr.nrm, 3, gl.FLOAT, false, 0, 0);
      bufferFor(b.uvs, gl.ARRAY_BUFFER); gl.vertexAttribPointer(pr.uv, 2, gl.FLOAT, false, 0, 0);
      bufferFor(chunkTangents(b), gl.ARRAY_BUFFER); gl.vertexAttribPointer(pr.tan, 3, gl.FLOAT, false, 0, 0);
      bufferFor(b.indices, gl.ELEMENT_ARRAY_BUFFER);
      gl.uniformMatrix4fv(pr.model, false, b.model);
      gl.drawElements(gl.TRIANGLES, b.indices.length, gl.UNSIGNED_SHORT, 0); draws++; acDraws++;
      gl.disableVertexAttribArray(pr.nrm); gl.disableVertexAttribArray(pr.uv); gl.disableVertexAttribArray(pr.tan);
    }
    gl.activeTexture(gl.TEXTURE0);
  }
  const use = (pr, vp) => { gl.useProgram(pr.p); gl.uniformMatrix4fv(pr.vp, false, vp); gl.uniform3f(pr.fog, fog[0], fog[1], fog[2]); gl.uniform1f(pr.fogD, fogDensity); };
  function drawSurfaces(chunks, vp, alpha, tint) {
    use(surf, vp); gl.uniform1f(surf.alpha, alpha);
    gl.enableVertexAttribArray(surf.pos); gl.enableVertexAttribArray(surf.nrm);
    for (const b of chunks) {
      bufferFor(b.positions, gl.ARRAY_BUFFER); gl.vertexAttribPointer(surf.pos, 3, gl.FLOAT, false, 0, 0);
      bufferFor(b.normals, gl.ARRAY_BUFFER); gl.vertexAttribPointer(surf.nrm, 3, gl.FLOAT, false, 0, 0);
      bufferFor(b.indices, gl.ELEMENT_ARRAY_BUFFER);
      gl.uniformMatrix4fv(surf.model, false, b.model);
      const c = tint || b.colour; gl.uniform3f(surf.colour, c[0], c[1], c[2]);
      gl.drawElements(gl.TRIANGLES, b.indices.length, gl.UNSIGNED_SHORT, 0); draws++;
    }
    gl.disableVertexAttribArray(surf.nrm);
  }
  function drawLines(arr, model, colour, alpha, fade = [0, 0]) {
    if (!arr || !arr.length) return;
    gl.uniformMatrix4fv(line.model, false, model); gl.uniform3f(line.colour, colour[0], colour[1], colour[2]); gl.uniform1f(line.alpha, alpha);
    gl.uniform2f(line.fade, fade[0], fade[1]);
    bufferFor(arr, gl.ARRAY_BUFFER); gl.vertexAttribPointer(line.pos, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, arr.length / 3); lines++;
  }
  function drawRoadLines(chunks, vp, alpha, blending = false) {
    use(line, vp); gl.enableVertexAttribArray(line.pos);
    // the ties fade with distance, which needs blending; the ghost pass has it on already
    if (!blending) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
    for (const c of chunks) {
      const L = chunkLines(c); if (!L) continue;
      drawLines(L.edges, IDENTITY, edge, alpha); drawLines(L.ties, IDENTITY, tie, alpha, TIE_FADE);
    }
    if (!blending) gl.disable(gl.BLEND);
  }
  function drawSky(B, time) {
    const sp = skyProg, s = clear, a = skyA || clear, b = skyB || clear, c = skyC || clear;
    if (!skyBuf) { skyBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf); gl.bufferData(gl.ARRAY_BUFFER, SKY_STRIP, gl.STATIC_DRAW); uploads++; }
    gl.useProgram(sp.p);
    gl.uniform3f(sp.fwd, B.fwd[0], B.fwd[1], B.fwd[2]); gl.uniform3f(sp.right, B.right[0], B.right[1], B.right[2]); gl.uniform3f(sp.up, B.up[0], B.up[1], B.up[2]);
    gl.uniform3f(sp.sky, s[0], s[1], s[2]); gl.uniform3f(sp.a, a[0], a[1], a[2]); gl.uniform3f(sp.b, b[0], b[1], b[2]); gl.uniform3f(sp.c, c[0], c[1], c[2]);
    gl.uniform1f(sp.time, time);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf); gl.enableVertexAttribArray(sp.pos); gl.vertexAttribPointer(sp.pos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  }
  return {
    /** D381: a skin's 3D colours, { sky, fog, edge, tie, grid }, each [r, g, b] from 0 to 1 (themeFrom(tokens) reads them); a key left out keeps its colour. */
    setTheme(t) {
      const ok = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && x >= 0 && x <= 1);
      for (const k of Object.keys(t || {})) {
        if (k === 'skyStyle') continue;
        if (!['sky', 'fog', 'edge', 'tie', 'grid', 'skyA', 'skyB', 'skyC'].includes(k)) throw new Error(`renderer: setTheme has no colour named ${k}`);
        if (!ok(t[k])) throw new Error(`renderer: the ${k} colour is three numbers from 0 to 1, got ${JSON.stringify(t[k])}`);
      }
      // D384: the sky is compiled here, so an unknown style or a pattern that does not compile fails at the skin change, before anything is replaced
      if (t && t.skyStyle !== undefined && t.skyStyle !== skyStyle) {
        const src = SKY.patternSource(t.skyStyle), next = src ? program(SKY_VS, skyFS(src)) : null;
        if (next) {
          const u = (n) => gl.getUniformLocation(next.p, n);
          Object.assign(next, { fwd: u('uFwd'), right: u('uRight'), up: u('uUp'), sky: u('uSky'), a: u('uSkyA'), b: u('uSkyB'), c: u('uSkyC'), time: u('uTime') });
        }
        if (skyProg) gl.deleteProgram(skyProg.p);
        skyProg = next; skyStyle = t.skyStyle;
      }
      if (t.sky) clear = t.sky; if (t.fog) fog = t.fog; if (t.edge) edge = t.edge; if (t.tie) tie = t.tie; if (t.grid) gridColour = t.grid;
      if (t.skyA) skyA = t.skyA; if (t.skyB) skyB = t.skyB; if (t.skyC) skyC = t.skyC;
    },
    draw(batches, pose, { width, height }, extras = {}) {
      if (!(width > 0 && height > 0)) throw new Error('renderer: the canvas has no size');
      gen++; draws = 0; lines = 0; acDraws = 0; chunkCount = 0;
      const look = extras.look || 'ac';
      if (look !== 'ac' && look !== 'words') throw new Error(`renderer: unknown look ${look}`);
      gl.viewport(0, 0, width, height);
      gl.clearColor(clear[0], clear[1], clear[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.depthMask(true);
      const time = extras.time === undefined ? 0 : extras.time;
      if (!Number.isFinite(time)) throw new Error(`renderer: the sky's time is a number of seconds, got ${String(time)}`);
      if (skyProg) drawSky(skyBasis(pose, width / height), time);
      const vp = new Float32Array(M.viewProj(pose, width / height));
      if (extras.grid) { use(line, vp); gl.enableVertexAttribArray(line.pos); drawLines(extras.grid.positions, IDENTITY, gridColour, 1); }
      let chunks;
      if (look === 'ac' && typeof extras.materialOf === 'function') {
        const materialOf = extras.materialOf;
        chunks = chunksOf(batches, (b) => { const m = materialOf(b); if (!m) throw new Error(`renderer: no material for ${b.key}`); return m; }, materialOf);
        drawAc(chunks, vp, pose, extras.textures);
      } else { chunks = chunksOf(batches, colourKey, 'colour'); drawSurfaces(chunks, vp, 1, null); }
      chunkCount = chunks.length;
      if (extras.lines !== false) drawRoadLines(chunks, vp, 1);
      if (extras.ghost && extras.ghost.length) {       // see-through, over the placed track, without writing depth
        const ghost = chunksOf(extras.ghost, () => 'ghost', 'ghost');
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
        drawSurfaces(ghost, vp, GHOST_ALPHA, COLOURS.ghost);
        drawRoadLines(ghost, vp, 0.8, true);
        gl.depthMask(true); gl.disable(gl.BLEND);
      }
      // D237 (app/preview/guides.js): the 3D grid's lattice and the symmetry axes, faint blended lines that the track hides where it is nearer: depth-tested, no depth written
      if (extras.depthLines && extras.depthLines.length) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); use(line, vp); gl.enableVertexAttribArray(line.pos);
        for (const o of extras.depthLines) drawLines(o.positions, IDENTITY, o.colour, o.alpha === undefined ? 1 : o.alpha);
        gl.depthMask(true); gl.disable(gl.BLEND);
      }
      if (extras.marker) { gl.disable(gl.DEPTH_TEST); use(line, vp); gl.enableVertexAttribArray(line.pos); drawLines(extras.marker.positions, IDENTITY, COLOURS.marker, 1); gl.enable(gl.DEPTH_TEST); }
      // the OVERLAY (D237: the mirror ghost), world line pairs drawn over everything, each with its own colour
      if (extras.overlay && extras.overlay.length) {
        gl.disable(gl.DEPTH_TEST); use(line, vp); gl.enableVertexAttribArray(line.pos);
        for (const o of extras.overlay) drawLines(o.positions, IDENTITY, o.colour, o.alpha === undefined ? 1 : o.alpha);
        gl.enable(gl.DEPTH_TEST);
      }
      for (const [arr, e] of buffers) if (e.gen !== gen) { gl.deleteBuffer(e.buf); buffers.delete(arr); }   // no longer drawn
      for (const [arr, e] of texes) if (e.gen !== gen) { gl.deleteTexture(e.t); texes.delete(arr); }
    },
    stats: () => ({ uploads, buffers: buffers.size, draws, lines, acDraws, textures: texes.size, chunks: chunkCount }),
    dispose() {
      for (const e of buffers.values()) gl.deleteBuffer(e.buf); buffers.clear();
      for (const e of texes.values()) gl.deleteTexture(e.t); texes.clear(); if (white) gl.deleteTexture(white);
      if (skyProg) gl.deleteProgram(skyProg.p); if (skyBuf) gl.deleteBuffer(skyBuf);
      gl.deleteProgram(surf.p); gl.deleteProgram(line.p); for (const pr of Object.values(ac)) gl.deleteProgram(pr.p);
    },
  };
}

module.exports = { createRenderer, themeFrom, skyBasis, VS, FS, LVS, LFS, SKY_VS, skyFS, COLOURS, GHOST_ALPHA, TIE_FADE, CLEAR, FOG };
