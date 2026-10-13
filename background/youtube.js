import { cacheKeyForSeries, readCache } from "../lib/anilist.js";
import {
  YOUTUBE_FEED_URL,
  YOUTUBE_KEY,
  countryOf,
  coveredIds,
  feedDue,
  linkedIds,
  normalizeFeed,
  youtubeItems,
} from "../lib/youtube-catalog.js";
import { loadMedia } from "./store.js";

let running = null;
let memo = { key: "", items: [] };

export async function loadYoutube() {
  const stored = (await chrome.storage.local.get(YOUTUBE_KEY))[YOUTUBE_KEY];
  return normalizeFeed(stored?.feed);
}

// The feed lives in the repo, so a new list of YouTube shows reaches everyone without an extension update.
export async function refreshYoutube({ force = false, fetchImpl = fetch } = {}) {
  const stored = (await chrome.storage.local.get(YOUTUBE_KEY))[YOUTUBE_KEY] || {};
  if (!feedDue(stored, Date.now(), force)) return stored;
  running ||= (async () => {
    const next = { ...stored, checkedAt: Date.now() };
    try {
      const response = await fetchImpl(YOUTUBE_FEED_URL, { headers: { accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
      const feed = normalizeFeed(await response.json());
      if (!feed.shows.length) throw new Error("The YouTube list was empty.");
      if (feed.builtAt !== stored.feed?.builtAt) next.feed = feed;
      next.fetchedAt = next.checkedAt;
      next.error = "";
    } catch (error) {
      next.error = error?.message || "Couldn't reach GitHub";
    }
    await chrome.storage.local.set({ [YOUTUBE_KEY]: next });
    return next;
  })().finally(() => { running = null; });
  return running;
}

// AniList ids of the Crunchyroll catalog, and the ids each one links to as a sequel or prequel.
function catalogLinks(state, catalog, media) {
  const now = Date.now();
  const hits = new Map();
  const base = [];
  for (const item of [...(catalog.items || []), ...(catalog.newest || [])]) {
    const hit = readCache(state.anilistCache, cacheKeyForSeries(item.id), now);
    const id = hit?.kind === "hit" ? hit.anilistId : item.anilistId;
    if (!id) continue;
    base.push(id);
    if (hit?.kind === "hit") hits.set(id, hit);
  }
  return { base, links: (id) => [...linkedIds(hits.get(id)), ...(media[id]?.sequels || []), ...(media[id]?.prequels || [])] };
}

// The viewer's YouTube titles: playable in their country, and not a show (or a season of one) Crunchyroll has.
export async function youtubeFor(state, catalog, media = null) {
  if (state.settings?.youtubeTitles === false) return [];
  const stored = (await chrome.storage.local.get(YOUTUBE_KEY))[YOUTUBE_KEY];
  if (!stored?.feed?.shows?.length) return [];
  const country = countryOf(catalog.locale);
  const key = [stored.feed.builtAt, catalog.updatedAt, catalog.detailsAt, catalog.items.length, Object.keys(state.anilistCache || {}).length, country].join("|");
  if (memo.key === key) return memo.items;
  const nodes = media || await loadMedia();
  const { base, links } = catalogLinks(state, catalog, nodes);
  const items = youtubeItems(normalizeFeed(stored.feed), { country, covered: coveredIds(base, links) });
  memo = { key, items };
  return items;
}
