export const WORD_MS = 60_000;
export const WRITING_HOST = "studio.writinghabit.app";
export const MAX_WORDS = 1_000_000_000;

export function newState() {
  return {version: 1, balanceMs: 0, earned: 0, spentMs: 0, domains: [], books: []};
}

export function normalizeDomains(text) {
  const domains = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const url = new URL(line.includes("://") ? line : `https://${line}`);
    const domain = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(domain)) {
      throw new Error(`Enter a website domain or URL without a port. Check “${line}”.`);
    }
    if (WRITING_HOST === domain || WRITING_HOST.endsWith(`.${domain}`)) {
      throw new Error("Keep WritingHabit accessible so you can earn credits.");
    }
    return domain;
  });
  return [...new Set(domains)].sort();
}

export function matchesSite(url, domains) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/\.$/, "");
    return /^https?:$/.test(parsed.protocol) && domains.some(domain =>
      hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function observeBook(state, observation, now = Date.now()) {
  const {bookId, name, total} = observation;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(bookId) || !Number.isSafeInteger(total) || total < 0 || total > MAX_WORDS) {
    throw new Error("WritingHabit reported an invalid book or word total.");
  }
  let book = state.books.find(item => item.id === bookId);
  let added = 0;
  if (!book) {
    book = {id: bookId, baseline: total, highWater: total, earned: 0};
    state.books.push(book);
  } else {
    added = Math.max(0, total - book.highWater);
    book.highWater = Math.max(total, book.highWater);
    book.earned += added;
    state.earned += added;
    state.balanceMs += added * WORD_MS;
  }
  book.name = String(name || bookId).slice(0, 200);
  book.lastTotal = total;
  book.lastSeen = now;
  return added;
}

export function spend(state, elapsed) {
  const charged = Math.min(state.balanceMs, Math.max(0, Math.round(elapsed)));
  state.balanceMs -= charged;
  state.spentMs += charged;
  return charged;
}

export function badgeText(balanceMs) {
  const credits = balanceMs / WORD_MS;
  if (!credits) return "0";
  if (credits < 1) return (Math.ceil(credits * 10) / 10).toFixed(1);
  if (credits < 1000) return String(Math.ceil(credits));
  if (credits < 1_000_000) return `${Math.floor(credits / 1000)}k`;
  return `${Math.floor(credits / 1_000_000)}m`;
}

export function blockingRules(state) {
  if (state.balanceMs > 0 || !state.domains.length) return [];
  return [{
    id: 1,
    priority: 1,
    action: {type: "redirect", redirect: {extensionPath: "/blocked.html"}},
    condition: {urlFilter: "|http", requestDomains: state.domains, resourceTypes: ["main_frame"]}
  }];
}
