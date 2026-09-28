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

## The document (schema `t180b.core/1`)

```js
{
  schema: 't180b.core/1',
  generator: 't180-track-builder/core 0.1.0',
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
