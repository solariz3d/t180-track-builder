// pitui.js: THE "PIT LANE" SECTION of the core panel (the keeper, 2026-10-09: "a pit road that is off to the side of the track, and can connect to the track
// … the pit lane and pit spawns wont be literally used in races … it allows for a secondary spawn point for practice and so cars dont spawn right on the
// track when other racers are driving"). Off by default (no pitLane in the document). Ticked, the track gets the word builder's side road
// (src/doc/pitlane.js, built by src/geom/pitlane.js): it peels off the road's edge on the chosen side, runs beside it, and comes back; the pit boxes
// (the practice spawns) stand on it. Where it cannot be built (a join on a cup wall or inside a tube) the lane is KEPT and the panel says why in plain
// words, so moving a join needs no retyping.
//
//   mount({ shell, el, win }) -> { nodes, update(state), unmount() }
'use strict';
const { lenOf } = require('./spawnsui.js');
const PL = require('../../src/doc/pitlane.js');   // the lane's defaults (the core's document.js needs node's fs; the UI must load in the webview without it)
// the pit boxes' starting count and spacing (src/core/document.js PIT_DEFAULT says the same)
const DEFAULT = Object.freeze({ ...PL.DEFAULTS, boxes: 4, boxSpacingM: 10 });

// The lane geometry's refusals (src/geom/pitlane.js), in the keeper's words
const WHY = {
  PIT_JOIN_NOT_FLAT: 'the road\'s edge where the lane joins is too steep (a cup wall or a tube): the lane needs an edge of 35° or less. Move the join to a flatter part, or lower the cup there.',
  PIT_TOO_SHORT: 'the lane is too short for its peel-off and merge: move the joins further apart, or shorten the peel-off and merge.',
  PIT_BACKWARDS: 'the lane comes back before it leaves: the rejoin must be further round the lap than the leave.',
  PIT_ANCHOR_MISSING: 'a join is on a piece that is not on the track any more: pick its piece again.',
  PIT_OVER_GAP: 'the lane runs over a jump: a pit lane needs road under it all the way.',
};
const say = (msg) => { const code = Object.keys(WHY).find((k) => String(msg).startsWith(k)); return code ? WHY[code] : String(msg); };

function mount({ shell, el, win }) {
  const on = el('input', { type: 'checkbox', 'aria-label': 'pit lane', title: 'a side road off the start straight, with the practice spawns on it' });
  const side = el('select', { 'aria-label': 'pit lane side' });
  side.replaceChildren(new win.Option('right', 'R'), new win.Option('left', 'L'));
  const num = (aria, step, min, title) => el('input', { type: 'number', step, min, 'aria-label': aria, ...(title ? { title } : {}) });
  const leaveP = el('select', { 'aria-label': 'pit lane leaves on piece' }), leaveM = num('pit lane leaves at metres into its piece', '1', '0');
  const backP = el('select', { 'aria-label': 'pit lane rejoins on piece' }), backM = num('pit lane rejoins at metres into its piece', '1', '0');
  const gap = num('pit lane gap from the road', '0.5', '0', 'metres between the road\'s edge and the lane, along its run');
  const width = num('pit lane width', '0.5', '2', 'the lane\'s own width, metres');
  const peel = num('pit lane peel-off length', '1', '5', 'metres of road over which the lane peels off');
  const merge = num('pit lane merge length', '1', '5', 'metres of road over which the lane comes back');
  const boxes = num('pit boxes', '1', '1'), spacing = num('pit box spacing', '0.5', '4', 'metres between pit boxes along the lane');
  const status = el('p', { class: 'message', 'aria-label': 'pit lane status', style: 'font-size:12px;margin:2px 0' });
  // the keeper's idea: where the lane meets a cup wall or a tube, lower the road's shape beside the lane (src/core/pitflat.js; the route does not move)
  const flatten = el('button', { text: 'Flatten road for pit', title: 'lower the cup, tube or edge to the plain road beside the whole pit lane, easing back over 60 m either side; the route does not move; Ctrl+Z puts the walls back' });
  flatten.onclick = () => shell.flattenForPit();
  const field = (label, ...kids) => el('label', { style: 'display:block;margin:2px 0' }, el('span', { text: label }), ' ', ...kids);
  const box = el('div', {}, field('side', side), field('leaves on', leaveP, ' at m ', leaveM), field('rejoins on', backP, ' at m ', backM),
    field('gap from road m', gap), field('lane width m', width), field('peel-off m', peel), field('merge m', merge), field('pit boxes', boxes), field('box spacing m', spacing), status, el('div', { class: 'actions' }, flatten));

  const doc = () => shell.getState().history.present;
  const segs = () => (shell.getState().resolved || {}).segments || [];
  const cur = () => doc().pitLane;
  const put = (patch) => { const c = cur(); if (c) shell.setPitLane({ ...c, ...patch }); };
  const val = (inp) => { const v = Number(inp.value); return inp.value === '' || !Number.isFinite(v) ? null : v; };

  on.onchange = () => {
    if (!on.checked) return shell.setPitLane(null);
    const first = doc().pieces[0], L = first ? lenOf(segs(), first.id) : 0, ease = Math.max(5, Math.min(80, Math.round(L * 0.3)));
    // along the first piece (the start straight): in from each end by a tenth, with the peel-off and merge sized to fit
    shell.setPitLane({ ...DEFAULT, leave: { word: first.id, along: Math.round(L * 0.1) }, rejoin: { word: first.id, along: Math.round(L * 0.9) }, divergeM: ease, mergeM: ease });
  };
  side.onchange = () => put({ side: side.value });
  leaveP.onchange = () => put({ leave: { word: leaveP.value, along: 0 } });
  backP.onchange = () => put({ rejoin: { word: backP.value, along: 0 } });
  leaveM.onchange = () => { const v = val(leaveM); if (v !== null) put({ leave: { ...cur().leave, along: v } }); };
  backM.onchange = () => { const v = val(backM); if (v !== null) put({ rejoin: { ...cur().rejoin, along: v } }); };
  for (const [inp, key] of [[gap, 'offsetM'], [width, 'width'], [peel, 'divergeM'], [merge, 'mergeM'], [boxes, 'boxes'], [spacing, 'boxSpacingM']]) inp.onchange = () => { const v = val(inp); if (v !== null) put({ [key]: v }); };

  let shownFor = null;
  const update = (st) => {
    const d = st.history.present, lane = d.pitLane, first = d.pieces[0];
    on.disabled = !first || first.type !== 'road';
    if (d === shownFor && st.resolved === update.resolved) return;
    shownFor = d; update.resolved = st.resolved;
    on.checked = !!lane; box.style.display = lane ? '' : 'none';
    if (!lane) return;
    const roads = d.pieces.filter((P) => P.type === 'road');
    for (const sel of [leaveP, backP]) sel.replaceChildren(...roads.map((P) => new win.Option(P.id, P.id)));
    side.value = lane.side; leaveP.value = lane.leave.word; backP.value = lane.rejoin.word;
    leaveM.value = String(lane.leave.along); backM.value = String(lane.rejoin.along);
    gap.value = String(lane.offsetM); width.value = String(lane.width); peel.value = String(lane.divergeM); merge.value = String(lane.mergeM);
    boxes.value = String(lane.boxes); spacing.value = String(lane.boxSpacingM);
    const info = shell.spawnsInfo();
    const onLane = info && info.placed ? info.placed.filter((m) => /^AC_PIT_/.test(m.name) && m.onLane && !m.error).length : 0;
    status.style.color = info && info.laneError ? 'var(--bad, #ff4d4d)' : '';
    flatten.style.display = info && info.laneError && /^PIT_JOIN_NOT_FLAT/.test(info.laneError) ? '' : 'none';
    status.textContent = !info ? '' : info.laneError ? `The pit lane cannot be built here: ${say(info.laneError)}${/^PIT_JOIN_NOT_FLAT/.test(info.laneError) ? ' Or press "Flatten road for pit".' : ''}`
      : info.lane ? `Pit lane: ${Math.round(info.lane.lengthM)} m, ${onLane} of ${lane.boxes} pit box${lane.boxes === 1 ? '' : 'es'} on it. Practice and hotlap pit starts spawn here.` : '';
  };
  const nodes = [el('h3', { text: 'Pit lane' }), field('pit lane', on), box];
  const unsub = shell.subscribe(update); update(shell.getState());
  return { nodes, update, unmount() { unsub(); } };
}

module.exports = { mount, say, WHY };
