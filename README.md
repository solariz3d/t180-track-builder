# T-180 Track Builder

A standalone, intuitive track builder for **Assetto Corsa**, for regular tracks and for **T-180** tracks (the
Speed Racer cars recreated at [ohyeah2389/Assetto-T-180](https://github.com/ohyeah2389/Assetto-T-180)). It is meant to
replace Blender for track making.

- **Write a track in a language.** Place pieces ("words": straights, sweeps, turns, climbs, wall-rides, jumps), restyle
  them in a *font* (half-pipe, bowl, flat banked ribbon) and a *tempo*, or sculpt freely.
- **See it turn red where a T-180 can't survive it,** measured against real replays and real working tracks, not
  guesses.
- **Preview how it will look in AC with CSP** before exporting. Geometry and materials are the export's own (the painted
  start and grid boxes are not drawn yet), and fixed reference views are ready for measuring the lighting gap against
  real screenshots.
- **Export a working track directly:** no Blender, no ksEditor. Markers, grid, pits, timing, the T-180 soft-collision
  road, and an AI line.
- **It keeps learning** the language from good tracks on your PC.

## Install

**0.2.1** is the current release (0.2.0 was the first): a Windows installer,
`T-180 Track Builder_0.2.1_x64-setup.exe`. It installs for the current user, with no administrator rights. It is not
code-signed, so Windows SmartScreen warns about an unknown publisher the first time. To build the installer yourself: `node src-tauri/release.cjs` (it needs Rust and `tauri-cli`
2; see `docs/RELEASE.md`). What changed, release by release, is in `CHANGELOG.md`.

Your tracks, pieces, autosave and settings live in your own app-data folder
(`%APPDATA%\com.solariz3d.t180-track-builder`), never in the program's folder, and uninstalling leaves them in place.

## Status: 0.2.1, and it is the track only

**v1 scope, in the author's words:** *"the first thing I want it to be is simply the track, no environmental
elements."* So v1 has no terrain, scenery or props, only the road the user builds. The user builds it: the track grows
from its open end, like a coaster builder, one word or phrase at a time.

**No in-game testing has been done.** Every row below was judged from the code and its tests, with no Assetto Corsa
launch at any point. Whether AC loads, drives, times and renders these tracks as intended is unverified until someone
drives one.

**How to read the table.** It judges every item of ARCHITECTURE §1–§6, §5b and §5c against the code of the 0.2.1
release (2026-09-27), including the installed app: the release installer was installed into a throwaway folder,
started, and used for a first track, following the guide (a starter phrase, one word with a handle dragged, closing
the loop, saving under a name) before it was uninstalled. The Export button's folder dialog was opened there but not
answered, so the export was checked headless (app/test/export.test.js), not in the installed window.
- **tested:** built, and a test file exercises it (named).
- **built:** the code exists (file named), with no test that exercises this item.
- **not yet:** what is missing.

Run the tests with `node --test --test-concurrency=4 "test/*.test.js" "app/test/*.test.js"` (dependency-free).

### §1 Principles

| item | status | where |
|---|---|---|
| The track is text; the mesh is derived | tested | `src/doc/serial.js` canonical text · `test/doc.test.js` |
| Identical where it can be: the preview draws the export's geometry | tested | `app/preview/trackmodel.js` from `src/geom` · `app/test/preview.test.js` |
| … lighting matched to AC+CSP, the gap measured | not yet | the look-match instrument is built (`src/lookmatch/`, `scripts/lookmatch.js` · `test/lookmatch.test.js`), but no reference shots from AC exist yet, so the gap is not measured |
| Guardrails, not gates: physics as colour while building | tested | `app/validate-ui/` · `app/test/validate-ui*.test.js` |
| One tool: place words, restyle them, sculpt | tested | `app/palette/`, `app/handles/` · `app/test/palette.test.js`, `app/test/handles*.test.js` |
| A guided first track for new users (five skippable steps; the user makes every move) | tested | `app/onboarding/` · `app/test/onboarding.test.js` |
| The app works in its real window, not only headless (timers as strict as a browser's) | tested | `app/shell.js` · `app/test/timers-regression.test.js` |
| Stability and export reliability | tested | export self-test (kn5 read back) · `test/export_words.test.js`; the soak and bench scripts (`scripts/soak.js`, `scripts/bench.js`) · `test/perf.test.js`, `test/perf_soak.test.js` |

### §2 The language

| item | status | where |
|---|---|---|
| Words: straight, sweep, turn, tight, wall-ride, inversion, jump | tested | `src/doc/vocab.js`, `src/doc/document.js` · `test/doc.test.js` |
| A jump carries its landing ramp | tested | `src/doc/resolve.js` · `test/doc-jump.test.js` |
| Phrases: a saved word sequence | tested | `src/doc/document.js` `appendPhrase`, `src/doc/library.js` · `test/doc-library.test.js` |
| Starter phrasebook: spiral climb, bowl hairpin, S, Sakura's grammar | tested | `src/doc/phrasebook.js` · `test/phrasebook.test.js`; listed in the palette under "Starter phrases" (`src/doc/library.js`, `app/palette/palette.js`) |
| A phrase's "parameters exposed" | not yet | no phrase-level handles. The document can sculpt a phrase's words one by one (`editPhraseWord` in `src/doc/document.js`), but the app cannot yet: a placed starter phrase has no handles in the handles panel, which says so |
| Fonts: half-pipe, bowl, flat banked ribbon, wall-ride, tube (ψ(u) past vertical) | tested | `src/doc/vocab.js`, `src/geom/profile.js` · `test/geom_path.test.js`, `test/geom_mesh.test.js` |
| Tempos: standard, aurora, serpents | tested | `src/doc/vocab.js` · `test/doc.test.js` |
| Handles, bounded live by physics | tested | `src/validate/bounds.js`, `app/handles/` · `test/validate_bounds.test.js`, `app/test/handles*.test.js` |
| Document: stable ids, canonical serialisation, schema and generator versions | tested | `src/doc/serial.js` · `test/doc.test.js` |
| Undo as history; a whole drag is one entry | tested | `src/doc/history.js` · `test/doc.test.js`, `app/test/handles-panel.test.js` |
| Constraints: pins, free parameters | built | `src/doc/document.js` (`constraints` is carried, nothing uses it yet) |
| Closing the loop: a connector ranked by physics margin | tested | `src/doc/connector.js` · `test/doc-connector.test.js` |

### §3 Geometry

| item | status | where |
|---|---|---|
| Frames: the curve model's yaw-and-pitch (gravity) frame plus the explicit roll. A DEVIATION from §3's "rotation-minimising frames", made on 2026-09-27; the reason and what changes are recorded in `docs/INTERFACES.md` §2 | tested | `src/geom/path.js` · `test/geom_path.test.js`, `test/geom_loop.test.js` |
| Bank relative to gravity shown to the user | not yet | computed (`bankG` in `src/geom/path.js`), not shown in the app |
| Fold check, 1 − κ·(q·N) ≤ 0, on every profile vertex | tested | `src/geom/mesh.js` · `test/geom_mesh.test.js`, `test/validate.test.js` |
| Self-intersection between non-adjacent cells (BVH) | tested | `src/geom/bvh.js` · `test/geom_bvh.test.js` |
| Adaptive mesh by chord error and max seam angle (1° default) | tested | `src/geom/mesh.js` · `test/geom_mesh.test.js` |
| Cells under 65,536 vertices, relative to the cell origin | tested | `src/geom/mesh.js` · `test/geom_mesh.test.js` |
| Editing a word rebuilds only its cells | tested | `src/geom/mesh.js` `sculptMesh`, `extendMesh` · `test/geom_sculpt.test.js`, `test/geom_grow.test.js`, `test/join.test.js` |
| Font transitions ramp, never jump | tested | `src/geom/mesh.js`, `src/doc/resolve.js` · `test/geom_ramp.test.js` |

### §4 Validation

| item | status | where |
|---|---|---|
| The specific force per lateral line, from a design speed or the lap sim | tested | `src/validate/index.js` · `test/validate.test.js`, `test/validate_speed.test.js` |
| Design speed and acceleration measured from replays | tested | `docs/FINDINGS.md` §3d, `tools/speed.cjs`, `src/validate/limits.js` · `test/validate_speed.test.js` |
| The 20 g suspension stop and the proven 90 g | tested | `src/validate/limits.js` · `test/validate.test.js` |
| … per car, from its open config | not yet | one car (the Mach 6) in `src/validate/limits.js` |
| Jump check: two landings (3.2 g, 6.3 g), minimum speed, reachable | tested | `src/validate/jumps.js` · `test/validate_jumps.test.js`, `test/validate_head.test.js` |
| Red: holes or gaps in the road; a head in the air | tested | `src/validate/index.js` · `test/validate.test.js`, `test/validate_head.test.js` |
| Red: a missing soft-collision block | tested | `src/validate/index.js` · `test/validate.test.js` |
| Red: folds and self-intersection | tested | `src/validate/index.js`, `src/geom/bvh.js` · `test/validate.test.js`, `test/geom_bvh.test.js` |
| Red: drivable surfaces stacked within about 2 m | tested | `src/validate/index.js` · `test/validate.test.js`, `test/validate_incremental.test.js` |
| Red: wall-rides built from WALL objects | tested | `src/validate/index.js` · `test/validate.test.js` |
| Red: surfaces above ~50° without CSP's raycasting | tested | `src/validate/index.js` · `test/validate.test.js`, `test/validate_bounds.test.js` |
| Full-lap proof before export | tested | `src/validate/index.js`, `src/export/fromwords.js` · `test/validate_speed.test.js`, `test/export_words.test.js` |
| Feedback: colour per word | tested | `app/preview/batches.js` · `app/test/preview.test.js` |
| Feedback: red and amber on the track in the preview | not yet | shown in the validation panel (list and load graph); the preview does not paint it on the road |
| Feedback: a force graph, a lap summary | tested | `app/validate-ui/graph.js`, `app/validate-ui/panel.js` · `app/test/validate-ui-jumps.test.js` |

### §5 The look

| item | status | where |
|---|---|---|
| 1. Geometry and materials exactly what is exported | tested, with two gaps | `app/preview/trackmodel.js` builds the export's scene · `app/test/aclook.test.js`: every mesh the preview draws has the export's name and material, but the painted start line, grid and pit boxes and the closing seam are not drawn yet (a visible todo) |
| 2. The preview uses AC's shader set (`ksPerPixel`, `ksMultilayer` …) | tested | `app/preview/acshaders.js`, `app/preview/aclook.js`: `ksPerPixel` and `ksPerPixelNM` ported from Content Manager's Custom Showroom (Ms-PL, licence in `app/preview/`), under one stated reference light; the `ksMultilayer` layer blend is inferred, not verified against AC · `app/test/aclook.test.js`. **L** switches back to a colour per placed word |
| 3. The look-match instrument (screenshots vs renders, the difference tracked) | built, number not yet measured | `src/lookmatch/` (fixed reference views, a render in the preview's look, the difference as mean CIEDE2000), `scripts/lookmatch.js` · `test/lookmatch.test.js`. No reference shots from AC yet, so no difference is tracked |
| 4. One-click "see it in Assetto" | tested, with the game launch mocked | `src-tauri/src/ac.rs` (its tests use a mock launcher), `app/install/` · `app/test/share-install.test.js`: built, OFF by default, and never run (the author, for v1: "No in game testing needed") |

### §5b Textures

| item | status | where |
|---|---|---|
| Texture slots per surface strip; fonts give defaults, words override | tested | `src/texture/slots.js`, `src/doc/textures.js`, the textures panel in the side panel (`app/texture/`) · `test/texture-set.test.js`, `test/doc-textures.test.js` |
| … drawn by the preview and written by the export alike (a textured floor) | tested | `src/texture/set.js` `withTextureSet`, `app/preview/aclook.js` · `test/export-textures.test.js`, `app/test/export.test.js`. Only the FLOOR slot reaches the road mesh yet: walls, lines, kerbs and edge glow are stored in the document but not yet split onto their own strips of the mesh, so neither the preview nor the export draws them |
| Automatic mapping (along by distance, across by width), with tiling handles | built, not yet used | `src/texture/mapping.js` · `test/texture-mapping.test.js` tests the mapping itself, but the road mesh still maps textures along its centreline (`src/geom/mesh.js`), so the tiling handles are stored and not yet applied |
| Bring your own PNG or JPG, converted to DDS with mipmaps | tested | `src/texture/png.js`, `jpeg.js`, `dds.js` · `test/texture-image.test.js` |
| Warnings about what AC can't do (e.g. compressed normal maps) | tested | `src/texture/warnings.js` · `test/texture-set.test.js` |
| A texture maker: procedural layers, decals, every layer a parameter set | tested | `src/texmaker/`, `app/texmaker/` · `test/texmaker.test.js` |
| Materials mapped onto AC's shaders (`ksPerPixel`, `ksPerPixelNM`, `ksMultilayer`) | not yet | the preview draws all three (§5 row 2); the export writes `ksPerPixel` materials only |
| Texture packs: save, share and import | tested | `src/doc/packs.js` · `test/doc-packs.test.js` |
| Budget: texture memory and resolution per track | tested | `src/texture/set.js`, `app/texture/` · `app/test/texture-panel.test.js` |

### §5c Spawns, pits and timing

| item | status | where |
|---|---|---|
| Markers in track coordinates (stay on the road through edits, on banks and walls) | tested | `src/markers/place.js`, `layout.js` · `test/markers_track.test.js` |
| Race grid: patterns, spacing, count, slot by slot, numbered from pole | tested | `src/markers/layout.js`, `app/markers/` · `test/markers_track.test.js`, `app/test/markers-panel.test.js` |
| Pit boxes; `pitboxes` from the real count | tested | `src/markers/`, `src/export/trackfiles.js` · `test/markers_export.test.js`, `test/export_words.test.js` |
| The pit lane: a side road leaving and rejoining | tested | `src/geom/pitlane.js`, `src/doc/pitlane.js`, `src/export/pitlane.js` · `test/geom-pitlane.test.js`, `test/doc-pitlane.test.js`, boxes along a lane `test/markers_lane.test.js` |
| Hotlap start: a run-up to the design speed | tested | `src/markers/layout.js` `runUpM` · `test/markers_track.test.js` |
| Timing gates `AC_TIME_0_L/R`, sectors 1 and 2 | tested | `src/markers/layout.js` · `test/markers_track.test.js`, `test/markers_export.test.js` |
| The red checks before export (start ahead of grid, L/R, height and heading, slots, pit count) | tested | `src/markers/checks.js`, `src/export/markers.js` · `test/markers_track.test.js`, `test/markers.test.js` |
| "Spawn here": launch AC at a marker | not yet | "See it in Assetto" (off by default, never run) sets only the track, so AC starts wherever its session puts the car; choosing a marker is not built |
| Paint: start/finish line (wall to wall), grid boxes, pit boxes | tested | `src/markers/paint.js` (surface meshes) · `test/markers_track.test.js`, `test/markers_export.test.js` |
| … as texture layers (§5b), with grid numbers and the pit lane's entry and exit lines | not yet | paint is geometry; texture layers exist now (§5b) but do not carry the marks yet |
| Race furniture: gantry, lights, sector boards | not yet | nothing built; working start lights are a parked idea |

### §6 Export

| item | status | where |
|---|---|---|
| kn5 version 5 written directly (Y-up, flipped V, winding) | tested | `src/export/kn5write.js`, `scene.js` · `test/kn5write.test.js` |
| Physics meshes named `<digit><KEY>`; visual meshes non-physics | tested | `src/geom/mesh.js`, `src/markers/paint.js` · `test/kn5write.test.js`, `test/markers_export.test.js` |
| Markers as nodes, L/R order validated | tested | `src/markers/`, `src/export/markers.js` · `test/markers.test.js`, `test/export_words.test.js` |
| `models.ini` | tested | `src/export/trackfiles.js` · `test/trackfiles.test.js` |
| `models_<layout>.ini` (layouts) | tested | `src/export/layouts.js` · `test/export-layouts.test.js` |
| `data/surfaces.ini` with the T-180 soft-collision block as a toggle | tested | `src/export/trackfiles.js` · `test/trackfiles.test.js`, `test/export_words.test.js` |
| CSP's `WAV_PITCH=extended-0` opt-in | not yet | not written |
| `ui/ui_track.json`, `preview.png`, `outline.png`, `map.png`, `data/map.ini` | tested | `src/export/trackfiles.js` · `test/trackfiles.test.js` |
| AI line `ai/fast_lane.ai` v7 | tested | `src/export/ailine.js` · `test/ailine.test.js` (that AC accepts generated speed fields is unverified) |
| Self-test: read every kn5 back with our own reader | tested | `src/export/fromwords.js` · `test/export_words.test.js` |
| … and with AcTools' reader | not yet | own reader only |
| Size: keep the track near the origin; measure the ~20 km limit | not yet | not measured |
| Export from words, one folder per variant, refusing any red | tested | `src/export/fromwords.js`, `scripts/export_words.js`, `app/export/` · `test/export_words.test.js`, `app/test/export.test.js` |

## What's here
- **`src/`:** the program.
  - `doc/`: the document, the words, phrases and library.
  - `geom/`: paths, profiles, meshes, the BVH.
  - `validate/`: loads, jumps, the reds and ambers, handle bounds.
  - `markers/`: §5c.
  - `texture/`: §5b: slots, mapping, PNG/JPG to DDS, packs, the texture set the preview and the export share.
  - `texmaker/`: §5b, the procedural texture maker (a texture as text).
  - `export/`: kn5, the track files, the AI line.
- **`app/`:** the Tauri v2 desktop app around the build head: palette, preview, cameras, validation, handles, markers,
  textures. See `app/README.md`.
- **`docs/FINDINGS.md`:** everything measured so far, with the command that reproduces each number.
  - the shape language of 11 T-180 tracks
  - the mesh envelope proven tracks drive on
  - real loads from replays, and where a T-180's suspension runs out
  - visual versus physics clipping, and the soft-collision block every working T-180 track shares
  - the whole library read as text: 12 layouts, ~241 km, laps verified against 5 replays
  - jump flights; how fast and how hard the car accelerates
  - Wrong turns are kept and marked, not deleted.
- **`src-tauri/`:** the native side of the app (file access, Install to AC, the launch that is off by default) and
  `release.cjs`, which builds the installer.
- **`docs/RELEASE.md`:** how the installer is built, what is in it, and what it does not do.
- **`docs/ARCHITECTURE.md`:** the plan.
  - the language as data model; geometry; validation
  - the AC+CSP look-match; textures; spawns, pits and timing
  - export; learning; environment; stack
  - first milestones and open gaps
- **`docs/research/`:** three source-cited research reports: the AC export pipeline, how track and coaster builders
  are designed, and the editor's engineering.
- **`tools/`:** the dependency-free Node tools that produced the findings. Run them from `tools/`. They read your
  installed AC tracks, and the replay tools use [blackbox](https://github.com/solariz3d)'s parser at
  `%USERPROFILE%\blackbox`.
  - `kn5.cjs`: reads AC models
  - `read_track.cjs`: reads any track into words, e.g. `node read_track.cjs "<AC>\content\tracks\sakura_speedway"
    21768 28.7 > sakura.read.json`
  - `study.cjs`, `envelope.cjs`: shape language and mesh envelope
  - `loads.cjs`, `bottoming.cjs`, `boxdepth.cjs`, `jump_flight.cjs`, `speed.cjs`: from replays
  - `topdown.cjs`: draws a reading over the track
- **`results/`:** small result files and two full-lap maps.

## Credits
Built on the work of the T-180 community: the car and test-track author ohyeah2389, and the authors of every track
studied here (Sakura Speedway and Rainbow Road above all). Their tracks are read locally for measurement only; none of
their content is included in this repo.
