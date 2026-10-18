// sky-fixture.js: the recording WebGL stand-in sky.test.js uses, and the scene whose calls it pins. Run as a script it writes the calls of
// cbd7a40's renderer (v0.4.3, before the sky pass) for that scene, so a 'none' sky can be checked against the frame SIGIL and Glass drew then:
//   git show cbd7a40:app/preview/renderer.js > <dir>/renderer.js   (beside a copy of app/preview and app/camera)
//   node app/test/sky-fixture.js <that renderer.js> > app/test/sky-none-cbd7a40.json
'use strict';

/** A WebGL stand-in that records every call and its arguments, in order (typed arrays as plain arrays, objects as their id). */
function recordingGL() {
  const calls = []; let id = 0;
  const plain = (a) => (ArrayBuffer.isView(a) ? Array.from(a) : a && typeof a === 'object' && 'id' in a ? { id: a.id } : a);
  const answers = {
    createShader: () => ({ id: ++id }), createProgram: () => ({ id: ++id }), createBuffer: () => ({ id: ++id }), createTexture: () => ({ id: ++id }),
    getShaderParameter: () => true, getProgramParameter: () => true, getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    getUniformLocation: (p, n) => n, getAttribLocation: (p, n) => ({ aPos: 0, aNrm: 1, aUv: 2, aTan: 3 }[n] ?? -1),
  };
  const gl = new Proxy({}, {
    get(t, k) {
      if (typeof k !== 'string') return undefined;
      if (/^[A-Z_0-9]+$/.test(k)) return k;   // the GL constants, by name
      return (...args) => { calls.push([k, ...args.map(plain)]); return answers[k] ? answers[k](...args) : undefined; };
    },
  });
  return { gl, calls };
}

const POSE = { eye: [12, 40, -60], target: [0, 0, 0], up: [0, 1, 0], fov: 1 };
const LINES = { positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 10]) };
const BATCH = { key: 'w0', colour: [0.5, 0.4, 0.3], positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
  indices: new Uint16Array([0, 1, 2]), model: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) };
/** Two frames of one scene: the track in word colours with its lines, the grid, the head marker and an overlay. The calls setTheme itself makes (a sky
 *  compiled, then dropped) are left out: what is pinned is the renderer's creation and its frames. */
function drawScene(R, { setTheme } = {}) {
  const { gl, calls } = recordingGL(), r = R.createRenderer(gl);
  if (setTheme) { const at = calls.length; setTheme(r); calls.splice(at); }
  const extras = { look: 'words', grid: LINES, marker: LINES, overlay: [{ positions: LINES.positions, colour: [1, 0, 0], alpha: 0.5 }], time: 12.5 };
  r.draw([BATCH], POSE, { width: 800, height: 600 }, extras); r.draw([BATCH], POSE, { width: 800, height: 600 }, extras);
  // objects numbered by first appearance in what is kept, so the ids setTheme used up do not shift the rest
  const ids = new Map(), num = (a) => (a && typeof a === 'object' && !Array.isArray(a) && 'id' in a ? { id: ids.get(a.id) ?? (ids.set(a.id, ids.size + 1), ids.size) } : a);
  return calls.map((c) => c.map(num));
}

if (require.main === module) {
  const R = require(require('path').resolve(process.argv[2]));
  process.stdout.write(JSON.stringify(drawScene(R)) + '\n');
}
module.exports = { recordingGL, drawScene, POSE };
