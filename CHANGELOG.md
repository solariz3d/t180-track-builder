# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project has no releases yet; everything below is under
**Unreleased**.

## [Unreleased]

### Added

- **Milestone 1, the platform test track, written directly as AC files** (`docs/ARCHITECTURE.md` §10.1). Three packets
  build to one shared scene shape (`src/export/scene.js`), so each part could be written and tested on its own.
- `src/export/scene.js` and `src/export/kn5write.js` (packet A).
  - `validateScene(scene)` refuses anything outside the shared shape, with a coded `SceneError`.
  - `writeKn5(scene)` writes a kn5 version 5 directly, with AcTools' `Kn5Writer.cs` as the byte reference. The track
    reads back through the repo's own `tools/kn5.cjs`.
  - The writer stores V as `1 − v`.
  - Triangle winding is kept as given: measured CCW-from-outside on the two reference tracks it checked.
  - It refuses meshes over 65,535 vertices or with no triangles.
  - Tests: `test/kn5write.test.js`.
- `scripts/platform_test.js` (packet C). It builds the 500 m test loop the milestone names as a scene: a half-pipe
  turn, a wall-ride turn whose outside wall passes vertical (110°), and one small jump sized by `docs/FINDINGS.md`
  §7d-e / §8 to hold at both the 3.2 g and the 6.3 g landing. It adds the race markers and `1ROAD` physics meshes.
  - The loop closes by construction (500.000 m, and the end is 2.52e-12 m from the start).
  - Every cell stays under 65,536 vertices.
  - Tests: `test/platform_test.test.js`.
- `src/export/markers.js` (packet E). These are the §5c "red if wrong" checks, run before anything is written:
  - the start line is ahead of the grid, and the grid is numbered from pole;
  - the L and R timing gates are the right way round;
  - every marker is 1–2 m above the road and points along it;
  - no marker is inside another car's slot or off the road;
  - the pit count matches.

  Why: swapped gates or a grid past the line break a track silently in AC. **The left/right and race-direction
  conventions were measured** on the five reference tracks installed locally, not assumed.
- `src/export/trackfiles.js` (packet E) writes every non-kn5 file of a track folder:
  - `data/surfaces.ini`, with or without the T-180 soft-collision block of FINDINGS §4c;
  - `models.ini`;
  - `ui/ui_track.json`, whose `pitboxes` is counted from the `AC_PIT_n` markers and never typed;
  - `ui/preview.png`, `ui/outline.png`, `map.png` and `data/map.ini`. The map follows Content Manager's formula, from
    AcTools' `TrackMapRenderer.cs`, so AC's map app lines up.

  The PNGs are encoded with no dependency beyond node's zlib.
- `scripts/build_platform_test.js` (packet E) glues the scene, the kn5 writer and the track files into two installable
  folders:
  - `t180b_platform_test`, WITH the soft-collision block;
  - `t180b_platform_test_noblock`, WITHOUT it.

  Why two folders rather than two layouts: the registered soft-road prediction needs the block read. Every working
  T-180 track keeps it in the root `data/surfaces.ini`, and whether CSP reads it from a layout's folder is unverified.
  Both folders carry the identical kn5, checked by sha256.
  - `--install` copies them into `content/tracks/`. It only ever writes `t180b_*` folders, refuses a folder it did not
    create (a `.t180b-builder.json` marker tells), and deletes nothing.
- Tests: `test/markers.test.js`, `test/trackfiles.test.js` (node's built-in runner, no dependencies).
- `CHANGELOG.md` (this file).
- `src/export/ailine.js` (packet A, milestone 2). It generates `ai/fast_lane.ai` (version 7, hasGrid 0) from the
  track's centreline, with a constant 300 km/h speed profile.
  - The line climbs the outside walls to their balance angle: about 87° on the wall-ride, capped at 50° on the
    half-pipe. `--ai-mode floor` keeps it on the floor as a control.
  - The layout was checked against every AI line in a local install. Which fields are filled, and why, is written in
    the file.
  - Tests: `test/ailine.test.js` (round trip, header, closure and length, the wall angles, the jump crossing, and
    refusals).
- `scripts/roundtrip.js` (packet C, milestone 3, first half). It writes the platform test as a kn5, reads it back with
  `tools/read_track.cjs`, and compares the result with the words it was built from. The quantities are width, tilt
  run, curvature, turn angle, grade, lap length and the word sequence, each against a tolerance stated before the first
  run.
  - Tests: `test/roundtrip.test.js` runs the round-trip on the generated scene, and on three perturbed tracks that must
    fail it (wall-ride at 80°, half-pipe at 20°, flat straights as half-pipes).
  - Six rows outside tolerance are `todo`, pending a reader fix: `tools/read_track.cjs` holds its heading ~30° off the
    road on a straight of constant width after a turn. The width then reads high (32 for 27) and the walked distance
    low (a 500 m lap returns at 475 m). Not fixed yet.
- **The program itself begins: a track is written in words, and the user builds it** (`docs/ARCHITECTURE.md` §1–§4).
  No game launch is part of building or testing.
- `docs/INTERFACES.md`: the shapes passed between the document model, the geometry core, validation and export. Every
  field cites the ARCHITECTURE line it comes from.
  - It covers the build head (the user grows an open track from its end), sculpting and the user's own pieces, and the
    camera contract for the app.
  - Why: the three parts are built in parallel, and a shape agreed in one file is what lets them meet.
- `src/doc/` (ARCHITECTURE §2): the document model. A track is text: ordered words (straight, sweep, turn, tight,
  wall-ride, inversion, jump) with fonts, tempos, handles and stable ids.
  - The text is a canonical, quantised serialisation, with a schema version and a generator version. Other schemas are
    refused by name.
  - Undo is immutable history, and a whole drag is one entry.
  - `resolve(doc)` turns the document into the explicit clothoid segments the geometry builds from. It solves each
    jump's flight to its gap, drop and landing pitch. `resolveFrom` re-resolves only from the first changed word.
  - Tests: `test/doc.test.js`, `test/doc-geom.test.js`.
- Sculpting and the piece library (`src/doc/library.js`). Every placed piece is sculptable through its handles, now
  including the wall's height, and each edit is one undo step.
  - The library holds the built-in words and the user's own named pieces: one sculpted piece, or a run of them.
  - A piece exports and imports as text, byte-exact. A name that is a built-in or already taken is refused.
  - Tests: `test/doc-library.test.js`.
- `src/geom/` (ARCHITECTURE §3): the geometry core.
  - Clothoid words in heading and pitch.
  - Rotation-minimising frames by double reflection (Wang, Jüttler, Zheng & Liu, ACM TOG 27(1), 2008), with the
    closing twist spread along a closed loop.
  - Explicit roll, the heartline, and bank relative to gravity.
  - Cross-sections as a turning angle ψ(u) that works past vertical.
  - `buildMesh`: an adaptive step by chord error, seam angle and maximum step on every profile vertex, and cells under
    65,536 vertices. Its output is the export's scene shape, written unchanged by `src/export/kn5write.js`.
  - The 1 − κ·(q·N) fold check.
  - Tests: `test/geom_path.test.js`, `test/geom_mesh.test.js`, `test/geom_mutation.test.js`.
- Growing from the open end (`extendPath`, `extendMesh`) and sculpting (`rebuildPathFrom`, `sculptMesh`).
  - Only the new or edited piece and its seams are rebuilt. Later pieces are re-placed, not remeshed, unless their
    start pitch or bank changed.
  - The result equals a full rebuild. The cost of an append does not grow with the track (operation counts at 385 m,
    3.5 km and 14 km).
  - `headCamera` gives the build view the open end's frame.
  - Tests: `test/geom_grow.test.js`, `test/geom_sculpt.test.js`.
- `src/validate/` (ARCHITECTURE §4): validation from the measured data.
  - For every station and every lateral line it computes the specific force, and projects it into, across and along
    the surface.
  - Red is for known breakage: gaps, folds, stacked roads, a missing soft-collision block, wall-rides built from WALL,
    and steep surfaces without CSP.
  - Amber is for loads above the proven 90 g and seams past the proven envelope. The 20 g suspension stop is shown as
    information.
  - The jump check shows two landings, at the measured 3.2 g and 6.3 g falls, with the minimum take-off speed and the
    reach bound.
  - A point-mass lap proof runs on closed tracks.
  - Every limit carries its FINDINGS line, and the withdrawn 60 g red line is deliberately absent.
  - Tests: `test/validate.test.js`, `test/validate_jumps.test.js`.
- `test/join.test.js`: the join between the document and the geometry when the user builds. Appending at the head and
  sculpting a placed word must equal a full rebuild: the path exactly, and the mesh byte-identical after an append and
  within 1e-5 m after a sculpt.
- `package.json` with one script: `npm test` runs `node --test "test/*.test.js"`, exactly the test suite.
  - A bare `node --test` also runs `scripts/*_test.js` as tests, because Node's default glob includes `*_test.js`.
  - `node --test test/` does not work on Node 24: it treats the folder as a file.
- **Fonts ramp, never jump.** Every road word carries a transition length (`ramp`, default 20 m, never below 1 m)
  from the previous word's cross-section into its own. It is sculptable and undoable like any handle.
  - `resolve` hands it to the geometry as each segment's `blend` field.
  - The geometry blends width, wall height and ψ by it, smoothstep in s, so a surface never steps: within 2.2e-3 m at
    a join.
  - After a jump, the road starts on its own font.
- `src/doc/connector.js`: close the loop. It builds turn–straight–turn clothoid connectors from the open end back to
  the start.
  - Heading and pitch close exactly; position closes to the geometry's 1e-3 m; curvature is continuous at both joins.
  - Candidates are ranked by validation's worst load on the connector, with red last. When no connector fits the
    limits, it says so plainly.
  - The chosen connector appends as ordinary words, so closing is one undo step.
- `src/geom/bvh.js`: self-intersection and stacked-surface checks over the exported triangles, with a BVH.
  - It finds roads that cross, including two roads at the same height (which are coplanar), and drivable surfaces
    within 2 m of each other along the normal (ARCHITECTURE §3, §4).
  - It is opt-in with `buildMesh(…, { selfCheck: true })`, and it matches a brute-force check pair for pair.
- A loop-the-loop test: pitch through ±90° and round, a continuous orthonormal frame, no folds, and closure to 1e-6 m.
- `src/export/fromwords.js` and `scripts/export_words.js`: **a document of words becomes a complete AC track folder,
  through code, with no game launched.**
  - The pipeline: resolve and the connector, the geometry with its self-check on by default, validation, the kn5
    writer (read back by `tools/kn5.cjs` before anything is written), the AI line, and the export files.
  - The §5c markers are generated from the words, and `pitboxes` is counted from them.
  - Refused before anything is written: an empty or open document, any validation red, a failed lap proof, a start
    straight too short or too narrow, a failed marker check, and a folder this builder did not write.
  - Amber exports with a warning.
  - Tests: `test/export_words.test.js`.
- `src/validate/bounds.js`: `handleBounds(doc, id)` gives each sculpt handle's clean range and what stops it, found by
  the same validation. Tests: `test/validate_bounds.test.js`.

### Changed

- `.gitignore`: `out/` added (the build's output folder).
- Both platform-test folders now carry the same `ai/fast_lane.ai`.
- The document's quanta are finer (0.1 mm, 0.00001°), so a closed loop can meet its start within the geometry's
  tolerance. The canonical text changes accordingly.
- Validation's steep check (red above 50° without CSP) now measures the actual surface normal at every station and
  lateral line, so a banked road counts as well as a steep wall.

### Fixed

- `scripts/build_platform_test.js` no longer continues when `src/export/scene.js` cannot be loaded: validation fails
  loudly instead of being skipped (found by B's read of T1, fixed by A).
- Built meshes no longer repeat node names. A word resolves into up to three segments that share its id, and
  `src/geom/mesh.js` named cells by the id alone, so the names repeated (16 of 31 nodes on a five-word track). That also
  made the self-intersection check report crossings on tracks that do not cross, which refused every default export.
  Pieces are now named by id and part.
