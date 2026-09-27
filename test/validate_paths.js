// validate_paths.js: hand-made paths for the validation tests, in C's buildPath shape (docs/INTERFACES.md §2), so the
// tests do not depend on the geometry core. Every sample carries s, seg, pos, T, L, U and kvec; L = U × T.
'use strict';

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const flat = (half = 5) => ({ font: 'flat', u: [-half, 0, half], psi: [0, 0, 0], material: 'ROAD' });
const seg = (o = {}) => ({ id: o.id || 'w', word: 'straight', kind: 'road', speed: null, profile: flat(), ...o });

/** A straight along +Z from `start`, `len` m, sampled every `step` m; `grade` is rise over run. */
function straight(len, { step = 1, seg: g = 0, start = [0, 0, 0], s0 = 0, grade = 0 } = {}) {
  const c = Math.hypot(1, grade), T = [0, grade / c, 1 / c], U = [0, 1 / c, -grade / c], L = cross(U, T), out = [];
  for (let k = 0; k * step <= len + 1e-9; k++) { const d = k * step; out.push({ s: s0 + d, seg: g, pos: [start[0] + T[0] * d, start[1] + T[1] * d, start[2] + T[2] * d], T, L, U, kvec: [0, 0, 0] }); }
  return out;
}

/** A flat LEFT turn of radius R through `angle` rad, starting at `start` heading +Z. */
function leftTurn(R, angle, { step = 1, seg: g = 0, start = [0, 0, 0], s0 = 0 } = {}) {
  const out = [], n = Math.round(R * angle / step);
  for (let k = 0; k <= n; k++) {
    const th = angle * k / n, T = [Math.sin(th), 0, Math.cos(th)], U = [0, 1, 0], L = cross(U, T);
    out.push({ s: s0 + R * th, seg: g, pos: [start[0] + R - R * Math.cos(th), start[1], start[2] + R * Math.sin(th)], T, L, U, kvec: [L[0] / R, 0, L[2] / R] });
  }
  return out;
}

/** A vertical loop of radius R (nosing up), a full circle: the road's up axis points at the centre. */
function loop(R, { step = 1, seg: g = 0, s0 = 0 } = {}) {
  const out = [], n = Math.round(2 * Math.PI * R / step);
  for (let k = 0; k <= n; k++) {
    const th = 2 * Math.PI * k / n, T = [0, Math.sin(th), Math.cos(th)], U = [0, Math.cos(th), -Math.sin(th)], L = cross(U, T);
    out.push({ s: s0 + R * th, seg: g, pos: [0, R - R * Math.cos(th), R * Math.sin(th)], T, L, U, kvec: [U[0] / R, U[1] / R, U[2] / R] });
  }
  return out;
}

const pathOf = (samples, closed = false) => ({ lengthM: samples[samples.length - 1].s - samples[0].s, closed, twist: 0, samples });

module.exports = { straight, leftTurn, loop, flat, seg, pathOf, cross };
