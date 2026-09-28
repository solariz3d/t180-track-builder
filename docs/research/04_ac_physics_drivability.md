# Research 4: what AC and CSP physics need from a T-180 road (2026-09-28)

The question: what does Assetto Corsa, with Custom Shaders Patch (CSP), do when a tyre or the car's body meets the
road, and what does that ask of the geometry and files the builder writes?

**How this was gathered** (pane C, R1):
- A research agent read CSP's own wiki (`github.com/ac-custom-shaders-patch/acc-extension-config/wiki`), CSP changelog
  mirrors, a Kunos developer's post and the T-180 car repository. Most pages came through a summarising reader, so a
  quote is verbatim only where it is in quotation marks.
- Then checked locally, read-only, against the installed tracks and cars on this PC
  (`G:\SteamLibrary\steamapps\common\assettocorsa\content`). **No AC launch; nothing was driven.**
- Every claim is marked **SOURCED** (a primary source or a file on disk, given beside it), **MEASURED** (a command
  on this PC, given beside it) or **UNVERIFIED**.
- **Licence:** the T-180 repository is dual-licensed, physics assets CC BY-NC-SA 4.0 and art assets CC BY-NC-ND 4.0
  (SOURCED: `LICENSE.txt` at github.com/ohyeah2389/Assetto-T-180). This note quotes a few config keys and short code
  fragments as facts about the car. **No code or file is copied into the builder.**

## 0. The short of it
1. **The soft road may need extended physics switched on, and the builder does not switch it on.**
   - Of the 39 installed track surfaces.ini files with a `[COLLISION_PARAMS_...]` block, 25 also declare
     `WAV_PITCH=extended-0`, CSP's switch for extended track physics. Sakura, Centrifuge, the T-180 Test Track, Hazen,
     Coast and Rainbow are among the 25. (FINDINGS §4c does not list its eleven, so "all of them" is not claimed.)
   - The builder writes the block with no such surface (§2).
   - Whether the block works without the switch is **UNVERIFIED**. Onuris, Daytona and ThunderHead carry the block
     without it. One AC session with the two variants would settle it.
2. **The car's downforce comes from a ray cast from the car to the road** (the installed Mach 6). If the ray misses
   the track, the downforce is **zero**. The road under the car's nose is therefore part of the car's aero (§4).
3. **A stock AC tyre touches the road at one point,** so a crease reaches the car as an instant change of normal. CSP adds
   more rays, and the installed car switches CSP's extended rays on (§1). FINDINGS §2's rule, seam angle ≈ triangle
   size ÷ radius with seams kept under about 1°, stays the right target.
4. **The installed Mach 6 is not the GitHub `Source/base` car.** Suspension rates, bump-stop rate and the downforce
   script differ (§5). The builder should be calibrated on what the keeper drives, and the FINDINGS numbers that came
   from the base files should be re-checked.

## 1. Where a tyre meets the road
- **SOURCED:** "To find where tyres come to contact with ground AC casts rays against laserscanned (or not) meshes"
  (CSP wiki, *Tracks – Custom raycasting*). A track may supply its own raycaster there.
- **SOURCED, Kunos:** "the tyre model of AC and ACC uses one single point to determine contact of the tyre with the
  terrain." At a kerb the point "stays in the completely horizontal surface" and then "Instantly it will understand a
  30° surface inclination", which gives "big spikes in forces and grip". ACC moved to five points; AC did not.
  (Aristotelis, *ACC: the 5-point tyre model* blog, overtake.gg.)
- **SOURCED, CSP:** tyres.ini `[_EXTENSION]` keys `LATERAL_RAYS` ("per side, 0 means 1 in middle"),
  `LONGITUDINAL_RAYS`, `MAX_RAY_ANGLE` ("degrees swept per side") and `DISABLE_RAY_DOUBLING`, under "Extended
  Raytracing for Tire Collision Detection and Contact Patch Movement" (CSP wiki, *Cars – Tyre Physics*).
- **SOURCED, CSP changelog 0.2.3-preview211:** "Better edge-case contact normal calculation (limits contact normals to
  some threshold from tire radial normal; should avoid strange load spikes …)"; "Tyre rays don't see wall meshes as
  double-sided" (c1xtz.github.io/csp-logs/0-2-3p211).
- **SOURCED, on disk:** the installed Mach 6's `tyres.ini` has `[_EXTENSION] EXTENDED_RAYTRACING=1`
  (`content/cars/ohyeah2389_t180_mach6_active/data/tyres.ini:7-8`). **UNVERIFIED:** what that key does. It is not on
  the wiki page, and its name suggests it switches the multi-ray contact on.
- **UNVERIFIED:** whether a physics ray hit uses the triangle's face normal or smoothed vertex normals. No primary
  source was found. If it is the face normal, a crease is felt at its full angle whatever the vertex normals say.

**What it means for the builder** (FINDINGS §2, §5):
- The road's seam angles are what the tyre feels, one contact at a time. Mesh finer as curves tighten, keep seams
  under about 1°, and keep the flag on "seams past the proven sharpness" (§5 RED, still inferred).
- **Do not count on smoothed normals to hide a crease** until the face-versus-vertex question is answered.
- **Measurable without AC:** the builder's own exported seam-angle distribution against FINDINGS §2's envelope
  (median 0.2–1.1°, p90 1.1–5.9°). That is a test the builder can own. It is not written here.

## 2. The soft road and extended physics
- **SOURCED, CSP wiki (*Tracks – Enabling extended physics*):** set `[SURFACE_0] WAV_PITCH=extended-0` in
  surfaces.ini. Plain AC would crash on that value; CSP "would catch this value, stop AC from crashing and mark that the
  track can use extended physics". surfaces.ini is used because it is "the file that's being checked for integrity with
  most online servers". The wiki's sidebar lists collision parameters among the extended-physics features.
- **SOURCED, CSP wiki (*Tracks – Collision parameters*):** `SOFT_CFM`, "Constrain force mixing, the higher it is, the
  softer is the collision"; `MAX_DEPTH`, "If set and collision depth is above that parameter, collision becomes hard:
  might help with performance and avoid objects passing through walls". The page itself does not state a prerequisite.
- **MEASURED** (`find …/content/tracks -name surfaces.ini` and grep, 2026-09-28):
  - 39 surfaces.ini files carry `[COLLISION_PARAMS_...]`. **25 of the 39** also have a surface with
    `WAV_PITCH=extended-0`.
  - The 14 without it:
    - Chases_Onuris ×4 and T-180_Daytona ×3 (`WAV_PITCH=1.3` on SURFACE_0);
    - ThunderHead(Wii Version) ×3;
    - WRL Singer Speedway;
    - Fuji Helexicon;
    - **the builder's own two exports**, `t180b_app_loop` and `t180b_platform_test`.
  - Sakura, Centrifuge, the T-180 Test Track, Hazen, Coast and Rainbow all have it. On Sakura it sits on a `KEY=PIT`
    surface.
- **The builder today** (`src/export/trackfiles.js`, `surfacesIni`) writes the §4c block and a header saying no surface
  is redefined. So **no `extended-0` surface is written.**
- **UNVERIFIED, and the one thing to test in AC:** whether the soft block takes effect without the switch.
  - The 25/39 pattern and the sidebar say "probably needs it".
  - Onuris, Daytona and ThunderHead say "maybe not". Or they fly on a hard road, and no one noticed because nothing
    on them compresses to 20 cm. That is the case FINDINGS §4c's registered prediction is about.
  - **The test:** export one track twice, with and without a SURFACE_0 marked `extended-0`, and drive a hard
    compression on each. Only the keeper can run it (no AC launch here).
- **What changes in the builder if it is needed:** `surfacesIni` also writes one surface with `WAV_PITCH=extended-0`.
  - The cost is stated by the wiki: plain AC without CSP crashes on that file. A T-180 already needs CSP
    (`REQUIRED_VERSION=3435` in `car.ini`), so the cost falls only on someone loading the track with another car and
    no CSP.
  - It also changes the file online servers checksum.
- **The keys the builder leaves out:** `INTENSITY`, `RIGID_WITH_BODIES` and `RIGID_WITH_BOXES`. The installed tracks set
  them to 1 / 0 / 0. The wiki notes the parameters are optional, and recommends `INTENSITY = 1` when `MAX_DEPTH` is used
  (as summarised by the reader, not verbatim). This is the difference `trackfiles.js` already names. The
  recommendation is a reason to add `INTENSITY=1`.

**Linked to FINDINGS §4c:** §4c explains why 20 cm under the surface still flows. This section adds what §4c did not
check: the switch. **§4c's prediction ("a T-180 glitches through hard compressions on a normal track, which has no
block, and stops glitching when the block is added") should be run with the switch set, or it tests two things at
once.**

## 3. Walls
- **SOURCED, CSP:** tyre rays treat wall meshes as single-sided (0.2.3-preview211, above).
- **SOURCED, CSP wiki (*Tracks – Geometric colliders*):** capsule, cylinder, sphere, box and plane colliders. Boxes for
  walls "might provide some performance and stability improvements".
- **SOURCED, CSP wiki (*Tracks – General extended physics options*):** `RIGID_WALLS_COLLISIONS=0`,
  `RIGID_FLOOR_COLLISIONS=0` and `RIGID_DIRT_COLLISIONS=0` in `[_EXTENSION]`.
- **UNVERIFIED:** a named CSP feature called "wall raycasting". None was found.
- **MEASURED:** the builder's export (`tools/kn5.cjs` over the D181 installed-window export) has only `1ROAD_*` physics
  meshes (`_in`, `_body`, `_out`, `_seam_*`) and `PAINT_*` visuals, and no wall mesh.
  - A half-pipe or tube wall is therefore road: a tyre can ride it, and the soft block covers it.
  - That is the right choice for T-180 wall-riding, and it means the single-sided-wall rule does not apply to it.
- **If the builder ever adds barriers** (`1WALL…`, which `markers.js` already treats as not drivable): face their
  normals toward the road, because the tyre rays see one side.

## 4. The car's downforce is a ray to the road
**SOURCED, on disk** (`content/cars/ohyeah2389_t180_mach6_active/data/script.lua:424-433`):
- The ride-height reading is `physics.raycastTrack(car.position + (car.up * 0.4) + (car.look * 1.0), -car.up, 1.0)`.
  That is a ray from 0.4 m above the car's origin and 1.0 m ahead of it, 1.0 m long, straight down the car's own up
  axis.
- Suction is `clamp(remap(reading, 0.5, 0.9, 1, 0), 0, 1)`, and 0 when the reading is −1:
  - full when the road is within 0.5 m of the ray's start;
  - falling to none at 0.9 m;
  - **none if the ray hits nothing.** That −1 means a miss is inferred from the code, not documented.
- The force is `-200 × horizontal speed × suction` (−160 on two other cars), straight down the car's up axis, applied
  at the origin.
- **UNVERIFIED arithmetic, if speed is in m/s:** 100 m/s gives 20 kN, about 2.4 × the car's 850 kg weight (8.3 kN).
  It is linear in speed, so it roughly doubles again at 200 m/s.

**What it means for the builder:**
- **The road must be under the ray, 1 m ahead of the origin, within about 0.5 m of the ray's start.**
  - Anything that removes it takes away the downforce at once: a hole or gap in the physics mesh, the lip of a jump, a
    road edge the nose passes over, or a crest falling away faster than the car.
  - That is a stronger reason than seams for FINDINGS §5's RED on "gaps or holes in the road mesh".
- **UNVERIFIED:** whether `raycastTrack` hits only physics meshes (`1…`) or visual ones too. If only physics, then a
  visual-only piece of road under the car gives no downforce.
- **At a crest** of radius R, the road 1 m ahead falls about 1/(2R) m below the tangent: 5 mm at R = 100 m. So crests
  are not the risk; edges and gaps are.

**Linked to FINDINGS §7d and §7e:** §7e found the fall in the air is partly the turbine override's pitch moment (thrust
0.77 m above the origin). This section adds the other half:
- **In the air, the ray misses and the downforce is zero.** So the flight is gravity plus the override, as §7d's fits
  assumed.
- **On a landing ramp,** the downforce returns the moment the ray finds the ramp, 1 m ahead of the origin. That is a
  step of up to 2.4 g at 100 m/s (on the unverified arithmetic above).
- **A landing check should expect that step,** not only the fall.

## 5. The installed Mach 6 is not the base car on GitHub
The research agent read the GitHub `Source/base` files (HEAD 8f655a5c, 2026-09-24). The installed
`ohyeah2389_t180_mach6_active` differs. Both columns are SOURCED: the left from the raw files at that commit
(`suspensions.ini:58-65, 119-126`, `script.lua:414-438`, re-read with curl 2026-09-28), the right on disk in `data/`:

| | GitHub `Source/base` | installed `mach6_active` |
|---|---|---|
| coilover `RATE` | 80,000 front and rear | **15,000 front, 100,000 rear** (`suspensions.ini:58, 119`) |
| `MIN_LENGTH` / `MAX_LENGTH` | 0.9 / 1.4 | **0.975** / 1.4 |
| `END_RATE` (the bump stop) | 250,000 | **750,000** |
| downforce ray | from +0.4 up, 2.0 m long | from +0.4 up **and 1.0 m ahead, 1.0 m long** |
| suction fade | 0.5 → 2.0 m | **0.5 → 0.9 m** |
| "stalling" cut-off below 0.5 m | present ("combats clipping") | **absent** |
| downforce base | −150 | **−200** |

Unchanged: `TOTALMASS=850`, `WHEELBASE=3.43`, `GRAPHICS_OFFSET=0, -0.4, 0`, the collider box (`CENTRE=0, 0.2, 0`,
`SIZE=2.0, 0.5, 3.0`), and the tyres (`RADIUS=0.395`, `WIDTH=0.45`, `RATE=270000`).

**Linked to FINDINGS §4:** §4 registered "~20 g" from a coilover rate of 80,000 N/m and about 0.5 m of range, and the
replays confirmed it.
- The installed car has 15,000 in front and 100,000 at the rear, 0.425 m of range, and a stiffer stop. So §4's
  confirmation came despite a wrong input, or the replays were made with another version of the car.
- **UNVERIFIED which.** Worth one line in FINDINGS §4 by its owner, not a change made from here.

## 6. Load, and what nothing documents
- **SOURCED:** COSMIC suspension bottoms only through its hard stops at `MIN_LENGTH` / `MAX_LENGTH` (`END_RATE`), and
  its solver struggles with "complicated and stiff" linkages (CSP wiki, *Cars – COSMIC Suspension*).
- **SOURCED:** hard collisions help against falling through at speed, `MAX_DEPTH` makes a deep contact hard, and
  `RIGID_WITH_BOXES` is for underbody boxes (*Collision parameters*, above).
- **UNVERIFIED:** AC's physics tick rate (a "333 Hz" figure is often quoted; no primary source); any documented key for
  physics-mesh resolution, collision tolerance or normal smoothing; tyre sink depth at tens of g.
- **So the only evidence on high load remains the replays** (FINDINGS §3, §4, §4b, §4c): a soft road took about 90 g and
  flowed.

## 7. What would change in the builder, in order of what it would cost to be wrong
1. **`surfacesIni` writes an `extended-0` surface**, if the AC test in §2 shows the soft block needs it. Without it, every
   exported T-180 track may be on a hard road.
2. **`INTENSITY=1` in the soft block**, the one key the wiki recommends alongside `MAX_DEPTH`.
3. **A check for physics-mesh gaps under the downforce ray** (§4), as RED: a gap removes the car's downforce, not only
   its grip.
4. **Seam angles tested against FINDINGS §2's envelope** at export (§1).
5. **Calibrate on the installed car** (§5), and state which car version a replay was driven with.

None of these is made by this note. It is research, and the owners of `src/export` and FINDINGS decide.

## Open, needing another method
- Does `[COLLISION_PARAMS_...]` need `extended-0`? (An AC session with the two exports.)
- Face or smoothed normals at a physics ray hit; ray behaviour exactly on a seam. (A test track with a known crease, and
  telemetry; or a developer's statement.)
- What `EXTENDED_RAYTRACING=1` does, and how many rays it gives.
- Does `physics.raycastTrack` hit visual meshes too?
