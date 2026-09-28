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
  the car's config. *(2026-09-28: which car this figure holds for is a dated note, §4d at the end of this file.)*

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

## 7e. Why the same jump falls differently: the turbine override pitches the nose down (2026-09-27)
The keeper: **"the turbine override pushes the pitch down."** The source agrees (github.com/ohyeah2389/Assetto-T-180):
- `Source/base/data/script_turbojet.lua:120`: the core thrust is applied at `thrustApplicationPoint`, which defaults to
  `(0, 0.77, -2)`. The Mach 6's `car_config.lua` does not override it, so the forward push acts 0.77 m above the
  origin, and that is a nose-down moment.
- `Source/base/data/script.lua:221-230`: with the override (`controls.turbine.burner`) held, the throttle goes to 1,
  with afterburner above 90% throttle. Without it, the throttle is `baseThrottle * wheelsOnGroundMultiplier`. So in
  the air, the override is what gives thrust, and with it the pitch.

The replays don't record the button, but they do record the wheels, so the attitude can be measured.
`jump_flight.cjs` now prints the nose angle against the flight path: negative means the nose is below the path.
- **Prediction registered before the run:** "the harder-falling flights are more nose-down relative to their velocity,
  and the 6.25 g lap at jump 3922 is more nose-down than the 4.68 g lap."
- **Result, 13 Hazen flights:**
  - Jump 3922 at the same 639 km/h: mean nose angle **−3.3° at 6.25 g, −1.3° at 4.68 g**. It held.
  - Jump 3531: −3.5° at 5.65 g, −0.8° at 3.97 g.
  - Jump 14510: −2.2° at 4.07 g, −0.7° at 3.84 g.
  - Where the pair fell alike (12310, 16300), the angles match to within 0.3°.
  - One pair reverses by a small margin: 22419 is −2.5° at 4.36 g and −3.2° at 4.03 g.
  - Across all 13: r = −0.48.
- **Separating the two inputs** (least squares, g = a + b·speed + c·nose angle):
  - Speed alone explains R² 0.68 of the fall.
  - Speed plus nose angle explains R² 0.86.
  - Fitted: about **+1.9 g per 100 km/h** and **+0.39 g per degree nose-down**.
  - That is n = 13 with three parameters: a working model, not a law.
- **A second footprint:** thrust in the air should also add speed. On the two clearly different pairs, the
  harder-falling lap gained more along the gap: 639→650 vs 639→644 km/h (3922), and 599→606 vs 568→566 (3531). That
  fits the unexplained 555→570 km/h gain in the air on Sakura (§8).

**For the builder:** the fall in the air is partly **the driver's choice**. Holding the override pulls the car down
and shortens the jump, by roughly 0.4 g per degree of nose-down. So the 3.2–6.3 g range is not noise. It is the
envelope between flying clean and diving. A jump check should show both landings, and the landing ramp has to catch
both.
**Limit:** the override itself is inferred from attitude and speed gain, not read from input. A replay carrying
blackbox's telemetry tail, with the button state, would settle it.

## 3b. Loads and depth on the desktop replays (2026-09-27; `node tools/loads.cjs`, `node tools/boxdepth.cjs`)
Seven replays, all clean laps. Load into the road, in g. "Max ≤700" is the highest value in the speed bands up to
700 km/h. The overall max also includes frames above 700 km/h; that is real on Centrifuge, which reaches 745 km/h, but
elsewhere those frames are resets that the teleport filter lets through (Eagleton 4,601 g, Thunderhead 23,274 g,
Rainbow 6,975 g), so that figure is not quoted for those tracks.

| replay | frames | p50 | p99 | p99.9 | max ≤700 | box below the road |
|---|---|---|---|---|---|---|
| Centrifuge 11-08 | 6,981 | 9.96 | 56.95 | 78.80 | 65.98 (83.71 overall) | 1 episode, 12 frames, 3.8 cm, t 42.31–42.48 s |
| Centrifuge 16-08 | 16,563 | 9.56 | 49.39 | 73.21 | 68.38 (85.84 overall) | 1 episode, 15 frames, 6.7 cm, t 63.88–64.09 s |
| Hazen Loop 21-08 | 22,916 | 3.81 | 17.26 | 22.77 | 34.07 | 0 |
| Thunderhead night-optimized | 7,267 | 4.86 | 20.14 | 30.80 | 32.63 | 0 |
| Thunderhead no-dogbowls 22-08 | 12,995 | 4.91 | 19.39 | 36.62 | 39.04 | 0 |
| Eagleton 30-12 | 17,426 | 3.79 | 17.99 | 22.82 | 24.41 | 0 |
| Rainbow 28-05 | 176,737 | 3.94 | 15.21 | 23.75 | 34.84 | 0 |

- **Only Centrifuge ever puts the collision box under the road.** Each replay has one brief episode, a few cm deep,
  under 0.25 s, at 70–85 g. Both cases are consistent with the soft-collision block (§4c) and with the keeper's
  "flows so smooth". Everything else, about 66 minutes of driving (Rainbow alone 46.2), has zero frames below the road. (The first
  version of this line said "5.2 hours", written without computing it; the durations are N·dt from the replays.)
- **Centrifuge is the limit track, and the others sit far below it.** Their p99 is 15–20 g and their worst moment is
  24–39 g, beside Centrifuge's 49–57 g p99 and 83–90 g peaks. That is the flow-vs-limits split the keeper named
  (Sakura/Rainbow for flow, Centrifuge for limits), now in numbers across four more tracks.
- `loads.cjs` crashed on Rainbow's length (`Math.max(...L)` over 176k values overflows the stack). It now uses
  reduce, and Hazen's output is unchanged (max 34.07).
- Not measured: the online autosaves (`AC_*_O_*`: Miandros, Eagleton, Thunderhead January, Centrifuge 13-07), which
  blackbox cannot parse yet.

## 3c. The rest of the desktop replays (2026-09-27; the keeper: "there had to have been miandros and thunder head and centrifuge times")
§3b ran only the largest replays, and then said the rest were online autosaves. They were not. Every hotlap/practice
and race (`_R_`) replay for Miandros, Thunderhead, Centrifuge and Sakura is now measured. Duplicates (identical output
and identical file size) are counted once: Miandros 20-06 14:10/14:21/14:28, and Thunderhead no-dogbowls
24-08 10:45:49/10:45:51.

| replay | frames | p50 | p99 | p99.9 | max ≤700 | box below the road |
|---|---|---|---|---|---|---|
| Centrifuge 12-07 | 8,721 | 9.12 | 43.92 | 64.45 | 56.41 (77.31 overall, at 706 km/h) | 1 episode, 14 frames, 15.5 cm, t 43.29–43.68 s, at the 77.3 g peak |
| Centrifuge 19-07 | 16,577 | 9.40 | 48.07 | 74.90 | 66.11 (89.79 overall) | 27 frames, 1 episode — the laptop's §4b result, reproduced exactly |
| Sakura 27-03 | 6,260 | 5.87 | 34.76 | 40.46 | 46.69 | 3 episodes, 9 frames: 2.1 cm at 37.8 s (38.8 g), 4.5 cm at 41.9 s (46.7 g), 16.2 cm for 2 frames at 50.8 s (21.8 g, 596 km/h) |
| Miandros 17-03 | 5,598 | 4.58 | 24.10 | 31.40 | 32.79 | 0 |
| Miandros 20-06 (×3, identical) | 4,419 | 4.47 | 23.44 | 30.65 | 33.62 | 0 |
| Thunderhead 14-03 | 2,344 | 5.72 | 21.00 | 30.38 | 31.28 | 0 |
| Thunderhead 22-01 | 3,325 | 3.36 | 21.19 | 30.72 | 32.22 | 0 |
| Thunderhead race 21-01 | 10,413 | 3.84 | 21.80 | 29.56 | — (bands max 16.41 at 500–700) | 0 |
| Thunderhead race 31-12 | 16,710 | 5.32 | 21.35 | 31.96 | 30.95 | 0 |
| Thunderhead no-dogbowls 24-08 10:36 | 7,495 | 4.77 | 20.22 | 33.69 | 22.00 | 0 |
| Thunderhead no-dogbowls 24-08 10:45 (×2) | 8,167 | 5.52 | 20.29 | 33.77 | 23.36 | 0 |
| Thunderhead no-dogbowls 24-08 11:21 | 6,752 | 5.11 | 20.27 | 32.79 | 34.41 | 1 episode, 21 frames, 7.7 cm, t 100.48–100.78 s, at **65 km/h**, 7.2 g, 70° tilt |
| Thunderhead no-dogbowls 27-08 | 7,316 | 4.99 | 20.45 | 33.51 | 20.78 | 0 |

- **Every box-below episode at speed sits on a load peak of 38–77 g.** Centrifuge 12-07 at 77.3 g, and Sakura's
  first two at 38.8 and 46.7 g, are the same pattern as §4b. All are a few cm deep and under half a second.
- **Two do not fit that pattern:**
  - **Sakura at 50.8 s is 16.2 cm deep at only 21.8 g**, but for 2 frames (0.03 s). That looks like something
    local, such as a seam or a bump, rather than load. Unchecked.
  - **Thunderhead at 100.5 s is at 65 km/h on a 70° wall.** That is a slow car on a steep wall, not a high-speed
    compression. `boxdepth.cjs` assumes rigid tyres, so a car sliding or tipping on a wall can read as below the road
    without having clipped. Not a clipping case.
- **Thunderhead is remarkably consistent.** Across ten distinct laps (§3b and §3c) and three versions of the
  track, p99 is 19.4–21.8 g and p99.9 is 29.6–36.6 g. (First written as "nine laps, 20.2–21.8 / 29.6–33.8" without
  counting §3b's two; corrected.)
- Still unmeasured: the online autosaves (`AC_*_O_*`), and the Sakura 28-03 replay, which blackbox also rejects as
  one.

## 3d. How fast, and how hard it accelerates: the design speed and the lap sim (2026-09-27; `node tools/speed.cjs`)
The builder needs two numbers FINDINGS did not have: a **design speed** to compute loads with, and the car's
**acceleration** for the ghost lap (ARCHITECTURE §4, "full-lap proof"). Both are measured here, from the same seven
clean Mach 6 laps as §3b: Centrifuge 11-08 (`…centrifuge__110826-222423`), Centrifuge 16-08 (`…160826-102442`), Hazen
Loop 21-08 (`…hazenloop__210826-054910`), Thunderhead night-optimized (`…130926-180804`), Thunderhead no-dogbowls
22-08 (`…220826-131336`), Eagleton 30-12 (`…301225-025411`) and Rainbow 28-05 (`…280526-234643`).
Command, from the replay folder: `node tools/speed.cjs <those seven .acreplay files>`. The replays are read locally, and
none of their bytes is in this repository.

**Speed** (the same smoothing, frame filter and teleport filter as `loads.cjs`), km/h:

| replay | frames | p10 | p50 | p90 | p99 | max |
|---|---|---|---|---|---|---|
| Centrifuge 11-08 | 6,969 | 432 | 576 | 764 | 820 | 833 |
| Centrifuge 16-08 | 16,551 | 398 | 569 | 776 | 956 | 967 |
| Hazen Loop 21-08 | 22,904 | 272 | 433 | 580 | 623 | 655 |
| Thunderhead night-optimized | 7,255 | 274 | 387 | 501 | 611 | 651 |
| Thunderhead no-dogbowls 22-08 | 12,983 | 267 | 374 | 472 | 554 | 592 |
| Eagleton 30-12 | 17,353 | 248 | 417 | 513 | 599 | 629 |
| Rainbow 28-05 | 176,644 | 286 | 470 | 647 | 723 | 741 |
| **all seven, pooled** | **260,659** | **285** | **460** | **645** | **764** | 967 |

- **The design-speed default is the pooled p50, 460 km/h:** the speed a T-180 is at on a typical frame of a clean lap.
  It is the program's default where a word gives no speed of its own, and the user can change it.
- **745 km/h is not the top speed.** §3's "89.8 g at 745 km/h" is the speed at Centrifuge's hardest *moment*, and
  §3b's "Centrifuge, which reaches 745 km/h" read it as a maximum. Both Centrifuge laps spend over 10% of their frames
  above 760 km/h. The builder had taken 745 as its speed cap (src/validate/limits.js, D166); that was a misreading,
  corrected here.
- **Centrifuge 16-08 above 900 km/h is unchecked.** Its top 1% of frames (956–967 km/h) is a single stretch that no
  other lap comes near. It may be a glitch the teleport filter lets through. It is not used below.
- **The lap sim's speed cap is the pooled p99, 764 km/h:** exceeded on 1% of the driven frames. It is a choice of
  percentile, stated as one, not a measured top speed.

**Propulsive acceleration**, the part of dv/dt the car's own thrust gave, with gravity's pull along the path removed:
a_prop = dv/dt + g·(v_y/|v|). Pooled over the same 260,659 frames, per speed band, m/s²:

| band (km/h) | 0–200 | 200–300 | 300–400 | 400–500 | 500–600 | 600–700 | 700–800 |
|---|---|---|---|---|---|---|---|
| frames | 6,682 | 25,108 | 55,395 | 73,190 | 57,167 | 33,262 | 8,554 |
| p50 | 1.50 | 2.35 | 3.38 | 4.00 | 4.57 | 2.83 | 0.05 |
| **p95** | **24.71** | **25.52** | **23.20** | **20.07** | **17.73** | **14.75** | **11.50** |

- **The lap sim's acceleration is the p95 per band, as a table against speed:** about 25 m/s² (2.5 g) below 400 km/h,
  falling to 11.5 m/s² at 700–800. Thrust falls with speed, so one constant would misstate it at one end or the other.
- **The p95 as "full thrust" is an INFERENCE.** A replay carries no throttle (blackbox reads inputs only from a
  separate telemetry file), so it is read as the upper envelope: the driver at full thrust for at least 5% of each
  band's frames. The p50 is much lower because braking, lifting and cornering are in it too.
- dv/dt is a ±6-frame central difference of the smoothed speed. Eagleton's frame interval is 0.030 s where the others
  are 0.015 s, so its window spans twice the time. It is pooled as measured.
- **What the ghost lap is, and is not.** It is a point mass at full thrust from this table, never braking, capped at
  764 km/h (ARCHITECTURE §4's author drive). That is harder than any driver, and it is meant to be: a track that holds
  under it holds under a driver. Its loads are an upper bound, not a prediction.

## 7f. The measured corpus: what each word class builds, per the library (2026-09-27 night, desktop D; D182)
The keeper, 23:36, after 0.2.1: the pieces "arent good for t-180s". They were hand-set, not seeded from the words the
reader measured. This section measures them, per word class, into `src/doc/corpus.json` (numbers only).

**The reads** (read-only on the track folders; `READ_PROFILE=1` adds each side's tilt at ¼, ½, ¾ and the edge, and
leaves every other field of a read byte-identical, checked on T-180 Bowl Track):
`READ_PROFILE=1 node tools/read_track.cjs <dir> <length> <width> [layout] > reads/<name>.read.json`, with the length
and width from each track's own `ui_track.json`. All run by `node reads/readall.js`.

| layout | read | words | closed |
|---|---|---|---|
| Rainbow Road | 43,316 m | 696 | yes |
| Centrifuge | 34,353 m | 518 | yes |
| Hazen Loop | 30,963 m | 590 | yes |
| Onuris Long / Medium / Short | 23,791 / 19,227 / 7,415 m | 377 / 340 / 135 | yes |
| Sakura Speedway | 20,968 m | 342 | yes |
| Coast | 20,681 m | 354 | yes |
| Nordic | 20,298 m | 394 | yes |
| Thunderhead (the normal layout) | 9,166 m | 205 | yes |
| Eagleton (full, new) / Eagleton (short) | 8,327 / 2,308 m | 148 / 41 | yes |
| T-180 Test Track | 7,852 m | 167 | yes |
| The Bowltrack / T-180 Bowl Track | 2,459 / 2,058 m | 39 / 30 | yes |
| Serpents Spiral | 2,008 m | 35 | yes |

**Against §7b/§7c:**
- Sakura, Rainbow, Centrifuge, Hazen, Onuris ×3, the Test Track, Serpents and both bowl tracks read exactly as before.
- Coast (354 words, not 323), Nordic (20.3 km and 394 words, not 19.2 km and 312) and Thunderhead (205, not 222) read
  differently. §7b does not record their width arguments. They close, and are used as read.

**Excluded, each by name:**
- **Miandros: its read no longer closes.** It stops at the walk limit (11.8 km) or loses the road, with 8 jumps where
  §7b had 6. The §7d reach rule was regression-checked on Onuris and the bowl tracks, not on Miandros, and Miandros
  drops up to 41 m. That is not diagnosed here, and Miandros is left out rather than counted from a wrong walk.
- Aurora Cryopticon (Cash): outside the learning library (§7c).
- Chase's tracks other than Onuris, the Mtbcooler-only Eagleton copies, and an authorless track: outside the §7c rule.
- Thunderhead's night and no-dogbowls layouts: the same road as the normal one.

**The corpus:** `node tools/corpus.cjs reads > src/doc/corpus.json` (`test/corpus.test.js` rebuilds it from the reads
and requires it byte-equal when the reads are present).
- **One word of the reader's text is one sample.** Per class the table gives the median (p10–p90), by linear
  interpolation between order statistics.
- **Shared road counts once.** Layouts are taken longest first, and a later layout's word counts only if fewer than
  half its stations lie within 5 m of an earlier layout's. Onuris Medium is 79% Onuris Long's road, and Eagleton
  (short) is 85% the full layout's. 360 words were skipped as shared (`sharedWordsSkipped`).

| class | N | length m | radius m | heading ° | width m | bank ° | climb ° | bowl / pipe / flat |
|---|---|---|---|---|---|---|---|---|
| straight | 668 | 40 (16–168) | – | 0.4 (0.06–1.6) | 33 (28–46) | 11 (3–37) | 0 (−11–10) | 57% / 21% / 22% |
| sweep | 934 | 28 (12–76) | 800 (585–1,205) | 1.9 (0.8–5.9) | 33 (29–46) | 20 (5–42) | 0 (−12–10) | 52% / 23% / 25% |
| turn | 1,032 | 36 (16–116) | 296 (218–448) | 6.5 (2.4–21.7) | 33 (29–48) | 28 (11–44) | 0 (−9–8) | 52% / 23% / 25% |
| tight | 909 | 48 (20–128) | 102 (51–163) | 30 (8–91) | 31 (24–67) | 31 (16–42) | 0 (−7–7) | 52% / 28% / 21% |
| wall-ride | 334 | 36 (12–107) | 646 (166–2,778) | 3.0 (0.5–19.3) | 36 (29–42) | 80 (63–102) | 0 (−36–37) | 49% / 43% / 8% |
| inversion | 149 | 32 (12–92) | 820 (292–2,970) | 2.1 (0.4–13.2) | 37 (29–50) | 139 (116–168) | 0 (−29–31) | 48% / 38% / 13% |

**Jumps:** N 19 (Hazen 7, Onuris Long 4, Rainbow 3, Coast 2, Sakura, Thunderhead and the Test Track 1 each). The gap
is 125 m (81–206), and the drop 14 m (2–28).

**The profile ψ** (median tilt from the centre's normal at ¼ / ½ / ¾ / the edge of each side, in degrees):

| class | inside (low side on a straight) | outside (high side on a straight) |
|---|---|---|
| straight | 2.1 / 7.1 / 14.9 / 6.1 | 2.5 / 8.2 / 14.6 / 11.7 |
| turn | 2.7 / 8.7 / 15.3 / 9.1 | 1.8 / 7.8 / 14.6 / 9.4 |
| tight | 3.4 / 10.3 / 15.8 / 13.8 | 2.4 / 9.4 / 15.3 / 15.4 |

All of these are in `src/doc/corpus.json`, with p10 and p90.

**What these numbers are, and are not:**
- **A word is short.** The reader names every 4 m station and merges runs under 12 m, so a word is 28–48 m at the
  median. A builder piece is a few words: its length is not one word's.
- **ψ is the cross-section up to the lip, not the lip.** The reader's side walk stops at a fold sharper than 35° in a
  metre (§7), so ψ tops out near 30°, and the edge value can sit below ¾. The steep part of a wall shows in the bank
  (`up`, 80° on a wall-ride), not in ψ.
- **Radius is the centreline's**, as in §7 (Sakura's 454 m against the 300 m a replay drives).
- **Each word counts once**, however long. Weighting by length would shift the straights and sweeps up.


**RUNS, CORNERS AND TRANSITIONS** (added 2026-09-28 night; the same command, `node tools/corpus.cjs reads > src/doc/corpus.json`).

A reader word is a run-length token of 4 m stations, 28–48 m at the median, so a word is NOT a piece. Three aggregates say what a piece spans:
- **A RUN** is consecutive words of exactly the same class and the same turn direction. The reader names a wall-ride
  or an inversion by the turn under it too (e.g. `bowl-turnL^wall`), so those runs split by direction as well. Only a
  straight has no direction.
  - No tolerance for a one-token interruption: the reader already folds runs under 12 m into their neighbours, and a
    second tolerance would hide real short pieces behind a tuning parameter.
  - A left-then-right is two runs.
  - A skipped (shared-road) word breaks a run, and no transition is counted across it. The lap is not wrapped from its
    end to its start.
- **A CORNER** is consecutive curved words (sweep, turn, tight) turning the same way, whatever the class, keyed by the
  tightest class it reaches.
  - A straight, a wall-ride, an inversion, a jump, a change of direction or a shared word ends it.
  - It is what a user's "turn" piece spans: in the library a corner opens and closes through the classes (§7's
    `sweep → turn → tight → turn → sweep`), so a run of one class is only a part of it.

| run of | N runs | words per run | length m | heading ° | climb m |
|---|---|---|---|---|---|
| straight | 534 | 1 (1–2) | 48 (16–224) | 0.6 (0.1–2.1) | 0 (-10.5–12.2) |
| tight | 527 | 1 (1–3) | 91 (24–212) | 52.8 (9–180.6) | 0.2 (-10.1–11.4) |
| turn | 903 | 1 (1–2) | 36 (16–132) | 6.8 (2.5–25.8) | 0.1 (-7.9–7.4) |
| sweep | 880 | 1 (1–1) | 28 (12–84) | 2 (0.8–6.3) | 0 (-7.3–6.2) |
| jump | 19 | 1 (1–1) | 125 (81–205.8) | 0 (0–0) | -14 (-27.8–-2) |
| wall-ride | 187 | 1 (1–4) | 48 (16–213.8) | 2.3 (0.3–43.7) | -0.3 (-47.3–46.9) |
| inversion | 93 | 1 (1–3) | 44 (12–161.6) | 1.6 (0.3–23) | -0.4 (-31.9–28) |

| a corner reaching | N | words | length m | heading ° | climb m |
|---|---|---|---|---|---|
| sweep | 257 | 1 (1–1) | 24 (12–77.6) | 1.2 (0.6–4.3) | -0.1 (-12.5–9.7) |
| turn | 116 | 3 (1–6.5) | 100 (24–482) | 12.4 (2.6–61.7) | -0.8 (-32.6–40.9) |
| tight | 383 | 5 (2–10) | 212 (64–618.4) | 88.3 (32.4–255.5) | 0.1 (-21.8–22.6) |

**TRANSITIONS:** the class of the run that follows a run of each class. P, with the rows' N; an aggregate over all layouts, no track's sequence.

| from ↓ to → | N | straight | sweep | turn | tight | wall-ride | inversion | jump |
|---|---|---|---|---|---|---|---|---|
| straight | 525 | · | 0.78 | 0.13 | 0.03 | 0.02 | · | 0.03 |
| sweep | 874 | 0.49 | 0.04 | 0.44 | 0.01 | 0.02 | · | 0.00 |
| turn | 897 | 0.05 | 0.43 | 0.03 | 0.46 | 0.03 | · | · |
| tight | 520 | 0.03 | 0.05 | 0.76 | 0.15 | 0.01 | 0.00 | · |
| wall-ride | 187 | 0.07 | 0.11 | 0.11 | 0.02 | 0.55 | 0.14 | · |
| inversion | 93 | · | · | · | · | 0.30 | 0.70 | · |
| jump | 19 | 1.00 | · | · | · | · | · | · |

**What they say:**
- **A run is mostly one word:** the median is 1 word per run in every class, since the classes change as a corner opens and closes.
- **A whole corner reaching tight** spans 212 m (64–618) and turns 88° (32–256). One tight word is 48 m and 30°.
- **The grammar, measured:**
  - straight → sweep 0.78;
  - sweep → straight 0.49 or turn 0.44;
  - turn → tight 0.46 or sweep 0.43;
  - tight → turn 0.76.
  - A straight goes straight into tight only 0.03 of the time: FINDINGS §7's "never straight into tight", as a number.
- **Diagonal entries are real:** a run reversing its turn direction within the same class. Tight → tight is 0.15,
  turn → turn 0.03, wall-ride → wall-ride 0.55, inversion → inversion 0.70. A straight cannot follow itself.
- **Every jump is followed by a straight** (19 of 19): the landing ramp.

## 7g. M1: do T-180 tracks share a spectrum? (2026-09-28 night, desktop D; a measurement of the design notes' M1)
**The prediction (design notes §8):** "T-180 tracks share a spectral signature (falloff and load-rhythm period)
distinct from the normal circuits. It fails if the T-180 spectra are no closer to each other than to the normal
circuits."

**The method was registered before anything was computed:**
- **Signals:** κ_h (the reader's curvature), κ_v (the change of the grade angle along s) and bank (`up`), on a 4 m grid,
  mean removed.
- **Estimator:** a Welch PSD with 1,024 m Hann segments and 50% overlap.
- **Band:** 16–512 m wavelengths.
- **Distance:** the RMS difference of the unit-power-normalised log-PSDs (shape, not level), averaged over the three
  signals.
- **Verdict:** W is the mean T-180 × T-180 distance, B the mean T-180 × circuit distance. **PASS iff W < B.**
- **Tracks:** 13 T-180 tracks, one layout each (the §7f reads; one layout per track so near-duplicate layouts cannot
  flatter the group).
- **The two circuits** were the two best-closing reads of seventeen tried: Silverstone 1967 (4,516 of 4,710 m) and
  Magione (2,352 of 2,507 m). The reader, built for T-180 meshes, loses most circuits' road or closes them far short;
  Monza 1966 (road) also closed, at 93%.

**The command:** `node tools/spectrum.cjs reads` (prints summary numbers only).

**The estimator, checked first on known signals:** a 128 m sine peaks at 128 m, white noise gives β −0.03, and a
random walk β −1.98 (expected −2).

**Result: PASS.**
- **W = 0.808, B = 1.215, B/W = 1.50** (78 and 26 pairs).
- **Not part of the verdict:**
  - permutation (10,000 shuffles, seed 1): p = 0.012;
  - each T-180 track's nearest spectrum is another T-180 track, 13 of 13;
  - all three pairs of the three closing circuits pass (B/W 1.36, 1.45, 1.50).

**Per signal** (not registered, a decomposition):

| signal | W | B | B/W |
|---|---|---|---|
| κ_h (turning) | 0.873 | 0.987 | 1.13 |
| κ_v (cresting and dipping) | 0.614 | 1.344 | 2.19 |
| bank | 0.936 | 1.313 | 1.40 |

**Falloff slopes β** (log-log, over 16–512 m; T-180 range across 13 tracks, then the circuits):

| signal | T-180 | Silverstone 1967 | Magione |
|---|---|---|---|
| κ_h | −3.3 to −5.1 | −5.0 | −5.7 |
| κ_v | −1.9 to −3.6 | −1.1 | −0.1 |
| bank | −1.7 to −4.2 | −1.8 | −2.6 |

**What it does NOT say:**
- **The "load-rhythm period" half is not supported by a peak.** The dominant period sits at the band's longest
  wavelength, 512 m, for nearly every track and signal: the spectra rise toward long wavelengths, with no rhythm
  inside 16–512 m.
- **Most of the separation is vertical, and partly because circuits are flat.** Their κ_v is 10–50× smaller (RMS
  1.2×10⁻⁴ and 3.9×10⁻⁵ 1/m against ~1.7×10⁻³), so its spectrum is closer to measurement noise. In turning alone
  (κ_h), T-180 tracks are only a little closer to each other than to the circuits (1.13).
- **Two circuits are two points,** read by a reader built for other meshes. The PASS says the T-180 group sits apart
  from these two, not from normal circuits in general.

## 4d. Which car §4's "~20 g" holds for (note, 2026-09-28)
**The note (R1; §4's text is kept as it was registered).** The "~20 g" was registered from the GitHub
`Source/base` car's coilover rate, 80,000 N/m front and rear. It is not the rate of every installed Mach 6:
- **The installed `ohyeah2389_t180_mach6_active`** has 15,000 N/m front and 100,000 rear, `MIN_LENGTH` 0.975 (0.425 m
  of range), a bump stop (`END_RATE`) of 750,000 against 250,000, and a different downforce ray. These are C's R1
  table, read on disk: `docs/research/04_ac_physics_drivability.md` §5.
- **Both replays this section measured were driven with `ohyeah2389_t180_mach6`,** not `_active`: the replay's own car
  id, read with blackbox's parser (`extractCar(...).car.carId`) from `samples/centrifuge.acreplay` and
  `samples/ohyeah2389_t180_mach6_ohyeah2389_t180testtrack__240726-143319.acreplay`.
  - That car's config is packed in `data.acd` on D, so its coilover rate is NOT read here.
  - Of the 74 replay files in D's replay folder, 69 carry `t180_mach6` in their file names and none `mach6_active`.
    That count is from file names; the car id inside was read only for the two above.
- **So the figure holds for** the car the replays recorded, `ohyeah2389_t180_mach6`: measured, not registered, since
  its springs were not read.
  - The registration's input (80,000 N/m) is the GitHub base car's.
  - **Nothing here says where the installed `mach6_active` runs out.** A replay driven with it, measured by
    `node bottoming.cjs`, would say.
