# T-180 Track Builder: architecture, draft 1 (2026-09-27, laptop)

**The goal, in the keeper's words:** an intuitive, standalone world-building program that supersedes Blender for
Assetto Corsa tracks, normal and T-180, which *"makes the track go red if it can't sustain T-180s"*, lets you
*"write with"* the language of good tracks, keeps learning from good tracks on the user's PC, and shows what the
track will look like in AC with CSP before it goes in. Environment building comes after the track, to the same
standard: beautiful, optimised, and **scaled to the speed**, because oversized environments kill the sense of speed.

**What this is built on:** `FINDINGS.md` (everything measured on 11 tracks and 5 replays) and three research reports
(the AC export pipeline, track and coaster builder design, editor engineering). Sources are cited in those reports.
Anything marked **(unverified)** needs a test before we rely on it.

---

## 1. Principles
1. **The track is text. The mesh is derived.** The document is a short list of words, each with its font, tempo and
   handles. Geometry, physics checks, the preview and the export are all regenerated from it deterministically. That
   makes tracks shareable (PolyTrack-style codes), diffable, undoable, and directly learnable, with no reading step for
   tracks built in the program.
2. **Identical where it can be, measured where it can't.** Geometry and materials in the preview are exactly what is
   exported. Lighting is matched to AC+CSP and the gap is measured, never assumed.
3. **Guardrails, not gates.** Physics shows as colour along the track while you build. Red is kept for what is known
   to break; amber means "no track has proven this yet". Load limits come from replays and rise as the community
   proves more.
4. **One tool for beginners and experts** (the ModNation / Trackmania / Hot Wheels arc): place words, restyle them,
   then sculpt freely, all in the same document.
5. **Stability and export reliability are features.** RTB and BTB are hated for crashes, slow updates and export
   pain, not for their idea.

## 2. The language (the data model)
- **Word:** a piece with intrinsic geometry.
  - Parameters: length L, yaw and pitch curvature as ramped functions of s (clothoids, so smooth joins come by
    construction), roll φ(s), and a heartline offset.
  - Vocabulary from the library (`FINDINGS.md` §7): straight, sweep, turn, tight, each flat, climbing or dropping, plus
    wall-ride, inversion and jump. Boundaries such as sweep versus turn are **ours to name**, per the keeper.
- **Phrase:** a saved word sequence with some parameters exposed (a macro): spiral climb, bowl hairpin, S. Users can
  make and share their own.
- **Font:** the cross-section family.
  - The profile is a 2D curve by its own arc length, with a turning angle ψ(u), so a half-pipe, a wall-ride or a tube
    is one data type and works past vertical.
  - Measured fonts: half-pipe (Sakura, Centrifuge), flat banked ribbon (Rainbow), bowl (the other eight), each with a
    width, bank and wall height.
- **Tempo:** the curvature scale and how gradually corners open and close.
  - Measured: Aurora sweeps at ~1.2 km radius, Serpents and the Test Track at 100–170 m.
  - Sakura's grammar is `sweep → turn → tight → turn → sweep`.
- **Handles:** the continuous parameters sculpt mode drags, bounded live by physics.
- **Document:** ordered words with stable IDs, plus constraints (closed loop, pins, which parameters are free).
  - Canonical serialisation with quantised numbers, a schema version and a generator version.
  - Undo is the document's history (immutable snapshots or patches), and a whole drag is one entry.
- **Closing the loop:** a connector solved from the end conditions (G1/G2 clothoid fitting). Candidates are ranked by
  their worst physics margin, not shortest length, which avoids Planet Coaster's documented closing spike.

## 3. Geometry
- **Frames:** rotation-minimising frames by the double-reflection method (f64), with the closing twist spread along
  the loop, plus explicit roll.
  - Show the user bank relative to gravity.
- **Fold check:** the surface folds where 1 − κ·(q·N) ≤ 0 for a profile point q, checked on every profile vertex.
  - Self-intersection is checked separately between non-adjacent cells, with a BVH.
- **Adaptive mesh:** the step along the track is limited by chord error and **max seam angle**, driven by the worst
  profile vertex.
  - Target the proven envelope from `FINDINGS.md` §2: seams around 1° or less (Centrifuge-grade where load is high).
- **Cells:** each is about 100–250 m × one material strip.
  - Under 65,536 vertices each (the kn5 uses 16-bit indices).
  - Cells are the unit of export, culling and incremental rebuild; editing a word rebuilds only its cells.
  - Vertices are stored relative to the cell origin for float precision.

## 4. Validation (the red and amber)
- **Load along the path.** The vector specific force f = v²κ·N − g, projected on the surface frame, per lateral line u
  (a half-pipe's floor and wall load differently), with v(s) from a design speed or a point-mass lap sim.
  - The ~20 g suspension-stop line and the proven ~90 g come from `FINDINGS.md` §4–5, **per car** from its open
    config.
- **Jump check** (`FINDINGS.md` §8): gap, climb and ramp angle give makeable-or-not and the minimum take-off speed.
  - ~~g_eff ≈ 3.3 g for the Mach 6 from two flights.~~ The fall is 3.2–6.3 g over fifteen flights (FINDINGS §7d),
    and not a function of speed alone: a jump must hold at both ends of that range.
- **Red, for known breakage:**
  - holes or gaps in the road
  - a missing soft-collision block
  - folds and self-intersection
  - drivable surfaces stacked within about 2 m
  - wall-rides built from WALL objects instead of road
  - **surfaces above ~50° without CSP's wall raycasting** (vanilla AC tyres ignore steep surfaces; community-reported)
- **Full-lap proof before export** (Trackmania's author drive, Hot Wheels' tractor lap): a ghost point-mass lap
  catches what per-piece checks miss, like carried speed, jump entry and loop entry.
- **Feedback layers:** colour per word, a force graph overlay (players ask for this in Planet Coaster), and a lap
  summary.

## 5. The look: matching AC + CSP
1. **Geometry and materials are exactly what is exported.**
2. **The preview uses AC's shader set** (`ksPerPixel`, `ksMultilayer`, `ksTree`…), ported with Content Manager's Custom
   Showroom (`actools`, Ms-PL) as the reference. Blackbox's renderer already draws these tracks with lighting and
   shadows, so it is the starting point.
3. **The look-match instrument:**
   - Reference screenshots in AC+CSP from fixed cameras on known tracks (Sakura, Centrifuge), at one reference
     weather and time.
   - Render the same views in the builder and measure the image difference; tune until it's small.
   - The difference is a tracked number, not an impression.
4. **One-click "see it in Assetto":** export and launch AC+CSP at the spot being edited. For the final look the game
   is the truth, so the loop between the two must be fast.

## 5b. Track textures: add your own, or make your own (keeper, 2026-09-27)
The road's surface is part of its identity: Rainbow's stripes, Sakura's look, glowing lane lines.
- **Texture slots per surface strip.** Each part of the cross-section gets its own material: floor, walls, lines,
  kerbs, edge glow. A font can carry default textures, and any word can override them.
- **Mapping is automatic.** Textures run along the track by distance and across it by the profile's own width, so
  they never stretch on turns, walls or loops.
  - Handles: tiling length, width fit or tile, offset, and direction (along or across).
- **Bring your own.**
  - Drop in PNG or JPG images. The program converts them to DDS for AC (AC strongly prefers DDS, up to 8192²) and
    builds mipmaps.
  - **Warns** about what AC can't do, e.g. compressed normal maps aren't supported.
- **Make your own:** a texture maker inside the program.
  - **Procedural layers:** asphalt grain, noise, gradients (Rainbow-style bands), stripes and lane lines, panels and
    seams, and emissive glow strips for night.
  - **Decals and logos:** stamped, repeated along a strip, or placed once.
  - Every layer is a parameter set, so a texture is also text: shareable, editable, regenerable at any resolution.
- **Materials,** mapped onto AC's real shaders (`ksPerPixel`, `ksPerPixelNM`, `ksMultilayer`…) and their properties
  (diffuse, specular, emissive), so the preview and the export render with the same inputs (§5).
- **Texture packs:** save and share sets (a font's full look), and import packs other users made.
- **Budget:** a live count of texture memory and resolution per track, because textures are the easiest way to make a
  track heavy.

## 5c. Spawns, pits and timing: making a track playable (keeper, 2026-09-27)
Every marker is placed in **track coordinates**: distance along the road, position across it, and height above the
surface. So markers stay on the road when the words around them are edited, and sit correctly on banked floors and
half-pipes.
- **Race grid (`AC_START_n`):** a grid generator for rows, columns (2 staggered, 3 abreast like Aurora, …), spacing and
  count, dropped on a straight and editable slot by slot. Numbered from pole, `AC_START_0`.
  - The grid order also records the race direction. The reader found some authors' marker axes point backwards
    (`FINDINGS.md` §7b), so the builder writes both consistently.
- **Pit lane and boxes (`AC_PIT_n`):** the pit lane is a side road leaving and rejoining the loop. Boxes are placed
  along it by count and spacing. `pitboxes` in `ui_track.json` is written from the real count, never by hand.
- **Hotlap start (`AC_HOTLAP_START_0`):** placed a run-up before the start line, with its distance chosen so the car
  arrives at speed.
- **Timing gates:** start/finish `AC_TIME_0_L/R` and optional sectors `AC_TIME_1/2`, placed as a gate across the road
  (left and right edges from the cross-section).
- **Checks before export (red if wrong):**
  - the start line is ahead of the grid
  - L and R gates are the right way round (swapped gates silently break lap timing)
  - markers are 1–2 m above the surface, oriented along the road
  - no marker is inside another car's slot or off the road
  - the pit count matches
- **Try it:** "spawn here" from any marker launches AC straight there (§5, one-click), because grids on banked floors
  are exactly where spawns go wrong.
- **The visible half (keeper: "a real start line for races and spots on the track"):** markers are invisible to
  drivers, so the builder paints what they mean, **generated from the markers themselves** so paint and marker can
  never disagree.
  - **Start/finish line:** painted across the road at the `AC_TIME_0` gate, wrapping the cross-section, including up
    a half-pipe's walls.
  - **Grid spots:** a painted box or bracket at every `AC_START_n`, with an optional position number.
  - **Pit boxes:** lines at every `AC_PIT_n`, plus the pit lane entry and exit lines.
  - **Optional race furniture:** a start gantry or lights, and sector boards, as placeable props.
    - **Parked idea.** Working start lights: the keeper doesn't think any T-180 track has them yet, so it is new
      ground to come back to. How CSP could drive them (ext_config or Lua) is **unverified**.
  - All painted marks are texture layers on the road (§5b), drawn in the road's own coordinates so they bend with
    banking and walls, and use the texture maker's styles.

## 6. Export: writing a working AC track directly
- **kn5 version 5, written by us.**
  - Byte reference: AcTools' `Kn5Writer.cs` (Ms-PL). The GPL exporters are reference only.
  - Y-up, flipped V, correct winding, transposed matrices, embedded DDS or PNG textures.
  - Physics meshes are named `<digit><KEY>` (`1ROAD…`). Separate visual meshes where wanted, with physics set
    non-renderable.
- **Markers** as plain nodes: `AC_START_n`, `AC_PIT_n`, `AC_HOTLAP_START_0`, `AC_TIME_0_L/R` (L/R order validated),
  optional sectors.
- **Files:**
  - `models.ini` / `models_<layout>.ini`
  - `data/surfaces.ini`, including the T-180 soft-collision block from `FINDINGS.md` §4c, as a "T-180 track" toggle,
    plus CSP's `WAV_PITCH=extended-0` opt-in with a CSP-only warning
  - `ui/ui_track.json`, `preview.png`, `outline.png`
  - `map.png` + `data/map.ini` (Content Manager's formula)
- **AI line:** `ai/fast_lane.ai` version 7, generated from the centreline and a speed profile, with `hasGrid=0`.
  **(unverified that AC accepts generated speed fields.)**
- **Self-test:** read every exported kn5 back with our own reader (`kn5.cjs`) and AcTools'.
- **Size:** keep the track near the origin. The community says physics jitters past ~20 km. Aurora Long spans ~3 km;
  measure the real limits before promising 50 km layouts.

## 7. Learning (after v1)
- **Tracks built in the program are already text.** Tracks found on the user's PC are read by the reader
  (`read_track.cjs`: all 12 layouts closed, and 99–100% of replay laps lie on the read line).
- **The corpus feeds:**
  - word and phrase statistics
  - per-font and per-tempo norms
  - predictive "next word" suggestions, suggested and never forced
  - the "proven up to" load levels, from replays
- **Weight "good"** by the full-lap proof, replays and ratings, never by frequency alone.
- **Privacy and credit:** other authors' tracks are learned from locally. Nothing leaves the PC without an explicit
  choice.

## 8. Environment (phase 2, same standard)
- **Scale tied to speed:** optic-flow rules (angular speed ∝ v/d) set bands for how far reference objects sit from the
  road and how often repeated objects pass per second, at the design speed.
  - Learn the band from the library plus the keeper's "feels fast / feels too big" labels.
- **Optimisation:**
  - Chunk everything (Sakura's 15 kilometre-scale meshes defeat culling; blackbox `docs/SAKURA_CAMPAIGN.md`).
  - Watch foliage overdraw.
  - Use LODs.

## 9. Stack
**Blackbox's way.** A Tauri v2 desktop app (standalone, installed with NSIS, no browser) with a hand-written WebGL
renderer. Reuse blackbox's `kn5.js`, `kn5tex.js`, renderer, `collider.js`, `roadedge.js` and `acreplay.js`.
- **The geometry core runs in the UI process** (JS first; a Rust/WASM core only if profiling demands it). Mesh data
  must never cross Tauri IPC during a drag: the research found WebView2 binary IPC is slow on Windows, about 200 ms for
  10 MB.
- **Native Rust side:** file IO, launching AC, and the final kn5 write.
- **Blackbox becomes the test lab:** drive the built track, drop the replay in, and see the loads on your own geometry.

## 10. First milestones: prove the risky parts first
1. **The platform test.** Hand-write, with a tiny script, a 500 m track: a half-pipe section, a wall-ride above 90°,
   and one small jump, as a kn5 with markers and the soft-collision block.
   - Drive it with a T-180 in AC+CSP.
   - Proves: direct kn5 writing, wall contact, the soft road, and our jump math.
2. **A generated AI line** for that track: does AC accept it, and do AI laps run?
3. **Round-trip:**
   - The reader reads the exported track back into the same words it was written from.
   - The replay loads match the predicted loads.
4. **The look-match baseline:** reference shots of Sakura in AC+CSP against blackbox's render of the same views, and
   the first difference number.
5. **Then the editor:** the build head, words, fonts, live colour, undo, close-the-loop.

## 11. Open gaps (listed 2026-09-27, before any building)
1. **Topology, corrected by the keeper.** The first version of this item called for a graph with junctions, layouts
   as routes and shortcuts. That was my misreading of Rainbow. The keeper: *"there are no shortcuts … roads passing
   over one another is a normal consequence of tracks being both height and length."*
   - The reader agrees: Rainbow closed as ONE loop at 43.3 km.
   - **So the model stays a single ordered loop of words.** Crossings need only a clearance check (§3's
     self-intersection check).
   - What remains:
     - a **pit lane** as a side road leaving and rejoining the loop (the tracks list 12–48 pit boxes)
     - **layouts** as separate documents (Aurora's two layouts are separate model files, not shared road)
2. **The space around the road:** supports and pylons for floating track, catch walls and barriers, ground under
   grounded sections, and what happens when a car leaves the road.
3. **The game beyond the road:** pits (the lane, boxes, `AC_PIT` count), timing and sectors, replay cameras, surface
   sounds, CSP night lighting and RainFX, and **whether AI can drive walls and loops at all** (a platform test
   alongside §10.1).
4. **Performance budgets measured in AC:** triangles, objects, draw calls and texture memory per km, shown live in the
   builder, from numbers taken in the game.
5. **Online and versioning:** server integrity checks on `surfaces.ini`, and how updates affect online sessions and
   old replays (blackbox `docs/REPLAY_TRACK_VERSION.md`). The export needs version handling.
6. **Remixing existing tracks** (the reader turns any track into editable words): potentially the killer feature, and
   it needs a stance on other authors' work (credit, permission, or own tracks only) before it ships.
7. **Onboarding:** the first ten minutes (a guided first track, defaults, a starter phrasebook) decide whether a
   Blender-averse community stays.

**Where it lives:** its own repo, decided at home. `track_study/` is the research that seeds it.
