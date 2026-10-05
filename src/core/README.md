# src/core: the equation core

The track as a short list of equations you shape: extend it from its open end, sculpt it anywhere, close it, and pour
water down it. The old word/piece document (`src/doc`, the vocabulary, the fonts) is **paused, not deleted**. This folder
does not edit it; it imports one of its functions, `solveJump`, for a jump.

| file | what |
|---|---|
| `document.js` | the document: pieces of channel B-splines, canonical serialisation, versioning, undo as history |
| `extend.js` | extend: a continuation from the open end, blended to the handle targets by Bloss |
| `adapter.js` | the document → the path samples `src/geom` builds, so preview, cameras, mesh, validation and export are reused |
| `sculpt.js` | a C2 brush on one channel over a window |
| `close.js` | the least-norm closure: the WHOLE lap (`close(doc, { edited })`, the stretch edited last held), or LOCAL (D242: `close(doc, { window })`, only the window's pieces may move, every other piece kept bit-identical, and a window that cannot close the loop within the document's limits and the roll-rate bar is refused by name, `CLOSE_WINDOW`; `closeWindow(doc)` is the app's default, the last ~20% of the lap) |
| `water.js` | particles on the surface the adapter emits |
| `readout.js` | a piece's length (m) and its change in turn, climb and bank (°), for placed pieces and the extend ghost |
| `piece.js` | SAVED PIECES (D240): a run of pieces kept relative to its own start (`t180b.piece/1`), put back at the head, mirrored on insert |

Every formula is on the skill's shelf, `.claude/skills/track-equations/references/`, cited at its use as `ref NN §k`.

## The document (schema `t180b.core/4`; a `core/1`, `core/2` or `core/3` file is read and upgraded)

```js
{
  schema: 't180b.core/3',
  generator: 't180-track-builder/core 0.3.0',
  name: 'My track',
  closed: false,
  start: { pos: [x, y, z], heading: θ0, pitch: p0 },   // m, rad: where the first piece starts (heading about world up)
  nextId: 3,
  pieces: [ ROAD | FLIGHT, … ],                       // in driving order; frozen
}
```

**A ROAD piece** is one set of cubic B-splines in the piece's own arc length s ∈ [0, length] (ref 03 §1). All channels
share ONE clamped knot vector:

```js
{
  id: 'p1', type: 'road', length: L,          // m
  family: 'bowl' | 'half-pipe' | 'flat',      // the measured cross-section family (data; see "cross-section")
  knots: [t1, t2, …],                         // INTERIOR knots only, strictly inside (0, L), ascending; the clamped vector is
                                              //   [0,0,0,0, …knots, L,L,L,L]; so a channel has knots.length + 4 control points
  channels: {
    kh:  [c0, c1, …],   // heading rate κh(s), rad/m, + = left, about WORLD up (the geometry's yaw; src/geom/path.js)
    kv:  [ … ],         // pitch rate κv(s), rad/m, + = nosing up
    phi: [ … ],         // bank φ(s), rad, + = left side up, about T (the geometry's roll)
    w:   [ … ],         // road width w(s), m
    r:   [ … ],         // the cross-section's rise rate r(s), °/m (the measured law: "a rim rises at a rate", D182)
    h:   [ … ],         // height offset h(s), m, along WORLD up (see "the offset channels")
    l:   [ … ],         // lateral offset l(s), m, along the gravity frame's horizontal left
  },
}
```

- **The joints are continuous by construction.** Each channel of a piece starts at the previous road piece's end VALUE and
  SLOPE: its first control point is the value, and its second is set by the slope (ref 03 §1: at a clamped end,
  c′(0) = 3(P1 − P0)/(t4 − t3)). So κ, and with it curvature, is continuous at every joint: G2, and C1 in every channel.
  `document.js` `checkDoc` refuses a document whose joints are not.
- **The heading and pitch themselves** are integrated from κh and κv by `src/geom` (ref 02 §2). They are not stored.

**A FLIGHT piece** (a jump):

```js
{ id: 'p4', type: 'flight', gap: D, drop: h, land: λ }   // m, m, rad: as the old jump word, solved by src/doc/resolve.js solveJump
```

- A flight takes off at the road's end pitch. Its landing ramp is sized by validation (`src/validate/jumps.js`
  `landingRamp`), as today.
- The next road piece starts on the ramp, level with it: κh = κv = 0 there, and φ carried.

**Numbers are quantised when they enter,** so load then save is byte-exact:
- lengths, knots and widths 0.1 mm;
- κh and κv 1e-9 rad/m;
- φ, heading and pitch 1e-9 rad;
- r 1e-6 °/m;
- gap and drop 0.1 mm;
- land 1e-9 rad.

**Canonical text:** a fixed key order, one piece per line (`serialize` / `parse`). **Undo:** `createHistory`, `commit`, `undo`
and `redo`, with snapshots of frozen documents, and a drag as one entry.

## The cross-section

At each station, the profile is the measured family floor (`src/geom/fonts.js` FLOORS: ψ at ¼, ½, ¾ and the edge of each
half-width) for the road width w(s). Each quarter's rise is capped at r(s) · (w/8), which is the measured law with the family's
fixed rate replaced by the channel r(s). There is no wall. The rule is written up on the shelf (ref 09 §3).

## The cup: the cross-section's edge angle (schema core/3, ref 09 §9)

The cup **c(s)** is a channel in DEGREES: the angle ψ the surface has turned by at both edges u = ±w/2, from 0 (a flat ribbon) up to **150**.
About 15 is today's bowl, 31 today's half-pipe, 90 vertical walls, 150 a partial tube open at the top. It is independent of bank: the
section is cupped first and then rolled (bank 30° with cup 60° makes the left wall stand exactly vertical). A cup moves neither the
centreline, the bank nor the readout's turn and climb.

- **A cup piece and a legacy piece.** A road piece is a **cup piece** (`P.cup === true`, and a `c` array in its text) only when a cup was set on it:
  an Extend `c` target, `first: { c }` on an empty track, or being extended after a cup piece (the cup then continues like any channel).
  Every other road piece, including everything read from a /1 or /2 file, is a **legacy piece**: it renders through the old
  `profileAt(family, w, r)` unchanged (byte for byte: the nine /2 fixtures in `test/fixtures/`, digests in `manifest.json`), and its `c` is zeros
  in memory and absent in the text. So a user who never types a cup sees nothing change. (The plan's "migrate every /2 piece to a c that
  reproduces its profile" cannot: where the r cap binds the SHAPE differs, up to 4.458°; the D190 seal, V1.)
- **The shape** is the family's measured floor scaled to the edge: ψ at the four quarters is c·Fᵢ/F_edge on both sides
  (`cupProfile(family, w, c)`; ref 09 §9). The r rate cap does not apply to a cup piece.
- **Range.** `0 ≤ c ≤ 150` for every control point (`CUP_MAX`), refused by name (`BAD_CUP`) in `checkDoc`, `parse`, Extend and a brush; by the convex hull
  (ref 03 §1b) the curve stays inside too. 150 leaves 9.68° to the bowl's touch (159.681°). The Extend fit rings past a short
  transition's target (174.65° for 150° over 10 m before the guard), so a cup piece's control points are clamped to [0, 150] after the
  fit, and the readout reports the DOCUMENT's c. A clamp can leave the curve short of the target at the top: 144.499° for 150° over 20 m of a 60 m piece.
- **Joints.** c is C1 between two cup pieces like every channel and is carried through a flight. Between a legacy and a cup piece the
  RENDERED edge must be continuous to 0.05° (a legacy piece's cup, for this, is the edge it renders: `D.legacyEdgeDeg`, held), so a cup that
  follows a legacy piece starts there. A lap closes `c` (value and slope) only when its first and last road pieces are both cup pieces;
  a cup meeting a legacy piece at the seam is reported by `close` (`cupSeamStepDeg`), not solved.
- **On the road (no stair-step).** The plan's one profile per 2 m stepped the wall tip 0.33 to 1.41 m (seal V4). By default a stretch where c changes
  and the width does not shares ONE blend pair (`blend: { from, s0, length }`, the lowest and highest c), with `s0` and `length` chosen per segment so
  the mesh's smoothstep weight lands on c(s) at both ends of every 2 m segment (a segment where c falls swaps the pair): the rows of neighbouring
  segments are the same vertices, so **no seam zip is emitted inside the piece** (measured 0) and the edge is within 0.05° of c at every row
  (exact where c is a smoothstep, which is what Extend's Bloss blend makes it). Where the width changes too, the pair is per segment (a chord). A
  segment where c and the width stay within 0.02° of one anchor is one profile with no blend.
- **`segment.profile` is the blend's TARGET.** For a cup segment that is the run's widest cross-section, not the local one, so every reader that
  is not the mesh evaluates a CUP segment's blend (`cup: true` on the segment) at its station with `src/geom/profile.js readAt(seg, d)` (a word document's font-transition blends are read as before) (as `markers/place.js` and `geom/pitlane.js`
  already do): the marker layout's floor, validation's loads and steepness, the water's surface, the camera's span, and the export's sections. A
  reader that takes `segment.profile` directly sees a cup's widest shape for the whole run (measured: the grid's straight refused as 4.45 m wide).
- **The legacy → cup joint has no step.** Where the r cap binds the legacy piece's last profile is the capped shape and the cup shape at the same
  edge differs inside the road (36 mm on a 12 m bowl, 148 mm on a 24 m half-pipe). The first 10 m of the cup (`MORPH_M`) fade that difference out by
  smoothstep (the shape only: the legacy and cup widths are equal at the same w, measured): the first row IS the legacy piece's last row, the edge stays c, and past 10 m the road is the pure cup shape.
- **The lap seam between a cup and a legacy end (D190 round 3).** Closing a lap whose first and last road pieces are not the same kind: `close()` HOLDS
  the cup's value at the seam to the legacy piece's rendered edge (an extra residual row, `cup edge at the seam`), and the adapter fades the cup shape into
  the legacy start's first profile over the cup's last `MORPH_M` metres (`tailZone`; when the cup is the START, `morphZone` fades out of the legacy END's last
  profile), so the zip at s = 0 meets within 1 mm (B measured 23.2 mm bowl 16 m, 148.2 mm half-pipe 24 m, 9,488 mm when the cup was not returned). A cup
  piece that is followed by a legacy piece anywhere in the track (a loaded file can hold one) fades the same way. If the closing piece is too short to fade
  (an 8 m cup piece straight after a legacy piece leaves the seam 148 mm on a 24 m half-pipe), `close()` refuses by name (`CUP_SEAM`), and never reports
  converged over a step. Validation reds any cup joint or lap seam whose curve steps more than 1 mm (`joint-step`, `geom/profile.js
  jointSteps`), so the panel cannot read "lap proved" over one. The standard for a ramp is "rows land on c(s) (0.05°) and never change faster than c"; the
  seal's literal "≤ 1° between rows" is retired (it is c's own change per 0.5 m sample).
- **`toSegments(doc, { cupRuns: false })`** is the other scheme, kept for comparison: each segment's profile is the local end profile with a blend
  from the start profile. Readers need no change, but a seam zip is emitted wherever c changes (19 of 50 on a 40 m ramp) and the edge is up to
  0.95° off c inside a segment (the mesh's smoothstep runs 1.5x c's rate mid-segment, and a 150° ramp shows a 102 mm ripple in the tip).
- **The brush.** `brush({ mode: 'value', channel: 'c' })` works on cup pieces only; a window that reaches a legacy piece is refused (`NOT_CUP`). A cup piece's segments are re-expressed when its c range changes only under `cupRuns`; by default a brush re-expresses the segments under its window.
- **The API for the UI:** the channel name is `c` (Extend `targets.c`, `first.c`), and the readout's `cupFromDeg` / `cupToDeg`.

## The edge curve, the tube and the spiral (schema core/4, D225, ref 09 §10)

Three more channels, each carried only by the pieces that use it (a flag on the piece, like `cup`; the canonical text writes the array only then, so a document that uses none is the /3 text with a new schema string):
- **e** (edge angle, degrees >= 0) and **s** (where the outer zone starts, 0.5 to 0.95 of the half-width, default 0.64) make an **edge piece** (`P.edge`): on top of whatever the middle profile gives, ψ gains e·G((|u|/h − s)/(1 − s)), G = 3t² − 2t³, on both sides. The total edge angle is capped at CUP_MAX = 150 (c + e on a cup, the legacy edge + e on a legacy piece), bound on control points by the convex hull. e = 0 is the identity: a piece with no edge returns its middle profile object untouched.
- **t** (tube sweep, degrees 0 to 360) makes a **tube piece** (`P.tube`): a circular arc, ψ = (t/2)|u|/h, closing into a cylinder of circumference w at 360. A piece is a cup or a tube, never both. An open tube takes an edge up to t/2 + e <= 180; a closed one takes none. A tube HELD between t1m(w) (`tubeSlotMinDeg`, 348.7° at 31 m) and 360 leaves a slot under the downforce ray's 1 m and is refused (BAD_TUBE); passing through the band to 360 is the closing transition. A closed tube narrower than 9.74 m is a validator red (`tube-too-narrow`: the 3 m chase eye plus the seal's 0.1 m margin must fit under the ceiling 2R = w/π).
- **Joints.** e and s join C1 like every channel (s only while e is visible). Between two different kinds (legacy, cup, tube) the RENDERED edge must be continuous to 0.05° (a tube's is t/2); `extend` starts a tube at twice the edge the piece before it renders, and a cup after a tube at t/2 (a cup cannot start where a closed tube ends: BAD_CUP, open the tube to t <= 300 first).
- **Segments.** An edge or tube piece, and a piece entering from a different kind, is built by `xsecSegments` (adapter.js): every segment is a CHORD (its profile at the end, blended from the one at the start; a moving slice is not linear in s), all of a piece's segments share ONE row grid (`seg.fractions`, profile.js `commonFractions`, honoured by mesh.js), so the mesh emits no seam zip inside the piece; entering from another kind the first 10 m blend from the previous last profile. `e = 0` pieces never reach this path: the nine fixtures are byte for byte as before.
- **The spiral.** Inside a closed tube the roll turns about the tube's AXIS: each segment of a tube piece carries a heartline that runs linearly over the segment (path.js `heartline1`), R(s) = (w/2π)·smoothstep((t − 300°)/60°), and a cubic Hermite roll through the channel's value and slope at both ends (`rollRate0`/`rollRate1`), so the road centre is a smooth helix. `heartlineLift` gives the validator the road centre's own curvature (the spiral's centripetal load). Bank already winds through ±180°; nothing wraps it. Water over a heartline offset is refused by name (`WATER_HEARTLINE`).
- **Validation** (src/validate): `roll-rate` (20 m chord, RED above 1.2144°/m, AMBER above 0.9338°/m, the Centrifuge lap's measured bars; a full 360° of bank needs about 450 m to pass and 600 m to clear amber), `tube-too-narrow`, `edge-past-cap`. A tube that closes along the road still reds `downforce-ray-gap` over its slot zone: no exemption (the librarian's ruling 3).
- **close()** joins e, s and t round the seam only when both ends carry them, and refuses a seam that joins a tube to another kind (`TUBE_SEAM`) or an edge still active at one end only (`EDGE_SEAM`).

## Extend's `transition`: one ramp for every channel, or one per channel (`extend.js`, D194b, ref 09 §9)

`extend(doc, { length, transition, targets, … })`. **`transition` is a number of metres** (one ramp for every channel; the default is the piece's length; unchanged from before, byte for byte) **or a map** `{ w: 20, phi: 'start', … }` of channel → metres. A channel missing from the map uses the piece's length. The value `'start'` is the short ramp at the start of the piece: the piece's first knot span, at most 20 m, or the whole piece if it is shorter (`startRampM(length, knotM)`). A channel with a target and a ramp shorter than the piece REACHES its target inside the ramp and HOLDS it for the rest of the piece: the whole piece at the new width, with no jump, so the joint into the piece is still C1 (a later piece cannot step; only a ramp is allowed). A bad map (unknown channel, zero, negative, longer than the piece, not a number) is refused by name, `BAD_TRANSITION`.

A short-ramp channel is not least-squares fitted (it would ring: ref 09 §9 has the measurements); its control points are the ideal ramp at the knot averages, the joint's first two are kept, and the rest are clamped into [start, target], so the curve never leaves that range, is monotone for a monotone ramp, and is exactly the target after the ramp. The piece carries 4 extra knots inside the ramp (`rampKnots`, `RAMP_KNOTS`). A legacy piece whose width or r changes is drawn as CHORDS (D196, below), so a fast ramp has no staircase of width steps and no step at the joint into it.

## Knot insertion: finer knots under a narrow brush (`document.js`)

Knots are every ≤ 20 m by default (`KNOT_M`), and a C2 brush moves whole control points, each spanning 4 knot spans. So a
brush narrower than about 3 spans would have to widen. The fix is finer knots where the brush lands, inserted EXACTLY: the
curve does not change (Boehm's rule, ref 09 §6).

```js
const { doc: fine, inserted } = refineKnots(doc, pieceId, a, b, maxSpan);
// every span of road piece `pieceId` that overlaps [a, b] (the PIECE's own s) and is longer than maxSpan is cut into
// equal spans ≤ maxSpan; the others keep their knots and control points. `fine` is a checked document (the same object if
// nothing was needed); commit it like any edit, and undo removes the knots.
insertKnot(piece, t) / insertKnots(piece, [t …])   // the piece-level operations it is built from
boehm(U, P, t)                                     // the rule itself, on one channel, unquantised
```

**For the brush:** convert the brush window to the piece's own s. Refine [s₀ − r − 3h, s₀ + r + 3h] to maxSpan = h, where
h ≤ 2r/6 gives the window at least 6 spans, so that whole control-point supports fit inside it. Then brush.
- The knots stay where they were put: they are part of the document, serialised canonically (ascending), and removed by undo.
- **One caution for the brush's own rule:** a widening computed from the largest span of the WHOLE piece will not narrow after
  a local refinement. It must use the spans under the window.

**What it costs:** only the three control points around each new knot are new, and they are quantised to their channel's
step. So the stored curve moves by at most half a step, and only on the new knot's span and the two spans either side of it.
Every other span is evaluated by the same arithmetic as before: bit for bit.

## The offset channels h and l (schema `t180b.core/2`)

Two VALUE channels, beside the five that shape the base geometry:

```js
channels: { kh, kv, phi, w, r,
  h: [ … ],   // height, m, along WORLD up: a hill (+) or a dip (−)
  l: [ … ],   // lateral offset, m, along the gravity frame's horizontal left R = (cos θ, 0, −sin θ): a swerve
}
```

- **They are ordinary channels:** the same knots, clamped cubic control points, quantised to 0.1 mm, and C1 at every joint.
  `roadPiece` makes them 0 when left out (or continues the previous piece). `refineKnots` refines them with the rest.
- **A brush sculpts them like any channel:** refine the knots under the window (above), then brush the `h` or `l` control
  points. Outside the window they stay exactly 0.
- **Before a jump they must fade to 0,** value and slope (`checkDoc` refuses otherwise: `FLIGHT_OFFSET`). After a jump they
  start at 0: the adapter cannot lift a jump's gap or its landing ramp.
- **A `t180b.core/1` file** opens with both at zero, and saves as `core/2`.

**The adapter applies them AFTER the base geometry** (`offsetPath`, ref 09 §7):
- each sample inside an offset is moved to r̃ = r + h·ŷ + l·R;
- its tangent, frame, curvature vector, bankG and grade are RECOMPUTED from the lifted curve, exactly, from the channels'
  derivatives and the base's yaw rate. They are not merely shifted, so validation, the loads and the water read the road as
  brushed;
- the roll about the tangent is kept;
- the per-segment end samples (`path.segEnd`, which the mesh closes each segment on) and the build head are lifted too.

**For readers of the path** (the sample shape does NOT change: the same fields):
- **outside an offset,** every sample is the geometry's own object, bit for bit;
- **inside one,** a sample is a plain object with the same fields;
- **`s` stays the base's parameter,** and `path.lengthM` the base's length. The road over a hill is a little longer than s says;
- **a path from `src/geom`'s incremental `extendPath` or `rebuildPathFrom` is the BASE path.** Run `offsetPath(doc, segments,
  path)` on it again before reading it.

## The readout: what each piece does, in numbers (`readout.js`, ref 09 §8)

For the display beside Extend's fields (the ghost) and the label at each placed piece. Pure: it reads the document only.

```js
pieceReadout(doc, i)          // i = 0-based piece index; throws EMPTY on an empty track, BAD_INDEX out of range
candidateReadout(doc, opts)   // the piece extend(doc, opts) would place (the SAME opts as extend): the ghost's numbers
// → { type: 'road' | 'flight', id,
//     lengthM,                     // the piece's length along s, m (a flight: its flight plus its landing ramp, as built)
//     turnDeg,                     // ∫κh ds, degrees, + = left
//     climbDeg,                    // ∫κv ds, degrees, + = nosing up (a flight: landing pitch − take-off pitch)
//     bankFromDeg, bankToDeg,      // φ at the two ends, degrees, + = left side up
//     cupFromDeg, cupToDeg,        // the cup c at the two ends, degrees (a legacy piece: the edge its road renders; a flight: carried)
//     pitchFromDeg, pitchToDeg,    // the pitch entering and leaving the piece, degrees
//     offsets }                    // null, or the EFFECTIVE numbers with h/l applied (below)
```

- **Exact:** turn and climb are the channels' own integrals (3-point Gauss–Legendre per knot span, exact for a cubic). The
  drawn geometry integrates by the trapezoid at 2 m and differs by under 1e-6 rad (measured). Show one decimal; both agree to it.
- **`candidateReadout` IS `pieceReadout` on the extended document,** so the ghost's numbers equal the placed piece's.
- **`offsets`** (only when the piece has h or l): `{ turnDeg, climbDeg, pitchFromDeg, pitchToDeg, roadLengthM }`.
  - A hill or swerve that fades to zero slope INSIDE the piece leaves the turn and climb unchanged. It only moves the road
    in between.
  - One still rising at an end tilts that end: on level road, by atan(h′).
  - `roadLengthM` is the length over the lifted road, a little more than `lengthM`.
  - Bank is never changed by h or l.

## Saved pieces (`piece.js`, schema `t180b.piece/1`, D240)

The keeper: "can we keep only the equation mode? And then we can save pieces from that we make." This is the CORE half: no UI and no files on disk (the library list, "Save as piece...", rename and delete are the app's).

```js
const PC = require('./piece.js');
const piece = PC.saveRun(doc, from, to, { name });      // doc.pieces[from..to], inclusive; one piece is a run of one
const text  = PC.serialize(piece);                      // the canonical text; PC.parse(text) reads it back, refused BY NAME when malformed
const next  = PC.insert(doc, piece, { mirror, keepStart });   // a NEW document with the run added at the open end
const less  = PC.deleteRun(doc, from, to);              // pieces from..to taken out (the amendment of 2026-10-05, 08:55); see below
PC.mirrored(piece); PC.summary(piece);                  // the left/right mirror image; { pieces, roads, flights, kind, lengthM, turnDeg, climbDeg }
```

**The text** is `{ schema: 't180b.piece/1', generator, name, start, pieces: [ ... ] }`: each road piece is `{ type, length, family, knots, channels }` (the cup, edge and tube are carried by their channel arrays, as in a document's text) and each flight `{ type, gap, drop, land }`. No ids (a piece is given the next id where it goes in). The name is a file name: 1 to 60 letters, digits, spaces, `_` or `-`, starting with a letter or digit.

**The relative form** (the rule of the D240 plan): a piece is stored relative to its own start. **Rates** (`kh` turn, `kv` climb) and the **offsets** (`h` a hill, `l` a swerve: both are off the base line, so a hill is that hill wherever it is put) are stored as the document holds them. **States** (`phi` bank, `w` width, `r` the wall's rise, `c` cup, `e` and `s` edge, `t` tube) are stored as their CHANGE from the run's first start value (so each channel's first control point is 0) plus the start values in `start`. Putting them back is exact: every number is on its channel's decimal grid, and `q(change + start)` is the number that was saved.

**Insert at a head** continues from it: every state is shifted so the run starts at the head's end value and keeps its change (a cup that went 15° to 60° added where the cup is 30° goes 30° to 75°), and every channel's first two control points are the head's value and slope carried on (`v + m·span/3`, ref 09 §1), the way Extend makes its joint, so the joint is C1. The control points after them are the saved ones (shifted, for a state). A tube added after another kind starts from `tNext` (twice the edge the piece before it renders), a cup after a tube from `t/2`, and the road after a jump from a level head with the rest carried, as `endState` says. **When the run already joins the head** (the same start: its values and slopes meet the head's within the document's own joint tolerance) it is added EXACTLY AS SAVED, found by trying that first and letting `appendPiece`'s own `checkDoc` decide, so a track built from a saved and re-inserted run is the same document as the one built by hand and exports the same bytes (`test/core_piece.test.js`, row 2). `keepStart` adds the run as saved and nothing else (refused by name, `PIECE_START`, if it does not meet the head). On an empty track the run goes in as saved. Everything goes through `appendPiece`, so a piece can never make a document the document would refuse: it goes in valid or is refused by a `CoreError`.

**Mirror** (left/right): `kh`, `phi` and `l` are negated (the raw arrays, or for the bank its change and its start); everything else is symmetric. The mirror of the mirror is the piece itself, exactly, and a mirrored run's path is the mirror image of the original's (x flips, nothing else moves; row 5).

**Delete** (`deleteRun(doc, from, to = from)`: a NEW document; the others keep their ids and `nextId` is not wound back, so an id is never reused). At the open end the pieces simply go. In the MIDDLE the two sides must meet C1 again: first the far side is tried exactly as it is (it already joins when the deleted run began and ended in the same state: nothing is changed anywhere); otherwise the far side's FIRST road piece is re-joined the way Extend makes a joint (D190, ref 09 §1): every channel's first two control points become the near side's end value and slope carried on, and NOTHING else changes (that piece's own end, so its joint with the next, and every piece after it are bit for bit as they were; the far side keeps its shape and moves along as one). When that does not make a valid document (a limit, a jump with no road before it, a tube that would be held in its slot band, ...) it is REFUSED BY NAME, `DELETE_REJOIN`, with the document's own reason in the message, and nothing is deleted or reshaped. A closed track has no open end (`CLOSED`); a range not in the track is `BAD_RANGE`. Tested over every range of a legacy, a cup, a tube, a jump, a mixed-kind and a varied track (row 10g).

**A run is one cross-section kind** (legacy, cup or tube, with or without an edge): a state shifted to meet a head cannot keep a legacy piece's drawn edge (a function of `w` and `r`) equal to a neighbouring cup's `c` at their joint, so a mixed run is refused at save (`MIXED_RUN`). A legacy run cannot follow a cup or a tube (`PIECE_KIND`; Extend cannot make that either).

**Refused by name** (all `CoreError`s): `BAD_PIECE_JSON`, `BAD_PIECE_SIZE` (8 million characters), `BAD_PIECE_SCHEMA` (a whole track, or a newer piece, says so), `BAD_PIECE_FIELD` (an unknown field is refused, not dropped), `BAD_PIECE_NAME`, `BAD_PIECE_RUN` (1 to 2,000 pieces), `BAD_PIECE_START`, `BAD_PIECE_NUMBER`, `BAD_PIECE_KNOTS` (at most 4,000 a piece), `BAD_PIECE_CHANNEL`, `NO_ROAD`, `MIXED_RUN`, `BAD_RANGE`; and the document's own codes for what the run does inside itself or at the head (`JOINT`, `BAD_CUP`, `BAD_TUBE`, `BAD_EDGE`, `FLIGHT_OFFSET`, `CLOSED`).

## What the adapter emits (`adapter.js`)

**Legacy chords (D196).** A legacy segment whose two ends draw different cross-sections (a changing width, or an r that binds the rise cap) is a CHORD: `profile` is the cross-section at its END and `blend: { from, s0: 0, length }` runs from the one at its START (the mesh's smoothstep weight), and the segment carries `chord: true` so the readers evaluate the blend (`src/geom/profile.js` `readsBlend` / `readAt`, the cup's rule) and never a word document's font transition. The rows at a segment's two ends are its ends' own cross-sections, so neighbouring segments share their row: no staircase of width steps between 2 m slices (F4 had 0.29 m, F8 0.86 m, a 20 m ramp of 19 m had 4.8 m) and no step at a joint (the joint into D195's short ramp was 262 mm). A segment whose ends draw the same cross-section (a constant width and r, or an r that does not bind) is exactly what it was, byte for byte: the profile at its middle width, no blend, no new key. **Amends the D190 seal, row 5, by name:** "a legacy piece renders as before" now holds for constant segments only; the three fixtures whose render changed (F4, F6, F8) are re-baselined in `test/fixtures/manifest.d196.json` (before, after, and the measure), the other six are byte-identical to c964c2d, and the geometry (the path) is byte-identical in all nine. A family change between pieces (bowl to half-pipe, F8) is still a step: it is a different cross-section by design.

`toPath(doc, { step = 0.5, segM = 2 })` → `{ segments, path }`:
- `segments` are `src/geom` segments. A road piece becomes consecutive segments of ≤ `segM` metres, each a clothoid whose
  k, kp and roll run from the channel values at its ends (the geometry's own curve model), carrying the profile at its
  midpoint.
- `path` is `buildPath(segments, { step, closed })`: the SAME samples `{ s, seg, pos, T, L, U, kvec, roll, bankG, grade }`
  as today, and each sample's `seg` indexes `segments` for its profile.
- **So sculpt and close work on the DOCUMENT, and water works on `path` plus `segments`.** Nobody needs another
  representation.

**Stated deviation:** within each short segment, `src/geom` interpolates roll by a smoothstep, not by the channel's cubic.
At `segM` = 2 m, the difference is measured by the adapter's tests, not assumed.
