// Keeps the master list in IndexedDB fresh: a tiny meta file is checked first, and the full list is only
// downloaded when it changed. A failed or malformed download never replaces the copy already stored.
import { countShows, readShow, replaceShows } from "../lib/idb.js";
import { FEED_VERSION, ID_MAP_META_URL, ID_MAP_URL, decodeRow, validFeed } from "../lib/id-map.js";
import { KEYS } from "../lib/keys.js";

export const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;

async function feedState() {
  return (await chrome.storage.local.get(KEYS.feeds))[KEYS.feeds] || {};
}

async function saveIdMapState(patch) {
  const feeds = await feedState();
  await chrome.storage.local.set({ [KEYS.feeds]: { ...feeds, idMap: { ...feeds.idMap, ...patch } } });
}

export const checkDue = (stored = {}, now = Date.now()) => !stored.checkedAt || now - stored.checkedAt >= CHECK_EVERY_MS;

// What a refresh should do, given what's stored and what the meta file says.
export function refreshPlan(stored = {}, meta, storedCount = 0) {
  if (!meta || meta.version !== FEED_VERSION) return "skip";
  if (stored.updated === meta.updated && storedCount && storedCount === meta.stats?.total) return "same";
  return "download";
}

let running = null;

export function refreshIdMap(options = {}) {
  running ||= runRefresh(options).finally(() => { running = null; });
  return running;
}

async function runRefresh({ force = false, fetchImpl = fetch } = {}) {
  const stored = (await feedState()).idMap || {};
  if (!force && !checkDue(stored)) return stored;
  try {
    const metaResponse = await fetchImpl(ID_MAP_META_URL, { cache: "no-cache" });
    if (!metaResponse.ok) throw new Error(`The master list check answered ${metaResponse.status}`);
    const meta = await metaResponse.json();
    const plan = refreshPlan(stored, meta, await countShows());
    if (plan === "skip") throw new Error("The master list needs a newer version of Crunchilist Search");
    if (plan === "download") {
      const response = await fetchImpl(ID_MAP_URL, { cache: "no-cache" });
      if (!response.ok) throw new Error(`The master list download answered ${response.status}`);
      const feed = await response.json();
      if (!validFeed(feed)) throw new Error("The downloaded master list looked wrong, so the stored one was kept");
      const { rows, ...header } = feed;
      await replaceShows(rows, header);
      await saveIdMapState({ updated: feed.updated, count: rows.length, sources: feed.sources });
    }
    await saveIdMapState({ checkedAt: Date.now(), error: "" });
  } catch (error) {
    await saveIdMapState({ checkedAt: Date.now(), error: error?.message || String(error) });
  }
  return (await feedState()).idMap;
}

export async function getShow(anilistId) {
  const found = await readShow(Number(anilistId));
  return found ? decodeRow(found.row, found.header) : null;
}

export async function idMapStatus() {
  const { updated = "", count = 0, checkedAt = 0, error = "" } = (await feedState()).idMap || {};
  return { updated, count, checkedAt, error };
}
