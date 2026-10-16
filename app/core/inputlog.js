// inputlog.js: the late-input log (D340, plan :904-909). The camera sometimes coasts about 3 s after its keys are let go, mid-drive, where nobody reads the HUD;
// so each late key event the preview finds (app/preview/preview.js checkLate) is also kept on disk, to be read afterwards. This is the page's half: a buffer
// that never writes on the key's own path. add() only formats the line and schedules a flush; the flush hands everything pending to `write` in ONE call, one
// write in flight at a time (lines that arrive meanwhile go in the next); past `maxPending` the oldest lines are dropped and the next write starts with
// {"dropped":N}. A write that rejects or throws is reported to onError and the log goes on; nothing throws out of add(). The native half (src-tauri/src/lib.rs
// append_input_log) appends to input-late.log in the app's data folder, off the main thread, and caps the file's size.
//
//   createInputLog({ write(text) -> Promise, schedule?(f), now?() -> Date, maxPending?, onError?(e) }) -> { add(rec), flush() }
//   one line per record, JSON: { time (ISO, the wall clock), type ('keyup' | 'keydown'), key (the physical key), lateMs, cause ('host late' | 'page busy'), frameGapMs }
'use strict';

function createInputLog({ write, schedule = (f) => setTimeout(f, 0), now = () => new Date(), maxPending = 200, onError = (e) => console.warn(`input log: ${e && e.message || e}`) } = {}) {
  if (typeof write !== 'function') throw new Error('inputlog: needs write(text)');
  let pending = [], dropped = 0, scheduled = false, writing = false;
  const report = (e) => { try { onError(e); } catch (x) { /* a reporter that throws must not stop the log */ } };
  const kick = () => { if (!scheduled && !writing && (pending.length || dropped)) { scheduled = true; schedule(flush); } };
  function flush() {
    scheduled = false;
    if (writing) return;
    const text = (dropped ? `${JSON.stringify({ dropped })}\n` : '') + pending.join('');
    pending = []; dropped = 0;
    if (!text) return;
    writing = true;
    let p; try { p = Promise.resolve(write(text)); } catch (e) { p = Promise.reject(e); }
    p.catch(report).finally(() => { writing = false; kick(); });
  }
  function add(rec) {
    try {
      pending.push(`${JSON.stringify({ time: now().toISOString(), type: rec.type, key: rec.code, lateMs: rec.lateMs, cause: rec.cause, frameGapMs: rec.longestFrameGapMs })}\n`);
      while (pending.length > maxPending) { pending.shift(); dropped++; }
      kick();
    } catch (e) { report(e); }
  }
  return { add, flush };
}

module.exports = { createInputLog };
