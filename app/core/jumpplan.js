// jumpplan.js: WHAT A FLIGHT LOOKS LIKE, for the Add-jump control (D243 item 1, the UI half; the core is src/core/jump.js). Pure: it reads a built path and its segments and gives, for
// every flight on it, the take-off lip, the gap, the drop, the landing pitch and THE CAR'S FLIGHT drawn as a dashed arc.
//
// THE ARC. The core has a flight model: src/validate/jumps.js flightY, an ordinary projectile falling at g_eff (the 3.2 g and 6.3 g falls FINDINGS.md measured), and the landing ramp the
// adapter sizes at the DESIGN speed (src/validate/limits.js MACH6.designSpeedKmh, 460 km/h today; src/core/adapter.js toSegments). So the arc is BALLISTIC, drawn at that speed, one
// dashed line per fall (the lighter fall carries farther). Where that model cannot be loaded the arc is a STRAIGHT dashed line from the lip to the landing lip, and `model` says so; the panel
// and the preview say which they drew.
//
//   flightsOfPath(path, segments, { kmh }) -> [{ id, model, speedKmh, lip: { pos, h, theta }, D, dh, landRad, rampM, falls: [{ g, clear, minKmh, x, arc: [[x, y]] }] }]   (x along the ground from the lip, y above it)
//   arcWorld(flight, fall)                  -> [[x, y, z]] world points of one dashed line
//   describe(flight)                        -> { drew, speed, lines: [string] } the words for the panel
//   DESIGN_KMH, FALLS                       the speed the ramp is sized at, and the falls
'use strict';

let J = null, L = null;
try { J = require('../../src/validate/jumps.js'); L = require('../../src/validate/limits.js'); } catch (e) { J = null; L = null; }   // no flight model: a straight dashed line, and it says so
const DESIGN_KMH = L && L.MACH6 ? L.MACH6.designSpeedKmh : 460;
const FULL_KMH = L && L.MACH6 ? L.MACH6.vmaxKmh : 970;   // D256: validation checks at full speed (the lap sim's cap) on an open track
const FALLS = Object.freeze(L && L.MACH6 ? [...L.MACH6.jumpG] : [3.2, 6.3]);
const ARC_POINTS = 48;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Where along the ground the flight at gEff comes down: onto the ramp (clear), or, short of the landing, through the landing lip's level. */
function endOf({ D, dh, theta, v, g, clear, touch, model }) {
  if (clear && touch != null) return touch;
  let apexSeen = false, prev = 0;
  for (let x = 0.5; x <= 4 * D + 100; x += 0.5) {
    const y = model.flightY(x, v, theta, g);
    if (y < prev) apexSeen = true;
    if (apexSeen && y <= dh) return x;
    prev = y;
  }
  return D;
}

/** The flights on a path. `path.samples` carry pos and T; `segments` give each sample's kind (a 'gap' segment is a flight). A flight with no landing yet, or a gap that does not go forward, is left out. */
function flightsOfPath(path, segments, { kmh = DESIGN_KMH, model = J } = {}) {
  const S = path && path.samples, out = [];
  if (!S || !S.length || !Array.isArray(segments)) return out;
  let acc = 0;
  segments.forEach((g, j) => {
    const sGap = S[0].s + acc; acc += g.length;
    if (!g || g.kind !== 'gap') return;
    let first = -1, last = -1;
    for (let i = 0; i < S.length; i++) if (S[i].seg === j) { if (first < 0) first = i; last = i; }
    if (first <= 0 || last < 0 || last + 1 >= S.length) return;
    // THE LIP is the station AT the gap's start: the path gives a boundary to the segment it starts, so it is S[first]; a path sampled the other way has it at S[first - 1] (validate/index.js)
    const take = !(Math.abs(S[first].s - sGap) < Math.abs(S[first - 1].s - sGap)) ? first - 1 : first, A = S[take], B = S[last + 1];
    const hl = Math.hypot(A.T[0], A.T[2]); if (!(hl > 0)) return;
    const h = [A.T[0] / hl, 0, A.T[2] / hl], D = dot(sub(B.pos, A.pos), h), dh = B.pos[1] - A.pos[1];
    if (!(D > 0)) return;
    const theta = Math.asin(Math.max(-1, Math.min(1, A.T[1]))), landRad = Math.asin(Math.max(-1, Math.min(1, B.T[1]))), v = kmh / 3.6;
    const base = { id: g.id, speedKmh: kmh, lip: { pos: A.pos.slice(), h, theta }, D, dh, landRad };
    let plan = null;
    if (model) {
      try {
        const ramp = model.landingRamp({ D, dh, thetaRad: theta, landRad, v });
        plan = { ...base, model: 'ballistic', rampM: ramp.length, falls: FALLS.map((gE, k) => {
          const vmin = model.minSpeed(D, dh, theta, gE), clear = Number.isFinite(vmin) && v >= vmin, touch = ramp.touchdowns[k] && ramp.touchdowns[k].x;
          const xEnd = endOf({ D, dh, theta, v, g: gE, clear, touch, model });
          return { g: gE, clear, minKmh: Number.isFinite(vmin) ? vmin * 3.6 : Infinity, x: clear ? touch : null, arc: Array.from({ length: ARC_POINTS + 1 }, (_, i) => { const x = (xEnd * i) / ARC_POINTS; return [x, model.flightY(x, v, theta, gE)]; }) };
        }) };
      } catch (e) { plan = null; }   // the model could not be run for this flight: the straight line below
    }
    out.push(plan || { ...base, model: 'straight', rampM: null, falls: [{ g: null, clear: null, minKmh: null, x: null, arc: [[0, 0], [D, dh]] }] });
  });
  return out;
}

/** One dashed line's world points: from the lip, along the ground heading, up by y. */
function arcWorld(flight, fall) {
  const { pos, h } = flight.lip;
  return fall.arc.map(([x, y]) => [pos[0] + h[0] * x, pos[1] + y, pos[2] + h[2] * x]);
}

const m1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
/** The words for the panel: which line was drawn, the speed it is drawn at, and where each fall comes down. */
function describe(f) {
  if (!f) return null;
  if (f.model === 'straight') return { drew: 'straight', speed: null, lines: ['The dashed line is straight from the take-off lip to the landing lip: this build has no flight model to draw the car\'s arc.'] };
  const drew = `The dashed arcs are the car's flight, ballistic, at ${Math.round(f.speedKmh)} km/h, falling at ${f.falls.map((x) => `${x.g} g`).join(' and ')} (the lighter fall carries farther).`;
  const speed = `The landing ramp is sized for ${Math.round(f.speedKmh)} km/h, fixed today; jumps are tuned by driving them in AC, so a landing the car may fly past at the lap's speed is a warning, not a red.`;   // D250, the keeper's ruling
  const lines = f.falls.map((x) => (x.clear ? `${x.g} g: comes down ${m1(x.x)} m after the lip, ${m1(Math.max(0, x.x - f.D))} m onto the ramp.` : `${x.g} g: does NOT reach the landing at ${Math.round(f.speedKmh)} km/h (it needs ${Number.isFinite(x.minKmh) ? `${Math.ceil(x.minKmh)} km/h` : 'a higher ramp: no speed makes it'}): a warning, not a red (tune it by driving it in AC).`));
  lines.push(`The ramp is ${m1(f.rampM)} m long.`);
  return { drew, speed, lines };
}

/**
 * THE CORE'S NAMED REFUSALS, IN PLAIN WORDS (D243 item 1: "its named refusals are shown in plain words"). `e` is a CoreError from src/core/jump.js (code and message); `o` the numbers typed
 * ({ gap, drop, landDeg }). Never the code name; an unknown refusal keeps the core's own sentence, so nothing is hidden.
 */
function jumpWords(e, o = {}) {
  const code = e && e.code, msg = String((e && e.message) || e || ''), gap = Number(o.gap), drop = Number(o.drop), land = Number(o.landDeg);
  switch (code) {
    case 'NO_TAKEOFF': return 'A jump needs road to take off from: press Extend first, then Add jump.';
    case 'CLOSED': return 'The loop is closed, so there is no open end to add a jump to. Undo the close first.';
    case 'JUMP_AFTER_JUMP': return 'The track already ends in a jump. Press Extend first, so the car has road to land on, then add the next one.';
    case 'FLIGHT_OFFSET': return 'The road at the end still carries a height or sideways offset (from the local brush), and a jump can only take off from road where those have faded back to zero. Brush them out, or Extend a little further so they fade.';
    case 'JUMP_UNSOLVABLE': return `No flight covers a gap of ${o.gap} m, dropping ${o.drop} m and arriving at ${o.landDeg}°. Try a shorter gap, a smaller drop or a gentler landing angle.`;
    case 'JUMP_PAST_VERTICAL': return /the road before the jump/.test(msg)
      ? 'The road at the end points almost straight up or down, so a jump cannot take off from it. Extend a piece that levels out first.'
      : 'To land there the flight would have to turn through vertical (the car would fly backwards). Try a smaller drop or a gentler landing angle.';
    case 'BAD_JUMP':
      if (!(Number.isFinite(gap) && gap > 0)) return 'The gap must be more than 0 m: it is how far the car flies along the ground.';
      if (!Number.isFinite(drop)) return 'The drop must be a number of metres (+ is down: how far the landing is below the take-off).';
      if (!(Number.isFinite(land) && Math.abs(land) < 90)) return 'The landing angle must be between −90° and +90° (negative slopes down, the usual landing).';
      return msg.replace(/^BAD_JUMP:\s*/, '');
    default: return msg.replace(/^[A-Z_]+:\s*/, '');
  }
}

module.exports = { flightsOfPath, arcWorld, describe, jumpWords, DESIGN_KMH, FULL_KMH, FALLS };
