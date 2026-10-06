// overlapmerge.js: how the overlap check's TWO PARTS make one answer (D240 warm-worker follow-up). The check is two independent pieces of work on the same mesh: the mesh's own self-check with
// everything the validator reads from the path ("rest": about a third of the time), and the downforce-ray gap search on the built road ("rays": the rest). Two workers run them at once and this
// puts their answers together. It is EXACT because src/validate/index.js hands its findings to ranges(), whose order is a total one (reason, s, u): "so the ranges do not depend on the order
// findings were produced in". Pure, with no dependencies, so the page can load it without the geometry (the runner does) and the tests can compare it with the one-piece check.
//   parts: rest = { red, amber }   the validator's ranges with the folds and NO road mesh, and the amber count
//          rays = { red }          the 'downforce-ray-gap' ranges the validator finds with the road mesh and NO folds
'use strict';

const OVERLAP = new Set(['self-intersection', 'stacked-within-2m', 'downforce-ray-gap']);
const uu = (x) => (x.u == null ? -Infinity : x.u);
const order = (a, b) => (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : a.s0 - b.s0 || uu(a) - uu(b));

/** The one answer { overlaps, others, amber } from the two parts: all the reds in the validator's order, split as overlapCheck splits them. */
function mergeParts(rest, rays) {
  const red = [...rest.red, ...rays.red].sort(order);
  return { overlaps: red.filter((x) => OVERLAP.has(x.reason)), others: red.filter((x) => !OVERLAP.has(x.reason)), amber: rest.amber };
}

module.exports = { mergeParts, OVERLAP, order };
