import test from "node:test";
import assert from "node:assert/strict";
import {newState, normalizeDomains, matchesSite, observeBook, spend, badgeText, blockingRules} from "../core.js";

test("existing manuscripts calibrate with zero credits", () => {
  const state = newState();
  assert.equal(observeBook(state, {bookId: "bookA", name: "A", total: 185176}), 0);
  assert.equal(state.balanceMs, 0);
  assert.equal(state.books[0].baseline, 185176);
});

test("only increases above each book's high-water mark earn credits", () => {
  const state = newState();
  for (const total of [185176, 185186, 185180, 185186, 185187, 185176]) {
    observeBook(state, {bookId: "bookA", name: "A", total});
  }
  assert.equal(state.earned, 11);
  assert.equal(state.balanceMs, 660000);
  assert.equal(state.books[0].highWater, 185187);
});

test("books calibrate independently and share the wallet", () => {
  const state = newState();
  for (const [bookId, total] of [["a", 185176], ["a", 185178], ["b", 5000], ["b", 5003], ["a", 185179]]) {
    observeBook(state, {bookId, total});
  }
  assert.equal(state.earned, 6);
  assert.deepEqual(state.books.map(b => b.earned), [3, 3]);
});

test("phone edits and stale tabs are counted exactly once", () => {
  let state = newState();
  observeBook(state, {bookId: "a", total: 100});
  state = JSON.parse(JSON.stringify(state));
  for (const total of [120, 100, 120, 120, 125, 110]) observeBook(state, {bookId: "a", total});
  assert.equal(state.earned, 25);
});

test("fractional minutes survive switches, persistence, and exhaustion", () => {
  let state = newState();
  observeBook(state, {bookId: "a", total: 0});
  observeBook(state, {bookId: "a", total: 1});
  for (let index = 0; index < 15; index++) spend(state, 1500);
  state = JSON.parse(JSON.stringify(state));
  assert.equal(state.balanceMs, 37500);
  assert.equal(spend(state, -100), 0);
  assert.equal(spend(state, 100000), 37500);
  assert.equal(state.balanceMs, 0);
  assert.equal(state.spentMs, 60000);
});

test("a decrement never removes already-earned credits", () => {
  const state = newState();
  for (const total of [100, 110, 90]) observeBook(state, {bookId: "a", total});
  assert.equal(state.balanceMs, 600000);
});

test("invalid observations cannot alter the wallet", () => {
  const state = newState();
  for (const total of [NaN, Infinity, -1, 1.5, "100", 1000000001]) {
    assert.throws(() => observeBook(state, {bookId: "a", total}));
  }
  assert.throws(() => observeBook(state, {bookId: "", total: 0}));
  assert.deepEqual(state, newState());
});

test("domains accept URLs and normalize duplicates", () => {
  assert.deepEqual(normalizeDomains(" Reddit.com\nhttps://www.reddit.com/r/writing\nyoutube.com\n\n"), ["reddit.com", "youtube.com"]);
  assert.deepEqual(normalizeDomains(""), []);
  assert.deepEqual(normalizeDomains("https://例え.jp"), ["xn--r8jz45g.jp"]);
});

test("invalid sites and WritingHabit parent domains are rejected", () => {
  for (const value of ["*.reddit.com", "reddit.com:80", "bad site.com", "https://a:b@example.com", "file:///tmp/a", "writinghabit.app", "studio.writinghabit.app", "app"]) {
    assert.throws(() => normalizeDomains(value));
  }
});

test("matching uses hostname boundaries and web protocols", () => {
  const domains = ["reddit.com"];
  for (const url of ["https://reddit.com/r/a", "https://old.reddit.com", "http://reddit.com:8080", "https://reddit.com./"]) assert.ok(matchesSite(url, domains));
  for (const url of ["https://notreddit.com", "https://reddit.com.evil.test", "https://safe.test/reddit.com", "ftp://reddit.com", "bad"]) assert.equal(matchesSite(url, domains), false);
});

test("blocking rules disappear with any positive balance", () => {
  const state = newState();
  assert.deepEqual(blockingRules(state), []);
  state.domains = ["reddit.com"];
  assert.equal(blockingRules(state)[0].action.redirect.extensionPath, "/blocked.html");
  assert.deepEqual(blockingRules(state)[0].condition.requestDomains, ["reddit.com"]);
  state.balanceMs = 1;
  assert.deepEqual(blockingRules(state), []);
});

test("badge distinguishes zero and fractional balances", () => {
  assert.equal(badgeText(0), "0");
  assert.equal(badgeText(1), "0.1");
  assert.equal(badgeText(30000), "0.5");
  assert.equal(badgeText(60000), "1");
  assert.equal(badgeText(999 * 60000), "999");
  assert.equal(badgeText(15000 * 60000), "15k");
});
