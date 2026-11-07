import {newState, normalizeDomains, matchesSite, observeBook, spend, badgeText, blockingRules, WRITING_HOST} from "./core.js";

const STORAGE_KEY = "quillToll";
const HEARTBEAT_MS = 5000;
let state;
let meter = null;
let timer;
let rulesKey;
let errorMessage = "";
let trackerStatus = "Open a WritingHabit chapter to calibrate your first book.";
let trackerSeenAt = 0;
let queue = Promise.resolve();

function enqueue(task) {
  const work = queue.then(task);
  queue = work.catch(error => {
    errorMessage = error.message || String(error);
    console.error("Quill Toll", error);
    chrome.action.setBadgeText({text: "!"});
    chrome.action.setTitle({title: `Quill Toll needs attention. ${errorMessage}`});
  });
  return work;
}

const ready = (async () => {
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
  state = stored || newState();
  if (state.version !== 1) throw new Error("This saved Quill Toll data needs a compatible extension version.");
  if (!await chrome.alarms.get("quill-heartbeat")) {
    await chrome.alarms.create("quill-heartbeat", {periodInMinutes: 0.5});
  }
})();

function settle(at = performance.now()) {
  if (meter) {
    // A long discontinuity means sleep, browser shutdown, or a suspended process.
    // Keep that gap free. Normal foreground usage is checkpointed every five seconds.
    const elapsed = Math.max(0, at - meter.at);
    spend(state, elapsed <= HEARTBEAT_MS * 2 ? elapsed : 0);
    meter.at = at;
  }
}

async function save() {
  await chrome.storage.local.set({[STORAGE_KEY]: state});
}

async function syncRules() {
  const rules = blockingRules(state);
  const key = JSON.stringify(rules);
  if (key !== rulesKey) {
    const old = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds: old.map(rule => rule.id), addRules: rules});
    rulesKey = key;
  }
}

async function enforceOpenTabs() {
  if (state.balanceMs > 0 || !state.domains.length) return;
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter(tab => matchesSite(tab.pendingUrl || tab.url, state.domains)).map(async tab => {
    try { await chrome.tabs.update(tab.id, {url: chrome.runtime.getURL("blocked.html")}); }
    catch (error) {
      // A tab can disappear between query and update.
      if (!/No tab with id|Invalid tab ID/.test(error.message)) throw error;
    }
  }));
}

async function updateAction() {
  const active = !!meter && state.balanceMs > 0;
  await Promise.all([
    chrome.action.setBadgeText({text: badgeText(state.balanceMs)}),
    chrome.action.setBadgeBackgroundColor({color: active ? "#b44b24" : "#245d50"}),
    chrome.action.setIcon({path: {16: `icons/${active ? "burn" : "quill"}-16.png`, 32: `icons/${active ? "burn" : "quill"}-32.png`}}),
    chrome.action.setTitle({title: `Quill Toll · ${(state.balanceMs / 60_000).toLocaleString(undefined, {maximumFractionDigits: 3})} credits · ${active ? "spending" : "paused"}`})
  ]);
}

async function reconcile() {
  await ready;
  clearTimeout(timer);
  settle();
  await save();
  await syncRules();
  await enforceOpenTabs();
  const [tabs, idle] = await Promise.all([
    chrome.tabs.query({active: true, lastFocusedWindow: true}),
    chrome.idle.queryState(60)
  ]);
  const tab = tabs[0];
  let shouldSpend = false;
  if (tab && state.balanceMs > 0 && idle !== "locked" && matchesSite(tab.url, state.domains)) {
    try {
      const window = await chrome.windows.get(tab.windowId);
      shouldSpend = window.focused && window.state !== "minimized";
    } catch { /* The window closed while reading it. */ }
  }
  const at = performance.now();
  settle(at);
  meter = shouldSpend ? {tabId: tab.id, at} : null;
  await updateAction();
  errorMessage = "";
  if (meter) timer = setTimeout(() => enqueue(reconcile), Math.min(HEARTBEAT_MS, state.balanceMs));
}

function isTracker(sender) {
  if (sender.frameId !== 0 || !sender.tab) return false;
  try { return new URL(sender.url).origin === `https://${WRITING_HOST}`; }
  catch { return false; }
}

function isExtensionPage(sender) {
  return sender.url?.startsWith(chrome.runtime.getURL(""));
}

async function handleMessage(message, sender) {
  await ready;
  settle();
  if (message.type === "wordTotal" && isTracker(sender)) {
    const match = new URL(sender.url).pathname.match(/^\/write\/([^/]+)\//);
    if (!match || match[1] !== message.observation?.bookId) throw new Error("The book changed before its count was read.");
    const earned = observeBook(state, message.observation);
    trackerSeenAt = Date.now();
    trackerStatus = earned ? `Added ${earned.toLocaleString()} credits.` : "Overall total recorded. New words above this book’s record will earn credits.";
  } else if (message.type === "trackerStatus" && isTracker(sender)) {
    trackerStatus = String(message.reason).slice(0, 240);
    trackerSeenAt = Date.now();
  } else if (message.type === "saveDomains" && isExtensionPage(sender)) {
    try {
      state.domains = normalizeDomains(String(message.text));
    } catch (error) {
      return {ok: false, error: error.message};
    }
  } else if (!(message.type === "getState" && isExtensionPage(sender))) {
    throw new Error("Unknown or unauthorized request.");
  }
  await reconcile();
  return {ok: true, state, spending: !!meter, trackerStatus, trackerSeenAt, error: errorMessage};
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  enqueue(() => handleMessage(message, sender)).then(respond, error => respond({ok: false, error: error.message}));
  return true;
});

function refresh() { enqueue(reconcile); }
chrome.tabs.onActivated.addListener(refresh);
chrome.tabs.onRemoved.addListener(refresh);
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.url || change.status === "complete") refresh();
});
chrome.windows.onFocusChanged.addListener(refresh);
chrome.idle.onStateChanged.addListener(refresh);
chrome.webNavigation.onCommitted.addListener(details => { if (details.frameId === 0) refresh(); });
chrome.webNavigation.onHistoryStateUpdated.addListener(details => { if (details.frameId === 0) refresh(); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "quill-heartbeat") refresh(); });
chrome.runtime.onStartup.addListener(refresh);
chrome.runtime.onInstalled.addListener(refresh);
refresh();
