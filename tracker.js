/* The isolated content script reads only the labeled overall counter and book navigation. */
(() => {
  function parseTotal(value) {
    const text = value.trim();
    if (!/^\d+$/.test(text) && !/^\d{1,3}([,. \u00a0\u202f])\d{3}(?:\1\d{3})*$/.test(text)) return null;
    const total = Number(text.replace(/[, .\u00a0\u202f]/g, ""));
    return Number.isSafeInteger(total) && total <= 1_000_000_000 ? total : null;
  }

  function read(doc, href) {
    const url = new URL(href);
    const route = url.pathname.match(/^\/write\/([a-zA-Z0-9_-]{1,128})\/([a-zA-Z0-9_-]+)(?:\/|$)/);
    if (url.hostname !== "studio.writinghabit.app" || !route ||
        ["plan", "stats", "settings", "no-access", "not-found"].includes(route[2])) {
      return {reason: "Open a chapter in WritingHabit to read its Overall total."};
    }
    const bookId = route[1];
    // During SPA navigation the URL can change before the old book's DOM disappears.
    const writeLink = [...doc.querySelectorAll("a[href]")].find(link =>
      link.textContent.trim() === "Write" && link.classList.contains("MuiButton-root"));
    const displayedBook = writeLink && new URL(writeLink.href, href).pathname.split("/")[2];
    if (displayedBook !== bookId) return {reason: "Waiting for the new book to load. Reload the chapter if this persists."};

    const counters = [...doc.querySelectorAll('[aria-label="Total project words"]')]
      .filter(element => element.getClientRects().length > 0);
    if (counters.length !== 1) return {reason: "Show the Overall card and its Total in WritingHabit."};
    const node = counters[0];
    const values = [...node.children].filter(child => child.textContent.trim() !== "Total");
    const total = values.length === 1 ? parseTotal(values[0].textContent) : null;
    if (total === null) return {reason: "The Overall total is not a complete word count yet."};
    const name = doc.title.replace(/^WritingHabit\s*[|—-]\s*/i, "").trim() || bookId;
    return {bookId, name, total, node};
  }

  globalThis.QuillTracker = {read, parseTotal};
})();
