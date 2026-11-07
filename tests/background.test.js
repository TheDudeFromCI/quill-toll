import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
import * as core from "../core.js";

// A deterministic Chrome API double checks worker lifecycle and event ordering.
// The separate browser smoke test exercises Chrome's real APIs.
async function startWorker(initialState = core.newState()) {
  let now = 0;
  let idle = "active";
  let focused = true;
  let data = structuredClone(initialState);
  let rules = [];
  let sequence = 0;
  const timers = new Map();
  const actions = {};
  const errors = [];
  const tabs = [{id: 1, windowId: 1, active: true, url: "https://safe.test"}];
  const event = () => ({listeners: [], addListener(fn) { this.listeners.push(fn); }});
  const chrome = {
    storage: {local: {get: async () => ({quillToll: structuredClone(data)}), set: async value => { data = structuredClone(value.quillToll); }}},
    alarms: {get: async () => ({}), create: async () => {}, onAlarm: event()},
    idle: {queryState: async () => idle, onStateChanged: event()},
    tabs: {
      query: async query => tabs.filter(tab => !query.active || tab.active).map(tab => ({...tab})),
      update: async (id, update) => Object.assign(tabs.find(tab => tab.id === id), update),
      onActivated: event(), onRemoved: event(), onUpdated: event()
    },
    windows: {get: async () => ({focused, state: "normal"}), onFocusChanged: event()},
    webNavigation: {onCommitted: event(), onHistoryStateUpdated: event()},
    runtime: {getURL: path => `chrome-extension://test/${path}`, onMessage: event(), onStartup: event(), onInstalled: event()},
    declarativeNetRequest: {getDynamicRules: async () => structuredClone(rules), updateDynamicRules: async update => { rules = structuredClone(update.addRules); }},
    action: Object.fromEntries(["setBadgeText", "setBadgeBackgroundColor", "setIcon", "setTitle"].map(name => [name, async value => { actions[name] = value; }]))
  };
  const context = vm.createContext({
    core, chrome, URL, Date, performance: {now: () => now},
    setTimeout: (fn, delay) => { timers.set(++sequence, {fn, at: now + delay}); return sequence; },
    clearTimeout: id => timers.delete(id), console: {error: (...args) => errors.push(args)}
  });
  const source = (await readFile(new URL("../background.js", import.meta.url), "utf8"))
    .replace(/^import [^\n]+/, "const {newState, normalizeDomains, matchesSite, observeBook, spend, badgeText, blockingRules, WRITING_HOST} = core;");
  vm.runInContext(source, context);
  const flush = () => vm.runInContext("queue", context);
  await flush();
  async function message(value, tracker = false) {
    const sender = tracker ? {frameId: 0, tab: {id: 2}, url: `https://studio.writinghabit.app/write/${value.observation?.bookId || "a"}/chapter`} : {url: chrome.runtime.getURL("options.html")};
    return new Promise(resolve => chrome.runtime.onMessage.listeners[0](value, sender, resolve));
  }
  async function tick(ms) {
    now += ms;
    const due = [...timers.entries()].filter(([, timer]) => timer.at <= now);
    for (const [id, timer] of due) { timers.delete(id); timer.fn(); }
    await flush();
  }
  return {
    chrome, actions, tabs, errors, message, tick,
    get data() { return data; }, get rules() { return rules; },
    set focused(value) { focused = value; }, set idle(value) { idle = value; },
    refresh: async () => { chrome.tabs.onActivated.listeners[0](); await flush(); }
  };
}

test("startup installs zero-balance rules and redirects already-open listed sites", async () => {
  const state = core.newState(); state.domains = ["blocked.test"];
  const worker = await startWorker(state);
  worker.tabs[0].url = "https://sub.blocked.test/feed";
  await worker.refresh();
  assert.equal(worker.rules.length, 1);
  assert.equal(worker.tabs[0].url, "chrome-extension://test/blocked.html");
  assert.equal(worker.errors.length, 0);
});

test("earning removes rules, checkpoints usage, and closes all listed tabs at zero", async () => {
  const state = core.newState(); state.domains = ["blocked.test"];
  const worker = await startWorker(state);
  await worker.message({type: "wordTotal", observation: {bookId: "a", total: 100}}, true);
  await worker.message({type: "wordTotal", observation: {bookId: "a", total: 101}}, true);
  assert.equal(worker.rules.length, 0);
  worker.tabs[0].url = "https://blocked.test";
  worker.tabs.push({id: 2, windowId: 1, active: false, url: "https://sub.blocked.test"});
  await worker.refresh();
  assert.equal(worker.actions.setBadgeBackgroundColor.color, "#b44b24");
  for (let n = 0; n < 12; n++) await worker.tick(5000);
  assert.equal(worker.data.balanceMs, 0);
  assert.equal(worker.data.spentMs, 60000);
  assert.equal(worker.rules.length, 1);
  assert.ok(worker.tabs.every(tab => tab.url.endsWith("/blocked.html")));
  assert.equal(worker.actions.setBadgeText.text, "0");
  assert.equal(worker.errors.length, 0);
});

test("switches, loss of focus, and lock pause without dropping partial minutes", async () => {
  const state = core.newState(); state.domains = ["blocked.test"]; state.balanceMs = 60000;
  const worker = await startWorker(state);
  worker.tabs[0].url = "https://blocked.test";
  await worker.refresh(); await worker.tick(2500);
  worker.tabs[0].url = "https://safe.test";
  await worker.refresh(); await worker.tick(5000);
  assert.equal(worker.data.balanceMs, 57500);
  worker.tabs[0].url = "https://blocked.test";
  await worker.refresh(); await worker.tick(1500);
  worker.focused = false; await worker.refresh(); await worker.tick(5000);
  assert.equal(worker.data.balanceMs, 56000);
  worker.focused = true; await worker.refresh();
  await worker.tick(5000);
  worker.idle = "locked"; await worker.refresh(); await worker.tick(5000);
  assert.equal(worker.data.balanceMs, 51000);
  assert.equal(worker.actions.setBadgeBackgroundColor.color, "#245d50");
});

test("sleep gaps and worker restarts do not charge offline time", async () => {
  const state = core.newState(); state.domains = ["blocked.test"]; state.balanceMs = 60000;
  const worker = await startWorker(state);
  worker.tabs[0].url = "https://blocked.test"; await worker.refresh();
  await worker.tick(5000); assert.equal(worker.data.balanceMs, 55000);
  await worker.tick(8 * 3600000); assert.equal(worker.data.balanceMs, 55000);
  const restarted = await startWorker(worker.data);
  await restarted.tick(3600000);
  assert.equal(restarted.data.balanceMs, 55000);
});

test("reading without input keeps counting and background listed tabs stay free", async () => {
  const state = core.newState(); state.domains = ["blocked.test"]; state.balanceMs = 60000;
  const worker = await startWorker(state);
  worker.tabs.push({id: 2, windowId: 1, active: false, url: "https://blocked.test"});
  await worker.tick(5000); assert.equal(worker.data.balanceMs, 60000);
  worker.tabs[0].url = "https://blocked.test"; worker.idle = "idle";
  await worker.refresh(); await worker.tick(5000);
  assert.equal(worker.data.balanceMs, 55000);
});

test("domain saves apply immediately and invalid input preserves the old list", async () => {
  const worker = await startWorker();
  worker.tabs[0].url = "https://blocked.test";
  const saved = await worker.message({type: "saveDomains", text: "blocked.test"});
  assert.equal(saved.ok, true);
  assert.equal(worker.tabs[0].url, "chrome-extension://test/blocked.html");
  const rejected = await worker.message({type: "saveDomains", text: "writinghabit.app"});
  assert.equal(rejected.ok, false);
  assert.deepEqual(worker.data.domains, ["blocked.test"]);
});
