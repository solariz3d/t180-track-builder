# Two bugs found exporting LANIAKEA (2026-11-01)

A note for whoever picks this up next, written from a laptop session with no access to the desktop transcripts. Nothing
in the program was changed. The track data was changed by one number (below). Every number here carries the command that
produced it.

The track is `eq-LANIAKEA.t180track`: a closed 13,233.4 m lap, 39 pieces, 6,621 segments, 27 m wide, with a **946 m
height range (y −634.9 → 311.3 m)** and a section that falls through vertical.

Two separate bugs. The first stops the export; the second lets the export finish and then crashes Assetto Corsa.

---

## 1. `lapSectors` always lands AC_TIME_1 on the 15° bar, which the export then rejects

**Symptom.** Export refuses, every time:

```
MARKERS: gate-tilt: AC_TIME_1 tilts 15° from level across the road
(its ends are 6.0 m apart in height): a car can pass beside it, and a
lap that misses a sector gate does not count
```

**Cause — two layers disagree by less than their slack.**

- `gateFlatAt` (`src/markers/layout.js`) accepts a station whose gate tilt is **≤ `GATE_TILT_MAX_DEG` = 15°**, and
  `lapSectors` walks outward from the ⅓ / ⅔ target in `GATE_STEP_M` = 2 m steps and takes the **first** station that
  passes.
- LANIAKEA's ⅓ target (s ≈ 5411) sits inside a bank that is exiting: 47° at s ≈ 5100, through 15° at s ≈ 5501, down to
  2.5° by s ≈ 5604. On a monotonically unbanking road, "the first station that passes ≤ 15°" is **always** the station
  where the tilt crosses 15.00°.
- `checkMarkers` (`src/export/markers.js`) then re-measures on the **built scene** and rejects at
  `> gateTiltDeg + gateTiltSlackDeg` = `> 15.01°`.
- Measured: the scene-side reading runs about **0.17° higher** than the path-side reading. The search bar and the check
  bar are the same number, so the search hands the check a station the check cannot accept.

Consequence: **any lap whose ⅓ or ⅔ point falls before a banked exit cannot export**, and no amount of moving the start
line fixes it.

**Measured.** Sweeping the only pure-data lever, `spawns.line.along`, from 0 to 1000 in 10 m steps: `AC_TIME_1` pinned to
s = 5501.1 / 14.87° for **every value**. The start line is clamped to the first piece (p1, ~1000 m), so the target can
only roam 4411 → 5411 — never out of the bank. The sub-2 m station phase is the only remaining freedom
(`station phase = (along + 1.13) mod 2`), and it is worth about 0.25°.

```
along    sLine     AC_TIME_1 s   path tilt   export
825.600  825.60      5500.75      14.917     FAIL   <- as saved
826.100  826.10      5501.25      14.858     FAIL
826.350  826.35      5501.50      14.828     OK
826.850  826.85      5502.00      14.769     OK     <- flattest the 2 m grid can reach
826.975  826.98      5500.12      14.992     FAIL   <- station grid rolls over
```

So the scene-side bar sits at a path-side reading of about **14.84°**, and the passing window is
`along ∈ [826.35, 826.95]` — roughly 0.6 m out of a 2 m cycle.

**Applied as a data-only workaround:** `spawns.line.along` `825.6` → `826.85` in `eq-LANIAKEA.t180track`. That moves the
start line 1.25 m and nothing else. It exports. It has ~0.07° of margin and will not survive reshaping p16 or changing
the lap length.

**Worth knowing:** there was road at **0.03° tilt at s ≈ 5624**, 120 m further on — well inside the existing `L / 4`
search radius. A better placement was available and the "first passing station" rule could not reach it.

**Two candidate fixes, not made here:**

1. Give the search headroom under the check: search at ≤ 14°, keep the check at ≤ 15°. One constant, fixes the class.
2. Have `lapSectors` scan a window and take the **flattest** station instead of the first passing one. Slower, but it
   would have put this gate on that 0.03° road.

---

## 2. `generateAiLine` writes a file that crashes Assetto Corsa on a near-vertical track

**Symptom.** The track folder exports and installs. Content Manager lists it. AC loads the mesh fine
(`TrackAvatar::init3D(): 50.2 s`), reads the AI line, and dies:

```
LOOKING FOR: content/tracks/t180b_laniakea/ai/fast_lane.ai
LOADING SPLINE: content/tracks/t180b_laniakea/ai/fast_lane.ai
Spline is at last version

CRASH in:
  ksphysicsac\ai\aispline.cpp (701): AISpline::calculateNormals
  ksphysicsac\ai\aisplinerecorder.cpp (303): AISplineRecorder::load
  ksphysicsac\track.cpp (125): Track::initAISpline
  acs\trackavatar.cpp (439): TrackAvatar::initPhysics
```

**The file itself is correct.** This is worth stating plainly, because the byte layout is the first thing anyone will
suspect. `ailine.js`'s layout, including the trailing `int32 hasGrid = 0`, accounts for the size exactly:
`16 + 20n + 4 + 72n + 4` = `203068` for `n = 2207`. ✔ And the data is clean:

```
points 2207 | NaN/Inf 0 | zero-gap dups 0 | wrong id 0 | non-monotonic length 0
gap min 5.8648 max 6.000 m | extraCount 2207 | extras NaN/Inf 0
```

`encodeAiLine` also self-checks `o !== b.length`. Nothing is malformed.

**Cause — AC's AI spline is referenced to world up, and this track goes vertical.**

`AISpline::calculateNormals` **discards** the stored normals and recomputes them from the point positions, by crossing
the tangent with world up and normalizing. `|tangent × up|` is the horizontal length of the tangent, i.e. `cos(pitch)`.
At 90° pitch it is zero.

```
LANIAKEA   smallest |tangent x UP| = 0.000001  at point 1489
           65 points within 6 deg of vertical (pitch 84.3 -> 90 deg, y -241 -> -157 m)
magione    smallest |tangent x UP| = 0.999947
           0 near-vertical points
```

So AC divides by `1e-6`. **This is not fixable by writing different bytes** — whatever normals the file carries are
thrown away and recomputed into the same divide-by-zero. AC's AI spline simply has no representation for a vertical or
inverted road.

The codebase already knows AC is world-up-referenced: `gateFlatAt` rejects `c.n[1] <= 0` ("the road faces down: inside a
loop") and caps gate tilt at 15°. `generateAiLine` does not share that knowledge.

**And the generator has the same degeneracy, silently.** `src/export/ailine.js`, in `generateAiLine`:

```js
const up = [0, 1, 0], left = unit([fwd[2], 0, -fwd[0]]), lean = Math.atan2(dot(p.nrm, left), dot(p.nrm, up));
```

`left` is `up × fwd` up to sign. Where `fwd` is vertical, `fwd[0] = fwd[2] = 0`, so `unit([0, 0, 0])` hits its own
zero-guard (`unit`: `l > 0 ? … : [0, 0, 0]`) and returns the zero vector. Then
`lean = atan2(0, dot(nrm, up))`, and on the inverted drop `dot(nrm, up) < 0`, so `lean = π`.

Measured, and this is the tell — the same decoder on a stock track for contrast:

| extra field | magione (loads) | LANIAKEA (crashes AC) |
|---|---|---|
| `camber` | −0.018 → 0.044 rad | **−3.1416 → 3.1412** (±180°) |
| normal `ny` | 0.9991 → 1.0000 | **−1.0000 → 1.0000** |
| forward `fy` | −0.0107 → 0.0107 | **−1.0000 → 1.0000** |

So `unit()`'s zero-guard turns a **degenerate frame into a plausible-looking finite number**, and `encodeAiLine`'s
`NON_FINITE` guard never fires — it tests finiteness, not degeneracy. A camber of ±π is not a camber; no stock AC track
produces one.

**Candidate fix, not made here.** Per point, compute `h = hypot(fwd[0], fwd[2])` and refuse when it is below some
threshold (≈ `sin(6°)` = 0.105 matches the 65 points measured here), as a new `AiLineError('VERTICAL_TANGENT', …)`.
Then `src/export/fromwords.js` can catch it and **finish the export without `ai/fast_lane.ai`**, with a warning, rather
than writing a file that crashes the game. A track with no AI line loads and drives; a track with this AI line does not
load at all.

**Verified workaround.** With `ai/fast_lane.ai` removed, AC loads the track and runs:

```
LOOKING FOR: content/tracks/t180b_laniakea/ai/fast_lane.ai
DEBUG TIMER: AISpline::calculateNormals: 0.0015
...
PhysicsAvatar:: SESSION INFO RECEIVED
CLEAN EXIT
```

Cost: no AI opponents, and no spline for progress/pit logic. Timing is unaffected — AC times off the `AC_TIME_*`
dummies, and all three gates are in the kn5 (`AC_TIME_0_L/R`, `AC_TIME_1_L/R`, `AC_TIME_2_L/R`, plus `AC_START_0..13`,
`AC_PIT_0..13`, `AC_HOTLAP_START_0`).

**Unrelated but noticed:** `ohyeah2389_t180testtrack`'s `ai/fast_lane.ai` is 4 bytes **short** of the layout (missing the
trailing `hasGrid` int) and every extra record decodes as all-zero — 4,159 zero normals, zero forward vectors, zero
speeds. That is a differently broken file from some other tool, not this generator's output. If that track also
misbehaves, this is why, and it is a separate thing.

---

## How this was measured, without the app

The app exports through `exportSegments`, not `exportTrack`, and builds its layout with `spawnsLayout` plus the
adapter's `offsetPath` lift — so a harness that skips any of those does not reproduce the real failure. This one does
(it reproduces the exact `MARKERS` message, and a control run on the unfixed file still fails):

```js
const { parse } = require('./src/core/document.js');
const AD = require('./src/core/adapter.js');
const { spawnsLayout } = require('./app/core/coreshell.js');
const { exportSegments } = require('./src/export/fromwords.js');
const { createCoreTextures } = require('./app/core/textures.js');

const laneRoad = (d) => { if (!d.pitLane) return null; const { boxes, boxSpacingM, ...road } = d.pitLane; return road; };
const withPitBoxes = (l, p) => ({ ...l, pits: { ...l.pits, count: p.boxes, spacingM: p.boxSpacingM } });

const doc = parse(fs.readFileSync(trackFile, 'utf8'));          // NOTE: parse returns a FROZEN doc
const segments = AD.toSegments(doc);
const start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
const lift = (p) => AD.offsetPath(doc, segments, p);            // the offsets; skipping it changes every tilt
let markers = spawnsLayout(doc, segments, lift, start, { open: !doc.closed }).layout;
const pit = laneRoad(doc);
if (pit) markers = withPitBoxes(markers, doc.pitLane);
// the road surface: the panel's defaults are asphalt / edge off, and it is DOM-free, so it builds headless
const textures = createCoreTextures({ segments: () => segments, closed: () => !!doc.closed, kind: 'asphalt', edge: false }).current();
const meta = { name: 'LANIAKEA', description: 'Built from equations by t180-track-builder.',
  via: 'src/core/adapter.js toSegments', liftPath: lift, start, ...(pit ? { pitLane: pit } : {}) };
exportSegments(segments, meta, { outDir, markers, textures, edgeApronM: doc.edgeApronM, onStage: (s) => console.log(s) });
```

Three things that cost time and are easy to repeat:

- `parse()` returns a frozen document. `doc.spawns.line.along = x` fails **silently**; deep-clone first.
- `Markers.anchorS`'s signature is `anchorS(anchor, segments, starts)` — the anchor first, no path.
- `startLayout` throws `NO_START_STRAIGHT` on a closed core track (nothing is exactly straight after the close); it is
  also the wrong path when the document has `spawns`, which a hand-placed start always does.
- Omitting `opts.textures` exports a correct but **untextured** road. The panel's remembered choice lives in the
  webview's localStorage (`t180.coreLook`, `t180.coreLookEdge`); absent means asphalt with the edge fit off.

AC was driven headless for the crash evidence: `cfg/race.ini` already names the track after a Content Manager launch, so
running `acs.exe` directly re-runs that session, and the result is in
`Documents/Assetto Corsa/logs/log.txt` (`CRASH in:` or `CLEAN EXIT`).
