# The app: T-180 Track Builder

A Tauri v2 desktop app built the way blackbox is built: a static web UI, plus a small Rust side for the disk. v1 is
**the track only**: no terrain, scenery or props. **The user builds it.** Like a coaster builder, the track grows from
its open end, and the user picks the next piece, font, tempo and direction there.

## Run it

    cd src-tauri
    cargo tauri dev        # the app window
    cargo build            # the native side alone

`src-tauri/build.rs` copies `app/` and `src/` into `src-tauri/dist/` before every build, keeping the repository's
layout, so a relative `require` means the same thing in the webview as under node.

- **The geometry core, validation and the document model all run in the webview.** No mesh data crosses IPC, during a
  drag or otherwise (ARCHITECTURE §9).
- **The native side only reads and writes the user's tracks and piece library,** by name, in the app's data folder
  (`src-tauri/src/lib.rs`).

## The pieces, and who owns them

| path | owner | what |
|---|---|---|
| `src-tauri/` | A | the native shell: window, commands `list_tracks`, `save_track`, `open_track`, `save_library`, `open_library` |
| `app/index.html` | A | the page and its glue: loads the modules, wires storage to the Tauri commands, keyboard shortcuts |
| `app/shell.js` | A | the app's state and actions, with no DOM (tested headless) |
| `app/lib/cjs.js` | A | runs the program's CommonJS files in the webview |
| `app/palette/` | A | the build palette at the open end, the pickers, the track list, and saving pieces |
| `app/preview/` | C | the WebGL preview of the track |
| `app/camera/` | C | the camera modes: build view, the fixed angles, free |
| `app/validate-ui/` | E | live colour along the track, jump arcs |
| `app/handles/` | E | sculpt handles with their physics bounds |
| `app/test/` | each owner, by prefix | `shell*`, `palette*` are A's; others as named |

## The seam: what C and E plug into

**Each panel is a directory with an `index.js` that exports `mount(root, shell)`.** `app/index.html` loads
`app/preview/index.js`, `app/camera/index.js`, `app/validate-ui/index.js` and `app/handles/index.js` through the loader.
Each one is optional: if it is not there yet, the page shows a placeholder naming the missing module, and everything
else works.

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

**Keys (in `index.html`):** Ctrl+Z undo · Ctrl+Y or Ctrl+Shift+Z redo · Backspace remove the head · Ctrl+S save. A
panel that wants a key asks for it in this file first, so two panels never bind the same one.

## Files on disk

- **A track** is `<name>.t180track`: the document's canonical text (`src/doc/serial.js`), in
  `<app data>/tracks/`.
- **The user's pieces** are `library.t180lib` (`src/doc/library.js` `serializeLibrary`), in `<app data>/`.
- A name is 1–64 letters, digits, spaces, `_` or `-`, starting with a letter or digit. The shell checks it, and the
  native side checks it again: no path in a name ever reaches the disk.
