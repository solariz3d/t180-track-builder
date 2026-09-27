# Research 3: engineering the editor (2026-09-27)

A research agent's report on geometry, stack and data model. **(derivation)** marks the agent's own reasoning;
**(unverified)** marks claims it could not confirm at a primary source.

> The stack chapter below compares options. The keeper chose **the blackbox way**: a Tauri v2 standalone app with a
> hand-written WebGL renderer, reusing blackbox's kn5 renderer and replay tools. See `../ARCHITECTURE.md` §9.

## 1. Geometry
- **Frames:** use rotation-minimizing frames, not Frenet. Frenet frames are undefined where curvature is zero and flip
  where it changes sign ([Hanson & Ma TR425](https://legacy.cs.indiana.edu/ftp/techreports/TR425.pdf)).
  - **The double-reflection method** ([Wang et al. 2008](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/Computation-of-rotation-minimizing-frames.pdf)):
    4th-order accuracy, about 10 lines of code, run in f64.
  - three.js's `computeFrenetFrames` is actually parallel transport and spreads the closing twist
    ([Curve.js](https://raw.githubusercontent.com/mrdoob/three.js/dev/src/extras/core/Curve.js)). Copy that closing
    step.
  - **Roll:** store roll as its own curve φ(s) with smootherstep ramps.
  - **Heartline:** p_surface = p_heart − h·U(φ) ([NL2](https://nolimitscoaster.com/nolimits2/help/pages/editor.html)).
  - On a spiral, the transported frame drifts relative to world-up. Store roll relative to the frame, and show bank
    relative to gravity **(derivation)**.
- **Centerline: intrinsic pieces.** Each piece has a length, clothoid-ramped yaw and pitch curvature, and roll.
  Curvature matches at every joint, so G2 continuity comes by construction.
  - The same model appears in FVD ([openFVD](https://github.com/altlenny/openFVD), [KexEdit](https://github.com/dylanebert/KexEdit))
    and in ASAM OpenDRIVE's reference line ([spiral](https://publications.pages.asam.net/standards/ASAM_OpenDRIVE/ASAM_OpenDRIVE_Specification/latest/specification/09_geometries/09_04_spiral.html)).
  - 3D clothoids are integrated numerically (RK4 or quaternion steps, 0.25–1 m).
  - **Closure:** a connector piece from G1 Hermite clothoid fitting ([Bertolazzi & Frego](https://arxiv.org/abs/1209.0910),
    [Clothoids](https://github.com/ebertolazzi/Clothoids)), plus a Levenberg–Marquardt solve over user-freed
    parameters.
- **Cross-sections:** a 2D curve by its own arc length u, with a turning angle ψ(u). A half-pipe, a wall-ride and a
  tube are then one type, and the profile stays valid past vertical.
  - Interpolate profile parameters along the track, resampled to a fixed vertex count.
  - **Fold condition:** 1 − κ·(q·N) ≤ 0 **(derivation)**.
  - Self-intersection is checked with a BVH ([three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)).
- **Physics:** use the vector form f = v²κ·N − g_vec, projected on the surface frame, **per lateral line u**. v(s)
  comes from a speed profile or a point-mass lap simulation.
- **Tessellation:** Δs ≤ min(Δs_max, √(8·R_eff·ε), θ_max/κ_eff, φ_step/|φ′|), with κ_eff = κ/(1 − κ·q·N) at the worst
  profile vertex. Keep one Δs schedule so the mesh stays a clean grid.
- **Chunking:** cells of about 100–250 m × one material strip, each under 65,535 vertices
  ([kn5-converter](https://github.com/RaduMC/kn5-converter)). Cells are the unit of export, culling and incremental
  rebuild. Store vertices relative to the cell origin for precision (float32 has a ~2 mm step at 25 km).

## 2. Stack comparison (for reference)
| Option | Verdict |
|---|---|
| Tauri v2 + three.js + Rust core (WASM + native) | Recommended by the agent. **Mesh must never cross IPC during a drag**: WebView2 binary IPC measured at ~200 ms per 10 MB ([tauri#11915](https://github.com/tauri-apps/tauri/discussions/11915)). |
| Electron + three.js | A close second; larger installer. |
| Godot 4 | Viable; runtime gizmos must be built. The keeper is not keen. |
| Bevy | No editor; breaking changes each release. |
| Unity | Not the developer's stack. |

**Projects to study:**
- [KexEdit](https://github.com/dylanebert/KexEdit): a web FVD editor, the closest analogue
- [openFVD](https://github.com/altlenny/openFVD): GPLv3, study only
- [godot-road-generator](https://github.com/TheDuckCow/godot-road-generator)
- [Clothoids](https://github.com/ebertolazzi/Clothoids)

## 3. Data model
**What comparable editors store:**
- NL2: control points plus roll nodes
- FVD and KexEdit: sections defined by functions
- OpenDRIVE: primitives plus profiles along s
- Trackmania: blocks

**Recommendation:**
- The source of truth is an **ordered piece list** with stable IDs, types and intrinsic parameters, plus constraints
  (pins, closure, free parameters).
- **Incremental rebuild:** a piece's mesh depends only on its own parameters and its entry frame. Editing piece k
  rebuilds only its cells; the pieces after it get new transforms. Cache by a content hash.
- **Undo:** immutable snapshots with Immer-style patches ([Immer](https://immerjs.github.io/immer/patches/)). One drag
  is one transaction.
- **Determinism:**
  - canonical serialization with quantized integers and schema and generator versions
  - `libm` math, no FMA, fixed reduction order
  - a golden-hash test in CI
  - the quantized piece sequence doubles as a learning corpus

## 4. Risks
1. **AC physics and AI on walls, inversions and loops is unverified.** Test a tiny loop and half-pipe first.
2. **Total object and draw-call budgets for a 50 km track are unverified.**
3. **AC physics precision far from the origin.**
4. **The WebView2 IPC regression.**
5. **Closure and constraint UX** is the hardest work.
6. **WASM/native determinism drift.**
7. **GPL code** (FVD++) cannot be copied.
