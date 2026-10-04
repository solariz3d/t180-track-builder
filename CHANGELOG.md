# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- **The track's underside casts shadows, and a closed tube is dark inside (D230).** The keeper: "during day light leaks into the tube it should be inclosed and pitch black" (two bright sunlit bands along the inside of the tube oval), then "the bottom side of the track is an object that casts shadows". A road is one single-sided, zero-thickness shell, so the sun's shadow pass sees only its top faces, and from the sun's side of a closed tube only its back faces: with the shadow bias a thin caster lets light through (inferred, not reproduced). Every equation-core export now carries an **underside skin under every road cell** (`src/export/underskin.js`): a second surface 0.5 m along the road's own normal on the side away from the driver (below an open road; outward of a closed tube, where it is the pipe's outer wall), normals out, casting shadows, in its own plain dark material, with 32 vertices across instead of the road's 63 to 392. It is named `UNDERSKIN_…` (no `1ROAD`, no leading digit): scenery, not a physics surface, so grip and collisions are unchanged and the road nodes are byte for byte the ones mesh.js made. Cells whose section is a **closed ring** also wear a dark copy of their material, ksAmbient 0.02 instead of 0.45, the textured one too; a tube closing or opening steps from light to dark over one 2 m cell. The kn5 grows by about 1.6 KB per metre of track (2.45 MB on the 1,491 m bowl lap, 2.48 MB on the tube oval). A word document's export is unchanged. The two closed fixtures' kn5 digests moved and are recorded in `test/fixtures/manifest.d230.json` (the sealed kit untouched).
- **A tube oval now reaches Assetto Corsa: the export folder and the start grid (D226).** Two causes. (1) The keeper makes a folder named after the
  track directly in `content\tracks` and picks it; the guard refused (it must never write inside another track) and the EMPTY folder it left
  made Content Manager say "main layout is damaged". Now a picked folder directly in `content\tracks` that is not `t180b_*` and is EMPTY exports
  into `content\tracks` as the normal `t180b_<name>` and is removed afterwards; a folder with anything in it is refused and kept, as before.
  The native side checks the same again and removes only an empty folder (rmdir). (2) A closed tube's start straight has a floor of a few metres
  whatever its width (the surface angle grows from 0 at the bottom), so the grid was refused as "too narrow for a two-column grid". When the
  floor fits one slot (a half width over 1.1 m) but not two columns, `src/markers/layout.js` now puts the cars nose to tail on the centreline
  (the new `1-column` grid pattern, a slot every 8 m, the same length as the staggered pair) and the export warns that it did; it still refuses by
  name when not even one slot fits (a tube about 26 m wide or narrower). The two-column layouts are unchanged.

### Added
- **A real road surface on the equation-core tracks, the tube included (D228).** The keeper: "the tube works so good its insane, but I wonder, is it possible we could have like a stock track texture". The core page's Export passed no texture set, so every core track exported the plain solid colour. Now the core page has a road-surface control (app/core/textures.js): **asphalt by default** (the procedural preset in `src/texmaker/presets.js`, our own parameters: nothing is bundled or copied from Assetto Corsa or any other author), **solid colour** one click away, or **your own PNG/JPG**. The preview draws the same set the Export writes. The texture's coordinates run on the path's own arc length (`src/texture/flow.js`): mesh.js restarts a piece's coordinates at every piece, which for the core's 2 m chord segments is a break every 2 m. **A closed tube takes a whole number of repeats round its circumference** (n = round(w / 10 m), evenly spread), so the texture meets itself with no stretched seam; the seam is at the ceiling. A word document's coordinates and every export without a texture set are byte for byte what they were (the nine fixtures: 0 of 9 differ).
- **The cross-section lap, in the core: an edge curve, a tube, and a spiral inside it (D225).** Extend takes three more targets. **Edge angle** (`e`) and **edge start** (`s`) curve the outer part of the road more: from the edge start outward the road gains the extra angle by a smooth curve (3t² − 2t³), with no crease and no wall, and bank still rolls the whole section; 0 is today's road exactly, and every earlier track renders byte for byte as before. **Tube sweep** (`t`, 0 to 360°) makes the section a circular arc, a pipe at 360°. Inside a closed tube bank can wind a full turn (a spiral round the inside of a straight pipe); the road centre is a smooth helix, and the validator reads its centripetal load. Added so the keeper can drive a tube and spiral through it: the track file is now `t180b.core/4` (older files open unchanged; an older builder refuses a new one by name instead of dropping the edge). Limits, each refused by name: an edge angle that takes the total past 150° (180° on an open tube), an edge start outside 0.5 to 0.95, a tube held between 348.7° and 360° on a 31 m road (the two lips leave a slot under the car's 1 m downforce ray), a closed tube narrower than 9.74 m (the chase camera cannot fit), a lap seam that joins a tube to something else. The validator also reds a roll faster than 1.2144°/m over 20 m (amber above 0.9338): a full 360° of bank passes only over about 450 m, and 600 m clears amber, so 300 m reds; and a tube that closes along the road reds the slot as a downforce-ray gap, with no exemption. Water cannot pour over a tube's spiral and says so. Maths on the shelf: references/09 §10. The Extend fields for these (e, s, t) are the app's, not yet wired.

**The equation builder is in the app, and it is what the app opens in.** The track is shaped as equations: extend it from
its open end, brush it on the preview, close it in one click, and pour water down it to see where it spills, lifts off or
piles into one line. The piece builder is still there, paused: pick "Pieces (paused)" at the top left.
- **Extend:** keep going the way the track goes, or set a turn, climb, bank or width. The piece you are about to add shows
  as a see-through ghost at the head.
- **Brush:** switch it on and drag on the track. The height and sideways brush is the default once it is in the build; the
  rate brush (turn, climb, bank, width, wall rise) is the second mode. One drag is one undo. A narrow brush that had to be
  widened says so, with the width it used.
- **Close:** one click. It avoids the stretch you edited last and your straights, so a straight stays straight (radius
  over 5 km, where it used to bend to about 370 m). A lap too far from closed says so and stays open.
- **Water:** on while the box is ticked, redrawn after every change, over 1.5 km of road at the speed you set. Every red is
  listed in plain words with where it is. It stops at a jump: the flight is not modelled.
- **Export:** the same exporter as before, with the same checks. The grid goes on the longest nearly straight stretch
  (radius 5 km or more). The export warns that the grid is "on a core, not a straight"; that is a warning, not a refusal.
- **A real track as a local example:** pick its fit and its read from your own reads/ folder. It is never part of the
  program.
- **Hills and sideways moves show everywhere:** the preview, the water and the export read the road as brushed. A track that
  starts on a slope is built from where it really starts.
- **Two tests fail, and are recorded as failing:**
  - **The round trip** (a real track rebuilt in the builder, exported, and read back): the export refuses both rebuilt tracks.
    Serpents Spiral's longest straight is 18 m, and a grid of 4 with 2 pit boxes needs 67.4 m. Thunderhead's export is refused
    for a gap under the car's downforce ray at 2,257.5 m along the track. No exported track exists yet to compare.
  - **The 40 km speed test:** one extend step on a 40 km track takes 438 ms at the median and 505 ms at the 95th percentile,
    where the bar is 50 ms. The time goes to rebuilding the whole track's segments on every step (about 191 ms), finding where
    each piece starts along the track (about 234 ms), and the preview comparing its whole list of pieces (about 135 ms). The
    height brush takes minutes per stroke on a track that long.
  - **So editing a 40 km track is slow for now.** Tracks of a few kilometres respond at interactive speed.

The built-in pieces are now measured from real T-180 tracks instead of being set by hand. No installer is built from
this yet: 0.2.2 below is still the one to install.

**How alike the new pieces are to real tracks: the stretch-rebuild test (a result, not a gate).** Before the pieces were
changed, a test was written down and fixed: rebuild the first 3 km of two real tracks, Sakura Speedway and Centrifuge,
from the new pieces only (each piece at its own defaults, with only its length, turn and climb set), read the rebuild
back the same way as the real track, and compare the two with tolerances chosen in advance. The old pieces were run
through the same test first, and failed it badly.

- **Result: not alike yet, on either track.**
- **The rims are fixed.** On Sakura every cross-section measure passes: the tilt a quarter, half and three quarters of
  the way out and at the edge, and how sharply the tilt changes across the road. The rim tilts about 30°, as the real
  track's does, where the old half-pipe rose to about 60°. On Centrifuge the tilt changes as gently as on the real track
  too, and its banking is now in range.
- **Centrifuge's sides are too flat half way and three quarters of the way up.** Its cross-section is the deeper of the
  two half-pipe shapes measured in the library, and there is no piece for that deeper half-pipe yet.
- **Sakura banks 1.8° less than the real track** at the median.
- **The height changes are off in the same way as with the old pieces.** That points at how the test rebuilds climbs,
  not at the pieces.
- **Not exportable as built:** each rebuild fails the builder's own lap check once (the car would leave the surface
  about 600–700 m in), so both were measured with that check lifted.

### Changed

- **The preview is wider: the right-hand column is gone.** In the equation builder it held only the validation panel
  (design speed, CSP wall raycasting, the load graph) and an error list that is usually empty, in a fixed 300 px
  column. Those now sit under the builder's controls in one left column (320 px) that scrolls as a whole, and the
  preview takes the rest: about 1,080 px wide at the default 1400 px window, up from 820. The columns are also pinned to
  the row that fills the window; when the banner was empty they could slide up into its row and stop short.
- **Extend's fields show what the track is doing instead of being blank.** Turn, climb, bank, width and cup show the head's
  values in their own units (°/100 m, °, m): on an empty track, the first piece's start (level, straight, 31 m wide, the bowl's
  edge); after every Extend, Undo, Redo, brush or open, the head's end. A field left as shown keeps the track going exactly as a
  blank field did (it continues the turn, bank or cup that is still changing, and an old track's cup stays as it was); a
  changed value is a target, as before. Length keeps what you typed (100 m to start).
- **The built-in words are measured from the T-180 library, not hand-set.** Before, they were set by hand, partly from
  the 500 m test loop of the first milestone: roads 8–20 m wide, flat straights and sweeps, no bank, walls 8 m high
  and a 12 m jump. Now each word's defaults come from the measured library (`src/doc/corpus.json`, 16 layouts). A
  corner piece is the size of the library's median corner of its kind: a tight turns 88° at about 100 m radius, a turn
  12° at about 300 m, a sweep 1° at 800 m, and a straight is 48 m. Corners bank into the turn, about 20–31°.
  The jump is 81 m across and 14 m down; its gap is the library's shorter jumps rather than the median, because a jump
  taken off a level road at the default 460 km/h cannot clear the median 125 m.
- **A word placed with no font chosen keeps the previous word's font,** so a track holds one cross-section for long
  stretches as the real tracks do, and you change it on purpose. The first word of a track takes the bowl, the
  cross-section the library uses most. The road's width follows the font: 31 m for the bowl, 31.5 m for the half-pipe,
  45 m for the flat ribbon.
- **No wall by default.** The bowl, the half-pipe and the flat are the library's measured cross-sections, which rise
  across the whole width and stop at the edge. The old 8 m walls rose past that edge, the rims that flipped up. A wall
  can still be sculpted on any word.
- **The bank ramps.** A word banks no faster than real T-180 roads do (0.849°/m, the fastest tenth of the library's
  banking, measured by `tools/bankrate.cjs`). A word that would bank faster is made longer at its radius, so it turns
  further. Before, a wall-ride after a turn banked 52° inside 36 m, and validation marked the seam sharper than measured.
- The tempos now set a piece's size from the library's corners: standard is the median corner, compact a small one,
  grand a large one. The older aurora and serpents stay, so tracks that use them still open.
- The bowl hairpin, the S and the spiral climb name their turn angles, so they stay a hairpin, an S and a spiral at the
  new sizes.
- Tracks made before this change open and build with the same centreline: a document stores every handle of every
  word, so only words placed from now on get the new defaults. A bowl, half-pipe or flat word in an old track keeps its
  wall and gets the measured floor under it.
- **Flying is per axis.** W/S, A/D and Q/E each move on their own, so W and D together go diagonally, at the same speed as a
  straight line. If both keys of one pair are held, the newer one wins, and the other takes over when it is released.
  Before, only the last key you pressed moved.

### Added

- **A piece can take its new width (or bank, or cup) in a short ramp at its start and hold it.** Extending after another piece blends a width toward its target over the whole piece; the keeper wanted the whole piece at the new width without a bottleneck at its start. Each field can now be set to ease in over the whole piece (as before) or to reach its target within about one knot span (at most 20 m) and hold it for the rest of the piece; the joint into the piece is still smooth (a later piece cannot jump), and the ramp cannot overshoot its target or ring. The first piece of a track already holds what was typed from its start.
- The palette suggests what usually comes next, from how often each kind of word follows another on the real tracks.
  It only suggests: every word can still be placed after any other.
- **Cup: the road's cross-section deepens toward a half-pipe, apart from bank.** A new channel sets the angle the walls have
  turned by at the edges, from 0 (flat) to 150 (a partial tube): about 15 is the old bowl, 31 the old half-pipe, 90 vertical
  walls. It blends along the piece like the others, moves neither the line nor the bank, and rolls with bank (bank 30 with cup 60
  stands the left wall vertical). Tracks made before this open and render exactly as they did: a cup is only there when you set one.
  Closing a lap whose cup meets an uncupped start holds the cup at the start's edge and fades it into the start's shape over the last 10 m,
  or refuses by name if it cannot; the validation panel reds any cup joint or lap seam that steps more than 1 mm.

### Fixed

- **Closing the window with unsaved changes now asks first:** Save, Don't save, or Cancel. Before, the X closed at once and
  the unsaved track was gone (the pieces builder kept an autosave; the equation builder kept nothing). Save does what the
  Save button does; if the track has no name yet the window stays open with the name box focused, so nothing is lost.
  Cancel, or closing the prompt, keeps the window open. With nothing unsaved the X closes at once, as before. If the
  prompt itself cannot be shown, the window still closes: the X never stops working (`app/closer.js`, D192's rule).
- **Exported tracks now work in Assetto Corsa: the car stays on the road, and the road is lit.** Found in the first drive
  of an exported track in AC with CSP (2026-10-02, a 6 km oval). Two causes, both in the kn5 the export writes:
  - The car fell through the road. Every road cell sat under its own transformed node and reused its piece's mesh name
    (3,001 of 3,003 road meshes transformed; 9 distinct names for 3,003 meshes). AC drew that, but its physics did not
    collide with it. The export now writes every mesh in world space under identity nodes, with a unique name
    (`src/export/acready.js`). A copy with only that change drove at over 900 km/h. The preview keeps its per-cell
    transforms, so sculpting is as fast as before. Not yet split: whether AC needs the flattening, the unique names, or
    both.
  - The road rendered black under any light. Its `ksPerPixel` material had no `txDiffuse` texture, and that shader takes
    its colour from one. Every material without a diffuse now gets a small solid one (grey for the road, near-white for
    the paint), and the preview draws the same textures, so the preview and the kn5 still list the same materials.
  - A bump at 900+ km/h where one piece meets the next, felt in the drive and seen in its replay. It is not a step: the two
    edges meet within 0.5 mm. The builder bridged that half-millimetre with a strip of slivers (about 1e-4 m², thinner
    than 4 mm) whose normals face along the road, so a tyre that landed on one met a wall. The worst crease the car
    crossed on the lap was 167° there and 0.34° anywhere else. The export now moves the later piece's edge onto the
    earlier one wherever they are within 2 mm, and drops every seam triangle thinner than 4 mm. Seam triangles that bridge
    a real gap (a change of cross-section across part of the width) are kept. On the oval, the worst crossed crease is
    now 0.34° everywhere, measured along the driven line; whether the bump is gone in the car is still to be driven.
  - To adapt: re-export a track to get the fix. A track exported before this still falls through.
- **The speed the builder checks a track at now goes to 970 km/h** (it stopped at 764). 764 was the 99th-percentile
  speed of seven laps on tracks whose straights never let the Mach 6 reach top speed. The exported oval let it: p99 970,
  max 971 km/h, with 57% of the lap above 764 (docs/FINDINGS.md §3e). The lap check and the speed slider both use the
  new cap. Loads go with speed squared, so a fast track can now show amber or red in corners that read green before,
  because the check finally counts the speed the car reaches.
  - Known, not changed here: the sealed fixture digests (D190 row 5) no longer match for the two closed-loop fixtures,
    because their kn5 bytes changed on purpose. They need re-sealing.
- The preview on an empty track now draws and answers the wheel, keys and mouse at once, looking at where the first piece will start. Before, with nothing placed and no ghost, the view did not draw at all, and input given meanwhile was applied late, when the Extend ghost first appeared: the "lag until the first piece is put down" (D195).
- A piece whose width (or rise rate) changes is drawn smoothly. Each 2 m slice of it used to be drawn at its own middle width, so a width change was a staircase of steps between slices, and at the start of a piece that eases into a new width the road stepped by up to a quarter of a metre; every slice now runs from its own start shape to its own end shape, so neighbouring slices meet. Roads whose width does not change are drawn exactly as before. This changes how three saved test tracks are drawn (a width change, a brushed rise rate, mixed families) and nothing else.
- The first piece of a track is now what you typed along its whole length. Before, a width, bank, turn, climb or cup typed for the
  first piece started at the default and grew to your value by its far end, so every new track began with a bottleneck (31 m
  widening to what you asked). The fields you leave as shown keep their default start; pieces after the first still ease from
  where the track is to what you type.
- The window's X no longer does nothing. After switching between the equation and piece builders (which reloads the page) the close request was left waiting on a handler that no longer existed, so the X, and Alt+F4, did nothing in the equation builder; a failing autosave could hold the piece builder open the same way. One close handler is now registered for both builders, cleans up (the piece builder still clears or saves its autosave), and always closes the window, even if the cleanup fails or hangs.
- The cup's migration-fixture test no longer fails on a fresh Windows checkout: git's line-ending conversion (core.autocrlf, on by default there) rewrote the hashed fixture files to CRLF, so every digest read "FIXTURE FILE CHANGED". A .gitattributes now keeps test/fixtures exactly as committed.
- Holding a movement key and pressing C or B no longer snaps the camera back to free on the key’s auto-repeat.
- Flying forward or back together with up or down no longer slows to a crawl as the view looks down (it was 0.9× at the
  starting view and 0.01× straight down). Every key combination flies at the same speed, in any direction you look.
- A sideways trackpad swipe no longer zooms the view, or changes the lens with Ctrl. Shift+wheel on a device that reports
  it as deltaX still works (×4).
- The label of the piece at the build head is always drawn, even when that piece is off-screen, and label boxes are opaque
  (no border), so their text stays at least 4.5:1 over bright road.

## [0.2.2] - 2026-09-28

The first installer built from the published source (`main` at 484be9e): it holds every change listed under 0.2.1
below, and adds none of its own. The 0.2.1 installer was built from a working copy before all of them had landed. It
did not have the starter phrases in their clean order, or the test seam for the Export dialog; whether it had the
plain-word red and amber reasons and the faster drags is not established. Install 0.2.2.

## [0.2.1] - 2026-09-27

The first 0.2.0 build could not place a word in its own window (see Fixed). 0.2.1 is the build to install. It also
brings the Assetto Corsa look in the preview, a guided first track, and textures that reach the exported track.

### Added

- The 3D preview draws the track with Assetto Corsa's own shaders (`ksPerPixel`, `ksPerPixelNM`, `ksMultilayer`, ported
  from Content Manager's Custom Showroom under the Ms-PL, whose licence is in `app/preview/`) and the materials and
  textures the export writes, under one stated reference light (14:00 sun). L switches to a colour per placed word. Not
  drawn yet: the painted start line, grid and pit boxes, and the closing seam.
- A guided first track for new users: five short, skippable steps (place a few pieces, sculpt one handle, close the
  loop, read the colours, export). The guide only shows the moves; the user makes them. It opens once, on first run,
  which it remembers in the app's own data folder, and "Show the guide" brings it back. It sets the starting font and
  tempo, each with its source, and points at the starter phrases.
- A textures panel in the side panel, under the sculpt handles: pick a road word, then give each of its slots an image
  or a made texture. The texture maker opens from each slot's "Make…" button.
- The export writes the texture set the preview draws: a word whose floor slot holds a texture (an image or a made
  one) is exported in that slot's material, with its DDS embedded; an untextured track's kn5 is unchanged. "Install to
  AC" carries it too.
- Look-match reference views (ARCHITECTURE §5.3): fixed cameras on two reference tracks (`src/lookmatch/views.json`),
  rendered in the builder's look (`node scripts/lookmatch.js render`), and the difference measured as mean CIEDE2000
  (`node scripts/lookmatch.js diff`). The number stays unmeasured until reference shots from AC exist; renders of
  other authors' tracks are never written into the repository.
- A test seam for the Export dialog (`T180_TEST_EXPORT_FOLDER`, read only from the app's launch environment), so the
  installed app's Export can be checked end to end. Normal use always gets the native folder dialog.

### Changed

- While a handle is dragged, only the dragged word and the word after it are re-checked on every frame. The rest of
  the track is shown as "not checked yet" (never as clear) and is checked in full the moment the handle is let go,
  with exactly the result a full check gives. On the 40 km benchmark track (`node --expose-gc scripts/bench.js --km 40
  --seed 17`, one run on a shared machine) placing a word takes 30 ms, a drag step 26–44 ms and a full revalidate
  0.17 s, all inside their budgets (100 ms, 50 ms, 1 s), against 1,000 ms, 1.3–3.7 s and 5.9 s before 0.2.0.
- Validation's red and amber list reads in plain words ("two roads are stacked less than 2 m apart here"); the rule
  and its source are in the tooltip.
- The starter phrases are ordered sakura flow, S, bowl hairpin, spiral climb, so clicking them in turn builds a track
  with no red (in the old order the spiral climb crossed the sakura flow's road).
- The 3D preview's cross lines fade with distance (from overhead they darkened the whole road), and the background is
  darker than the fog, so surfaces facing away from the sun no longer merge into it.

### Fixed

- **In the app's real window, placing any word did nothing.** The shell called the browser's `setTimeout` as a method of
  another object, which WebView2 refuses ("Illegal invocation") and Node allows, so every headless test passed. It was
  in the app from the first autosave onward; a test now makes the timers as strict as a browser's.
- A jump taken off a road that had climbed past vertical produced a flight that turned the pitch through vertical, so
  the car would have flown backwards, and validation then threw on a negative gap. Such a jump is now refused by name
  (`JUMP_PAST_VERTICAL`), at the take-off and anywhere in its flight, so the edit that would make one changes nothing.
  Found by the soak at 10,000 operations.
- A refused edit returns nothing, as every other refused action does, so the sculpt handles see the refusal.
- The first jump a new user placed was red straight away: its landing ramp was sized for 300 km/h while the track is
  checked at the design speed (460 km/h by default). The ramp is now sized for the design speed (41 m at 460 km/h
  instead of 19 m), and on a track still being built it follows the design-speed slider. A closed loop keeps its ramps.
  Below 290 km/h the default 12 m jump cannot be cleared at all, and it says so.
- A success ("loop closed…", "exported…") was shown in red, as an alert, like a refusal. It is now a plain status line.
- A track saved under a name still exported and installed as `t180b_untitled`: saving names the file, not the
  track, and the folder was taken from the track. Both now use the saved name, so a track saved as "Monza" installs as
  `t180b_monza`. Install to AC refuses a track that has no name yet, because a second unnamed install would replace
  the first.
- The AC folder was remembered, and shown in the install message, with Windows' `\\?\` prefix
  (`\\?\C:\…`). It is now the plain path.
- The Install to AC tooltip read "content<tab>racks": a `\t` had become a tab.
- The soak no longer crashes on a track that contains a starter phrase (it sculpted a phrase as if it were a word).
- The geometry mutation harness judges each mutant by its named test run alone, from that test's own result, so a heavy
  test file failing under machine load can no longer hide a catch.

## [0.2.0] - 2026-09-27

The first release: a Windows installer for the track builder (see `docs/RELEASE.md`). A track is written in words,
built from its open end in a 3D preview, checked against measured T-180 limits while it is built, and exported as a
complete Assetto Corsa track folder. Nothing in it has been driven in the game yet. Version 0.1.0 was only the app's
version string; it was never released. **This build cannot place a word in its own window; install 0.2.1.**

### Added

- **Milestone 1, the platform test track, written directly as AC files** (`docs/ARCHITECTURE.md` §10.1). Three parts
  build to one shared scene shape (`src/export/scene.js`), so each part could be written and tested on its own.
- `src/export/scene.js` and `src/export/kn5write.js`.
  - `validateScene(scene)` refuses anything outside the shared shape, with a coded `SceneError`.
  - `writeKn5(scene)` writes a kn5 version 5 directly, with AcTools' `Kn5Writer.cs` as the byte reference. The track
    reads back through the repo's own `tools/kn5.cjs`.
  - The writer stores V as `1 − v`.
  - Triangle winding is kept as given: measured CCW-from-outside on the two reference tracks it checked.
  - It refuses meshes over 65,535 vertices or with no triangles.
  - Tests: `test/kn5write.test.js`.
- `scripts/platform_test.js`. It builds the 500 m test loop the milestone names as a scene: a half-pipe
  turn, a wall-ride turn whose outside wall passes vertical (110°), and one small jump sized by `docs/FINDINGS.md`
  §7d-e / §8 to hold at both the 3.2 g and the 6.3 g landing. It adds the race markers and `1ROAD` physics meshes.
  - The loop closes by construction (500.000 m, and the end is 2.52e-12 m from the start).
  - Every cell stays under 65,536 vertices.
  - Tests: `test/platform_test.test.js`.
- `src/export/markers.js`. These are the §5c "red if wrong" checks, run before anything is written:
  - the start line is ahead of the grid, and the grid is numbered from pole;
  - the L and R timing gates are the right way round;
  - every marker is 1–2 m above the road and points along it;
  - no marker is inside another car's slot or off the road;
  - the pit count matches.

  Why: swapped gates or a grid past the line break a track silently in AC. **The left/right and race-direction
  conventions were measured** on the five reference tracks installed locally, not assumed.
- `src/export/trackfiles.js` writes every non-kn5 file of a track folder:
  - `data/surfaces.ini`, with or without the T-180 soft-collision block of FINDINGS §4c;
  - `models.ini`;
  - `ui/ui_track.json`, whose `pitboxes` is counted from the `AC_PIT_n` markers and never typed;
  - `ui/preview.png`, `ui/outline.png`, `map.png` and `data/map.ini`. The map follows Content Manager's formula, from
    AcTools' `TrackMapRenderer.cs`, so AC's map app lines up.

  The PNGs are encoded with no dependency beyond node's zlib.
- `scripts/build_platform_test.js` glues the scene, the kn5 writer and the track files into two installable
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
- `src/export/ailine.js` (milestone 2). It generates `ai/fast_lane.ai` (version 7, hasGrid 0) from the
  track's centreline, with a constant 300 km/h speed profile.
  - The line climbs the outside walls to their balance angle: about 87° on the wall-ride, capped at 50° on the
    half-pipe. `--ai-mode floor` keeps it on the floor as a control.
  - The layout was checked against every AI line in a local install. Which fields are filled, and why, is written in
    the file.
  - Tests: `test/ailine.test.js` (round trip, header, closure and length, the wall angles, the jump crossing, and
    refusals).
- `scripts/roundtrip.js` (milestone 3, first half). It writes the platform test as a kn5, reads it back with
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
- **The app** (`src-tauri/`, `app/`): a Tauri v2 desktop program in which the user builds the track from its open end.
  v1 is the track alone, with no environment.
  - A build palette lists the built-in words and the user's own saved pieces, with font, tempo and turn pickers.
  - Place, undo, redo and remove-head each make one step. A selection of placed words can be saved as a named piece.
  - Tracks save and open as the canonical text.
  - The document model, geometry and validation run in the window itself. Only file names and text cross to the
    native side, so no mesh data crosses it during a drag or otherwise.
  - `app/README.md` says how the panels plug in.
  - Tests: `app/test/` (headless), and 3 Rust tests of the native file commands.
- The 3D preview (`app/preview/`): the track the geometry builds, drawn with WebGL in the app's own process, one colour
  per placed word. Appending and sculpting update it incrementally and re-upload only what changed.
- Cameras (`app/camera/`):
  - the **build view**, the default: behind and above the open end, looking where the track grows, banking with the
    road;
  - overhead, side, chase along the road, and free flight.
  - **C** cycles the modes, and **B** returns to the build view in one press from any mode.
- The validation panel (`app/validate-ui/`): red and amber colour along the track, from validation's loads and its red
  and amber lists.
  - It follows the build head: an append or a sculpt re-validates only from the changed word, and the result equals a
    full run.
  - Each jump's 3.2 g and 6.3 g landing arcs and the landing zone are drawn from validation's own numbers.
- Export from the app: an Export… button writes the closed track as an Assetto Corsa track folder into a folder picked
  in the native dialog.
  - It runs the same exporter as the command line (`src/export/fromwords.js`) inside the window. The output is
    byte-identical to it, apart from PNG compression.
  - A red track is refused and its reds are listed.
  - Inside an AC install only `t180b_*` folders are ever written, and another track's folder is refused, by the page
    and again natively. Nothing is installed or launched.
- Close the loop from the palette: it appends the safest connector as one undo step, since a track must be a closed lap
  before it exports.
- Autosave and crash recovery: an unsaved track is written to the app's data folder shortly after each edit, and the
  next start offers to restore it or discard it. Nothing is written inside the repository.
- A design-speed picker in the validation panel, starting at 460 km/h: the median speed of seven clean Mach 6 laps
  (`docs/FINDINGS.md` §3d).
  - Every word without its own speed is validated at it, so the load colours appear while building: information at the
    20 g suspension stop, amber above the proven 90 g.
  - It edits no document.
- `tools/speed.cjs`: speed percentiles and propulsive acceleration per speed band, measured from replays.
  `docs/FINDINGS.md` §3d records the measurements with their command and sample. No replay bytes are in this
  repository.
- A window proof (`scripts/prove_render.js`, `scripts/prove_render.ps1`). It starts the built app, places a real track
  through the palette, and captures the app's own window (PrintWindow, never the screen) in the build, overhead, chase
  and free views. It checks that the track is drawn, that the build view looks along the growth direction, and that the
  head is in frame. The captures stay outside the repository.
- A jump now carries its landing ramp: after the flight, a straight stretch of road at the landing pitch, long enough
  that the car touches down on it at both measured falls (3.2 g and 6.3 g) with a margin. It is sized by validation's
  own `landingRamp()` in `src/validate/jumps.js`. The build head sits on road after a jump, and the next piece starts on
  the landing, blending from the ramp's cross-section like any other join.
- The ghost of the next piece: pointing at a piece in the palette shows it, see-through, at the head, exactly as a click
  would place it. Leaving hides it.
- The preview reads as a track:
  - lit surfaces, so floors, banks and walls differ;
  - white edge and centre lines, and a tie across the road every 10 m;
  - a faint ground grid at height 0, which is editor UI, not scenery;
  - a marker at the build head that stays readable from any distance.
  The overhead camera frames the whole track.
- A load graph in the validation panel: the hardest line's load along the track, with the 20 g and 90 g limits and the
  red and amber stretches shaded. It is hidden while there is no load.
- Validation:
  - an open track's head must sit on road; a head in a jump's flight is red (`head-in-the-air`);
  - at a known take-off speed, a landing the road does not catch is red (`landing-misses-zone`).
- A headless end-to-end test (`test/doc-e2e.test.js`): words become a closed loop, which is exported with every check
  on and read back with every start, pit and timing marker.
- Sculpt handles (`app/handles/`): every handle of a placed word, with its physics bounds.
  - A drag stops at the red bound (known breakage, which the export refuses) and passes amber (unproven, never
    blocked).
  - Each drag is one undo step. Alt goes past red and shows it.
- Race markers placed by the program (`docs/ARCHITECTURE.md` §5c), in `src/markers/` and a markers panel
  (`app/markers/`, built and tested headless; not yet mounted in the page):
  - every marker sits in track coordinates, anchored to a word and a distance into it, on the surface the mesh builds,
    so it moves with its word when earlier words are edited and stands correctly on banked floors and half-pipe walls;
  - the grid comes from a pattern (2 staggered, 2 abreast, 3 abreast) with count, spacing and slot-by-slot edits,
    numbered from pole;
  - pit boxes, with `pitboxes` counted from them; they can stand on a pit lane once one is built;
  - the hotlap start sits at the run-up that reaches the design speed at the line, from the measured thrust;
  - start/finish and sector gates stand at the edges of the cross-section;
  - the start/finish line, grid boxes and pit boxes are painted as surface meshes generated from the markers, so paint
    and markers cannot disagree;
  - §5c's red checks (start line ahead of the grid, L/R gates, height and heading, slot overlap and off-road, pit
    count, a marker whose word is gone) refuse the export.
- `exportTrack` takes a marker layout (`opts.markers`). Without one it places the default layout on the longest
  straight, where it did before.
- Texture slots in the document (`docs/ARCHITECTURE.md` §5b, part 1): floor, walls, lines, kerbs and edge glow. A font
  carries defaults and any word can override them (schema 2); older documents and piece libraries migrate on load and
  resolve to the same track.
- Texture tools in `src/texture/`, not yet used by the mesh, the preview or the export:
  - mapping by each lateral line's own arc length and the profile's own width, so a texture does not stretch through
    tight turns, walls or loops (the mesh's current centreline mapping is off by up to 650% on a 15 m turn);
  - PNG and baseline JPEG import, converted to uncompressed DDS with a full mip chain; progressive JPEG, interlaced PNG,
    images over 8192 px and a compressed normal map are refused with a named reason;
  - one texture set feeding both sides: the preview reads its images back from the same DDS bytes the kn5 embeds.
- A texture panel (`app/texture/`), built and tested headless; not yet mounted in the page.
- A procedural texture maker (`src/texmaker/`, `app/texmaker/`): asphalt grain, noise, gradient bands, stripes, lane
  lines, panels and seams, emissive glow strips, and stamped decals, each a parameter set. A texture is canonical text
  that regenerates byte-exact at any resolution; `makeTexture(text, w, h)` gives the RGBA pixels the texture tools turn
  into DDS. Four presets: asphalt, rainbow, lanes, neon-night. The editor panel is built and tested headless; not yet
  mounted in the page.
- A pit lane in the document (`docs/ARCHITECTURE.md` §11.1): a side road anchored to the loop at a leave and a rejoin
  point, easing out to its own run beside the road and back in, with no step and a continuous tangent at both joins.
  Setting, editing and removing it are one undo step each. The document is now schema 3; schema-1 and schema-2
  documents migrate on load. Not yet editable in the app.
- The pit lane in the export: its own drivable cells, the pit boxes placed on it, and its crossings with the road
  refused as red, with the self-intersection check on. No AI pit line (`ai/pit_lane.ai`) is written yet, so AI cars
  cannot pit.
- Projects of several layouts, each its own document, exported as one track folder with one set of files per layout
  (`models_<layout>.ini`, `<layout>/`, `ui/<layout>/`), laid out the way AC's installed multi-layout tracks are.
- A texture slot can hold a texture made in the program: its parameter text, rendered at a chosen size (a power of two,
  16 to 8192) in both the preview and the export, so a track's look is text that regenerates byte-exact. A "Make…"
  button per slot opens the texture maker.
- Texture packs: one shareable file with a font's full look and the images it uses. Importing refuses a name clash, a
  DDS and a compressed normal map; wearing a pack is one undo step.
- A starter phrasebook (`src/doc/phrasebook.js`, ARCHITECTURE §11.7): sakura flow, bowl hairpin, S and spiral climb.
  Each resolves, builds and validates with no red at its default tempo, and each quotes the FINDINGS and ARCHITECTURE
  lines it comes from. They are in the palette (below).
- Shareable codes (one line of text) for a track, a piece or phrase, and a texture pack. They import byte-exact, and a
  corrupted, cut or foreign code is refused whole with nothing changed.
- "Install to AC": pick the Assetto Corsa folder once (remembered in the app's own data folder), and the track is
  exported straight into `content\tracks` as `t180b_<name>`. It never writes over a folder the builder did not make.
- "See it in Assetto": a launch that backs up and restores `race.ini` around the game. It is off by default behind a
  setting labelled as launching the game, and has never been run: the builder's tests drive it only with a mock.
- Hardening: a Rainbow-scale benchmark (`scripts/bench.js`, 40 km along the app's own edit path), a seeded soak of
  random edits (`scripts/soak.js`; 60 ops in the default suite, 10,000 behind `T180_SOAK`) checking round-trips,
  byte-identical undo, save/open and the preview against a full build, and tests that an edit rebuilds only the cells
  it touches and that no mesh crosses to the native side during a drag. The benchmark shows every edit on a 40 km track
  over its budget, mostly in revalidation.
- The starter phrases (sakura flow, bowl hairpin, S, spiral climb) in the palette, as their own "Starter phrases"
  group. Placing one is one undo step.
- The first Windows installer (T-180 Track Builder 0.2.0, NSIS, per user, no administrator rights), built by
  `node src-tauri/release.cjs`. That script keeps the build machine's paths out of the binary and refuses to finish if
  any are left. See `docs/RELEASE.md`. The installer is not code-signed, so SmartScreen warns.

### Changed

- `.gitignore`: `out/` added (the build's output folder).
- Both platform-test folders now carry the same `ai/fast_lane.ai`.
- The document's quanta are finer (0.1 mm, 0.00001°), so a closed loop can meet its start within the geometry's
  tolerance. The canonical text changes accordingly.
- Validation's steep check (red above 50° without CSP) now measures the actual surface normal at every station and
  lateral line, so a banked road counts as well as a steep wall.
- `npm test` now also runs the app's headless tests (`app/test/*.test.js`).
- The lap sim runs at the measured full-thrust acceleration, a table against speed: about 25 m/s² below 400 km/h and
  11.5 m/s² at 700–800. So a closed track's lap proof runs with no speed given. With the default car it runs only on a
  closed loop; an open track without a design speed claims no load.
- Backspace alone no longer removes the head; Ctrl+Backspace does, so a stray key cannot delete track.
- The default hotlap start is no longer 12 m behind the pit boxes. It is where the run-up reaches the design speed at
  the line (352 m at 460 km/h), which on a short loop wraps back round the track.
- The document's canonical text now carries each word's `textures` (schema 2) and the document's `pitLane` (schema 3).
- The geometry and app mutation harnesses run their child test processes at `--test-concurrency=4`, so a full-suite
  run no longer fans each child out across every core.
- The texture-memory budget reports per texture, per slot and in total. It turns amber above the median and red above
  the largest embedded texture load of the eleven T-180 tracks measured (56.3 MB and 328.9 MB of kn5 file bytes),
  replacing an inferred 256 MiB line. Red is shown, not a refusal.
- The texture decoder takes a size cap, so a small hostile code cannot demand a large buffer.
- README: the status is no longer "planned, not built". A table judges every item of ARCHITECTURE §1–§6, §5b and §5c
  as tested, built or not yet, naming the file and the test.
- The track's frame is the yaw-pitch (gravity) frame plus the word's roll, instead of a rotation-minimising frame, so a
  word's roll is its bank against gravity. Before, a climbing turn silently banked the road (61° over a full turn at
  10° pitch). This is a deviation from ARCHITECTURE §3, recorded in `docs/INTERFACES.md` §2. Old documents keep their
  centreline; on pitched turns their bank changes to what the words say.
- Sculpting a word moves everything after it rigidly, unless the edit changes the pitch the next piece starts at. The
  pieces after it are re-placed, not regrown or re-meshed, and the path stays bit-identical to a full rebuild.
- The 3D preview builds its path at the export's station step (2 m), so it shows the stations the kn5 is built from,
  and it publishes that one path (`t180:track`) for validation instead of each keeping its own.
- Validation reads the preview's path and re-checks only from the changed word on, plus the stations within stacking
  reach (at most 34 m with the built-in words) of what moved. The stacking check measures only pairs of stations that
  could be within 2 m, with the same findings bit for bit. A closed loop's lap proof waits for the end of a drag.

### Removed

- The app's "skip self-intersection check" switch, and its pass-through to the exporter. The check is always on in the
  app. A track it refuses shows its reds; a false red is fixed in the geometry, never by switching the check off.

### Fixed

- `scripts/build_platform_test.js` no longer continues when `src/export/scene.js` cannot be loaded: validation fails
  loudly instead of being skipped.
- Built meshes no longer repeat node names. A word resolves into up to three segments that share its id, and
  `src/geom/mesh.js` named cells by the id alone, so the names repeated (16 of 31 nodes on a five-word track). That also
  made the self-intersection check report crossings on tracks that do not cross, which refused every default export.
  Pieces are now named by id and part.
- The palette no longer shows "nullnull" under the track list.
- The window no longer scrolls: the panels scroll inside themselves.
- A panel that fails to start (the preview, the camera, validation, handles) now says why in its own area.
- The built app now carries `tools/`, which the exporter needs. The in-window module loader no longer breaks on a file
  that declares a name it also provides.
- The preview canvas follows devicePixelRatio (sharp on scaled displays) and resizes with it.
- Ctrl, Alt and Meta shortcuts no longer switch the camera (Ctrl+C is copy).
- The lap sim's speed cap was 745 km/h, read from the speed at Centrifuge's hardest moment rather than a top speed, and
  both Centrifuge laps run above it. It is now the measured p99, 764 km/h (`docs/FINDINGS.md` §3d).
- The self-intersection check pairs each mesh with its own cell by position, never by name. A repeated name can no
  longer make one pass of the road "meet" itself. Real crossings and stacks are still found.
- The jump counter read "0 jumps" with a jump placed, because it counted drawn landing arcs, which leave out a jump
  still waiting for its landing. It now counts every jump and names the ones waiting.
- Validation measured every jump one station step too long (from the station before the lip), so a 12 m gap read as 13
  m, and the 6.3 g landing seemed to need 311 km/h instead of 287.
- The right-hand panel no longer scrolls sideways: wide content (the load graph) is held to the panel's width.
- The marker check read a 3-abreast grid as pointing 40° off the road. It took the race direction from the back slot to
  pole, which crosses the road when they stand in different columns; it now removes the across part, and a grid
  pointing backwards is still refused.
- An edit that would leave the track unable to resolve (for example an end roll the next word cannot follow) is refused
  with a message and changes nothing, as a drag frame is; before, it was committed with a hidden resolve error. Found
  by the soak.
- The colour levels no longer scan every red and amber range for every station on every edit.
- The soak script sculpts only top-level words, so a starter phrase in the palette no longer crashes it.
- The app mutation harness copies `tools/` as well as `src/`, so the export's kn5 read-back works in its temp copies.
