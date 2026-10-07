// griplike.js: THE GRIP FIELD'S WORDS AND THE "GRIP LIKE…" DROP-DOWN'S ENTRIES (D261, the keeper, 21:18: "LIKE how we took the width reference of other tracks, perhaps do the same with the friction
// for users to see which tracks they want to emulate grip"; shaped like app/core/widthlike.js, D232). The numbers are src/doc/grips.json (tools/grips.cjs, E's survey of the installed tracks'
// road FRICTION as a percent of AC's own road; numbers only, each row with the file it came from).
//
//   entries(tracks) -> [{ value, label }]   the first is the placeholder (value ''), then one per known track, in the file's order (the T-180 tracks first, then the others):
//                                          value = the whole percent the field takes (`value` in the JSON), label "Thunderhead, 82%" (and "Red Bull Ring, 99.5% (100)" where the
//                                          measured figure is not whole: the field only takes whole percents, so the label says what it will fill)
//   check(text)     -> { ok, grip, why }   the field's text: a whole percent from GRIP_MIN to GRIP_MAX (50 to 150), else why not in plain words (49 and 151 are refused, 100.5 is not whole)
//   note(text)      -> string              the line under the field: what the number is (100% is AC's road), "untested: drive it" outside TESTED_MIN..TESTED_MAX (60 to 110, the keeper's range
//                                          decision 2026-10-06; E's survey: the installed tracks run 60 to 110), and always that the checker does not model grip
//   GRIP_MIN, GRIP_MAX, TESTED_MIN, TESTED_MAX
'use strict';
const G = require('../../src/doc/grips.json');
const { GRIP_MIN, GRIP_MAX } = require('./gripvals.js');

const TESTED_MIN = 60, TESTED_MAX = 110;
const fmt = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 10) / 10));

function label(t) { return Number(t.percent) === Number(t.value) ? `${t.name}, ${fmt(t.percent)}%` : `${t.name}, ${fmt(t.percent)}% (${t.value})`; }
function entries(tracks = G.tracks) {
  return [{ value: '', label: 'grip like…' }, ...tracks.filter((t) => Number.isInteger(t.value) && t.value >= GRIP_MIN && t.value <= GRIP_MAX).map((t) => ({ value: String(t.value), label: label(t) }))];
}
function check(text) {
  const s = String(text === undefined || text === null ? '' : text).trim(), n = Number(s);
  if (s === '' || !Number.isFinite(n)) return { ok: false, grip: null, why: `A grip is a whole percent from ${GRIP_MIN} to ${GRIP_MAX}: type a number.` };
  if (!Number.isInteger(n)) return { ok: false, grip: null, why: `A grip is a WHOLE percent (${fmt(n)} is not): try ${Math.round(n)}.` };
  if (n < GRIP_MIN || n > GRIP_MAX) return { ok: false, grip: null, why: `A grip is from ${GRIP_MIN} to ${GRIP_MAX} percent (${n} is outside it).` };
  return { ok: true, grip: n, why: null };
}
function note(text) {
  const c = check(text);
  if (!c.ok) return c.why;
  return `Grip ${c.grip}%: 100% is AC's own road.${c.grip < TESTED_MIN || c.grip > TESTED_MAX ? ` ${c.grip}% is untested (the tracks measured run ${TESTED_MIN} to ${TESTED_MAX}): drive it.` : ''} The checker does not model grip: a grip other than 100% can drive differently than it assumes, so drive it in AC.`;
}

module.exports = { entries, check, note, label, GRIP_MIN, GRIP_MAX, TESTED_MIN, TESTED_MAX };
