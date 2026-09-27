# What makes a T-180 track work — findings so far (2026-09-27)

Measured on the laptop from the installed tracks (Assetto Corsa `content/tracks`), two T-180 replays in blackbox's
`samples/`, and the car config in github.com/ohyeah2389/Assetto-T-180 (`Source/base/data`). Every number below is
reproduced by the command given beside it. Goal (the keeper's): an intuitive, ThrillVille-like track builder that makes
Assetto Corsa tracks without Blender, normal and T-180, which keeps learning from good tracks on the user's PC and
builds tracks that work for T-180s (the community's hardest problem: cars clipping into the track at speed and load).

## 1. The shape language (`node study.cjs <track dirs> > t180.json`)
Eleven T-180 tracks against two normal circuits (Magione, Vallelunga) as a control:
- **Flat road (under 8°):** 5–20% of drivable area on T-180 tracks (Thunderhead is the outlier at 50%), against 100%
  on the normal circuits.
- **Cross-sections, walked across the road at 250 points per track:**
  - The dominant form is a **bowl**, a flatter floor curving up the outside. It is 50–88% of profiles on most tracks.
  - A **half-pipe**, rising at both edges, is second: up to 26% (Sakura, Coast, Centrifuge).
  - A planar constant bank is rare, except on Miandros, Rainbow Road and Thunderhead.
- **Steepest point across a section:** median 43–82°, and the top 10% reach 86–90°. The road centre sits at 16–50°.
- **Scale:** laps of 1.7–50 km, widths of 10–50 m, elevation ranges up to 2.3 km.
- **Unmeasured:** overhangs, because triangle winding is inconsistent on most tracks, and exact width, because the walk
  drifts onto adjacent drivable meshes.

## 2. The mesh envelope proven tracks drive on (`node envelope.cjs <track dirs> > envelope.json`)
- Road triangles: longest edge median 1.6–5.5 m, typically about 2–3 m.
- Seam angle between adjacent road triangles, with creases over 30° counted as edges: median 0.2–1.1°, p90 1.1–5.9°.
- Upward (compressing) curvature radius: median 65–320 m. The tightest few percent run about 4–25 m.
- **Rule:** seam angle ≈ triangle size ÷ curve radius. So keep seams under about 1° by meshing finer as curves
  tighten.
- **Centrifuge**, which survives the highest loads, has the finest mesh: 1.6 m triangles and 0.2° median seams.

## 3. The loads a T-180 actually takes (`node loads.cjs <replay>`)
The Mach 6, measured on the Test Track and on Centrifuge. The calibration check passes: below 200 km/h the load reads
exactly 1.00 g.

| | Test Track | Centrifuge |
|---|---|---|
| typical load into the road | 5.0 g | 9.4 g |
| hardest moment | 35.5 g at 496 km/h | 89.8 g at 745 km/h |

Curves driven above 150 km/h: about 33–50 m radius at the tightest, 179–273 m typical. The car rides past vertical,
at road tilts of 100–133°.

## 4. Where the suspension runs out (`node bottoming.cjs <replay>`)
**Registered before running:** from `suspensions.ini` and `car.ini` (850 kg; coilover rate 80,000 N/m; about 0.5 m
of coilover range), the springs should run out at "~20 g", with motion ratio, damping and the active suspension
ignored. **Result: confirmed on both replays.**
- The body height above the wheel-centre plane falls about linearly, about 1 cm per g, from +3 cm at 1 g to about
  −18 cm at 20 g.
- **Then it plateaus.** Test Track: −18.2 / −18.6 / −18.8 cm across 20–40 g. Centrifuge: −16.5 → −20.8 cm across
  20–60 g.
- **Past about 60 g it sinks again** (Centrifuge only, 49 frames, about 0.7 s): median −27.9 cm, worst −53 cm. That is
  the body being pushed into the surface, the edge of clipping.
- **Cross-check:** the front-to-rear wheel-pair distance reads 3.430 m in every band, the same as `WHEELBASE=3.43` in
  the car's config.

## 4b. Visual clipping versus physics clipping (`node boxdepth.cjs <replay>`)
The keeper's check, 2026-09-27: *"the back end of the mach 6 … dips below the track, but i think its not interactive to
the track."*
- **Confirmed by the config.** `car.ini` has `GRAPHICS_OFFSET=0, -0.4, 0`: the drawn car sits 40 cm below the physics
  body, so visible sinking is not contact.
- **Physics clearance of the collision box:** body height above the wheel centres + 0.345 m − tyre squash.
  - Where the 0.345 comes from: the box bottom is 0.05 m below the centre of gravity (`colliders.ini`), and the road is
    one tyre radius, 0.395 m, below the wheel centres (`tyres.ini`).
  - Tyre radial rate is 270,000 N/m, so about 15 cm of squash per tyre at 20 g on a linear model. How AC limits that
    is not verified.
- **Frames where the box is below the road EVEN WITH RIGID TYRES** (a floor, not an estimate):
  - **Test Track:** 0 of 7,728 frames.
  - **Centrifuge:** 27 of 16,577 frames, one episode at 42.39–42.78 s. That coincides with the 89.8 g peak (42.41 s).
    The box was at least 20.1 cm under the surface and the car recovered.
- **So there are three things called clipping:**
  1. visual (the offset, harmless)
  2. near contact at 20–60 g (the box within about 15 cm minus tyre squash)
  3. real penetration (seen once at about 90 g, and survived)
- **Hypothesis, untested:** #3 turns fatal on a coarser or seamed surface.
- **Eye-check for the keeper:** watch the Centrifuge replay at 0:42.4–0:42.8 for a jolt.

## 4c. The soft road: why 20 cm under the surface still flows (surfaces.ini)
**The keeper's eye-check:** Centrifuge at 0:42.4–0:42.8 "flows so smooth … all of centrifuge flows good at max speed"
(2026-09-27). So the one penetration episode was not a glitch.

**Explanation, from the files.** All 11 T-180 tracks carry the identical CSP block on their road meshes: `MESHES =
1ROAD?`, `SOFT_ERP=0.8`, `SOFT_CFM=0.0002`, `BOUNCE=0.1`, `MAX_DEPTH=4`. `FRICTION` is 0.05 on eight of them, and
0.75 / 0.82 / 1.00 on the three that add pit concrete. **Both normal circuits have no such block.**
- Identical numbers across different authors mean a copied standard. The likely source is the T-180 Test Track.
- **What the block does:**
  - The road's collision is soft (a spring, not a wall) until something is 4 m deep.
  - The chassis slides on contact (friction 0.05).
  - So the box sinking 20 cm at 90 g is absorbed and pushed out smoothly.

**Consequence for the builder:** write this block for every T-180 road surface, automatically.

**Registered prediction, not yet tested:**
- **It says** a T-180 glitches through hard compressions on a normal track, which has no block, and stops glitching
  when the block is added to that track's surfaces.ini.
- **It is falsified if** the glitch persists with the block added, or never happened without it.

## 5. What the builder does with it (corrected 2026-09-27; the first version is kept below, struck)
**The correction, the keeper's:** *"but what, 20g?? centrifuge can handle … over 70gs without clipping ruining the
speed?"*
- The 60 g red line was drawn from §4's "body sinks past ~60 g", read as the edge of clipping.
- The keeper's eye-check (§4c) shows those frames flow smoothly. On a soft-collision surface, load is not the failure.

**What the data supports:**
- **About 20 g:** the suspension runs out (measured). It is a change in how the car sits, not a failure. From here the
  box meets the road, so mesh quality matters more: Centrifuge's fine mesh and soft seams.
- **Up to about 90 g: proven**, on a soft-collision surface with Centrifuge-quality mesh. That is the highest load
  survived, not a limit found.
- **The real red line is unknown.** Nothing in the data broke.

**What the builder should use:**
- **RED, for things known to break:** gaps or holes in the road mesh, flipped or missing road pieces, a missing soft
  collision block, and seams past the proven sharpness. The last is inferred, not yet observed failing.
- **AMBER, for "beyond what any track has proven":** load above the highest survived (about 90 g today). It is shown,
  not forbidden, and the level rises as harder tracks are driven and recorded.
- **Load itself:** a "proven up to" level per car, fed by replays. That is the learning loop's simplest form.

~~Under ~20 g normal meshing; 20–60 g on the stops; over ~60 g flag red. (500 km/h: stops at ~100 m, red at ~33 m;
700 km/h: stops at ~200 m, red at ~64 m.)~~ Withdrawn above: the 60 g red was an interpretation the keeper's
observation refuted.

## 6. Two reference tracks: Sakura for flow, Centrifuge for limits
The keeper: *"centrifuge is amazing for pushing the cars to g limits."*
- **Centrifuge is the load benchmark.** Typical load 9.4 g, top 1% at 48 g, and 89.8 g survived smoothly on the finest
  mesh of the eleven (1.6 m triangles, 0.2° median seams).
- **Sakura is the flow benchmark** (below).
- **The builder should know which it is building toward:** Sakura-like transitions for flow, and Centrifuge-grade mesh
  wherever a design pushes load.

### Sakura Speedway
The keeper, 2026-09-27: *"that track is goated"* … *"the flow of the track, also it is a good one without clipping."*
Two more laps measured (`node loads.cjs` / `boxdepth.cjs` on the replays in `OneDrive\Documents\Assetto Corsa\replay`):
- **Sakura:** typical load 5.2–5.8 g, top 1% at 32–35 g, the tightest curves driven 41–44 m, and the collision box
  never under the road in either lap.
- **For comparison:**
  - Coast: 3.1 g typical, top 1% at 13 g
  - Aurora Medium: 5.0 g typical, top 1% at 36 g
- **Caveat:** the 1,080 g and 335 g "maxima" on the Sakura laps are replay teleports (the online replay format), not
  loads. Use percentiles, not maxima.
- **Sakura's geometry:**
  - the highest half-pipe share of the eleven tracks (26% of its profiles)
  - a fine, smooth mesh: 2.3 m triangles, 0.35° median seams
  - close scenery: tree tunnels, a median of 36 canopy layers per pixel (blackbox `docs/SAKURA_CAMPAIGN.md`)
- **Next to measure:** flow, which is what the keeper names first. Candidate measure: how smoothly the load and the
  curvature change (g per second, curvature per metre), compared with the other tracks. Sakura is the benchmark the
  builder's transitions should match.

## 7. Reading tracks as text (`node read_track.cjs <track dir> <length m> <width m> > x.read.json`)
The keeper's framing: *"think of the layouts and sections … as a language, … learn it and then allow the user to write
with it."*

**How the reader works:**
- It needs no replay and no AI line.
- It starts at `AC_START_0` and walks forward on the drivable surface, re-centring between the edges every 4 m.
- It records each cross-section's shape relative to the road's own centre, plus the bank (road tilt), the turn (from a
  centreline smoothed over ±20 m, read over a ~40 m baseline) and the grade.
- Each station is named with a word (shape × turn × slope, plus wall and inversion), and the lap becomes a run-length
  text.

**What it had to learn, each from a failure seen in a drawing** (`topdown.cjs`):
- underside skins are an edge, not road
- a lagging heading on turns: use the narrowest cut (search ±40°)
- jumps: look across gaps for a same-angle road running the same way
- seams between road pieces
- wide bowls that narrow back with a step: look sideways
- a turn measured from the heading lies after a sideways catch: use the smoothed centreline

**Results. Both of the author's tracks close their laps:**
- **Sakura:** 20,965 m read against 21,768 stated, 339 words, one jump of 133 m.
- **Rainbow:** 43,267 m read against 43,600 stated, 582–733 words, three jumps of 29, 81 and 133 m.

| | Sakura | Rainbow |
|---|---|---|
| cross-section | half-pipe, 32 m wide | flat banked ribbon, 47 m wide, tilted ~30° |
| straight / tight | 28% / 28% | 17% / 29% |
| climbing / dropping | 21% / 19% | 31% / 24% |
| on the wall / inverted | 5% / 3% | 1% / 0% |

**Cross-check:** the reader's median turn radius on Sakura is 454 m on the centreline; the replays drove about 300 m on
the racing line, which cuts corners.

**First grammar.** Sakura's corners open and close in steps: `sweep → turn → tight → turn → sweep`, never straight
into tight. That is the flow, as a sentence pattern. The builder's transitions should obey it.

## 7b. The whole library, read (2026-09-27, after "finish reading the last four")
`node read_track.cjs <dir> <length> <width> [layout]`: all twelve layouts close their laps.

| layout | lap | words | jumps | replay check |
|---|---|---|---|---|
| Aurora Long | 54.0 km | 885 | 8 | – |
| Rainbow Road | 43.3 km | 696 | 3 | – |
| Centrifuge | 34.4 km | 518 | 0 | 99% on line, forward |
| Sakura Speedway | 21.0 km | 342 | 1 | 99%, forward |
| Coast | 21.0 km | 323 | 3 | 100%, forward |
| Nordic | 19.2 km | 312 | 0 | – |
| Aurora Medium | 16.9 km | 271 | 2 | 99%, forward |
| Miandros | 10.1 km | 206 | 6 | – |
| Thunderhead | 9.0 km | 222 | 1 | – |
| T-180 Test Track | 7.9 km | 167 | 1 | 99%, forward |
| Eagleton (short) | 2.3 km | 43 | 0 | – |
| Serpents Spiral | 2.0 km | 35 | 0 | – |

**Totals:** about 241 km, 4,020 words, 25 jumps. The replay check measures what share of the replay car's positions lie
within 25 m of the reader's line, and which way the car passes the reader's stations.

**What the last four taught the reader:**
1. **Author naming.** Thunderhead's road is named `1ROAD_Underside`, so "underside" meshes are skipped only when they
   are the minority of the road.
2. **Tapered ramp tips.** They skew the heading, so a jump is aimed along the last ~40 m of road, with a sideways
   sweep.
3. **A landing is where a road begins after the gap.** A road passing underneath is not a landing.
4. **Layouts sharing a folder.** `models_<layout>.ini` selects the right models.
5. **Race direction.** It comes from the grid's back slot, overruling the marker only on a clear disagreement
   (Aurora's grid is three abreast).

**My own errors, recorded:**
- I claimed from a picture that Coast was read backwards, "confirmed" it with a replay check that was itself broken by
  a wrong landing, then found the real cause: the "83 m drop jump" landed on a road below that ran the other way.
- A shell-mangled regex (`AC_START_d+`) silently disabled the grid rule during one run.
- The Miandros jumps (drops up to 41 m) have no replay to confirm them.

## 8. Jumps: how a T-180 flies (`node jump_flight.cjs <replay> <takeoff x,y,z> <landing x,y,z>`)
The keeper: jumps are *"so cool and a part of the design language"*, but *"users will have to go into the game and
test it trial and error, unless we can devise a way to know the speed needed … a hard equation to get right."*

**Sakura's jump, located by the reader.** A 133–137 m gap, a take-off ramp at 3–7% up, and a landing about 5 m above
the take-off point.

**The one lap that flies it** (`AC_240326-020245_O_…sakura…`, frames 5050–5079):
- It takes off at 555 km/h at 7° up and is in the air for 0.87 s.
- **It falls at 3.17 g** (least-squares parabola, residual 0.12 m).
- The extra 2.17 g is downforce acting in the air. As k·v² that is k ≈ 0.00089 /m for the Mach 6.

**Consequence, derived rather than observed:** the downforce drop ≈ k·D²/(2cos²θ) does not shrink with speed, because
time in the air goes as 1/v and downforce as v². So every T-180 jump has:
- a minimum speed, and
- a **geometric ceiling that no speed beats**: Δh must be under D·tanθ − k·D²/(2cos²θ).

**On Sakura:**
- The ceiling is about 8.4 m and the landing is 5.1 m up.
- The formula puts the minimum speed around 550–560 km/h, and the lap took off at 555.
- The jump is tuned close to the car's real speed there.

**CORRECTION (same night): the ceiling above is withdrawn.**
- A second flight, the Coast replay (frames 1843–1885), flies a 133 m gap at 375 km/h, 7.9° up, 1.26 s in the air.
  **It fell at 3.51 g.**
- Downforce ∝ v² predicts a slower flight falls LESS hard. It fell harder.
- Two flights (3.17 g at 555 km/h, 3.51 g at 375 km/h) fit a roughly constant fall of about 3.2–3.5 g better than
  g + k·v².
- The "geometric ceiling no speed beats" was derived from one point with an assumed law, and the second point refutes
  that law.

**Superseded by §7d (thirteen Hazen flights: 3.2–6.3 g, not one number).** ~~**Working model now:** an ordinary projectile with g_eff ≈ 3.3 g~~ for the Mach 6. More speed helps as usual. Two
flights are still thin, and the in-air attitude is unmeasured.

**Builder tool (holds under either model):** for any jump placed, compute makeable or not and the minimum take-off
speed from the gap, the climb and the ramp angle, then check the track delivers that speed. Every recorded flight
refines g_eff.

**Limits:**
- One jump, one car, one flight.
- The model assumes the car flies level, with downforce ∝ v².
- Horizontal speed rose 555→570 km/h in the air (thrust?), which the model ignores.
- The second Sakura lap ends before the jump.

## Limits and next steps
- **One car and two laps.** The thresholds depend on the car. Every T-180's config is in the same repo, so each car
  gets its own zones by this method, confirmed against a replay where one exists.
- **Active suspension, read.** `script_activesusp.lua` is mostly switched off: the PID, anti-warp and camber
  controllers are commented out.
  - **What still runs:** a speed-scheduled push on each corner, `(| 0=0 | 100=80 | 200=300 | 400=800 | 600=1800 |
    1000=4500 |)`, fed through `ctrl_susp_height_*.ini` (input `SCRIPT_23..26`, added, limit ±10000).
  - **If those values are newtons** (the scale suggests so, but that is unconfirmed against CSP's documentation), the
    push is 2–10% of a corner's load at 20 g (about 42 kN). That moves the stop by about 0.5–2 g, within the
    measurement's noise.
  - **So the ~20 g limit belongs to the car itself.** Jump jacks (`script_jumpjack.lua`) are not read yet.
- **Not yet shown:** that clipping happens where the mesh is coarse under 20+ g. The next test is a replay of a track
  where cars DO clip, measured the same way.
- **The piece vocabulary and reading tracks back into pieces:** not started.

## 7c. The desktop library, first pass (2026-09-27 morning, desktop)
The keeper's rule for the learning library: **only ohyeah2389's tracks, Dogeish's tracks, and Chase's Onuris**; the
rest are "made by people who have not gotten good yet". So Aurora Cryopticon (author **Cash**, not Chase) is outside
the rule and is dropped from the learning set unless the keeper says otherwise. AC install on the desktop:
`G:\SteamLibrary\steamapps\common\assettocorsa\content\tracks` (64 tracks).

New layouts read, all closed (`node tools/read_track.cjs <dir> <len> <width> [layout] > reads/x.read.json`):
| layout | author | lap | words | jumps |
|---|---|---|---|---|
| Hazen Loop | Dogeish | ~~27.5 km~~ 31.0 km after §7d (stated 32.1) | ~~514~~ 590 | 7 |
| Onuris Long | Chase | 23.8 km | 377 | 4 |
| Onuris Medium | Chase | 19.2 km | 340 | 3 |
| Onuris Short | Chase | 7.4 km | 135 | 0 |
| The Bowltrack | Dogeish | 2.5 km | 39 | 0 |
| T-180 Bowl Track | Dogeish | 2.1 km | 30 | 0 |

Not yet done: replay checks for these (desktop replays exist: Hazen Loop ×3, T-180 Bowl Track, Onuris ×3, plus large
sessions for Rainbow, Centrifuge, Thunderhead, Miandros, Eagleton, Sakura); Hazen's 27.5 vs 32.1 km gap unexplained;
the Hazen jump with 77 m drop over 65 m is suspicious (possible wrong landing, cf. Coast §7b) — verify with its replay.
The replay tools now find blackbox at `%USERPROFILE%\blackbox` or `%USERPROFILE%\Desktop\blackbox`, or `BLACKBOX`.

## 7d. The desktop library, checked against replays (2026-09-27, desktop)
New instrument: `node tools/coverage.cjs <read.json> <replay>`. It gives the share of moving replay frames within 25 m
of the read line, the station order (forward/backward), and every stretch the car drove off the line, with where it
left and rejoined the read.

**Hazen Loop: the "65 m gap, 77 m drop" jump was a wrong landing, and it hid 3.8 km of track.**
- Replay `hazenloop__210826-054910`, v1 read: 87.5% covered. One stretch of **3,553 m** off the line, leaving the read
  at d 26305 and rejoining at d 26536.
- The car does not drop there. It takes off at 606 km/h and flies **245 m in 1.44 s, 8.8° up, 15 m down**. There is
  nothing within 8 m under it from t 225.6 to 226.5 s. It lands on `1ROAD_MainTrack` and drives a loop of about
  3.8 km out to x −1642, which comes back under the take-off. The reader's search runs nearest-first, so it hit that
  returning road at 65 m out, 77 m down, and skipped the loop. This is the same failure as Coast's "83 m drop" (§7b).
- **Fix (read_track.cjs):** a landing must be reachable by a flight. The deepest allowed drop is
  `dist·tan10° + ½·6.5 g·(dist / 375 km/h)²`, taken from the flights below. At 65 m that is about 21 m; at 226 m it is
  about 100 m, and the real 74 m drop there passes.
- **Prediction registered before the re-run:** "Hazen reads 30.8–31.5 km, the 3.5 km miss disappears, the 21-08 lap's
  coverage rises above 95%; the six real jumps unchanged." **Result: 30,963 m, closed, 590 words; the miss is gone;
  98.3% covered (22514/22915); the 22-08 lap is 97.0%; the six jumps are identical, and the seventh reads 141 m / 14 m
  drop.** Every remaining off-line stretch is a jump flight. The stated 32.1 km is still 1.1 km more than the read, and
  that is unexplained.
- **Regression check:** the rule changed no other read. Onuris ×3 and both Bowl tracks re-read to the same lengths and
  the same jump lists.

**The jump fall is not one number. This supersedes §8's "g_eff ≈ 3.3 g".** Thirteen Hazen flights over two laps
(`node tools/jump_flight.cjs`, with takeoff/landing from the read):

| jump (read d) | lap 21-08 | lap 22-08 |
|---|---|---|
| 3531 | 599 km/h, 6.7° → 5.65 g | 568 km/h, 4.3° → 3.97 g |
| 3922 | 639 km/h, 8.7° → 6.25 g | 639 km/h, 7.2° → 4.68 g |
| 12310 | 551 km/h, 10.1° → 3.84 g | 535 km/h, 9.9° → 3.69 g |
| 14510 | 560 km/h, 11.0° → 4.07 g | 554 km/h, 9.9° → 3.84 g |
| 16300 | 598 km/h, 5.4° → 5.38 g | 603 km/h, 5.5° → 5.57 g |
| 22419 | 545 km/h, −5.9° → 4.36 g | 535 km/h, −7.0° → 4.03 g |
| 26305 (the missed one) | 606 km/h, 8.8° → 5.40 g | lap ended before it |

- Around 535–560 km/h the fall is 3.7–4.4 g. Around 600–640 km/h it is 4.7–6.3 g. With Sakura (3.17 g at 555) and
  Coast (3.51 g at 375), the measured range is **3.2–6.3 g**.
- The same jump at the same speed (3922, 639 km/h) fell at 6.25 g on one lap and 4.68 g on the other. So speed is not
  the only input. On both jumps where the pair differs, the steeper take-off fell harder. That is two pairs, so it is
  a lead, not a law. In-air attitude is still unmeasured.
- **For the builder:** a jump check has to hold at both ends of the range. The landing must catch the long flight
  (3.2 g) and the short one (6.3 g), which is an argument for long landing ramps. Fit residuals were 0.05–0.36 m.

**T-180 Bowl Track (Dogeish): verified.** Replay `AC_090825-070749_O_…_t180_bowltrack_`: 100.0% covered
(9377/9377), 6.5 laps, all forward (3314/0). `BBXTEST_appended_bowltrack` is the same data. The Bowltrack
(bowltrack_2) has no replay.

**Onuris: not checkable with these replays.** All three (`AC_090126`, `AC_100126` ×2) are 2.4–3.9% covered on every
layout. Their header names the track `onuris`, recorded in January 2026. The installed track is `Chases_Onuris`, and
its road lies elsewhere: the replay car spans x −255…2609, z −192…1720, while the long read spans x −639…1057,
z −1331…2593. These are a different version of the track, so they say nothing about the reads.
**Hazen replay `050926-123658`** cannot be parsed yet (blackbox: online multi-car autosave).
