# Interfaces between the builder's parts (agreed at D166, 2026-09-27)

`docs/ARCHITECTURE.md` is the master. This file only fixes the **shapes** passed between its parts, so the
document model, the geometry core, validation and export can be built in parallel. Every field cites the
ARCHITECTURE line it comes from. If this file and ARCHITECTURE disagree, ARCHITECTURE wins, and the disagreement is a
bug in this file.

The pipeline (ARCHITECTURE §1.1, `:16-19`: "The track is text. The mesh is derived."):

    doc ──resolve──▶ segments ──buildPath──▶ path ──buildMesh──▶ scene ──writeKn5 / writeTrackFiles──▶ track folder
                         │                     │
                         └───────────── validate(path, segments, opts) ──▶ { lines, red, amber, jumps, lap }

All four steps are **pure and deterministic**: the same input gives the same output, byte for byte where bytes are
produced (§1.1 `:17`). Nothing reads the clock or randomness.

**Conventions, for every part:**
- Units are metres, radians, seconds and m/s inside the code. km/h and degrees appear only at the UI and in
  serialisation.
- Y is up, as in kn5 (`src/export/scene.js` header).
- `s` is distance along the centreline, from the document's start.
- `u` is across the road: the profile's own arc length, 0 at the centreline and **+ to the left** of the direction of
  travel. This is the same left as the T1 markers (`src/export/markers.js`: left = up × forward).

> **Revised at the end of D166, after reading what was built** (a non-author read of all three parts). The first draft
> said "one segment per word",
> "cell origin is translation only" and a smaller handle set. The built parts differ, for reasons their authors stated,
> and this file now says what they do. Each change is marked **(built)**. The one defect found then (repeated node
> names) is fixed at the D167 landing, and marked **(fixed)**.

## 1 · Document model → `resolve(doc) -> { segments, closed, constraints, head }` (A, `src/doc/*`)

The document itself (ARCHITECTURE §2 `:47-49`) holds:
- ordered words with stable ids;
- constraints: closed loop, pins, which parameters are free;
- a canonical serialisation with quantised numbers, `schema` and `generator` versions;
- undo as immutable history, with a whole drag as one entry.

The serialisation's exact text is A's to define. `resolve` is the only thing the rest of the program reads from it.

`segments` is an array. **(built) A road word resolves to up to THREE segments**, with `part` `'in'`, `'body'` and
`'out'`: curvature opens over `easeIn`·L, holds, then closes over `easeOut`·L. One linear k0→k1 cannot express
open–hold–close. A zero-length part is left out. A jump resolves to ONE segment, with `part: 'gap'`. All the parts of a
word carry the word's `id`, so **consumers group by `id`, and a piece is identified by (`id`, `part`)**, never by `id`
alone. Phrases (§2 `:36-37`) are expanded by `resolve`, and their words get `<phraseId>/<n>`.

| field | type | meaning | ARCHITECTURE |
|---|---|---|---|
| `id` | string | the word's stable id (`w<n>`, from a counter that only grows, so a removed head's id is never reused; a phrase's words get `<phraseId>/<n>`) | §2 `:47` "ordered words with stable IDs" |
| `part` | `'in'` \| `'body'` \| `'out'` \| `'gap'` | **(built)** which part of the word this segment is | — |
| `word` | string | vocabulary name: `straight`, `sweep`, `turn`, `tight`, `wall-ride`, `inversion`, `jump`, … | §2 `:34-35` |
| `kind` | `'road'` \| `'gap'` | `gap` is a jump's flight, with no surface under it | §2 `:35` (jump); §4 `:72-80` |
| `length` | m | L, measured along the centreline | §2 `:32` |
| `k0`, `k1` | 1/m | **yaw** curvature at the start and end, linear in s (a clothoid), + = turning left | §2 `:32-33` |
| `kp0`, `kp1` | 1/m | **pitch** curvature at the start and end, linear in s, + = nosing up | §2 `:32-33` "yaw and pitch curvature as ramped functions of s" |
| `roll0`, `roll1` | rad | explicit roll φ at the start and end, smoothstep in s, + = left side up. **(built)** A word's one smoothstep is sampled at its parts' ends, and the geometry smoothsteps again inside each part, so roll is piecewise smoothstep, level at every part boundary: close to one smoothstep, not identical | §2 `:33`; §3 `:54-55` "plus explicit roll" |
| `heartline` | m | the heartline offset, + = up. One value per segment: there is no heartline ramp | §2 `:33` |
| `profile` | object or `null` | the font's cross-section, see below. `null` on a `gap` segment | §2 `:38-42` |
| `blend` | `{ from, s0, length }` or `null` | **(built, D167)** the font ramp from the previous road word's profile, see below. Absent on a `gap` segment | §2 `:38-42`; the design ruling "fonts ramp, never jump" |
| `speed` | m/s or `null` | design speed for validation, if the document gives one; `null` means use the lap sim | §4 `:69` "v(s) from a design speed or a point-mass lap sim" |
| `tempo` | object | the tempo the word was resolved under (curvature scale, how gradually corners open and close), kept for display only. `k0…kp1` already carry its effect | §2 `:43-45` |

`profile` (§2 `:39-40`: "a 2D curve by its own arc length, with a turning angle ψ(u)"):

| field | type | meaning |
|---|---|---|
| `font` | string | the font's name: `flat`, `half-pipe`, `bowl`, `wall-ride`, `tube`, … (§2 `:41-42`) |
| `u` | number[] (m, ascending) | sample positions along the profile, right edge (negative) to left edge (positive), including 0 |
| `psi` | number[] (rad) | turning angle at each `u`, relative to the road's flat floor. Past π/2 is legal (§2 `:40` "works past vertical") |
| `material` | string | the surface key the mesh is named by, e.g. `ROAD` (§6 `:167`: physics meshes `<digit><KEY>`) |

Width, bank and wall height (§2 `:41-42`) are **derived** from `u` and `psi`. They are not stored twice. **(built)**
`resolve` builds the profile from four handles: a floor of `width` (the FLOOR width), then on each side a wall of arc
length `wall`, its ψ rising linearly to `psiR` / `psiL`:
`u = [−(width/2 + wall), −width/2, 0, width/2, width/2 + wall]`, `psi = [psiR, 0, 0, 0, psiL]`. With `wall = 0`, the
profile is `u = [−w/2, 0, w/2]` and flat. The geometry interpolates ψ linearly between the given samples (C's
`src/geom/profile.js`).

**(built) A jump** is one `gap` segment: `profile: null`, `k0 = k1 = 0` (no yaw in the air), and `kp0`/`kp1` solved so
that the flight covers the `gap` handle horizontally, comes down `drop` (+ = lands lower) and meets the landing at pitch
`land`. That is a geometric pitch clothoid, not a ballistic line. Whether a car flies it is validation's jump check
(§3). After a gap the road restarts with no curvature carried over.

- **`head`** **(built)**: `{ id, word, k, kp, pitch, roll }`, the curvatures and angles the next word opens from.
- **`resolveFrom(prev, doc)`** **(built)**: incremental resolve. It restarts at the first document entry that differs
  (by object identity, since documents are immutable) and keeps every earlier segment as the same object.
  `result.resolvedFrom` is that entry's index, and **`result.marks[result.resolvedFrom].segStart` is the segment index
  `g` the geometry restarts from** (`rebuildPathFrom`, `sculptMesh`). The join is pinned by `test/join.test.js`.
- **Refused, loudly** **(built)** (`ResolveError`):
  - a roll step or a heartline step between words (`ROLL_STEP`, `HEARTLINE_STEP`), which would tear the surface;
  - a jump no clothoid can fly;
  - **a closed document** (`CLOSE_NOT_BUILT`): the connector (§2 `:50-51`) needs the path's end frame, and is not
    built yet. So today `closed` is always `false`.
  - **(built, D167) The connector exists** as `src/doc/connector.js` `closeLoop(doc, opts)`. It appends turn–straight–turn
    clothoid words that close heading and pitch exactly and position within the geometry’s 1e-3 m, ranked by
    validation’s worst load on the connector, and returns a document marked `closed: true`. **But `resolve` still refuses
    that document** (A’s “item 2” is not applied), so callers resolve its open twin and close it through
    `buildPath(…, { closed: true })`, as `connector.js` and `src/export/fromwords.js` do. The quanta are 0.1 mm and
    0.00001°, so the seam can meet that tolerance.
- **Fonts RAMP; they never step** **(built, D167)**. Every road word has a `ramp` handle (m, default 20, never below
  1). `resolve` gives each of that word's segments that start inside its first `min(ramp, length)` metres the field
  **`blend: { from, s0, length }`**:
  - `from` is the previous road word's profile;
  - `s0` is this segment's start, measured from the word's start;
  - `length` is the ramp.

  It is `null` everywhere else, and on the first word, and on the word after a jump (there is no surface to blend
  from). The geometry blends width, wall and ψ(u) from `from` to `profile` at weight smoothstep((s0 + d) / length),
  capped at 1, where d is the distance into the segment. So one word's ramp continues across its part cuts.
  - `blend: null` means no ramp: the geometry adds none of its own.
  - A segment with no `blend` field at all (a caller that does not use `resolve`) falls back to the geometry's own
    `profileIn` / previous-font rule.
  - Pinned by `test/join.test.js` and `test/geom_ramp.test.js`.
- **`constraints`:** pins and free parameters, passed through for the editor (§2 `:46-47`). Geometry and validation
  ignore them.

## 2 · Geometry core → `buildPath(segments, opts) -> path` and `buildMesh(path, segments, opts) -> { scene, cells, folds }` (C, `src/geom/*`)

`buildPath(segments, { step })`:

| field | type | meaning | ARCHITECTURE |
|---|---|---|---|
| `lengthM` | m | the total centreline length | — |
| `closed` | bool | as resolved; if true, the loop must meet itself (position and tangent). *(2026-09-27, D177 deviation below: there is no closing twist to spread any more)* | §3 `:54-55` |
| `twist` | rad | 0 always since 2026-09-27 (D177 deviation below): the gravity frame closes with the heading. Kept so readers do not break | §3 `:54-55` |
| `samples[]` | array | one entry per station, in `s` order | — |
| · `s` | m | the station | — |
| · `seg` | index | which segment the station is in | — |
| · `pos` | [3] m | the **road's** centre at u = 0 (on the surface). The curve itself is integrated along the heartline, and `pos` = heartline point − `heartline`·U | §2 `:33` |
| · `T` | [3] unit | tangent | §3 `:54` |
| · `L` | [3] unit | the frame's **left** axis: the heading's left (cos θ, 0, −sin θ), then rolled by φ. *(2026-09-27, D177 deviation below; until then rotation-minimising, by double reflection)* | §3 `:54-55` |
| · `U` | [3] unit | the frame's **up** axis, T × … so that (T, L, U) is right-handed; L = U × T | §3 `:54-55` |
| · `kvec` | [3] 1/m | the curvature **vector** dT/ds. The fold check needs its direction, not only its size | §3 `:57` "1 − κ·(q·N)" |
| · `roll` | rad | φ at this station | §2 `:33` |
| · `bankG` | rad | bank relative to gravity, for display | §3 `:56` "Show the user bank relative to gravity" |
| · `grade` | ratio | rise over run of T, for display | — |

**Why L/U rather than N/B:** N and B read as the Frenet normal and binormal, which flip at inflections and are
undefined on straights. The frame's axes are named for what they are.

**DEVIATION from ARCHITECTURE §3, 2026-09-27 (D177, C; the librarian's ruling on p-d177-rigid-C §2, "option 2").**
ARCHITECTURE §3 says "rotation-minimising frames by the double-reflection method (f64), with the closing twist spread
along the loop, plus explicit roll". The geometry now uses **the curve model's yaw-pitch (gravity) frame + roll**: the
unrolled left is the heading's left H(θ) = (cos θ, 0, −sin θ), horizontal and perpendicular to T at every pitch,
±90° and inversions included, and the explicit roll φ is applied about T. ARCHITECTURE.md itself is NOT edited (the
keeper's document); this paragraph is the record.
- **Why (measured, p-d177-rigid-C §2):** the RMF spins against gravity on a climbing turn at k·sin p per metre. A 360°
  turn at 10° pitch with roll 0 ended banked 61° against gravity, so a word's roll was not its bank, while §3 says to
  show the user bank against gravity and the loads f = v²κN − g need it. The same twist made a piece's shape depend on
  the frame carried in from upstream, so no edit on a slope could move what follows rigidly.
- **What it changes:** a word's roll IS its bank against gravity (`bankG` = asin(cos p · sin φ); φ on the level). A
  closed loop's frame closes with its heading, so there is no closing twist (`twist` = 0). Every sculpt that keeps the
  next piece's start pitch moves what follows rigidly and exactly (§4b). Centrelines are unchanged; the language, A's
  connector and jumps are unchanged. Old documents keep their shape; on pitched turns their banks change (by the
  twist the RMF used to add).
- **What it does not change:** yaw is still about world up and pitch still absolute, so a PITCH edit still reshapes
  what follows (that is the language's meaning).

**(built) The curve model: yaw is about WORLD up.** Heading θ turns about world up at k(s), and pitch p at kp(s), so
T = (cos p sin θ, sin p, cos p cos θ). A "turn left" word turns left on the map whatever the pitch. **The consequence:**
a piece's shape in its own frame depends on its start pitch and start bank. So a saved piece reproduces exactly under
translation plus rotation about world up, at the same start pitch and bank, and a pitch edit re-meshes everything after
it. **Open, for the keeper:** yaw about the track's own U would make pieces invariant under any placement. It would
also stop a level turn staying level when it starts pitched. ARCHITECTURE §2 `:32` ("yaw and pitch curvature") does not
decide it.

`buildMesh(path, segments, { maxSeamDeg, chordErr, cellLength, maxStep })` returns:
- **`scene`:** exactly T1's shared scene shape (`src/export/scene.js`), which goes straight into
  `src/export/kn5write.js`. It must pass `validateScene`.
- **`cells[]`** **(built, per piece)**: each piece (segment) has its own vertex count across, its own adaptive
  stations and its own cells, each under 65,536 vertices (§3 `:62-64`).
  - **Vertices are stored in the piece's LOCAL frame at its first sample.** The node matrix carries the placement:
    rows L, U, T, then the origin. So it is a rotation plus a translation, not the translation-only origin the first
    draft said. `validateScene` and `writeKn5` accept it. **Whether AC's physics honours a rotated node transform on a
    road mesh is UNVERIFIED** (no AC launches, the keeper 12:17). If it does not, export bakes world coordinates: the
    same arrays, one transform per vertex.
  - Where two pieces meet with different rows, a zipper strip `SEAM_<id>` joins them.
  - **Node names are unique, by (`id`, `part`)** **(fixed, D167 landing)**. Cells are named `CELL_<id>_<part>_<n>`
    holding `1<KEY>_<id>_<part>_<n>`, and seams `SEAM_<id>_<part>`. A segment with no `part` keeps `CELL_<id>_<n>`.
    Before the fix, a road word's three parts shared one name: 16 duplicates in 31 nodes. That also collapsed
    `src/geom/bvh.js`'s name→cell map, so the self-check reported false crossings. `validateScene` still does not
    check uniqueness; `test/join.test.js` does.
- **`folds[]`:** `{ s, u, margin }` for every profile vertex where 1 − κ·(q·N) ≤ 0 (§3 `:57`). Validation turns
  these into red. Self-intersection between non-adjacent cells (BVH, §3 `:58`) lands here too, with
  `margin: null, other: <cell name>`, **when `buildMesh(…, { selfCheck: true })`** (built, D167, `src/geom/bvh.js`).
  The self-check reads the finished mesh, is opt-in, and is not incremental.

The step along the track is adaptive, limited by chord error and **max seam angle** at the worst profile vertex (§3
`:59-61`). `maxSeamDeg` defaults to 1°, the proven envelope in FINDINGS §2 (`FINDINGS.md:24`: median 0.2–1.1°).

## 3 · Validation → `validate(path, segments, opts) -> { lines, red, amber, jumps, lap }` (E, `src/validate/*`)

`opts.car` holds the per-car numbers, each with its source (§4 `:70-71`, "per car from its open config"):

| field | default (Mach 6) | source |
|---|---|---|
| `suspensionStopG` | 20 | `FINDINGS.md:103` ("About 20 g: the suspension runs out (measured)"). **Informational, not red** |
| `provenG` | 90 | `FINDINGS.md:105` ("Up to about 90 g: proven"). **Above it is AMBER, not red** (`:112-113`) |
| `jumpG` | [3.2, 6.3] | `FINDINGS.md:336-337` (§7d), and §4 `:73-78` |

**The withdrawn 60 g red line must not come back** (`FINDINGS.md:116-118`, struck).

Output:

| field | shape | ARCHITECTURE |
|---|---|---|
| `lines[]` | `{ s, u, fN_g, fLat_g, fAlong_g, f_g }`: the specific force f = v²κN − g, **as a vector** projected on the surface frame at lateral position u (fN into the surface, fLat across, fAlong along T), in g; `f_g` is its magnitude | §4 `:68-69` "the vector specific force … projected on the surface frame, per lateral line u" |
| `speed[]` | `{ s, v }`: the v(s) used, from `segments[].speed` or the lap sim, and which one | §4 `:69` |
| `red[]` | `{ s0, s1, u, reason, source }`. `reason` is one of: `gap-in-road`, `missing-soft-collision`, `fold`, `self-intersection`, `stacked-within-2m`, `wall-ride-from-wall-object`, `steep-without-raycast` | §4 `:81-87`; `FINDINGS.md:110-111` |
| `amber[]` | `{ s0, s1, u, reason, source }`, for "no track has proven this yet": load above `provenG`, seams past the proven envelope | §1 `:22-24`; `FINDINGS.md:112-113` |
| `jumps[]` | `{ s, gap, climb, rampDeg, minSpeed, landings: [{ g: 3.2, x, clear }, { g: 6.3, x, clear }], reachable }`: **two landings, never one** | §4 `:72-80` |
| `lap` | `{ ok, timeS, minV, where[] }`, a ghost point-mass lap over the whole path | §4 `:88-89` |

`source` is always a FINDINGS or ARCHITECTURE line, e.g. `"FINDINGS.md:105"`. A red or amber with no source is a bug.

**(built) What E's `validate` returns in addition:**
- `speedFrom`: where v(s) came from;
- `info[]`: the 20 g suspension stop, which is information, not a colour;
- `notChecked[]`: checks that could not run, named, instead of reported clean. Self-intersection is there until the
  BVH exists.
- per-landing `minSpeed`, and `pending` on a jump whose landing is not built yet (the open head).

Also:
- `lines[]` holds u only at the profile's own samples.
- **Jump failures are not red.** They show as `landings[].caught = false` and in `lap.where`. Neither ARCHITECTURE §4
  `:81-87` nor this file lists them as red.
- **Seams past the proven envelope are amber:** FINDINGS `:110-111` calls them red but "inferred, not yet observed
  failing", and ARCHITECTURE, the master, leaves them off the red list.
- **Built at D167:** `revalidate(prev, path, segments, fromS, opts)` (§4) and `handleBounds(doc, id, opts)` (§4b, `src/validate/bounds.js`).
- A lap needs design speeds or `opts.car.accel`. The car's acceleration is not in FINDINGS, so no default is
  invented, and without one the lap reports `no-speed-model`.

## 4 · The build head: the user builds, one word at a time (v1 scope, the keeper, 2026-09-27 12:20)

The keeper: *"remember, youre not the one who builds the track, the user does"*, and *"the first thing I want it to be
is simply the track, no environmental elements"*, in the manner of Thrillville and roller-coaster builders, where you
look forward along the track as it grows. ARCHITECTURE §10 `:231` names "the build head" as the editor's first item.
**v1 is the track alone: no terrain, scenery or environment.**

A track under construction is **open**: it has a start and a head, and grows at the head. So every part below must
support **append at the head** without rebuilding what is already there.

**Document (A)** **(built)**:
- `head(doc)` and `resolve(doc).head` give the open end: the last word's id and word, and the curvatures, pitch and
  roll the next word opens from. `closed` stays `false` while building.
- `appendWord(doc, word, opts) -> doc'`, `appendPhrase`, `removeHead(doc) -> doc'` and `replaceHead`. Each is one undo
  entry (§2 `:49`).
- `resolve(doc)` works on an **open** document. A closed one is refused until the connector exists (§1).
- **After an append, every earlier segment is unchanged:** `resolveFrom` keeps them as the same objects, and only the
  new word's parts are added. Checked by `test/join.test.js`.

**Geometry (C)** **(built)**:
- `path.head = { s, seg, pos, T, L, U }`, the frame at the open end. It is where the next word starts and where the
  build camera looks from. `headCamera(head, { back = 15, up = 6 })` returns `{ eye, look, up, target }`. The
  distances are placeholders for the app.
- `extendPath(path, segments)` grows an OPEN path in place, from `path._nseg`, taking the whole segment list. It
  re-emits only the old open-end sample, as the new segment's start. It **equals a full rebuild** exactly
  (`test/join.test.js`, `test/geom_grow.test.js`).
- `extendMesh(prev, path, segments)` redoes only the new pieces and the seam at the old end. It is byte-identical to a
  full `buildMesh` after an append, and its cost does not grow with the track (C's operation counts: the same work at
  385 m and at 14 km).
- A closed loop cannot be extended or sculpted in place, because it must still close (the connector's job): that is a full
  rebuild.

**Validation (E):**
- `validate` must accept an open path: no lap proof while open (`lap: { ok: null, reason: 'open' }`), and no "gap in
  road" red at the head itself.
- `revalidate(prev, path, segments, fromS, opts) -> result'` re-checks only from `fromS`, the start of the first
  changed word, minus the look-back a check needs. The look-back is stated per check; for example, a jump's run-in
  has to be in range. Results before `fromS` − look-back are carried over unchanged.

## 4b · Pieces: sculpting, and the user's own library (the keeper, 2026-09-27 12:22)

The keeper: *"but you can also sculp pieces, and then even create and save your own unqiue pieces"*. This is
ARCHITECTURE's handles (§2 `:46`: "the continuous parameters sculpt mode drags, bounded live by physics") and phrases
(§2 `:36-37`: "Users can make and share their own").

**The handle set** is the continuous parameters of one word, and nothing else (A defines each; C rebuilds from them):

| handle | unit | maps to |
|---|---|---|
| `length` | m | `length` |
| `turn` | rad (signed, + = left) | the heading change; with `length` and `tempo`, gives `k0`/`k1` |
| `climb` | rad (signed) | the pitch change; gives `kp0`/`kp1` |
| `easeIn`, `easeOut` | 0–1 | how gradually curvature opens and closes: the clothoid ramps (tempo, §2 `:43`) |
| `roll0`, `roll1` | rad | `roll0`, `roll1` |
| `heartline` | m | `heartline` |
| `profile` | the font, plus `psiL` and `psiR` (rad), `width` (m, the FLOOR width) and **`wall` (m, the wall's arc length, built)** | `profile.u` / `profile.psi` (§1) |
| **`ramp`** | m (1–1000, default 20; built, D167) | the font transition’s length into this word (`blend.length`) |
| `gap`, **`drop`, `land`** | m, m (+ = lands lower), rad (jump words only; **built**: without `drop` and `land` the landing's height and pitch are undefined) | the flight's span, fall and landing pitch |

- **A piece regenerates from its handles alone** **(built)**. A word's segments are a pure function of its handles
  plus the state it opens from. Sculpting re-resolves from that word (`resolveFrom`). The geometry restarts at the
  word's first segment (`rebuildPathFrom(path, segments, g)`), remeshes it (`sculptMesh(prev, path, segments, g)`),
  and re-places every later piece whose shape in its own frame is unchanged instead of remeshing it. The result equals a
  full rebuild: the path exactly, the mesh within 1e-5 m (`test/join.test.js`, `test/geom_sculpt.test.js`).
  **Changed, D177 (rigid downstream edits):** the PATH is re-placed too, not regrown. Every segment is grown once in its
  own local coordinates (a block), and placed by ONE chain (position and heading carried from the block before). A full
  build and a sculpt run the same chain on the same floats, so the path still equals a full rebuild EXACTLY. The
  unchanged tail (the trailing segments whose path handles are the same) is regrown block by block only until the next
  block's local start (pitch and frame) is bit for bit its old one; from there its blocks are kept and only their
  placements are recomputed: O(1) per segment, whatever its length (`path.replaced` counts them). Every re-placed
  sample's `bankG` is bit-identical to before the edit. *(2026-09-27, with the gravity frame, §2's deviation:)* every
  block's local frame is the same, so EVERY edit that keeps the next piece's start pitch (length, turn, roll, font,
  speed, heartline, on the level or on a slope) re-places the whole tail; a pitch edit regrows it. `path.samples` of an OPEN path are read-only views (the fields above, through getters; `toJSON`
  gives the plain object).
- A whole drag is **one** undo entry (§2 `:49`).
- **Open, for the app:** sculpting a word's `roll1` makes a roll step against the next word's `roll0`, and resolve
  refuses it. Either the app edits both together, or an edit carries the end roll into the next word. The model does
  neither silently.

**The library's shape** **(built, A, `src/doc/library.js`)**:

    library = { schema, generator, pieces: [ piece ] }       // serializeLibrary writes the USER's pieces only
    piece   = { id, name, author, builtin: bool, kind: 'word' | 'phrase',
                words: [ { word, font, tempo, speed, handles } ] }   // one list for both kinds
    exportPiece(piece) -> { schema, generator, piece }        // with NO library id

- A word carries its font, tempo and speed as well as its handles. Without them, a placed piece would not resolve the
  same.
- Ids: user pieces are `u<n>`, built-ins `b-<word>`. The exported text has no id, so it does not depend on where the
  piece sat.
- Built-ins come from the program, one per word, and are never frozen into a saved library.
- **Roll is stored relative:** a piece's first road word starts at roll 0, and placing it adds the head's roll.
- Names: a built-in word's name (case-insensitive), a taken name, an empty name or one with edge spaces is refused.
- **Serialisable and shareable as text:** the document's canonical serialisation (§2 `:48`). A piece round-trips
  byte-exact within one builder version.
- **Not built:** a phrase's `exposed` handles (§2 `:36`: "some parameters exposed").
- **The physics hook** **(built)**: `handleInfo(doc, id, boundsFn)` gives every handle's value, unit and schema range,
  and passes E's bounds through untouched.

**Live physics bounds for the handles** (E, `src/validate/*`):
**(built, D167)** `handleBounds(doc, id, opts) -> { id, word, scope, redNow, handles: { <h>: { value, unit, min, max, below, above, amberMin, amberMax } } }`. It takes the document and a word id, not `(path, segments, index)`: segments carry no handles, so a handle cannot be rebuilt from them. It matches A’s `handleInfo(doc, id, boundsFn)` hook. Each bound is found by re-running `validate` with that one handle changed, exact to the handle’s quantum; `below`/`above` name what stops it (`red` with its source, `range`, `refused`, `red-now`). A full bound set takes seconds (27 s for 12 handles on one word, E’s figure), so the app must keep it off the drag path until it is incremental.
- These are the ranges over which that word stays out of red, and where amber begins, given its neighbours and
  `opts.car`.
- `source` names the FINDINGS line of the limit that binds. For example, load above `provenG` is amber
  (`FINDINGS.md:112`), and a jump's landing must catch both 3.2 g and 6.3 g (§4 `:73-78`).
- The editor shows the bounds as colour on the handle. **Open, for the app lap:** §2 `:46` says handles are "bounded
  live by physics", and §1 `:22` says "Guardrails, not gates". Whether a drag stops at red or only turns red is not
  settled here. The bounds are the same either way. They are computed incrementally, from the sculpted word on
  (§4 above).

## 5 · The camera contract (for the app lap, §9)

The app renders the track only (v1, §4 above). Cameras read `path.head` and `path.samples`; they never change the
document.

| mode | what it shows | follows |
|---|---|---|
| **build** (the default) | behind and above the head, looking along the head's T | the head, as it moves when words are added or removed |
| **overhead** | straight down, the whole track or the head's neighbourhood | the track's extent |
| **side** | from the left or right of the head, square to T | the head |
| **chase** | along the road at driver height, running along the samples | a point moving along `s` |
| **free** | user-controlled position and orientation | nothing |

- **One key cycles the modes, and one key always returns to build**, from any mode (the keeper: "free cam mode with the
  mode that looks in the direction the track is being built").
- Build view parameters (distance behind, height above, look-ahead) are app settings, not document data.
- The camera must stay sane past vertical: on a wall-ride or an inversion, the build view uses the head's U, not world
  up, so that it does not flip. (This is B's recommendation, not the keeper's words. C's `headCamera` already returns
  the head's U as `up`.)
- **Built so far:** only the build view's geometry (`headCamera`). The other modes and the key switching are the app
  lap's.

## 6 · Export (T1, exists)

- `src/export/scene.js`: the scene shape and `validateScene`.
- `src/export/kn5write.js`: `writeKn5(scene)`.
- `src/export/trackfiles.js`: `writeTrackFiles(dir, scene, opts)`.
- `src/export/markers.js`: `checkMarkers(scene)`.

Plan step 4 ("export from words") joins `buildMesh` to these. The AI line file (`src/export/ailine.js`, T2) is part of
export. **Its generated speed fields are unverified against AC** (§6 `:177-178`).
