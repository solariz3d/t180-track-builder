// renderer.js: draws the track batches (app/preview/batches.js) with WebGL. Started from blackbox's renderer
// (ui/glcore.js): a shader that fails to compile says so loudly instead of leaving a silent black canvas, and the camera
// math is column-major (app/camera/math.js). v1 is the track only: no sky, no environment, no textures. The ground grid
// at y = 0 and the head marker are editor UI (the D170 review, item 7), not scenery.
//
//   const r = createRenderer(gl)            gl: a WebGL1 or WebGL2 context
//   r.draw(batches, pose, { width, height }, extras)      pose from app/camera/cameras.js ({ eye, target, up, fov, far? })
//       extras = { grid, marker, ghost, lines = true }    grid / marker from look.js (world lines); ghost = batches drawn
//                                                         see-through, with their own lines, after the placed track
//   r.stats()  -> { uploads, buffers, draws, lines }      uploads = bufferData calls so far
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
const { LIGHT, linesFor } = require('./look.js');

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
uniform vec3 uColour; uniform float uAlpha; uniform vec3 uFog; uniform float uFogDensity;
void main(){ float fog = clamp(exp(-uFogDensity * vDepth), 0.0, 1.0); gl_FragColor = vec4(mix(uFog, uColour, fog), uAlpha); }`;

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const COLOURS = Object.freeze({ edge: [0.93, 0.93, 0.88], tie: [0.06, 0.07, 0.09], grid: [0.2, 0.23, 0.28], marker: [1.0, 0.62, 0.15], ghost: [0.55, 0.85, 1.0] });
const GHOST_ALPHA = 0.42;

function createRenderer(gl, { fog = [0.07, 0.08, 0.1], fogDensity = 0.0012 } = {}) {
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
  const buffers = new Map();   // typed array → { buf, gen }
  let gen = 0, uploads = 0, draws = 0, lines = 0;
  function bufferFor(arr, target) {
    let e = buffers.get(arr);
    if (!e) { const buf = gl.createBuffer(); gl.bindBuffer(target, buf); gl.bufferData(target, arr, gl.STATIC_DRAW); uploads++; e = { buf, gen }; buffers.set(arr, e); }
    else gl.bindBuffer(target, e.buf);
    e.gen = gen; return e.buf;
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
  function drawLines(arr, model, colour, alpha) {
    if (!arr || !arr.length) return;
    gl.uniformMatrix4fv(line.model, false, model); gl.uniform3f(line.colour, colour[0], colour[1], colour[2]); gl.uniform1f(line.alpha, alpha);
    bufferFor(arr, gl.ARRAY_BUFFER); gl.vertexAttribPointer(line.pos, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, arr.length / 3); lines++;
  }
  function drawRoadLines(batches, vp, alpha) {
    use(line, vp); gl.enableVertexAttribArray(line.pos);
    for (const b of batches) {
      const L = linesFor(b); if (!L) continue;
      const model = new Float32Array(b.model);
      drawLines(L.edges, model, COLOURS.edge, alpha); drawLines(L.ties, model, COLOURS.tie, alpha);
    }
  }
  return {
    draw(batches, pose, { width, height }, extras = {}) {
      if (!(width > 0 && height > 0)) throw new Error('renderer: the canvas has no size');
      gen++; draws = 0; lines = 0;
      gl.viewport(0, 0, width, height);
      gl.clearColor(fog[0], fog[1], fog[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.depthMask(true);
      const vp = new Float32Array(M.viewProj(pose, width / height));
      if (extras.grid) { use(line, vp); gl.enableVertexAttribArray(line.pos); drawLines(extras.grid.positions, IDENTITY, COLOURS.grid, 1); }
      drawSurfaces(batches, vp, 1, null);
      if (extras.lines !== false) drawRoadLines(batches, vp, 1);
      if (extras.ghost && extras.ghost.length) {       // see-through, over the placed track, without writing depth
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
        drawSurfaces(extras.ghost, vp, GHOST_ALPHA, COLOURS.ghost);
        drawRoadLines(extras.ghost, vp, 0.8);
        gl.depthMask(true); gl.disable(gl.BLEND);
      }
      if (extras.marker) { gl.disable(gl.DEPTH_TEST); use(line, vp); gl.enableVertexAttribArray(line.pos); drawLines(extras.marker.positions, IDENTITY, COLOURS.marker, 1); gl.enable(gl.DEPTH_TEST); }
      for (const [arr, e] of buffers) if (e.gen !== gen) { gl.deleteBuffer(e.buf); buffers.delete(arr); }   // no longer drawn
    },
    stats: () => ({ uploads, buffers: buffers.size, draws, lines }),
    dispose() { for (const e of buffers.values()) gl.deleteBuffer(e.buf); buffers.clear(); gl.deleteProgram(surf.p); gl.deleteProgram(line.p); },
  };
}

module.exports = { createRenderer, VS, FS, LVS, LFS, COLOURS, GHOST_ALPHA };
