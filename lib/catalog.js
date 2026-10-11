export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
export const CATALOG_RETRY_MS = 60 * 60 * 1000;
export const CATALOG_PAGE_SIZE = 50;

export function normalizeLocale(input) {
  const value = String(input || "").replace("_", "-").trim();
  const match = /^([a-zA-Z]{2})-([a-zA-Z]{2})$/.exec(value);
  if (match) return `${match[1].toLowerCase()}-${match[2].toUpperCase()}`;
  if (/^en$/i.test(value) || !value) return "en-US";
  return "en-US";
}

export function normalizeCatalog(raw) {
  const items = Array.isArray(raw?.items) ? raw.items.map(normalizeTitle).filter(Boolean) : [];
  const newest = Array.isArray(raw?.newest) ? raw.newest.map(normalizeTitle).filter(Boolean).slice(0, 24) : [];
  return {
    updatedAt: Number(raw?.updatedAt) || 0,
    attemptedAt: Number(raw?.attemptedAt) || 0,
    locale: normalizeLocale(raw?.locale),
    complete: Boolean(raw?.complete),
    items,
    newest,
  };
}

export function catalogDue(meta, now = Date.now()) {
  if (!meta?.complete || !meta.updatedAt) {
    if (meta?.attemptedAt && now - meta.attemptedAt < CATALOG_RETRY_MS) return false;
    return true;
  }
  return now - meta.updatedAt >= CATALOG_TTL_MS;
}

export function browseRequestUrl({ start = 0, type, locale, sort, pageSize } = {}) {
  const url = new URL("https://www.crunchyroll.com/content/v2/discover/browse");
  url.searchParams.set("n", String(pageSize || CATALOG_PAGE_SIZE));
  url.searchParams.set("start", String(start));
  url.searchParams.set("sort_by", sort === "newly_added" ? "newly_added" : "popularity");
  url.searchParams.set("ratings", "true");
  url.searchParams.set("locale", normalizeLocale(locale));
  if (type) url.searchParams.set("type", type);
  return url.toString();
}

export function searchRequestUrl({ query, type, locale } = {}) {
  const url = new URL("https://www.crunchyroll.com/content/v2/discover/search");
  url.searchParams.set("q", String(query || ""));
  url.searchParams.set("type", type);
  url.searchParams.set("limit", "8");
  url.searchParams.set("start", "0");
  url.searchParams.set("locale", normalizeLocale(locale));
  return url.toString();
}

export function normalizeTitle(raw) {
  const id = String(raw?.id || "").trim();
  const title = String(raw?.title || raw?.name || "").replace(/\s+/g, " ").trim();
  if (!/^[A-Z0-9]{6,}$/i.test(id) || !title) return null;
  const typeRaw = String(raw?.type || raw?.media_type || "");
  const type = /movie/i.test(typeRaw) ? "movie" : "series";
  const count = raw?.series_metadata?.episode_count ?? raw?.episode_count ?? null;
  const episodes = Number.isFinite(Number(count)) && Number(count) > 0 ? Number(count) : null;
  const slug = String(raw?.slug_title || "").replace(/[^a-z0-9-]/gi, "");
  const url = slug
    ? `https://www.crunchyroll.com/series/${id}/${slug}`
    : `https://www.crunchyroll.com/series/${id}`;
  const nested = posterFrom(raw);
  const saved = httpsUrl(raw?.poster);
  const cover = httpsUrl(raw?.cover);
  const anilistId = Number(raw?.anilistId) > 0 ? Number(raw.anilistId) : null;
  return { id, title: title.slice(0, 180), url, type, episodes, poster: nested || saved, cover, anilistId };
}

function httpsUrl(value) {
  return typeof value === "string" && value.startsWith("https://") ? value : "";
}

export function displayPoster(item) {
  return httpsUrl(item?.cover) || httpsUrl(item?.poster) || "";
}

export function stampCatalogCovers(catalog, stamps) {
  const stamp = (item) => {
    const update = stamps?.[item.id];
    if (!update?.cover) return item;
    return { ...item, cover: update.cover, anilistId: update.anilistId || item.anilistId || null };
  };
  return {
    ...catalog,
    items: (catalog?.items || []).map(stamp),
    newest: (catalog?.newest || []).map(stamp),
  };
}

function posterFrom(raw) {
  const piles = [].concat(raw?.images?.poster_tall || [], raw?.images?.poster_wide || []);
  const sources = piles.flat(Infinity).map((item) => (typeof item === "string" ? item : item?.source));
  return sources.find((source) => typeof source === "string" && source.startsWith("https://")) || "";
}

export function buildHomeSections(catalog, statusFor, hideWatched, scoreFor = () => 0) {
  const statusOf = (item) => statusFor(item.id) || "unwatched";
  const visible = (item) => {
    const status = statusOf(item);
    return !(hideWatched && (status === "finished" || status === "dropped"));
  };
  const popular = (catalog?.items || []).filter(visible).slice(0, 12);
  const fresh = (catalog?.newest || []).filter(visible).slice(0, 12);
  const forYou = (catalog?.items || []).filter(visible).filter((item) => {
    const status = statusOf(item);
    return status === "unwatched" || status === "plan";
  }).sort((a, b) => scoreFor(b) - scoreFor(a));
  const forYouShown = forYou.slice(0, 12);
  const sameAsPopular = forYouShown.length > 0 && forYouShown.every((item, index) => popular[index]?.id === item.id);
  const sections = [];
  if (catalog?.continueItems?.length) sections.push({ title: "Continue", items: catalog.continueItems.slice(0, 12) });
  if (!sameAsPopular && forYouShown.length) sections.push({ title: "For you", items: forYouShown });
  if (fresh.length) sections.push({ title: "New releases", items: fresh });
  if (popular.length) sections.push({ title: "Popular", items: popular });
  return sections;
}

export function parseBrowsePayload(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const items = data.map(normalizeTitle).filter(Boolean);
  const total = Number(payload?.total ?? payload?.meta?.total);
  return { items, total: Number.isFinite(total) ? total : null };
}

export function parseSearchPayload(payload) {
  const groups = Array.isArray(payload?.data) ? payload.data : [];
  const items = [];
  const seen = new Set();
  for (const group of groups) {
    const list = Array.isArray(group?.items) ? group.items : group?.id ? [group] : [];
    for (const raw of list) {
      const item = normalizeTitle(raw);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  return items;
}

export function retainSeenCatalog(items, seenIds) {
  const seen = seenIds instanceof Set ? seenIds : new Set(seenIds || []);
  return (items || []).filter((item) => item?.id && seen.has(item.id));
}

export function mergeCatalogItems(previous, incoming) {
  const map = new Map();
  for (const item of previous || []) if (item?.id) map.set(item.id, item);
  for (const item of incoming || []) {
    if (!item?.id) continue;
    const prev = map.get(item.id) || {};
    const next = { ...prev, ...item };
    if (!item.cover && prev.cover) next.cover = prev.cover;
    if (!item.anilistId && prev.anilistId) next.anilistId = prev.anilistId;
    map.set(item.id, next);
  }
  return [...map.values()].slice(0, 5000);
}

export function rankCatalogSuggestions(items, query, { scoreFor = () => 0, forYouIds = new Set(), limit = 8 } = {}) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  const recommended = forYouIds instanceof Set ? forYouIds : new Set(forYouIds || []);
  const ranked = [];
  for (const item of items || []) {
    const title = String(item?.title || "").toLowerCase();
    if (words.some((word) => !title.includes(word))) continue;
    const starts = words.length > 0 && title.startsWith(words[0]);
    const taste = Number(scoreFor(item)) || 0;
    const titleScore = words.length ? (starts ? 100 : 40) : 0;
    const boost = recommended.has(item.id) ? 30 : 0;
    ranked.push({ item, score: titleScore + boost + taste });
  }
  ranked.sort((a, b) => b.score - a.score || String(a.item.title).localeCompare(String(b.item.title)));
  return ranked.slice(0, limit).map((entry) => entry.item);
}

const PROMPT_STOP = new Set("a an the i me my we you your is are was be it of to for and or but in on at by with from about so not no have has had do did just something show shows anime series please want wanted looking find recommend recommendation recommendations like good great best some any that this what which who how why watch watching seen see unseen new one get give need really very more than into over".split(" "));
const PROMPT_TAGS = {
  scary: ["horror"],
  spooky: ["horror"],
  funny: ["comedy"],
  hilarious: ["comedy"],
  romcom: ["romance", "comedy"],
  romantic: ["romance"],
  sad: ["drama", "tragedy"],
  cry: ["drama", "tragedy"],
  tearjerker: ["drama", "tragedy"],
  emotional: ["drama"],
  creepy: ["horror"],
  dark: ["psychological", "horror"],
  robot: ["mecha"],
  robots: ["mecha"],
};
const TITLE_SKIP = new Set("movie movies film films tonight today night weekend short long episode episodes cour season seasons after work unwind make will cry".split(" "));

function promptWords(query) {
  return String(query || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !PROMPT_STOP.has(word));
}

function labelTerms(word) {
  return [word, ...(PROMPT_TAGS[word] || [])].filter((term) => term.length >= 3);
}

function labelMatches(label, word) {
  return labelTerms(word).some((term) => label.includes(term) || (term.includes(label) && label.length >= 4));
}

export function promptMatchLabels(item, query, labels = []) {
  const words = promptWords(query);
  const found = [];
  const seen = new Set();
  for (const label of labels || []) {
    const key = String(label || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    if (!words.some((word) => labelMatches(key, word))) continue;
    seen.add(key);
    found.push(String(label).trim());
  }
  if (/\bmovies?\b/i.test(query) && item?.type === "movie") found.push("Movie");
  if (/\b(short|one[- ]cour|12 episodes?|13 episodes?)\b/i.test(query) && item?.episodes >= 10 && item?.episodes <= 13) {
    found.push("Short");
  }
  return found;
}

export function promptFallbackBrief(item, query, labels = [], about = "") {
  const sentence = String(about || "").split(/(?<=[.!?])\s/)[0].replace(/\s+/g, " ").trim();
  if (sentence) return sentence.slice(0, 180);
  const matched = promptMatchLabels(item, query, labels);
  return matched.slice(0, 3).join(", ");
}

export function promptFits(scored) {
  return new Map((scored || []).map((entry) => [entry.item.id, Math.max(0, Math.min(1, entry.score / (entry.ceiling || 200)))]));
}

export function rankPromptCandidates(items, query, options = {}) {
  return scorePromptCandidates(items, query, options).map((entry) => entry.item);
}

export function scorePromptCandidates(items, query, { scoreFor = () => 0, labelsFor = () => [], aboutFor = () => "", statusFor = () => "unwatched", limit = 12 } = {}) {
  const text = String(query || "").toLowerCase();
  const words = promptWords(text);
  const wantMovie = /\bmovies?\b/.test(text);
  const wantShort = /\b(short|one[- ]cour|12 episodes?|13 episodes?)\b/.test(text);
  const wantFresh = /\b(unwatched|not seen|haven'?t seen|haven'?t watched|new to me)\b/.test(text);
  const rows = [];
  for (const item of items || []) {
    if (!item?.id) continue;
    rows.push({ item, labels: (labelsFor(item) || []).map((label) => String(label || "").toLowerCase()) });
  }
  const genreWords = new Set(words.filter((word) => PROMPT_TAGS[word] || rows.some((row) => row.labels.some((label) => labelMatches(label, word)))));
  const ceiling = Math.max(1, words.reduce((sum, word) => sum + (genreWords.has(word) ? 120 : TITLE_SKIP.has(word) ? 0 : 100), 0)
    + (wantMovie ? 70 : 0) + (wantShort ? 50 : 0) + (wantFresh ? 20 : 0) + 20);
  const ranked = [];
  for (const { item, labels } of rows) {
    const title = String(item.title || "").toLowerCase();
    const about = String(aboutFor(item) || "").toLowerCase();
    const status = statusFor(item) || "unwatched";
    const taste = Math.max(-40, Math.min(40, Number(scoreFor(item)) || 0));
    let score = taste;
    let queryHit = false;
    for (const word of words) {
      if (!genreWords.has(word) && !TITLE_SKIP.has(word) && title.includes(word)) {
        score += title.startsWith(word) ? 100 : 40;
        queryHit = true;
      }
      const matched = labels.filter((label) => labelMatches(label, word)).length;
      if (matched) {
        score += 80 + Math.min(2, matched - 1) * 20;
        queryHit = true;
      } else if (word.length >= 4 && new RegExp(`\\b${word}\\b`).test(about)) {
        score += 35;
        queryHit = true;
      }
    }
    if (wantMovie && item.type === "movie") {
      score += 70;
      queryHit = true;
    }
    if (wantShort && item.episodes >= 10 && item.episodes <= 13) {
      score += 50;
      queryHit = true;
    }
    if (wantFresh && (status === "unwatched" || status === "plan")) score += 20;
    if (status === "finished" || status === "dropped") score -= 30;
    if ((words.length || wantMovie || wantShort) && !queryHit) score -= 200;
    ranked.push({ item, score, ceiling });
  }
  ranked.sort((a, b) => b.score - a.score || String(a.item.title).localeCompare(String(b.item.title)));
  const hits = ranked.filter((entry) => entry.score > 0);
  return (hits.length ? hits : ranked).slice(0, limit);
}

export function filterCatalog(items, query, limit = 8) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return (items || []).slice(0, limit);
  const scored = [];
  for (const item of items || []) {
    const title = item.title.toLowerCase();
    if (words.some((word) => !title.includes(word))) continue;
    scored.push({ item, starts: words.length && title.startsWith(words[0]) ? 0 : 1 });
  }
  scored.sort((a, b) => a.starts - b.starts || a.item.title.localeCompare(b.item.title));
  return scored.slice(0, limit).map((entry) => entry.item);
}

export function applyCatalogChip(items, chip, hideWatched, statusFor) {
  return (items || []).filter((item) => {
    const status = statusFor(item.id) || "unwatched";
    if (hideWatched && (status === "finished" || status === "dropped")) return false;
    if (chip === "movie" && item.type !== "movie") return false;
    if (chip === "one-cour" && !(item.episodes >= 10 && item.episodes <= 13)) return false;
    if (chip === "unwatched" && status !== "unwatched" && status !== "plan") return false;
    if (chip === "in-progress" && status !== "in_progress") return false;
    if (chip === "plan" && status !== "plan") return false;
    return true;
  });
}
