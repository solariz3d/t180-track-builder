// labels.js: validation's findings in plain words, for the panels (the D177 window pass and A's D180 check of the
// installed app: the red list read "stacked-within-2m … ARCHITECTURE.md:85", which a track builder has to look up). The
// words are what the user reads; the rule id and its source go in the TOOLTIP (title), where the docs, the tests and a
// search still find them. No shown string carries a rule id or a ".md:" line.
//
//   reasonText(reason, car)       plain words for a validation reason id (src/validate SRC), or a plain fallback
//   lapText(lap)                  the lap as the summary line shows it
//   lapWhereText(where)           one reason the lap fails, in words
//   findingLine(kind, range)      { text, title } for one red or amber range in the list
//   stopLine(stop)                { text, title } for a handle drag stopped at a bound (app/handles)
//   refusalText(message)          a document refusal without its error code ("HANDLE_RANGE: …" → "…")
'use strict';
const { MACH6 } = require('../../src/validate/limits.js');

function reasonText(reason, car = MACH6) {
  const T = {
    'gap-in-road': 'a hole in the road',
    'downforce-ray-gap': 'a gap in the road under the car\'s downforce ray: the car loses all its downforce over it',
    'missing-soft-collision': 'the export has no soft-collision block',
    fold: 'the surface folds over itself here (too tight for its width)',
    'self-intersection': 'the road passes through itself here',
    'stacked-within-2m': `two roads are stacked less than ${car.stackedM} m apart here`,
    'wall-ride-from-wall-object': 'a wall-ride is built on a wall object',
    'steep-without-raycast': `a surface is steeper than ${car.steepDeg}°, which needs CSP's wall raycasting`,
    'load-above-proven': `the load is over ${car.provenG} g, more than any track has proven`,
    'seam-past-envelope': `a seam is sharper than measured on real tracks (over ${car.seamP90Deg}°)`,
    'on-the-stops': `the car is on its suspension stops (${car.suspensionStopG} g or more)`,
    'head-in-the-air': 'the open end is in the air: place the landing',
    'landing-misses-zone': 'this jump may fly past its landing at the lap\'s speed (a warning: tune it by driving it in AC)',   // D250: amber since the keeper's ruling
    'jump-gap-not-forward': 'a jump lands behind its own take-off',
    'joint-step': 'the road steps between two pieces here (the cup and the piece next to it do not meet)',
    // THE CROSS-SECTION reds (D225): the ids are the seal's and the librarian's rulings (ruling 1 `tube-too-narrow`, S3 `roll-rate`; A's
    // core may name them otherwise, and then these lines follow A). Plain words here, the id in the tooltip, as every reason above
    'tube-too-narrow': 'this closed tube is narrower than 9.74 m across the road: the chase camera and a T-180 do not fit inside it',
    'roll-rate': 'the road rolls about its own direction faster than any measured track (red over 1.21°/m, amber over 0.93°/m, read over 20 m): lengthen the roll',
    // A's third red (D225, checked against src/validate/index.js SRC at the combine): the ids above are A's too, unchanged
    'edge-past-cap': 'the edge curves up past the most a road can hold (150° in all, 180° on an open tube): the walls would touch',
    // D256 (the keeper chose all three of E's proposals): the centreline lift-off on an open track, and the road facing the ground
    'leaves-surface': 'the car leaves the road surface here at full speed',
    'no-speed-holds': 'the road faces the ground here and nothing curves it toward the car: no speed holds the car on it',
    'holds-above': 'the road faces the ground here and holds the car only above a speed',
  };
  return T[reason] || 'a problem with no description yet';
}

function lapText(lap) {
  if (!lap) return 'lap —';
  if (lap.ok === true) return 'lap proved';
  if (lap.ok === false) return 'lap FAILS';
  return { open: 'lap: the loop is still open', deferred: 'lap: checked when the drag ends', 'no-speed-model': 'lap: no speed set' }[lap.reason] || 'lap not run';
}

function lapWhereText(w) {
  const r = w.reason || '';
  if (r === 'stall') return 'the car stops here: it has no speed';
  if (r === 'leaves-surface') return 'the car leaves the road surface here';
  if (r === 'landing-unreachable') return 'a jump lands too deep below its take-off to be reached';
  const m = /^jump-not-caught-([\d.]+)g$/.exec(r);
  if (m) return `a jump is not caught (the ${m[1]} g landing)`;
  return reasonText(r);
}

const at = (x) => (x.s1 != null && x.s1 !== x.s0 ? `at ${x.s0.toFixed(0)}–${x.s1.toFixed(0)} m` : `at ${x.s0.toFixed(0)} m`);
function findingLine(kind, x) {
  // D256: "holds above N km/h" carries its number, the slowest speed that keeps the car on the road there
  if (x.reason === 'holds-above' && Number.isFinite(x.worst)) return { text: `${kind}: the road faces the ground here and holds the car only above ${Math.round(x.worst)} km/h, ${at(x)}`, title: `${x.reason}${x.source ? ` · ${x.source}` : ''}` };
  return { text: `${kind}: ${reasonText(x.reason)}, ${at(x)}`, title: `${x.reason}${x.source ? ` · ${x.source}` : ''}` };
}

/** stop: { at, reasons: [id], sources: [src] } from handles.js clamp; the value the drag stopped at is at. */
function stopLine(stop, unitText = '') {
  const words = [...new Set(stop.reasons.map((r) => reasonText(r)))].join('; ');
  return { text: `stopped at ${stop.at}${unitText}: past it, ${words}`, title: `${stop.reasons.join(', ')} · ${stop.sources.join(', ')}` };
}

const refusalText = (message) => String(message).replace(/^[A-Z][A-Z_]+:\s*/, '');

module.exports = { reasonText, lapText, lapWhereText, findingLine, stopLine, refusalText };
