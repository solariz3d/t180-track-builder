// batches.js: a src/geom mesh (buildMesh / extendMesh / sculptMesh) as draw batches for the renderer. No GL here.
//
// One batch per mesh node of the scene: its vertex arrays EXACTLY as the geometry made them (the same Float32Array /
// Uint16Array objects, never copied, so the renderer can keep a GPU buffer per array and a sculpt that reuses a piece
// re-uploads nothing for it), and its node matrix as the model matrix. The node matrix is row-vector (kn5's own order,
// world = local · M); the same 16 numbers read column-major are the GL model matrix (app/camera/math.js).
//
// Colour is per placed word (ARCHITECTURE §4 "colour per word"), so the user sees where one piece ends: a stable hue
// from the piece id, alternating light and dark along the track. Seams take their later piece's colour, darkened.
'use strict';

/** A stable hue in [0, 1) from a string (FNV-1a). */
function hue(id) { let h = 2166136261; for (const c of String(id)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return (h % 360) / 360; }
function hsl(h, s, l) {
  const f = (n) => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
}
function colourOf(pieceIndex, id, seam) { return hsl(hue(id), 0.45, (pieceIndex % 2 ? 0.52 : 0.62) - (seam ? 0.18 : 0)); }

function batchesOf(mesh) {
  if (!mesh || !mesh.scene || !Array.isArray(mesh.cells)) throw new Error('batchesOf: needs a mesh from src/geom buildMesh');
  const byName = new Map(mesh.cells.map((c) => [c.name, c])), out = [];
  for (const node of mesh.scene.root.children) {
    const m = node.children[0], cell = byName.get(m.name);
    if (!cell) throw new Error(`batchesOf: mesh ${m.name} has no cell record`);
    const id = m.name.replace(/^\d[A-Z]+_(seam_)?/, '').replace(/_\d+$/, '');
    // for the road lines (app/preview/look.js): vertices across, their u, and each row's s (cells only, not seams)
    const pc = !cell.seam && mesh._state ? mesh._state.pieces[cell.piece] : null, c = pc ? pc.cells[Number(m.name.slice(m.name.lastIndexOf('_') + 1))] : null;
    out.push({ key: m.name, piece: cell.piece, seam: !!cell.seam, model: node.matrix, positions: m.positions, normals: m.normals, indices: m.indices,
      colour: colourOf(cell.piece, id, !!cell.seam), cols: pc ? pc.K : null, us: pc ? pc.Us : null, rowS: c ? c.rowS : null });
  }
  return out;
}

module.exports = { batchesOf, colourOf };
