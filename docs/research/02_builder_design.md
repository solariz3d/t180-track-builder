# Research 2: how track and coaster builders are designed (2026-09-27)

A research agent surveyed about 30 sources. **[unverified]** marks memory or snippets it could not open.

## The editors
- **Trackmania:** a block grid with snapping and edge connectors. Modes: Block, Terraform, Paint, Item, Macroblock
  ([maniadoc](https://doc.maniaplanet.com/map-editor/how-to-use-the-map-editor)).
  - **Validation:** a red, orange or green flag. A map is playable only after the author drives it start to finish.
  - **Getting off the grid:** 20 years of mappers escaping it, through hex edits, TMUnlimiter, then built-in ghost
    blocks and free placement ([TMX](https://tm.mania.exchange/threads/2532/block-mixing-now-built-in?page=-1)).
  - **Pain points:** no curved or spline roads
    ([Steam](https://steamcommunity.com/app/232910/discussions/0/2570942392184107508)); plugins are needed for basics.
- **PolyTrack:** a Trackmania-like browser editor with loops, wall rides, gap jumps and banked turns. **Tracks are
  shared as compact text codes** ([polytrack.blog](https://polytrack.blog/polytrack-editor/)).
- **NoLimits 2:** Bézier vertices, roll nodes, and a heartline at spine, rider or natural position.
  - **Live combs** along the track for speed, g-force and radius
    ([docs](https://nl2docs.arborarcade.com/pages/editor.html)).
  - **Force Vector Design** (FVD++, KexEdit) defines sections by target vertical g, lateral g and roll, then
    integrates the centreline ([Kopack](https://iankopack.com/2021/05/12/force-vector-design-roller-coaster-centerline-modelling-part-ii/),
    [openFVD](https://github.com/altlenny/openFVD), [KexEdit](https://individualkex.itch.io/kexedit)).
  - **Reputation:** accurate and free, but a steep learning curve.
- **RollerCoaster Tycoon:** a build head with turn, slope and special menus. Only legal pieces are offered.
  Auto-complete closes the loop, and there are test runs with excitement, intensity and nausea ratings; RCT3 shows
  ghost cars ([rct.wiki](https://rct.wiki/wiki/Building_A_Ride)).
- **Planet Coaster:** a build head plus spline nodes (pitch, yaw, roll), with auto-smooth. A test run is required, and
  heatmaps show the results.
  - **Complaints:**
    - auto-complete takes the shortest path and **spikes fear and nausea before the station**
      ([SteamSolo](https://steamsolo.com/guide/designing-coasters-101-planet-coaster/))
    - 11.25° snapping ([Steam](https://steamcommunity.com/app/493340/discussions/0/1470840994979385304/))
    - players ask for a force-graph overlay ([Frontier](https://forums.frontier.co.uk/threads/coaster-building-tools-better-g-force-track-overlay.489285/))
- **Thrillville:** D-pad up, down and turn, plus "whoa" pieces; the same builder makes go-kart tracks
  ([Worthplaying](https://worthplaying.com/article/2006/12/23/reviews/38656-ps2-review-thrillville/)). Easy, but "less
  creative freedom".
- **Hot Wheels Unleashed:** construction and modify modes, and automatic closure under a maximum segment length. **Each
  track must be validated by a full lap in the Tractor**, which catches jumps that can't be made. Official tracks use
  the same tool ([Game Developer](https://www.gamedeveloper.com/design/a-closer-look-at-hot-wheels-unleashed-2---turbocharged-track-builder)).
- **ModNation Racers:** drive a paver to lay road; auto-populate; Advanced Edit for point-by-point control. Aims to
  "cater to both casual and advanced users" ([PS Blog](https://blog.playstation.com/2009/12/23/modnation-racers-track-studio-walkthrough-with-track-designer-mark-riddell/)).
- **Gran Turismo 5 Course Maker:** sector sliders for corner frequency, sharpness, topography and bank. Prior art for
  "tempo". Flaw: changing one sector reshuffles the ones after it ([GTPlanet](https://www.gtplanet.net/early-info-on-gran-turismo-5s-course-maker/)).
- **Race Track Builder:** spline plus cross-sections, exporting to AC. Complaints: "a journey of a thousand
  frustrations", generic scenery, crashes on import ([Steam](https://steamcommunity.com/app/388980/reviews/?p=1&browsefilter=toprated)).
- **Bob's Track Builder:** nodes with Cardinal or Bézier curves. Complaints: it "crashes constantly", takes 30 s or more
  per update, and is abandoned ([Steam](https://steamcommunity.com/app/993270/reviews/?browsefilter=toprated)).

## A platform constraint
Community-reported ([OverTake](https://www.overtake.gg/threads/upside-down-track.146345/)):
- Vanilla AC tyre raycasts go straight down and ignore surfaces steeper than about 50°.
- **CSP adds wall and ceiling tyre raycasts** for cars that enable them. (The T-180 replays show cars riding at 100–133°,
  so they do.)
- Drivable surfaces stacked within about 2 m confuse the tyres.
- WALL objects collide with the car body, not its tyres.

## Prior art: tracks as a language
- **Chain codes** for isometric tracks ([SBGames 2021](https://www.sbgames.org/proceedings2021/ComputacaoFull/217347.pdf)).
- **Evolved b-spline tracks** with player-speed fitness ([Togelius 2006](http://julian.togelius.com/Togelius2006Making.pdf)).
- **TrackGen**: interactive evolution for TORCS ([ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1568494614005705)).
- **Racing-line curvature encoded as strings** and matched with regular expressions ([ResearchGate](https://www.researchgate.net/publication/347438171_Procedural_race_track_generation_for_domain_randomization)) [unverified which paper].
- **L-systems for roads** (Parish and Müller 2001).
- **FVD** as the strongest precedent for describing a track by its dynamics.

## Lessons for our program
1. **The language compiles to a spline, never to meshes.** Each word expands to segments, roll keys and a
   cross-section ID.
2. **Words can carry target force profiles, as FVD does.** Tempo sets how fast g ramps up.
3. **Keep geometric words beside force words** (straights, jumps, sculpted pieces).
4. **Car validation is a grip budget, not coaster rider comfort.** Colour by margin along the track (NL2-style combs),
   not only per piece.
5. **Build to AC's real contact limits** (CSP wall raycast, 2 m stacking, road-not-WALL).
6. **Require a full-lap proof before export** (Trackmania, Hot Wheels).
7. **Auto-complete solves for dynamics, not length.** Rank closing phrases by worst margin and cap segment length.
8. **Layered feedback:** per piece, per phrase (flow and commitment ratings), per lap, with both a heatmap and a force
   graph.
9. **One tool that reveals more as you go,** from beginner to expert. Sculpt mode is the ghost-block equivalent.
10. **Font and tempo sliders must not move downstream geometry** except through an explicit re-join (GT5's flaw).
11. **User-defined phrases,** like Trackmania's macroblocks.
12. **The track is a shareable text string** (PolyTrack), which gives undo and diffs for free.
13. **No coarse world-angle snapping** (Planet Coaster's 11.25°). Snap at joins.
14. **Stability and export reliability matter as much as the editor's feel** (RTB and BTB).
15. **Adapt the heartline:** validate across a band of lines on a half-pipe, not only the centreline.
