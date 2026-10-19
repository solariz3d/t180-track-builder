// empty_art.js: D399. Prints the empty builder's picture of a track in characters (app/index.html #empty-art): a closed loop seen from above, its two
// road edges drawn with the character that follows the edge's direction (- / | \), the start line as =. A fixed curve, so the same command prints the
// same art. Run: node scripts/empty_art.js
'use strict';
const COLS = 78, ROWS = 24, ASPECT = 2.05;   // a character cell is about twice as tall as it is wide
const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(' '));
// the centre line: a long loop with a hairpin bulge and a kink, t from 0 to 2 pi
const centre = (t) => [Math.cos(t) * (1 + 0.18 * Math.cos(2 * t)) + 0.12 * Math.sin(3 * t), Math.sin(t) * 0.62 * (1 - 0.22 * Math.cos(t)) + 0.08 * Math.sin(2 * t)];
const toCell = ([x, y]) => [Math.round((x / 1.42 + 1) / 2 * (COLS - 1)), Math.round((-y / 0.86 + 1) / 2 * (ROWS - 1))];
const charFor = (dx, dy) => { const a = Math.atan2(dy * ASPECT, dx) * 180 / Math.PI, m = ((a % 180) + 180) % 180; return m < 22.5 || m >= 157.5 ? '-' : m < 67.5 ? '/' : m < 112.5 ? '|' : '\\'; };
const N = 2400, W = 0.075;
for (let i = 0; i < N; i++) {
  const t = i / N * 2 * Math.PI, a = centre(t), b = centre(t + 1e-3), dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy), nx = -dy / l, ny = dx / l;
  for (const side of [-1, 1]) { const [c, r] = toCell([a[0] + side * W * nx, a[1] + side * W * ny]); if (r >= 0 && r < ROWS && c >= 0 && c < COLS) grid[r][c] = charFor(dx, dy); }
}
// the start line, across the road at t = 0
for (let k = -3; k <= 3; k++) { const a = centre(0), b = centre(1e-3), dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); const [c, r] = toCell([a[0] - dy / l * W * k / 3, a[1] + dx / l * W * k / 3]); if (r >= 0 && r < ROWS && c >= 0 && c < COLS) grid[r][c] = '='; }
process.stdout.write(grid.map((r) => r.join('').replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, '') + '\n');
