// preview-stuck.test.js: node --test app/test/preview-stuck.test.js
// D336: the camera kept flying in one direction after every key was let go ("sometimes movement will become stuck in one direction and i button mash to make it
// stop", plan :587-589), while pressing the movement keys, Shift, and the right button to look. preview.js already lets go of every held key on blur and when the
// page is hidden (the 2026-09-29 runaway camera), and reads a key-up by its physical key, so ANOTHER path loses a key-up.
//
// THE HARNESS drives the REAL preview mount (app/preview/preview.js createPreview) with a fake window and document, under a model of what the host (WebView2 and
// Windows) does with input. Each rule of the model is an assumption, stated here, and the reason the harness can find the path at all:
//   H1 the native context menu: a right-button release fires `contextmenu` at the element under the pointer (the canvas, or a panel when a look drag ended over
//      one). If no listener prevents it, the host opens its own menu, and while it is open the page gets no key events, down or up, and no blur; the next press
//      outside it closes it (and is not delivered either).
//   H2 the title bar's drag: a left press on a `data-tauri-drag-region` element hands the window to the OS's move loop; until the release the page gets no key
//      events and no blur.
//   H3 blur and focus, H4 hidden and visible: no key events reach a page without focus or while it is hidden (the page DOES get the blur and the
//      visibilitychange).
//   H5 key-repeat: while a key is held the host sends repeat keydowns for the LAST key pressed only (after 300 ms, every 33 ms), and stops for good once any key
//      is released (Windows): the other held keys stay silent.
// Rows:
//   1  the fuzz (the safety net off, so a found path is not hidden by it): after every sequence that ends with every key and button released and the host
//      restored, the camera does not move. Red before the fix: the seeds kept below (H1, the menu; H2, the title-bar drag)
//   2  the context menu (H1) after a look drag that ends over a panel is prevented, so the key-ups keep coming
//   3  a press on the title bar lets go of the held keys (H2: their key-ups may never come)
//   4-7 the safety net: a held key whose repeats stop while it should still be repeating, with no keydown at all arriving, is let go; never while a key is
//      really held: alone (repeats), two together (only the last repeats), one held after another was tapped (silent, so the net does not act), and at the
//      slowest Windows repeat (1 s delay, 400 ms apart)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ADIR = process.env.APP_DIR || path.join(__dirname, '..');
const P = require(path.join(ADIR, 'preview', 'preview.js'));

// ── a small DOM: window → document → element, capture then bubble, preventDefault and stopPropagation ──────────────────────────────────────────────────────
function makeHost() {
  const L = new Map(), on = (node) => (type, f, opt) => { const capture = opt === true || !!(opt && opt.capture); const k = `${node.name}|${type}|${capture}`; if (!L.has(k)) L.set(k, []); L.get(k).push(f); };
  const off = () => {};
  const node = (name, extra = {}) => { const n = { name, ...extra }; n.addEventListener = on(n); n.removeEventListener = off; return n; };
  const doc = node('doc', { hidden: false, activeElement: null }); doc.body = node('body');
  const win = node('win', { devicePixelRatio: 1, document: doc });
  const el = (name, attrs = {}) => node(name, { attrs, matches: () => false, closest: (sel) => (sel === '[data-tauri-drag-region]' && attrs['data-tauri-drag-region'] !== undefined ? 1 : null) });
  const gl = new Proxy({ getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), getUniformLocation: (p, n) => n, getAttribLocation: () => 0 }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  const canvas = el('canvas'); Object.assign(canvas, { clientWidth: 800, clientHeight: 500, width: 0, height: 0, getContext: () => gl });
  const panel = el('panel'), title = el('title', { 'data-tauri-drag-region': '' });
  let q = [], t = 0;
  win.requestAnimationFrame = (f) => q.push(f); win.cancelAnimationFrame = () => {};
  win.step = (ms) => { t += ms; const f = q; q = []; for (const g of f) g(t); };
  const fire = (target, type, init = {}) => {
    const e = { type, target, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = true; }, ...init };
    const chain = target === win ? [win] : target === doc ? [win, doc] : [win, doc, target];
    const run = (n, capture) => { for (const f of (L.get(`${n.name}|${type}|${capture}`) || []).slice()) { f(e); if (e.stopped) return false; } return true; };
    for (const n of chain) if (!run(n, true)) return e;
    for (const n of chain.slice().reverse()) if (!run(n, false)) return e;
    return e;
  };
  return { win, doc, canvas, panel, title, fire, now: () => t };
}

// ── the host model (H1-H5) over the page: the physical keys and buttons, and what is delivered ─────────────────────────────────────────────────────────────
const KEY = { w: ['KeyW', 'w'], a: ['KeyA', 'a'], s: ['KeyS', 's'], d: ['KeyD', 'd'], q: ['KeyQ', 'q'], e: ['KeyE', 'e'], space: ['Space', ' '], ctrl: ['ControlLeft', 'Control'], shift: ['ShiftLeft', 'Shift'] };
function makeWorld(opts = {}, host = { menu: true, drag: true }) {   // host: which host rules apply (H1 menu, H2 drag), for sorting what the fuzz finds
  const H = makeHost(), G2 = require('../../src/geom/index.js'), F2 = require('../../test/geom_fixtures.js');
  const segs = [{ id: 'a', kind: 'road', length: 60, profile: F2.FLAT }];
  const shell = { getState: () => ({ resolved: { segments: segs, closed: false } }), subscribe: () => () => {} };
  const p = P.createPreview({ canvas: H.canvas, shell, win: H.win, ...opts });
  const phys = new Set(); let menu = false, osDrag = false, focused = true, hidden = false, lastPressed = null, repeatOK = false, sinceRepeat = 0, rightHeld = false;
  const open = () => !menu && !osDrag && focused && !hidden;
  const mods = () => ({ shiftKey: phys.has('shift'), ctrlKey: phys.has('ctrl'), altKey: false, metaKey: false });
  const keyEvt = (type, k, repeat = false) => { const [code, key] = KEY[k]; const shown = key.length === 1 && phys.has('shift') && /[a-z]/.test(key) ? key.toUpperCase() : key; return H.fire(H.win, type, { code, key: shown, repeat, ...mods() }); };
  const W = {
    p, H,
    press(k) { if (phys.has(k)) return; phys.add(k); lastPressed = k; repeatOK = true; sinceRepeat = -300; if (open()) keyEvt('keydown', k); },
    release(k) { if (!phys.has(k)) return; phys.delete(k); repeatOK = false; if (open()) keyEvt('keyup', k); },
    rightDown() { if (rightHeld) return; if (menu) { menu = false; return; } rightHeld = true; if (osDrag) return; H.fire(H.canvas, 'pointerdown', { button: 2, clientX: 400, clientY: 250 }); H.fire(H.canvas, 'mousedown', { button: 2, clientX: 400, clientY: 250 }); },
    rightUp(overPanel) {
      if (!rightHeld) return; rightHeld = false; if (osDrag) return;
      const at = overPanel ? H.panel : H.canvas, x = overPanel ? 900 : 420;
      H.fire(H.win, 'mousemove', { clientX: x, clientY: 260 }); H.fire(at, 'pointerup', { button: 2, clientX: x, clientY: 260 }); H.fire(at, 'mouseup', { button: 2, clientX: x, clientY: 260 });
      const c = H.fire(at, 'contextmenu', { button: 2, clientX: x, clientY: 260 }); if (!c.defaultPrevented && host.menu) menu = true;   // H1
    },
    titleDown() { if (menu) { menu = false; return; } if (osDrag) return; H.fire(H.title, 'pointerdown', { button: 0 }); H.fire(H.title, 'mousedown', { button: 0 }); osDrag = host.drag; },   // H2: the press reaches the page, then the OS has the window
    titleUp() { if (!osDrag) return; osDrag = false; H.fire(H.win, 'pointerup', { button: 0 }); H.fire(H.win, 'mouseup', { button: 0 }); },
    clickPanel() { if (menu) { menu = false; return; } if (osDrag) return; H.fire(H.panel, 'pointerdown', { button: 0 }); H.fire(H.panel, 'mousedown', { button: 0 }); H.fire(H.panel, 'pointerup', { button: 0 }); H.fire(H.panel, 'mouseup', { button: 0 }); },
    blur() { if (!focused) return; focused = false; H.fire(H.win, 'blur'); },
    focus() { if (focused) return; focused = true; H.fire(H.win, 'focus'); },
    hide() { if (hidden) return; hidden = true; H.doc.hidden = true; H.fire(H.doc, 'visibilitychange'); },
    show() { if (!hidden) return; hidden = false; H.doc.hidden = false; H.fire(H.doc, 'visibilitychange'); },
    /** ms of time, in 16 ms frames, with key-repeat (H5) for the last key pressed while no key has been released since it went down. */
    run(ms, repeat = { delay: 300, every: 33 }) {
      for (let left = ms; left > 0; left -= 16) {
        const dt = Math.min(16, left);
        if (repeatOK && lastPressed && phys.has(lastPressed)) { sinceRepeat += dt; while (sinceRepeat >= 0) { sinceRepeat -= repeat.every; if (open()) keyEvt('keydown', lastPressed, true); } }
        H.win.step(dt);
      }
    },
    setRepeatStart(delay) { sinceRepeat = -delay; },
    releaseAll() { for (const k of [...phys]) this.release(k); if (rightHeld) this.rightUp(false); this.titleUp(); },
    restore() { if (menu) menu = false; this.titleUp(); this.focus(); this.show(); },
    eye: () => p.rig.free.state().eye.slice(),
    get phys() { return phys; }, get menu() { return menu; },
  };
  H.win.step(16); H.win.step(16);
  return W;
}
const moved = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const KEYS_FUZZ = Object.keys(KEY);
/** One random sequence of `n` actions from `seed`; returns the log of what was done. */
function fuzz(W, seed, n = 40) {
  const r = rng(seed), log = [];
  for (let i = 0; i < n; i++) {
    const x = r(), k = KEYS_FUZZ[Math.floor(r() * KEYS_FUZZ.length)];
    let act;
    if (x < 0.30) { W.press(k); act = `+${k}`; }
    else if (x < 0.52) { W.release(k); act = `-${k}`; }
    else if (x < 0.60) { W.rightDown(); act = 'R+'; }
    else if (x < 0.68) { const over = r() < 0.5; W.rightUp(over); act = over ? 'R-panel' : 'R-'; }
    else if (x < 0.71) { W.titleDown(); act = 'T+'; }
    else if (x < 0.74) { W.titleUp(); act = 'T-'; }
    else if (x < 0.76) { W.clickPanel(); act = 'click'; }
    else if (x < 0.78) { W.blur(); act = 'blur'; }
    else if (x < 0.80) { W.focus(); act = 'focus'; }
    else if (x < 0.81) { W.hide(); act = 'hide'; }
    else if (x < 0.82) { W.show(); act = 'show'; }
    else { const ms = 16 * (1 + Math.floor(r() * 30)); W.run(ms); act = `${ms}ms`; }
    log.push(act);
  }
  return log;
}
/** Run seed: the sequence, then every key and button let go and the host restored; true when the camera is then still. */
function settles(seed, opts = { heldNetMs: 0 }, host, wait = 64) {
  const W = makeWorld(opts, host), log = fuzz(W, seed);
  W.releaseAll(); W.restore(); W.run(wait);
  const e0 = W.eye(); W.run(500);
  return { still: moved(W.eye(), e0) < 1e-9, log };
}

// Found red before the fix (D336), kept so each path stays covered: the menu (H1) and the title bar (H2)
// (measured on 3a26bc5's preview.js: 71 of seeds 1-400 moving, 34 of them with the menu rule alone, 55 with the title-bar rule alone, 0 with neither; 757 and
// 1226 need both, a right press that went down during a title-bar drag; all five below move on 3a26bc5)
const SEEDS_RED = [1, 6, 8, 757, 1226];
test('row 1: the fuzz: after every key and button is let go and the host restored, the camera does not move (net off), over 2000 seeds and the kept ones', () => {
  for (const seed of SEEDS_RED) { const r = settles(seed); assert.ok(r.still, `kept seed ${seed}: ${r.log.join(' ')}`); }
  const bad = [];
  for (let seed = 1; seed <= 2000; seed++) { const r = settles(seed); if (!r.still) bad.push(`${seed}: ${r.log.join(' ')}`); }
  assert.equal(bad.length, 0, `${bad.length} of 2000 sequences leave the camera moving:\n${bad.slice(0, 6).join('\n')}`);
});
test('row 1b: the fuzz with the safety net on (its default) settles too, 1.7 s after the release', () => {
  const bad = []; for (let seed = 1; seed <= 500; seed++) if (!settles(seed, {}, undefined, 1700).still) bad.push(seed);
  assert.deepEqual(bad, []);
});
test('row 2c (H1+H2): a right release whose press the page never saw (it went down during a title-bar drag) does not open the host\'s menu; a menu from the keyboard, with no release, is the page\'s', () => {
  const W = makeWorld({ heldNetMs: 0 });
  W.titleDown(); W.rightDown(); W.titleUp(); W.press('w'); W.run(100); W.rightUp(true);
  assert.equal(W.menu, false, 'the orphan release\'s menu was prevented');
  W.release('w'); W.run(64); const e0 = W.eye(); W.run(500); assert.ok(moved(W.eye(), e0) < 1e-9, 'still');
  const k = W.H.fire(W.H.panel, 'contextmenu', { button: 0 }); assert.equal(k.defaultPrevented, false, 'Shift+F10 / the menu key on a panel');
});
test('row 2 (H1): a look drag that ends over a panel does not open the host\'s menu, so W\'s key-up arrives and the camera stops', () => {
  const W = makeWorld({ heldNetMs: 0 });
  W.press('w'); W.run(100); W.rightDown(); W.run(50); W.rightUp(true);
  assert.equal(W.menu, false, 'the contextmenu was prevented');
  W.release('w'); W.run(64); const e0 = W.eye(); W.run(500); assert.ok(moved(W.eye(), e0) < 1e-9, 'still');
});
test('row 2b (H1, a control): a right click that BEGAN on a panel keeps the page\'s own menu (only the look\'s release is taken)', () => {
  const W = makeWorld({ heldNetMs: 0 });
  // first a look whose release fired no contextmenu (released outside the window), so the look's flag is left standing; then a right click on a panel
  W.H.fire(W.H.canvas, 'mousedown', { button: 2, clientX: 400, clientY: 250 }); W.H.fire(W.H.win, 'mouseup', { button: 2, clientX: 400, clientY: 250 });
  W.H.fire(W.H.panel, 'mousedown', { button: 2 }); W.H.fire(W.H.panel, 'mouseup', { button: 2 }); const c = W.H.fire(W.H.panel, 'contextmenu', { button: 2 });
  assert.equal(c.defaultPrevented, false);
});
test('row 3 (H2): a press on the title bar lets go of the held keys, whose key-ups the OS\'s move loop may take', () => {
  const W = makeWorld({ heldNetMs: 0 });
  W.press('w'); W.press('shift'); W.run(100); W.titleDown(); W.release('w'); W.release('shift'); W.titleUp();
  W.run(64); const e0 = W.eye(); W.run(500); assert.ok(moved(W.eye(), e0) < 1e-9, 'still');
});
// THE SAFETY NET (heldNetMs, default 1500 ms)
const flies = (W, ms, repeat) => { const e0 = W.eye(); W.run(ms, repeat); return moved(W.eye(), e0) > 1e-6; };
test('row 4 (net): a held key whose key-up is lost (no key-up, no repeats, no keydown at all) is let go within the net\'s time', () => {
  const W = makeWorld();
  W.press('w'); W.run(400);
  // the key-up is lost: the host stops delivering and the key is up, with no blur (H1/H2 without the fixes, or anything unknown)
  W.phys.delete('w'); W.run(1500 + 200);
  assert.ok(!flies(W, 300), 'stopped after the net');
});
test('row 5 (net): one key really held never stops: W held for 10 s with its repeats', () => {
  const W = makeWorld(); W.press('w'); W.run(200);
  for (let i = 0; i < 20; i++) assert.ok(flies(W, 500), `still flying at ${(i + 1) * 0.5 + 0.2} s`);
});
test('row 6 (net): two keys held together never stop, though only the last repeats: W then D for 10 s', () => {
  const W = makeWorld(); W.press('w'); W.run(200); W.press('d'); W.run(200);
  const a = W.eye(); W.run(10000); const b = W.eye();
  assert.ok(moved(a, b) > 1, 'flew'); const e0 = W.eye(); W.run(500); const e1 = W.eye();
  const dx = e1.map((v, i) => v - e0[i]), n = Math.hypot(...dx);
  assert.ok(n > 1e-6, 'still flying at 10 s'); W.release('d'); W.run(2500); assert.ok(flies(W, 500), 'W alone, silent after D let go, still flies 2.5 s on, past the net\'s time (the net must not act: no key should be repeating)');
});
test('row 7 (net): at the slowest Windows key-repeat (1 s before the first, then every 400 ms) a held key never stops', () => {
  const W = makeWorld(); W.press('w'); W.setRepeatStart(1000);
  for (let i = 0; i < 16; i++) assert.ok(flies(W, 500, { delay: 1000, every: 400 }), `flying at ${(i + 1) * 0.5} s`);
});
if (require.main !== module && process.env.STUCK_SORT) { for (const host of [{ menu: true, drag: true }, { menu: true, drag: false }, { menu: false, drag: true }, { menu: false, drag: false }]) { let bad = 0; for (let seed = 1; seed <= 400; seed++) if (!settles(seed, undefined, host).still) bad++; console.log(JSON.stringify(host), bad); } }
module.exports = { makeWorld, settles };
