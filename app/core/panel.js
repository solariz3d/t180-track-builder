// panel.js: the EQUATION CORE's controls (D186, pane C), in the left column where the piece builder's palette is. DOM only; every
// action is the core shell's (app/core/coreshell.js), every number it shows is the shell's state.
//
//   EXTEND at the build head: keep going (no handle), or turn / climb / bank / cup / width targets over a length. Hovering the button
//          shows the ghost (the preview's 't180-ghost' candidate), so what a click adds is seen before it is added.
//   BRUSH on the preview: arm it, then drag on the track. The pick is the preview's ('t180-pick'); the drag's vertical distance is
//          the change at the brush's centre; one drag is one undo step. The local height/lateral brush (E) is the default when
//          it is in the build; the rate brush (one channel) is the explicit second mode.
//   CLOSE as one click.
//   THE READOUT (L130): beside Extend's fields, the piece they describe, BEFORE it is placed: its length and the change it makes
//          in turn, climb and bank (A's src/core/readout.js, candidateReadout), redrawn inside every field's input handler; and on
//          the track, a label at every placed piece with the same numbers (app/core/labels.js). The strings are the same function's
//          (labels.js formatReadout), so what the ghost promised is what the placed piece's label says.
//   OPEN A LOCAL EXAMPLE: a real track's D184 fit and its read, picked from the user's own reads/ folder (never in the program).
'use strict';

const LB = require('./labels.js');
const RG = require('../validate-ui/redgroups.js');   // D242: every red in plain words, grouped, with where
const XS = require('./xsec.js');   // the cross-section channels (D225): edge angle, edge start, tube sweep
const PU = require('./piecesui.js');   // D240: saved pieces: select on the track, Save as piece, the library, a previewed middle delete
const HD = require('./handles.js');   // D244: the drag handles on the Extend ghost, and (Sculpt, D244b) on a placed piece
const JW = require('./jumpplan.js');   // D243: the flight as the car flies it, and the core's jump refusals in plain words
const FL = require('./flightlayer.js');   // D243: the flights drawn as dashed arcs over the preview

// the change per pixel of vertical drag, in each brush channel's unit (up = more)
// (c, the CUP, is the cross-section's edge angle in DEGREES, 0–150: D190, E's seal row 7)
const PER_PX = Object.freeze({ kh: 2e-5, kv: 2e-5, phi: 0.002, w: 0.05, r: 0.02, c: 0.2, e: 0.2, s: 0.002, t: 0.5, height: 0.03, lateral: 0.03 });
const CHANNEL_NAMES = Object.freeze({ kh: 'turn rate', kv: 'climb rate', phi: 'bank', w: 'width', r: 'wall rise', c: 'cup', e: 'edge angle', s: 'edge start', t: 'tube sweep', height: 'height', lateral: 'sideways' });
const DEG = Math.PI / 180;

/**
 * The extend options the controls describe (pure: tested headless). Empty fields continue the channel. On an EMPTY track (`empty`) the
 * typed values are also the first piece's START (`first`, src/core/extend.js), so the whole first piece is what was typed from s = 0; without
 * it every channel started at its default and ramped (D194a, the keeper: "would alway make a bottle neck of width at the start of the track").
 * An untyped field is in neither, so that channel keeps its default start.
 */
// AT THE START (D194b): a ticked field's target is reached within AT_START_M, one knot span (src/core/document.js KNOT_M; the piece's length
// if that is shorter: the core needs a transition no longer than the piece), then held for the rest of the piece. Unticked, it blends over
// the whole piece as before. The core takes `transition` as a number OR a per-channel map in metres (A's D194b contract).
const AT_START_M = 20;
const FIELD_CHANNEL = Object.freeze({ turn: 'kh', climb: 'kv', bank: 'phi', width: 'w', cup: 'c', edge: XS.CHANNEL.edge, start: XS.CHANNEL.start, tube: XS.CHANNEL.tube });
function extendOptions({ length, turn, climb, bank, width, cup, edge, start, tube, empty = false, atStart = {} }) {
  const targets = {}, num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  const t = num(turn), c = num(climb), b = num(bank), w = num(width), k = num(cup);
  if (t !== null) targets.kh = t * DEG / 100;          // degrees of heading per 100 m
  if (c !== null) targets.kv = c * DEG / 100;          // degrees of pitch per 100 m
  // degrees of bank, + = left side up. NOT wrapped to ±180: 360 is a full turn of roll, -540 one and a half the other way (the spiral,
  // E's seal S1: the core's φ channel winds continuously, and a wrap here would turn a 360° spiral into no roll at all)
  if (b !== null) targets.phi = b * DEG;
  if (w !== null) targets.w = w;                        // m
  // the CUP (D190): the channel c holds DEGREES, so the typed value goes in as it is. It is NOT clamped here: the core's guard
  // binds the DOCUMENT to [0, 150] and refuses by name (E's seal row 2 and V5), and a clamp here would hide that guard
  if (k !== null) targets.c = k;
  // THE CROSS-SECTION (D225, E's seal; names in xsec.js). Like the cup, NOT clamped: the core's guards bind the document and refuse by name
  // (E2: e ≥ 0 and the total ≤ 150; V4: s in [0.5, 0.95]; T1: the sweep in [0, 360] and the held slot near 360; T3: an open tube's
  // t/2 + e ≤ 180), and a clamp here would hide them (E2's plant KE2-2). The edge angle and the sweep are DEGREES, as c is; the start a share.
  const e = num(edge), sl = num(start), tb = num(tube);
  if (e !== null) targets[XS.CHANNEL.edge] = e;
  if (sl !== null) targets[XS.CHANNEL.start] = sl;
  if (tb !== null) targets[XS.CHANNEL.tube] = tb;
  const out = { length: Number(length), targets };
  // only a field WITH a target can be "at the start" (an untouched field has none, D193); none ticked: no `transition`, exactly as before
  const transition = {};
  for (const [f, ch] of Object.entries(FIELD_CHANNEL)) if (atStart[f] && targets[ch] !== undefined) transition[ch] = Math.min(AT_START_M, out.length);
  if (Object.keys(transition).length) out.transition = transition;
  if (empty && Object.keys(targets).length) out.first = { ...targets };   // D194a: on an empty track the typed values are the first piece's start
  return out;
}
/** A cup angle as the readout shows it: the bank cell's rounding (one decimal, half away from zero), no sign on a depth. */
const fmtCup = (x) => LB.fmtDeg(x).replace(/^\+/, '');
/** An edge start as the readout shows it: a share, two decimals, half away from zero (one decimal would read C's 0.64 as 0.6). */
const fmtShare = (x) => (Math.round(Math.abs(x) * 100 + 1e-7) / 100 * Math.sign(x) || 0).toFixed(2);
/** "from → to" for a pair of readout values, or — when the core does not report them (a core without the channel) */
const pairOf = (r, [from, to], fmt) => (Number.isFinite(r[from]) && Number.isFinite(r[to]) ? `${fmt(r[from])} → ${fmt(r[to])}` : '—');

function mount(root, shell) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const el = (tag, attrs = {}, ...kids) => { const e = doc.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e[k] = v; else e.setAttribute(k, v); } e.append(...kids); return e; };
  const field = (label, input) => el('label', { class: 'picker' }, el('span', { text: label }), input);
  // a channel field with its "at start" box after the input (D194b); the input stays the label's second child
  const fieldAt = (label, input, k) => el('label', { class: 'picker' }, el('span', { text: label }), input, el('span', { class: 'at-start', style: 'white-space:nowrap;font-size:12px', title: atStart[k].getAttribute ? atStart[k].getAttribute('title') : '' }, atStart[k], el('span', { text: ' at start' })));
  const num = (value, step, title) => el('input', { type: 'number', value: String(value), step: String(step), title: title || '' });
  const send = (name, detail) => doc.dispatchEvent(new win.CustomEvent(name, { detail }));

  // EXTEND
  // (a field SHOWS what the track does at the head; left as shown, the track keeps going the way it goes; a changed value is a target)
  const len = num(100, 10, 'metres added'), turn = num('', 1, 'degrees of heading per 100 m, + = left. Shows the turn at the head; left as shown, the track keeps turning as now'),
    climb = num('', 1, 'degrees of pitch per 100 m, + = up. Shows the climb at the head; left as shown, the track keeps climbing as now'), bank = num('', 1, 'degrees of bank, + = left side up. Shows the bank at the head; left as shown, it keeps it'),
    width = num('', 1, 'road width in m. Shows the width at the head; left as shown, it keeps it');
  // the CUP (D190): how deep the road's cross-section is, as its edge angle — 0 flat, ~15 today's bowl, ~31 today's half-pipe,
  // 90 vertical walls, 150 a partial tube. Independent of bank: bank still rolls the whole section
  const cup = el('input', { type: 'number', value: '', step: '1', min: '0', max: '150', title: 'cup: the edge angle of the cross-section in degrees, 0 (flat) to 150; 90 = vertical walls. Bank still rolls the whole section. Shows the cup at the head; left as shown, it keeps it' });
  // THE FIELDS SHOW THE HEAD (D193, the keeper: "show the original value the first piece starts as instead of it being blank"). Each
  // channel field shows the head's END state in its own units (the first piece's start on an empty track), refreshed whenever the
  // document changes (Extend, Undo, Redo, open, a brush). A field whose text is exactly what was shown sends NO target, the same as a
  // blank did: the core CONTINUES a channel (value + slope, src/core/extend.js), and a target equal to the value is not that — it
  // bends a channel that was still changing, and any cup target turns a legacy piece into a cup piece. Only a changed value is a target.
  // THE CROSS-SECTION (D225): the edge curve (an extra angle on the outer band, from the edge start out; 0 = off) and the tube (the sweep of
  // a circular section, 360 = a closed pipe). The bank field above takes any number of degrees, 360 included (the spiral): it has no min or max
  const edge = el('input', { type: 'number', value: '', step: '1', min: '0', title: 'edge angle: how many degrees MORE the very edge tilts than the plain profile would, rising smoothly from the edge start out; 0 = off. Bank still rolls the whole section. Shows the edge at the head; left as shown, it keeps it' }),
    start = el('input', { type: 'number', value: '', step: '0.01', min: '0.5', max: '0.95', title: 'edge start: where the edge curve begins, as a share of the half-width from the centre (0.64 = the outer 36% each side curves more; 0.5 to 0.95). Shows it at the head; left as shown, it keeps it' }),
    tube = el('input', { type: 'number', value: '', step: '1', min: '0', max: '360', title: 'tube sweep: the cross-section as an arc of this many degrees, 0 (none) to 360 (a closed pipe). Shows the sweep at the head; left as shown, it keeps it' });
  const HEAD = { turn: [turn, (h) => h.kh * 100 / DEG], climb: [climb, (h) => h.kv * 100 / DEG], bank: [bank, (h) => h.phi / DEG], width: [width, (h) => h.w], cup: [cup, (h) => h.c],
    edge: [edge, (h) => h[XS.CHANNEL.edge]], start: [start, (h) => h[XS.CHANNEL.start]], tube: [tube, (h) => h[XS.CHANNEL.tube]] };
  // THE WIDTH REFERENCE (D232, the keeper: "a drop down that tells you the width of different known t-180 tracks, such as thunderhead, aurora, nordic"):
  // picking a known track puts its measured median into the width field, like typing it (so on an empty track it is the first piece's start, which is the
  // new-track default). For a TUBE (the sweep field at 360) the figures are the distance round and the entry says how wide that is across.
  const WL = require('./widthlike.js');
  const wlike = el('select', { 'aria-label': 'width like a known T-180 track', title: 'width like a known T-180 track: the median of what its reads measure (the 10th to 90th percentile in brackets). Picking one sets the width field' });
  const wnote = el('p', { class: 'message', 'aria-label': 'what the width means for a tube', style: 'font-size:12px;margin:2px 0' });
  const fillWidthLike = () => {
    const tubeNow = WL.isTube(tube.value);
    wlike.replaceChildren(...WL.entries(tubeNow).map((e) => new win.Option(e.label, e.value))); wlike.value = '';
    wnote.textContent = tubeNow ? WL.tubeNote(width.value) : '';
  };
  const shown = {};
  const show = (x) => { const v = Math.round(x * 100) / 100; return String(Object.is(v, -0) ? 0 : v); };   // two decimals, no trailing zeros, no "-0"
  const showHead = () => { const h = shell.headState(); for (const [k, [input, of]] of Object.entries(HEAD)) { shown[k] = show(of(h)); input.value = shown[k]; } for (const [k, f] of [['cup', cup], ['tube', tube]]) { f.disabled = false; f.setAttribute('title', baseTitle[k]); } fillWidthLike(); };   // (baseTitle is set below, before the first draw)
  // A PIECE IS A CUP OR A TUBE, never both (A's contract: `c` and `t` targets together are refused BAD_TARGET). CHOSEN: the field changed
  // LAST wins. Changing one puts the other back to what it shows (so it sends no target) and DISABLES it, with a tooltip saying why; putting
  // the changed one back to its shown value enables the other again, and so does every new document (showHead).
  const ONE_OF = 'a piece is a cup or a tube, not both: put the other field back to its shown value to use this one';
  const baseTitle = { cup: cup.getAttribute('title'), tube: tube.getAttribute('title') };
  const exclusive = (changed) => {
    const [mine, other, ko] = changed === cup ? ['cup', tube, 'tube'] : ['tube', cup, 'cup'];
    if (HEAD[mine][0].value !== shown[mine]) { other.value = shown[ko]; other.disabled = true; other.setAttribute('title', ONE_OF); }
    else { other.disabled = false; other.setAttribute('title', baseTitle[ko]); }
  };
  const asTyped = (k) => (HEAD[k][0].value === shown[k] ? '' : HEAD[k][0].value);   // untouched = blank = continue
  // "at start" (D194b): one small box per field, off by default (off = ease to the value over the whole piece, as always). It is kept from
  // piece to piece, like a preference; it does nothing for a field left as shown, which has no target
  const atStart = Object.fromEntries(Object.keys(HEAD).map((k) => [k, el('input', { type: 'checkbox', 'aria-label': `${k} at the start`,
    title: `at start: reach this ${k} within the first ${AT_START_M} m of the piece and hold it (off: ease to it over the whole piece)` })]));
  const opts = () => extendOptions({ length: len.value, turn: asTyped('turn'), climb: asTyped('climb'), bank: asTyped('bank'), width: asTyped('width'), cup: asTyped('cup'), edge: asTyped('edge'), start: asTyped('start'), tube: asTyped('tube'),
    atStart: Object.fromEntries(Object.entries(atStart).map(([k, box]) => [k, box.checked])),
    empty: !shell.getState().history.present.pieces.length });
  // D242 item 7 (the keeper, 09:03): UNDO GIVES BACK THE UNDONE PIECE'S VALUES. Each Extend from this panel remembers the fields it was made with, keyed by the
  // document it made; when Undo steps from that document back to the one it was made from, the fields are put back (the length, every field as typed or left as
  // shown, the at-start ticks), so Extend again rebuilds the same piece. Redo, a brush and open show the head, as before
  const madeWith = new WeakMap();
  const fieldsNow = () => ({ len: len.value, values: Object.fromEntries(Object.keys(HEAD).map((k) => [k, HEAD[k][0].value])), ticks: Object.fromEntries(Object.entries(atStart).map(([k, b]) => [k, b.checked])) });
  const extendHere = () => { const before = shell.getState().history.present, made = fieldsNow(); shell.extend(opts()); appliedLen = len.value; const after = shell.getState().history.present; if (after !== before) madeWith.set(after, { before, made }); };
  const putBack = (m) => { len.value = appliedLen = m.len; for (const k of Object.keys(HEAD)) HEAD[k][0].value = m.values[k]; for (const [k, b] of Object.entries(atStart)) b.checked = !!m.ticks[k]; if (cup.value !== shown.cup) exclusive(cup); else if (tube.value !== shown.tube) exclusive(tube); };
  // the ghost: a candidate the shell cannot build, or the preview cannot draw, says why (it used to vanish without a word)
  // THE READOUT of the piece the fields describe: 16 px bold rows, so its ink is at least 11 device px tall (E's M5 (d))
  // cup reads from → to: the DOCUMENT's values (A's cupFromDeg / cupToDeg, which for a legacy piece are its rendered edge), never
  // the typed target, which the core's fit may ring past and its guard may refuse (E's seal row 7)
  const RO = ['length', 'turn', 'climb', 'bank', 'cup', 'edge', 'start', 'tube'], roCells = Object.fromEntries(RO.map((k) => [k, el('span', { 'data-readout': k })]));
  const roName = (k) => (k === 'length' ? 'length' : k === 'cup' ? 'cup from → to' : k === 'edge' ? 'edge from → to' : k === 'start' ? 'edge start from → to' : k === 'tube' ? 'tube from → to' : `${k} change`);
  const roBox = el('div', { class: 'readout', 'aria-label': 'the piece Extend would add', style: 'display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:8px 0;font:bold 16px/1.3 system-ui,"Segoe UI",sans-serif;color:#eef1f6' },
    ...RO.flatMap((k) => [el('span', { text: roName(k), style: 'color:#aab2c0;font-weight:600' }), roCells[k]]));
  const readout = () => {
    let f = null, why = '';
    try {
      if (shell.getState().history.present.closed) why = 'the loop is closed';
      else { const r = shell.candidateReadout(opts()); f = { ...LB.formatReadout(r), cup: `${fmtCup(r.cupFromDeg)} → ${fmtCup(r.cupToDeg)}`,
        // the cross-section cells read the DOCUMENT (the core's readout), never the typed field (E's seal E7, KE7-1)
        edge: pairOf(r, XS.READOUT.edge, fmtCup), start: pairOf(r, XS.READOUT.start, fmtShare), tube: pairOf(r, XS.READOUT.tube, fmtCup) }; }
    } catch (e) { why = e.message; }
    for (const k of RO) roCells[k].textContent = f ? f[k] : '—';
    roBox.title = why;
  };
  const ghost = () => {
    hintNow();   // D242: the straight hint follows the turn field and its box
    readout();   // first, and synchronously: the numbers follow the fields with no timer and no frame wait
    let why = null;
    try { send('t180-ghost', { candidate: shell.candidate(opts()), reply: (r) => { if (r && r.error) why = r.error; } }); } catch (e) { why = e.message; }
    if (why) { send('t180-ghost-clear'); msg.textContent = `no preview of this piece: ${why}`; msg.className = 'message'; }
  };
  // the ghost follows the fields as they change, not only a fresh hover (a pointer resting on the button fires no new mouseenter,
  // so the ghost showed the piece before the last edit, or none: found in the window proof, D186)
  // (the cup's handler is the cup-or-tube one below, D225: the cup is not in this list, where its handler would only be replaced)
  for (const f of [len, turn, climb, bank, width, ...Object.values(atStart)]) f.oninput = f.onchange = ghost;
  for (const f of [edge, start, tube]) f.oninput = f.onchange = ghost;   // the cross-section fields follow the same way (D225)
  for (const f of [cup, tube]) f.oninput = f.onchange = () => { exclusive(f); ghost(); };   // cup OR tube: the rule first, then the ghost
  tube.oninput = tube.onchange = () => { exclusive(tube); ghost(); fillWidthLike(); };   // a tube's entries read round and across (D232)
  width.oninput = width.onchange = () => { ghost(); wnote.textContent = WL.isTube(tube.value) ? WL.tubeNote(width.value) : ''; };
  wlike.onchange = () => { if (!wlike.value) return; width.value = wlike.value; wlike.value = ''; width.oninput(); };   // a pick is a typed width: the ghost and the readout follow
  // THE UNDO GUARD (D240 follow-up; B's look at ab748e5, C's open question): a number typed into an Extend field and not Extended is UN-APPLIED. The first Ctrl+Z puts THAT field back to what the
  // panel put there (the head's value as shown; for the length, what the last Extend left) and says it handled the key, so the track is not stepped and the typing is not lost to a refill;
  // the next Ctrl+Z, with nothing un-applied, undoes the track. The field is the focused one, or else the one touched last (the focus may have moved off it).
  // what the panel left in the fields at its last refill (a new document: the head as shown, or an undone Extend's own values; the length: what the last Extend or Undo left): a field that differs is un-applied
  let appliedLen = len.value, lastTouched = null; const applied = {};
  const FIELDS = [len, ...Object.values(HEAD).map(([input]) => input)];
  const baselineOf = (f) => (f === len ? appliedLen : applied[Object.keys(HEAD).find((k) => HEAD[k][0] === f)]);
  const unapplied = (f) => !!f && FIELDS.includes(f) && !f.disabled && f.value !== baselineOf(f);
  for (const f of FIELDS) { const prev = f.oninput; f.oninput = f.onchange = (e) => { lastTouched = f; return prev ? prev(e) : undefined; }; }
  const onUndoGuard = (e) => {
    const f = [doc.activeElement, lastTouched].find(unapplied);
    if (!f) return;
    f.value = baselineOf(f); lastTouched = null; if (f.oninput) f.oninput();   // the field's own handler refreshes the ghost, the readout and the cup-or-tube rule
    lastTouched = null;
    if (e && e.detail && typeof e.detail.handled === 'function') e.detail.handled();
  };
  doc.addEventListener('t180-undo-guard', onUndoGuard);
  const extendBtn = el('button', { text: 'Extend', title: 'add a piece at the open end; fields left as shown keep going the way the track goes',
    onclick: () => { send('t180-ghost-clear'); extendHere(); }, onmouseenter: ghost, onmouseleave: () => { if (!handlesOn.checked || sculptOn.checked) send('t180-ghost-clear'); } });   // with the drag handles on, the ghost stays up: its handles are what you drag
  // D242 item 6, STRAIGHT IN ONE CLICK (the keeper: "impossible to create a perfect straight"): Extend at turn 0 eases to it over the WHOLE piece unless the turn's
  // "at start" box is ticked. This button extends with turn 0 and climb 0, both reached within the first AT_START_M metres and held there, then puts the boxes back
  // as they were (they are a kept preference, not this button's to change)
  const straightBtn = el('button', { text: 'Straight', title: `a straight piece of the length above: turn 0 and climb 0, reached within its first ${AT_START_M} m and held exactly`, onclick: () => {
    const was = { turn: atStart.turn.checked, climb: atStart.climb.checked };
    turn.value = '0'; climb.value = '0'; atStart.turn.checked = true; atStart.climb.checked = true;
    send('t180-ghost-clear'); extendHere();
    atStart.turn.checked = was.turn; atStart.climb.checked = was.climb;
  } });
  // and the hint when the turn field asks for 0 after a turn without "at start": that eases over the whole piece, so it is not straight until its end
  const straightHint = el('p', { class: 'message', 'aria-label': 'straight hint', style: 'font-size:12px;margin:2px 0' });
  const hintNow = () => { const typed = asTyped('turn'); straightHint.textContent = typed !== '' && Number(typed) === 0 && Number(shown.turn) !== 0 && !atStart.turn.checked ? `turn 0 eases over the whole piece: tick "at start" (or press Straight) to be straight from ${AT_START_M} m on` : ''; };

  // BRUSH
  const mode = el('select', { 'aria-label': 'brush mode' }), channel = el('select', { 'aria-label': 'brush channel' }), radius = num(60, 10, 'brush radius, m');
  const armed = el('input', { type: 'checkbox', 'aria-label': 'brush on' });
  // SHARP (E's opt-in, the chair's ruling 2): its spill is declared right here, in the words of E's own SHARP_NOTE
  const sharp = el('input', { type: 'checkbox', 'aria-label': 'sharp brush', title: 'Sharp brush: acts at exactly the size you set by adding finer control points first. It can nudge the track just outside the brush by up to 0.1 mm. Leave it off for an exactly local edit.' });
  // D244b SCULPT: while it is on, the brush is the value brush on the SHAPE channels only (turn and climb are not offered); the shell refuses anything else by name
  const sculptOn = el('input', { type: 'checkbox', 'aria-label': 'sculpt on', title: 'Sculpt: reshape a piece that is already placed (bank, cup, width, edge, wall rise, tube sweep) without moving the rest of the track. Select ONE piece, then drag its handles or use the brush. Turn and climb are not offered; the centreline is checked on every step' });
  const handlesOn = el('input', { type: 'checkbox', 'aria-label': 'drag handles', title: 'drag handles: marks on the ghost of the piece Extend would add (and on the piece you are sculpting); drag one to change its value, Shift for fine steps, Ctrl to snap to round numbers. Off: the ghost shows only while the pointer is on Extend' });
  handlesOn.checked = true;
  const channelsFor = (m) => (sculptOn.checked ? shell.sculptChannels() : m === 'local' ? ['height', 'lateral'] : ['kv', 'kh', 'phi', 'w', 'r', 'c', 'e', 's', 't']);
  const fillChannels = () => { channel.replaceChildren(...channelsFor(mode.value).map((c) => new win.Option(CHANNEL_NAMES[c], c))); };
  mode.replaceChildren(...shell.brushModes().map((m) => new win.Option(m === 'local' ? 'height / sideways (local)' : 'rate (one channel)', m)));
  mode.onchange = fillChannels; fillChannels();
  const stage = doc.getElementById('preview');
  let drag = null;
  const rel = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const down = (e) => {
    if (!armed.checked || e.button !== 0) return;
    const [x, y] = rel(e); let hit = null; send('t180-pick', { x, y, reply: (h) => { hit = h; } });
    if (!hit) return;
    shell.beginBrush({ mode: mode.value, channel: channel.value, s0: hit.s, r: Number(radius.value), sharp: sharp.checked });
    if (!shell.getState().brush) return;
    drag = { y, per: PER_PX[channel.value] }; e.preventDefault();
    if (stage.setPointerCapture && e.pointerId !== undefined) stage.setPointerCapture(e.pointerId);
  };
  // D235 (nothing coalesced the pointer moves: each one ran a whole brush step, and a closed tube's takes seconds, so the moves queued behind it): at most ONE brushTo per
  // animation frame, with the LATEST position; the release applies the last position that is still waiting, then ends the drag.
  let waitingY = null, frame = 0;
  const flush = () => { frame = 0; if (!drag || waitingY === null) return; const y = waitingY; waitingY = null; shell.brushTo((drag.y - y) * drag.per); };
  const move = (e) => { if (!drag) return; const [, y] = rel(e); waitingY = y; if (!frame) frame = win.requestAnimationFrame(flush); };
  const up = () => { if (!drag) return; if (frame) { win.cancelAnimationFrame(frame); frame = 0; } if (waitingY !== null) { const y = waitingY; waitingY = null; shell.brushTo((drag.y - y) * drag.per); } drag = null; shell.endBrush(); };
  if (stage) { stage.addEventListener('pointerdown', down); stage.addEventListener('pointermove', move); stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up); }

  // DRAG HANDLES (D244) and SCULPT (D244b). The overlay (app/core/handles.js) asks this host what to draw and what a drag means. EXTEND: the handles are on the ghost of the piece the fields describe, and a
  // drag types its value into the matching field (the field's own handler runs, so the ghost, the readout and the cup-or-tube rule follow; nothing is a document edit until Extend). SCULPT: the handles are on
  // the ONE selected placed piece, and a drag is the shell's sculpt (one undo step, the shape channels only, the centreline guarded).
  const askOf = (name) => { let got = null; doc.dispatchEvent(new win.CustomEvent(name, { detail: { reply: (x) => { got = x; } } })); return got; };
  const HANDLE_FIELD = { length: len, width, bank, cup, turn, climb }, SCULPT_CH = { cup: 'c', width: 'w', bank: 'phi' };   // (not in the order of the Extend options: a mutation harness anchors on that line)
  let triedDoc = null, sinceTry = 0; const RETRY_FRAMES = 30;   // the document the ghost was last asked for on behalf of the handles, and the frames since
  const fieldNum = (f) => { const v = Number(f.value); return f.value !== '' && Number.isFinite(v) ? v : null; };
  const ghostModel = () => {
    const st = shell.getState(), d = st.history.present;
    if (!handlesOn.checked || st.sculpt || d.closed) return null;
    let info = askOf('t180:ghost-request');
    if (info && info.jump) return null;   // the ghost on screen is a JUMP's (the Add-jump control): not Extend's, so no Extend handles on it
    // no ghost: ask for it once per document, and again about every half second (the preview mounts AFTER this panel, so the first ask can go to nobody; a ghost that cannot be built is not rebuilt every frame)
    if (!info) { sinceTry++; if (triedDoc !== d || sinceTry >= RETRY_FRAMES) { triedDoc = d; sinceTry = 0; ghost(); info = askOf('t180:ghost-request'); } }
    if (!info || !info.samples.length) return null;
    const s1 = info.samples[info.samples.length - 1].s; if (!(s1 - info.s0 > 0.5)) return null;
    // the road's half-width at a share of the piece: from the head's width to the field's, read when asked (a press must not see the width of the frame before)
    const half = (f) => { const w1 = fieldNum(width), w0 = d.pieces.length ? (fieldNum({ value: shown.width }) ?? w1) : w1; return ((w0 ?? 0) + ((w1 ?? w0 ?? 0) - (w0 ?? 0)) * f) / 2; };
    const kinds = HD.ORDER.filter((k) => !HANDLE_FIELD[k].disabled && fieldNum(HANDLE_FIELD[k]) !== null);
    const wt = fieldNum(width);   // the width mark sits at the TARGET width (the field), so it follows the drag from the near end
    return { mode: 'extend', samples: info.samples, s0: info.s0, s1, half, halfTarget: wt === null ? undefined : wt / 2, kinds, base: (k) => fieldNum(HANDLE_FIELD[k]), ctx: (k) => ({ half: half(HD.KINDS[k].at) }) };
  };
  let sculptSamples = null;   // the selected piece's samples, kept for the track they came from
  const sculptModel = () => {
    const st = shell.getState(); if (!st.sculpt) return null;
    const si = shell.sculptInfo(), tr = si ? askOf('t180:track-request') : null; if (!si || !tr || !tr.path || !Array.isArray(tr.segments)) return null;
    if (!sculptSamples || sculptSamples.tr !== tr.path || sculptSamples.id !== si.id) sculptSamples = { tr: tr.path, id: si.id, list: tr.path.samples.filter((m) => tr.segments[m.seg] && tr.segments[m.seg].id === si.id) };
    const list = sculptSamples.list; if (list.length < 2) return null;
    const kinds = ['bank', 'width'].concat(si.hasCup ? ['cup'] : []), valueOf = { bank: si.values.phi, width: si.values.w, cup: si.values.c };
    return { mode: 'sculpt', info: si, samples: list, s0: list[0].s, s1: list[list.length - 1].s, half: (f) => si.halfAt(f), at: { width: 1 }, kinds, base: (k) => valueOf[k], ctx: (k) => ({ half: si.halfAt(HD.KINDS[k].at) }) };
  };
  let sculptDrag = null;
  const handlesHost = {
    model: () => sculptModel() || ghostModel(),
    pose: () => { const v = askOf('t180:view'); return v ? v.pose : null; },
    begin: (h) => { const m = sculptModel(); if (m) { shell.beginSculpt({ channel: SCULPT_CH[h.kind], piece: m.info.index }); sculptDrag = shell.getState().brush ? { kind: h.kind, base: m.base(h.kind) } : null; } },
    apply: (h, value) => {
      if (sculptDrag) { const delta = value - sculptDrag.base; shell.sculptTo(h.kind === 'bank' ? delta * HD.DEG : delta); return; }
      if (shell.getState().sculpt) return;
      const f = HANDLE_FIELD[h.kind]; f.value = String(value); if (f.oninput) f.oninput();   // typed: the field's own handler follows it
    },
    end: () => { if (sculptDrag) { sculptDrag = null; shell.endSculpt(); } },
  };
  sculptOn.onchange = () => {
    shell.setSculpt(sculptOn.checked);
    if (sculptOn.checked) { send('t180-ghost-clear'); mode.value = 'rate'; mode.disabled = true; } else { mode.disabled = false; triedDoc = null; }
    fillChannels();
  };
  handlesOn.onchange = () => { triedDoc = null; if (!handlesOn.checked && !sculptOn.checked) send('t180-ghost-clear'); };

  // JUMP AT THE HEAD (D243 item 1; the core is src/core/jump.js). GAP, DROP (+ down) and LANDING angle go to the shell's addJump, which refuses by name in plain words; the next Extend lays the road the car lands on.
  // While the fields are used (or the button is hovered) the preview shows the jump as a ghost with the flight as a dashed arc (app/core/flightlayer.js), and the words below say WHICH arc it is (the car's
  // ballistic flight at the design speed, or a straight line where the core has no flight model) and the speed the landing ramp is sized for (fixed at 460 km/h today).
  const jgap = num(20, 5, 'metres the car flies along the ground, measured from the take-off lip (more than 0). 20 m: both measured falls clear it at 460 km/h even off a flat take-off'), jdrop = num(1, 1, 'metres the landing lip is BELOW the take-off lip (+ = down)'),
    jland = num(-2, 1, 'pitch of the landing ramp in degrees (negative slopes down: the usual landing)');
  const jumpNote = el('div', { 'aria-label': 'jump flight', style: 'font-size:12px;margin:2px 0;color:#aab2c0' });
  const jumpOpts = () => ({ gap: jgap.value, drop: jdrop.value, landDeg: jland.value });
  const sayJump = (...lines) => jumpNote.replaceChildren(...lines.filter(Boolean).map((t) => el('p', { text: t, style: 'margin:2px 0' })));
  const jumpHint = () => sayJump('Add jump takes off from the end of the road (set its climb with the fields above first); then press Extend to lay the road the car lands on.', `The landing ramp is sized for ${Math.round(JW.DESIGN_KMH)} km/h, fixed today.`);
  const jumpGhost = () => {
    let why = null;
    try { send('t180-ghost', { candidate: shell.candidateJump(jumpOpts()), reply: (r) => { if (r && r.error) why = r.error; } }); } catch (e) { why = e && e.name === 'CoreError' ? JW.jumpWords(e, jumpOpts()) : String(e && e.message || e); }
    if (why) { send('t180-ghost-clear'); sayJump(`No preview of this jump: ${why}`); return; }
    const g = askOf('t180:ghost-request'), fl = g && g.jump ? JW.flightsOfPath({ samples: g.samples }, g.segments) : [], f = fl[fl.length - 1], w = f ? JW.describe(f) : null, sp = shell.getState().designSpeedKmh;
    sayJump(...(w ? [w.drew, ...w.lines, w.speed] : [`The landing ramp is sized for ${Math.round(JW.DESIGN_KMH)} km/h, fixed today.`]), Number.isFinite(sp) && sp > 0 ? (Math.round(sp) !== Math.round(JW.DESIGN_KMH) ? `Validation is using ${Math.round(sp)} km/h, so the jump can be listed there even though the ramp is sized for ${Math.round(JW.DESIGN_KMH)}.` : null)
      : `Validation checks at full speed (${Math.round(JW.FULL_KMH)} km/h on an open track, the ghost lap on a closed one), so this jump may be listed as a warning even though its ramp is sized for ${Math.round(JW.DESIGN_KMH)} km/h.`);   // D256: no speed box; a host may still pin one (shell.setDesignSpeed)
  };
  for (const f of [jgap, jdrop, jland]) f.oninput = f.onchange = jumpGhost;
  const jumpBtn = el('button', { text: 'Add jump', title: 'add a jump at the end of the road: the gap, the drop and the landing angle above. Then Extend lays the road it lands on', onclick: () => { send('t180-ghost-clear'); shell.addJump(jumpOpts()); },
    onmouseenter: jumpGhost, onmouseleave: () => send('t180-ghost-clear') });
  let jumpNoteFor = shell.getState().history.present; jumpHint(); const unsubJump = shell.subscribe((st) => { if (st.history.present !== jumpNoteFor) { jumpNoteFor = st.history.present; jumpHint(); } });   // the hint shows from the start, and again on a new document

  // CLOSE, EXAMPLE
  // D242: Close PROPOSES first (the keeper, TEST 1: the one-click close moved every piece, and the lap ran into itself). Only the stretch chosen here moves;
  // the closed track is shown as a ghost with how far each piece moved and an overlap check; Apply commits it (one undo step), Cancel drops it
  const closeHow = el('select', { 'aria-label': 'close using', title: 'which part of the lap the close may move: everything before it stays exactly as it is' });
  for (const [v, t] of [['0.2', 'the last ~20% of the lap'], ['last', 'the last piece only'], ['0.4', 'the last ~40% of the lap'], ['whole', 'the whole lap (moves every piece)']]) closeHow.append(new win.Option(t, v));
  const closeBtn = el('button', { text: 'Close the loop', title: 'shows the closed track first (a ghost, how far each piece moves, any overlap): then Apply or Cancel', onclick: () => {
    const v = closeHow.value; shell.proposeClose(v === 'last' ? { last: true } : v === 'whole' ? { whole: true } : { fraction: Number(v) });
  } });
  const applyBtn = el('button', { text: 'Apply', title: 'close the loop as previewed (one undo step)', onclick: () => shell.applyClose() });
  const cancelBtn = el('button', { text: 'Cancel', title: 'drop the preview: nothing changes', onclick: () => shell.cancelClose() });
  const proposalBox = el('div', { 'aria-label': 'close preview', class: 'head' });
  const focus = (s) => send('t180-camera-focus', { s });   // a click on a place moves the camera there (app/preview/index.js)
  const placeButton = (it, text) => el('button', { text, title: `${it.what}${it.detail ? `: ${it.detail}` : ''}: show it`, class: 'linkish', onclick: () => focus(it.s) });
  // D240 follow-up: the preview shows AT ONCE and its overlap check runs off the thread (shell.proposalCheck(p): 'checking' | 'done' | 'failed'); Apply is off until it is done, and the line says how
  // long it has been going (redrawn twice a second while it runs); Cancel stops it
  let tick = 0;
  const drawProposal = (p) => {
    if (tick) { win.clearTimeout(tick); tick = 0; }
    applyBtn.style.display = cancelBtn.style.display = p ? '' : 'none';
    if (!p) { proposalBox.replaceChildren(); return; }
    const ck = shell.proposalCheck(p);
    applyBtn.disabled = ck.status !== 'done';
    const moved = p.displacement.filter((x) => x.maxM > 1e-3).sort((a, b) => b.maxM - a.maxM), still = p.displacement.length - moved.length;
    const kids = [el('p', { text: p.whole ? 'Preview: the WHOLE lap may move.' : `Preview: only ${p.window.text} may move; everything before it is kept exactly.` }),
      el('p', { text: moved.length ? `Moves: ${moved.slice(0, 8).map((x) => `${x.id} up to ${x.maxM.toFixed(x.maxM < 10 ? 2 : 1)} m`).join(', ')}${moved.length > 8 ? `, and ${moved.length - 8} more` : ''}; ${still} piece${still === 1 ? '' : 's'} stay where they were.` : 'Nothing moves by more than a millimetre.' })];
    if (ck.status !== 'done' && ck.status !== 'failed') {
      kids.push(el('p', { 'aria-label': 'overlap check', text: `Checking the closed track for overlaps… ${Math.floor(ck.elapsedMs / 1000)} s. Apply is off until this finishes; Cancel stops it.` }));
      tick = win.setTimeout(() => { tick = 0; const st = shell.getState(); drawProposal(st.closeProposal && st.closeProposal.base === st.history.present ? st.closeProposal : null); }, 500);
    } else if (ck.status === 'failed') kids.push(el('p', { 'aria-label': 'overlap check', text: `The overlap check could not run: ${ck.error}. Cancel and press Close again.`, style: 'color: var(--bad)' }));
    else {
      kids.push(el('p', { 'aria-label': 'overlap check time', style: 'font-size:12px;color:#aab2c0;margin:2px 0', text: `Checked in ${(ck.elapsedMs / 1000).toFixed(1)} s${ck.timing ? ` (the worker's start ${(ck.timing.loadMs / 1000).toFixed(1)} s, the check itself ${(ck.timing.jobMs / 1000).toFixed(1)} s)` : ''}.` }));
      const groups = RG.groupReds([...ck.result.overlaps, ...ck.result.others], p.resolved.segments);
      if (!groups.length) kids.push(el('p', { 'aria-label': 'overlap check', text: 'No overlap and no red on the closed track.' }));
      for (const g of groups) kids.push(el('p', { text: `${g.key === 'overlap' ? 'The closed track OVERLAPS ITSELF' : g.title} (${RG.placesText(g)}):`, style: 'color: var(--bad)' }), el('div', { class: 'actions' }, ...g.places.slice(0, 24).map((it) => placeButton(it, RG.placeText(it)))));
    }
    proposalBox.replaceChildren(...kids);
  };
  // held to the column's width (a file input is wider than the 280 px column by default, and the column scrolled sideways)
  const fitIn = el('input', { type: 'file', accept: '.json', 'aria-label': 'the fit, *.pieces.json', style: 'max-width: 100%; min-width: 0' }), readIn = el('input', { type: 'file', accept: '.json', 'aria-label': 'the read, *.read.json', style: 'max-width: 100%; min-width: 0' });
  const readText = (inp) => (inp.files && inp.files[0] ? inp.files[0].text() : Promise.reject(new Error('pick both files')));
  const openEx = el('button', { text: 'Open example', onclick: async () => {
    try { const [f, r] = await Promise.all([readText(fitIn), readText(readIn)]); shell.openExample(f, r, fitIn.files[0].name.replace(/\.pieces\.json$/i, '') + ' (local)'); } catch (e) { msg.textContent = e.message; msg.className = 'message'; }
  } });

  const msg = el('p', { class: 'message', role: 'status' }), info = el('p', { class: 'head' }), sculptHint = el('p', { class: 'message', 'aria-label': 'sculpt hint', style: 'font-size:12px;margin:2px 0' });
  const pieces = PU.mount({ root, stage, shell, win, el, armed: () => armed.checked, send });   // D240 (the selection's clicks are the brush's while the brush is armed)
  root.replaceChildren(
    el('h3', { text: 'Equation track' }), info,
    el('div', { class: 'actions' }, el('button', { text: 'Undo', title: 'Undo (Ctrl+Z), also from a number field', onclick: () => shell.undo() }), el('button', { text: 'Redo', title: 'Redo (Ctrl+Y or Ctrl+Shift+Z)', onclick: () => shell.redo() })),
    el('h3', { text: 'Extend at the head' }), el('div', { class: 'pickers' }, field('length m', len), fieldAt('turn °/100m', turn, 'turn'), fieldAt('climb °/100m', climb, 'climb'), fieldAt('bank °', bank, 'bank'), fieldAt('cup °', cup, 'cup'), fieldAt('width m', width, 'width'), field('width like…', wlike),
      fieldAt('edge angle °', edge, 'edge'), fieldAt('edge start', start, 'start'), fieldAt('tube sweep °', tube, 'tube'), field('drag handles', handlesOn)),
    wnote, roBox,
    el('div', { class: 'actions' }, extendBtn, straightBtn), straightHint,
    el('div', { class: 'pickers' }, field('jump gap m', jgap), field('drop m (+ down)', jdrop), field('landing °', jland)), el('div', { class: 'actions' }, jumpBtn), jumpNote,
    el('h3', { text: 'Brush (drag on the track)' }), el('div', { class: 'pickers' }, field('sculpt (shape only)', sculptOn)), sculptHint, el('div', { class: 'pickers' }, field('on', armed), field('mode', mode), field('what', channel), field('radius m', radius), field('sharp (may nudge ≤ 0.1 mm outside)', sharp)),
    el('h3', { text: 'Close' }), el('div', { class: 'pickers' }, field('using', closeHow)), el('div', { class: 'actions' }, closeBtn, applyBtn, cancelBtn), proposalBox,
    ...pieces.nodes.selection, ...pieces.nodes.library,
    el('h3', { text: 'Local example' }), el('div', { class: 'pickers' }, field('fit', fitIn), field('read', readIn)), el('div', { class: 'actions' }, openEx),
    msg,
  );
  let shownFor = null;
  const draw = (st) => {
    const d = st.history.present, L = st.resolved.segments.reduce((a, g) => a + g.length, 0);
    if (d !== shownFor) {   // a new document (Extend, Undo, Redo, open, a brush): the fields show its head, and an UNDONE Extend's own values (item 7)
      const m = shownFor ? madeWith.get(shownFor) : null, undone = !!m && m.before === d;   // only an Undo steps from a document back to the one it was made from
      showHead(); if (undone) putBack(m.made); for (const k of Object.keys(HEAD)) applied[k] = HEAD[k][0].value; shownFor = d;
    }
    info.textContent = `${d.pieces.length} piece${d.pieces.length === 1 ? '' : 's'} · ${Math.round(L).toLocaleString('en-US')} m · ${d.closed ? 'closed loop' : 'open'}${st.lastStep ? ` · last ${st.lastStep.op} ${st.lastStep.ms.toFixed(0)} ms` : ''}`;
    extendBtn.disabled = !!d.closed; closeBtn.disabled = closeHow.disabled = !!d.closed || !d.pieces.length;
    drawProposal(st.closeProposal && st.closeProposal.base === d ? st.closeProposal : null);
    msg.textContent = st.message || ''; msg.className = st.messageKind === 'ok' ? 'message ok' : 'message';
    readout();   // the track changed, so the piece the fields would add changed
    hintNow();
    // D244b: the Sculpt switch follows the shell, and says what to do next
    sculptOn.checked = !!st.sculpt;
    const si = st.sculpt ? shell.sculptInfo() : null;
    sculptHint.textContent = !st.sculpt ? '' : si ? `Sculpting ${si.id}: drag its handles (bank, width${si.hasCup ? ', cup' : ''}) or use the brush; one drag is one undo step. The route never moves.` : 'Select ONE piece: click it on the track. Only its shape (bank, cup, width, edge, wall rise, tube sweep) can change; turn and climb are not offered, and the centreline is checked on every step.';
  };
  // the labels on the track: a DOM layer over the preview (app/core/labels.js); none when there is no preview to lay them on
  const labels = stage ? LB.mount(stage, shell, win) : null;
  const handles = stage ? HD.mount(stage, win, handlesHost) : null;   // D244: the drag handles' overlay
  const flights = stage ? FL.mount(stage, win) : null;   // D243: the flights as dashed arcs
  // 't180:handles-request' { detail: { reply(list) } }: where the handles are on screen now ([{ id, kind, side, x, y, dx, dy }], css px of the preview), read only, for the window proof as the other requests are
  const onHandlesRequest = (e) => { if (e.detail && typeof e.detail.reply === 'function') e.detail.reply(handles ? handles.handles().filter((h) => h.screen).map((h) => ({ id: h.id, kind: h.kind, side: h.side, x: h.screen.x, y: h.screen.y, dx: h.screen.dx, dy: h.screen.dy })) : []); };
  doc.addEventListener('t180:handles-request', onHandlesRequest);
  const unsub = shell.subscribe(draw); draw(shell.getState());
  // options(): the options Extend, the ghost and the readout use right now (fields left as shown send no target)
  return { labels, handles, flights, pieces, options: opts, unmount() { unsub(); unsubJump(); if (flights) flights.unmount(); doc.removeEventListener('t180:handles-request', onHandlesRequest); if (handles) handles.unmount(); doc.removeEventListener('t180-undo-guard', onUndoGuard); pieces.unmount(); if (tick) win.clearTimeout(tick); if (frame) win.cancelAnimationFrame(frame); if (labels) labels.unmount(); if (stage) { stage.removeEventListener('pointerdown', down); stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); stage.removeEventListener('pointercancel', up); } root.replaceChildren(); } };
}

module.exports = { mount, extendOptions, PER_PX };
