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
| `close.js` | the least-norm closure |
| `water.js` | particles on the surface the adapter emits |

Every formula is on the skill's shelf, `.claude/skills/track-equations/references/`, cited at its use as `ref NN §k`.

## The document (schema `t180b.core/2`; a `core/1` file is read and upgraded)

```js
{
  schema: 't180b.core/2',
  generator: 't180-track-builder/core 0.2.0',
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

## What the adapter emits (`adapter.js`)

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
