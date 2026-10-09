// spawnsui.js: THE "START & GRID" SECTION of the core panel (the keeper, 2026-10-09: "move the start line around the first piece … a numbered grid that will
// fit on the length and width of the track … I pick the number, and it grows the more I put down … lengthen the pack or condense it, make it wider or closer
// together … a hotlap spawn I place down manually"). Off by default: the export places the start itself (app/core/coreshell.js startLayout). "Place by hand"
// gives the track a spawns block (src/core/document.js) that the export then writes exactly; unticking it removes the block again.
//
// What it shows: the line's distance into the FIRST piece (a slider over the piece and a box), the grid's car count, the pack's length (metres along the
// road between two cars in one column) and width (metres between the two columns), a reset to the measured spacing (src/markers/layout.js PACK), the
// hotlap (put on the selected piece, then slid along it; removed), the speed the hotlap reaches by the line, and every red and amber the marker checks give.
// A slider COMMITS when it is let go (one undo step), and shows its number while it moves.
//
//   mount({ shell, el, win }) -> { nodes, update(state), unmount() }
'use strict';
const { PACK } = require('../../src/markers/layout.js');

const lenOf = (segments, id) => (segments || []).filter((g) => g.id === id).reduce((a, g) => a + g.length, 0);
const r1 = (x) => Math.round(x * 10) / 10;

function mount({ shell, el, win }) {
  const byHand = el('input', { type: 'checkbox', 'aria-label': 'place the start by hand', title: 'off: the export puts the start on the longest straight by itself; on: you place the line, the grid and the hotlap' });
  const mode = el('p', { class: 'message', 'aria-label': 'how the start is placed', style: 'font-size:12px;margin:2px 0' });
  const lineR = el('input', { type: 'range', min: '0', max: '100', step: '0.5', 'aria-label': 'start line along the first piece', style: 'width:100%' });
  const lineN = el('input', { type: 'number', step: '0.5', min: '0', 'aria-label': 'start line metres into the first piece' });
  const lineOf = el('span', { style: 'font-size:12px;color:#aab2c0' });
  const cars = el('input', { type: 'number', step: '1', min: '1', max: '64', 'aria-label': 'grid cars' });
  const packL = el('input', { type: 'number', step: '0.5', min: String(PACK.rowGapMinM), 'aria-label': 'pack length: metres along the road between two cars in a column', title: `metres along the road between two cars in the same column (the other column sits halfway); at least ${PACK.rowGapMinM.toFixed(1)} m, a T-180 and a metre` });
  const packW = el('input', { type: 'number', step: '0.5', min: String(PACK.colGapMinM), 'aria-label': 'pack width: metres between the two columns', title: `metres between the two columns, centre to centre; at least ${PACK.colGapMinM.toFixed(2)} m, a T-180 and half a metre` });
  const resetPack = el('button', { text: 'Measured spacing', title: `back to the spacing from the measured T-180 (6.67 m x 2.67 m): ${PACK.rowGapM} m along a column, ${PACK.colGapM} m between columns` });
  const hotSet = el('button', { text: 'Hotlap on selected piece', title: 'select a piece on the track first (click it), then put the hotlap spawn on it; slide it along the piece after' });
  const hotPiece = el('select', { 'aria-label': 'hotlap piece' });
  const hotR = el('input', { type: 'range', min: '0', max: '100', step: '0.5', 'aria-label': 'hotlap along its piece', style: 'width:100%' });
  const hotN = el('input', { type: 'number', step: '0.5', min: '0', 'aria-label': 'hotlap metres into its piece' });
  const hotOff = el('button', { text: 'Remove hotlap' });
  const hotSay = el('p', { class: 'message', 'aria-label': 'hotlap speed', style: 'font-size:12px;margin:2px 0' });
  const checks = el('ul', { 'aria-label': 'start and grid checks', style: 'margin:2px 0;padding-left:18px;font-size:12px' });
  const field = (label, ...kids) => el('label', { style: 'display:block;margin:2px 0' }, el('span', { text: label }), ' ', ...kids);
  const handBox = el('div', {}, field('start line m', lineN, ' ', lineOf), lineR, field('cars', cars), field('pack length m', packL), field('pack width m', packW), el('div', { class: 'actions' }, resetPack),
    el('div', { class: 'actions' }, hotSet, hotOff), field('hotlap piece', hotPiece), field('hotlap m', hotN), hotR, hotSay, checks);

  const doc = () => shell.getState().history.present;
  const segs = () => (shell.getState().resolved || {}).segments || [];
  const sp = () => doc().spawns;
  const put = (patch) => { const cur = sp(); if (!cur) return; shell.setSpawns({ ...cur, ...patch }); };
  const num = (inp) => { const v = Number(inp.value); return inp.value === '' || !Number.isFinite(v) ? null : v; };

  byHand.onchange = () => {
    if (!byHand.checked) return shell.setSpawns(null);
    const first = doc().pieces[0], L = first ? lenOf(segs(), first.id) : 0;
    // the line near the END of the first piece, so the pack sits behind it on that piece (the keeper: "most of the time I make a long straight for the start")
    shell.setSpawns({ line: { along: r1(Math.max(0, L - 15)) }, grid: { count: PACK.count, rowGapM: PACK.rowGapM, colGapM: PACK.colGapM } });
  };
  lineR.oninput = () => { lineN.value = lineR.value; };
  lineR.onchange = () => put({ line: { along: Number(lineR.value) } });
  lineN.onchange = () => { const v = num(lineN); if (v !== null) put({ line: { along: v } }); };
  cars.onchange = () => { const v = num(cars); if (v !== null) put({ grid: { ...sp().grid, count: v } }); };
  packL.onchange = () => { const v = num(packL); if (v !== null) put({ grid: { ...sp().grid, rowGapM: Math.max(v, PACK.rowGapMinM) } }); };
  packW.onchange = () => { const v = num(packW); if (v !== null) put({ grid: { ...sp().grid, colGapM: Math.max(v, PACK.colGapMinM) } }); };
  resetPack.onclick = () => put({ grid: { ...sp().grid, rowGapM: PACK.rowGapM, colGapM: PACK.colGapM } });
  hotSet.onclick = () => {
    const sel = shell.getState().selection;
    if (!sel || !sel.ids || !sel.ids.length) { hotSay.textContent = 'Select a piece first: click it on the track, then press "Hotlap on selected piece".'; return; }
    put({ hotlap: { piece: sel.ids[0], along: 0 } });
  };
  hotPiece.onchange = () => put({ hotlap: { piece: hotPiece.value, along: 0 } });
  hotR.oninput = () => { hotN.value = hotR.value; };
  hotR.onchange = () => { const h = sp().hotlap; if (h) put({ hotlap: { ...h, along: Number(hotR.value) } }); };
  hotN.onchange = () => { const h = sp().hotlap, v = num(hotN); if (h && v !== null) put({ hotlap: { ...h, along: v } }); };
  hotOff.onclick = () => { const { hotlap, ...rest } = sp() || {}; if (hotlap) shell.setSpawns(rest); };

  let shownFor = null;
  const update = (st) => {
    const d = st.history.present, s = d.spawns, first = d.pieces[0];
    byHand.disabled = !first || first.type !== 'road';
    if (d === shownFor && st.resolved === update.resolved) return;
    shownFor = d; update.resolved = st.resolved;
    byHand.checked = !!s;
    handBox.style.display = s ? '' : 'none';
    mode.textContent = !first ? 'Put the first piece down: the start line goes on it.'
      : s ? 'Placed by hand: the export writes exactly this.' : 'Automatic: the export puts the start on the longest straight. Tick to place it yourself.';
    if (!s) return;
    const L = lenOf(st.resolved.segments, first.id);
    lineR.max = String(r1(L)); lineR.value = lineN.value = String(Math.min(s.line.along, L)); lineOf.textContent = `of ${r1(L)} m (first piece)`;
    cars.value = String(s.grid.count); packL.value = String(s.grid.rowGapM); packW.value = String(s.grid.colGapM);
    const roads = d.pieces.filter((P) => P.type === 'road');
    hotPiece.replaceChildren(...roads.map((P) => new win.Option(P.id, P.id)));
    const h = s.hotlap;
    hotPiece.disabled = hotR.disabled = hotN.disabled = hotOff.disabled = !h;
    if (h) { const hl = lenOf(st.resolved.segments, h.piece); hotPiece.value = h.piece; hotR.max = String(r1(hl)); hotR.value = hotN.value = String(h.along); }
    const info = shell.spawnsInfo(), items = [];
    if (info && info.error) items.push(['red', info.error]);
    const hot = info && info.placed ? info.placed.find((m) => m.name === 'AC_HOTLAP_START_0') : null;
    hotSay.textContent = !h ? 'No hotlap spawn placed: the export puts one far enough back for the T-180 to be at full speed by the line. Select a piece and press "Hotlap on selected piece" to place it yourself.'
      : hot && !hot.error ? `Hotlap: ${Math.round(hot.runUpM)} m to the line, reaching about ${hot.speedKmh} km/h there (flat road, full thrust).` : '';
    if (info && info.check) {
      for (const c of info.check.checks) for (const p of c.problems) items.push(['red', `${c.id}: ${p}`]);
      for (const a of info.check.amber || []) items.push(['amber', a.text]);
    }
    for (const m of (info && info.missing) || []) items.push(['red', `${m.what} is on piece ${m.word}, which is not on the track any more`]);
    checks.replaceChildren(...(items.length ? items : [['ok', 'Line, grid and spawns: all on the road, no overlap.']]).map(([k, t]) => el('li', { text: t, style: `color:${k === 'red' ? 'var(--bad, #ff4d4d)' : k === 'amber' ? '#ffb347' : '#8fd18f'}` })));
  };
  const nodes = [el('h3', { text: 'Start & grid' }), field('place by hand', byHand), mode, handBox];
  const unsub = shell.subscribe(update); update(shell.getState());
  return { nodes, update, unmount() { unsub(); } };
}

module.exports = { mount, lenOf };
