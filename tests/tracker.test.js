import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
import {parseHTML} from "linkedom";

const source = await readFile(new URL("../tracker.js", import.meta.url), "utf8");
const contentSource = await readFile(new URL("../content.js", import.meta.url), "utf8");
const base = "https://studio.writinghabit.app/write/bookA/chapterA";
function markup(book = "bookA", total = "185,176") {
  return `<html><head><title>WritingHabit | Book ${book}</title></head><body>
    <a class="MuiButton-root" href="https://studio.writinghabit.app/write/${book}/chapterA">Write</a>
    <div>Overall</div><div aria-label="Total project words"><div>Total</div><div>${total}</div></div>
    <div>Today <span>72</span></div></body></html>`;
}
function documentFrom(html) {
  const {document} = parseHTML(html);
  // linkedom supplies HTML semantics. It does not implement a layout engine.
  for (const element of document.querySelectorAll("*")) element.getClientRects = () => [1];
  return document;
}
function reader() {
  const context = vm.createContext({URL});
  vm.runInContext(source, context);
  return context.QuillTracker;
}

test("extracts only the labeled project total and stable book ID", () => {
  const reading = reader().read(documentFrom(markup()), base);
  assert.equal(reading.bookId, "bookA");
  assert.equal(reading.name, "Book bookA");
  assert.equal(reading.total, 185176);
});

test("handles integer and grouped word counts, rejecting partial values", () => {
  const {parseTotal} = reader();
  for (const value of ["185,176", "185.176", "185 176", "185\u202f176", "185\u00a0176", "185176"]) {
    assert.equal(parseTotal(value), 185176);
  }
  assert.equal(parseTotal("0"), 0);
  assert.equal(parseTotal("1,000,000"), 1000000);
  for (const value of ["", "185k", "1,23", "185,176.5", "NaN", "-100", "1000000001", "185,176,5", "185,176.000"]) assert.equal(parseTotal(value), null);
});

test("chapter changes preserve book identity and other views are ignored", () => {
  const doc = documentFrom(markup());
  assert.equal(reader().read(doc, base.replace("chapterA", "chapterB")).bookId, "bookA");
  for (const url of ["https://studio.writinghabit.app/", base.replace("chapterA", "plan"), base.replace("chapterA", "settings/details"), base.replace("chapterA", "stats")]) {
    assert.ok(reader().read(doc, url).reason);
  }
});

test("rejects stale old-book DOM during navigation", () => {
  const result = reader().read(documentFrom(markup()), base.replace("bookA", "bookB"));
  assert.match(result.reason, /new book/);
});

test("hidden, missing, duplicate, and incomplete counters fail closed", () => {
  const tracker = reader();
  const doc = documentFrom(markup());
  doc.querySelector('[aria-label="Total project words"]').getClientRects = () => [];
  assert.ok(tracker.read(doc, base).reason);
  assert.ok(tracker.read(documentFrom(markup().replace("Total project words", "chapter words")), base).reason);
  assert.ok(tracker.read(documentFrom(markup("bookA", "Loading…")), base).reason);
  const duplicate = documentFrom(markup().replace("</body>", '<div aria-label="Total project words"><div>Total</div><div>1</div></div></body>'));
  assert.ok(tracker.read(duplicate, base).reason);
});

function startContentScript() {
  let now = 0;
  let sequence = 0;
  let focused = true;
  const timers = new Map();
  const windowEvents = new Map();
  const sent = [];
  const document = documentFrom(markup());
  document.addEventListener = () => {};
  document.visibilityState = "visible";
  document.hasFocus = () => focused;
  const location = {href: base};
  function schedule(fn, delay, repeating = false) {
    const id = ++sequence;
    timers.set(id, {fn, at: now + delay, repeat: repeating ? delay : 0});
    return id;
  }
  const context = vm.createContext({
    URL, document, location, Date: {now: () => now},
    setInterval: (fn, delay) => schedule(fn, delay, true), clearInterval: id => timers.delete(id),
    setTimeout: schedule, clearTimeout: id => timers.delete(id),
    window: {addEventListener(type, fn) { windowEvents.set(type, fn); }},
    chrome: {runtime: {sendMessage: async message => { sent.push(message); return {ok: true}; }}}
  });
  vm.runInContext(source, context); vm.runInContext(contentSource, context);
  return {
    document, location,
    get readings() { return sent.filter(m => m.type === "wordTotal").map(m => m.observation); },
    setTotal(value) { document.querySelector('[aria-label="Total project words"]').lastElementChild.textContent = value; },
    blur() { focused = false; },
    async focus() { focused = true; await windowEvents.get("focus")(); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        const [id, timer] = next;
        now = timer.at;
        if (timer.repeat) timer.at += timer.repeat;
        else timers.delete(id);
        await timer.fn();
      }
      now = end;
    }
  };
}

test("content script reads live totals every 30 seconds without waiting for typing to stop", async () => {
  const script = startContentScript();
  await script.advance(1000);
  assert.deepEqual(script.readings.map(r => r.total), [185176]);
  await script.advance(28_500);
  script.setTotal("185,177");
  await script.advance(499);
  script.setTotal("185,178");
  assert.equal(script.readings.length, 1);
  await script.advance(1);
  assert.deepEqual(script.readings.map(r => r.total), [185176, 185178]);
  script.setTotal("185,179");
  await script.advance(30_000);
  assert.deepEqual(script.readings.map(r => r.total), [185176, 185178, 185179]);
});

test("content script skips unfocused and hidden pages and checks immediately on focus", async () => {
  const script = startContentScript();
  await script.advance(1000);
  script.blur();
  script.setTotal("185,180");
  await script.advance(60_000);
  assert.equal(script.readings.length, 1);
  script.document.visibilityState = "hidden";
  await script.focus();
  await script.advance(30_000);
  assert.equal(script.readings.length, 1);
  script.document.visibilityState = "visible";
  await script.focus();
  assert.deepEqual(script.readings.map(r => r.total), [185176, 185180]);
});

test("content script waits for a fresh counter when switching books", async () => {
  const script = startContentScript();
  await script.advance(1000);
  script.location.href = base.replace("bookA", "bookB");
  await script.advance(30_000);
  script.document.querySelector("a").href = script.location.href;
  await script.advance(30_000);
  assert.equal(script.readings.length, 1);
  script.setTotal("5,000");
  await script.advance(30_000);
  assert.equal(script.readings.length, 2);
  assert.equal(script.readings[1].bookId, "bookB");
  assert.equal(script.readings[1].total, 5000);
});
