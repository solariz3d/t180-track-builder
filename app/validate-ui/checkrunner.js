// checkrunner.js: the page's side of the off-thread checker (app/validate-ui/checkworker.js). No DOM; the Worker constructor is given.
//
//   const runner = createCheckRunner({ WorkerCtor, url, onAnswer, onFail })   THROWS when no worker can be made (the panel then checks on the page)
//   runner.send({ doc, dragging, csp })   posts the document; returns its serial
//   runner.pending()                      true while the newest document sent has no answer yet (the panel says "checking…")
//   runner.dispose()                      terminates the worker
//   onAnswer(out, { serial, ms, pending })  the worker's answer for document `serial` (checkjob.js run); an answer OLDER than one already
//                                          given is dropped, so the panel never steps back to an earlier document
//   onFail(message)                       the worker failed (it could not load, or a check threw): the panel shows it as "not validated"
'use strict';

function createCheckRunner({ WorkerCtor, url = 'validate-ui/checkworker.js', onAnswer = () => {}, onFail = () => {} } = {}) {
  if (typeof WorkerCtor !== 'function') throw new Error('this page has no Web Worker');
  const w = new WorkerCtor(url);
  let sent = 0, answered = 0;
  w.onmessage = (e) => {
    const m = (e && e.data) || {};
    if (!(m.serial > answered)) return;   // older than what is on screen
    answered = m.serial;
    if (!m.ok) { onFail(m.error || 'the check failed'); return; }
    onAnswer(m.out, { serial: m.serial, ms: m.ms, pending: answered < sent });
  };
  w.onerror = (e) => onFail((e && e.message) || 'the check worker failed');
  return {
    send({ doc, dragging = false, csp = true }) { sent++; w.postMessage({ serial: sent, doc, dragging: !!dragging, csp: !!csp }); return sent; },
    pending: () => answered < sent,
    dispose() { try { w.terminate(); } catch (e) { /* gone already */ } },
  };
}

/**
 * EVEN'S SENTENCE through the check job, off the page (D678 repair, U6: on a 27.6 km closed lap the release waited 33 s for it). The core shell is given this runner
 * (app/index.html) and asks it as it asks the overlap runner:
 *   runner.start(req) -> { promise, cancel() }   req: app/core/evenwords.js evenCheck's request (plain data); the promise resolves with its { message, leaves },
 *                                                 or rejects (the worker failed or the check threw; { cancelled: true } after cancel)
 * Each check gets a worker of its own (checkworker.js), made at start and ended when it answers or is cancelled: a level never waits behind the track check's
 * worker, and no worker is kept holding a long track. THROWS when the page has no Worker; start() throws when one cannot be made (the shell then checks on the page).
 */
function createEvenRunner({ WorkerCtor, url = 'validate-ui/checkworker.js' } = {}) {
  if (typeof WorkerCtor !== 'function') throw new Error('this page has no Web Worker');
  return {
    start(req) {
      const w = new WorkerCtor(url);
      let settled = false, reject = null;
      const end = () => { settled = true; w.onmessage = w.onerror = null; try { w.terminate(); } catch (e) { /* gone already */ } };
      const promise = new Promise((res, rej) => {
        reject = rej;
        w.onmessage = (e) => {
          const m = (e && e.data) || {};
          if (settled || !m.even && m.ok) return;   // not this check's answer
          end();
          if (m.ok) res(m.even); else rej(new Error(m.error || 'Even\'s check failed'));
        };
        w.onerror = (e) => { if (settled) return; end(); rej(new Error((e && e.message) || 'Even\'s check worker failed')); };
      });
      // outside the promise, so a request the worker cannot take (a DataCloneError) THROWS from start and the shell checks on the page, as the overlap runner does
      try { w.postMessage({ serial: 1, even: req }); } catch (e) { end(); throw e; }
      return { promise, cancel() { if (settled) return; end(); reject(Object.assign(new Error('cancelled'), { cancelled: true })); } };
    },
  };
}

module.exports = { createCheckRunner, createEvenRunner };
