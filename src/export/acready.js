// acready.js: the last step before writeKn5, making the scene into what Assetto Corsa actually loads correctly.
// Both rules were found in the first in-game drive (2026-10-02, TEST OVAL in AC + CSP, docs/FINDINGS.md §9):
//
//   flattenForAc(scene)  every mesh's vertices and normals baked into WORLD space under identity nodes, and every mesh
//                        name made unique. The builder's scene places each road cell under its own CELL_/SEAM_ dummy
//                        with a transform, and reuses the cell's name 500 times per piece. AC drew that track, but its
//                        physics did not collide with it: the car fell through. A copy with only these two changes
//                        drove at 900+ km/h. Markers (AC_*) keep their world matrix, since their placement IS their
//                        meaning. The preview keeps the per-cell transforms (fast sculpting); only the export flattens.
//   ensureDiffuse(scene) every material without a txDiffuse sampler gets a small solid-colour DDS bound as txDiffuse.
//                        ksPerPixel takes its colour from txDiffuse; with none bound the road rendered black under any
//                        light. A copy with a grey diffuse bound rendered lit.
//
// Neither changes geometry: the flattened positions equal the nested scene's world positions (tested).
'use strict';
const { encodeDds } = require('../texture/dds.js');

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const isIdentity = (m) => m.every((v, k) => Math.abs(v - IDENTITY[k]) < 1e-12);
/** Row-vector composition, the kn5 convention (tools/kn5.cjs): world = local · parent. */
function mul(a, b) {
  const r = new Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j]; r[i * 4 + j] = s; }
  return r;
}

function flattenForAc(scene) {
  const out = [], used = new Map();
  const unique = (name) => {
    let n = used.get(name) || 0;
    used.set(name, n + 1);
    if (n === 0) return name;
    let cand; do { n++; cand = `${name}_${n}`; } while (used.has(cand));
    used.set(name, n); used.set(cand, 1);
    return cand;
  };
  (function walk(node, parent) {
    if (node.type === 'mesh') {
      const M = parent, P = node.positions, N = node.normals, nv = P.length / 3;
      let positions = P, normals = N;
      if (!isIdentity(M)) {
        positions = new Float32Array(P.length); normals = new Float32Array(N.length);
        for (let v = 0; v < nv; v++) {
          const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2];
          positions[3 * v] = x * M[0] + y * M[4] + z * M[8] + M[12];
          positions[3 * v + 1] = x * M[1] + y * M[5] + z * M[9] + M[13];
          positions[3 * v + 2] = x * M[2] + y * M[6] + z * M[10] + M[14];
          const a = N[3 * v], b = N[3 * v + 1], c = N[3 * v + 2];   // rotation only: the builder's frames are rigid
          normals[3 * v] = a * M[0] + b * M[4] + c * M[8];
          normals[3 * v + 1] = a * M[1] + b * M[5] + c * M[9];
          normals[3 * v + 2] = a * M[2] + b * M[6] + c * M[10];
        }
      }
      out.push({ ...node, name: unique(node.name), positions, normals });
      return;
    }
    const W = mul(node.matrix, parent);
    if (/^AC_/i.test(node.name)) out.push({ ...node, name: unique(node.name), matrix: W, children: [] });   // a marker keeps its place
    for (const c of node.children || []) walk(c, W);   // anything under a marker (none today) is flattened beside it
  })(scene.root, IDENTITY);
  return { ...scene, root: { type: 'dummy', name: scene.root.name, matrix: IDENTITY.slice(), children: out } };
}

/** A solid-colour diffuse for every material that has none. Paint is near-white; everything else mid-grey. */
function ensureDiffuse(scene) {
  const textures = [...scene.textures], made = new Map();
  const tex = (v) => {
    const name = `t180b_solid_${v}.dds`;
    if (!made.has(name)) {
      const W = 4, rgba = new Uint8Array(W * W * 4);
      for (let k = 0; k < W * W; k++) { rgba[4 * k] = v; rgba[4 * k + 1] = v; rgba[4 * k + 2] = v; rgba[4 * k + 3] = 255; }
      if (!textures.some((t) => t.name === name)) textures.push({ name, data: Buffer.from(encodeDds({ width: W, height: W, rgba })) });
      made.set(name, true);
    }
    return name;
  };
  const materials = scene.materials.map((m) => (m.samplers.some((s) => s.name === 'txDiffuse') ? m
    : { ...m, samplers: [...m.samplers, { name: 'txDiffuse', slot: 0, texture: tex(/paint/i.test(m.name) ? 235 : 128) }] }));
  return { ...scene, textures, materials };
}

module.exports = { flattenForAc, ensureDiffuse };
