// live.js: the colour follows the build head. Each update re-validates only from the first changed word (src/validate
// revalidate, whose look-backs are its own) and re-colours only the stations whose findings changed (colour.js recolour).
// Works on an OPEN track: validation gives no lap and no gap-red at the head while it is open.
//
//   const live = createLive({ validate: { csp, car, … } });
//   live.update(path, segments)                 first time, or after anything that is not an append/sculpt: full
//   live.update(path, segments, { fromS })      after an append (fromS = the old path's end) or a sculpt (fromS = the
//                                               edited word's start, fromSOf): incremental
//   live.update(…, { lap: false })              a closed loop's lap proof is DEFERRED (src/validate lapOf proves it later)
//   -> { result, map, changed, full }           `full` says whether the whole track was validated
//
// Nothing here touches a mesh, so nothing crosses IPC (ARCHITECTURE §9): the preview asks colour.js levelAt(map, s, u).
'use strict';
const { validate, revalidate } = require('../../src/validate/index.js');
const { colourMap, recolour } = require('./colour.js');

/** The s where segment g starts on the path: its first sample (the start of the edited or appended word). */
function fromSOf(path, g) {
  const p = path.samples.find((x) => x.seg >= g);
  return p ? p.s : path.lengthM;
}

function createLive({ validate: vopts = {} } = {}) {
  let result = null, map = null;
  return {
    update(path, segments, { fromS, lap = true } = {}) {
      const full = !result || fromS === undefined, o = lap === false ? { ...vopts, lap: false } : vopts;
      const next = full ? validate(path, segments, o) : revalidate(result, path, segments, fromS, o);
      const rc = map && !full ? recolour(map, next, { car: vopts.car, path }) : { map: colourMap(next, { car: vopts.car, path }), changed: null };
      result = next; map = rc.map;
      return { result, map, changed: rc.changed, full };
    },
    get result() { return result; },
    get map() { return map; },
  };
}

module.exports = { createLive, fromSOf };
