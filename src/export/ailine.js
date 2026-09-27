// ailine.js: an Assetto Corsa AI line, ai/fast_lane.ai version 7 with hasGrid = 0, generated from a centreline.
//
//   generateAiLine(dsn, secs, opts) -> line      from scripts/platform_test.js's buildTrack() { dsn, secs }
//   encodeAiLine(line) -> Buffer                 refuses a line it cannot write honestly (AiLineError)
//   readAiLine(buf) -> line                      refuses anything but this layout, and any byte left over
//
// THE BYTE LAYOUT is AcTools' AiSpline (Ms-PL, github.com/gro-ove/actools). It was not read from source here; it was
// checked against every fast_lane.ai in a local AC install instead: 73 of 74 parse under it with the extra count equal
// to the point count (the 74th is a 12-byte stub), 72 carry a grid, and the one with hasGrid = 0 ends exactly after
// that int. All little-endian:
//   int32 version (7) · int32 n · int32 lapTime · int32 sampleCount
//   n × { float32 x, y, z · float32 length (cumulative from point 0) · int32 id (= index) }
//   int32 n (again) · n × 18 float32 (the EXTRA fields below) · int32 hasGrid (0: no grid follows)
//
// WHICH FIELDS ARE FILLED, AND WHAT EACH IS BASED ON. ARCHITECTURE §6 marks "AC accepts generated speed fields" as
// UNVERIFIED, and so is every meaning below that says "inferred". The measured real files are the basis.
//   lapTime, sampleCount  0: every measured file has lapTime 0; 72 of 73 have sampleCount 0.
//   speed      the speed profile, in m/s (inferred unit: the recorded lines' medians are 28 m/s, max 47.6).
//   gas        1, and brake 0: the profile never slows (below), so there is nothing to brake for (inferred meaning).
//   latG       0: 0 in both recorded lines profiled (ranges up to ±2.2 in others; treated as obsolete).
//   radius     the line's own horizontal radius at the point (circumradius of its neighbours), capped at 1e6 m.
//   sideLeft, sideRight  the distance along the road surface from the line to each edge of the cross-section.
//   camber     the surface's lean about the forward axis, rad, + when the surface rises to the right (sign inferred).
//   direction  1: the one generated line in the install writes 1 everywhere; recorded lines hold ±1. Meaning unknown.
//   normal     the road surface normal at the point (unit).
//   length     distance to the next point (the last point's is the closing segment), as in 300,038 of 357,967
//              measured points.
//   forward    unit vector to the next point.
//   tag 0 (every measured file) · grade = forward.y (equal to it in both recorded lines profiled).
//
// THE SPEED PROFILE AND THE WALL-RIDE. The platform test is designed to be taken at 250–350 km/h: that band is where
// its jump holds at both measured landings (3.2 g and 6.3 g, scripts/platform_test.js jumpCheck), and its 28.66 m
// turns are carried by the walls, not by the floor (v²/R is 17–34 g across the band). So the profile is ONE constant
// speed, 300 km/h, the middle of the band: slower misses the jump, and the turns need no braking because the walls
// carry them. In each turn the line leaves the floor and climbs the outside (right) wall to where the wall's slope
// equals the frictionless balance angle φ = atan(v² / (R g)), with R the line's own radius. On the 110° wall-ride that
// is about 87°: just short of vertical, below the part that overhangs, where the wall alone holds the car and no
// friction is needed. On the 60° half-pipe the balance angle is past the top, so the line is capped 10° below the
// wall's top (50°) and grip does the rest. The line eases on and off the wall over about 60 m (three moving averages
// of its lateral position; see generateAiLine). opts.mode 'floor' keeps it on the floor centre everywhere instead: a
// control, so a failed AI run can tell "AC rejected the file" apart from "AI does not ride walls" (ARCHITECTURE §11.3
// lists the second as open).
'use strict';

const G = 9.81, DEG = Math.PI / 180;
const EXTRA = ['speed', 'gas', 'brake', 'latG', 'radius', 'sideLeft', 'sideRight', 'camber', 'direction',
  'nx', 'ny', 'nz', 'length', 'fx', 'fy', 'fz', 'tag', 'grade'];
const HEADER_BYTES = 16, POINT_BYTES = 20, EXTRA_BYTES = EXTRA.length * 4;

class AiLineError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'AiLineError'; this.code = code; }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Signed arc coordinate of every cross-section vertex from the floor centre (− to the right), and the centre index. */
function arcCoords(P) {
  const t = new Float64Array(P.length), c = (P.length - 1) / 2;   // the profile is symmetric in count: 96 + 11 + 96
  if (!Number.isInteger(c)) throw new AiLineError('BAD_SECTION', `a cross-section of ${P.length} points has no centre vertex`);
  for (let j = c + 1; j < P.length; j++) t[j] = t[j - 1] + dist(P[j], P[j - 1]);
  for (let j = c - 1; j >= 0; j--) t[j] = t[j + 1] - dist(P[j], P[j + 1]);
  return { t, c };
}

/** The point, normal and edge distances on a section at signed arc coordinate tt. */
function onSection(sec, tt) {
  const { t } = arcCoords(sec.P), n = t.length;
  const x = Math.min(Math.max(tt, t[0]), t[n - 1]);
  let j = 0; while (j < n - 2 && t[j + 1] < x) j++;
  const f = t[j + 1] > t[j] ? (x - t[j]) / (t[j + 1] - t[j]) : 0;
  const lerp = (A, B) => [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f];
  return { pos: lerp(sec.P[j], sec.P[j + 1]), nrm: unit(lerp(sec.N[j], sec.N[j + 1])), sideLeft: t[n - 1] - x, sideRight: x - t[0] };
}

/** How far up the right wall (arc coordinate, negative) the line sits at a station, for speed v. */
function wallTarget(st, font, v, WF, LW) {
  if (!(st.kappa > 0)) return 0;                     // straights, and right turns (none on this track): the floor centre
  const psi = font[1] * DEG; if (!(psi > 0)) return 0;
  const k = psi / LW, R = 1 / st.kappa, cap = Math.max(0, psi - 10 * DEG);
  let phi = 0;
  for (let it = 0; it < 60; it++) {
    const u = WF + Math.sin(phi) / k;                 // horizontal offset of the wall point at slope phi
    const next = Math.min(cap, Math.atan((v * v) / ((R + u) * G)));
    if (Math.abs(next - phi) < 1e-12) break;
    phi = next;
  }
  return -(WF + phi / k);
}

/**
 * The line from a design: dsn { stations, length }, secs (one cross-section per station, right → left, with P and N),
 * opts { mode: 'wall' | 'floor', speedKmh, every (stations per point), easeM, WF, LW, DS }.
 */
function generateAiLine(dsn, secs, opts = {}) {
  const st = dsn && dsn.stations;
  if (!Array.isArray(st) || st.length < 3) throw new AiLineError('EMPTY_CENTRELINE', `a centreline needs at least 3 stations, got ${Array.isArray(st) ? st.length : 'none'}`);
  if (!Array.isArray(secs) || secs.length !== st.length) throw new AiLineError('BAD_SECTIONS', 'one cross-section per station is needed');
  const mode = opts.mode || 'wall';
  if (mode !== 'wall' && mode !== 'floor') throw new AiLineError('BAD_MODE', `mode ${mode} is not 'wall' or 'floor'`);
  const kmh = opts.speedKmh === undefined ? 300 : opts.speedKmh;
  if (!(kmh > 0) || !Number.isFinite(kmh)) throw new AiLineError('BAD_SPEED', `speed ${kmh} km/h is not a positive number`);
  const v = kmh / 3.6, every = opts.every || 3, DS = opts.DS || 0.5, WF = opts.WF || 5, LW = opts.LW || 8, easeM = opts.easeM === undefined ? 60 : opts.easeM;
  const n = st.length;

  // lateral target per station, then a circular moving average so the line eases on and off the walls
  const raw = st.map((s, i) => (mode === 'floor' ? 0 : wallTarget(s, secs[i].font, v, WF, LW)));
  // Three passes of a box average (together about a quadratic B-spline) make the ease smooth in slope as well: one
  // pass turns the step onto the wall into a straight ramp whose two ends are kinks, 4–6 m in horizontal radius.
  const half = Math.max(1, Math.round(easeM / DS / 6));
  let tt = Float64Array.from(raw);
  for (let pass = 0; pass < 3; pass++) {
    const nxt = new Float64Array(n);
    for (let i = 0; i < n; i++) { let a = 0; for (let d = -half; d <= half; d++) a += tt[(i + d + n) % n]; nxt[i] = a / (2 * half + 1); }
    tt = nxt;
  }

  // which stations become points: every `every`-th, plus both sides of a jump gap so the line spans it road to road
  const keep = [];
  for (let i = 0; i < n; i++) if (i % every === 0 || st[i].gapNext || (i > 0 && st[i - 1].gapNext)) keep.push(i);
  const pts = keep.map((i) => onSection(secs[i], tt[i]));

  const m = pts.length, points = [], extra = [];
  let len = 0;
  for (let k = 0; k < m; k++) {
    const p = pts[k], nx = pts[(k + 1) % m], pv = pts[(k - 1 + m) % m];
    if (k > 0) len += dist(p.pos, pts[k - 1].pos);
    points.push({ pos: p.pos, length: len, id: k });
    const seg = dist(nx.pos, p.pos), fwd = unit(sub(nx.pos, p.pos));
    // horizontal circumradius of (previous, this, next)
    const ax = pv.pos[0], az = pv.pos[2], bx = p.pos[0], bz = p.pos[2], cx = nx.pos[0], cz = nx.pos[2];
    const area2 = Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az));
    const radius = area2 < 1e-9 ? 1e6 : Math.min(1e6, (Math.hypot(bx - ax, bz - az) * Math.hypot(cx - bx, cz - bz) * Math.hypot(cx - ax, cz - az)) / (2 * area2));
    // camber: the normal's lean about the forward axis; left = up x forward (the station frame's convention)
    const up = [0, 1, 0], left = unit([fwd[2], 0, -fwd[0]]), lean = Math.atan2(dot(p.nrm, left), dot(p.nrm, up));
    extra.push({ speed: v, gas: 1, brake: 0, latG: 0, radius, sideLeft: p.sideLeft, sideRight: p.sideRight, camber: lean, direction: 1,
      nx: p.nrm[0], ny: p.nrm[1], nz: p.nrm[2], length: seg, fx: fwd[0], fy: fwd[1], fz: fwd[2], tag: 0, grade: fwd[1] });
  }
  return { version: 7, lapTime: 0, sampleCount: 0, hasGrid: 0, points, extra, mode, speedKmh: kmh };
}

/** Bytes for a line. Refuses fewer than 3 points, non-finite values, lengths that are not cumulative, and an open line. */
function encodeAiLine(line) {
  const P = line && line.points, E = line && line.extra;
  if (!Array.isArray(P) || P.length < 3) throw new AiLineError('EMPTY_LINE', `a line needs at least 3 points, got ${Array.isArray(P) ? P.length : 'none'}`);
  if (!Array.isArray(E) || E.length !== P.length) throw new AiLineError('BAD_EXTRA', 'one extra record per point is needed');
  const n = P.length;
  for (let k = 0; k < n; k++) {
    const p = P[k];
    if (p.id !== k) throw new AiLineError('BAD_ID', `point ${k} has id ${p.id}`);
    if (![...p.pos, p.length].every(Number.isFinite) || !EXTRA.every((f) => Number.isFinite(E[k][f]))) throw new AiLineError('NON_FINITE', `point ${k} has a non-finite value`);
    if (k === 0 ? p.length !== 0 : p.length < P[k - 1].length) throw new AiLineError('BAD_LENGTH', `point ${k}'s length ${p.length} is not cumulative from 0`);
  }
  const spacing = P.slice(1).map((p, k) => dist(p.pos, P[k].pos)).sort((a, b) => a - b), med = spacing[spacing.length >> 1];
  const close = dist(P[n - 1].pos, P[0].pos);
  if (!(close > 0) || close > 3 * med) throw new AiLineError('NOT_CLOSED', `the last point is ${close} m from the first (median spacing ${med} m); a lap line closes one spacing short of its start`);
  const b = Buffer.alloc(HEADER_BYTES + n * POINT_BYTES + 4 + n * EXTRA_BYTES + 4);
  let o = 0;
  const i32 = (v) => { b.writeInt32LE(v, o); o += 4; }, f32 = (v) => { b.writeFloatLE(v, o); o += 4; };
  i32(7); i32(n); i32(line.lapTime || 0); i32(line.sampleCount || 0);
  for (const p of P) { f32(p.pos[0]); f32(p.pos[1]); f32(p.pos[2]); f32(p.length); i32(p.id); }
  i32(n);
  for (const e of E) for (const f of EXTRA) f32(e[f]);
  i32(0);   // hasGrid: no grid follows (ARCHITECTURE §6)
  if (o !== b.length) throw new Error(`ailine: wrote ${o} of ${b.length} bytes`);
  return b;
}

function readAiLine(b) {
  if (!Buffer.isBuffer(b) || b.length < HEADER_BYTES) throw new AiLineError('TRUNCATED', 'shorter than the header');
  let o = 0;
  const i32 = () => { const v = b.readInt32LE(o); o += 4; return v; }, f32 = () => { const v = b.readFloatLE(o); o += 4; return v; };
  const version = i32(), n = i32(), lapTime = i32(), sampleCount = i32();
  if (version !== 7) throw new AiLineError('BAD_VERSION', `version ${version}, not 7`);
  if (!(n > 0) || b.length < HEADER_BYTES + n * POINT_BYTES + 4 + n * EXTRA_BYTES + 4) throw new AiLineError('TRUNCATED', `${n} points do not fit in ${b.length} bytes`);
  const points = [];
  for (let k = 0; k < n; k++) points.push({ pos: [f32(), f32(), f32()], length: f32(), id: i32() });
  const n2 = i32(); if (n2 !== n) throw new AiLineError('BAD_EXTRA', `extra count ${n2} is not the point count ${n}`);
  const extra = [];
  for (let k = 0; k < n; k++) { const e = {}; for (const f of EXTRA) e[f] = f32(); extra.push(e); }
  const hasGrid = i32();
  if (hasGrid !== 0) throw new AiLineError('HAS_GRID', 'this reader handles hasGrid = 0 only');
  if (o !== b.length) throw new AiLineError('TRAILING', `${b.length - o} bytes after hasGrid`);
  return { version, lapTime, sampleCount, hasGrid, points, extra };
}

module.exports = { generateAiLine, encodeAiLine, readAiLine, AiLineError, EXTRA };
