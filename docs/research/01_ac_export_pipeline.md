# Research 1: the Assetto Corsa export pipeline (2026-09-27)

The question: can a standalone program write a working AC track directly, with no Blender and no ksEditor?

A research agent answered it by reading primary sources and cloned code (AcTools/Content Manager, moppius'
Blender exporter, AssettoServer, the CSP config repo and wiki). Community forum claims are marked as such.
**UNVERIFIED** marks what could not be confirmed.

**Short answer: yes.**
- kn5 is small, and two independent open-source writers exist to learn from.
- Several web tools already ship complete track folders, AI line included.
- The AI line is the weakest link: its binary layout is known, but no spec for the speed, gas and brake fields exists.

## 1. kn5 writers
| Writer | Notes | License |
|---|---|---|
| **AcTools / Content Manager**: `AcTools/Kn5File/Kn5Writer.cs`, `Kn5Basic.Save()` ([repo](https://github.com/gro-ove/actools/tree/master/AcTools/Kn5File)) | Full reader and writer in C#, including skinned meshes. Writes version 5. | Microsoft Public License (Ms-PL) |
| **moppius/blender-assetto-corsa-tools** ([repo](https://github.com/moppius/blender-assetto-corsa-tools)) | Python. Writes track kn5 directly and embeds textures. | GPL-3.0: reference only |
| LKOLA/blender-kn5-addon ([repo](https://github.com/LKOLA/blender-kn5-addon)) | Car-focused; textures referenced, not embedded. | MIT |
| leBluem/io_import_accsv ([repo](https://github.com/leBluem/io_import_accsv)) | "Experimental export to track KN5" | none found |
| 3DSimED (commercial) | AC export plugin ([release notes](https://www.sim-garage.co.uk/software-release/3dsimed-3-0w/)) | commercial |

**Byte layout** (AcTools and moppius agree):
1. **Header:** `sc6969`, then an int version (5); version 6 adds one extra int.
2. **Textures:** a count, then for each: active flag, name, length, and the **embedded** DDS or PNG bytes.
3. **Materials:** a count, then for each:
   - name and shader
   - blend mode (1 byte: 0 opaque, 1 alpha blend, 2 alpha-to-coverage)
   - alpha-tested (1 byte)
   - depth mode (int)
   - properties, each a name plus A (1 float), B (2), C (3) and D (4)
   - texture slots, each a slot name, slot number and texture name
4. **Nodes, depth-first:** class (1 node, 2 mesh, 3 skinned), name, child count, active flag.
   - **Class 1:** a 4×4 transform.
   - **Class 2 (mesh):** castShadows, visible and transparent flags; vertices (position, normal, UV, tangent: 11
     floats); **ushort indices**; material id; layer; lod in and out; bounding sphere; isRenderable.

**What a writer must get right:**
- **At most 65,536 vertices per mesh** (16-bit indices). Split larger meshes, as moppius does.
- **Y-up coordinates.** Blender's (x, y, z) becomes (x, z, −y). Flip V, use triangle winding (1, 2, 0), and write
  matrices transposed.
- **Mesh nodes cannot have children.** Every mesh needs a material and must be triangulated, with normals and tangents.
- **Unknown empties** may block loading, so only emit `AC_*` markers and groups that contain meshes.
- **`ksPerPixel` defaults:** `ksDiffuse` and `ksAmbient` 0.4, texture slot `txDiffuse`. Full per-shader property sets
  are UNVERIFIED.
- **Physics-only or simply textured kn5 files work without ksEditor.** Set `isRenderable=false` on physics-only
  meshes. TrackTracer, RacetrackDesign and TreCorsa already ship kn5 this way.
- **DDS is preferred,** up to 8192². Compressed normal maps are not supported
  ([FAQ](https://assettocorsamods.net/threads/faq-track-modding-faq.7/)).

## 2. The track folder
Sources: [basic guide](https://assettocorsamods.net/threads/build-your-first-track-basic-guide.12/),
[layouts](https://assettocorsamods.net/threads/track-layouts-how-to.364/).

**Naming:** the folder and the main kn5 share one lowercase id. Ids use `[a-z0-9_]`, at most 32 characters; layout
names at most 15.

**Needed to load:**
- **`<id>.kn5`**
- **`models.ini`** when there are several kn5 files or layouts: `[MODEL_n] FILE= POSITION= ROTATION=`.
  - For layouts: `models_<layout>.ini`, a `<layout>/data`, `<layout>/ai` and `ui/<layout>/`.
- **`ui/ui_track.json`**: `name, description, tags, geotags, country, city, length, width, pitboxes, run, year,
  author, url, version`.
- **`data/surfaces.ini`** only for custom surfaces. ROAD, GRASS, KERB, SAND and WALL are built in.

**Optional:**
- `ui/preview.png` and `outline.png`
- `map.png` + `data/map.ini`: Content Manager's `TrackMapRenderer.cs` formula, drawn from `?ROAD` meshes
- `ai/fast_lane.ai` and `pit_lane.ai`
- `data/cameras*.ini`, `groove.ini`, `crew.ini`, `audio_sources.ini`, `lighting.ini` (formats UNVERIFIED)
- `extension/ext_config.ini`, read only by CSP

**Surface fields:** `KEY FRICTION DAMPING WAV WAV_PITCH FF_EFFECT DIRT_ADDITIVE IS_VALID_TRACK BLACK_FLAG_TIME
SIN_HEIGHT SIN_LENGTH IS_PITLANE VIBRATION_GAIN VIBRATION_LENGTH`.

## 3. Markers and physics meshes
- **Markers:**
  - `AC_START_n` and `AC_PIT_n`, numbered 1, 2, 3 (never 01)
  - `AC_HOTLAP_START_0`
  - `AC_TIME_0_L/R` for start/finish; `AC_TIME_1/2` for sectors
  - point to point: `AC_AB_START/FINISH_L/R`
  - also `AC_CREW_n`, `AC_AUDIO_*`, `AC_POBJECT_*`
- **Marker placement:** Y up, Z forward, 1–2 m above the surface. **Swapped L/R gates silently stop lap counting.**
  The start line must be ahead of the spawns.
  - CSP `FIX_SPAWN_POINTS` repairs spawns (offline, custom physics).
- **Physics meshes:** named `<digit><KEY>…` (`1ROAD`, `1KERB`, `1WALL`). A leading 0 or no digit means visual only.
  Materials don't affect physics.
- **Best practice:**
  - road, kerb and grass meshes touching, with no gaps or overlaps
  - simple, non-renderable walls
  - low-poly collision
  - collidable trees can halve FPS
- **Limits (community FAQ):** physics space is about ±8 km, and jitter starts roughly 20 km from the origin. About 3M
  vertices per track is known to work.

## 4. The AI line: `fast_lane.ai` version 7
Sources: AcTools `AcTools/AiFile/*`; AssettoServer `FastLaneParser.cs` (AGPL-3.0).

**Layout:**
1. **Header:** version=7, pointCount, lapTime, sampleCount.
2. **Points:** for each, position (3 floats), length (float) and id (int).
3. **Extra:** extraCount, equal to pointCount. Each entry has 18 floats: speed, gas, brake, obsoleteLatG, radius,
   sideLeft, sideRight, camber, direction, normal (3), length, forward (3), tag, grade.
4. **Grid:** hasGrid (int); write 0.

**Generation:**
- TreCorsa, TrackTracer and RacetrackDesign claim to generate AI lines.
- CSP rebuilds its own grid.
- **UNVERIFIED:** whether AC recomputes speed, gas and brake, or needs good values from us.
- **Normal practice:** record in-game with `ENABLE_DEV_APPS=1`, which writes `fast_lane.ai.candidate`.

## 5. CSP for extreme speed
- **Extended physics:** `[SURFACE_0] WAV_PITCH=extended-0`. This makes the track **CSP-only**; unmodified AC crashes
  on it. Online servers check `surfaces.ini` integrity.
- **`[_EXTENSION]`:** `RIGID_FLOOR_COLLISIONS`, `RIGID_WALLS_COLLISIONS` and `RIGID_DIRT_COLLISIONS` (described as
  helpful "with cars falling through ground"), `GRAVITY` (offline only), `ALIGNED_CARS_POSITIONING`, `PIT_ALTITUDE`.
  Also `[WEATHER_FX]`.
- **`[COLLISION_PARAMS_...]`:** `MESHES COLLIDERS SOFT_ERP SOFT_CFM BOUNCE FRICTION INTENSITY MAX_DEPTH
  RIGID_WITH_BODIES RIGID_WITH_BOXES`
  ([wiki](https://github.com/ac-custom-shaders-patch/acc-extension-config/wiki/Tracks-%E2%80%93-Collision-parameters)).
- **User-side settings:**
  - `EXTEND_COLLIDER_BOXES` ("prevents cars from falling through the ground … when falling fast")
  - `FIX_GROUND_COLLIDERS`
  - Embree raycasting with `INTEL_EMBREE_ROBUST` ("car falls through the ground on triangle edges")
  - double-precision physics and `ORIGIN_SHIFT` for large tracks
- **Physics rate:** about 333 Hz (UNVERIFIED).

## 6. How existing tools export
- **Race Track Builder:** FBX, then ksEditor, then kn5; fails on 16384 textures.
- **Bob's Track Builder:** FBX, then ksEditor (UNVERIFIED).
- **3DSimED:** writes kn5 directly.
- **TrackTracer, RacetrackDesign, TreCorsa:** web tools writing kn5 directly. These are the closest competitors.

## What our exporter must do
1. Write kn5 v5 ourselves, under 200 lines, with AcTools as the byte reference. No GPL code.
2. Split meshes to at most 65,536 vertices. Triangulate, compute normals and tangents, and give every mesh a material.
3. Emit `<digit><KEY>` physics meshes, plus separate visual meshes where wanted. Keep walls simple and the track within
   ±8 km.
4. Emit markers as class-1 nodes. Validate L/R gate order, the start line ahead of the grid, and the pit count.
5. Write `models*.ini`, `surfaces.ini`, `ui_track.json` (with `pitboxes` = the `AC_PIT` count), `preview.png`,
   `outline.png`, `map.png` and `map.ini`.
6. Generate `fast_lane.ai` v7 with `hasGrid=0`. **The first milestone checks whether AC accepts it.**
7. Enforce the id rules.
8. Offer CSP extended physics as an opt-in, with a CSP-only warning.
9. Self-test by reading every export back.
