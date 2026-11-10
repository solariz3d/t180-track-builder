// core_ramp_mutation.test.js: node --test test/core_ramp_mutation.test.js   (under the heavy-run lock, --max-old-space-size=4096; a minute or two)
// D194b: each mutant changes src/core/extend.js in ONE way (one exact string replacement, in a temporary copy of src/ and tools/), and test/core_ramp.test.js
// runs against the copy. "Applied" means the replaced string occurs EXACTLY once; "caught" means at least one test FAILED on the mutant. The CONTROL runs
// the whole file on an unmutated copy, so a copy that is missing a file cannot make every mutant look caught.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const IR = require('./inner_run.js');   // D352: a crashed inner run reads NOT TESTED
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const X = 'core/extend.js';
const B = 'core/bankswing.js';
const T = 'core/turnby.js';
const P = '../app/core/panel.js';   // a file outside src/, given relative to it (the tree copies the app folders the panel loads)

const MUTANTS = [
  // (no mutant on Lof's map branch: a short-ramp channel's fitted curve is overwritten by rampControl, so the length it is fitted over cannot change the document;
  //  the mutant 'the map is ignored' is equivalent, found in the first run and left out on purpose)
  { id: "R2 'start' is the whole piece, not the first span", pattern: '2/3', edits: [[X, "const R = v === 'start' ? startRampM(length, knotM) : v;", "const R = v === 'start' ? length : v;"]] },
  { id: 'R3 startRampM is a fixed 20 m even on a short piece', pattern: '4 ·', edits: [[X, 'return K.length ? K[0] : length; }', 'return 20; }']] },
  { id: 'R4 the extra ramp knots are not added', pattern: '4 ·|2/3', edits: [[X, 'rampKnots(length, shortRamps.map((ch) => ramp[ch]), knotM, sub)', 'undefined']] },
  { id: 'R5 the short-ramp channel is left as the least-squares fit (it rings)', pattern: '2/3', edits: [[X, 'for (const ch of shortRamps) rampControl(', 'for (const ch of []) rampControl(']] },
  { id: 'R6 the ideal ramp is not compressed (the curve completes later than R)', pattern: '2/3', edits: [[X, 'Math.max(R - (2 * R) / sub, R / sub)', 'R']] },
  { id: 'R7 the Greville abscissae are shifted (the hold is not exact and the ramp lags)', pattern: '2 ·|2/3', edits: [[X, 'const xi = (U[i + 1] + U[i + 2] + U[i + 3]) / 3', 'const xi = (U[i] + U[i + 1] + U[i + 2]) / 3']] },
  { id: "R8 the joint's first two control points are overwritten too (C1 lost)", pattern: '3 ·|5 ·', edits: [[X, 'const P = piece.channels[ch], U = D.knotVector(piece), free = held ? 2 : 0, dec', 'const P = piece.channels[ch], U = D.knotVector(piece), free = 0, dec']] },
  { id: 'R9 the range clamp is dropped (a continued slope can carry the ramp past its target)', pattern: '3 ·', edits: [[X, 'v = Math.min(hi, Math.max(lo, f(xi)));', 'v = f(xi);']] },
  { id: 'R10 a ramp as long as the piece counts as short (the whole-piece blend is replaced)', pattern: '4 ·', edits: [[X, 'ramp[ch] < length - 1e-9 && targets[ch]', 'ramp[ch] <= length + 1e-9 && targets[ch]']] },
  { id: 'R11 a channel with no target still gets the ramp treatment', pattern: '4 ·', edits: [[X, 'ramp[ch] < length - 1e-9 && targets[ch] !== undefined && targets[ch] !== null', 'ramp[ch] < length - 1e-9']] },
  { id: 'R12 an unknown channel in the map is accepted', pattern: '6 ·', edits: [[X, "if (!D.CHANNELS.includes(ch)) throw new D.CoreError('BAD_TRANSITION', `the transition map has no channel", "if (false) throw new D.CoreError('BAD_TRANSITION', `the transition map has no channel"]] },
  { id: 'R13 a map value longer than the piece is accepted', pattern: '6 ·', edits: [[X, 'Number.isFinite(R) && R > 0 && R <= length', 'Number.isFinite(R) && R > 0']] },
  { id: 'R14 a map value of zero or less is accepted', pattern: '6 ·', edits: [[X, 'Number.isFinite(R) && R > 0 && R <= length', 'Number.isFinite(R) && R <= length']] },
  { id: 'R15 the number path no longer refuses a transition past the length', pattern: '6 ·|1 ·', edits: [[X, 'if (!(Lt > 0 && Lt <= length)) throw', 'if (!(Lt > 0)) throw']] },
  { id: 'R16 the number path uses a different default (half the piece) for no transition', pattern: '1 ·', edits: [[X, ': transition === undefined ? length : transition);', ': transition === undefined ? length / 2 : transition);']] },
  { id: 'R17 the ramp control points are not rounded to the channel quantum (the document would not round-trip)', pattern: '5 ·', edits: [[X, 'P[i] = Number(v.toFixed(dec)) + 0;', 'P[i] = v;']] },
  // D459: the C2 quintic for the bank, the cup and the edges (test/core_joint_c2.test.js runs beside core_ramp's rows here)
  { id: "Q1 the cross-section channels blend by the cubic again (c2Ends still pins the ends, so the joints read C2; the ramp's SHAPE is no longer the quintic's)", pattern: 'row 8', edits: [[X, 'const blend = C2_CHANNELS.has(ch) ? smoother : bloss;', 'const blend = bloss;']] },
  { id: 'Q2 the fitted ends are not pinned to zero curvature (the fit alone reads 0.0034 to 0.038 °/m² at the start of a ramp)', pattern: 'row 1|row 2', edits: [[X, 'for (const ch of c2Targets) c2Ends(piece, ch);', 'for (const ch of []) c2Ends(piece, ch);']] },
  { id: 'Q3 the quintic blends the route channels too (the golden documents with kh, kv, w or r targets change)', pattern: '1 ·', edits: [[X, 'const blend = C2_CHANNELS.has(ch) ? smoother : bloss;', 'const blend = smoother;']] },
  { id: 'Q6 continuity.js reads the start curvature over the wrong knot span (U[5] for U[4])', pattern: 'row 0', edits: [['core/continuity.js', 'k: (2 * (q1 - q0)) / U[4] }', 'k: (2 * (q1 - q0)) / U[5] }']] },
  { id: 'Q7 continuity.js reads the end slope from the wrong points (the last three for the last two)', pattern: 'row 0', edits: [['core/continuity.js', 'const qe = (3 * (c[n - 1] - c[n - 2])) / (L - U[n - 1])', 'const qe = (3 * (c[n - 1] - c[n - 3])) / (L - U[n - 1])']] },
  { id: 'Q4 a piece with a cross-section target keeps its even knots (a 40 m piece has one interior knot: no free point for both ends, the cup fade stays C1)', pattern: 'row 2', edits: [[X, 'c2Targets.length && D.evenKnots(length, knotM === undefined ? D.KNOT_M : knotM).length < 3 ? D.evenKnots(length, length / 4) : undefined;', 'undefined;']] },
  // D482: the banded fitWithHold (test/core_fit_banded.test.js runs beside the others here, with the public fixtures its row 1 reads)
  { id: "F1 a free point at the first column of the band is left out of the normal equations", pattern: "the banded fit equals 0.4.21", edits: [[X, "const a = col[f0 + k]; if (a < 0) continue;", "const a = col[f0 + k]; if (a < 1) continue;"]] },
  { id: "F2 the held points are left out of the residual the free points are fitted to", pattern: "the banded fit equals 0.4.21", edits: [[X, "v += held[f0 + k] * N[o + k];", "v += 0 * N[o + k];"]] },
  { id: "F3 the right-hand side is not eliminated with its row", pattern: "the banded fit equals 0.4.21", edits: [[X, " rhs[r] -= k * rhs[c]; } }", " } }"]] },
  { id: "F4 the band is two-thirds as wide (an entry past it is dropped by the typed array)", pattern: "the banded fit equals 0.4.21", edits: [[X, "W = 3 * BAND + 1", "W = 2 * BAND + 1"]] },
  { id: "F5 no partial pivoting (on uneven knots that moves only bits below the kept digits; at a column under the singular bar it decides whether the fit goes on)", pattern: "pivoting decides", edits: [[X, "if (Math.abs(A[r][at(r, c)]) > Math.abs(A[p][at(p, c)])) p = r;", "if (false) p = r;"]] },
  { id: "F6 a swapped row is copied without re-slotting", pattern: "elimination swaps rows", edits: [[X, "x[at(c, j)] = A[p][at(p, j)];", "x[at(c, j)] = A[p][at(c, j)];"]] },
  { id: "F7 the elimination stops at the first upper band (with a swap the band is twice as wide)", pattern: "elimination swaps rows", edits: [[X, "right = Math.min(m - 1, c + 2 * BAND);", "right = Math.min(m - 1, c + BAND);"]] },
  { id: "F8 the back substitution reads one upper band (with a swap there are two)", pattern: "elimination swaps rows", edits: [[X, "j <= Math.min(m - 1, c + 2 * BAND); j++) v -=", "j <= Math.min(m - 1, c + BAND); j++) v -="]] },
  { id: "F9 a singular system is solved anyway (its free points are written: NaN or a blow-up)", pattern: "singular system", edits: [[X, "if (!(Math.abs(piv) > 1e-12)) return;", "if (false) return;"]] },
  // D484: the samples are kept by the knot vector's value (rows 7 and 8); the anchor follows the line, the rule (no samples of other knots) is unchanged
  { id: "F11 the kept samples are read for a piece of the same length and as many knots, whatever the knots", pattern: "knots were replaced|one knot moved", edits: [[X, "if (kept.L === L && kept.kn.length === kn.length && kept.kn.every((x, i) => Object.is(x, kn[i]))) return kept;", "if (kept.L === L && kept.kn.length === kn.length) return kept;"]] },
  { id: "F14 the kept samples are keyed by the length alone", pattern: "knots were replaced|one knot moved", edits: [[X, "if (kept.L === L && kept.kn.length === kn.length && kept.kn.every((x, i) => Object.is(x, kn[i]))) return kept;", "if (kept.L === L) return kept;"]] },
  { id: "F12 sampleBasis reads the last level's buffer past its end (basisN reads a 0 there)", pattern: "sampleBasis gives basisN", edits: [[X, "* (j <= d - 1 ? prev[j] : 0);", "* prev[j];"]] },
  { id: "F13 sampleBasis's walk stops one span early on a knot (the binary search takes the span the knot starts)", pattern: "sampleBasis gives basisN", edits: [[X, "while (walk < nCP - 1 && s >= U[walk + 1]) walk++;", "while (walk < nCP - 1 && s > U[walk + 1]) walk++;"]] },
  { id: "F10 with no free point the fit goes on (and writes past the pins)", pattern: "no free point", edits: [[X, "if (!free.length) return;", "if (!free.length) free.push(0);"]] },
  // bank the bend: src/core/bankswing.js, which lays its halves with extend.js's rounded-linear ramp (test/core_bankswing.test.js runs beside the others here)
  { id: 'B1 the peak is not held at the peak bank', pattern: 'swing: 0°', edits: [[B, "row(pointForm(peakS, 'v'), vp);", '']] },
  { id: 'B2 the ends are not held at the bank there and the exit bank', pattern: 'swing: 0°|swing: an exit bank of', edits: [[B, "row(pointForm(s0, 'v'), v0);", ''], [B, "row(pointForm(s1, 'v'), v1);", '']] },
  { id: 'B3 the joints are not held C1 in the fit (the quantised re-set then breaks their C2)', pattern: 'swing: every joint', edits: [[B, "for (const key of ['v', 'd1']) row(", "for (const key of []) row("]] },
  { id: 'B4 the joints inside the stretch are not held C2', pattern: 'swing: every joint', edits: [[B, 'if (J >= s0 && J <= s1 && nA >= MIN_C2', 'if (false && nA >= MIN_C2']] },
  { id: 'B5 the road after an exit bank is not moved with it', pattern: 'swing: an exit bank', edits: [[B, 'mine[k] = Number((e.P.channels.phi[k] + shift).toFixed(D.DEC.phi)) + 0;', 'mine[k] = e.P.channels.phi[k];']] },
  { id: 'B6 the road after an exit bank is moved past the next jump', pattern: 'swing: an exit bank carries', edits: [[B, "for (const e of E) if (e.P.type !== 'road' && e.o >= s1 && e.o < shiftEnd) shiftEnd = e.o;", '']] },
  { id: 'B7 a jump inside the stretch is not refused', pattern: 'NOT_ROAD', edits: [[B, "for (const e of E) if (e.P.type !== 'road' && e.end > s0 && e.o < s1) throw", "for (const e of E) if (false) throw"]] },
  { id: 'B8 a half shorter than a knot span is not refused', pattern: 'TOO_SHORT', edits: [[B, 'if (b - a < span) throw', 'if (false) throw']] },
  { id: 'B9 a peak at either end of the stretch is accepted', pattern: 'BAD_RANGE', edits: [[B, 's0 < peakS && peakS < s1)) throw', 's0 <= peakS && peakS <= s1)) throw']] },
  { id: 'B10 a stretch off the end of an open track is accepted', pattern: 'BAD_RANGE', edits: [[B, 'if (s0 < 0 || s1 > roadEnd + 1e-9) throw', 'if (false) throw']] },
  { id: 'B11 a closed lap with no jump takes an exit bank (and opens a step where the swing starts)', pattern: 'SWING_REFUSED', edits: [[B, 'if (doc.closed && !(shiftEnd < s0 + total)) throw', 'if (false) throw']] },
  { id: "B12 a landing's first point is not held at its flight bank", pattern: 'just after a landing', edits: [[B, 'if (hits(b, [0])) row([{ e: b, k: 0, w: 1 }], b.P.channels.phi[0]);', '']] },
  // (no mutant on the re-set of a joint after quantising: the fit holds both sides equal to ~1e-15, so they round alike, and a quantum either way is inside
  //  checkDoc's own tolerance; 'quantising re-sets no joint' was not caught in the first run and is left out as equivalent on these tracks)
  { id: 'B14 the road either side of the stretch weighs no more than the stretch in the fit', pattern: 'swing: an exit bank of', edits: [[B, 'OUTSIDE : 1;', '1 : 1;']] },
  { id: 'B15 the rounded rate rounds over 10 m whatever the knots', pattern: 'swing: the rounded swing rolls', edits: [[B, 'Math.min(Math.max(X.BANK_ROUND_M, span), len / 4) / len', 'Math.min(X.BANK_ROUND_M, len / 4) / len']] },
  { id: 'B16 another channel is written beside the bank', pattern: 'swing: only phi', edits: [[B, '{ ...P, channels: { ...P.channels, phi: w } }', '{ ...P, channels: { ...P.channels, phi: w, kh: w } }']] },
  { id: "B17 the rounded halves blend by extend.js's quintic", pattern: 'swing: the rounded swing rolls', edits: [[X, 'if (u <= 1 - a) return (a / 2 + (u - a)) / N;', 'if (u <= 1 - a) return smoother(u);']] },
  // "at start" for the cross-section: app/core/panel.js lays a ticked bank, cup or edge over a ramp the roll amber allows (test/core_extend_at_start.test.js)
  // re-anchored (D573): the floor is F's 300 m now, not the 20 m one (app/core/panel.js F_RAMP_M); losing it lays a small change in 20 m again
  { id: 'S1 the cross-section ramp at the start loses its F floor (back to 20 m)', pattern: 'his piece|takes the roll bar|20 m floor|F\'s 300', edits: [[P, 'const want = Math.max(F_RAMP_M, (spread * Math.abs(to - from)) / START_RATE)', 'const want = Math.max(AT_START_M, (spread * Math.abs(to - from)) / START_RATE)']] },
  // re-pointed (D573): under F's 300 m floor a doubled rate shows only where the roll bar is longer than 300 m (a change past about 82 deg), so the rows that lay one run
  { id: 'S2 the cross-section ramp at the start allows twice the roll rate', pattern: 'rolls under the checker|takes the roll bar|8 to 180', edits: [[P, '(spread * Math.abs(to - from)) / START_RATE)', '(spread * Math.abs(to - from)) / (2 * START_RATE))']] },   // re-anchored with S1
  { id: 'S3 the half-piece cap of the bank never bends (a 180° bank at start rolls past the amber)', pattern: '8 to 180|cap bends', edits: [[P, 'const cap = bends && swellPeak(to - from, half) > START_RATE ? length : half;', 'const cap = half;']] },
  // a bank at start is one swell: src/core/extend.js SWELL_A (test/core_bank_swell.test.js runs beside the others here)
  // re-pointed (D573): the panel's bank at start is F now, so the swell is read where extend still lays it: the byte rows' swell over the whole piece
  { id: 'W1 the swell has its plateau back (a quarter-ramp rounding)', pattern: 'byte for byte', edits: [[X, 'const SWELL_A = 0.5;', 'const SWELL_A = 0.25;']] },
  // the two-share ramp: src/core/extend.js rampShape (test/core_bank_ramp.test.js runs beside the others here)
  { id: 'W2 the fall share is laid equal to the rise', pattern: 'follows the asked shares', edits: [[X, '(u) => rampShape(u, shape.rise, shape.fall)', '(u) => rampShape(u, shape.rise, shape.rise)']] },
  { id: 'W3 the rise share is dropped (the rate starts at its hold)', pattern: 'never turns back', edits: [[X, 'if (u < rise) return (rise * ROUND_I(u / rise)) / N;', '']] },
  { id: 'W5 a shaped bank at start is laid on the knots of the ramp alone (the rise smoothed away)', pattern: 'within 0.25', edits: [[X, 'if (shapedShort.length) {', 'if (false) {']] },
  { id: 'W6 the fall gets no knots of its own', pattern: 'within 0.25', edits: [[X, 'out.push(Lc - (fall * Lc * (j - 1)) / SHAPE_SUB);', '']] },
  { id: 'W7 the knots are spread over the length asked, not the length laid', pattern: 'within 0.25', edits: [[X, 'shapeKnots(shapeOf(ch), Math.max(ramp[ch] - (2 * ramp[ch]) / sub, ramp[ch] / sub))', 'shapeKnots(shapeOf(ch), ramp[ch])']] },
  { id: 'W8 the bank is not read again on the new knots', pattern: 'within 0.25', edits: [[X, 'rampControl(laid, ch, from[ch], targets[ch], ramp[ch], held, sub, shapeOf(ch)); if (C2_CHANNELS.has(ch)) c2Ends(laid, ch);', 'if (C2_CHANNELS.has(ch)) c2Ends(laid, ch);']] },
  { id: 'W4 the shares are not checked (a rise and fall over 1 together is laid)', pattern: 'not a ramp', edits: [[X, 'if (!(rise > 0 && fall > 0 && rise + fall <= 1 + 1e-12)) throw', 'if (false) throw']] },
  // D573, candidate F the at-start default (ids A1-A6: F is the banded fit's) (test/core_at_start_f.test.js runs beside the others here)
  { id: 'A1 a cup or edge at start gets no shape in extend (the quintic again)', pattern: 'laid as F too', edits: [[X, '(startShapes && shortRamps.includes(ch) && startShapes[ch]) || null', 'null']] },
  { id: 'A2 the panel asks the swell\'s halves, not a 20 m rise', pattern: 'his piece', edits: [[P, 'return rise >= 0.5 ? { rise: 0.5, fall: 0.5 } : { rise, fall: 1 - rise };', 'return { rise: 0.5, fall: 0.5 };']] },
  { id: 'A3 the panel sends no start shape for the cup and the edge', pattern: 'laid as F too', edits: [[P, 'else (out.startShapes = out.startShapes || {})[ch] = startShapeOf(transition[ch]);', 'else {}']] },
  { id: 'A4 the right edge does not follow the edge\'s start shape', pattern: 'laid as F too', edits: [[X, 'if (startShapes.e && !startShapes.er) startShapes = { ...startShapes, er: startShapes.e };', '']] },
  { id: 'A5 startShapes takes any channel', pattern: 'refuses what is not', edits: [[X, "if (!['c', 'e', 'er', 'w'].includes(ch)) throw", 'if (false) throw']] },
  { id: 'A6 the rise is measured on the ramp asked, not the length laid', pattern: 'his piece', edits: [[P, 'const rise = F_RISE_M / laidOf(R);', 'const rise = F_RISE_M / R;']] },
  // D574, the width at start takes F too (test/core_width_at_start_f.test.js)
  { id: 'A7 the width at start gets no start shape (the 20 m wedge again)', pattern: '32 → 55|mirrored|a 60 m piece', edits: [[P, "    if (!XS_START.has(ch) && ch !== 'w') continue;", '    if (!XS_START.has(ch)) continue;']] },
  // L135, the second bank (src/core/extend.js `second`; test/core_bank_ramp.test.js and test/core_joint_c2.test.js rows 'L135')
  // AMENDED L139 (by name, the same two mutants): the code they edit moved when one second bank became any number of changes on every field, so their anchors are L139's lines
  // AMENDED D642 (by name, the same mutant): the line it edits became the step added on top (channelFn from 0 by T − prev), so its anchor is D642's line
  { id: 'SB1 the second ramp blends by the route cubic (it starts with a curvature step at from)', pattern: 'L135 1|D642 2f', edits: [[X, "segs.push({ F, f: channelFn({ v: 0, m: 0 }, T - prev, L2, C2_CHANNELS.has(ch) ? ch : 'c', shape2) });", "segs.push({ F, f: channelFn({ v: 0, m: 0 }, T - prev, L2, ch === 'phi' ? 'kh' : C2_CHANNELS.has(ch) ? ch : 'c', ch === 'phi' ? null : shape2) });"]] },
  // AMENDED L139 R2 (rule changed: every change is the quintic now, whose unpinned end, 6.9e-7 on a 300 m bank change, is under L135 4a's C2 tolerance, where the rounded
  // and swell shapes it was written against were not): the end pin is held by L139 1 phi's 1e-9 bar, added to the pattern; L135 4a stays in it
  { id: 'SB2 the second ramp\'s end is not pinned to zero curvature (the joint after the piece steps)', pattern: 'L135 4a|L139 1 phi:', edits: [[X, 'if (C2_CHANNELS.has(ch)) endC2(out, ch);', "if (C2_CHANNELS.has(ch) && ch !== 'phi') endC2(out, ch);"]] },
  // L139, one row per family of change (src/core/extend.js changeLists and secondRamp, src/core/turnby.js solveList; test/core_changes.test.js)
  { id: 'CH1 route: a turn or climb change blends by the cubic again (a curvature step in the rate at every mark)', pattern: 'L139 4b', edits: [[X, "C2_CHANNELS.has(ch) ? ch : 'c', shape2) });", 'ch, shape2) });']] },
  { id: 'CH2 cross-section: a cup or edge change is not pinned to zero curvature at its end', pattern: 'L139 1 (c|e|er):', edits: [[X, 'if (C2_CHANNELS.has(ch)) endC2(out, ch);', "if (ch === 'phi') endC2(out, ch);"]] },
  // AMENDED D642 (rule changed: the marks no longer aim at the angle so far; each extra's height turns its own angle, added on top of the corner): the same family, on its new line
  { id: 'CH3 corner: an extra turns half its own angle (the S and the snake end off their heading)', pattern: 'L139 (9|10) |D642 2a', edits: [[T, 'const Aj = angles[j + 1] / t1;', 'const Aj = angles[j + 1] / t1 / 2;']] },
  // D642, the extra ADDS (src/core/extend.js changeLists, secondRamp; src/core/turnby.js cornerLists, solveList, cornerChangeMinM; test/core_additive.test.js)
  { id: 'AD1 a whole-piece first ramp is squeezed into [0, its first mark] again', pattern: 'D642 2c|D642 2d', edits: [[X, 'const Lof = Lof0;', 'const Lof = (ch) => (lists[ch] && lists[ch].whole ? lists[ch].items[0].from : Lof0(ch));']] },
  { id: 'AD2 a change that adds nothing at the end of a list is laid anyway (its knots move the bytes)', pattern: 'D642 1c', edits: [[X, 'items = items.slice(0, n); if (!items.length) continue;', 'if (!items.length) continue;']] },
  { id: 'AD3 an extra corner of 0 is laid anyway (its knots move the bytes)', pattern: 'D642 1a|D642 1b', edits: [[T, 'while (marks.length && angles[angles.length - 1] === 0) { marks.pop(); angles.pop(); }', '']] },
  { id: 'AD4 an extra corner rides every basis function, not only those inside its span (it leaks before its mark)', pattern: 'D642 2a|D642 2b|L139 (9|10|11) ', edits: [[T, 'U[i] >= b[j] - 1e-9 && U[i + 4] <= b[j + 1] + 1e-9 ? ', 'true ? ']] },
  { id: 'AD5 the steps are fitted with nothing held before the first mark', pattern: 'D642 2[cde]|L139 1 |L139 2', edits: [[X, 'for (let i = 0; i < n; i++) if (U[i] < p.from - 1e-9) keep.add(i);', '']] },
  { id: 'AD6 a step is the target itself, not the target less the one before (it adds the whole value again)', pattern: 'D642 2c|L139 1 |L139 2', edits: [[X, 'channelFn({ v: 0, m: 0 }, T - prev,', 'channelFn({ v: 0, m: 0 }, T,']] },
  { id: 'AD7 a change\'s shortest ignores the first ramp still moving under it', pattern: 'D642 3[de]', edits: [[X, 'share = Math.min(BASE_SHARE_MAX, baseShare(ch, base, p));', 'share = 0;']] },   // re-anchored (C's 35ef2eb6): the share is baseShare's
  // AMENDED (rule changed, 2026-11-10: an extra corner is refused only below the knot floor, as the first corner laid over its span; the base's share and the comfort bar
  // it fed are gone from turnby.js, so the mutant that dropped the share had nothing left to change). It now puts the comfort bar back, which the same rows refuse
  { id: 'AD8 an extra corner\'s shortest is the comfort bar again, not the knot floor', pattern: 'D642 3 |L139 12', edits: [[T, '  return cornerMinM(doc, opts);\n}', '  return Math.max(cornerMinM(doc, opts), 31.5 * Math.sqrt(Math.abs(deg)));\n}']] },
  // D642, C's 35ef2eb6 (R2 read 1.174 x the bar): the bank's share is its own shape's (extend.js baseShare)
  { id: 'AD9 a rounded or swell bank under the change is read as the quintic', pattern: 'D642 3e', edits: [[X, "if (shape === 'rounded' || shape === 'swell') {", 'if (false) {']] },
  { id: 'AD10 a base with no shape named is read as the quintic, not as the rounded bank of the panel', pattern: 'D642 3e', edits: [[X, "('shape' in base ? base.shape : 'rounded')", "('shape' in base ? base.shape : null)"]] },
  // D642, E's 9a1a566f §5: the bank's shortest is read off the built road (extend.js builtMin)
  { id: 'AD11 the built-road search stops where it starts (the change alone at the bar)', pattern: 'D642 3[efg]', edits: [[X, 'while (L2 < top && !ok(L2)) L2 = Math.min(top, L2 + PROBE_STEP_M);', '']] },   // re-anchored (E's 48b2ccf3): the search with no neighbour, in gridMin
  { id: 'AD12 the probe lays the first ramp as the quintic whatever its shape', pattern: 'D642 3[efg]', edits: [[X, '...(shape ? { bankShape: shape } : {})', '']] },
  { id: 'AD13 a span past the change\'s own minimum is taken without the built road probed', pattern: 'D642 3h', edits: [[X, ' && probePeak(0, gridded(a, b), base, span) <= PROBE_BAR;', ';']] },   // re-anchored (E's 48b2ccf3): the probe is the gridded change's
  // D642, E's 48b2ccf3: a drag reuses the built road (extend.js gridded, gridMin)
  { id: 'AD14 the probes are kept by the exact change, not its grid step (a drag reuses nothing)', pattern: 'D642 3i', edits: [[X, 'const gridded = (a, b) => { const d = (b - a) / (Math.PI / 180); return (Math.sign(d) * Math.ceil(Math.abs(d) / PROBE_GRID_DEG - 1e-9) * PROBE_GRID_DEG * Math.PI) / 180; };', 'const gridded = (a, b) => b - a;']] },
  { id: 'AD15 a new grid step searches from scratch, not from its neighbour', pattern: 'D642 3i', edits: [[X, 'const lo = Math.abs(dG) > Math.abs(one) + 1e-12 ? PROBE_MEMO.get(memoKey(0, dG - one, base, [-2])) : undefined, hi = PROBE_MEMO.get(memoKey(0, dG + one, base, [-2]));', 'const lo = undefined, hi = undefined;']] },
  { id: 'AD16 the grid rounds the change down (a smaller change than asked is probed)', pattern: 'D642 3i', edits: [[X, 'Math.ceil(Math.abs(d) / PROBE_GRID_DEG - 1e-9)', 'Math.floor(Math.abs(d) / PROBE_GRID_DEG + 1e-9)']] },
  // the librarian's ruling on B's §9: the probe's bar is the adapter's own 1.0
  { id: 'AD17 the bar of the probe is set back to the 0.97 margin', pattern: 'D642 3k', edits: [[X, 'const PROBE_BAR = 1.0, PROBE_STEP_M = 5,', 'const PROBE_BAR = 0.97, PROBE_STEP_M = 5,']] },
  // pane E's 72b9faf4 §2: the probe asks past the ceiling too
  { id: 'AD18 a span at or past the closed-form ceiling is taken unprobed again', pattern: 'D642 3l', edits: [[X, "  if (ch === 'phi' && share > 0) return span >= own - 1e-9 && probePeak(0, gridded(a, b), base, span) <= PROBE_BAR;", "  if (span >= ceil - 1e-9) return true;\n  if (ch === 'phi' && share > 0) return span >= own - 1e-9 && probePeak(0, gridded(a, b), base, span) <= PROBE_BAR;"]] },
];
const FILES = ['core_ramp.test.js', 'core_joint_c2.test.js', 'core_fit_banded.test.js', 'core_bankswing.test.js', 'core_extend_at_start.test.js', 'core_bank_swell.test.js', 'core_bank_ramp.test.js', 'core_at_start_f.test.js', 'core_width_at_start_f.test.js', 'core_changes.test.js', 'core_additive.test.js'];
function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-ramp-mut-'));
  for (const d of ['src', 'tools', 'app/core', 'app/camera', 'app/lib', 'app/validate-ui']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });   // the app folders app/core/panel.js loads
  fs.mkdirSync(path.join(dir, 'test')); for (const f of FILES) fs.copyFileSync(path.join(__dirname, f), path.join(dir, 'test', f));   // D459: the C2 rows too; D482: the banded fit's; bank the bend's
  fs.mkdirSync(path.join(dir, 'test', 'fixtures')); for (const f of fs.readdirSync(path.join(__dirname, 'fixtures')).filter((x) => x.endsWith('.core2.json'))) fs.copyFileSync(path.join(__dirname, 'fixtures', f), path.join(dir, 'test', 'fixtures', f));
  return dir;
}
function runTests(dir, pattern) {
  const args = ['--max-old-space-size=4096', '--test', ...(pattern ? ['--test-name-pattern', pattern] : []), ...FILES.map((f) => path.join(dir, 'test', f))];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const tap = path.join(dir, '.inner-run.tap');   // D352: a TAP copy, the only place a dead file's exit code shows
  const r = spawnSync(process.execPath, [...IR.reporterArgs(tap), ...args], { cwd: dir, env, encoding: 'utf8', timeout: 20 * 60 * 1000 });
  const crashed = IR.crashesIn(tap);   // D352: a file that died natively counts 1 failure and ran none of its tests: NOT TESTED, never caught
  if (crashed.length) throw new Error(IR.notTested(crashed));
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), out };
}
test('CONTROL: the whole of core_ramp.test.js and core_joint_c2.test.js passes on an unmutated copy of src/ and tools/', () => {
  const dir = tree();
  try { const r = runTests(dir); assert.ok(r.tests > 20 && r.fail === 0, `tests ${r.tests}, fail ${r.fail}\n${r.out.slice(-1500)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
// D352: a crashed inner run is no verdict. The stand-in puts the machine's crash (test/inner_run.js STANDIN) at the top of the first mutant's file
test('a crashed inner run reads NOT TESTED, never a verdict (the crash stand-in, D352)', () => {
  const m0 = MUTANTS[0], dir = tree();
  try {
    const f = path.join(dir, 'src', m0.edits[0][0]);
    fs.writeFileSync(f, IR.STANDIN + fs.readFileSync(f, 'utf8'));
    const said = IR.reading(() => { const r = runTests(dir, m0.pattern); return r.fail > 0 ? `caught: ${r.fail} of ${r.tests} failed` : `NOT CAUGHT: ${r.pass} pass, 0 fail`; });
    assert.match(said, IR.NOT_TESTED);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
for (const m of MUTANTS) {
  test(`mutant ${m.id}: applied, and caught by "${m.pattern}"`, (t) => {
    const dir = tree();
    try {
      for (const [file, from, to] of m.edits) {
        const f = path.join(dir, 'src', file), src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), n = src.split(from).length - 1;
        assert.equal(n, 1, `NOT APPLIED: the string occurs ${n} times in src/${file}: ${from.slice(0, 80)}`);
        fs.writeFileSync(f, src.replace(from, () => to));
      }
      const r = runTests(dir, m.pattern);
      t.diagnostic(`${m.id}: ${r.fail} of ${r.tests - r.skipped} run tests failed`);
      assert.ok(r.tests - r.skipped > 0, `the pattern "${m.pattern}" ran no test`);
      assert.ok(r.fail > 0, `NOT CAUGHT: ${r.pass} pass, 0 fail with the pattern "${m.pattern}"`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
module.exports = { MUTANTS };
