// bank-ramp-candidates.cjs: the at-start bank ramps to look at side by side, laid on the same piece, written as tracks to open in the builder.
//   node tools/bank-ramp-candidates.cjs <out folder> [bank degrees]      (default -41.38)
// The piece: 1,000 m flat, then 1,000 m with the bank at start, cup 15.5, width 31. Each candidate is a bank shape (src/core/extend.js bankShape) and a ramp length:
//   A  the swell (equal shares, ½ / ½) over the length the panel lays today (app/core/panel.js crossStartM with SWELL_SPREAD)
//   B  a quick rise and a long fade (0.1 / 0.9) over that same length
//   C  0.1 / 0.9 over half the piece (the cap)
//   D  the swell over half the piece
// It writes eq-ramp_<id>.t180track (src/core/document.js serialize) for each, and figures.json: the bank at 10, 20, 50, 100 and 200 m, the peak roll rate of the bank
// and where it falls, the rate's largest change over 2 m (the kink), and the checker's roll read (src/validate/index.js rollRates at a 2 m step) over the piece.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const D = require(path.join(ROOT, 'src/core/document.js')), { extend } = require(path.join(ROOT, 'src/core/extend.js'));
const AD = require(path.join(ROOT, 'src/core/adapter.js')), V = require(path.join(ROOT, 'src/validate/index.js')), { extendOptions } = require(path.join(ROOT, 'app/core/panel.js'));

const DEG = Math.PI / 180;
const NONE = { turn: false, climb: false, bank: false, width: false, cup: false, edge: false, edgeR: false, start: false, tube: false };

/** The candidates for a bank of `bank` degrees at start: the shape and the ramp (m), A's length being the one the panel lays today. */
function candidates(bank) {
  const base = extend(D.createDoc('flat'), { length: 1000, family: 'bowl' }), e = D.endState(base);
  const today = extendOptions({ length: 1000, bank: String(bank), cup: '15.5', width: '31', atStart: { ...NONE, bank: true }, head: { phi: e.phi.v, c: e.c.v, e: e.e ? e.e.v : 0, er: e.er ? e.er.v : 0 } }).transition.phi;
  return [
    { id: 'A', what: 'the swell, today\'s length', shape: 'swell', ramp: today },
    { id: 'B', what: 'quick rise, long fade, today\'s length', shape: { rise: 0.1, fall: 0.9 }, ramp: today },
    { id: 'C', what: 'quick rise, long fade, half the piece', shape: { rise: 0.1, fall: 0.9 }, ramp: 500 },
    { id: 'D', what: 'the swell, half the piece', shape: 'swell', ramp: 500 },
  ];
}

/** The candidate's track: the flat piece, then the banked one laid with that shape and ramp (the cup and width at start as the panel lays them: not ticked). */
function lay(c, bank) {
  const base = extend(D.createDoc(`ramp ${c.id}`), { length: 1000, family: 'bowl' });
  return extend(base, { length: 1000, targets: { phi: bank * DEG, c: 15.5, w: 31 }, transition: { phi: c.ramp }, bankShape: c.shape });
}

function figures(doc, c) {
  const P = doc.pieces[1], at = (s) => D.channelAt(P, 'phi', s), rate = (s) => at(s).d1 / DEG;
  let peak = 0, peakAt = 0, kink = 0;
  for (let s = 0; s <= c.ramp + 5; s += 0.25) { const r = Math.abs(rate(s)); if (r > peak) { peak = r; peakAt = s; } if (s + 2 <= c.ramp + 5) kink = Math.max(kink, Math.abs(rate(s + 2) - rate(s))); }
  const { segments, path: pth } = AD.toPath(doc, { step: 2 }), S = pth.samples;
  let roll = 0, rollAt = 0;
  for (const q of V._internal.rollRates(S, (i) => segments[S[i].seg].kind !== 'gap', false, pth.lengthM)) if (segments[S[q.i].seg].id === P.id && q.rate > roll) { roll = q.rate; rollAt = S[q.i].s; }
  const startS = S.find((x) => segments[x.seg].id === P.id).s;
  return {
    id: c.id, what: c.what, shape: c.shape, rampM: c.ramp,
    bankDeg: Object.fromEntries([10, 20, 50, 100, 200].map((s) => [s, +(at(s).v / DEG).toFixed(2)])),
    peakRollDegM: +peak.toFixed(4), peakAtM: peakAt, kink2mDegM: +kink.toFixed(5),
    checkerRollDegM: +roll.toFixed(4), checkerRollAtM: +(rollAt - startS).toFixed(1), checkerAmberDegM: V.ROLL_AMBER_DEG_M,
  };
}

function main(out, bank = -41.38) {
  if (!out) throw new Error('usage: node tools/bank-ramp-candidates.cjs <out folder> [bank degrees]');
  fs.mkdirSync(out, { recursive: true });
  const rows = [];
  for (const c of candidates(bank)) {
    const doc = lay(c, bank);
    fs.writeFileSync(path.join(out, `eq-ramp_${c.id.toLowerCase()}.t180track`), D.serialize(doc));
    rows.push(figures(doc, c));
  }
  fs.writeFileSync(path.join(out, 'figures.json'), JSON.stringify({ bankDeg: bank, piece: '1,000 m flat, then 1,000 m with the bank at start, cup 15.5, width 31', candidates: rows }, null, 1));
  return rows;
}

if (require.main === module) {
  try { for (const r of main(process.argv[2], process.argv[3] === undefined ? undefined : Number(process.argv[3]))) console.log(JSON.stringify(r)); }
  catch (e) { console.error(`bank-ramp-candidates: ${e.message}`); process.exit(1); }
}
module.exports = { candidates, lay, figures, main };
