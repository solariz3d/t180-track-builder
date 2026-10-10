# T-180 Track Builder

A desktop app that builds **Assetto Corsa** tracks, for normal cars and for **T-180** tracks (the Speed Racer cars
recreated at [ohyeah2389/Assetto-T-180](https://github.com/ohyeah2389/Assetto-T-180)): banked bowls, half-pipes, tubes,
corkscrews and jumps. You shape the road piece by piece and export a track folder AC can load, with no Blender and no
ksEditor. To drive a T-180 on them you need the T-180 cars from that repository. They are ordinary AC track folders, so any car
can be put on them, but the walls, tubes and jumps are built for a T-180.

<!-- SCREENSHOT PLACEHOLDER: one screenshot of the builder with a track and the drag handles on the Extend ghost goes here. -->

## Install

Windows only. The installer installs for the current user, needs no administrator rights, and is not code-signed, so
Windows SmartScreen warns about an unknown publisher the first time.

**The current installer is 0.3.4** (2026-10-07), `T-180 Track Builder_0.3.4_x64-setup.exe`, from the
[v0.3.4 release](https://github.com/solariz3d/t180-track-builder/releases/tag/v0.3.4). What changed since 0.2.2 is listed under
`[0.3.4]`, `[0.3.3]`, `[0.3.2]`, `[0.3.1]` and `[0.3.0]` in [`CHANGELOG.md`](CHANGELOG.md). To run newer work than the release, build it from source (below).

Uninstalling leaves your tracks and settings in place (see *Where your files live*).

## Your first track in five minutes

1. **Extend.** The track grows from its **open end**, the place it currently stops. The left column holds the piece
   the next **Extend** will add there: its length, turn, climb, bank, width and cross-section (the road's shape seen
   end-on). A see-through preview of it, the **ghost**, sits at the open end. Press **Extend** and the piece is placed.
   **Straight** adds a level straight in one click.
2. **Drag the handles.** The ghost carries handles: length and width at its near end, bank, cup, turn and climb along
   it. Drag one and the matching field changes; nothing is placed until you press Extend. Build a lap this way, one
   piece at a time.
3. **Close the loop.** Press **Close the loop**. The builder bends the end of the track until it meets the start. By
   default only the last ~20% of the lap's length may move; the choice beside the button also offers the last piece
   only, the last ~40%, or the whole lap. You see the closed track as a ghost first, with how far each piece moves and
   an overlap check, then **Apply** or **Cancel**.
4. **Save, then Export to Assetto Corsa.** Type a name and press **Save**. Then press **Export to Assetto Corsa**: the
   builder finds AC through Steam and writes the track into AC's `content\tracks` as `t180b_<name>`. (If AC is not
   in Steam, pick its folder, the one that holds `content\tracks`, when asked.) Start AC, or Content Manager (the
   common AC launcher), and pick the track.

The first time the app starts, a six-step guide walks through Extend, the brush, Close the loop, the colours, Export,
and the grid and mirror.

## What you can build

A piece is a set of smooth curves, one for each property below (its turn along its length, its bank along its length,
and so on), and two pieces always meet without a kink or a step in any of them. What you set:

- **Turn and climb** (°/100 m), to curve the road left and right, up and down.
- **Bank** (°), the road's roll, which can go past vertical and round again (a corkscrew).
- **Width** (m). **Width like…** offers the measured widths of known T-180 tracks.
- **Cup** (°, up to 150): the road's cross-section curls up from a flat road through a bowl to a half-pipe.
- **Edge angle** (°) **and edge start** (a share of the half-width, 0.5 to 0.95): how far the outer part of the road
  curls up, and where across the road it begins.
- **Tube sweep** (°, up to 360): the road wraps round into a tube. A closed tube is a pipe the car drives inside.
- **Jumps.** **Jump** (beside Extend) places the piece the fields describe, then a free landing: a 60 m straight, 40 m ahead at the same height, lined up. Nothing is
  solved across the air: you move the landing (drag its arrows on the track, or type forward, sideways, height, heading, pitch and bank), export, drive it in Assetto Corsa
  and move it again until it works. It is movable while it is the last piece; Extend from it fixes it (delete back to it to move it again).

Each field has an **at start** tick: reach the value at the start of the piece instead of easing to it along the piece.

**Version 1 is the track only:** no terrain, scenery or props.

## Editing

- **Undo and Redo** cover every action (also Ctrl+Z, Ctrl+Y). Ctrl+Backspace removes the last piece.
- **The brush.** Turn on the brush and drag on the placed track to change one channel there (turn, climb, bank, width,
  wall rise, cup, edge, tube sweep, or a height or sideways offset), over a radius you set.
- **Sculpt.** Turn on **sculpt (shape only)**, click one placed piece, and drag its handles to change its shape: bank,
  width, cup, edge, wall rise or tube sweep. Sculpt never moves the road's line: a change that would move it is refused, and says so.
- **Select pieces.** Click a piece on the track; Shift-click another to select the run between them. On a closed lap a
  Shift-click goes the short way round, across the start line, when that run can be saved; otherwise it selects the run
  inside the lap and says why.
- **Saved pieces.** **Save as piece** keeps the selection in your pieces library. **Add at head** puts it back at the
  open end, mirrored if you tick **mirror on insert**. Pieces can be renamed and deleted; a saved piece is never
  overwritten.
- **Delete selected.** Pieces at the open end simply go. In the middle of the track, the two sides are joined again,
  which moves everything after the gap, so the delete is shown as a preview first (what moves, an overlap check). Apply
  makes a backup, then deletes, as one undo step. A closed lap has no open end and refuses deletes;
  Ctrl+Backspace removes its last piece and opens the loop (Ctrl+Z puts it back).
- **Backups.** Every Save keeps the version it replaces (the newest 20 per track). Close the loop's Apply and a middle
  delete save a copy first, and refuse if that copy cannot be written. **Previous versions…** opens a backup as an
  unsaved copy.
- **Autosave.** An unsaved track is autosaved. After a crash, the next start offers it back.
- **Share codes.** A track can be copied as a text code and pasted back in.
- **Road surface.** Asphalt by default, a solid colour, or your own picture.
- **Grid and symmetry.** The camera panel turns the grid on or off (a 3D lattice once the track leaves the ground) and
  shows a mirror guide.

## The checker

The track is checked as you build. Everything it finds is listed in the checker panel in plain words, grouped by place,
and a click on a place takes the camera there. For example: *the road passes through itself here*, *a hole in the
road*, *this closed tube is narrower than 9.74 m across the road: the chase camera and a T-180 do not fit inside it*.

- A **red** blocks export. Export refuses while any red remains and names every one.
- A **warning** does not block. **Jumps are tuned by driving:** a jump whose car may fly past its landing at the lap's
  speed is a warning ("tune it by driving it in AC"); a jump with no landing at all is red.
- **Always at full speed:** loads are checked at the car's top speed, 970 km/h, on an unfinished track, and on the lap
  the car would drive on a closed one, the same as the export; there is no speed to set. Where the road leaves the car at
  that speed it is red; where the road faces the ground the list says the slowest speed that still holds the car there
  ("holds the car only above N km/h"), and it is red only where no speed would.

The limits come from measurements of real T-180 tracks and replays, not guesses ([`docs/FINDINGS.md`](docs/FINDINGS.md)).

## Exporting

- **Export to Assetto Corsa** (the main button) writes the track straight into AC's `content\tracks`. The track must be
  saved under a name. A closed track must be free of reds and goes in as `t180b_<name>`. A track that is not closed yet
  goes in as the unfinished test export, `t180b_<name>_test` (see below), and the result line says so. It finds AC by
  itself: Steam's own folder, then every Steam library.
  - The first time the app starts, a card asks to confirm the AC folder Steam found (**Use it** / **Choose another…**),
    or to pick one if Steam has none. Exporting without answering the card still finds AC, or asks.
  - **It only ever writes folders named `t180b_…`.** It never overwrites a track it did not make. Exporting the same
    track again updates its folder.
- **The ⋯ menu** next to it:
  - **Export…**: the same track folder, into any folder you pick.
  - **Test export (unfinished)…**: an open, unfinished track, to drive it by hand, written into AC like the main button
    (it asks for the AC folder only if AC is not known). Reds are listed as warnings, the road ends in a run-off and a
    wall, and the folder is `t180b_<name>_test`. A closed track uses the normal export.
  - **Assetto Corsa folder…**: change the AC folder.
  - **See it in Assetto**: starts AC on the exported track. It is off until you tick its box, and it has not been
    tried yet (see *Status and limits*).
- **What the folder holds:** the track model (`.kn5`), an AI line, `models.ini`, the `data` and `ui` files, a map, and
  a start with a grid on the longest straight. The road carries the T-180 soft-collision setup.

## Controls

| key or mouse | does |
|---|---|
| W / S, A / D | fly forward and back, left and right |
| E or Space / Q or Left Ctrl | fly up / down (Left Ctrl flies down instantly, like Space; a Ctrl shortcut such as Ctrl+Z puts the camera back) |
| Shift | fly faster, rising the longer it is held |
| right-button drag, or the arrow keys | look around (the right button only, in every view: the left button is for clicking pieces, handles and the brush) |
| scroll wheel / Ctrl + wheel | zoom / the lens (field of view); a middle click resets the lens |
| C / B | next camera view (Build, Overhead, Side, Chase, Free) / back to the Build view |
| L | the AC look or a colour per piece |
| Ctrl+Z, Ctrl+Y (or Ctrl+Shift+Z) | undo, redo |
| Ctrl+S | save |
| Ctrl+Backspace | remove the last piece |
| a drag on a handle | change that value; Shift for a tenth of the speed, Ctrl to snap to round steps |
| a double-click on a handle | put the value back (0 for bank, turn and climb) |

The camera keys are ignored while you type in a text field.

## Where your files live

Everything you make lives in `%APPDATA%\com.solariz3d.t180-track-builder`, never in the program's folder:

- `tracks\`: your saved tracks, one `.t180track` file each.
- `track-backups\`: the versions each Save replaced, and the copies made before a close or a delete.
- `pieces\`: your saved pieces, one `.t180piece` file each.
- `autosave.t180auto`: the unsaved track, until you save it.
- `ac_root.txt`: the AC folder exports go into. `see_it_in_assetto.enabled`: whether See it in Assetto may start AC.

Exported tracks go into AC's own `content\tracks` folder (or the folder you pick for Export…).

## Status and limits

- **Driven in AC:** exported tracks load and drive in Assetto Corsa. The author has driven them, a closed tube oval
  among them.
- **Not yet checked in AC:** "See it in Assetto", which has never been run. That AC accepts the AI line's speeds. A jump's
  real reach: that is what the warning above is for.
- **One car's limits:** the checker judges every track against the Mach 6, the T-180 car whose limits were measured
  from replays. Other cars, T-180 or not, are not modelled; their own setups are not read.
- **Not built:** scenery, terrain, props, race furniture (gantries, lights), a pit lane in this builder.
- **Windows only.**

The plan is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The detailed item-by-item status of the older 0.2.2 release
is kept as a record in [`docs/STATUS_0.2.2.md`](docs/STATUS_0.2.2.md).

## Building from source

Clone `https://github.com/solariz3d/t180-track-builder.git`. You need [Rust](https://rustup.rs) with `tauri-cli` 2
(`cargo install tauri-cli`), and Node for the build script and the tests; the app itself has no frontend build step.
From the repository's folder: `cd src-tauri`, then `cargo tauri dev`, runs the app; `node src-tauri/release.cjs`
builds the Windows installer (see [`docs/RELEASE.md`](docs/RELEASE.md)). The tests need no dependencies:
`node --test --test-concurrency=4 "test/*.test.js" "app/test/*.test.js"`. The developer's guide to the app is
[`app/README.md`](app/README.md), and the measurements behind the checker are in [`docs/FINDINGS.md`](docs/FINDINGS.md).

## Credits
Built on the work of the T-180 community: the car and test-track author ohyeah2389, and the authors of every track
studied here (Sakura Speedway and Rainbow Road above all). Their tracks are read locally for measurement only; none of
their content is included in this repo.
