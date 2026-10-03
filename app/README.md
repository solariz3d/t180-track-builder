# The app: T-180 Track Builder

A Tauri v2 desktop app built the way blackbox is built: a static web UI, plus a small Rust side for the disk. v1 is
**the track only**: no terrain, scenery or props. **The user builds it.** Like a coaster builder, the track grows from
its open end, and the user picks the next piece, font, tempo and direction there.

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
| `app/shell.js` | A | the app's state and actions, with no DOM (tested headless) |
| `app/lib/cjs.js` | A | runs the program's CommonJS files in the webview |
| `app/palette/` | A | the build palette at the open end, the pickers, the track list, saving pieces; `panels.js` mounts the panels below |
| `app/export/` | A | the Export button's logic: the AC guard, and the exporter run in memory (`node-shim.js`) |
| `app/preview/` | C | the WebGL preview of the track |
| `app/camera/` | C | the camera modes: build view, the fixed angles, free |
| `app/validate-ui/` | E | live colour along the track, jump arcs |
| `app/handles/` | E | sculpt handles with their physics bounds |
| `app/test/` | each owner, by prefix | `shell*`, `palette*`, `export*` are A's; others as named |

## The seam: what C and E plug into

**Each panel is a directory with an `index.js` that exports `mount(root, shell)`.** `app/index.html` loads
`app/preview/index.js`, `app/camera/index.js`, `app/validate-ui/index.js` and `app/handles/index.js` through the loader.
Each one is optional: if it is not there yet, the page shows a quiet "not plugged in yet" note, and everything else
works. **If it is there and FAILS** (it does not load, exports no `mount`, or `mount` throws, rejects, or returns an
`Error` or `{ error }`), its area shows "The <panel> could not start: <why>" as an alert (`app/palette/panels.js`).
So a panel can report its own failure by returning it.

- **`root`** is the element the panel owns:
  - `#preview` for `preview` (a `<canvas>` is theirs to create);
  - `#camera` (a small control strip) for `camera`;
  - `#validation` for `validate-ui`;
  - `#handles` for `handles`.
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

**Keys (`app/shell.js` `keyAction`, bound in `index.html`):** Ctrl+Z undo · Ctrl+Y or Ctrl+Shift+Z redo ·
Ctrl+Backspace remove the head (a bare Backspace does nothing: it is too easy to hit by accident) · Ctrl+S save. A
panel that wants a key asks for it in this file first, so two panels never bind the same one.

## Two builders, one page (D186)

The page opens the **equation builder** (the core: `src/core`, `app/core`). The **piece builder** (`app/shell.js`, the palette,
the handles, textures, share, install, the guide) is paused, not deleted: the header's switch reloads the page into it, and
`?mode=pieces` or `?mode=core` in the address picks one. The last choice is remembered on this machine. The two never share a
live shell or a panel.

| path | what |
|---|---|
| `app/core/coreshell.js` | the core's state and actions, no DOM (tested headless): extend, the brush drag, close, water, export, a local example, save/open under the `eq-` prefix |
| `app/core/panel.js` | the core's controls in the left column |
| `app/core/index.js` | its `mount(root, shell)` |

**The core shell keeps the seam's state shape,** `state.resolved = { segments, closed }` from `src/core/adapter.js toSegments`,
so the preview, the cameras and validation are reused unchanged. The trackmodel diffs the segments and extends or sculpts the
mesh itself.

**In the webview, the core is loaded with the exporter's node shim** (`app/export/node-shim.js`), because it reaches
`tools/piecewise.cjs`, whose command-line half requires `fs` and `path`. Nothing touches the disk.

**Events the core's panel adds** (the preview answers them, `app/preview/index.js`):
- `t180:overlay` `{ lines }`: world line pairs drawn over the track (the water and its reds), or null;
- `t180-pick` `{ x, y, reply }`: the track station under a canvas point.

**Export** goes through `src/export/fromwords.js exportSegments`, the same route as `exportTrack` after the words resolve, via
`app/export/export.js runSegments`.

## Files on disk

- **A track** is `<name>.t180track`: the document's canonical text (`src/doc/serial.js`), in
  `<app data>/tracks/`.
- **The user's pieces** are `library.t180lib` (`src/doc/library.js` `serializeLibrary`), in `<app data>/`.
- **The autosave** is `autosave.t180auto` in `<app data>/`: `{ schema, name, doc }` with the canonical text, written
  about 1.5 s after the last edit while the track is unsaved. It is cleared by saving under a name, or by closing with
  nothing unsaved. Closing with unsaved changes keeps it, so the next start offers the track back rather than losing
  it.
- **An export** is a `t180b_<name>` folder in the folder the user picks. Inside an AC install's `content	racks`, only
  `t180b_*` folders are written: another track's folder is refused, by the page and again by the native side. **One exception, an
  empty folder:** a folder made directly in `content\tracks` ("T-180 TUBE OVAL") that is not `t180b_*` and is EMPTY is not another
  track, so the export goes into `content\tracks` as the normal `t180b_<track name>` and that empty folder is removed afterwards
  (Content Manager reads an empty track folder as "main layout is damaged"). A folder with anything in it is refused as before.
  The native side checks it again (`folder_is_empty`, `remove_empty_folder`: rmdir, never contents); `exporter.resolveTarget`.
- A name is 1–64 letters, digits, spaces, `_` or `-`, starting with a letter or digit. The shell checks it, and the
  native side checks it again: no path in a name ever reaches the disk.
