// platform_test.js: the 500 m platform test track of docs/ARCHITECTURE.md §10.1, built as plain world data in the
// shared T1 scene shape (src/export/scene.js validates it; A's writer turns it into kn5 bytes, E writes the INI/PNG).
//   node scripts/platform_test.js        prints a summary: length, closure, cells, the wall angle, the jump table
//
// WHAT IS BUILT (a stadium loop, run counter-clockwise seen from above, every turn a LEFT turn):
//   straight B  (grid, pit box, hotlap run-up, start/finish gate)   flat font, 26 m of road
//   turn 1      (180°, the half-pipe section)                        both walls rise to 60°
//   straight A  (the jump: kicker, gap, landing, run-out)            flat font
//   turn 2      (180°, the wall-ride)                                the outside (right) wall turns to 110°, past vertical
//
// GEOMETRY CHOICES, stated:
//   · Centreline from words (straight / arc / pitch program / gap), integrated at DS = 0.5 m. Arc steps use the exact
//     chord, so the loop closes by construction: straight B is set to straight A's horizontal run, and R is solved so
//     the path is 500 m.
//   · The frame is gravity-referenced (forward = tangent, left = up × forward normalised, up = forward × left). It is NOT
//     the rotation-minimising frame of ARCHITECTURE §3: that frame is the editor's. Here the tangent never pitches past
//     5°, there is no roll and no torsion, so the two coincide up to the pitch, and closure is exact.
//   · The cross-section is one data type (ARCHITECTURE §2 "font"): a flat floor of 2·WF m plus a wall of arc length LW
//     on each side whose turning angle ψ is the font's knob (ψ = 0 is a flat shoulder). Every station has the same
//     vertex count, so fonts blend (smoothstep over ±BLEND m at each word boundary) without re-meshing.
//   · Seams: 0.5 m along (0.5 / 28.7 m ≈ 1.0° on the turns) and ψ/NW across (110° / 96 ≈ 1.15°), against FINDINGS §2's
//     proven envelope of median seams 0.2–1.1° (FINDINGS.md:24).
//   · ONE mesh per cell, physics and visual at once (1ROAD_<k>, renderable). A separate visual mesh buys nothing on an
//     untextured test track. The wall-ride is road, not WALL (ARCHITECTURE §4: a WALL-object wall-ride is red).
//   · Positions are WORLD coordinates with identity matrices. The track spans under 200 m, where float32 steps are about
//     1.5e-5 m, so cell-relative vertices (ARCHITECTURE §3) are not needed here.
'use strict';

const DEG = Math.PI / 180, G = 9.81;
const L_TOTAL = 500;          // m, ARCHITECTURE §10.1
const DS = 0.5;               // m, station spacing
const WF = 5;                 // m, half floor width
const LW = 8;                 // m, wall arc length each side
const NF = 10, NW = 96;       // segments: floor, each wall
const BLEND = 10;             // m each side of a word boundary
const CELL_STATIONS = 250;    // stations per cell; 250 × 203 = 50,750 vertices < 65,536
const FONTS = { flat: [0, 0], halfpipe: [60, 60], wallride: [30, 110] }; // [ψ left, ψ right] in degrees

// ---- the jump (straight A). Sized in jumpDesign() below; see the summary for the arithmetic. ----
const JUMP = {
  runIn: 15,                  // m, flat, clear of the font blend
  kickerEase: 20, theta: 4,   // pitch 0 → θ over 20 m (vertical radius 20/θ ≈ 286 m, inside FINDINGS §2's 65–320 m median)
  kickerHold: 15,             // m at θ; the lip is the end of this
  gap: 12, drop: 0.7,         // m horizontal, m lower landing lip
  landBeta: 2, landEase: 35,  // landing ramp pitch −β, eased back to 0 over 35 m; the hold is solved so height closes
  bandKmh: [250, 350],        // design take-off speeds
  gLow: 3.2, gHigh: 6.3,      // the fall in the air, FINDINGS.md:337 (§7d) and ARCHITECTURE §4
  clearMin: 0.5,              // m above the landing lip at the gap's far edge
  impactMax: 10,              // degrees, flight path vs road at touchdown: MY design limit, not a measured one
};
const SA = 160;               // m, straight A path length (incl. the gap chord)

// ---------------------------------------------------------------- small vector helpers
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); if (!(l > 0)) throw new Error('zero-length vector'); return mul(a, 1 / l); };
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// ---------------------------------------------------------------- the pitch program of straight A
/** Pitch segments along straight A. Each is { L, p0, p1 } eased by cosine, or { gap:true, D, drop }. */
function jumpProgram(landHold) {
  const j = JUMP, th = j.theta * DEG, b = -j.landBeta * DEG;
  return [
    { L: j.runIn, p0: 0, p1: 0 },
    { L: j.kickerEase, p0: 0, p1: th },
    { L: j.kickerHold, p0: th, p1: th },
    { gap: true, D: j.gap, drop: j.drop },
    { L: landHold, p0: b, p1: b },
    { L: j.landEase, p0: b, p1: 0 },
  ];
}
/** Net height change of a pitch program, integrated exactly as buildCenterline does. */
function programRise(prog) {
  let y = 0;
  for (const seg of prog) {
    if (seg.gap) { y -= seg.drop; continue; }
    const n = Math.max(1, Math.round(seg.L / DS)), ds = seg.L / n;
    for (let i = 0; i < n; i++) y += ds * Math.sin(easeP(seg, (i + 0.5) / n));
  }
  return y;
}
const easeP = (seg, t) => seg.p0 + (seg.p1 - seg.p0) * (1 - Math.cos(Math.PI * t)) / 2;
/** Solve the landing hold so straight A ends at the height it started (bisection on the integrated rise). */
function solveLandHold() {
  let lo = 0, hi = 200;
  if (programRise(jumpProgram(lo)) < 0) throw new Error('jump: the landing descends more than the kicker climbs, even with no hold');
  for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (programRise(jumpProgram(m)) > 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------- words → centreline
/**
 * Words: { kind:'straight', L, font } | { kind:'arc', angle (rad, + = left), R, font } | { kind:'program', font, prog }.
 * Returns stations { s, pos, h (heading), p (pitch), kappa (yaw curvature, + = left), word, gapNext }.
 * A zero-length or non-finite word is REFUSED: a degenerate segment has no tangent, so it has no frame.
 */
function buildCenterline(words, start = { pos: [0, 0, 0], h: 0 }) {
  const st = []; let pos = start.pos.slice(), h = start.h, s = 0;
  const push = (p, kappa, wi) => st.push({ s, pos: pos.slice(), h, p, kappa, word: wi, gapNext: false });
  const step = (ds, dh, pMid) => { // exact chord for an arc step, pitched straight step otherwise
    const hm = h + dh / 2, c = dh === 0 ? ds : (2 * ds / dh) * Math.sin(dh / 2);
    pos = add(pos, [c * Math.cos(pMid) * Math.sin(hm), ds * Math.sin(pMid), c * Math.cos(pMid) * Math.cos(hm)]);
    h += dh; s += ds;
  };
  words.forEach((w, wi) => {
    const check = (v, what) => { if (!Number.isFinite(v) || v <= 0) throw new Error(`word ${wi} (${w.kind}): ${what} must be a positive finite number, got ${v}`); };
    if (w.kind === 'straight') {
      check(w.L, 'length');
      const n = Math.max(1, Math.round(w.L / DS)), ds = w.L / n;
      for (let i = 0; i < n; i++) { push(0, 0, wi); step(ds, 0, 0); }
    } else if (w.kind === 'arc') {
      check(w.R, 'radius'); check(Math.abs(w.angle), 'turn angle');
      const L = Math.abs(w.angle) * w.R, n = Math.max(1, Math.round(L / DS)), ds = L / n, dh = w.angle / n;
      for (let i = 0; i < n; i++) { push(0, Math.sign(w.angle) / w.R, wi); step(ds, dh, 0); }
    } else if (w.kind === 'program') {
      let lastP = 0;                        // the lip station carries the take-off pitch, not the gap chord's
      for (const seg of w.prog) {
        if (seg.gap) {
          check(seg.D, 'gap');
          const p = -Math.atan2(seg.drop, seg.D);
          push(lastP, 0, wi); st[st.length - 1].gapNext = true; st[st.length - 1].isLip = true;
          const L = Math.hypot(seg.D, seg.drop); step(L, 0, p);
          continue;
        }
        check(seg.L, 'segment length');
        const n = Math.max(1, Math.round(seg.L / DS)), ds = seg.L / n;
        for (let i = 0; i < n; i++) { push(easeP(seg, i / n), 0, wi); step(ds, 0, easeP(seg, (i + 0.5) / n)); }
        lastP = seg.p1;
      }
    } else throw new Error(`word ${wi}: unknown kind "${w.kind}"`);
  });
  const end = { s, pos, h };
  return { stations: st, length: s, end };
}

/** Horizontal run of a program (the same integration as buildCenterline, heading fixed). */
function programRun(prog) {
  const { end } = buildCenterline([{ kind: 'program', prog, font: 'flat' }]);
  return Math.hypot(end.pos[0], end.pos[2]);
}

/** The design: straight B = straight A's horizontal run, R solved so the path length is exactly L_TOTAL. */
function design() {
  const landHold = solveLandHold(), prog = jumpProgram(landHold);
  const progLen = prog.reduce((a, g) => a + (g.gap ? Math.hypot(g.D, g.drop) : g.L), 0);
  const runOut = SA - progLen;
  if (runOut < 30) throw new Error(`jump: straight A has only ${runOut.toFixed(1)} m of run-out`);
  prog.push({ L: runOut, p0: 0, p1: 0 });
  const SB = programRun(prog);
  const R = (L_TOTAL - SA - SB) / (2 * Math.PI);
  const words = [
    { kind: 'straight', L: SB, font: 'flat', name: 'straight B (grid)' },
    { kind: 'arc', angle: Math.PI, R, font: 'halfpipe', name: 'turn 1 (half-pipe)' },
    { kind: 'program', prog, font: 'flat', name: 'straight A (jump)' },
    { kind: 'arc', angle: Math.PI, R, font: 'wallride', name: 'turn 2 (wall-ride)' },
  ];
  return { words, SB, R, landHold, prog };
}

// ---------------------------------------------------------------- fonts and profiles
/** Word boundaries in s (with the fonts either side), plus the loop's own seam at s = 0. */
function boundaries(words, stations) {
  const b = [{ s: 0, before: words[words.length - 1].font, after: words[0].font }];
  for (let i = 1; i < stations.length; i++) if (stations[i].word !== stations[i - 1].word) b.push({ s: stations[i].s, before: words[stations[i - 1].word].font, after: words[stations[i].word].font });
  return b;
}
/** The font [ψL, ψR] (degrees) at station i: its word's font, smoothstep-blended across any boundary within ±BLEND m. */
function fontAt(words, stations, bounds, i, total) {
  const st = stations[i];
  for (const b of bounds) {
    let d = st.s - b.s; d -= total * Math.round(d / total);   // wrapped signed distance
    if (Math.abs(d) < BLEND) {
      const A = FONTS[b.before], B = FONTS[b.after], t = smooth((d + BLEND) / (2 * BLEND));
      return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
    }
  }
  return FONTS[words[st.word].font].slice();
}
/**
 * The cross-section for a font: points [u, v] in the station frame (u + = left, v + = up), ordered right → left,
 * with the unit normal on the drivable side. Profile arc length is fixed: 2·WF + 2·LW.
 */
function profile(psiL, psiR) {
  const pts = [], nrm = [];
  const wall = (psi, side) => { // side +1 left, −1 right; returns points from the floor edge outward
    const out = [], nn = [], k = psi * DEG / LW;
    for (let j = 1; j <= NW; j++) {
      const t = (j / NW) * LW, phi = k * t;
      const du = Math.abs(k) < 1e-9 ? t : Math.sin(phi) / k, dv = Math.abs(k) < 1e-9 ? 0 : (1 - Math.cos(phi)) / k;
      out.push([side * (WF + du), dv]); nn.push([-side * Math.sin(phi), Math.cos(phi)]);
    }
    return [out, nn];
  };
  const [rp, rn] = wall(psiR, -1), [lp, ln] = wall(psiL, +1);
  for (let j = NW - 1; j >= 0; j--) { pts.push(rp[j]); nrm.push(rn[j]); }
  for (let j = 0; j <= NF; j++) { pts.push([-WF + (2 * WF * j) / NF, 0]); nrm.push([0, 1]); }
  for (let j = 0; j < NW; j++) { pts.push(lp[j]); nrm.push(ln[j]); }
  return { pts, nrm };
}
const PROFILE_POINTS = 2 * NW + NF + 1; // 203

/** The frame at a station: forward, left, up (gravity-referenced, see the header). */
function frameOf(st) {
  const fwd = [Math.cos(st.p) * Math.sin(st.h), Math.sin(st.p), Math.cos(st.p) * Math.cos(st.h)];
  const left = norm(cross([0, 1, 0], fwd)), up = cross(fwd, left);
  return { fwd, left, up };
}

// ---------------------------------------------------------------- mesh
/** Every station's world cross-section. Returns sections [{ P:[[x,y,z]...], N:[[x,y,z]...], font }]. */
function sections(dsn) {
  const { words, stations, length } = dsn, bounds = boundaries(words, stations);
  return stations.map((st, i) => {
    const font = fontAt(words, stations, bounds, i, length), pr = profile(font[0], font[1]), f = frameOf(st);
    const P = pr.pts.map(([u, v]) => add(st.pos, add(mul(f.left, u), mul(f.up, v))));
    const N = pr.nrm.map(([u, v]) => norm(add(mul(f.left, u), mul(f.up, v))));
    return { P, N, font, prof: pr.pts };
  });
}
/**
 * Cells: runs of consecutive meshed stations, split at the jump gap and every CELL_STATIONS. Adjacent cells share a
 * boundary station so the road has no gap between them. The loop's last cell ends on station 0 again.
 */
function cellRanges(stations) {
  const n = stations.length, ranges = []; let a = 0;
  for (let i = 0; i < n; i++) {             // interval i → i+1 (i+1 = n means back to station 0)
    if (stations[i].gapNext) { if (i > a) ranges.push([a, i]); a = i + 1; continue; }
    if (i + 1 - a >= CELL_STATIONS) { ranges.push([a, i + 1]); a = i + 1; }
  }
  if (n > a) ranges.push([a, n]);
  return ranges;
}
function buildCellMesh(secs, [a, b], name, uvScale = 10) {
  const n = secs.length, idx = (i) => i % n, rows = b - a + 1, m = PROFILE_POINTS;
  if (rows * m > 65535) throw new Error(`${name}: ${rows * m} vertices exceeds 16-bit indices`);
  const positions = new Float32Array(rows * m * 3), normals = new Float32Array(rows * m * 3), uvs = new Float32Array(rows * m * 2);
  for (let r = 0; r < rows; r++) {
    const sc = secs[idx(a + r)];
    for (let j = 0; j < m; j++) {
      const o = (r * m + j);
      positions.set(sc.P[j], o * 3); normals.set(sc.N[j], o * 3);
      uvs[o * 2] = (j / (m - 1)) * (2 * WF + 2 * LW) / uvScale; uvs[o * 2 + 1] = ((a + r) * DS) / uvScale;
    }
  }
  const indices = new Uint16Array((rows - 1) * (m - 1) * 6); let k = 0;
  for (let r = 0; r < rows - 1; r++) for (let j = 0; j < m - 1; j++) {
    const A = r * m + j, B = A + 1, C = A + m, D = C + 1;
    // profile runs right → left, rows run forward: (A, C, B) has its normal on the drivable side (CCW seen from it)
    indices[k++] = A; indices[k++] = C; indices[k++] = B;
    indices[k++] = B; indices[k++] = C; indices[k++] = D;
  }
  return { type: 'mesh', name, material: 0, positions, normals, uvs, indices, castShadows: true, visible: true, transparent: false, renderable: true };
}

// ---------------------------------------------------------------- markers (track coordinates, ARCHITECTURE §5c)
function stationAt(dsn, s) {
  const st = dsn.stations, L = dsn.length; s = ((s % L) + L) % L;
  let i = Math.min(st.length - 1, Math.floor(s / DS)); while (i > 0 && st[i].s > s) i--; while (i < st.length - 1 && st[i + 1].s <= s) i++;
  return st[i];
}
/** A marker dummy at distance s along the road, u across it (+ = left), height h above the surface. */
function marker(dsn, name, s, u, h) {
  const st = stationAt(dsn, s), f = frameOf(st);
  if (Math.abs(u) > WF + LW) throw new Error(`${name}: u = ${u} is off the road`);
  const surf = add(st.pos, mul(f.left, u)); // the markers sit on flat font (straight B): the surface is the frame plane
  const pos = add(surf, mul(f.up, h));
  const matrix = [...f.left, 0, ...f.up, 0, ...f.fwd, 0, ...pos, 1];
  return { type: 'dummy', name, matrix, children: [], track: { s: st.s, u, h } };
}
const MARKS = { line: 120, gridBack: 8, gridCols: [3, -3], gridN: 4, pit: { s: 40, u: 9 }, hotlap: 20, gateU: 11, height: 1.5 };
function markers(dsn) {
  const out = [], M = MARKS;
  for (let n = 0; n < M.gridN; n++) out.push(marker(dsn, `AC_START_${n}`, M.line - 10 - n * M.gridBack, M.gridCols[n % 2], M.height));
  out.push(marker(dsn, 'AC_PIT_0', M.pit.s, M.pit.u, M.height));
  out.push(marker(dsn, 'AC_HOTLAP_START_0', M.hotlap, 0, M.height));
  out.push(marker(dsn, 'AC_TIME_0_L', M.line, +M.gateU, M.height));
  out.push(marker(dsn, 'AC_TIME_0_R', M.line, -M.gateU, M.height));
  return out;
}

// ---------------------------------------------------------------- the jump check (FINDINGS §7d, §7e, §8)
/**
 * Fly the jump as a projectile falling at g_eff, from the lip at the take-off pitch θ, for every speed in the band
 * and for g_eff = 3.2 g (clean flight) and 6.3 g (override dive). Returns a row per case: the clearance over the
 * landing lip, where it touches down (metres past the lip, horizontal), and the impact angle against the road there.
 * The road on the landing side is read from the built stations, not from the design numbers.
 */
function jumpCheck(dsn, opts = {}) {
  const j = { ...JUMP, ...opts }, st = dsn.stations;
  const li = st.findIndex((x) => x.isLip); if (li < 0) throw new Error('jumpCheck: no lip');
  const lip = st[li], f = frameOf(lip), dirH = norm([f.fwd[0], 0, f.fwd[2]]);
  const along = (p) => dot(sub(p, lip.pos), dirH);
  // the landing side: stations from the landing lip to the end of straight A, as (x, y, slope)
  const land = []; for (let i = li + 1; i < st.length && st[i].word === lip.word; i++) land.push({ x: along(st[i].pos), y: st[i].pos[1], p: st[i].p });
  const xEnd = land[land.length - 1].x - BLEND, landLip = land[0];
  const th = lip.p, rows = [];
  for (let kmh = j.bandKmh[0]; kmh <= j.bandKmh[1] + 1e-9; kmh += 10) for (const gg of [j.gLow, j.gHigh]) {
    const v = kmh / 3.6, vx = v * Math.cos(th), vy = v * Math.sin(th), a = gg * G, y0 = lip.pos[1];
    const yAt = (x) => { const t = x / vx; return y0 + vy * t - 0.5 * a * t * t; };
    const clear = yAt(landLip.x) - landLip.y;
    let hit = null;
    for (let k = 0; k < land.length - 1; k++) {
      const A = land[k], B = land[k + 1], dA = yAt(A.x) - A.y, dB = yAt(B.x) - B.y;
      if (dA >= 0 && dB < 0) { const x = A.x + (B.x - A.x) * dA / (dA - dB), t = x / vx; hit = { x, flight: Math.atan2(vy - a * t, vx), road: A.p + (B.p - A.p) * (x - A.x) / (B.x - A.x) }; break; }
    }
    const impact = hit ? Math.abs(hit.flight - hit.road) / DEG : NaN;
    const ok = clear >= j.clearMin && !!hit && hit.x <= xEnd && impact <= j.impactMax;
    rows.push({ kmh, g: gg, clear, xLand: hit ? hit.x : NaN, impact, ok });
  }
  // FINDINGS §7d (FINDINGS.md:313): the deepest drop a flight can reach at horizontal distance d
  const reach = (d) => d * Math.tan(10 * DEG) + 0.5 * 6.5 * G * (d / (375 / 3.6)) ** 2;
  const dropAtLip = lip.pos[1] - landLip.y;
  return { rows, ok: rows.every((r) => r.ok), lip: { x: 0, y: lip.pos[1], thetaDeg: th / DEG }, landLip: { x: landLip.x, y: landLip.y }, xEnd, reachable: dropAtLip <= reach(landLip.x), dropAtLip, reachBound: reach(landLip.x) };
}

// ---------------------------------------------------------------- the scene
function buildTrack() {
  const dz = design(), cl = buildCenterline(dz.words);
  const dsn = { ...dz, stations: cl.stations, length: cl.length, end: cl.end };
  const secs = sections(dsn), ranges = cellRanges(dsn.stations);
  const meshes = ranges.map((r, k) => buildCellMesh(secs, r, `1ROAD_${k}`));
  const materials = [{
    name: 't180b_road', shader: 'ksPerPixel', alphaBlend: 0, alphaTested: false, depthMode: 0,
    props: [
      { name: 'ksAmbient', value: [0.45] }, { name: 'ksDiffuse', value: [0.55] }, { name: 'ksSpecular', value: [0.15] },
      { name: 'ksSpecularEXP', value: [20] }, { name: 'ksEmissive', value: [0, 0, 0] }, { name: 'ksAlphaRef', value: [0] },
    ],
    samplers: [],
  }];
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const root = { type: 'dummy', name: 't180b_platform_test', matrix: I, children: [...meshes, ...markers(dsn)] };
  return { scene: { textures: [], materials, root }, dsn, secs, ranges };
}
function buildPlatformTest() { return buildTrack().scene; }

module.exports = {
  buildPlatformTest, buildTrack, buildCenterline, design, profile, frameOf, sections, cellRanges, jumpCheck, stationAt,
  CONST: { L_TOTAL, DS, WF, LW, NF, NW, BLEND, CELL_STATIONS, FONTS, JUMP, SA, MARKS, PROFILE_POINTS },
};

if (require.main === module) {
  const { scene, dsn, ranges } = buildTrack();
  const meshes = scene.root.children.filter((c) => c.type === 'mesh'), marks = scene.root.children.filter((c) => c.type === 'dummy');
  const gap = Math.hypot(dsn.end.pos[0], dsn.end.pos[1], dsn.end.pos[2]);
  console.log(`platform test: path ${dsn.length.toFixed(3)} m, ${dsn.stations.length} stations at ${DS} m; closes to ${gap.toExponential(2)} m, heading ${(dsn.end.h / DEG).toFixed(6)}°`);
  console.log(`  straight B ${dsn.SB.toFixed(3)} m · turns R = ${dsn.R.toFixed(3)} m · straight A ${SA} m (landing hold solved: ${dsn.landHold.toFixed(3)} m)`);
  console.log(`  ${meshes.length} cells: ${meshes.map((m) => `${m.name} ${m.positions.length / 3} v / ${m.indices.length / 3} t`).join(', ')}`);
  console.log(`  fonts [ψL, ψR]°: ${Object.entries(FONTS).map(([k, v]) => `${k} ${v.join('/')}`).join(' · ')}`);
  console.log(`  markers: ${marks.map((m) => `${m.name} (s ${m.track.s.toFixed(1)}, u ${m.track.u}, h ${m.track.h})`).join(', ')}`);
  const jc = jumpCheck(dsn);
  console.log(`  jump: lip at ${jc.lip.y.toFixed(3)} m, take-off ${jc.lip.thetaDeg.toFixed(2)}°, landing lip ${jc.landLip.x.toFixed(2)} m on at ${jc.landLip.y.toFixed(3)} m; land by x ≤ ${jc.xEnd.toFixed(1)} m; reachable per §7d: ${jc.reachable} (drop ${jc.dropAtLip.toFixed(2)} ≤ ${jc.reachBound.toFixed(2)} m)`);
  console.log('   km/h   g    clear(m)  lands(m)  impact(°)  ok');
  for (const r of jc.rows) console.log(`   ${String(r.kmh).padStart(4)}  ${r.g.toFixed(1)}   ${r.clear.toFixed(2).padStart(6)}   ${r.xLand.toFixed(1).padStart(6)}    ${r.impact.toFixed(2).padStart(5)}    ${r.ok}`);
  console.log(`  jump holds at both landings across ${JUMP.bandKmh.join('–')} km/h: ${jc.ok}`);
}
