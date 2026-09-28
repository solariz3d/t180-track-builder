// raster.js: render a look-match reference view of an AC track in the builder's LOOK, on the CPU (node has no WebGL).
//
//   renderView(scene, camera, { textures, fog, fogDensity }) -> { width, height, rgba, stats }
//     scene: src/lookmatch/kn5scene.js readScene; camera: src/lookmatch/cameras.js resolveView; textures: Map name → RGBA
//     image (already decoded; a name not in it draws white, and is counted).
//
// THE SAME LOOK AS THE PREVIEW, NOT THE SAME RASTERISER. Every pixel's colour is app/preview/aclook.js: uniformsFor(material)
// (the property → uniform mapping, actools' own) and shade(u, tx, n, toSun, toEye) under LIGHT, which is what
// app/preview/acshaders.js computes on the GPU, plus the preview renderer's fog (the same colour and density). What differs
// from the WebGL window, stated: no MSAA and no mip filtering (bilinear on one mip level, src/lookmatch/dds.js), ksPerPixelNM
// is shaded with the vertex normal (its normal map is not sampled), and ksMultilayer with its base txDiffuse only (the
// inferred detail blend is not applied). A pixel nothing covers stays transparent (alpha 0): the metric leaves it out (sky).
// Perspective-correct attributes, a z-buffer, and triangles clipped at the near plane.
'use strict';
const A = require('../../app/preview/aclook.js');

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

/** The scene's material as aclook.uniformsFor takes it (a scalar is slot A, ksEmissive slot C, as kn5write writes them). */
function acMaterial(m) {
  return { name: m.name, shader: m.shader, alphaTested: m.alphaTested,
    props: Object.entries(m.props).map(([name, v]) => ({ name, value: name === 'ksEmissive' ? v.slice(3, 6) : [v[0]] })),
    samplers: Object.entries(m.samplers).map(([name, texture]) => ({ name, texture })) };
}
function sample(tex, u, v) {
  const w = tex.width, h = tex.height, x = (u - Math.floor(u)) * w - 0.5, y = (v - Math.floor(v)) * h - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, P = tex.rgba, out = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const xi = ((x0 + (k & 1)) % w + w) % w, yi = ((y0 + (k >> 1)) % h + h) % h, wt = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy), o = (yi * w + xi) * 4;
    out[0] += P[o] * wt; out[1] += P[o + 1] * wt; out[2] += P[o + 2] * wt; out[3] += P[o + 3] * wt;
  }
  return out;
}

function renderView(scene, cam, { textures = new Map(), fog = [0.07, 0.08, 0.1], fogDensity = 0.0012, near = 0.1 } = {}) {
  const W = cam.width, H = cam.height, rgba = new Uint8Array(W * H * 4), depth = new Float32Array(W * H).fill(Infinity);
  // the camera frame: f forward, r right, u up; view space x = r, y = u, z = −f (looking down −z, as GL)
  const f = unit(sub(cam.target, cam.eye)), r = unit(cross(f, cam.up)), u = cross(r, f);
  const t = Math.tan((cam.fovDeg * Math.PI / 180) / 2), aspect = W / H;
  const toSun = A.LIGHT.toSun, stats = { triangles: 0, drawn: 0, clipped: 0, missingTextures: new Set(), pixels: 0 };
  const mats = scene.materials.map((m) => { const am = acMaterial(m), un = A.uniformsFor(am); return { un, tex: un.textures.txDiffuse }; });
  const view = (p) => { const d = sub(p, cam.eye); return [dot(d, r), dot(d, u), -dot(d, f)]; };
  for (const mesh of scene.meshes) {
    const M = mats[mesh.material]; if (!M) throw new Error(`lookmatch: mesh ${mesh.name} has material ${mesh.material}, not in the scene`);
    let tex = null;
    if (M.tex) { tex = textures.get(M.tex) || null; if (!tex) stats.missingTextures.add(M.tex); }
    const P = mesh.pos, N = mesh.nrm, U = mesh.uv, I = mesh.idx;
    for (let k = 0; k < I.length; k += 3) {
      stats.triangles++;
      // vertices in view space with their attributes: [vx, vy, vz, world x y z, normal xyz, u, v]
      let poly = [I[k], I[k + 1], I[k + 2]].map((i) => { const w = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]; return [...view(w), ...w, N[i * 3], N[i * 3 + 1], N[i * 3 + 2], U[i * 2], U[i * 2 + 1]]; });
      if (poly.every((v) => v[2] > -near)) continue;                       // wholly behind the near plane
      if (poly.some((v) => v[2] > -near)) {                                // clip against z = −near (Sutherland–Hodgman)
        const out = [];
        for (let a = 0; a < poly.length; a++) {
          const A0 = poly[a], B0 = poly[(a + 1) % poly.length], ina = A0[2] <= -near, inb = B0[2] <= -near;
          if (ina) out.push(A0);
          if (ina !== inb) { const s = (-near - A0[2]) / (B0[2] - A0[2]); out.push(A0.map((x, j) => x + (B0[j] - x) * s)); }
        }
        poly = out; stats.clipped++;
        if (poly.length < 3) continue;
      }
      // project: x_ndc = x / (−z · t · aspect), y_ndc = y / (−z · t); screen y down
      const S = poly.map((v) => { const iw = 1 / -v[2]; return [(v[0] * iw / (t * aspect) * 0.5 + 0.5) * W, (0.5 - v[1] * iw / t * 0.5) * H, iw, v]; });
      for (let q = 1; q + 1 < S.length; q++) {                             // a fan of the clipped polygon
        const a = S[0], b = S[q], c = S[q + 1];
        const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
        if (!(Math.abs(area) > 1e-12)) continue;
        const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
        const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
        for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5, py = y + 0.5;
          let l0 = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area, l1 = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area, l2 = 1 - l0 - l1;
          if (l0 < 0 || l1 < 0 || l2 < 0) continue;
          const iw = l0 * a[2] + l1 * b[2] + c[2] * l2, zv = 1 / iw, di = y * W + x;       // perspective-correct
          if (zv >= depth[di]) continue;
          const at = (j) => (l0 * a[2] * a[3][j] + l1 * b[2] * b[3][j] + l2 * c[2] * c[3][j]) * zv;
          let tx = [255, 255, 255, 255];
          if (tex) tx = sample(tex, at(9), at(10));                          // the uv (layout above: … nx ny nz u v)
          if (M.un.alphaTested && tx[3] / 255 < M.un.alphaRef) continue;
          depth[di] = zv;
          const wp = [at(3), at(4), at(5)], n = unit([at(6), at(7), at(8)]), toEye = unit(sub(cam.eye, wp));
          const c3 = A.shade(M.un, [tx[0] / 255, tx[1] / 255, tx[2] / 255], n, toSun, toEye), k2 = Math.min(1, Math.max(0, Math.exp(-fogDensity * zv)));
          for (let ch = 0; ch < 3; ch++) rgba[di * 4 + ch] = Math.round(255 * Math.min(1, Math.max(0, fog[ch] + (c3[ch] - fog[ch]) * k2)));
          rgba[di * 4 + 3] = 255;
        }
        stats.drawn++;
      }
    }
  }
  for (let i = 0; i < W * H; i++) if (rgba[i * 4 + 3]) stats.pixels++;
  return { width: W, height: H, rgba, stats: { ...stats, missingTextures: [...stats.missingTextures].sort() } };
}

module.exports = { renderView, acMaterial };
