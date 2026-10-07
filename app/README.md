# The app: T-180 Track Builder

A Tauri v2 desktop app built the way blackbox is built: a static web UI, plus a small Rust side for the disk. v1 is
**the track only**: no terrain, scenery or props. **The user builds it.** Like a coaster builder, the track grows from
its open end, and the user shapes the next piece there (its channels, in the Extend fields or by its handles) and
presses Extend. Since D239 this is the equation builder only; the word builder (pieces, fonts, tempos) is retired.

## Run it

    cd src-tauri
    cargo tauri dev        # the app window
    cargo build            # the native side alone

`src-tauri/build.rs` copies `app/`, `src/` and `tools/` into `src-tauri/dist/` before every build, keeping the
repository's layout, so a relative `require` means the same thing in the webview as under node.
`app/test/shell-dist.test.js` checks that every file the page loads is inside a copied folder. It reruns only when
`app/`, `src/` or `tools/` change, so an edit made in `dist/` by hand stays until one of those does.

- **The geometry core, validation and the document model all run in the webview.** No mesh data crosses IPC, during a
  drag or otherwise (ARCHITECTURE §9).
- **The native side only reads and writes the user's tracks, piece library and autosave,** by name, in the app's
  data folder, and writes an exported track into the folder the user picks (`src-tauri/src/lib.rs`).
- **Export runs `src/export/fromwords.js` `exportTrack()` unchanged, in the webview,** against an in-memory disk
  (`app/export/node-shim.js`: the few node calls the exporter makes). The files it wrote go to the native side, which
  writes them. It is tested byte-identical to node's own export, apart from the PNG compression. No game is launched
  and nothing is installed. **The self-intersection check is always on;** the app has no switch for it, and a refused
  export lists its reds (the ruling of 2026-09-27: settle a false red in the geometry, never by loosening the check).

## The pieces, and who owns them

| path | owner | what |
|---|---|---|
| `src-tauri/` | A | the native shell: window, file commands (tracks, library, autosave), `write_export`, the folder dialog |
| `app/index.html` | A | the page and its glue: loads the modules, wires storage to the Tauri commands, keyboard shortcuts |
| `app/shell.js` | A | the old piece builder's state and actions (D239: no page mounts it; its keys MOVED to `app/core/keys.js` (D239 note); kept as the driver of the shared preview and validation tests, see "One builder" below) |
| `app/lib/cjs.js` | A | runs the program's CommonJS files in the webview |
| `app/palette/` | A | `panels.js` mounts the panels below (D239: the piece palette, `palette.js`, is removed) |
| `app/export/` | A | the Export button's logic: the AC guard, and the exporter run in memory (`node-shim.js`) |
| `app/preview/` | C | the WebGL preview of the track |
| `app/camera/` | C | the camera modes: build view, the fixed angles, free |
| `app/validate-ui/` | E | live colour along the track, jump arcs |
| `app/test/` | each owner, by prefix | `shell*`, `palette*`, `export*` are A's; others as named |

## The seam: what C and E plug into

*This section describes the seam as it was built for the retired word builder (`app/shell.js`: words, `sculpt(id, patch)`). The page now mounts the same
panels on the core shell (`app/core/coreshell.js`), which keeps the same state shape; see "One builder" below.*

**Each panel is a directory with an `index.js` that exports `mount(root, shell)`.** `app/index.html` loads
`app/preview/index.js`, `app/camera/index.js`, `app/validate-ui/index.js`, the core's road surface, share, install and the guide through the loader.
Each one is optional: if it is not there yet, the page shows a quiet "not plugged in yet" note, and everything else
works. **If it is there and FAILS** (it does not load, exports no `mount`, or `mount` throws, rejects, or returns an
`Error` or `{ error }`), its area shows "The <panel> could not start: <why>" as an alert (`app/palette/panels.js`).
So a panel can report its own failure by returning it.

- **`root`** is the element the panel owns:
  - `#preview` for `preview` (a `<canvas>` is theirs to create);
  - `#camera` (a small control strip) for `camera`;
  - `#validation` for `validate-ui`;
  - `#share`, `#install` and `#guide` for the carried features (D239).
- **`shell`** is the whole contract. Nothing else is shared:
  - `shell.getState()` returns the state:
    - `history.present`, the document;
    - `history.dragBase`, set while a drag is open;
    - `resolved`, which is `resolve(doc)`, kept incrementally, so its `segments` are what `buildPath` takes;
    - `resolveError`, a string when the document cannot resolve;
    - `selection`, `pickers`, `message`.
  - `shell.subscribe(fn)` calls `fn(state)` after every change and returns an unsubscribe. A panel rebuilds from
    `state.resolved`. It should keep the previous path and use `extendPath` / `revalidate` when only the tail changed:
    `resolved.resolvedFrom` is the first changed word.
  - **To edit, a panel calls the shell, never the document:**
    - `shell.sculpt(id, patch)` is one undo step;
    - `shell.beginDrag()`, `shell.dragTo(id, patch)` … `shell.endDrag()` are one undo step for the whole drag.
    - `patch` is `{ handles: { … } }` as in `src/doc/document.js` `editWord`.
  - **Physics bounds** for a handle come from E's own code (`src/validate/bounds.js`, `app/handles/`). The shell
    neither computes nor enforces them. `src/doc/library.js` `handleInfo(doc, id, boundsFn)` is the model's hook, if a
    panel wants each handle's value, unit and range in one place.
- **The camera** reads the head from the path (`path.head` from `src/geom`), not from the shell. The shell holds no
  derived geometry, so the frame is never stored twice.

**Keys (`app/core/keys.js` `keyAction`, bound to the core shell by its `bindKeys` in `index.html`; moved from `app/shell.js`, D239):** Ctrl+Z undo · Ctrl+Y or Ctrl+Shift+Z redo ·
Ctrl+Backspace remove the head (a bare Backspace does nothing: it is too easy to hit by accident) · Ctrl+S save. A
panel that wants a key asks for it in this file first, so two panels never bind the same one.

## One builder (D239; until then two, D186)

The page is the **equation builder** (the core: `src/core`, `app/core`) and nothing else. The keeper: "can we keep only the equation
mode?" The Pieces mode is removed: the header's switch, `?mode=pieces`, the remembered `t180.mode` setting and the pieces branch of
`app/index.html`. Four of its features were **carried onto the equation page**, each working on the equation track:

- **Export to Assetto Corsa (was Install to AC) / See it in Assetto** (`app/install`): with no AC folder remembered, the native side finds
  it through Steam (registry SteamPath, then every library in `steamapps\libraryfolders.vdf`; `src-tauri/src/ac.rs` root_or_find, D250) and
  remembers it, so no folder is picked; only when Steam has no AC does it ask. The install is the Export button's own build (`shell.buildExport`, the same
  road surface), written as `t180b_<saved name>` into `content\tracks` by the native side, with D234's rules; See it is off by default.
  D264: on an OPEN track it installs the TEST export instead (`t180b_<saved name>_test`, D243a's build) and says so; the ⋯ menu's Test export
  goes into AC by the same path (the AC folder picker only when AC is not known).
- **Autosave and crash restore** (`app/core/coreshell.js`): the open track is autosaved (`{ schema: 1, kind: 'core', … }`) while it has
  unsaved changes; a named save or a clean exit clears it; the next start offers it back in the banner (Restore it / Discard it).
  An autosave left by the old Pieces builder is copied aside as a saved word track (named in the start message) before anything can
  overwrite it.
- **Share codes** (`app/share`): an equation track's code is its `t180b.core/4` text with the compression and checksum every code has
  (`src/doc/code.js` kind `e`); a code from the old Pieces builder (`t180d…`, `t180p…`) is refused by name, `CODE_PIECES`.
- **The getting-started guide** (`app/onboarding`): six steps, Extend, the brush, Close the loop, the colours, Export, the grid and mirror.

**Save keeps the previous version (D239 amendment).** Every Save moves the file it overwrites into `track-backups` as
`<name>.<yyyy-mm-dd_hhmmss>.t180track` (natively, `src-tauri/src/backups.rs`; the newest 20 per track kept, only files in that exact
form pruned). `shell.backupNow(reason)` writes the track as it is now; Close's Apply (D242, the one close path) awaits it first and does not
close if it fails. "Previous versions…" beside Open… opens one as an unsaved copy.

**Removed** (no page mounts them any more): `app/palette/palette.js` (the piece palette), `app/handles/` (word handles),
`app/texture/index.js` (the per-word textures panel), `app/onboarding/defaults.js` (the piece palette's first-run pickers).
**Kept, and why:** `app/shell.js`: its keys moved to `app/core/keys.js` and the page no longer loads it, but 23 test files and three scripts (bench, prove_render, soak) drive the
shared preview, validation and export code through it (porting them to the core shell is its own lap); `app/palette/panels.js` (mounts every panel);
`app/texture/panel.js` (the core's road surface uses its `nameFromFile`); `app/texmaker/` (the texture maker: it was reachable only
through the removed per-word panel, so it is mounted nowhere now; whether the equation page gets it is the keeper's call);
`app/markers/` (already mounted nowhere before D239, out of this lap's scope); and every `src/` word module the exporter uses
(`src/export/fromwords.js exportSegments`, `src/doc/*`).

**The keeper's saved word tracks are never deleted.** They are the files WITHOUT the `eq-` prefix in the app's tracks folder,
`%APPDATA%\com.solariz3d.t180-track-builder\tracks` (a `.t180track` file each); the equation builder lists only `eq-` files, so they no
longer show in Open…, but they stay on disk as they were.

| path | what |
|---|---|
| `app/core/coreshell.js` | the core's state and actions, no DOM (tested headless): extend, the brush drag, close, export, a local example, save/open under the `eq-` prefix. D242: the panel's Close PROPOSES (`proposeClose`: a local close of the last ~20% by default, how far each piece moves, and an overlap check of the closed track, shown as a ghost), then `applyClose` (one undo step; it first calls the shell's `backupNow('pre-close')` when there is one, C's D239) or `cancelClose`; `close()` is the old immediate whole-lap close. A refused export names every red in plain words, grouped (`app/validate-ui/redgroups.js`) |
| `app/core/panel.js` | the core's controls in the left column. D242: Straight (turn and climb 0 at start, in one click), the Close preview's Apply/Cancel, and Undo puts the undone Extend's own field values back |
| `app/core/widthlike.js` | the "width like…" drop-down's entries (D232): the known tracks' measured widths from `src/doc/widths.json`, in metres round-and-across for a tube |
| `app/core/textures.js` | the core's road surface (D228): asphalt by default, solid colour, or your own picture; announces the set as `t180:textures`, which the preview draws and the core page's Export writes (`src/texture/flow.js` lays its coordinates on the path's arc length, a closed tube wraps a whole number of repeats) |
| `app/core/index.js` | its `mount(root, shell)` |

**The core shell keeps the seam's state shape,** `state.resolved = { segments, closed }` from `src/core/adapter.js toSegments`,
so the preview, the cameras and validation are reused unchanged. The trackmodel diffs the segments and extends or sculpts the
mesh itself.

**In the webview, the core is loaded with the exporter's node shim** (`app/export/node-shim.js`), because it reaches
`tools/piecewise.cjs`, whose command-line half requires `fs` and `path`. Nothing touches the disk.

**Events the core's panel adds** (the preview answers them, `app/preview/index.js`):
- `t180-pick` `{ x, y, reply }`: the track station under a canvas point.

**Events the 3D grid and the symmetry guides add** (D237, `app/preview/guides.js`; the preview answers them, `app/preview/index.js`; the buttons are in the camera panel, `app/camera/index.js`):
- `t180:guides` `{ grid?, mirror?, centre? }`: grid `auto` | `ground` | `3d` | `off`; mirror `off` | `x` | `z` | `both`; centre `{ x, z }` or `null` (the box's middle);
- `t180:guides-state` `{ grid, drawn, flat, range, mirror, centre, gap, lines, levels, spacing }`: what is asked and what is drawn, on mount and on every change;
- `t180:guides-request` `{ reply }`: the current state at once, for a panel mounted after the preview.
None of it reads or writes the document or the export: the mirror ghost is a picture of the centreline reflected, not an edit.

**Export** goes through `src/export/fromwords.js exportSegments`, the same route as `exportTrack` after the words resolve, via
`app/export/export.js runSegments`.

## Files on disk

- **A track** is `eq-<name>.t180track`: the core document's canonical text (`src/core/document.js`, schema
  `t180b.core/4`), in `<app data>/tracks/`. A file there WITHOUT the `eq-` prefix is a track of the retired word builder
  (`src/doc/serial.js`): it is not listed in Open…, and it is never deleted.
- **The retired word builder's library** (`library.t180lib`, `src/doc/library.js`) is no longer read by the page; saved
  pieces are the `.t180piece` files below.
- **The free jump (D258; replaces D243's Add jump: gap, drop, landing angle and the ballistic arcs are gone, `jumpplan.js` with them).** The keeper's way: the Jump button sits beside Extend in `app/core/panel.js` and calls
  the shell's `jump(extendOpts)` (`src/core/jump.js` `jumpHere`, E's): the piece the fields describe as Extend would place it (the take-off), a free flight to a default landing and a 60 m straight, ONE undo step.
  The core's refusals are said in plain words (`app/core/jumpwords.js`). While the landing is the head (`shell.landing()`: the last piece, or the flight waiting for one) the landing block under the button shows its pose in six
  number boxes (forward, sideways + left, height + up in m; heading, pitch, bank in degrees: `app/core/landing.js` BOXES, `shell.moveLanding`, one undo step each) and `app/core/handles.js` draws FOUR handles on it
  instead of the Extend ghost's (`LANDING_ORDER`: forward, sideways, height, heading). Their arrows ARE the take-off's heading frame (`landing.js` `framesOf` reads it off the built path), so an arrow moves the number of its
  box; each mark sits 10, 8, 6 and 15 m out along its own arrow so they can be picked apart. A drag is the shell's `beginLanding` / `landingTo` / `endLanding` (ONE undo step; a step the core refuses, a landing under 1 m from
  the take-off, leaves the last good one). `app/core/flightlayer.js` only draws a dashed centreline across each flight (no physics). Extend from the landing fixes it (LANDING_NOT_HEAD, said in words); `removeHead` makes it
  the head again. No real-window test of the pointer lock for this: rows and fake hosts only (`app/test/jump-ui.test.js`, `core-pieces-ui.test.js` rows 14 to 14c, `handles.test.js` row 14).

- **Grip per piece (D261, the UI half).** `app/core/panel.js` has a grip % field in Extend (`gripF`: it shows `shell.headGrip()`, the road at the head's grip; `gripOpt()` sends a changed value as `extendOptions({ grip })`, a value left as shown sends none, so the core's default, the last road's grip, applies), a "grip like…" drop-down from `src/doc/grips.json` (`app/core/griplike.js` `entries`: value = the row's whole percent, label "Thunderhead, 82%"), and `griplike.js` `check` / `note` for the words (a whole percent 50 to 150; "untested: drive it" outside 60 to 110; the checker does not model grip). `app/core/piecesui.js` adds the selection's grip box, its own drop-down and Set grip, which call `shell.setGrip` (one undo step on the selection's road pieces, selection kept). `app/core/griplayer.js` draws the road pieces' centrelines (the selection layer's projection) in `gripColour(g)` while "colour by grip" is ticked, and `app/core/labels.js` `labelText(r, gripView)` adds "· grip N%" for a piece off 100 (or any, while the view is on). Rows: `app/test/core-pieces-ui.test.js` 16, 16b, 16c.
- **Drag handles and Sculpt (D244, D244b).** `app/core/handles.js` draws the handles on the Extend ghost (and, in Sculpt, on the one selected placed piece) as an overlay canvas, and holds the numbers (placement, a drag in px to a
- **Handle precision (D251).** A handle's drag is measured in screen PIXELS along its own on-screen arrow (`dragPixels`), not in metres of the world, so it feels the same at any zoom. `KINDS[kind].perPx` is the OLD per-metre speed over the px a metre takes at the default Build camera (measured in the window: turn 0.083, climb 0.082, bank 0.45°, cup 0.24°, width 0.068 m a pixel), LENGTH 0.42 m a pixel (5x, the keeper's 11:29/11:30 ask); Shift a tenth. `mount` asks for **pointer lock** on a press (`requestPointerLock`; locked, the drag position `drag.v` is the click point plus `movementX/Y`, the first movement after the lock dropped; refused or absent, `drag.v` is the pointer's position); a release, or the browser's Esc, ends it. `targetFor(kind, base, px, ctx, mods)` holds the value for `DETENT_PX` (6) of travel at the starting value and, for the `zero` kinds (bank, turn, climb), at 0 (0 turns it off); Ctrl snaps instead; the result is rounded to the kind's step (0.1) with or without Shift, then clamped. A double-click (two presses within `DOUBLE_MS`, 400 ms, that changed nothing, or a `dblclick` event) calls `resetHandle`: `host.begin/apply/end` once with `resetValue(kind, pre)`: 0 for the zero kinds, else the value before the last drag that moved it, kept only while the field still reads what that drag set. Tests: `app/test/handles.test.js` rows 4 and 8 to 13c and `core-pieces-ui.test.js` row 11.
  value, Shift and Ctrl) as pure functions. The panel is the host: an Extend drag types into the field and fires the field's own handler; a Sculpt drag is the shell's `beginSculpt` / `sculptTo` / `endSculpt`. The ghost's path comes from the
  preview (`ghostInfo()`, the `t180:ghost-request` event). Sculpt changes the shape channels only, and `app/core/centreline.js` refuses by name any step that would move the centreline (see `CHANGELOG.md`).
- **A saved piece (D240)** is `<name>.t180piece`: the text of `src/core/piece.js` (schema `t180b.piece/1`), in `<app data>/pieces/`. The panel (`app/core/piecesui.js`) selects pieces on the track
  (`app/core/selectionlayer.js` draws the selection), saves, lists, adds, renames and deletes them through the shell's `selectPiece`, `savePiece`, `listPieces`, `insertPiece`, `renamePiece`,
  `deletePieceFile`; deleting pieces of the track is `deleteSelection` (the open end at once, the middle through `proposeDelete` / `applyDelete` / `cancelDelete`, previewed like Close).
  The native side never overwrites a piece (`save_piece` refuses a name in use) and a name never carries a path.
- **The autosave** is `autosave.t180auto` in `<app data>/`: `{ schema, name, doc }` with the canonical text, written
  about 1.5 s after the last edit while the track is unsaved. It is cleared by saving under a name, or by closing with
  nothing unsaved. Closing with unsaved changes keeps it, so the next start offers the track back rather than losing
  it.
- **An export** is a `t180b_<name>` folder in the folder the user picks. Inside an AC install's `content\tracks`, only
  `t180b_*` folders are written: another track's folder is refused, by the page and again by the native side. **One exception, an
  empty folder:** a folder made directly in `content\tracks` ("T-180 TUBE OVAL") that is not `t180b_*` and is EMPTY is not another
  track, so the export goes into `content\tracks` as the normal `t180b_<track name>` and that empty folder is removed afterwards
  (Content Manager reads an empty track folder as "main layout is damaged"). A folder with anything in it is refused as before.
  The native side checks it again (`folder_is_empty`, `remove_empty_folder`: rmdir, never contents); `exporter.resolveTarget`.
- A name is 1–64 letters, digits, spaces, `_` or `-`, starting with a letter or digit. The shell checks it, and the
  native side checks it again: no path in a name ever reaches the disk.
