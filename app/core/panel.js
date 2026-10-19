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
const XS = require('./xsec.js');   // the cross-section channels (D225): edge angle, edge start, tube sweep
const PU = require('./piecesui.js');   // D240: saved pieces: select on the track, Save as piece, the library, a previewed middle delete
const HD = require('./handles.js');   // D244: the drag handles on the Extend ghost, and (Sculpt, D244b) on a placed piece
const JW = require('./jumpwords.js');   // the core's jump refusals in plain words
const LD = require('./landing.js');
const GL = require('./griplike.js');   // D261: the grip field's checks and words, the "grip like…" entries
const GR = require('./griplayer.js');   // D261: the track coloured by grip
// (the start line, the grid pack and the hotlap, placed by hand, and the pit lane: app/core/spawnsui.js and pitui.js, mounted by the Track menu since D355)
const SPL = require('./spawnslayer.js');  // the hand-placed start, drawn on the preview
const SPD = require('./spawndrag.js');
const GT = require('../../src/core/gridturn.js');   // 2026-10-12: Turn to grid, and the end heading line    // D285: and dragged there
const VO = require('./valuesoverlay.js');   // D267: the values of the piece being edited, large over the 3D view   // D258: the free jump's landing: where its handles are, and its number boxes
const FL = require('./flightlayer.js');   // D258: the flights drawn as a dashed line across the air

// the change per pixel of vertical drag, in each brush channel's unit (up = more)
// (c, the CUP, is the cross-section's edge angle in DEGREES, 0–150: D190, E's seal row 7)
const PER_PX = Object.freeze({ kh: 2e-5, kv: 2e-5, phi: 0.002, w: 0.05, r: 0.02, c: 0.2, e: 0.2, er: 0.2, s: 0.002, t: 0.5, height: 0.03, lateral: 0.03 });
const CHANNEL_NAMES = Object.freeze({ kh: 'turn rate', kv: 'climb rate', phi: 'bank', w: 'width', r: 'wall rise', c: 'cup', e: 'edge angle', er: 'right edge', s: 'edge start', t: 'tube sweep', height: 'height', lateral: 'sideways' });
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
const FIELD_CHANNEL = Object.freeze({ turn: 'kh', climb: 'kv', bank: 'phi', width: 'w', cup: 'c', edge: XS.CHANNEL.edge, edgeR: 'er', start: XS.CHANNEL.start, tube: XS.CHANNEL.tube });
// THE TURN AS A CORNER (D331 B; the keeper, 2026-10-15: turns should "convey the proper degrees to line up with the grid", banked or not). turnAs 'corner' (the
// panel's default) reads the turn field as the piece's exact heading change in degrees, ending straight: `turnDeg`, which src/core/turnby.js extendCorner places
// with Turn by's symmetric ease (so it has no "at start" ramp of its own). A typed 0 still eases to a rate of 0, because a "corner of 0°" after a road still
// turning would bend back the other way. turnAs 'rate' (and this function's default, for its other callers) is the old meaning: degrees per 100 m, a target rate.
// The CLIMB the same way, on the same switch (the keeper: "the climb might need to do the same?"; plan :387-399): as a corner it is `climbDeg`, the exact pitch
// change, ending at a climb rate of 0 (a steady pitch, level only when it ends at pitch 0).
function extendOptions({ length, turn, climb, bank, width, cup, edge, edgeR, start, tube, grip, empty = false, atStart = {}, turnAs = 'rate' }) {
  const targets = {}, num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  const t = num(turn), c = num(climb), b = num(bank), w = num(width), k = num(cup), corner = turnAs === 'corner' && t !== null && t !== 0, climbCorner = turnAs === 'corner' && c !== null && c !== 0;
  if (turnAs !== 'rate' && turnAs !== 'corner') throw new Error(`BAD_TURN_AS: the turn is read as 'rate' or 'corner', got ${turnAs}`);
  if (t !== null && !corner) targets.kh = t * DEG / 100;          // degrees of heading per 100 m
  if (c !== null && !climbCorner) targets.kv = c * DEG / 100;          // degrees of pitch per 100 m
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
  const er = num(edgeR); if (er !== null) targets.er = er;   // the RIGHT edge (2026-10-12): blank follows the edge angle, so a typed one splits the sides (src/core/extend.js); the panel's opts sends it with a left typed alone (D385)
  if (sl !== null) targets[XS.CHANNEL.start] = sl;
  if (tb !== null) targets[XS.CHANNEL.tube] = tb;
  const out = { length: Number(length), targets };
  if (corner) out.turnDeg = t;
  if (climbCorner) out.climbDeg = c;   // D331, the climb too (plan :387-399): the exact pitch change, ending at a climb rate of 0
  if (num(grip) !== null) out.grip = num(grip);   // D261: a grip typed in the field (blank: the new piece keeps the last road's); the core refuses a value that is not a whole percent 50 to 150
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
/**
 * D331: the corner cell. "+90.00° · ends turning at +171.37°/100 m · turn 0 at start adds +9.64°": the turn since the road was last straight, then whether
 * this piece ends turning (and at what rate), then what easing it out would add (src/core/readout.js corner, cornerNext). "none (straight)" when the
 * piece is in no corner; — when the core does not report one.
 */
function fmtCorner(r, n) {
  if (!('corner' in r)) return '—';
  if (!r.corner) return 'none (straight)';
  const c = r.corner, parts = [LB.fmtDeg(c.turnDeg)];
  parts.push(c.endsTurningDegPer100m === null ? 'ends straight' : `ends turning at ${LB.fmtDeg(c.endsTurningDegPer100m)}/100 m`);
  if (n && n.nextFrom === 'turn 0 at start') parts.push(`turn 0 at start adds ${LB.fmtDeg(n.nextAddsDeg)}`);
  else if (n && n.nextFrom === 'next piece') parts.push(`the next piece adds ${LB.fmtDeg(n.nextAddsDeg)}`);
  else if (n) parts.push('the corner goes on');
  return parts.join(' · ');
}
/** D331, the climb too: the climb corner's cell, "+12.00° · ends climbing at +1.72°/100 m" or "… · ends at a steady pitch", or "none (steady pitch)". */
function fmtClimbCorner(r) {
  if (!('climbCorner' in r)) return '—';
  if (!r.climbCorner) return 'none (steady pitch)';
  const c = r.climbCorner;
  return [LB.fmtDeg(c.climbDeg), c.endsClimbingDegPer100m === null ? 'ends at a steady pitch' : `ends climbing at ${LB.fmtDeg(c.endsClimbingDegPer100m)}/100 m`].join(' · ');
}
/** "from → to" for a pair of readout values, or — when the core does not report them (a core without the channel) */
const pairOf = (r, [from, to], fmt) => (Number.isFinite(r[from]) && Number.isFinite(r[to]) ? `${fmt(r[from])} → ${fmt(r[to])}` : '—');

// THE SETTINGS (D355, contract S: app/settings.js, pane B's: get(key, fallback), set(key, value), on(key, fn)). The panel starts its switches from S and follows S.on; the
// Settings and View menus are where they are changed now, so the panel's own (held) copies of those switches never write S back; the two writes it does make (D356)
// are the grid step picked in Build ▸ Turn to grid… and the turn-and-climb mode an Undo gives back. Until app/settings.js is in this tree
// the settings hold for the session only, which is what S itself does on a blocked store.
function sessionSettings() {
  const m = new Map(), fns = new Map();
  return { get: (k, f) => (m.has(k) ? m.get(k) : f), set: (k, v) => { m.set(k, v); for (const fn of fns.get(k) || []) fn(v); },
    on: (k, fn) => { fns.set(k, [...(fns.get(k) || []), fn]); return () => fns.set(k, (fns.get(k) || []).filter((g) => g !== fn)); } };
}
function settingsOf() {
  try { return require('../settings.js'); } catch (e) { if (!/settings\.js/.test(String(e && e.message))) throw e; return sessionSettings(); }   // only ITS absence: a settings.js that fails is a failure
}
const asBool = (v, d) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : d);

function mount(root, shell, mountOpts = {}) {
  const S = (mountOpts && mountOpts.settings) || settingsOf();
  const doc = root.ownerDocument, win = doc.defaultView;
  const el = (tag, attrs = {}, ...kids) => { const e = doc.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e[k] = v; else e.setAttribute(k, v); } e.append(...kids); return e; };
  const field = (label, input) => el('label', { class: 'picker' }, el('span', { text: label }), input);
  // a channel field with its "at start" box after the input (D194b); the input stays the label's second child
  const fieldAt = (label, input, k) => el('label', { class: 'picker' }, typeof label === 'string' ? el('span', { text: label }) : label, input, el('span', { class: 'at-start', style: 'white-space:nowrap;font-size:12px', title: atStart[k].getAttribute ? atStart[k].getAttribute('title') : '' }, atStart[k], el('span', { text: ' at start' })));
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
  // D385 (the keeper, 2026-10-18: "there is the right edge but not the left edge tweak"): the LEFT and the RIGHT edge, each its own side. Each shows its side at the
  // head; typing one changes only that side (opts below sends the other side's head value with it, since the core sets both from e alone: src/core/extend.js :83-86)
  const edge = el('input', { type: 'number', value: '', step: '1', min: '0', title: 'left edge: how many degrees MORE the LEFT side\'s very edge tilts than the plain profile would, rising smoothly from the edge start out; 0 = off. Bank still rolls the whole section. Shows the left edge at the head; left as shown, it keeps it; typed, only the left side changes' }),
    // the keeper, 2026-10-12: bank the outside of a turn harder and turn the inside down, so the inside line is not banked
    edgeR = el('input', { type: 'number', value: '', step: '1', min: '0', title: 'right edge: how many degrees MORE the RIGHT side\'s very edge tilts than the plain profile would, like the left edge. Shows the right edge at the head; left as shown, it keeps it; typed, only the right side changes. For a right turn: a big left edge (the outside) and a small right edge (the inside), so the inside line is not banked' }),
    start = el('input', { type: 'number', value: '', step: '0.01', min: '0.5', max: '0.95', title: 'edge start: where the edge curve begins, as a share of the half-width from the centre (0.64 = the outer 36% each side curves more; 0.5 to 0.95). Shows it at the head; left as shown, it keeps it' }),
    tube = el('input', { type: 'number', value: '', step: '1', min: '0', max: '360', title: 'tube sweep: the cross-section as an arc of this many degrees, 0 (none) to 360 (a closed pipe). Shows the sweep at the head; left as shown, it keeps it' });
  // (D385: the right edge is the shell's er; a shell without it, the right follows the left, as the core makes it)
  const HEAD = { turn: [turn, (h) => h.kh * 100 / DEG], climb: [climb, (h) => h.kv * 100 / DEG], bank: [bank, (h) => HD.wrapTurn(h.phi / DEG)], width: [width, (h) => h.w], cup: [cup, (h) => h.c],
    edge: [edge, (h) => h[XS.CHANNEL.edge]], edgeR: [edgeR, (h) => (Number.isFinite(h.er) ? h.er : h[XS.CHANNEL.edge])], start: [start, (h) => h[XS.CHANNEL.start]], tube: [tube, (h) => h[XS.CHANNEL.tube]] };
  // THE WIDTH REFERENCE (D232, the keeper: "a drop down that tells you the width of different known t-180 tracks, such as track H, track N, track G"):
  // picking a known track puts its measured median into the width field, like typing it (so on an empty track it is the first piece's start, which is the
  // new-track default). For a TUBE (the sweep field at 360) the figures are the distance round and the entry says how wide that is across.
  const WL = require('./widthlike.js');
  const wlike = el('select', { 'aria-label': 'width like a known T-180 track', title: 'width like a known T-180 track: the median of what its reads measure (the 10th to 90th percentile in brackets). Picking one sets the width field' });
  const wnote = el('p', { class: 'message', 'aria-label': 'what the width means for a tube', style: 'font-size:12px;margin:2px 0' });
  const widthTitle = width.getAttribute('title');
  const showTubeNote = () => { const t = WL.isTube(tube.value); wnote.textContent = t ? WL.tubeNote(width.value) : ''; const tip = t ? `${widthTitle} ${WL.tubeTip(width.value)}` : widthTitle; width.setAttribute('title', tip); wnote.setAttribute('title', t ? WL.tubeTip(width.value) : ''); };   // D267: the explanation is the tooltip
  const fillWidthLike = () => {
    const tubeNow = WL.isTube(tube.value);
    wlike.replaceChildren(...WL.entries(tubeNow).map((e) => new win.Option(e.label, e.value))); wlike.value = '';
    showTubeNote();
  };
  const shown = {};
  const show = (x) => { const v = Math.round(x * 100) / 100; return String(Object.is(v, -0) ? 0 : v); };   // two decimals, no trailing zeros, no "-0"
  // THE TURN AS A CORNER (D331 B, the default; extendOptions above). As a corner the turn field holds the degrees the new piece turns and shows nothing at the
  // head (a corner has no "value at the head": left blank, the track keeps turning as now); as a rate it is the old field, the head's turn in °/100 m. The switch
  // is kept from piece to piece, like the "at start" boxes. The CLIMB field follows the same switch (plan :387-399): as a corner, the degrees the pitch changes
  const turnAs = el('select', { 'aria-label': 'turn and climb as', title: 'how the turn and climb fields are read: as a CORNER, the exact degrees the piece turns on the map (90 lines up with the grid, banked or flat) and the exact degrees its pitch changes, easing in and out and ending at a rate of 0; as a RATE, degrees per 100 m the piece eases to (it ends still turning, or still climbing, at that rate)' });
  turnAs.replaceChildren(new win.Option('corner °, ends straight', 'corner'), new win.Option('rate °/100 m', 'rate')); turnAs.value = 'corner';
  const cornerMode = () => turnAs.value === 'corner';
  const TURN_TITLE = { corner: 'the degrees this piece turns on the map, + = left: exact, easing in and out, ending straight (0 eases to straight). Blank: the track keeps turning as now', rate: turn.getAttribute('title') };
  const CLIMB_TITLE = { corner: 'the degrees this piece changes the pitch, + = up: exact, easing in and out, ending at a climb rate of 0, so a steady pitch (0 eases to a steady pitch). Blank: the track keeps climbing as now', rate: climb.getAttribute('title') };
  const showTurnHead = (h) => {
    for (const [k, f, lab, unit, title] of [['turn', turn, turnLabel, 'turn', TURN_TITLE], ['climb', climb, climbLabel, 'climb', CLIMB_TITLE]]) {
      shown[k] = cornerMode() ? '' : show(HEAD[k][1](h)); f.value = shown[k]; lab.textContent = cornerMode() ? `${unit} °` : `${unit} °/100m`; f.setAttribute('title', title[turnAs.value]);
    }
  };
  const showHead = () => { const h = shell.headState(); for (const [k, [input, of]] of Object.entries(HEAD)) { shown[k] = show(of(h)); input.value = shown[k]; } showTurnHead(h); for (const [k, f] of [['cup', cup], ['tube', tube]]) { f.disabled = false; f.setAttribute('title', baseTitle[k]); } fillWidthLike(); };   // (baseTitle is set below, before the first draw)
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
  // D259 (the keeper, 18:21-18:24: the bank "continues after 360 forever instead of resetting back to 0 ... same for -360 if it banks the other way"). The bank keeps
  // within ONE turn and keeps its sign, shown AND applied (HD.wrapTurn: 370 -> 10, -370 -> -10, 300 stays 300, 400 -> 40): the field shows it (HEAD above), a drag
  // writes it, and a typed value is sent wrapped and otherwise as typed (absolute, as the core keeps its winding; extendOptions unchanged). No nearest-equivalent rewrite.
  const bankTarget = () => { const t = asTyped('bank'); if (t === '') return t; const T = Number(t); return Number.isFinite(T) ? String(HD.wrapTurn(T)) : t; };
  // "at start" (D194b): one small box per field, off by default (off = ease to the value over the whole piece, as always). It is kept from
  // piece to piece, like a preference; it does nothing for a field left as shown, which has no target
  const atStart = Object.fromEntries(Object.keys(HEAD).map((k) => [k, el('input', { type: 'checkbox', 'aria-label': `${k} at the start`,
    title: `at start: reach this ${k} within the first ${AT_START_M} m of the piece and hold it (off: ease to it over the whole piece)` })]));
  // the turn field's label says which way it is read (D331 B); switching puts the field back to what it shows, so nothing typed in the other unit is applied
  const turnLabel = el('span', { text: 'turn °' }), turnField = fieldAt(turnLabel, turn, 'turn'), climbLabel = el('span', { text: 'climb °' }), climbField = fieldAt(climbLabel, climb, 'climb');
  turnAs.onchange = () => { showTurnHead(shell.headState()); applied.turn = turn.value; applied.climb = climb.value; ghost(); };
  // GRIP (D261, the keeper: a different grip per piece; the core is src/core/document.js, E's). A whole percent 50 to 150 (100 is AC's own road), shown as the head's; left as shown the new piece keeps it, a changed
  // value is the new piece's grip. "grip like…" fills it from a known track (src/doc/grips.json). The words say what the number is, "untested: drive it" outside 60 to 110, and that the checker does not model grip.
  const gripF = el('input', { type: 'number', value: '100', step: '1', min: String(GL.GRIP_MIN), max: String(GL.GRIP_MAX), 'aria-label': 'grip', title: GL.tip() });
  const gripLike = el('select', { 'aria-label': 'grip like known track', title: 'grip like a known track: the measured road friction of installed tracks; picking one fills the grip box' });
  gripLike.replaceChildren(...GL.entries().map((e) => new win.Option(e.label, e.value)));
  const gripNote = el('p', { class: 'message', 'aria-label': 'what the grip means', style: 'font-size:12px;margin:2px 0' });
  let shownGrip = '100';
  const showGrip = () => { shownGrip = String(shell.headGrip()); gripF.value = shownGrip; gripNote.textContent = GL.note(shownGrip); };
  const gripOpt = () => (gripF.value === '' || gripF.value === shownGrip ? '' : gripF.value);   // untouched = blank = the new piece keeps the head's grip
  const colourOn = el('input', { type: 'checkbox', 'aria-label': 'colour by grip', title: 'colour the track by grip: blue below 100%, white at 100%, orange above; the hover label says each piece\'s grip' });
  // D385: typing ONE side changes only that side: the left typed alone sends the right as the head has it (the core would otherwise set both from e)
  const rightTarget = () => { const r = asTyped('edgeR'); return r !== '' || asTyped('edge') === '' ? r : String(HEAD.edgeR[1](shell.headState())); };
  const opts = () => extendOptions({ grip: gripOpt(), length: len.value, turn: asTyped('turn'), climb: asTyped('climb'), bank: bankTarget(), width: asTyped('width'), cup: asTyped('cup'), edge: asTyped('edge'), edgeR: rightTarget(), start: asTyped('start'), tube: asTyped('tube'),
    atStart: Object.fromEntries(Object.entries(atStart).map(([k, box]) => [k, box.checked])),
    empty: !shell.getState().history.present.pieces.length, turnAs: turnAs.value });
  // D242 item 7 (the keeper, 09:03): UNDO GIVES BACK THE UNDONE PIECE'S VALUES. Each Extend from this panel remembers the fields it was made with, keyed by the
  // document it made; when Undo steps from that document back to the one it was made from, the fields are put back (the length, every field as typed or left as
  // shown, the at-start ticks), so Extend again rebuilds the same piece. Redo, a brush and open show the head, as before
  const madeWith = new WeakMap();
  const fieldsNow = () => ({ len: len.value, values: Object.fromEntries(Object.keys(HEAD).map((k) => [k, HEAD[k][0].value])), ticks: Object.fromEntries(Object.entries(atStart).map(([k, b]) => [k, b.checked])), turnAs: turnAs.value });
  // D385 (the keeper, 2026-10-18: a piece after a turn goes straight "because the pieces dont retain the same values"): AS CORNERS, after an Extend the turn and climb fields
  // KEEP the degrees typed for the piece just placed (the new document's draw has just shown the head, blank), so Extend again places the same corner, each ending straight.
  // A blank or a typed 0 is not carried (the field stays blank, as before). Only Extend carries (and Straight, whose 0 never is): Jump, Level, To floor, Turn by, Turn to grid
  // and Sharp show the head as before
  const carryCorner = (made) => {
    if (!cornerMode() || made.turnAs !== 'corner') return;
    let any = false;
    for (const [k, f] of [['turn', turn], ['climb', climb]]) { const v = made.values[k]; if (v === '' || !Number.isFinite(Number(v)) || Number(v) === 0) continue; f.value = applied[k] = v; any = true; }
    if (any) { readout(); hintNow(); }
  };
  const extendHere = () => { const before = shell.getState().history.present, made = fieldsNow(); shell.extend(opts()); appliedLen = len.value; const after = shell.getState().history.present; if (after !== before) { madeWith.set(after, { before, made }); carryCorner(made); } };
  // D356 (E's review 5, row 2): the mode Undo gives back is saved through S too, or the hidden box and the Settings menu would read two different modes
  const putBack = (m) => { if (m.turnAs && m.turnAs !== turnAs.value) { turnAs.value = m.turnAs; showTurnHead(shell.headState()); S.set('turnClimbAs', m.turnAs); } len.value = appliedLen = m.len; for (const k of Object.keys(HEAD)) HEAD[k][0].value = m.values[k]; for (const [k, b] of Object.entries(atStart)) b.checked = !!m.ticks[k]; if (cup.value !== shown.cup) exclusive(cup); else if (tube.value !== shown.tube) exclusive(tube); };
  // the ghost: a candidate the shell cannot build, or the preview cannot draw, says why (it used to vanish without a word)
  // THE READOUT of the piece the fields describe: 16 px bold rows, so its ink is at least 11 device px tall (E's M5 (d))
  // cup reads from → to: the DOCUMENT's values (A's cupFromDeg / cupToDeg, which for a legacy piece are its rendered edge), never
  // the typed target, which the core's fit may ring past and its guard may refuse (E's seal row 7)
  let values = null;   // D267: the values of the piece being edited, large over the 3D view (app/core/valuesoverlay.js); mounted where the stage is found, below
  // D331 (ledger D332): 'corner' (the turn since the road was last straight; whether this piece ends turning, and what easing it out would then add) and
  // 'gravity' (the bank against gravity, from → to: the road's real tilt, where the bank field reads in the flipped form past an inversion)
  const RO = ['length', 'turn', 'climb', 'bank', 'cup', 'edge', 'start', 'tube', 'corner', 'climbCorner', 'gravity'], roCells = Object.fromEntries(RO.map((k) => [k, el('span', { 'data-readout': k })]));
  const roName = (k) => (k === 'length' ? 'length' : k === 'cup' ? 'cup from → to' : k === 'edge' ? 'edge from → to' : k === 'start' ? 'edge start from → to' : k === 'tube' ? 'tube from → to'
    : k === 'corner' ? 'corner' : k === 'climbCorner' ? 'climb corner' : k === 'gravity' ? 'bank to gravity from → to' : `${k} change`);
  const roBox = el('div', { class: 'readout', 'aria-label': 'the piece Extend would add', style: 'display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:8px 0;font:bold 16px/1.3 system-ui,"Segoe UI",sans-serif;color:var(--on-ink, #eef1f6)' },
    ...RO.flatMap((k) => [el('span', { text: roName(k), style: 'color:var(--dim);font-weight:600' }), roCells[k]]));
  const readout = () => {
    let f = null, why = '';
    try {
      if (shell.getState().history.present.closed) why = 'the loop is closed';
      else { const r = shell.candidateReadout(opts()); f = { ...LB.formatReadout(r), cup: `${fmtCup(r.cupFromDeg)} → ${fmtCup(r.cupToDeg)}`,
        // the cross-section cells read the DOCUMENT (the core's readout), never the typed field (E's seal E7, KE7-1)
        edge: pairOf(r, XS.READOUT.edge, fmtCup), start: pairOf(r, XS.READOUT.start, fmtShare), tube: pairOf(r, XS.READOUT.tube, fmtCup),
        climbCorner: fmtClimbCorner(r), corner: fmtCorner(r, 'corner' in r && r.corner && r.corner.endsTurningDegPer100m !== null ? shell.candidateCorner(opts()) : null), gravity: pairOf(r, ['gravityBankFromDeg', 'gravityBankToDeg'], LB.fmtDeg) }; }
    } catch (e) { why = e.message; }
    for (const k of RO) roCells[k].textContent = f ? f[k] : '—';
    if (values) values.set(f ? VO.entries(f, Number.isFinite(Number(width.value)) && width.value !== '' ? `${Number(width.value).toFixed(2)} m` : '') : null);   // D267: the same numbers, large over the 3D view
    roBox.title = why;
  };
  let scrubbing = false;   // D266 item 2: an Extend handle is being dragged: the ghost is built CHEAP until the release (handlesHost.end builds the full one)
  let scrubKind = null;    // which handle (2026-10-14: a LENGTH drag previews whole 2 m chords, below)
  // A PIECE IS CUT INTO EQUAL CHORDS of about 2 m (src/core/adapter.js), so a length of 1103.7 m makes every chord 1.99946 m and every one changes on the next move:
  // nothing of the last cheap ghost could be reused (app/preview/trackmodel.js). While the LENGTH handle is dragged the preview is built at the nearest whole 2 m,
  // so the chords stay 2 m and only the end is new. The field, the readout and the piece placed keep the exact value; the release builds the exact ghost.
  const previewLength = (o) => (scrubbing && scrubKind === 'length' && o.length > 2 ? { ...o, length: Math.round(o.length / 2) * 2 } : o);
  const ghost = () => {
    hintNow();   // D242: the straight hint follows the turn field and its box
    readout();   // first, and synchronously: the numbers follow the fields with no timer and no frame wait
    let why = null;
    try { send('t180-ghost', { candidate: shell.candidate(previewLength(opts()), { coarse: scrubbing }), cheap: scrubbing, reply: (r) => { if (r && r.error) why = r.error; } }); } catch (e) { why = e.message; }
    if (why) { send('t180-ghost-clear'); msg.textContent = `no preview of this piece: ${why}`; msg.className = 'message'; }
  };
  // the ghost follows the fields as they change, not only a fresh hover (a pointer resting on the button fires no new mouseenter,
  // so the ghost showed the piece before the last edit, or none: found in the window proof, D186)
  // (the cup's handler is the cup-or-tube one below, D225: the cup is not in this list, where its handler would only be replaced)
  for (const f of [len, turn, climb, bank, width, ...Object.values(atStart)]) f.oninput = f.onchange = ghost;
  for (const f of [edge, edgeR, start, tube]) f.oninput = f.onchange = ghost;   // the cross-section fields follow the same way (D225)
  for (const f of [cup, tube]) f.oninput = f.onchange = () => { exclusive(f); ghost(); };   // cup OR tube: the rule first, then the ghost
  tube.oninput = tube.onchange = () => { exclusive(tube); ghost(); fillWidthLike(); };   // a tube's entries read round and across (D232)
  width.oninput = width.onchange = () => { ghost(); showTubeNote(); };
  wlike.onchange = () => { if (!wlike.value) return; width.value = wlike.value; wlike.value = ''; width.oninput(); };
  gripF.oninput = gripF.onchange = () => { gripNote.textContent = GL.note(gripF.value); ghost(); };
  gripLike.onchange = () => { if (!gripLike.value) return; gripF.value = gripLike.value; gripLike.value = ''; gripF.oninput(); };   // a pick is a typed grip: the words, the ghost and the readout follow   // a pick is a typed width: the ghost and the readout follow
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
  // D271, LEVEL and TO FLOOR (the keeper: "a way to snap the track to the floor to be true flat … its hard to calculate by hand"): the climb is a RATE, so climb 0 keeps
  // the slope the road has. These extend with the fields' piece and let the core solve its climb (src/core/level.js): Level ends it straight and level, To floor
  // also at height 0; a piece too short for that is refused by name with the length that works (the message line says it)
  const levelHere = (fn) => { const before = shell.getState().history.present, made = fieldsNow(); send('t180-ghost-clear'); shell[fn](opts()); appliedLen = len.value; const after = shell.getState().history.present; if (after !== before) madeWith.set(after, { before, made }); };
  const levelBtn = el('button', { text: 'Level', title: 'a piece of the length above that ends straight and LEVEL (pitch 0): its climb is solved for you', onclick: () => levelHere('extendLevel') });
  const floorBtn = el('button', { text: 'To floor', title: 'a piece of the length above that ends straight, level and ON THE FLOOR (height 0): too short a piece is refused with the length that works', onclick: () => levelHere('extendToFloor') });
  // D280, TURN BY (the keeper: "90 degree turns not coming out straight"): the turn field is a RATE, and a piece eased to a rate ENDS at it, so the next piece
  // starts still turning. This extends with the fields' piece and lets the core solve its turn (src/core/turnby.js): exactly the angle typed beside it, ending
  // with turn rate 0; too short a piece is refused by name with the length that works
  const turnBy = num(90, 1, 'the angle the piece turns, degrees (+ = left, − = right)'); turnBy.oninput = turnBy.onchange = () => {};
  const turnByBtn = el('button', { text: 'Turn by', title: 'a piece of the length above that turns EXACTLY the angle beside it and ends straight (turn rate 0): too short a piece is refused with the length that works', onclick: () => {
    const before = shell.getState().history.present, made = fieldsNow(); send('t180-ghost-clear'); shell.extendTurnBy(opts(), turnBy.value); appliedLen = len.value; const after = shell.getState().history.present; if (after !== before) madeWith.set(after, { before, made });
  } });
  // TURN TO GRID (2026-10-12, the keeper: "it should also connect to the 90 degree angle of the grid like snap to grid … Its hard to get a straight aligned to the grid
  // from a free flowing spiral turn"): Turn by, with the angle that brings the end onto the nearest grid direction (src/core/gridturn.js). The line under it says
  // where the end points now and how far it is off the grid, so the user can see the alignment before and after
  const gridStep = el('select', { 'aria-label': 'grid step', title: 'the grid directions Turn to grid snaps to: every 90° (the grid lines), 45° or 15°' });
  gridStep.replaceChildren(...[90, 45, 15].map((d) => new win.Option(`${d}°`, String(d))));
  const headingNote = el('p', { class: 'message', 'aria-label': 'end heading', style: 'font-size:12px;margin:2px 0' });
  const showHeading = () => {
    if (!shell.getState().history.present.pieces.length) { headingNote.textContent = ''; return; }
    const h = shell.endHeadingDeg(), step = Number(gridStep.value) || 90, off = GT.offGridDeg(h, step), shown = ((h % 360) + 360) % 360;
    headingNote.textContent = Math.abs(off) < 0.005 ? `end heading ${shown.toFixed(2)}°, on the ${step}° grid` : `end heading ${shown.toFixed(2)}°, ${Math.abs(off).toFixed(2)}° off the ${step}° grid`;
  };
  // D356 (E's review 5, row 1): the step is picked in Build ▸ Turn to grid…, a visible control, so picking it is the setting (as a number, the Settings menu's own form)
  gridStep.onchange = () => { S.set('gridStep', Number(gridStep.value) || 90); showHeading(); };
  const gridBtn = el('button', { text: 'Turn to grid', title: 'a piece of the length above that turns onto the nearest grid direction (the step beside it) and ends straight, so the straight after it runs along the grid: too short a piece is refused with the length that works', onclick: () => {
    const before = shell.getState().history.present, made = fieldsNow(); send('t180-ghost-clear'); shell.extendTurnToGrid(opts(), Number(gridStep.value) || 90); appliedLen = len.value; const after = shell.getState().history.present; if (after !== before) madeWith.set(after, { before, made });
  } });
  // D282, SHARP (the keeper: "i also want to be able to make track H 90 degrees too"): a SECOND turn type beside the broad curve, which it leaves as it is. A
  // corner of the angle typed, held at the radius typed, ramped in and out over a few metres (track H's are 0–8 m) and exiting dead straight
  // (src/core/sharp.js). The length field does not apply: the corner's length is its angle times its radius. Too tight a radius for the width is refused by name
  const sharpDeg = num(90, 1, 'the angle of the sharp corner, degrees (+ = left, − = right)'), sharpR = num(22, 0.5, 'the radius the sharp corner holds, m'), sharpRamp = num(4, 1, 'how many metres the sharp corner takes to tighten, and to straighten after it');
  for (const f of [sharpDeg, sharpR, sharpRamp]) f.oninput = f.onchange = () => {};
  const sharpBtn = el('button', { text: 'Sharp', title: 'a SHARP corner: the angle beside it at the radius beside it, tightening and straightening over the ramp, then dead straight. Too tight a radius for the width is refused with the tightest that works', onclick: () => {
    const before = shell.getState().history.present, made = fieldsNow(); send('t180-ghost-clear'); shell.extendSharp(opts(), { deg: sharpDeg.value, R: sharpR.value, ramp: sharpRamp.value }); const after = shell.getState().history.present; if (after !== before) madeWith.set(after, { before, made });
  } });
  // and the hint when the turn field asks for 0 after a turn without "at start": that eases over the whole piece, so it is not straight until its end
  // D267: no paragraph under the buttons; the sense is the "at start" box's tooltip
  const turnStartTitle = atStart.turn.getAttribute('title');
  const hintNow = () => { const typed = asTyped('turn'); const hint = typed !== '' && Number(typed) === 0 && Number(cornerMode() ? show(shell.headState().kh * 100 / DEG) : shown.turn) !== 0 && !atStart.turn.checked ? `turn 0 eases over the whole piece: tick "at start" (or press Straight) to be straight from ${AT_START_M} m on` : ''; atStart.turn.setAttribute('title', hint ? `${turnStartTitle} ${hint}` : turnStartTitle); };

  // BRUSH
  const mode = el('select', { 'aria-label': 'brush mode' }), channel = el('select', { 'aria-label': 'brush channel' }), radius = num(60, 10, 'brush radius, m');
  const armed = el('input', { type: 'checkbox', 'aria-label': 'brush on' });
  // SHARP (E's opt-in, the chair's ruling 2): its spill is declared right here, in the words of E's own SHARP_NOTE
  const sharp = el('input', { type: 'checkbox', 'aria-label': 'sharp brush', title: 'Sharp brush: acts at exactly the size you set by adding finer control points first. It can nudge the track just outside the brush by up to 0.1 mm. Leave it off for an exactly local edit.' });
  // D244b SCULPT: while it is on, the brush is the value brush on the SHAPE channels only (turn and climb are not offered); the shell refuses anything else by name
  const sculptOn = el('input', { type: 'checkbox', 'aria-label': 'sculpt on', title: 'Sculpt: reshape a piece that is already placed (bank, cup, width, edge, wall rise, tube sweep) without moving the rest of the track. Select ONE piece, then drag its handles or use the brush. Turn and climb are not offered; the centreline is checked on every step' });
  const handlesOn = el('input', { type: 'checkbox', 'aria-label': 'drag handles', title: 'drag handles: marks on the ghost of the piece Extend would add (and on the piece you are sculpting); drag one to change its value, Shift for fine steps, Ctrl to snap to round numbers. Off: the ghost shows only while the pointer is on Extend' });
  handlesOn.checked = true;
  const channelsFor = (m) => (sculptOn.checked ? shell.sculptChannels() : m === 'local' ? ['height', 'lateral'] : ['kv', 'kh', 'phi', 'w', 'r', 'c', 'e', 's', 't', 'er']);
  const fillChannels = () => { channel.replaceChildren(...channelsFor(mode.value).map((c) => new win.Option(CHANNEL_NAMES[c], c))); };
  mode.replaceChildren(...shell.brushModes().map((m) => new win.Option(m === 'local' ? 'height / sideways (local)' : 'rate (one channel)', m)));
  mode.onchange = fillChannels; fillChannels();
  const stage = doc.getElementById('preview');
  values = stage ? VO.mount(stage, win) : null;
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
  // D331 (plan :417-426): with the turn and climb read as corners, their handles are the corner kinds, which drag the corner's degrees into the same fields; a blank
  // field (the head, as a corner) starts the drag from 0
  const CORNER_KIND = { turn: 'turnDeg', climb: 'climbDeg' }; Object.assign(HANDLE_FIELD, { turnDeg: turn, climbDeg: climb });
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
    // the turn and climb handles: as rates (°/100 m) the old kinds, which need a number in the field; as corners (D331) the corner kinds, offered on a blank field too
    const corner = (k) => cornerMode() && HD.KINDS[k].unit === '°' && Object.values(CORNER_KIND).includes(k);
    const kinds = HD.ORDER.map((k) => (cornerMode() && CORNER_KIND[k] ? CORNER_KIND[k] : k)).filter((k) => !HANDLE_FIELD[k].disabled && (corner(k) || fieldNum(HANDLE_FIELD[k]) !== null));
    const wt = fieldNum(width);   // the width mark sits at the TARGET width (the field), so it follows the drag from the near end
    return { mode: 'extend', samples: info.samples, s0: info.s0, s1, half, halfTarget: wt === null ? undefined : wt / 2, kinds, base: (k) => fieldNum(HANDLE_FIELD[k]) ?? (corner(k) ? 0 : null), ctx: (k) => ({ half: half(HD.KINDS[k].at) }) };
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
  // D258: THE LANDING (the free jump): while it is the head, its four handles (forward, sideways, height, heading) are on the track, and a drag is the shell's landing drag (one undo step; the same
  // numbers as the boxes below the Jump button). D278 (the keeper: "after placing jump piece, it doesnt go back to regular track manipulation with the base equation, it stays the heading, sideways, and
  // height"): they used to TAKE THE PLACE of the Extend ghost's handles, and the landing stays the head until a piece is extended from it, so right after a Jump the only handles were the landing's and the
  // only way back to the Extend ghost's was to commit an Extend. They now stand BESIDE them (the landing's at the landing's start, the Extend ghost's on the piece that would follow the landing road): the
  // base equation's controls are there at once, and the landing stays tunable until an Extend fixes it, as before.
  const LAND_FIELD = { landfwd: 'forward', landleft: 'left', landup: 'up', landturn: 'heading' };
  const landingModel = () => {
    const st = shell.getState(); if (!handlesOn.checked || st.sculpt) return null;
    const L = shell.landing(); if (!L) return null;
    const tr = askOf('t180:track-request'), free = tr ? LD.framesOf(tr, L.flightId) : null; if (!free) return null;
    return { mode: 'landing', samples: [], s0: 0, s1: 1, half: () => 0, kinds: HD.LANDING_ORDER, free, base: (k) => L.pose[LAND_FIELD[k]], ctx: () => ({}) };
  };
  let landDrag = false;
  const handlesHost = {
    model: () => {
      const L = landingModel(); if (!L) return sculptModel() || ghostModel();
      const G = ghostModel(); if (!G) return L;   // no Extend ghost (a jump's ghost is on screen, or none can be built yet): the landing's four alone
      // D278: the Extend ghost's model with the landing's four added; each kind answers for itself (a landing handle's value is the landing's, an Extend handle's is its field's)
      return { ...G, mode: 'extend+landing', kinds: [...L.kinds, ...G.kinds], free: L.free, base: (k) => (LAND_FIELD[k] ? L.base(k) : G.base(k)), ctx: (k) => (LAND_FIELD[k] ? L.ctx(k) : G.ctx(k)) };
    },
    pose: () => { const v = askOf('t180:view'); return v ? v.pose : null; },
    begin: (h) => { if (LAND_FIELD[h.kind]) { shell.beginLanding(); landDrag = !!shell.getState().landingDrag; return; } const m = sculptModel(); if (!m) { scrubbing = true; scrubKind = h.kind; } if (m) { shell.beginSculpt({ channel: SCULPT_CH[h.kind], piece: m.info.index }); sculptDrag = shell.getState().brush ? { kind: h.kind, base: m.base(h.kind) } : null; } },
    apply: (h, value) => {
      if (LAND_FIELD[h.kind]) { if (landDrag) shell.landingTo({ [LAND_FIELD[h.kind]]: value }); return; }
      if (sculptDrag) { const delta = value - sculptDrag.base; shell.sculptTo(h.kind === 'bank' ? delta * HD.DEG : delta); return; }
      if (shell.getState().sculpt) return;
      const f = HANDLE_FIELD[h.kind]; f.value = h.kind === 'bank' ? show(HD.wrapTurn(value)) : String(value); if (f.oninput) f.oninput();   // typed: the field's own handler follows it (D259: the bank within one turn)
    },
    end: () => { if (landDrag) { landDrag = false; shell.endLanding(); } if (sculptDrag) { sculptDrag = null; shell.endSculpt(); } if (scrubbing) { scrubbing = false; scrubKind = null; ghost(); } },   // the release: the full ghost
  };
  sculptOn.onchange = () => {
    shell.setSculpt(sculptOn.checked);
    if (sculptOn.checked) { send('t180-ghost-clear'); mode.value = 'rate'; mode.disabled = true; } else { mode.disabled = false; triedDoc = null; }
    fillChannels();
  };
  handlesOn.onchange = () => { triedDoc = null; if (!handlesOn.checked && !sculptOn.checked) send('t180-ghost-clear'); };

  // JUMP, THE KEEPER'S WAY (D258; the core is src/core/jump.js, E's). The Jump button sits beside Extend: it places the piece the fields describe exactly as Extend would (the take-off: the climb is the
  // fields' own), then a free flight to a default landing (a 60 m straight, 40 m ahead, the same height, lined up). While the landing is the head it is moved by the four handles on it (forward, sideways,
  // height, heading) and by these boxes: forward, sideways (+ left), height (+ up) in m, heading, pitch, bank in degrees (shell.moveLanding: one undo step each). Extend from the landing fixes it; deleting
  // back to it makes it the head again. A move the core refuses (LANDING_NOT_HEAD, a landing under 1 m from the take-off) says why in plain words. Nothing is solved or drawn for the air: drive it in AC.
  const jumpNote = el('div', { 'aria-label': 'jump note', style: 'font-size:12px;margin:2px 0;color:var(--dim)' });
  const sayJump = (...lines) => jumpNote.replaceChildren(...lines.filter(Boolean).map((t) => el('p', { text: t, style: 'margin:2px 0' })));
  const LANDING_HINT = 'Move the landing: drag its arrows on the track (white forward, orange sideways, yellow height, purple heading) or type below. Shift is fine, Ctrl snaps. Extend from it when it is right: that fixes it (delete back to it to move it again).';
  const jumpGhost = () => {
    let why = null;
    try { send('t180-ghost', { candidate: shell.candidateJump(opts()), reply: (r) => { if (r && r.error) why = r.error; } }); } catch (e) { why = e && e.name === 'CoreError' ? JW.jumpWords(e) : String(e && e.message || e); }
    if (why) { send('t180-ghost-clear'); sayJump(`No preview of this jump: ${why}`); }
  };
  const jumpHere = () => { send('t180-ghost-clear'); const before = shell.getState().history.present, made = fieldsNow(); shell.jump(opts()); appliedLen = len.value; const after = shell.getState().history.present; if (after !== before) madeWith.set(after, { before, made }); };   // as Extend: Undo gives the fields back
  const jumpBtn = el('button', { text: 'Jump', title: 'place the piece above, then a free landing you move by hand: this is a jump, drive it in AC and move the landing until it works', onclick: jumpHere,
    onmouseenter: jumpGhost, onmouseleave: () => send('t180-ghost-clear') });   // (not Extend's: the jump's ghost has no handles to keep up, so it always goes)
  // the landing's number boxes: shown only while a landing is the head; a typed value (change) is one undo step; a box being typed in is not rewritten from the track
  const landBoxes = Object.fromEntries(LD.BOXES.map((b) => [b.field, el('input', { type: 'number', step: String(b.step), 'aria-label': `landing ${b.field}`, title: b.title })]));
  for (const b of LD.BOXES) { const box = landBoxes[b.field]; box.onchange = () => { if (box.value === '' || !Number.isFinite(Number(box.value))) { fillLanding(); return; } shell.moveLanding({ [b.field]: Number(box.value) }); }; }
  const landingBox = el('div', { 'aria-label': 'landing', style: 'display:none', title: LANDING_HINT }, el('div', { class: 'pickers' }, ...LD.BOXES.map((b) => field(b.label, landBoxes[b.field]))));   // D267: the hint is the block's tooltip (title), not a paragraph
  const fillLanding = () => {
    const L = shell.landing(); landingBox.style.display = L ? '' : 'none';
    if (!L) return;
    for (const b of LD.BOXES) { const box = landBoxes[b.field]; if (doc.activeElement !== box) box.value = String(L.pose[b.field]); }
  };
  let jumpNoteFor = null;

  // CLOSE, EXAMPLE
  // D339: Close is ONE press (the ruling: no choice of how, no preview). The core tries every way of closing the loop and applies the one that passes the lap
  // proof with no new red, adds no road if it can, and moves the track least (app/core/closejob.js runCloseBest); the line under the button says what it did, or
  // why nothing changed. Undo gives the open track back. A long track takes a while (the checker runs on each way it tries), so it runs off the window's thread
  const closeBtn = el('button', { text: 'Close the loop', title: 'closes the loop the least-changing way the lap proof passes, at once; Undo gives the open track back', onclick: () => {
    // say so FIRST, and let the page paint it, so the wait never reads as nothing happening
    proposalBox.replaceChildren(el('p', { text: 'Closing the loop…' }));
    closeAsked = shell.getState().history.present;
    (win.setTimeout || setTimeout)(() => shell.closeBest(), 30);
  } });
  const cancelBtn = el('button', { text: 'Cancel', title: 'stop the close being worked out: nothing changes', onclick: () => shell.cancelClose() });
  const proposalBox = el('div', { 'aria-label': 'close', class: 'head' });
  // what the press did, HERE, where the button was pressed (a refusal in red), until the track changes
  let closeAsked = null;
  const drawProposal = () => {
    const st = shell.getState(), pend = st.closePending, h = st.history;
    cancelBtn.style.display = 'none';
    if (pend && pend.base === h.present) {
      cancelBtn.style.display = '';
      proposalBox.replaceChildren(el('p', { 'aria-label': 'close working', text: 'Closing the loop: trying each way of closing it and checking the lap… The window stays free; Cancel stops it.' }));
      return;
    }
    const refused = closeAsked && closeAsked === h.present && st.message && st.messageKind === 'error';
    const closed = closeAsked && h.present.closed && h.past.length && h.past[h.past.length - 1] === closeAsked && st.message && st.messageKind === 'ok';
    proposalBox.replaceChildren(...(refused ? [el('p', { 'aria-label': 'close refused', text: st.message, style: 'color: var(--bad)' })] : closed ? [el('p', { 'aria-label': 'close done', text: st.message })] : []));
  };
  // D355 seam fix (plan_t180_handoff :1421-1424): Open example…, Start & grid… and Pit lane… are pane A's Track menu's (app/core/trackmenu.js), which mounts its own
  // spawnsui / pitui and its own file boxes when a panel opens and unmounts them when it closes; this panel no longer makes them (two live copies would each follow the shell)

  const msg = el('p', { class: 'message', role: 'status' }), info = el('p', { class: 'head' }), sculptHint = el('p', { class: 'message', 'aria-label': 'sculpt hint', style: 'font-size:12px;margin:2px 0' });
  const pieces = PU.mount({ root, stage, shell, win, el, armed: () => armed.checked, send, settings: S });
  // D269: the saved pieces are a drop-down bin in the top bar (app/index.html #pieces-bin), not a section of this column; without that element they stay here
  const bin = doc.getElementById ? doc.getElementById('pieces-bin') : null; if (bin) bin.replaceChildren(...pieces.nodes.library.slice(1));
  // D355 part 2, THE SLIM LEFT SIDE (the keeper: "we can try it, but keep it the same aesthetic as we have it now"; plan_t180_handoff :1382-1387). The commands moved to
  // the top-right menus: Build (app/core/buildmenu.js), pane B's Settings and View, and pane A's Track and File ▸ Developer (which make their own controls). Each moved control is still THIS panel's, the same
  // node with the same handlers, HELD out of sight below; a menu's popover borrows it while open (lend) and gives it back, so what it does is unchanged.
  const held = el('div', { 'aria-label': 'held for the menus', hidden: '', style: 'display:none' });
  const LENT = {
    turnBy: el('div', { class: 'actions' }, turnByBtn, field('turn by °', turnBy)),
    grid: el('div', {}, el('div', { class: 'actions' }, gridBtn, field('grid °', gridStep)), headingNote),
    sharp: el('div', { class: 'actions' }, sharpBtn, field('sharp °', sharpDeg), field('sharp radius m', sharpR), field('sharp ramp m', sharpRamp)),
  };
  held.append(...Object.values(LENT),
    el('div', { class: 'pickers' }, field('turn & climb as', turnAs), field('drag handles', handlesOn), field('colour by grip', colourOn)),   // Settings and View hold these (through S)
    el('div', { class: 'actions' }, jumpBtn, levelBtn, floorBtn, closeBtn));   // Build's commands (their buttons, so a click is what it always was)
  /** A popover's mountFn: today's fields and button into `box`; the function returned puts them back. */
  const lend = (name, box) => { const n = LENT[name]; if (!n) throw new Error(`BAD_LEND: no fields named ${name}`); box.append(n); return () => { if (n.parent !== held && n.parentNode !== held) held.append(n); }; };
  // THE BRUSH STRIP: mode, what, radius and sharp (and Sculpt, the brush's shape-only kind), shown only while the brush is on. It sits at the top of this column until the bar
  // has a place for it under the menus (exposed as brushStrip)
  const brushStrip = el('div', { 'aria-label': 'brush strip', class: 'brush-strip' }, el('div', { class: 'pickers' }, field('on', armed), field('mode', mode), field('what', channel), field('radius m', radius), field('sharp (may nudge ≤ 0.1 mm outside)', sharp), field('sculpt (shape only)', sculptOn)), sculptHint);
  const showStrip = () => { brushStrip.style.display = armed.checked || sculptOn.checked ? '' : 'none'; };
  armed.onchange = showStrip;
  // "More shape", folded: the channels used less often, each with its "at start" box, and the notes that explain them
  const moreShape = el('details', { class: 'more-shape' }, el('summary', { text: 'More shape', style: 'cursor:pointer;margin:6px 0' }),
    el('div', { class: 'pickers' }, fieldAt('cup °', cup, 'cup'), fieldAt('width m', width, 'width'), field('width like…', wlike), field('grip %', gripF), field('grip like…', gripLike),
      fieldAt('left edge °', edge, 'edge'), fieldAt('right edge °', edgeR, 'edgeR'), fieldAt('edge start', start, 'start'), fieldAt('tube sweep °', tube, 'tube')), wnote, gripNote);
  // the selection box, shown only with a selection (and while a delete it started is previewed: its Apply and Cancel are in it)
  const selBox = el('div', { 'aria-label': 'selected pieces' }, ...pieces.nodes.selection);
  const showSel = (st) => { const d = st.history.present; selBox.style.display = shell.selectionInfo() || (st.deleteProposal && st.deleteProposal.base === d) ? '' : 'none'; };
  root.replaceChildren(
    el('h3', { text: 'Equation track' }), info,
    el('div', { class: 'actions' }, el('button', { text: 'Undo', title: 'Undo (Ctrl+Z), also from a number field', onclick: () => shell.undo() }), el('button', { text: 'Redo', title: 'Redo (Ctrl+Y or Ctrl+Shift+Z)', onclick: () => shell.redo() })),
    brushStrip,
    el('h3', { text: 'Extend at the head' }), el('div', { class: 'pickers' }, field('length m', len), turnField, climbField, fieldAt('bank °', bank, 'bank')),
    moreShape, roBox,
    el('div', { class: 'actions' }, extendBtn, straightBtn), jumpNote, landingBox,
    el('div', { class: 'actions' }, cancelBtn), proposalBox,
    selBox, ...(bin ? [] : pieces.nodes.library),
    msg,
    held,
  );
  // 't180:build-request' { detail: { reply(build) } }: the Build menu's commands (app/core/buildmenu.js), read when the menu opens
  const onBuildRequest = (e) => {
    if (!e.detail || typeof e.detail.reply !== 'function') return;
    const d = shell.getState().history.present;
    e.detail.reply({ straight: () => straightBtn.onclick(), level: () => levelBtn.onclick(), toFloor: () => floorBtn.onclick(), jump: () => { if (!jumpBtn.disabled) jumpHere(); },
      close: () => { if (!closeBtn.disabled) closeBtn.onclick(); }, canClose: !closeBtn.disabled, closed: !!d.closed,
      brushOn: !!armed.checked, toggleBrush: () => { armed.checked = !armed.checked; showStrip(); }, lend });
  };
  doc.addEventListener('t180:build-request', onBuildRequest);
  let shownFor = null, lentFrom = null;   // lentFrom: the selected piece whose values the fields hold (2026-10-15)
  const draw = (st) => {
    showHeading();   // the end heading line (Turn to grid)
    const d = st.history.present, L = st.resolved.segments.reduce((a, g) => a + g.length, 0);
    if (d !== shownFor) {   // a new document (Extend, Undo, Redo, open, a brush): the fields show its head, and an UNDONE Extend's own values (item 7)
      const m = shownFor ? madeWith.get(shownFor) : null, undone = !!m && m.before === d;   // only an Undo steps from a document back to the one it was made from
      // D278: the Extend handles stand beside the landing's, so a landing move (typed or dragged) is a new document that must NOT wipe what was typed or dragged into the Extend fields: those that differ from what
      // the panel last put there are kept (they stay un-applied, as before the move); every other field shows the head, as ever
      const keep = st.lastStep && st.lastStep.op === 'landing' && !undone ? FIELDS.filter(unapplied).map((fl) => [fl, fl.value]) : [];
      showGrip(); showHead(); if (undone) putBack(m.made); for (const k of Object.keys(HEAD)) applied[k] = HEAD[k][0].value;
      if (keep.length) { for (const [fl, v] of keep) fl.value = v; if (cup.value !== shown.cup) exclusive(cup); else if (tube.value !== shown.tube) exclusive(tube); }
      shownFor = d; lentFrom = null;
    }
    // A SELECTED PIECE LENDS ITS VALUES (2026-10-15, the keeper: "when clicking a previous placed part of the track, while its highlighted, make the values
    // change to it, so you can mimic certain values within a new piece"): one selected road piece puts its end values and its length in the Extend fields.
    // They differ from what the fields SHOW (the head), so Extend takes them as targets and places a piece like it. A run of several lends nothing (the fields
    // stay); clearing the selection shows the head again. A cup and a tube are one-of (exclusive): the lent kind wins
    const sel = st.selection && st.selection.base === d ? st.selection : null, one = sel && sel.ids.length === 1 ? sel.ids[0] : null;
    if (one && one !== lentFrom) {
      const ps = shell.pieceState(one);
      if (ps) {
        for (const [k, [input, of]] of Object.entries(HEAD)) input.value = show(of(ps));
        if (cornerMode()) { const at = d.pieces.findIndex((p) => p.id === one); const r = shell.pieceReadouts()[at]; turn.value = show(r.turnDeg); climb.value = show(r.climbDeg); }   // D331 B: as corners, the piece lends the degrees it turns and climbs
        len.value = show(ps.length);
        for (const [k, fl] of [['cup', cup], ['tube', tube]]) { fl.disabled = false; fl.setAttribute('title', baseTitle[k]); }
        if (ps.tube) exclusive(tube); else if (cup.value !== shown.cup) exclusive(cup);
        fillWidthLike(); readout();
      }
      lentFrom = one;
    } else if (!sel && lentFrom) { showHead(); lentFrom = null; readout(); }
    info.textContent = `${d.pieces.length} piece${d.pieces.length === 1 ? '' : 's'} · ${Math.round(L).toLocaleString('en-US')} m · ${d.closed ? 'closed loop' : 'open'}${st.lastStep ? ` · last ${st.lastStep.op} ${st.lastStep.ms.toFixed(0)} ms` : ''}`;
    extendBtn.disabled = jumpBtn.disabled = !!d.closed; closeBtn.disabled = !!d.closed || !d.pieces.length;
    drawProposal();
    msg.textContent = st.message || ''; msg.className = st.messageKind === 'ok' ? 'message ok' : 'message';
    readout();   // the track changed, so the piece the fields would add changed
    hintNow(); fillLanding();
    if (d !== jumpNoteFor) { jumpNoteFor = d; sayJump(); }   // D267: a new document: the note is empty again (it shows only a refusal's words; the standing hint is the button's tooltip)
    // D244b: the Sculpt switch follows the shell, and says what to do next
    sculptOn.checked = !!st.sculpt;
    const si = st.sculpt ? shell.sculptInfo() : null;
    showStrip(); showSel(st);   // D355: the brush strip while the brush (or Sculpt) is on; the selection box only with a selection
    sculptHint.textContent = !st.sculpt ? '' : si ?`Sculpting ${si.id}: drag its handles (bank, width${si.hasCup ? ', cup' : ''}) or use the brush; one drag is one undo step. The route never moves.` : 'Select ONE piece: click it on the track. Only its shape (bank, cup, width, edge, wall rise, tube sweep) can change; turn and climb are not offered, and the centreline is checked on every step.';
  };
  // the labels on the track: a DOM layer over the preview (app/core/labels.js); none when there is no preview to lay them on
  const labels = stage ? LB.mount(stage, shell, win) : null;
  const gripLayer = stage ? GR.mount(stage, shell, win) : null;
  const spawnsLayer = stage ? SPL.mount(stage, shell, win) : null;   // the hand-placed start, drawn when the track has one   // D261: the track coloured by grip, off until "colour by grip" is ticked
  colourOn.onchange = () => { if (gripLayer) gripLayer.setVisible(colourOn.checked); if (labels) labels.setGripView(colourOn.checked); };
  const spawnDrag = stage ? SPD.mount(stage, win, shell, { pose: () => { const v = askOf('t180:view'); return v ? v.pose : null; }, yieldTo: (x, y) => !!(handles && HD.hitTest(handles.handles(), x, y)) }) : null;   // D285: the start line, the pack and the hotlap grabbed with the mouse. Mounted BEFORE the handles (the handles' press listener stays the last registered, as the tests' capture emulation assumes) and it steps aside for a handle under the pointer, whatever the order
  const handles = stage ? HD.mount(stage, win, handlesHost) : null;   // D244: the drag handles' overlay
  if (spawnDrag) spawnDrag.late();   // (the start drag's hover and move listener goes after the handles': they set the cursor on every move)
  const flights = stage ? FL.mount(stage, win) : null;   // D243: the flights as dashed arcs
  // 't180:handles-request' { detail: { reply(list) } }: where the handles are on screen now ([{ id, kind, side, x, y, dx, dy }], css px of the preview), read only, for the window proof as the other requests are
  const onHandlesRequest = (e) => { if (e.detail && typeof e.detail.reply === 'function') e.detail.reply(handles ? handles.handles().filter((h) => h.screen).map((h) => ({ id: h.id, kind: h.kind, side: h.side, x: h.screen.x, y: h.screen.y, dx: h.screen.dx, dy: h.screen.dy })) : []); };
  doc.addEventListener('t180:handles-request', onHandlesRequest);
  // D355: FOUR OF THE SIX KEYS of S are this panel's switches (the fifth, mirrorOnInsert, is app/core/piecesui.js's; the sixth, csp, the checker's). Each starts from
  // what S holds (a value S does not hold, or one that is not valid, keeps today's default) and follows S.on; a change runs the switch's own handler, as a click would
  const SETTINGS = {
    turnClimbAs: (v) => { const w = v === 'rate' ? 'rate' : 'corner'; if (turnAs.value !== w) { turnAs.value = w; turnAs.onchange(); } },
    dragHandles: (v) => { const w = asBool(v, true); if (handlesOn.checked !== w) { handlesOn.checked = w; handlesOn.onchange(); } },
    colourByGrip: (v) => { const w = asBool(v, false); if (colourOn.checked !== w) { colourOn.checked = w; colourOn.onchange(); } },
    gridStep: (v) => { const w = ['90', '45', '15'].includes(String(v)) ? String(v) : '90'; if (gridStep.value !== w) { gridStep.value = w; showHeading(); } },   // following S: the note only, nothing written back
  };
  const offSettings = Object.entries(SETTINGS).map(([k, apply]) => { apply(S.get(k, undefined)); return S.on(k, apply); });
  const unsub = shell.subscribe(draw); draw(shell.getState());
  // options(): the options Extend, the ghost and the readout use right now (fields left as shown send no target)
  return { labels, handles, flights, pieces, gripLayer, spawnsLayer, spawnDrag, values, brushStrip, lend, options: opts, unmount() { unsub(); doc.removeEventListener('t180:build-request', onBuildRequest); for (const off of offSettings) if (typeof off === 'function') off(); if (spawnDrag) spawnDrag.unmount(); if (spawnsLayer) spawnsLayer.unmount(); if (values) values.unmount(); if (gripLayer) gripLayer.unmount(); if (flights) flights.unmount(); doc.removeEventListener('t180:handles-request', onHandlesRequest); if (handles) handles.unmount(); doc.removeEventListener('t180-undo-guard', onUndoGuard); pieces.unmount(); if (frame) win.cancelAnimationFrame(frame); if (labels) labels.unmount(); if (stage) { stage.removeEventListener('pointerdown', down); stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); stage.removeEventListener('pointercancel', up); } root.replaceChildren(); } };
}

module.exports = { mount, extendOptions, PER_PX };
