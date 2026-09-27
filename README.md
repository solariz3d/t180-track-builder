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

## Status: planned, not built
The research and plan come first. Building starts from `docs/ARCHITECTURE.md` §10, and the first milestone proves the
risky parts in-game: direct kn5 writing, wall contact, the soft road and jumps.

## What's here
- **`docs/FINDINGS.md`:** everything measured so far, with the command that reproduces each number.
  - the shape language of 11 T-180 tracks
  - the mesh envelope proven tracks drive on
  - real loads from replays, and where a T-180's suspension runs out
  - visual versus physics clipping, and the soft-collision block every working T-180 track shares
  - the whole library read as text: 12 layouts, ~241 km, laps verified against 5 replays
  - jump flights
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
  - `loads.cjs`, `bottoming.cjs`, `boxdepth.cjs`, `jump_flight.cjs`: from replays
  - `topdown.cjs`: draws a reading over the track
- **`results/`:** small result files and two full-lap maps.

## Credits
Built on the work of the T-180 community: the car and test-track author ohyeah2389, and the authors of every track
studied here (Sakura Speedway and Rainbow Road above all). Their tracks are read locally for measurement only; none of
their content is included in this repo.
