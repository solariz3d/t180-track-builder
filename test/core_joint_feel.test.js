// core_joint_feel.test.js: node --test test/core_joint_feel.test.js
// JOINT BY JOINT, what a car feels as built (the user, 2026-11-03: "i wonder if we could eliminate the joint bump altogether … i want it to be as perfect as we
// can! I notice it with my perception"). Two tracks: his RIBBON CORKSCREW TEST's bank, laid as the panel lays it (the same lay as core_bank_corners.test.js,
// his values and "early" ticks), and the ELYSIUM fixture (test/fixtures/elysium-2026-10-22.t180track). At every joint between two road pieces:
//   a  NO STEP in what the centre feels: its acceleration per v² along the road's U and L (the path's curvature vector) changes across the joint, over 2 m, by no
//      more than it does anywhere inside the two pieces (× 1.05)
//   b  the ROLL accelerates no faster than the 3 g bar at a wheel 10 m out at 170 m/s within 20 m of the joint
//   c  NO DIP TO ZERO where the bank keeps rolling the same way across the joint: the roll rate at the joint is at least half the slower piece's middle
//   d  NO 2 M RIPPLE: within 20 m of the joint, at every 2 m segment boundary between segments rolling the same way, the roll rate read every 0.5 m keeps 85%
//      of the slower segment's mean (a smoothstep in each segment brought it to rest at every boundary)
// What this does NOT ask, and why: that the JERK at a joint stay within a piece's middle. A piece that holds its bank or its turn through its middle and changes
// it at its joint must put that change's jerk at the joint, however smooth; the turn's and the climb's own rate also comes to rest at every joint (each piece
// eases its curvature), which only pauses their jerk, with no step in what is felt (a above). Carrying the turn and the climb through a joint would move the
// route downstream, so it belongs where pieces are laid, not here.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const A = require('../src/core/adapter.js');
const { extendOptions } = require('../app/core/panel.js');

const DEG = Math.PI / 180, BAR = 29.4 / (10 * 170 * 170);
const opts = (length, bank, early) => extendOptions({ length: String(length), turn: '', climb: '', bank: bank === null ? '' : String(bank), width: '', cup: '', edge: '', start: '', tube: '', atStart: early ? { bank: true } : {}, turnAs: 'rate' });
const HIS = [[750, -28.47, 1], [750, 12.01, 1], [750, 55, 0], [350, null, 0], [350, null, 0], [350, 0, 0], [750, -7, 1], [250, -90, 0], [250, -180, 0], [250, -270, 0], [250, -359.99, 0]];
const ribbon = () => { let d = extend(D.createDoc('ribbon'), { length: 1000, family: 'bowl' }); for (const [L, b, e] of HIS) d = extend(d, opts(L, b, e)); return d; };
const elysium = () => D.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'elysium-2026-10-22.t180track'), 'utf8'));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// THE FLOOR: the joints keep their bank exactly (a piece ends where it says), so a piece that changes its bank by Δ over L can roll no more gently than a
// rest-to-rest quintic across all of it, whose roll acceleration peaks at 10/√3 · Δ/L² (a 100 m piece banking 30° cannot meet the bar: 0.0173 °/m²). The
// bar a point is held to is the larger of the 3 g bar and that floor, for its own piece and, within 4 m of a joint, the piece across it
const floorOf = (P) => (P.type === 'road' ? (10 / Math.sqrt(3)) * Math.abs(D.channelAt(P, 'phi', P.length).v - D.channelAt(P, 'phi', 0).v) / (P.length * P.length) : 0);
// L135: `ramps` adds the floor of a ramp INSIDE a piece ([a, b] in track metres, its own Δ over its own length): a piece that banks 0 → 30° → 0 has no net change, so floorOf
// reads 0 for it, but its second ramp is a rest-to-rest roll like any piece's and can roll no more gently than its own quintic. Left out, nothing moves.
const allowedAt = (doc, s, ramps = []) => { let o = 0, m = BAR; for (const P of doc.pieces) { if (s >= o - 4 && s <= o + P.length + 4) m = Math.max(m, floorOf(P)); o += P.length; } for (const x of ramps) if (s >= x.a - 4 && s <= x.b + 4) m = Math.max(m, (10 / Math.sqrt(3)) * Math.abs(x.delta) / ((x.b - x.a) * (x.b - x.a))); return m; };

function joints(doc, ramps = []) {
  const S = A.toPath(doc).path.samples.map((x) => ({ s: x.s, U: dot(x.kvec, x.U), L: dot(x.kvec, x.L), roll: x.roll })), N = S.length, ds = S[1].s - S[0].s;
  const idx = (s) => Math.max(0, Math.min(N - 1, Math.round(s / ds)));
  const step = (key, i0, i1) => { let m = 0; for (let i = Math.max(4, i0); i <= Math.min(N - 1, i1); i++) m = Math.max(m, Math.abs(S[i][key] - S[i - 4][key])); return m; };
  const rate = (i) => (S[i + 1].roll - S[i].roll) / ds;
  let o = 0; const P = doc.pieces.map((p) => { const r = { p, a: o, b: o + p.length }; o += p.length; return r; });
  const out = [];
  for (let k = 0; k + 1 < P.length; k++) {
    const a = P[k], b = P[k + 1]; if (a.p.type !== 'road' || b.p.type !== 'road' || a.p.tube || b.p.tube) continue;
    const j = a.b, r = { joint: Math.round(j), bad: [] };
    // a: no step at the joint beyond the pieces' own
    for (const key of ['U', 'L']) { const at = step(key, idx(j - 2), idx(j + 2)), inside = Math.max(step(key, idx(a.a + 2), idx(a.b - 2)), step(key, idx(b.a + 2), idx(b.b - 2))); if (at > inside * 1.05 + 1e-9) r.bad.push(`a ${key}: a step of ${at.toExponential(2)} across the joint, ${inside.toExponential(2)} at most inside`); }
    // b: the roll's acceleration near the joint under the bar (2 m differences of the 2 m segment-end rates)
    let acc = 0; for (let i = idx(j - 20); i + 8 <= idx(j + 20); i += 4) acc = Math.max(acc, Math.abs((S[i + 8].roll - S[i + 4].roll) - (S[i + 4].roll - S[i].roll)) / 4); const al = allowedAt(doc, j, ramps); if (acc > al * 1.05) r.bad.push(`b: the roll accelerates at ${(acc / DEG).toFixed(5)} °/m², over the ${(al / DEG).toFixed(5)} allowed`);
    // c: no dip to zero where the bank keeps rolling the same way
    const mA = D.channelAt(a.p, 'phi', a.p.length / 2).d1, mB = D.channelAt(b.p, 'phi', b.p.length / 2).d1;
    if (Math.abs(mA) >= 0.02 * DEG && Math.abs(mB) >= 0.02 * DEG && Math.sign(mA) === Math.sign(mB)) { let slow = Infinity; for (let i = idx(j - 4); i <= idx(j + 4); i++) slow = Math.min(slow, Math.abs(rate(i))); if (slow < 0.5 * Math.min(Math.abs(mA), Math.abs(mB))) r.bad.push(`c: the roll slows to ${(slow / DEG).toFixed(4)} °/m at the joint, ${(Math.min(Math.abs(mA), Math.abs(mB)) / DEG).toFixed(4)} mid-piece`); }
    // d: no 2 m ripple near the joint
    // at each 2 m segment boundary where both neighbouring segments roll the same way, the 0.5 m rate either side of it keeps 85% of the slower segment's mean
    // (a smoothstep in each segment brought it to about 62% there, and to rest at the boundary itself)
    for (let ib = idx(j - 20) + 4; ib + 4 <= idx(j + 20); ib += 4) {
      const m1 = (S[ib].roll - S[ib - 4].roll) / (4 * ds), m2 = (S[ib + 4].roll - S[ib].roll) / (4 * ds);
      if (Math.abs(m1) < 0.01 * DEG || Math.abs(m2) < 0.01 * DEG || Math.sign(m1) !== Math.sign(m2)) continue;
      const near = Math.min(Math.abs(rate(ib - 1)), Math.abs(rate(ib))), floor = 0.85 * Math.min(Math.abs(m1), Math.abs(m2));
      if (near < floor) { r.bad.push(`d: at a segment boundary the rate sags to ${(near / DEG).toFixed(4)} °/m between segments rolling at ${(m1 / DEG).toFixed(4)} and ${(m2 / DEG).toFixed(4)}`); break; }
    }
    out.push(r);
  }
  return out;
}
for (const [name, make] of [['his ribbon', ribbon], ['ELYSIUM (the fixture)', elysium]]) {
  test(`${name}: at every joint, no step in what the centre feels, the roll under the bar, no dip to zero where it rolls on, no 2 m ripple`, () => {
    const J = joints(make()), bad = J.filter((r) => r.bad.length);
    assert.ok(J.length > 5, `${J.length} joints read`);
    assert.equal(bad.length, 0, `${bad.length} of ${J.length} joints bump: ${bad.slice(0, 6).map((r) => `${r.joint}: ${r.bad.join('; ')}`).join(' | ')}`);
  });
}

// ── L135 4b: THE SECOND BANK, felt. The piece that banks twice and the straight after it, read by the same four measures: the second ramp's end is a joint like
// any other, and a car crossing it must feel nothing the pieces do not already have inside them.
// AMENDED L139 (rule changed: K 15 -> 31.5, the keeper 2026-11-05 07:00Z "we dont want the bumps"; pane E 711d7d10): his from 637.5 leaves 112.5 m, under the new
// minimum (172.5 m for 30°, 140.9 m for 20°), and is now refused by name (test/core_changes.test.js L139 7). The row's rule is unchanged; its from is the latest the rule allows.
// AMENDED D642 (rule changed, the keeper's ruling of 2026-11-05 19:54Z: the extra ADDS on top of the piece's own change and never squeezes it): the 30° first ramp now eases over the
// whole piece under the second, so the second needs 177.3 m (its own 172.5 m, with the first ramp's share taken out: extend.js secondMinM `base`), and 577 is refused; 572 is
// the latest whole metre the rule allows. The row's measures are unchanged.
// AMENDED D642, C's 35ef2eb6 (by name: the bank's shortest takes its own shape; opts lays the panel's rounded ramp, which rolls near the bar at its end, so the second
// needs 244.0 m on this piece: the mark moves to 505)
test('L135 4b: a straight, his 750 m piece banking 30° and back to level from 505 m, a straight: no step, the roll under the bar, no dip, no ripple at either joint', () => {
  let doc = extend(D.createDoc('twice'), { length: 1000, family: 'bowl' });
  doc = extend(doc, { ...opts(750, 30, 0), second: { phi: { from: 505, target: 0 } } });
  doc = extend(doc, opts(300, null, 0));
  assert.ok(Math.abs(D.channelAt(doc.pieces[1], 'phi', 750).v) <= 1e-9, 'the piece ends level (its second bank)');
  const J = joints(doc, [{ a: 1000 + 505, b: 1750, delta: 30 * DEG }]), bad = J.filter((r) => r.bad.length);   // the second ramp is held to its own floor, as a piece is (allowedAt)
  assert.equal(J.length, 2, `${J.length} joints read`);
  assert.equal(bad.length, 0, bad.map((r) => `${r.joint}: ${r.bad.join('; ')}`).join(' | '));
});
