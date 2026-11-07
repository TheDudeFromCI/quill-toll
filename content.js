(() => {
  const POLL_MS = 30_000;
  const BOOK_SETTLE_MS = 1000;
  let candidateBook = null;
  let readyAt = 0;
  let settleTimer;
  let lastBook = null;
  let previousDisplay = null;
  let awaitingFreshDisplay = false;
  let lastSent = "";
  let lastSentAt = 0;
  let busy = false;
  let stopped = false;

  async function reportStatus(reason, now) {
    if (now - lastSentAt < 10_000) return;
    await chrome.runtime.sendMessage({type: "trackerStatus", reason});
    lastSentAt = now;
  }

  async function sample() {
    if (busy || stopped || document.visibilityState !== "visible" || !document.hasFocus()) return;
    busy = true;
    try {
      const reading = QuillTracker.read(document, location.href);
      const now = Date.now();
      if (reading.reason) {
        candidateBook = null;
        await reportStatus(reading.reason, now);
        return;
      }
      if (lastBook && lastBook !== reading.bookId) {
        awaitingFreshDisplay = true;
        candidateBook = null;
      }
      lastBook = reading.bookId;
      if (awaitingFreshDisplay && previousDisplay?.node === reading.node && previousDisplay?.total === reading.total) {
        await reportStatus("Waiting for a fresh Overall total for this book. Reload the chapter if this persists.", now);
        return;
      }
      awaitingFreshDisplay = false;
      previousDisplay = {node: reading.node, total: reading.total};
      // Let a newly displayed book settle. A changing count within that book
      // must never delay the next reading while the writer keeps typing.
      if (candidateBook !== reading.bookId) {
        candidateBook = reading.bookId;
        readyAt = now + BOOK_SETTLE_MS;
        clearTimeout(settleTimer);
        settleTimer = setTimeout(sample, BOOK_SETTLE_MS);
        return;
      }
      const key = `${reading.bookId}:${reading.total}`;
      if (now < readyAt || (lastSent === key && now - lastSentAt < POLL_MS)) return;
      const response = await chrome.runtime.sendMessage({
        type: "wordTotal", observation: {bookId: reading.bookId, name: reading.name, total: reading.total}
      });
      if (!response?.ok) throw new Error(response?.error || "Counter update failed");
      lastSent = key;
      lastSentAt = now;
    } catch (error) {
      if (String(error).includes("Extension context invalidated")) {
        stopped = true;
        clearInterval(poll);
        clearTimeout(settleTimer);
      }
    } finally {
      busy = false;
    }
  }

  const poll = setInterval(sample, POLL_MS);
  document.addEventListener("visibilitychange", sample);
  window.addEventListener("focus", sample);
  window.addEventListener("pageshow", sample);
  sample();
})();
