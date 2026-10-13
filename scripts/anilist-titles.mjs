// A slim local copy of AniList's titles (feeds/anilist-titles.json), so channel playlists can be matched to shows
// without one AniList search per playlist. Rebuilt in full monthly; recent years are refreshed weekly so new
// shows appear. Titles it can't place still fall back to a live AniList search in scripts/youtube-catalog.mjs.
import { readFile, writeFile } from "node:fs/promises";
import { normalizeTitle, pickMatch } from "../lib/title-match.js";

export const TITLES_FLOOR = 500;
const FULL_EVERY_MS = 30 * 24 * 60 * 60 * 1000;
const RECENT_EVERY_MS = 6 * 24 * 60 * 60 * 1000;
const FIRST_YEAR = 1960;
const FIELDS = "id title { english romaji native } synonyms format seasonYear startDate { year } episodes popularity isAdult";

// Two significant figures: enough to break title ties, and the file doesn't change every week as counts tick up.
const roughly = (value) => {
  if (!Number.isInteger(value) || value <= 0) return 0;
  const scale = 10 ** Math.max(0, String(value).length - 2);
  return Math.round(value / scale) * scale;
};

export function titleRow(media) {
  const year = media.startDate?.year || media.seasonYear || null;
  const row = { id: media.id };
  if (media.title?.english) row.e = media.title.english;
  if (media.title?.romaji) row.r = media.title.romaji;
  if (media.title?.native) row.n = media.title.native;
  const synonyms = (media.synonyms || []).filter((name) => name && name.length <= 120).slice(0, 6);
  if (synonyms.length) row.s = synonyms;
  if (media.format) row.f = media.format;
  if (year) row.y = year;
  if (media.episodes) row.ep = media.episodes;
  row.p = roughly(media.popularity);
  return row;
}

export function rowMedia(row) {
  return {
    id: row.id,
    title: { english: row.e || null, romaji: row.r || null, native: row.n || null },
    synonyms: row.s || [],
    format: row.f || null,
    seasonYear: row.y || null,
    startDate: { year: row.y || null },
    episodes: row.ep || null,
    popularity: row.p || 0,
  };
}

async function walkYears(anilist, { from, to, floor, log }) {
  const text = `query ($page: Int, $from: FuzzyDateInt, $to: FuzzyDateInt) { Page(page: $page, perPage: 50) { pageInfo { hasNextPage } media(type: ANIME, sort: ID, popularity_greater: ${floor - 1}, startDate_greater: $from, startDate_lesser: $to) { ${FIELDS} } } }`;
  const rows = [];
  // Everything before the first year goes in one window; AniList's 5,000-result cap is never near for old shows.
  const windows = [[0, from * 10000]];
  for (let year = from; year <= to; year += 1) windows.push([(year - 1) * 10000 + 1231, (year + 1) * 10000]);
  for (const [start, end] of windows) {
    for (let page = 1; page <= 100; page += 1) {
      const body = await anilist(text, { page, from: start, to: end });
      const media = body?.data?.Page?.media || [];
      for (const row of media) if (!row.isAdult) rows.push(titleRow(row));
      if (!media.length || !body.data.Page.pageInfo?.hasNextPage) break;
    }
    if (end % 50000 === 0) log(`AniList titles: ${rows.length} so far`);
  }
  return rows;
}

// Reads the saved index and brings it up to date: a full walk when it's missing or a month old, otherwise just the
// last two years and the next one (new and upcoming shows), at most weekly.
export async function refreshTitles(anilist, { path = "feeds/anilist-titles.json", now = new Date(), floor = TITLES_FLOOR, log = () => {} } = {}) {
  let saved = null;
  try {
    saved = JSON.parse(await readFile(path, "utf8"));
  } catch {
    saved = null;
  }
  const time = now.getTime();
  const thisYear = now.getUTCFullYear();
  const builtAt = Date.parse(saved?.builtAt || "") || 0;
  const refreshedAt = Date.parse(saved?.refreshedAt || "") || builtAt;
  const usable = Array.isArray(saved?.titles) && saved.titles.length && saved.floor === floor;
  let titles;
  let changed = false;
  if (!usable || time - builtAt >= FULL_EVERY_MS) {
    log("AniList titles: full rebuild");
    titles = await walkYears(anilist, { from: FIRST_YEAR, to: thisYear + 1, floor, log });
    saved = { builtAt: now.toISOString(), refreshedAt: now.toISOString(), floor };
    changed = true;
  } else if (time - refreshedAt >= RECENT_EVERY_MS) {
    log("AniList titles: refreshing recent years");
    const fresh = await walkYears(anilist, { from: thisYear - 1, to: thisYear + 1, floor, log });
    const byId = new Map(saved.titles.map((row) => [row.id, row]));
    for (const row of fresh) byId.set(row.id, row);
    titles = [...byId.values()];
    saved = { ...saved, refreshedAt: now.toISOString() };
    changed = true;
  } else {
    titles = saved.titles;
  }
  titles.sort((a, b) => a.id - b.id);
  if (changed) {
    const lines = titles.map((row) => JSON.stringify(row)).join(",\n");
    await writeFile(path, `{"builtAt":${JSON.stringify(saved.builtAt)},"refreshedAt":${JSON.stringify(saved.refreshedAt)},"floor":${floor},"titles":[\n${lines}\n]}\n`);
  }
  return { titles, changed };
}

// Every title (and the part before a subtitle colon) keyed loosely; pickMatch then decides with the same rules the
// extension uses to link Crunchyroll titles to AniList.
const looseKey = (title) => normalizeTitle(title).replace(/\bthe\b/g, " ").replace(/\s+/g, "");

export function titleIndex(rows) {
  const keys = new Map();
  const add = (key, media) => {
    if (!key) return;
    const list = keys.get(key);
    if (!list) keys.set(key, [media]);
    else if (!list.includes(media)) list.push(media);
  };
  for (const row of rows || []) {
    const media = rowMedia(row);
    for (const title of [row.e, row.r, row.n, ...(row.s || [])]) {
      if (!title) continue;
      add(looseKey(title), media);
      const head = title.split(/:\s/)[0];
      if (head !== title) add(looseKey(head), media);
    }
  }
  return {
    size: rows?.length || 0,
    candidates: (query) => keys.get(looseKey(query)) || [],
    match(query) {
      const candidates = this.candidates(query);
      if (!candidates.length) return { confidence: "none", reason: "unknown", candidates: 0 };
      return { ...pickMatch(query, candidates), candidates: candidates.length };
    },
  };
}
