# A map of T-180 Track Builder

What lives where, and where to look for things. Anchors are **function names**, never line numbers (lines move;
`grep -n "function <name>"` finds them). A line ending in *why: see header* points at a file whose opening comment is the
real documentation of how and why it is built that way; read that before changing the file. Some headers cite
`docs/ARCHITECTURE.md`, `docs/INTERFACES.md` or research notes; those documents are not part of this repository, and the
header text is what ships. When you add or move a module, update its line here.

## The shape in one paragraph

The whole program runs in the webview. `src/` is the core: plain CommonJS with no DOM, so every part of it also runs under
`node --test`. A track is a **document** of pieces (`src/core/document.js`); the **adapter** turns it into segments and a path
(`src/core/adapter.js` → `src/geom/`); the **mesh** is built from the path (`src/geom/mesh.js`); the **checker** reads the path
(`src/validate/`); the **export** turns the mesh into an Assetto Corsa track folder (`src/export/`). `app/` is the window: the
page (`app/index.html`), the app's state and actions (`app/core/coreshell.js`), the panels and the 3D preview. `src-tauri/` is
the small native side (files, backups, finding AC). `app/lib/cjs.js` loads the same CommonJS files in the webview, and
`src-tauri/build.rs` copies `app/`, `src/` and `tools/` into the bundle side by side, so a relative `require` means the same
file in both places.

## Where to look for X

| you want | start at | then |
|---|---|---|
| **the track document** (pieces, channels, save format) | `src/core/document.js`: `createDoc`, `appendPiece`, `roadPiece`, `flightPiece`, `checkDoc`, `serialize`, `parse` | `channelAt`, `valuesAt`, `endState`; the shape is described in `src/core/README.md` |
| **growing the track** (Extend, turns, jumps, sculpt, close) | `src/core/extend.js` `extend`; `src/core/turnby.js` `extendTurnBy`; `src/core/jump.js` `jumpHere`; `src/core/sculpt.js` `brush`; `src/core/close.js` `close` | `level.js`, `sharp.js`, `finish.js`, `bankswing.js`, `smoothramps.js`, `piece.js` (saved pieces) |
| **geometry and mesh** | `src/core/adapter.js` `toSegments`, `toPath`, `offsetPath` (the document → segments → path) | `src/geom/path.js` `buildPath`, `extendPath`; `src/geom/mesh.js` `buildMesh`, `extendMesh`, `sculptMesh`; `src/geom/profile.js` (the cross-section); `src/geom/bvh.js` `selfCheck` |
| **the checker** (red and amber) | `src/validate/index.js` `validate`, `revalidate` | `limits.js` (every number with its source), `raygap.js` `rayGaps`, `jumps.js`, `bounds.js`; in the app, `app/validate-ui/panel.js` `createValidationController` and the off-thread runner (`checkjob.js`, `checkrunner.js`, `checkworker.js`) |
| **export** (the kn5 and the track folder) | `src/export/fromwords.js` `exportTrack`, `buildExport` | `kn5write.js` `writeKn5`, `trackfiles.js` (every other file of the folder), `ailine.js` `generateAiLine`, `acready.js`, `scene.js` `validateScene`; in the app, `app/export/export.js` `makeExporter` and the export's own process (`exportrunner.js`, `exportjob.js`) |
| **the panel** (the left column) | `app/core/panel.js` `mount` | its sections: `piecesui.js`, `pitui.js`, `spawnsui.js`, `textures.js`; the menus: `app/menubar/menubar.js`, `app/core/buildmenu.js`, `app/core/trackmenu.js`, `app/menubar/items.js` |
| **the ghost** (the next piece shown before it is placed) | `app/core/coreshell.js`: the shell's `candidate` and `candidateJump` methods | the panel sends it as the `'t180-ghost'` event; `app/preview/preview.js` `showGhost`; `app/preview/trackmodel.js` `ghostFor`, `ghostSteps` |
| **saving and loading** | `app/core/coreshell.js`: the shell's `save`, `open`, `list` methods over its `storage` | the page's `storage` object in `app/index.html` calls the native commands in `src-tauri/src/lib.rs` (`save_track`, `open_track`, `list_tracks`, `save_undo`, `open_undo`, `save_autosave`, `open_autosave`); a save moves the old file aside first (`src-tauri/src/backups.rs` `move_aside`) |
| **the app's state and every action** | `app/core/coreshell.js` `createCoreShell` | no DOM and no Tauri in it, so its tests drive it headless |
| **the 3D preview** | `app/preview/preview.js` `createPreview`, `app/preview/index.js` `mount` | `trackmodel.js` `createTrackModel` (path and mesh kept in step with the document), `renderer.js` `createRenderer`, `batches.js`, `look.js`, `aclook.js`, `coarse.js`, `guides.js`; cameras in `app/camera/cameras.js` `createRig` |
| **keys** | `app/core/keys.js` `keyAction`, `sculptKey`, `bindKeys` | the camera's keys: `app/camera/cameras.js` |
| **installing into AC and "See it"** | `app/install/install.js` `createInstaller`, `createLauncher` | `src-tauri/src/ac.rs` |

## Directories

| directory | what lives there |
|---|---|
| `src/` (96 files) | the core: the document, geometry, checker, export, textures, markers. No DOM. |
| `app/` (260 files) | the window: `index.html`, the shell, the panels, the preview, sounds and skins; `app/test/` holds the app's 127 test files. |
| `test/` (200 files) | the core's tests, and `test/fixtures/` (fixture tracks and manifests of the export digests they are checked against). |
| `scripts/` (11 files) | command-line tools around the core (below). |
| `tools/` (2 files) | `kn5.cjs` `readKn5` (reads a kn5's meshes in world space) and `piecewise.cjs` (fits a track's line from a mesh); both are required by shipped code. |
| `src-tauri/` (16 files) | the native side (Tauri 2, Rust), its config, icons, and `release.cjs` (the installer build). |

## `src/`

**`src/core/`, the track as equations.** *why: see `src/core/README.md` and each file's header.*
- `document.js`: the document: pieces, each road piece a set of clamped cubic B-spline channels; checks, serialise, parse. *why: see header*
- `adapter.js`: the document → the segments and path `src/geom` builds; `offsetPath` lifts the path by the height and sideways offsets. *why: see header*
- `extend.js`: grow the track from its open end, each new piece continuing the last one's value and slope (`extend`). *why: see header*
- `turnby.js`: turn, climb or corner by a given amount (`extendTurnBy`, `extendClimbBy`, `extendCorner`).
- `sharp.js`: a sharp turn beside the broad curve (`extendSharp`). `level.js`: level the road or take it to the floor (`extendLevel`, `extendToFloor`).
- `jump.js`: a free flight and a landing (`jump`, `jumpHere`, `setLanding`, `landingOf`). *why: see header*
- `sculpt.js`: the brush and its modes (`brush`, `sculpt`, `stretch`). `bankswing.js`: bank a whole bend as one swing (`swingBank`). `smoothramps.js`: re-lay old ramps smoothly (`smoothRamps`).
- `close.js`: close the loop (`close`, `closeWindow`). `finish.js`: finish to start and bank the lap (`finishToStart`, `bankLap`). *why: see header*
- `piece.js`: saved pieces: save a run, insert, mirror, delete, cut (`saveRun`, `insert`, `mirrored`, `deleteRun`, `cutRun`).
- `readout.js`: what a piece does, in numbers (`pieceReadout`, `candidateReadout`). `continuity.js`: how channels meet at joints (`jointSteps`, `c2Breaks`).
- `gridturn.js` (turn to the grid), `pitflat.js` (flatten under the pit lane), `water.js` (pour water down the surface, `pour`).

**`src/geom/`, the geometry.** *why: see each file's header.*
- `path.js`: segments → the centreline, its frame and stations (`buildPath`, `extendPath`, `rebuildPathFrom`, `buildHead`).
- `mesh.js`: path + segments → the scene, piece by piece (`buildMesh`, `extendMesh`, `sculptMesh`, `reuseMesh`).
- `profile.js`: the cross-section as one curve (`psiAt`, `offsetAt`, `normalAt`). `fonts.js`: the measured cross-section families (`fontProfile`).
- `bvh.js`: whole-surface checks (self-intersection, stacking) (`selfCheck`). `pitlane.js`: the pit lane's road (`buildPitLane`). `index.js`: the one require.

**`src/validate/`, the checker.**
- `index.js`: red, amber and info along the track, the speed profile and the lap (`validate`, `revalidate`, `lapOf`, `speedProfile`). *why: see header*
- `limits.js`: every number the checker uses, each with its source. `raygap.js`: gaps under the car's downforce ray (`rayGaps`). *why: see header*
- `jumps.js`: the jump as a forward problem (`checkJump`, `minSpeed`). `bounds.js`: live limits for the sculpt handles (`handleBounds`).

**`src/export/`, the Assetto Corsa track folder.**
- `fromwords.js`: the document → a complete track folder (`exportTrack`, `buildExport`). *why: see header*
- `kn5write.js`: the scene → a `.kn5` file (`writeKn5`). `trackfiles.js`: every other file of the folder (`surfacesIni`, `modelsIni`, `uiTrack`, `mapParams`, `mapPng`).
- `ailine.js`: the AI line (`generateAiLine`, `readAiLine`). *why: see header* `scene.js`: the one scene shape every exporter builds to (`validateScene`).
- `acready.js`: the last step before the kn5 (`flattenForAc`, `weldSeams`, `mergeForAc`). `layouts.js`: several tracks as one folder with a layout each (`exportProject`).
- `gripkeys.js` (grip per piece), `pitlane.js` (the lane in the scene), `pitboxes.js`, `markers.js` (`checkMarkers`), `catch.js` (a catch surface under the road), `underskin.js` (the underside).

**`src/doc/`, the older word-document model and shared data.** Words, phrases and fonts (`vocab.js`, `phrasebook.js`, `library.js`), resolve and serialise (`resolve.js`, `serial.js`, `history.js`), share codes (`code.js` `encode`, `decode`), the pit lane and texture slots as document data (`pitlane.js`, `textures.js`), projects of layouts (`project.js`), texture packs (`packs.js`), a track as one equation (`equation.js` `equationToDoc`). The data files `widths.json` and `grips.json` feed the "width like…" and "grip like…" lists; `corpus.json` holds the measured word defaults (`vocabgen.js` `generate`).

**`src/texture/`, textures.** The texture set the preview and export share (`set.js` `buildTextureSet`, `applyToScene`), automatic mapping (`mapping.js`, `edge.js`, `flow.js` `flowCell`), image decoding and DDS encoding with no dependency (`png.js`, `jpeg.js`, `inflate.js`, `deflate.js`, `dds.js` `encodeDds`), and what AC cannot do (`warnings.js` `checkTexture`).

**`src/texmaker/`, the procedural texture maker.** Text ↔ parameters (`text.js`, `schema.js`), pixels (`make.js` `makeTexture`), starting presets (`presets.js`).

**`src/markers/`, start, grid and pit markers.** `index.js` `placeAll`, `layout.js` (the layout in track coordinates), `place.js` `placeMarker`, `paint.js` `paintFor` (the visible paint), `checks.js` `checkPlaced`.

**`src/lookmatch/`, comparing the preview's look with a reference render.** `raster.js` `renderView` (a CPU render), `metric.js` `compareImages`, `kn5scene.js` `readScene`, `dds.js` `decodeDds`, `cameras.js` `resolveView`.

## `app/`

- `index.html`: the page and its glue: storage and export through the native side, the panels mounted, the keys, the recovery offer.
- `app/core/coreshell.js`: the app's state and actions for the track (open, save, extend, jump, sculpt, close, select, undo, the pit lane and start), with no DOM (`createCoreShell`). *why: see header*
- `app/core/panel.js`: the left column's controls (`mount`, `extendOptions`). `handles.js`: drag handles on the preview. `zonegrab.js`: Sculpt's grab on the road. `labels.js`: the readout labels on the track.
- `app/core/` also holds: the layers drawn over the preview (`selectionlayer.js`, `flightlayer.js`, `griplayer.js`, `spawnslayer.js`, `valuesoverlay.js`), the workers that keep heavy work off the page (`closejob.js`/`closerunner.js`/`closeworker.js`, `overlapjob.js`/`overlaprunner.js`/`overlapworker.js`), the menus' items (`buildmenu.js`, `trackmenu.js`), `keys.js`, the jump's words and landing (`jumpwords.js`, `landing.js`), the start drag (`spawndrag.js`), the list helpers (`widthlike.js`, `griplike.js`, `menupick.js`), and `centreline.js` (the guard that tells Sculpt from rebuilding the route).
- `app/preview/`: the 3D view (`preview.js` `createPreview`, `trackmodel.js` `createTrackModel`, `renderer.js` `createRenderer`), the AC look (`aclook.js`, `acshaders.js`), the coarse preview while dragging (`coarse.js`), the grid and symmetry guides (`guides.js`, `guideslayer.js`), and `sky/` (one sky per look). *why: see headers*
- `app/camera/`: the cameras with no DOM or GL (`cameras.js` `createRig`), their matrices (`math.js`), the camera bar (`index.js`).
- `app/validate-ui/`: the checker's panel (`index.js`, `panel.js`), red and amber along the track (`colour.js`), the reds grouped in words (`redgroups.js` `groupReds`, `labels.js`), the load graph (`graph.js`), and the off-thread runner (`checkjob.js`, `checkrunner.js`, `checkworker.js`).
- `app/export/`: the Export button's logic (`export.js`) and the export in its own process (`exportrunner.js`, `exportjob.js`, `exportworker.js`, `node-shim.js`). *why: see headers*
- `app/menubar/`: the top bar's menus (`menubar.js`, `items.js`), and Export layouts (`layoutsexport.js`, `layoutsdialog.js`).
- `app/onboarding/`: the guided first track (`guide.js` `createGuide`, `firstrun.js`). `app/install/`: Install to AC and See it (`install.js`). `app/share/`: copy and paste a track code (`share.js`).
- `app/markers/`, `app/texture/`, `app/texmaker/`: those panels' logic, each with no DOM (`createMarkersController`, `createTextureController`, `createEditor`).
- `app/lib/`: `cjs.js` (loads the CommonJS files in the webview, `loadCjs`), `theme.js` (the look per melody), `tokens.js` (the look's colours for canvas and GL).
- `app/themes/`: one stylesheet per look. `app/sounds/`: the recorded samples. `app/sound.js`: the sounds and melodies (`createSound`).
- Top-level files: `settings.js` (saved settings, `createSettings`), `titlebar.js`, `closer.js` (the one close handler), `askdialog.js` (a question in the builder's look), `shell.js` (the older piece builder's shell, kept only as a test driver for the shared preview and checker; its keys moved to `app/core/keys.js`).
- `app/testhook/`: read-only hooks the window proof uses (`probe.js`, `ghostword.js`). `app/README.md`: how panels mount ("the seam").

## `scripts/`

`bench.js` (a large track timed along the app's edit path), `soak.js` (thousands of seeded random edits, `runSoak`), `export_words.js`
(a document file → a track folder in `out/`), `platform_test.js` and `build_platform_test.js` (a 500 m flat platform built as plain world data), `prove_render.js`
(drives the real window and captures each camera), `lookmatch.js` (the look-match renders), `texture_tiles.js` (draws each look's
texture tile). Each script's header says how to run it.

## `src-tauri/`

- `src/lib.rs`: the native side's commands: track files (`save_track`, `open_track`, `list_tracks`), backups, undo and autosave, saved pieces and the piece library, finding the AC folder (`find_ac_root`), install and See it (`install_track`, `see_it_in_assetto`). *why: see header*
- `src/ac.rs`: Install to AC and See it. `src/backups.rs`: a save moves the old file aside (`move_aside`). `src/main.rs`: the entry point.
- `build.rs`: copies `app/`, `src/` and `tools/` into `src-tauri/dist` for the bundle (tests are left out).
- `release.cjs`: builds the installer and checks it holds nothing from the building machine. `tauri.conf.json`, `capabilities/default.json`, `icons/`.

## Tests

`test/` tests the core and the export, `app/test/` the app's modules, mostly headless against the real shell. Some app tests drive
the real page in headless Chrome (`app/test/soundrender.js` `chromePath`, `launchChrome`); some are mutation harnesses
(`*_mutation.test.js`) that change the code in a temporary copy and check that a named test notices. See `CLAUDE.md` for how to run them.
