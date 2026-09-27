// renderer.js: draws the track batches (app/preview/batches.js) with WebGL. Started from blackbox's renderer
// (ui/glcore.js): a shader that fails to compile says so loudly instead of leaving a silent black canvas, and the camera
// math is column-major (app/camera/math.js). v1 is the track only: no sky, no environment, no textures.
//
//   const r = createRenderer(gl)            gl: a WebGL1 or WebGL2 context
//   r.draw(batches, pose, { width, height })      pose from app/camera/cameras.js ({ eye, target, up, fov })
//   r.stats()  -> { uploads, buffers, draws }      uploads = bufferData calls so far
//   r.dispose()
//
// GPU BUFFERS ARE KEYED BY THE ARRAY OBJECT. The geometry hands the same Float32Array back for a piece it did not
// rebuild (extendMesh keeps old pieces, sculptMesh keeps pieces that only moved), so those cost no upload; only arrays
// new in this frame are uploaded, and arrays no batch uses any more are deleted after the frame. A drag that sculpts
// one word therefore uploads that word's cells and the seams beside it, and nothing else.
'use strict';

const M = require('../camera/math.js');

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
const FS = `
precision mediump float;
varying vec3 vN; varying float vDepth;
uniform vec3 uColour; uniform vec3 uLight; uniform vec3 uFog; uniform float uFogDensity;
void main(){
  vec3 n = normalize(vN);
  float lit = 0.35 + 0.65 * abs(dot(n, uLight));      /* two-sided: overhangs and tube roofs are lit from below too */
  float fog = clamp(exp(-uFogDensity * vDepth), 0.0, 1.0);
  gl_FragColor = vec4(mix(uFog, uColour * lit, fog), 1.0);
}`;

function createRenderer(gl, { fog = [0.07, 0.08, 0.1], fogDensity = 0.0015, light = [0.35, 0.85, 0.4] } = {}) {
  if (!gl) throw new Error('renderer: no WebGL context');
  const shader = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('renderer: shader compile failed:\n' + (gl.getShaderInfoLog(s) || '(no log)'));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('renderer: program link failed:\n' + (gl.getProgramInfoLog(prog) || '(no log)'));
  const loc = {
    pos: gl.getAttribLocation(prog, 'aPos'), nrm: gl.getAttribLocation(prog, 'aNrm'), vp: gl.getUniformLocation(prog, 'uVP'),
    model: gl.getUniformLocation(prog, 'uModel'), colour: gl.getUniformLocation(prog, 'uColour'), light: gl.getUniformLocation(prog, 'uLight'),
    fog: gl.getUniformLocation(prog, 'uFog'), fogD: gl.getUniformLocation(prog, 'uFogDensity'),
  };
  const ll = Math.hypot(...light), L = light.map((x) => x / ll);
  const buffers = new Map();   // typed array → { buf, gen }
  let gen = 0, uploads = 0, draws = 0;
  function bufferFor(arr, target) {
    let e = buffers.get(arr);
    if (!e) { const buf = gl.createBuffer(); gl.bindBuffer(target, buf); gl.bufferData(target, arr, gl.STATIC_DRAW); uploads++; e = { buf, gen }; buffers.set(arr, e); }
    else gl.bindBuffer(target, e.buf);
    e.gen = gen; return e.buf;
  }
  return {
    draw(batches, pose, { width, height }) {
      if (!(width > 0 && height > 0)) throw new Error('renderer: the canvas has no size');
      gen++; draws = 0;
      gl.viewport(0, 0, width, height);
      gl.clearColor(fog[0], fog[1], fog[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      gl.useProgram(prog);
      const vp = M.mul(M.perspective(pose.fov, width / height, 0.5, 20000), M.lookAt(pose.eye, pose.target, pose.up));
      gl.uniformMatrix4fv(loc.vp, false, new Float32Array(vp));
      gl.uniform3f(loc.light, L[0], L[1], L[2]); gl.uniform3f(loc.fog, fog[0], fog[1], fog[2]); gl.uniform1f(loc.fogD, fogDensity);
      gl.enableVertexAttribArray(loc.pos); gl.enableVertexAttribArray(loc.nrm);
      for (const b of batches) {
        bufferFor(b.positions, gl.ARRAY_BUFFER); gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 0, 0);
        bufferFor(b.normals, gl.ARRAY_BUFFER); gl.vertexAttribPointer(loc.nrm, 3, gl.FLOAT, false, 0, 0);
        bufferFor(b.indices, gl.ELEMENT_ARRAY_BUFFER);
        gl.uniformMatrix4fv(loc.model, false, new Float32Array(b.model));
        gl.uniform3f(loc.colour, b.colour[0], b.colour[1], b.colour[2]);
        gl.drawElements(gl.TRIANGLES, b.indices.length, gl.UNSIGNED_SHORT, 0); draws++;
      }
      for (const [arr, e] of buffers) if (e.gen !== gen) { gl.deleteBuffer(e.buf); buffers.delete(arr); }   // no longer drawn
    },
    stats: () => ({ uploads, buffers: buffers.size, draws }),
    dispose() { for (const e of buffers.values()) gl.deleteBuffer(e.buf); buffers.clear(); gl.deleteProgram(prog); },
  };
}

module.exports = { createRenderer, VS, FS };
