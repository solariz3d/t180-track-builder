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

### Changed

- `.gitignore`: `out/` added (the build's output folder).
