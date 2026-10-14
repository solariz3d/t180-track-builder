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

module.exports = { createCheckRunner };
