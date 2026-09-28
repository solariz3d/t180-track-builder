// renderer.js: draws the track batches (app/preview/batches.js) with WebGL. Started from blackbox's renderer
// (ui/glcore.js): a shader that fails to compile says so loudly instead of leaving a silent black canvas, and the camera
// math is column-major (app/camera/math.js). The track only: no sky, no environment. The ground grid at y = 0 and the
// head marker are editor UI (the D170 review, item 7), not scenery.
// THE AC LOOK (D177) started from the same blackbox files: ui/glcore.js's per-material uniforms (ksSpecular /
// ksSpecularEXP / ksEmissive / ksAlphaRef from the kn5, a hemisphere ambient, the eye for the half vector) and ui/kn5.js's
// reading of the property block (ten floats, A B C D); the lighting itself is actools' (app/preview/acshaders.js).
//
//   const r = createRenderer(gl)            gl: a WebGL1 or WebGL2 context
//   r.draw(batches, pose, { width, height }, extras)      pose from app/camera/cameras.js ({ eye, target, up, fov, far? })
//       extras = { grid, marker, ghost, lines = true }    grid / marker from look.js (world lines); ghost = batches drawn
//                                                         see-through, with their own lines, after the placed track
//       extras.look = 'ac' (the default) with extras.materialOf(batch) -> the EXPORTED material ({ name, shader, props,
//                   samplers, alphaTested }) and extras.textures (a Map, texture file -> { width, height, rgba }): each
//                   batch is drawn with its AC shader (acshaders.js, the Ms-PL port) and the uniforms aclook.js
//                   uniformsFor gives, under aclook.js's ONE reference light. look 'words', or no materialOf, draws the
//                   D170 per-word colours instead. A sampler whose texture is not in extras.textures gets one white texel.
//   r.stats()  -> { uploads, buffers, draws, lines, acDraws, textures }      uploads = bufferData + texImage2D calls
//   r.dispose()
//
// LIGHT (D170 item 1): the lighting is look.js `shade`, compiled into the fragment shader from the same constants, so a
// floor, a bank and a wall of one colour read as different surfaces. The ROAD LINES (edges, centre, ties across) come
// from look.js `linesFor`, in each cell's own frame, drawn with its model matrix.
//
// GPU BUFFERS ARE KEYED BY THE ARRAY OBJECT. The geometry hands the same Float32Array back for a piece it did not
// rebuild (extendMesh keeps old pieces, sculptMesh keeps pieces that only moved), and linesFor memoises by that array,
// so those cost no upload; only arrays new in this frame are uploaded, and arrays no longer drawn are deleted after the
// frame. A drag that sculpts one word uploads that word's cells, lines and the seams beside it, and nothing else.
'use strict';

const M = require('../camera/math.js');
const { LIGHT, linesFor, tangentsFor } = require('./look.js');
const AC = require('./acshaders.js');
const ACLOOK = require('./aclook.js');

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

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const COLOURS = Object.freeze({ edge: [0.93, 0.93, 0.88], tie: [0.06, 0.07, 0.09], grid: [0.2, 0.23, 0.28], marker: [1.0, 0.62, 0.15], ghost: [0.55, 0.85, 1.0] });
const GHOST_ALPHA = 0.42;
// D179, the usability pass (p-d179-lookpass-C §1): the ties are one near-black line per station; from overhead or far
// away they outnumber the pixels and hatch the lit road dark (measured: 42–51% of the overhead's drawn pixels near-black),
// so they fade out between 60 and 250 m (the edges stay). And the canvas is cleared darker than the FOG colour: surfaces
// facing away from the sun (a tube's ceiling, L* about 14) were only ΔE00 about 6 from a background that was the fog colour.
// The fog colour itself is part of the look and is unchanged (src/lookmatch/raster.js uses the same).
const TIE_FADE = Object.freeze([60, 250]);
const CLEAR = Object.freeze([0.03, 0.035, 0.045]);

function createRenderer(gl, { fog = [0.07, 0.08, 0.1], fogDensity = 0.0012, clear = CLEAR } = {}) {
  if (!gl) throw new Error('renderer: no WebGL context');
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
  const surf = program(VS, FS), line = program(LVS, LFS);
  line.fade = gl.getUniformLocation(line.p, 'uFade');
  const buffers = new Map();   // typed array → { buf, gen }
  let gen = 0, uploads = 0, draws = 0, lines = 0;
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
  function drawAc(batches, vp, pose, materialOf, images) {
    const L = ACLOOK.LIGHT;
    for (const b of batches) {
      const m = materialOf(b);
      if (!m) throw new Error(`renderer: no material for ${b.key}`);
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
      bufferFor(tangentsFor(b), gl.ARRAY_BUFFER); gl.vertexAttribPointer(pr.tan, 3, gl.FLOAT, false, 0, 0);
      bufferFor(b.indices, gl.ELEMENT_ARRAY_BUFFER);
      gl.uniformMatrix4fv(pr.model, false, new Float32Array(b.model));
      gl.drawElements(gl.TRIANGLES, b.indices.length, gl.UNSIGNED_SHORT, 0); draws++; acDraws++;
      gl.disableVertexAttribArray(pr.nrm); gl.disableVertexAttribArray(pr.uv); gl.disableVertexAttribArray(pr.tan);
    }
    gl.activeTexture(gl.TEXTURE0);
  }
  const use = (pr, vp) => { gl.useProgram(pr.p); gl.uniformMatrix4fv(pr.vp, false, vp); gl.uniform3f(pr.fog, fog[0], fog[1], fog[2]); gl.uniform1f(pr.fogD, fogDensity); };
  function drawSurfaces(batches, vp, alpha, tint) {
    use(surf, vp); gl.uniform1f(surf.alpha, alpha);
    gl.enableVertexAttribArray(surf.pos); gl.enableVertexAttribArray(surf.nrm);
    for (const b of batches) {
      bufferFor(b.positions, gl.ARRAY_BUFFER); gl.vertexAttribPointer(surf.pos, 3, gl.FLOAT, false, 0, 0);
      bufferFor(b.normals, gl.ARRAY_BUFFER); gl.vertexAttribPointer(surf.nrm, 3, gl.FLOAT, false, 0, 0);
      bufferFor(b.indices, gl.ELEMENT_ARRAY_BUFFER);
      gl.uniformMatrix4fv(surf.model, false, new Float32Array(b.model));
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
  function drawRoadLines(batches, vp, alpha, blending = false) {
    use(line, vp); gl.enableVertexAttribArray(line.pos);
    // the ties fade with distance, which needs blending; the ghost pass has it on already
    if (!blending) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
    for (const b of batches) {
      const L = linesFor(b); if (!L) continue;
      const model = new Float32Array(b.model);
      drawLines(L.edges, model, COLOURS.edge, alpha); drawLines(L.ties, model, COLOURS.tie, alpha, TIE_FADE);
    }
    if (!blending) gl.disable(gl.BLEND);
  }
  return {
    draw(batches, pose, { width, height }, extras = {}) {
      if (!(width > 0 && height > 0)) throw new Error('renderer: the canvas has no size');
      gen++; draws = 0; lines = 0; acDraws = 0;
      const look = extras.look || 'ac';
      if (look !== 'ac' && look !== 'words') throw new Error(`renderer: unknown look ${look}`);
      gl.viewport(0, 0, width, height);
      gl.clearColor(clear[0], clear[1], clear[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.depthMask(true);
      const vp = new Float32Array(M.viewProj(pose, width / height));
      if (extras.grid) { use(line, vp); gl.enableVertexAttribArray(line.pos); drawLines(extras.grid.positions, IDENTITY, COLOURS.grid, 1); }
      if (look === 'ac' && typeof extras.materialOf === 'function') drawAc(batches, vp, pose, extras.materialOf, extras.textures);
      else drawSurfaces(batches, vp, 1, null);
      if (extras.lines !== false) drawRoadLines(batches, vp, 1);
      if (extras.ghost && extras.ghost.length) {       // see-through, over the placed track, without writing depth
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
        drawSurfaces(extras.ghost, vp, GHOST_ALPHA, COLOURS.ghost);
        drawRoadLines(extras.ghost, vp, 0.8, true);
        gl.depthMask(true); gl.disable(gl.BLEND);
      }
      if (extras.marker) { gl.disable(gl.DEPTH_TEST); use(line, vp); gl.enableVertexAttribArray(line.pos); drawLines(extras.marker.positions, IDENTITY, COLOURS.marker, 1); gl.enable(gl.DEPTH_TEST); }
      for (const [arr, e] of buffers) if (e.gen !== gen) { gl.deleteBuffer(e.buf); buffers.delete(arr); }   // no longer drawn
      for (const [arr, e] of texes) if (e.gen !== gen) { gl.deleteTexture(e.t); texes.delete(arr); }
    },
    stats: () => ({ uploads, buffers: buffers.size, draws, lines, acDraws, textures: texes.size }),
    dispose() {
      for (const e of buffers.values()) gl.deleteBuffer(e.buf); buffers.clear();
      for (const e of texes.values()) gl.deleteTexture(e.t); texes.clear(); if (white) gl.deleteTexture(white);
      gl.deleteProgram(surf.p); gl.deleteProgram(line.p); for (const pr of Object.values(ac)) gl.deleteProgram(pr.p);
    },
  };
}

module.exports = { createRenderer, VS, FS, LVS, LFS, COLOURS, GHOST_ALPHA, TIE_FADE, CLEAR };
