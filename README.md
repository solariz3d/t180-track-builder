# T-180 Track Builder

A standalone, intuitive track builder for **Assetto Corsa**, for regular tracks and for **T-180** tracks (the
Speed Racer cars recreated at [ohyeah2389/Assetto-T-180](https://github.com/ohyeah2389/Assetto-T-180)). It is meant to
replace Blender for track making.

- **Write a track in a language.** Place pieces ("words": straights, sweeps, turns, climbs, wall-rides, jumps), restyle
  them in a *font* (half-pipe, bowl, flat banked ribbon) and a *tempo*, or sculpt freely.
- **See it turn red where a T-180 can't survive it,** measured against real replays and real working tracks, not
  guesses.
- **Preview how it will look in AC with CSP** before exporting. Geometry and textures are identical to the export, and
  the lighting gap is measured against real screenshots.
- **Export a working track directly:** no Blender, no ksEditor. Markers, grid, pits, timing, the T-180 soft-collision
  road, and an AI line.
- **It keeps learning** the language from good tracks on your PC.

## Status: v1 is being built, and it is the track only

**v1 scope, in the keeper's words:** *"the first thing I want it to be is simply the track, no environmental
elements."* So v1 has no terrain, scenery or props, only the road the user builds. The user builds it: the track grows
from its open end, like a coaster builder, one word or phrase at a time.

**No in-game testing has been done.** Every row below was judged from the code and its tests, with no Assetto Corsa
launch at any point. Whether AC loads, drives, times and renders these tracks as intended is unverified until someone
drives one.

**How to read the table.** It was judged against ARCHITECTURE §1–§6, §5b and §5c from the code on `main` at `aa4d565`
(D171–D174 landed there on 2026-09-27, after `59ff906`). Work that is on disk but not yet on `main` (the starter
phrasebook, texture packs, and the soak and bench scripts) is marked **built, landing pending**.
- **tested:** built, and a test file exercises it (named).
- **built:** the code exists (file named), with no test that exercises this item.
- **not yet:** what is missing.

Run the tests with `node --test --test-concurrency=4 "test/*.test.js" "app/test/*.test.js"` (dependency-free).

### §1 Principles

| item | status | where |
|---|---|---|
| The track is text; the mesh is derived | tested | `src/doc/serial.js` canonical text · `test/doc.test.js` |
| Identical where it can be: the preview draws the export's geometry | tested | `app/preview/trackmodel.js` from `src/geom` · `app/test/preview.test.js` |
| … lighting matched to AC+CSP, the gap measured | not yet | no look-match instrument (§5.3) |
| Guardrails, not gates: physics as colour while building | tested | `app/validate-ui/` · `app/test/validate-ui*.test.js` |
| One tool: place words, restyle them, sculpt | tested | `app/palette/`, `app/handles/` · `app/test/palette.test.js`, `app/test/handles*.test.js` |
| Stability and export reliability | tested | export self-test (kn5 read back) · `test/export_words.test.js`; the soak and bench scripts (`scripts/soak.js`, `scripts/bench.js`) are built, landing pending |

### §2 The language

| item | status | where |
|---|---|---|
| Words: straight, sweep, turn, tight, wall-ride, inversion, jump | tested | `src/doc/vocab.js`, `src/doc/document.js` · `test/doc.test.js` |
| A jump carries its landing ramp | tested | `src/doc/resolve.js` · `test/doc-jump.test.js` |
| Phrases: a saved word sequence | tested | `src/doc/document.js` `appendPhrase`, `src/doc/library.js` · `test/doc-library.test.js` |
| Starter phrasebook: spiral climb, bowl hairpin, S, Sakura's grammar | built, landing pending | `src/doc/phrasebook.js` · `test/phrasebook.test.js`; the palette registration is proposed to A |
| A phrase's "parameters exposed" | not yet | a phrase's words are sculpted one by one; no phrase-level handles |
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
| Rotation-minimising frames (double reflection), closing twist spread, explicit roll | tested | `src/geom/path.js` · `test/geom_path.test.js`, `test/geom_loop.test.js` |
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
| 1. Geometry and materials exactly what is exported | tested | `app/preview/trackmodel.js` builds the export's scene · `app/test/preview.test.js` |
| 2. The preview uses AC's shader set (`ksPerPixel`, `ksMultilayer` …) | not yet | the preview has its own lighting (`app/preview/look.js`, tested in `app/test/look.test.js`), not a port of AC's shaders |
| 3. The look-match instrument (screenshots vs renders, the difference tracked) | not yet | nothing built |
| 4. One-click "see it in Assetto" | not yet | no AC launch in v1 (the keeper, 2026-09-27: "No in game testing needed") |

### §5b Textures

| item | status | where |
|---|---|---|
| Texture slots per surface strip; fonts give defaults, words override | tested | `src/texture/slots.js`, `src/doc/textures.js` · `test/texture-set.test.js`, `test/doc-textures.test.js` |
| Automatic mapping (along by distance, across by width), with tiling handles | tested | `src/texture/mapping.js` · `test/texture-mapping.test.js` |
| Bring your own PNG or JPG, converted to DDS with mipmaps | tested | `src/texture/png.js`, `jpeg.js`, `dds.js` · `test/texture-image.test.js` |
| Warnings about what AC can't do (e.g. compressed normal maps) | tested | `src/texture/warnings.js` · `test/texture-set.test.js` |
| A texture maker: procedural layers, decals, every layer a parameter set | tested | `src/texmaker/`, `app/texmaker/` · `test/texmaker.test.js` |
| Materials mapped onto AC's shaders (`ksPerPixel`, `ksPerPixelNM`, `ksMultilayer`) | not yet | `ksPerPixel` only |
| Texture packs: save, share and import | built, landing pending | `src/doc/packs.js` · `test/doc-packs.test.js` |
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
| "Spawn here": launch AC at a marker | not yet | no AC launch in v1 |
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
  - `texture/`: §5b part 1.
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
