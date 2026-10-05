// piecesui.js: SAVED PIECES in the panel (D240, the UI half; the core is src/core/piece.js, the state and actions are the core shell's, app/core/coreshell.js). DOM only.
//
//   SELECT on the track: a click on a piece selects it, a shift-click selects the run from the piece selected first; a click on nothing clears. (A pointer that moved more than
//          CLICK_PX between press and release was a camera drag and selects nothing; with the brush armed the click is the brush's.) The selection is drawn on the track
//          (app/core/selectionlayer.js) and offers SAVE AS PIECE (a name, written to the app's pieces folder) and DELETE.
//   DELETE: at the open end the pieces simply go (one undo step). In the MIDDLE it is PREVIEWED first (the librarian's ruling: the two sides are joined again by moving everything
//          after the gap along, C measured it 357 of 357 times): the track as it would be is the see-through ghost, the list says how far each piece moves, an overlap check
//          of the result is shown, and Apply (which writes the track to its backups first) or Cancel decides.
//   THE LIBRARY: every saved piece with its name, length, turn, climb and a plan thumbnail; Add at head (optionally mirrored left/right), Rename, Delete. A file that cannot
//          be read is listed with the reason.
'use strict';

const SL = require('./selectionlayer.js');
const LB = require('./labels.js');
const RG = require('../validate-ui/redgroups.js');

const CLICK_PX = 5;   // more than this between press and release is a drag, the camera's

const KIND = { legacy: 'plain', cup: 'cup', tube: 'tube' };
const fmtLen = (m) => `${m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m'}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** One library entry as a person reads it: "3 pieces · 540 m · turn +90.0° · climb 0.0° · cup". Pure (tested headless). */
function describe(item) {
  if (item.error) return `cannot be used: ${item.error}`;
  const s = item.summary, kind = KIND[s.kind] || s.kind;
  return `${plural(s.pieces, 'piece')} · ${fmtLen(s.lengthM)} · turn ${LB.fmtDeg(s.turnDeg)} · climb ${LB.fmtDeg(s.climbDeg)} · ${kind}${s.flights ? ` · ${plural(s.flights, 'jump')}` : ''}`;
}

function mount({ root, stage, shell, win, el, armed = () => false, send = null }) {
  const doc = root.ownerDocument;
  const fire = send || ((name, detail) => doc.dispatchEvent(new win.CustomEvent(name, { detail })));
  const ask = (name) => { let got = null; fire(name, { reply: (x) => { got = x; } }); return got; };

  // ── the selection and the delete preview ──
  const selInfo = el('p', { class: 'head', 'aria-label': 'selection', text: '' });
  const nameIn = el('input', { type: 'text', 'aria-label': 'piece name', placeholder: 'piece name', maxlength: '60', style: 'min-width:0;max-width:100%', title: 'a name for the piece: 1 to 60 letters, digits, spaces, _ or -' });
  const saveBtn = el('button', { text: 'Save as piece', title: 'keep the selected pieces in the library, relative to where they start', onclick: () => { void shell.savePiece(nameIn.value.trim()); } });
  const delBtn = el('button', { text: 'Delete selected', title: 'at the end of the track the pieces simply go; in the middle you see what it does first', onclick: () => shell.deleteSelection() });
  const clearBtn = el('button', { text: 'Clear selection', onclick: () => shell.clearSelection() });
  const why = el('p', { class: 'message', 'aria-label': 'why the selection cannot be saved', style: 'font-size:12px;margin:2px 0' });
  const applyBtn = el('button', { text: 'Apply delete', title: 'delete as previewed (the track is copied to its backups first; one undo step)', onclick: () => { void shell.applyDelete(); } });
  const cancelBtn = el('button', { text: 'Cancel delete', title: 'drop the preview: nothing changes', onclick: () => shell.cancelDelete() });
  const proposalBox = el('div', { 'aria-label': 'delete preview', class: 'head' });
  const focus = (s) => fire('t180-camera-focus', { s });
  const placeButton = (it, text) => el('button', { text, title: `${it.what}${it.detail ? `: ${it.detail}` : ''}: show it`, class: 'linkish', onclick: () => focus(it.s) });
  const drawProposal = (p) => {
    applyBtn.style.display = cancelBtn.style.display = p ? '' : 'none';
    if (!p) { proposalBox.replaceChildren(); return; }
    const after = p.displacement.filter((x) => x.piece >= p.from), moved = after.filter((x) => x.maxM > 1e-3).sort((a, b) => b.maxM - a.maxM), still = after.length - moved.length;
    const first = moved.length ? moved.find((x) => x.piece === p.from) : null;
    const kids = [
      el('p', { text: `Preview: ${plural(p.removed.length, 'piece')} (${p.removed[0]}${p.removed.length > 1 ? ` to ${p.removed[p.removed.length - 1]}` : ''}) would be taken out of the middle of the track. The two sides are joined again at the gap${first ? `, which changes the start of ${first.id} (up to ${first.maxM.toFixed(first.maxM < 10 ? 2 : 1)} m)` : ''}, and everything after the gap moves along with it. The see-through track on the preview is the result.` }),
      el('p', { text: moved.length ? `Moves: ${moved.slice(0, 8).map((x) => `${x.id} up to ${x.maxM.toFixed(x.maxM < 10 ? 2 : 1)} m`).join(', ')}${moved.length > 8 ? `, and ${moved.length - 8} more` : ''}; ${plural(still, 'piece')} after the gap keep${still === 1 ? 's' : ''} ${still === 1 ? 'its' : 'their'} place; everything before the gap is exactly as it was.` : 'Nothing after the gap moves by more than a millimetre.' })];
    const groups = RG.groupReds([...p.check.overlaps, ...p.check.others], p.resolved.segments);
    if (!groups.length) kids.push(el('p', { text: 'No overlap and no red on the track after the delete.' }));
    for (const g of groups) kids.push(el('p', { text: `${g.key === 'overlap' ? 'The track would OVERLAP ITSELF' : g.title} (${g.count}):`, style: 'color: var(--bad)' }), el('div', { class: 'actions' }, ...g.items.slice(0, 24).map((it) => placeButton(it, RG.placeText(it)))));
    proposalBox.replaceChildren(...kids);
  };

  // ── the library ──
  const mirror = el('input', { type: 'checkbox', 'aria-label': 'mirror on insert', title: 'add the piece as its left/right mirror image' });
  const listBox = el('div', { 'aria-label': 'saved pieces', class: 'pieces-list' }), listNote = el('p', { class: 'message', style: 'font-size:12px;margin:2px 0' });
  let renaming = null, confirming = null, libStamp = null, listSeq = 0, items = [];
  const thumb = (it) => {
    const c = doc.createElement('canvas'); c.setAttribute('width', '100'); c.setAttribute('height', '60'); c.setAttribute('aria-label', `plan view of ${it.name}`); c.style.cssText = 'width:100px;height:60px;background:#0b0d11;border-radius:3px;flex:none';
    const ctx = c.getContext ? c.getContext('2d') : null;
    if (ctx && it.thumb && it.thumb.points.length) {
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = '#ffb020'; ctx.lineWidth = 2.5; ctx.beginPath();
      it.thumb.points.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(it.thumb.points[0][0], it.thumb.points[0][1], 2.5, 0, Math.PI * 2); ctx.fill();   // where it starts
    }
    return c;
  };
  const row = (it) => {
    const body = [el('div', { style: 'font-weight:700', text: it.name }), el('div', { style: 'font-size:12px;color:#aab2c0', 'aria-label': `${it.name} details`, text: describe(it) })];
    const buttons = [];
    if (renaming === it.name) {
      const nin = el('input', { type: 'text', value: it.name, 'aria-label': 'new name', maxlength: '60', style: 'min-width:0;max-width:100%' });
      buttons.push(nin, el('button', { text: 'OK', onclick: () => { const to = nin.value.trim(); renaming = null; void shell.renamePiece(it.name, to).then(() => redrawList()); } }), el('button', { text: 'Cancel', onclick: () => { renaming = null; redrawList(); } }));
    } else if (confirming === it.name) {
      buttons.push(el('span', { text: 'Delete this saved piece for good?' }), el('button', { text: 'Yes, delete', onclick: () => { confirming = null; void shell.deletePieceFile(it.name); } }), el('button', { text: 'No', onclick: () => { confirming = null; redrawList(); } }));
    } else {
      if (!it.error) buttons.push(el('button', { text: 'Add at head', title: `put ${it.name} where the track ends${mirror.checked ? ', mirrored' : ''} (one undo step)`, 'aria-label': `add ${it.name} at the head`, onclick: () => { void shell.insertPiece(it.name, { mirror: mirror.checked }); } }));
      buttons.push(el('button', { text: 'Rename', 'aria-label': `rename ${it.name}`, onclick: () => { renaming = it.name; confirming = null; redrawList(); } }), el('button', { text: 'Delete', 'aria-label': `delete the saved piece ${it.name}`, onclick: () => { confirming = it.name; renaming = null; redrawList(); } }));
    }
    return el('div', { class: 'piece-row', 'data-piece': it.name, style: 'display:flex;gap:8px;align-items:center;margin:6px 0' }, thumb(it), el('div', { style: 'min-width:0' }, ...body, el('div', { class: 'actions' }, ...buttons)));
  };
  const redrawList = () => {
    listBox.replaceChildren(...items.map(row));
    listNote.textContent = items.length ? '' : 'No saved pieces yet: select pieces on the track and press Save as piece.';
  };
  const refreshList = () => {
    const seq = ++listSeq;
    return Promise.resolve(shell.listPieces()).then((r) => { if (seq !== listSeq) return; items = r; redrawList(); }, (e) => { if (seq !== listSeq) return; items = []; listBox.replaceChildren(); listNote.textContent = `the library could not be read: ${e && e.message || e}`; });
  };

  // ── a click on the track ──
  let down = null;
  const onDown = (e) => { down = e.button === 0 && !armed() ? { x: e.clientX, y: e.clientY } : null; };
  const onUp = (e) => {
    const d = down; down = null;
    if (!d || armed() || (e.button !== undefined && e.button !== 0)) return;
    if (e.target && e.target !== stage && e.target.tagName !== 'CANVAS') return;   // a handle or a button over the preview is its own
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_PX) return;           // a drag: the camera's
    const r = stage.getBoundingClientRect ? stage.getBoundingClientRect() : { left: 0, top: 0 };
    let hit = null; fire('t180-pick', { x: e.clientX - r.left, y: e.clientY - r.top, reply: (h) => { hit = h; } });
    const track = ask('t180:track-request');
    const id = hit && track && Array.isArray(track.segments) && Number.isFinite(hit.s) ? LB.pieceAt(track.segments, hit.s) : null;
    const i = id === null ? -1 : shell.getState().history.present.pieces.findIndex((P) => P.id === id);
    if (i < 0) { if (shell.getState().selection) shell.clearSelection(); return; }
    shell.selectPiece(i, { extend: !!e.shiftKey });
  };
  if (stage) { stage.addEventListener('pointerdown', onDown); stage.addEventListener('pointerup', onUp); }
  const layer = stage ? SL.mount(stage, shell, win) : null;

  const draw = (st) => {
    const info = shell.selectionInfo(), d = st.history.present;
    selInfo.textContent = info
      ? `Selected: ${info.count === 1 ? info.ids[0] : `${info.ids[0]} to ${info.ids[info.ids.length - 1]} (${info.count} pieces)`} · ${fmtLen(info.lengthM)}${info.atEnd && !info.closed ? ' · at the end of the track' : ''}`
      : (d.pieces.length ? 'Nothing selected: click a piece on the track to select it; Shift-click another to select the run between.' : 'The track has no pieces yet.');
    saveBtn.disabled = !info || !!info.saveProblem; delBtn.disabled = !info; clearBtn.disabled = !info; nameIn.disabled = !info;
    why.textContent = info && info.saveProblem ? `Cannot be saved as a piece: ${info.saveProblem}` : '';
    drawProposal(st.deleteProposal && st.deleteProposal.base === d ? st.deleteProposal : null);
    if (st.libraryStamp !== libStamp) { const first = libStamp === null; libStamp = st.libraryStamp; if (!first && st.message && /^saved the piece/.test(st.message)) nameIn.value = ''; refreshList(); }
  };
  const unsub = shell.subscribe(draw); draw(shell.getState());
  const nodes = {
    selection: [el('h3', { text: 'Selected pieces' }), selInfo, el('div', { class: 'pickers' }, el('label', { class: 'picker' }, el('span', { text: 'name' }), nameIn)), el('div', { class: 'actions' }, saveBtn, delBtn, clearBtn), why, el('div', { class: 'actions' }, applyBtn, cancelBtn), proposalBox],
    library: [el('h3', { text: 'Pieces library' }), el('div', { class: 'pickers' }, el('label', { class: 'picker' }, el('span', { text: 'mirror on insert' }), mirror)), listBox, listNote],
  };
  return { nodes, layer, refresh: refreshList, items: () => items.slice(), unmount() { unsub(); if (stage) { stage.removeEventListener('pointerdown', onDown); stage.removeEventListener('pointerup', onUp); } if (layer) layer.unmount(); } };
}

module.exports = { mount, describe, CLICK_PX };
