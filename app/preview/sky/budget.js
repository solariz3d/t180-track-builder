// sky/budget.js (D495): does the sky fit the user's GPU? The renderer times its sky pass on the GPU for the first frames after a style is compiled
// (EXT_disjoint_timer_query_webgl2, TIME_ELAPSED around the pass) and gives each frame's time here. After WARM frames (shaders warming, the first draws
// of a new size), it collects SAMPLES of them; then the verdict is the 95th percentile against the budget, once, and the measuring stops.
// The budget is the sky's share of the frame: 1.5 ms of GPU time (D489 §7: under half of a 144 Hz frame with the road beside it).
//   createSkyMeter({ budgetMs = 1.5, warm = 30, samples = 90 }) -> { add(ms) -> null | verdict, verdict }
//     verdict = { over, p95, budgetMs, samples }      over: true when the p95 is above the budget
'use strict';

const BUDGET_MS = 1.5;

/** the q-th quantile of a list (nearest rank) */
function quantile(a, q) { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]; }

function createSkyMeter({ budgetMs = BUDGET_MS, warm = 30, samples = 90 } = {}) {
  if (!(Number.isFinite(budgetMs) && budgetMs > 0)) throw new Error(`sky budget: the budget is a number of ms over 0, got ${String(budgetMs)}`);
  if (!(Number.isInteger(warm) && warm >= 0)) throw new Error(`sky budget: warm is a whole number of frames, got ${String(warm)}`);
  if (!(Number.isInteger(samples) && samples > 0)) throw new Error(`sky budget: samples is a whole number of frames over 0, got ${String(samples)}`);
  const got = []; let seen = 0, verdict = null;
  return {
    add(ms) {
      if (verdict) return verdict;
      if (!(Number.isFinite(ms) && ms >= 0)) throw new Error(`sky budget: a frame's sky time is a number of ms, got ${String(ms)}`);
      if (++seen <= warm) return null;
      got.push(ms);
      if (got.length < samples) return null;
      const p95 = quantile(got, 0.95);
      verdict = { over: p95 > budgetMs, p95, budgetMs, samples: got.length };
      return verdict;
    },
    get verdict() { return verdict; },
  };
}

module.exports = { createSkyMeter, BUDGET_MS, quantile };
