// Keeps the Netflix / Prime / Hulu gap map fresh from the weekly feed (same pattern as YouTube).
import {
  WHERE_MAP_KEY,
  WHERE_MAP_META_KEY,
  WHERE_MAP_META_URL,
  WHERE_MAP_URL,
  WHERE_MAP_VERSION,
  cleanWhereMap,
} from "../lib/where-map.js";

async function metaState() {
  return (await chrome.storage.local.get(WHERE_MAP_META_KEY))[WHERE_MAP_META_KEY] || {};
}

async function saveMeta(patch) {
  const current = await metaState();
  await chrome.storage.local.set({ [WHERE_MAP_META_KEY]: { ...current, ...patch } });
}

export function whereRefreshPlan(stored = {}, meta) {
  if (!meta || meta.version !== WHERE_MAP_VERSION) return "skip";
  if (stored.updated === meta.updated) return "same";
  return "download";
}

let running = null;

export function refreshWhereMap(options = {}) {
  running ||= runRefresh(options).finally(() => { running = null; });
  return running;
}

async function packagedFeed(fetchImpl = fetch) {
  try {
    const response = await fetchImpl(chrome.runtime.getURL("feeds/where-map.json"));
    if (!response.ok) return null;
    return cleanWhereMap(await response.json());
  } catch {
    return null;
  }
}

async function runRefresh({ force = false, fetchImpl = fetch } = {}) {
  const stored = await metaState();
  const have = await loadGaps();
  if (!force && stored.checkedAt && Date.now() - stored.checkedAt < 12 * 60 * 60 * 1000 && Object.keys(have).length) {
    return have;
  }
  try {
    const metaResponse = await fetchImpl(WHERE_MAP_META_URL, { cache: "no-cache" });
    if (!metaResponse.ok) throw new Error(`Where-to-watch map check answered ${metaResponse.status}`);
    const meta = await metaResponse.json();
    const plan = whereRefreshPlan(stored, meta);
    if (plan === "skip") throw new Error("The where-to-watch map needs a newer Kivori SekAI");
    if (plan === "download" || !Object.keys(have).length) {
      const response = await fetchImpl(WHERE_MAP_URL, { cache: "no-cache" });
      if (!response.ok) throw new Error(`Where-to-watch map download answered ${response.status}`);
      const cleaned = cleanWhereMap(await response.json());
      if (!cleaned) throw new Error("The where-to-watch map looked wrong, so the stored one was kept");
      await chrome.storage.local.set({ [WHERE_MAP_KEY]: cleaned });
      await saveMeta({ updated: cleaned.updated, count: Object.keys(cleaned.links).length, source: cleaned.source });
    }
    await saveMeta({ checkedAt: Date.now(), error: "" });
  } catch (error) {
    if (!Object.keys(have).length) {
      const packed = await packagedFeed(fetchImpl);
      if (packed && Object.keys(packed.links).length) {
        await chrome.storage.local.set({ [WHERE_MAP_KEY]: packed });
        await saveMeta({
          updated: packed.updated,
          count: Object.keys(packed.links).length,
          source: packed.source || "packaged",
          checkedAt: Date.now(),
          error: "",
        });
        return packed.links;
      }
    }
    await saveMeta({ checkedAt: Date.now(), error: error?.message || String(error) });
  }
  return loadGaps();
}

export async function loadGaps() {
  const stored = (await chrome.storage.local.get(WHERE_MAP_KEY))[WHERE_MAP_KEY];
  const cleaned = cleanWhereMap(stored);
  return cleaned?.links || {};
}

export async function whereMapStatus() {
  const { updated = "", count = 0, checkedAt = 0, error = "", source = "" } = await metaState();
  return { updated, count, checkedAt, error, source };
}
