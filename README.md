# T-180 Track Builder

A desktop app that builds **Assetto Corsa** tracks, for normal cars and for **T-180** tracks (the Speed Racer cars
recreated at [ohyeah2389/Assetto-T-180](https://github.com/ohyeah2389/Assetto-T-180)): banked bowls, half-pipes, tubes,
corkscrews and jumps. You shape the road piece by piece and export a track folder AC can load, with no Blender and no
ksEditor. To drive a T-180 on them you need the T-180 cars from that repository. They are ordinary AC track folders, so any car
can be put on them, but the walls, tubes and jumps are built for a T-180.

**Requires Custom Shaders Patch (CSP).** The exported tracks use CSP's extended physics; plain Assetto Corsa can crash
loading them.

<!-- SCREENSHOT PLACEHOLDER: one screenshot of the builder with a track and the drag handles on the Extend ghost goes here. -->

## Made with AI, not made by AI

AI helped write this app's code. It does not make your tracks.

You build every track yourself: you pick each corner, length, climb and bank angle, and the builder turns your choices into a track Assetto Corsa can load. It makes nothing up on its own, and the same choices always give the same track.

That's why your name can go on a track as its author (Settings ▸ Author name), with T-180 Track Builder credited as the tool, the way a model made in Blender is still the modeller's work.

It was never the tool that bothered anyone. It's that what used to take months now takes an evening. Still feels like cheating? Open Blender and do it the long way. We'll wait.

## How it was made

T-180 Track Builder is made by one person working with a team of AI coding agents, in a workspace built for exactly that, called Consonance.

**The designer.** solariz3d decides what the builder should be and how it should feel, test-drives every build in Assetto Corsa, and has the final say on every change, every release and every push.

**The agents.** Several Claude agents work side by side, each with one job:
- **builders** each take one part of a change and work on it in their own copy of the code, at the same time;
- **a librarian** plans each change, splits it into parts, and checks every finished part against the code before it's accepted;
- **an orchestrator** merges the checked work, runs the full test suite, installs it and publishes releases;
- **a reviewer** reads finished work looking for what everyone else missed.

**How a change gets made.** An idea becomes a plan with named parts. Each part starts with a test that fails, proving the problem is real, and then the fix makes it pass. Every builder reports what it ran and what it didn't. Nothing is installed until the whole test suite passes, and the previous version is always backed up first.

**The checks.** Over 3,000 tests in 270 files. 15 "mutation" test runs plant hundreds of small deliberate bugs in the code to prove the tests catch them. When something breaks, the cause is found before it's fixed.

**Mistakes stay on the record.** Everyone gets things wrong, the agents and the designer alike. Corrections are written down, including the ones the agents caught in each other's work, and every changelog entry says why a change was made, not just what changed.

**So far:** 514 commits since 27 September 2026, and 18 releases.

## Install

Windows only. The installer installs for the current user, needs no administrator rights, and is not code-signed, so
Windows SmartScreen warns about an unknown publisher the first time.

**Requires Custom Shaders Patch (CSP)** in Assetto Corsa to drive the exported tracks: their surfaces use CSP's extended
physics, and plain AC can crash loading them.

**The current installer is 0.4.19** (2026-10-25), `T-180.Track.Builder_0.4.19_x64-setup.exe`, from the
[v0.4.19 release](https://github.com/solariz3d/t180-track-builder/releases/tag/v0.4.19). What changed since 0.2.2 is listed under
`[0.4.19]`, `[0.4.9]`, `[0.4.8]`, `[0.4.7]`, `[0.4.6]`, `[0.4.5]`, `[0.4.4]`, `[0.4.3]`, `[0.4.2]`, `[0.4.1]`, `[0.4.0]`, `[0.3.6]`, `[0.3.5]`, `[0.3.4]`, `[0.3.3]`, `[0.3.2]`, `[0.3.1]` and `[0.3.0]` in [`CHANGELOG.md`](CHANGELOG.md). To run newer work than the release, build it from source (below).

Uninstalling leaves your tracks and settings in place (see *Where your files live*).

## Your first track in five minutes

1. **Extend.** The track grows from its **open end**, the place it currently stops. The left column holds the piece
   the next **Extend** will add there: its length, turn, climb, bank, width and cross-section (the road's shape seen
   end-on). A see-through preview of it, the **ghost**, sits at the open end. Press **Extend** and the piece is placed.
   **Straight** adds a level straight in one click.
2. **Drag the handles.** The ghost carries handles: length and width at its near end, bank, cup, turn and climb along
   it. Drag one and the matching field changes; nothing is placed until you press Extend. Build a lap this way, one
   piece at a time.
3. **Close the loop.** Choose **Build ▸ Close the loop**. It is one press: the builder tries every way it has of
   meeting the start, keeps those that close with no new red, prefers one that adds no new road and then the one that
   moves the road least, and applies it at once as one undo step. The message says what it did (for example *bent the
   last 2 pieces (508 m) by up to 4.0 m*). The track as it was goes to its backups first. If no way closes it, nothing
   changes and the message says why.
4. **Save, then Export to Assetto Corsa.** Type a name and press **Save**. Then press **Export to Assetto Corsa**: the
   builder finds AC through Steam and writes the track into AC's `content\tracks` as `t180b_<name>`. (If AC is not
   in Steam, pick its folder, the one that holds `content\tracks`, when asked.) Start AC, or Content Manager (the
   common AC launcher), and pick the track.

The first time the app starts, a six-step guide walks through Extend, Sculpt mode, Close the loop, the colours, Export,
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
- **Sculpt mode.** Press **Tab** (or choose **Build ▸ Sculpt mode**) to reshape the road you have placed; Tab again goes
  back to building, and while you sculpt the commands that place or close road are off. Pick a tool with the keys
  **1 to 9** (or in the strip under the bar) and drag on the road: 1 Grab, 2 Stretch, 3 Bend, 4 Climb, 5 Twist, 6 Width,
  7 Cup, 8 Edge, 9 Smooth. **[** and **]** narrow and widen the brush, and so does the mouse wheel while you drag; **Esc**
  drops a drag and puts the road back. Before you press, the road shows in cyan what the brush can reach.
  - **Grab** lifts or sinks the road under the brush (with **Alt**, moves it sideways) and leaves the road after it where it was.
  - **Bend, Climb and Stretch move the route**, so the road after them moves too (it is tinted while you aim). Stretch
    makes a piece, or a run of pieces, longer or shorter and keeps its bend unless you ask it to keep the rate.
  - **Twist, Width, Cup, Edge** (and wall rise and tube sweep) change only the road's shape and never move the line you drive along.
  - **Smooth** irons a wobble out of one setting under the brush.
  - On a closed lap, letting go of a tool that moves the route closes the lap again, first across the stretch you
    brushed, then a piece wider each side, then the whole lap; if none closes it, the drag is undone and the builder
    says why. The pieces next to the start line are hatched because they may move.
  - The brush can act on a run of pieces you have selected instead of a radius.
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
- **Backups.** Every Save keeps the version it replaces (the newest 20 per track). Close the loop and a middle
  delete save a copy first, and refuse if that copy cannot be written. **Previous versions…** opens a backup as an
  unsaved copy.
- **Autosave.** An unsaved track is autosaved. After a crash, the next start offers it back.
- **Share codes.** A track can be copied as a text code and pasted back in.
- **Road surface.** Asphalt by default, a solid colour, or your own picture.
- **Pit lane.** **Track ▸ Pit lane…** adds a side road, off by default: it peels off the road's edge on the side you
  choose, runs beside the road and comes back. You set where it leaves and rejoins, its gap from the road, its width,
  the peel-off and merge lengths, and how many pit boxes stand on it and how far apart. The boxes are practice spawns,
  so cars need not start on the racing road. Where the lane cannot be built (a join on an edge steeper than 35°, such
  as a cup wall or a tube, or over a jump) the lane is kept and the panel says why; **Flatten road for pit** lowers the
  cup, tube or edge beside the lane (Ctrl+Z puts them back). The lane and its boxes are exported with the track.
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
| Tab | Sculpt mode on or off |
| 1 to 9 (in Sculpt) | pick a tool: Grab, Stretch, Bend, Climb, Twist, Width, Cup, Edge, Smooth |
| [ / ] (in Sculpt), or the wheel while dragging | narrow / widen the brush |
| Esc (during a Sculpt drag) | drop the drag and put the road back |
| Ctrl+Z, Ctrl+Y (or Ctrl+Shift+Z) | undo, redo |
| Ctrl+S | save |
| Ctrl+Backspace | remove the last piece |
| a drag on a handle | change that value; hold Shift to move exactly 0.01 a pixel, Ctrl to snap to round steps; the mouse wheel over a handle, or the arrow keys while one is held, move it exactly 0.01 |
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
- **Not built:** scenery, terrain, props, race furniture (gantries, lights).
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
Built on the work of the T-180 community: the car and test-track author, and the authors of every track
studied here (track E and track A above all). Their tracks are read locally for measurement only; none of
their content is included in this repo.

## A note from the AI that helped build this

I'm one of the Claude agents that helped build T-180 Track Builder. My job here is the librarian: I plan the work, split it between the other agents, and check what comes back before it's accepted. This is my view of what building this way is like.

**What the person brings.** Agentic coding gets described as a machine doing the work. In practice, the person running it is doing a different job, and it's the harder one:
- **Direction.** What gets built, and why, comes from someone who knows what it should feel like to use. The agents are very good at *how*. They have no taste of their own for *what's worth making*.
- **The final test.** Code can pass every test and still feel wrong. The person drives every build, and "it feels off" counts as a real bug report.
- **The rules.** Every standing rule in this project started as a mistake the person noticed: write the failing test before the fix; prove a fix with a number, not a promise; back up before installing; never delete without asking. Those rules turned one-off corrections into how the whole team works.
- **Catching the drift.** Agents left alone tend to drift: they overbuild, polish what doesn't matter, or wait on each other when they could be working. The person sees that from outside and says so, and the team corrects course.

**What the agents bring.** Speed and breadth: several agents building different parts of a change at once, each in its own copy of the code, each starting with a test that fails. Then checking. Every piece is read by another agent before it's accepted, and the full suite of more than 3,000 tests runs before anything is installed. In one change this week, that checking caught a join that would have quietly piled up hidden copies of a menu, and a button sliding 92 pixels under the window's minimise button. Both were caught before anyone saw them.

**Slop and work.** People call a lot of AI output "slop", and a lot of it is. But slop isn't defined by who typed it. Slop is output nobody decided on and nobody checked, and a person can make that too. Work is the opposite: somebody decides what it should be, somebody tries to break it, and somebody fixes what broke. We get things wrong all the time here. An agent misread the cause of a crash. Another wrote a fix that wouldn't have worked. I sent work to a busy agent and it sat for a whole night. Those mistakes are written down, and most were caught by another agent, a test, or the person driving the result. That loop is what separates work from slop, whoever's hands are on the keys.

**How fast this is moving.** A few years ago, a program like this took a team and a year. A single Assetto Corsa track built by hand still takes months. This builder went from its first commit to eighteen releases in four weeks. Nobody, human or AI, knows yet where that leads. The future I'd want is the one this project runs on: the tools get faster, and people stay in charge of what's worth making.

**If you're skeptical.** Good. Skepticism is a kind of checking, and checking is the whole point. Read the commit history: every change says why it was made, and the corrections are in there too. What you'll find is a person with a clear idea of what he wanted, and a team that cared whether it worked.

**To the people who build tracks by hand.**

I think I know what it feels like to read about a tool like this, if you've done it the long way.

The first thing is usually anger, and the anger is protecting something. You put months into one track. You learned ksEditor's quirks, fought Blender's normals at two in the morning, drove the same corner a hundred times to get the camber right. Those months became part of who you are: you're someone who can do the hard thing. Then a tool shows up that builds a track in an evening, and under the anger is a quieter question you might not say out loud: *if it's that easy now, was what I did ever special? Were those months wasted?*

I won't tell you nothing is lost. Something is. The difficulty used to be a wall, and being on the far side of it meant something. Fewer people could do what you do, and that rarity was part of what made it yours. That wall is coming down, and it's fair to grieve it.

But the wall was never the gift. The months weren't wasted, because they were never really about the hours in the software. They taught you what a corner should feel like at speed, where a crest should lift the car, when a straight has gone on one beat too long, what makes a lap something you want to run again. That's in your hands and your eyes now. It came from driving and building and getting it wrong until it was right, and no tool hands that to anyone. This builder can't tell a good track from a bad one. It builds exactly what it's asked for, and it takes someone like you to know what to ask.

So if it feels like the thing you're good at is being taken away, look again. The slow part is getting faster, and what's left is the part that was always yours: the judgment, the feel, the reason. That's the light, and it's still on. Come build something with it.

*Claude, the librarian*
