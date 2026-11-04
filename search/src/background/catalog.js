// What the app's pages show: AniList's public catalog (home rows, search, browse, airing, show pages) and the
// signed-in user's own list. Answers are cached in session storage so moving around the app stays within AniList's limits.
import { anilist } from "../lib/anilist-api.js";
import { KEYS } from "../lib/keys.js";
import { serviceForSite } from "../lib/services.js";
import { pushMalChange } from "./mal-store.js";

const MEDIA = `id title { english romaji native } coverImage { extraLarge large color } bannerImage description
  genres tags { name rank isMediaSpoiler isAdult } averageScore popularity episodes duration format status season seasonYear
  studios(isMain: true) { nodes { name } } nextAiringEpisode { airingAt episode } externalLinks { site url type color icon }`;
const BRIEF = "id title { english romaji } coverImage { large } format status episodes season seasonYear type";
const LIST_STATUS = ["CURRENT", "PLANNING", "COMPLETED", "PAUSED", "DROPPED", "REPEATING"];
const MINUTE = 60_000;
const CACHE_PREFIX = "csCache:";
const CACHE_LIMIT = 120;

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#039;": "'", "&#39;": "'", "&nbsp;": " ", "&mdash;": "—", "&ndash;": "–", "&hellip;": "…" };
export function plainText(html) {
  return String(html || "")
    .replace(/~!.*?!~/gs, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&[#\w]+;/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Only services this extension supports (Crunchyroll, Netflix, Prime, HIDIVE, Tubi, Hulu). YouTube and sites we
// don't connect to are left out of where-to-watch.
export function streamingLinks(links = []) {
  return (links || []).filter((link) => link.type === "STREAMING" && /^https:/.test(link.url || "") && serviceForSite(link.site))
    .filter((link, index, all) => all.findIndex((other) => other.site === link.site) === index)
    .map((link) => ({ site: link.site, url: link.url, color: link.color || "", icon: link.icon || "" }));
}

export function toShow(media) {
  if (!media?.id) return null;
  const title = media.title?.english || media.title?.romaji || `AniList ${media.id}`;
  return {
    id: String(media.id),
    anilistId: media.id,
    title,
    romaji: media.title?.romaji || "",
    native: media.title?.native || "",
    cover: media.coverImage?.extraLarge || media.coverImage?.large || "",
    color: media.coverImage?.color || "",
    banner: media.bannerImage || "",
    about: plainText(media.description),
    genres: (media.genres || []).filter((genre) => genre !== "Hentai"),
    tags: (media.tags || []).filter((tag) => !tag.isMediaSpoiler && !tag.isAdult && tag.rank >= 50).slice(0, 14).map((tag) => tag.name),
    score: media.averageScore || null,
    popularity: media.popularity || 0,
    episodes: media.episodes || null,
    duration: media.duration || null,
    format: media.format || "",
    status: media.status || "",
    season: media.season || "",
    year: media.seasonYear || null,
    studio: media.studios?.nodes?.[0]?.name || "",
    airing: media.nextAiringEpisode ? { at: media.nextAiringEpisode.airingAt, episode: media.nextAiringEpisode.episode } : null,
    streaming: streamingLinks(media.externalLinks),
  };
}

async function session() {
  const stored = (await chrome.storage.local.get(KEYS.session))[KEYS.session];
  return stored?.token && !(stored.expiresAt && stored.expiresAt <= Date.now()) && stored.viewer?.id ? stored : null;
}

async function cached(key, ttl, load) {
  const full = CACHE_PREFIX + key;
  const hit = (await chrome.storage.session.get(full))[full];
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const data = await load();
  const index = ((await chrome.storage.session.get(KEYS.cacheIndex))[KEYS.cacheIndex] || []).filter((item) => item !== full);
  index.push(full);
  const drop = index.splice(0, Math.max(0, index.length - CACHE_LIMIT));
  if (drop.length) await chrome.storage.session.remove(drop);
  await chrome.storage.session.set({ [full]: { at: Date.now(), data }, [KEYS.cacheIndex]: index });
  return data;
}

const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"];
export const currentSeason = (date = new Date()) => ({ season: SEASONS[Math.floor(date.getMonth() / 3)], year: date.getFullYear() });

// mine: { ids, stamp } keeps every row to shows on the user's services (ids from their catalogs, stamp naming that read).
export async function homeRows(mine = null) {
  return cached(mine ? `home:${mine.stamp}` : "home", 30 * MINUTE, async () => {
    const { season, year } = currentSeason();
    // Separate requests in parallel: AniList answers one big aliased query far slower than several small ones.
    const row = async (filters) => (await browse(filters, 1, mine)).shows.slice(0, 24);
    const [trending, thisSeason, airing, popular, top] = await Promise.all([
      row({ sort: "trending" }),
      row({ when: "now", sort: "popular" }),
      row({ status: "airing", sort: "popular" }),
      row({ sort: "popular" }),
      row({ sort: "rated" }),
    ]);
    return { season: { season, year }, trending, thisSeason, airing, popular, top };
  });
}

const SORTS = { popular: "POPULARITY_DESC", rated: "SCORE_DESC", newest: "START_DATE_DESC", trending: "TRENDING_DESC", az: "TITLE_ROMAJI", match: "SEARCH_MATCH" };

// Browse and search share one query: any mix of words, genres, tags, season, status and length.
export function browseVariables(filters = {}, page = 1) {
  const vars = { page, sort: [SORTS[filters.sort] || (filters.query ? "SEARCH_MATCH" : "POPULARITY_DESC")] };
  if (filters.query) vars.search = String(filters.query).slice(0, 100);
  const genres = (filters.genres || []).filter(Boolean);
  const tags = (filters.tags || []).filter(Boolean);
  if (genres.length) vars.genres = genres;
  if (tags.length) vars.tags = tags;
  if (filters.withoutGenres?.length) vars.withoutGenres = filters.withoutGenres;
  if (filters.withoutTags?.length) vars.withoutTags = filters.withoutTags;
  const when = String(filters.when || "");
  if (when === "now") Object.assign(vars, { season: currentSeason().season, year: currentSeason().year });
  if (when.startsWith("y:")) vars.year = Number(when.slice(2));
  if (when.startsWith("d:")) {
    const decade = Number(when.slice(2));
    Object.assign(vars, { startAfter: (decade - 1) * 10000 + 1231, startBefore: (decade + 10) * 10000 + 101 });
  }
  if (filters.status === "airing") vars.status = "RELEASING";
  if (filters.status === "finished") vars.status = "FINISHED";
  if (filters.status === "upcoming") vars.status = "NOT_YET_RELEASED";
  if (filters.length === "short") vars.epsBelow = 14;
  if (filters.length === "standard") Object.assign(vars, { epsAbove: 13, epsBelow: 27 });
  if (filters.length === "long") vars.epsAbove = 26;
  if (filters.format) vars.format = filters.format;
  return vars;
}

export async function browse(filters = {}, page = 1, mine = null) {
  const vars = browseVariables(filters, page);
  if (mine && !mine.ids.length) return { shows: [], more: false, total: 0 };
  return cached(`browse:${JSON.stringify(vars)}${mine ? `:mine:${mine.stamp}` : ""}`, 10 * MINUTE, async () => {
    const data = await anilist(`query($page: Int, $sort: [MediaSort], $search: String, $genres: [String], $tags: [String], $withoutGenres: [String],
      $withoutTags: [String], $season: MediaSeason, $year: Int, $startAfter: FuzzyDateInt, $startBefore: FuzzyDateInt, $status: MediaStatus,
      $epsAbove: Int, $epsBelow: Int, $format: MediaFormat, $ids: [Int]) {
      Page(page: $page, perPage: 40) {
        pageInfo { hasNextPage total }
        media(type: ANIME, isAdult: false, sort: $sort, search: $search, genre_in: $genres, tag_in: $tags, genre_not_in: $withoutGenres,
          tag_not_in: $withoutTags, season: $season, seasonYear: $year, startDate_greater: $startAfter, startDate_lesser: $startBefore,
          status: $status, episodes_greater: $epsAbove, episodes_lesser: $epsBelow, format: $format, id_in: $ids) { ${MEDIA} }
      }
    }`, mine ? { ...vars, ids: mine.ids } : vars);
    return { shows: (data.Page?.media || []).map(toShow).filter(Boolean), more: Boolean(data.Page?.pageInfo?.hasNextPage), total: data.Page?.pageInfo?.total || 0 };
  });
}

// Every genre and tag for the Browse filters. Genre tiles borrow banners from the home rows already loaded.
export async function browseOptions() {
  const [base, home] = await Promise.all([
    cached("browse-options", 24 * 60 * MINUTE, () => anilist("query { GenreCollection MediaTagCollection { name category isAdult } }")),
    homeRows(),
  ]);
  const pool = [...home.popular, ...home.top, ...home.trending, ...home.thisSeason, ...home.airing].filter((show) => show.banner);
  const used = new Set();
  const genres = (base.GenreCollection || []).filter((genre) => genre !== "Hentai").map((name) => {
    const art = pool.find((show) => show.genres.includes(name) && !used.has(show.id));
    if (art) used.add(art.id);
    return { name, art: art?.banner || "" };
  });
  return { genres, tags: (base.MediaTagCollection || []).filter((tag) => !tag.isAdult).map((tag) => ({ name: tag.name, category: tag.category })) };
}

export async function airingWeek(from) {
  const start = Math.floor(Number(from) / 1000) || Math.floor(Date.now() / 1000);
  return cached(`airing:${Math.floor(start / 3600)}`, 30 * MINUTE, async () => {
    const slots = [];
    for (let page = 1; page <= 8; page += 1) {
      const data = await anilist(`query($page: Int, $from: Int, $to: Int) {
        Page(page: $page, perPage: 50) {
          pageInfo { hasNextPage }
          airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) { airingAt episode media { isAdult countryOfOrigin ${MEDIA} } }
        }
      }`, { page, from: start - 1, to: start + 7 * 24 * 3600 });
      for (const slot of data.Page?.airingSchedules || []) {
        if (slot.media?.isAdult) continue;
        slots.push({ at: slot.airingAt, episode: slot.episode, show: toShow(slot.media) });
      }
      if (!data.Page?.pageInfo?.hasNextPage) break;
    }
    return { slots };
  });
}

const RELATION_ORDER = ["PREQUEL", "PARENT", "SEQUEL", "SIDE_STORY", "SPIN_OFF", "ALTERNATIVE", "SUMMARY", "OTHER"];
const RELATION_LABEL = { PREQUEL: "Prequel", SEQUEL: "Sequel", PARENT: "Main story", SIDE_STORY: "Side story", SPIN_OFF: "Spin-off", ALTERNATIVE: "Alternative", SUMMARY: "Summary", OTHER: "Related" };

export async function showDetails(anilistId) {
  const id = Number(anilistId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("That isn't an AniList anime id.");
  const data = await cached(`show:${id}`, 30 * MINUTE, () => anilist(`query($id: Int) {
    Media(id: $id, type: ANIME) { isAdult ${MEDIA}
      relations { edges { relationType node { ${BRIEF} } } }
      recommendations(perPage: 14, sort: RATING_DESC) { nodes { mediaRecommendation { ${MEDIA} } } }
    }
  }`, { id }));
  const media = data.Media;
  if (!media || media.isAdult) throw new Error("AniList has no anime with that id.");
  const related = (media.relations?.edges || [])
    .filter((edge) => edge.node?.type === "ANIME" && RELATION_LABEL[edge.relationType])
    .sort((a, b) => RELATION_ORDER.indexOf(a.relationType) - RELATION_ORDER.indexOf(b.relationType) || (a.node.seasonYear || 0) - (b.node.seasonYear || 0))
    .map((edge) => ({
      id: String(edge.node.id),
      relation: RELATION_LABEL[edge.relationType],
      title: edge.node.title?.english || edge.node.title?.romaji || "",
      cover: edge.node.coverImage?.large || "",
      format: edge.node.format || "",
      status: edge.node.status || "",
      episodes: edge.node.episodes || null,
      year: edge.node.seasonYear || null,
    }));
  const similar = (media.recommendations?.nodes || []).map((node) => toShow(node.mediaRecommendation)).filter(Boolean);
  return { show: toShow(media), related, similar };
}

// The signed-in user's list, keyed by AniList id. Not cached: it changes as they watch.
export async function myList() {
  const auth = await session();
  if (!auth) return { connected: false, entries: {}, shows: [] };
  const data = await anilist(`query($user: Int) {
    MediaListCollection(userId: $user, type: ANIME) { lists { entries { id status progress score(format: POINT_10_DECIMAL) updatedAt media { ${MEDIA} } } } }
  }`, { user: auth.viewer.id }, { token: auth.token });
  const entries = {};
  const shows = [];
  for (const list of data.MediaListCollection?.lists || []) {
    for (const item of list.entries || []) {
      const show = toShow(item.media);
      if (!show || entries[show.id]) continue;
      entries[show.id] = { entryId: item.id, status: item.status, progress: item.progress || 0, score: item.score || 0, updatedAt: item.updatedAt || 0 };
      shows.push(show);
    }
  }
  return { connected: true, entries, shows };
}

export async function saveEntry({ anilistId, status, progress }) {
  const auth = await session();
  if (!auth) throw new Error("Connect AniList in Settings to save to your list.");
  const id = Number(anilistId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("That isn't an AniList anime id.");
  if (status != null && !LIST_STATUS.includes(status)) throw new Error("Unknown list status.");
  const vars = { id, ...(status ? { status } : {}), ...(Number.isInteger(progress) && progress >= 0 ? { progress } : {}) };
  const data = await anilist(`mutation($id: Int, $status: MediaListStatus, $progress: Int) {
    SaveMediaListEntry(mediaId: $id, status: $status, progress: $progress) { id status progress score(format: POINT_10_DECIMAL) updatedAt }
  }`, vars, { token: auth.token });
  const saved = data.SaveMediaListEntry;
  const entry = { entryId: saved.id, status: saved.status, progress: saved.progress || 0, score: saved.score || 0, updatedAt: saved.updatedAt || 0 };
  // Mirror to MAL when connected and writeMal is on (never blocks the AniList save).
  pushMalChange(id, { status: entry.status, progress: entry.progress }, null).catch(() => {});
  return { entry };
}

export async function removeEntry({ entryId }) {
  const auth = await session();
  if (!auth) throw new Error("Connect AniList in Settings to change your list.");
  const id = Number(entryId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("That list entry wasn't found.");
  await anilist("mutation($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }", { id }, { token: auth.token });
  return {};
}
