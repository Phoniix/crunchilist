// Keeps the master list in IndexedDB fresh: a tiny meta file is checked first, and the full list is only
// downloaded when it changed. A failed or malformed download never replaces the copy already stored.
import { allowsRemoteFeeds } from "../lib/build-channel.js";
import { countShows, readShow, replaceShows } from "../lib/idb.js";
import { FEED_VERSION, ID_MAP_META_URL, ID_MAP_URL, decodeRow, validFeed } from "../lib/id-map.js";

export const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
export const ID_MAP_META_KEY = "ksIdMapMeta";

async function metaState() {
  return (await chrome.storage.local.get(ID_MAP_META_KEY))[ID_MAP_META_KEY] || {};
}

async function saveIdMapState(patch) {
  const current = await metaState();
  await chrome.storage.local.set({ [ID_MAP_META_KEY]: { ...current, ...patch } });
}

export const checkDue = (stored = {}, now = Date.now()) => !stored.checkedAt || now - stored.checkedAt >= CHECK_EVERY_MS;

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

async function packagedFeed(fetchImpl = fetch) {
  try {
    const response = await fetchImpl(chrome.runtime.getURL("feeds/id-map.json"));
    if (!response.ok) return null;
    const feed = await response.json();
    return validFeed(feed) ? feed : null;
  } catch {
    return null;
  }
}

async function runRefresh({ force = false, fetchImpl = fetch } = {}) {
  const stored = await metaState();
  if (!force && !checkDue(stored) && (await countShows()) > 0) return stored;
  if (!allowsRemoteFeeds()) {
    if (!(await countShows())) {
      const packed = await packagedFeed(fetchImpl);
      if (packed) {
        const { rows, ...header } = packed;
        await replaceShows(rows, header);
        await saveIdMapState({
          updated: packed.updated,
          count: rows.length,
          sources: packed.sources || ["packaged"],
          checkedAt: Date.now(),
          error: "",
        });
      }
    } else {
      await saveIdMapState({ checkedAt: Date.now(), error: "" });
    }
    return metaState();
  }
  try {
    const metaResponse = await fetchImpl(ID_MAP_META_URL, { cache: "no-cache" });
    if (!metaResponse.ok) throw new Error(`The master list check answered ${metaResponse.status}`);
    const meta = await metaResponse.json();
    const plan = refreshPlan(stored, meta, await countShows());
    if (plan === "skip") throw new Error("The master list needs a newer version of Kivori SekAI");
    if (plan === "download" || !(await countShows())) {
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
    if (!(await countShows())) {
      const packed = await packagedFeed(fetchImpl);
      if (packed) {
        const { rows, ...header } = packed;
        await replaceShows(rows, header);
        await saveIdMapState({
          updated: packed.updated,
          count: rows.length,
          sources: packed.sources || ["packaged"],
          checkedAt: Date.now(),
          error: "",
        });
        return metaState();
      }
    }
    await saveIdMapState({ checkedAt: Date.now(), error: error?.message || String(error) });
  }
  return metaState();
}

export async function getShow(anilistId) {
  const found = await readShow(Number(anilistId));
  return found ? decodeRow(found.row, found.header) : null;
}

export async function idMapStatus() {
  const { updated = "", count = 0, checkedAt = 0, error = "" } = await metaState();
  return { updated, count, checkedAt, error };
}
