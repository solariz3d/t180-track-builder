// scene.js: the shared scene shape every exporter builds to, and the one check that refuses anything else.
// validateScene(scene) returns nothing on a good scene and throws a SceneError (err.name 'SceneError', err.code below,
// err.path the node path) on the first breach. It never repairs or guesses.
//
//   scene = { textures: [{ name, data: Buffer }],            // PNG or DDS bytes; may be empty
//             materials: [{ name, shader, alphaBlend: 0|1|2, alphaTested: bool, depthMode: int,
//                           props: [{ name, value: [1 to 4 floats] }], samplers: [{ name, slot, texture }] }],
//             root: node }                                      // root is a dummy
//   node  = { type: 'dummy', name, matrix: [16], children: [node...] }
//         | { type: 'mesh', name, material: <index>, positions: Float32Array(3n), normals: Float32Array(3n),
//             uvs: Float32Array(2n), indices: Uint16Array(3t), castShadows, visible, transparent, renderable }
//
// Units are metres, Y up. `matrix` is 16 floats in kn5's stored order (translation at [12..14], as tools/kn5.cjs
// reads it). UVs are the usual image convention, v = 0 at the BOTTOM of the image; the writer flips V. Triangles are
// CCW seen from outside (right-handed, the order real kn5 tracks store); the writer keeps that order.
// A sampler's `texture` is the name of an entry in `textures`.

const MAX_VERTICES = 65535;   // ARCHITECTURE §3: "under 65,536 vertices each" (16-bit indices)

class SceneError extends Error {
  constructor(code, message, path) {
    super(`${code}: ${message}${path ? ` (at ${path})` : ''}`);
    this.name = 'SceneError';
    this.code = code;
    this.path = path || '';
  }
}

const isStr = (s) => typeof s === 'string' && s.length > 0;
const isBool = (b) => b === true || b === false;
const allFinite = (a) => { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; };

function validateScene(scene) {
  if (!scene || typeof scene !== 'object') throw new SceneError('BAD_SCENE', 'scene is not an object');
  const { textures, materials, root } = scene;
  if (!Array.isArray(textures)) throw new SceneError('BAD_TEXTURES', 'textures is not an array');
  if (!Array.isArray(materials)) throw new SceneError('BAD_MATERIALS', 'materials is not an array');

  const texNames = new Set();
  textures.forEach((t, i) => {
    const at = `textures[${i}]`;
    if (!t || !isStr(t.name)) throw new SceneError('BAD_TEXTURE', 'texture has no name', at);
    if (!Buffer.isBuffer(t.data)) throw new SceneError('BAD_TEXTURE', `texture ${t.name} data is not a Buffer`, at);
    if (texNames.has(t.name)) throw new SceneError('DUPLICATE_TEXTURE', `texture name ${t.name} appears twice`, at);
    texNames.add(t.name);
  });

  materials.forEach((m, i) => {
    const at = `materials[${i}]`;
    if (!m || !isStr(m.name) || !isStr(m.shader)) throw new SceneError('BAD_MATERIAL', 'material needs a name and a shader', at);
    if (![0, 1, 2].includes(m.alphaBlend)) throw new SceneError('BAD_MATERIAL', `alphaBlend ${m.alphaBlend} is not 0, 1 or 2`, at);
    if (!isBool(m.alphaTested)) throw new SceneError('BAD_MATERIAL', 'alphaTested is not a boolean', at);
    if (!Number.isInteger(m.depthMode)) throw new SceneError('BAD_MATERIAL', 'depthMode is not an integer', at);
    if (!Array.isArray(m.props)) throw new SceneError('BAD_MATERIAL', 'props is not an array', at);
    m.props.forEach((p, j) => {
      if (!p || !isStr(p.name)) throw new SceneError('BAD_PROP', 'prop has no name', `${at}.props[${j}]`);
      if (!Array.isArray(p.value) || p.value.length < 1 || p.value.length > 4 || !allFinite(p.value))
        throw new SceneError('BAD_PROP', `prop ${p.name} value must be 1 to 4 finite floats`, `${at}.props[${j}]`);
    });
    if (!Array.isArray(m.samplers)) throw new SceneError('BAD_MATERIAL', 'samplers is not an array', at);
    m.samplers.forEach((s, j) => {
      const sat = `${at}.samplers[${j}]`;
      if (!s || !isStr(s.name)) throw new SceneError('BAD_SAMPLER', 'sampler has no name', sat);
      if (!Number.isInteger(s.slot) || s.slot < 0) throw new SceneError('BAD_SAMPLER', `slot ${s.slot} is not a non-negative integer`, sat);
      if (!texNames.has(s.texture)) throw new SceneError('UNKNOWN_TEXTURE', `sampler ${s.name} names texture ${s.texture}, which is not in textures`, sat);
    });
  });

  if (!root || root.type !== 'dummy') throw new SceneError('BAD_ROOT', 'root must be a dummy node');
  const visit = (n, path) => {
    if (!n || typeof n !== 'object') throw new SceneError('BAD_NODE', 'node is not an object', path);
    if (!isStr(n.name)) throw new SceneError('BAD_NODE', 'node has no name', path);
    const at = `${path}/${n.name}`;
    if (n.type === 'dummy') {
      if (!Array.isArray(n.matrix) || n.matrix.length !== 16) throw new SceneError('BAD_MATRIX', `matrix has ${Array.isArray(n.matrix) ? n.matrix.length : 'no'} entries, not 16`, at);
      if (!allFinite(n.matrix)) throw new SceneError('BAD_MATRIX', 'matrix has a non-finite entry', at);
      if (!Array.isArray(n.children)) throw new SceneError('BAD_NODE', 'children is not an array', at);
      n.children.forEach((c, i) => visit(c, at));
      return;
    }
    if (n.type !== 'mesh') throw new SceneError('BAD_NODE', `type ${n.type} is not dummy or mesh`, at);
    if (n.children !== undefined && !(Array.isArray(n.children) && n.children.length === 0))
      throw new SceneError('MESH_HAS_CHILDREN', 'a kn5 mesh node cannot have children', at);
    if (!Number.isInteger(n.material) || n.material < 0 || n.material >= materials.length)
      throw new SceneError('MATERIAL_OUT_OF_RANGE', `material ${n.material} is not an index into ${materials.length} materials`, at);
    if (!(n.positions instanceof Float32Array) || n.positions.length % 3 !== 0) throw new SceneError('BAD_POSITIONS', 'positions must be a Float32Array of 3n', at);
    const nv = n.positions.length / 3;
    if (nv > MAX_VERTICES) throw new SceneError('TOO_MANY_VERTICES', `${nv} vertices; a kn5 mesh holds at most ${MAX_VERTICES}`, at);
    if (!(n.normals instanceof Float32Array) || n.normals.length !== 3 * nv) throw new SceneError('BAD_NORMALS', 'normals must be a Float32Array of the same 3n', at);
    if (!(n.uvs instanceof Float32Array) || n.uvs.length !== 2 * nv) throw new SceneError('BAD_UVS', 'uvs must be a Float32Array of 2n', at);
    if (!allFinite(n.positions) || !allFinite(n.normals) || !allFinite(n.uvs)) throw new SceneError('NON_FINITE', 'a vertex value is not finite', at);
    if (!(n.indices instanceof Uint16Array) || n.indices.length % 3 !== 0) throw new SceneError('BAD_INDICES', 'indices must be a Uint16Array of whole triangles', at);
    if (n.indices.length === 0) throw new SceneError('EMPTY_MESH', 'a mesh with 0 triangles is refused (see kn5write.js)', at);
    for (let i = 0; i < n.indices.length; i++)
      if (n.indices[i] >= nv) throw new SceneError('INDEX_OUT_OF_RANGE', `index ${n.indices[i]} at ${i} is past the last of ${nv} vertices`, at);
    for (const f of ['castShadows', 'visible', 'transparent', 'renderable'])
      if (!isBool(n[f])) throw new SceneError('BAD_FLAG', `${f} is not a boolean`, at);
  };
  visit(root, '');
}

module.exports = { validateScene, SceneError, MAX_VERTICES };
