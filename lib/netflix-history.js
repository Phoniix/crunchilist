// Netflix viewing activity: the profile's activity pages and the "Download all" CSV, turned into seasons.
// Netflix doesn't give episode numbers, so each distinct episode watched in a season counts once, in the order first played.
import { looseKey } from "./match-engine.js";

const WATCHED_SHARE = 0.8;
const GENERIC_SEASON = /^(?:limited series|miniseries|mini series|collection|the series|series)$/i;
const SEASON_PART = /^(?:season|part|volume|vol\.|chapter|book|series|collection|limited series|miniseries)\b/i;

const text = (value, max = 200) => (typeof value === "string" ? value.trim().slice(0, max) : "");

// Netflix also streams live-action versions under these anime names; matches on them always wait for the user's pick.
export const LIVE_ACTION_NAMES = new Set([
  "one piece", "cowboy bebop", "yu yu hakusho", "death note", "fullmetal alchemist", "bleach", "alice in borderland",
  "kakegurui", "erased", "kingdom", "city hunter", "rurouni kenshin", "tokyo ghoul", "parasyte", "ghost in the shell",
  "golden kamuy", "kaiji", "liar game", "gintama", "the promised neverland", "my happy marriage", "sakamoto days",
  "kaguya sama love is war", "assassination classroom", "blade of the immortal", "inuyashiki", "nana", "thermae romae",
].map((name) => looseKey(name)));

// "Hunter X Hunter (2011)" -> name "Hunter X Hunter", year 2011.
export function splitYear(name) {
  const match = /^(.*\S)\s*\((\d{4})\)$/.exec(name || "");
  return match ? { name: match[1], year: Number(match[2]) } : { name: name || "", year: null };
}

export function seasonNumberOf(season) {
  const match = /\bseason\s+(\d{1,3})\b/i.exec(season || "");
  return match ? Number(match[1]) : null;
}

/** Absolute episode number from Netflix labels ("Episode 14", "E14", "S1:E12", "1x12", "#12"). Null when unknown. */
export function episodeNumberOf(episode) {
  const text = String(episode || "").trim();
  if (!text) return null;
  const seasonEp = /\bS\d{1,2}\s*[:.\-–]?\s*E(\d{1,4})\b/i.exec(text)
    || /\b(\d{1,2})\s*[x×]\s*(\d{1,4})\b/i.exec(text);
  if (seasonEp) {
    const n = Number(seasonEp[2] != null ? seasonEp[2] : seasonEp[1]);
    if (Number.isInteger(n) && n > 0 && n < 10000) return n;
  }
  const match = /(?:^|[^\p{L}\p{N}])(?:episode|ep\.?|e|#)\s*(\d{1,4})\b/iu.exec(` ${text}`)
    || /^(\d{1,4})\s*[-–:.]\s*\S/u.exec(text);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 && n < 10000 ? n : null;
}

// Titles Netflix sends without the show's name (': "Episode 14"') can't be matched.
const usable = (name) => /^\p{L}|^\p{N}/u.test(name || "") && /\p{L}/u.test(name);

function episodeRow({ series: full, season, episode, playedAt, watched, key, info = {} }) {
  if (!usable(full)) return null;
  const { name: series, year } = splitYear(full);
  const label = GENERIC_SEASON.test(season) ? "" : season;
  const seriesId = looseKey(full);
  const seasonNumber = seasonNumberOf(label);
  // Prefer sN so Continue Watching / tracking match keys line up with resolveContinueTarget.
  const seasonId = seasonNumber != null ? `s${seasonNumber}` : looseKey(label);
  if (!seriesId) return null;
  const episodeNumber = episodeNumberOf(episode);
  return {
    key, kind: "episode", groupId: `season:${seriesId}/${seasonId}`, seriesId, seasonId,
    series, year: info.year || year, anime: info.anime ?? null, season: label, seasonNumber,
    episode: episodeNumber, episodeKey: episodeNumber ? `#${episodeNumber}` : (looseKey(episode) || key),
    watched, playedAt,
  };
}

function movieRow({ title: full, playedAt, watched, key, info = {} }) {
  if (!usable(full)) return null;
  const { name: title, year } = splitYear(full);
  const seriesId = looseKey(full);
  if (!seriesId) return null;
  return { key, kind: "movie", groupId: `movie:${seriesId}`, seriesId, seasonId: "", series: title, year: info.year || year, anime: info.anime ?? null, season: "", seasonNumber: null, episodeKey: "movie", watched, playedAt };
}

// What Netflix says about the show: its first year, and whether it files it under anime (null when unknown).
export function netflixInfo(item) {
  const year = Number.isInteger(item?.showYear) && item.showYear > 1900 ? item.showYear : null;
  const genres = Array.isArray(item?.genres) ? item.genres.filter((name) => typeof name === "string") : [];
  return { year, anime: genres.length ? genres.some((name) => /anime/i.test(name)) : null };
}

// Netflix clears the bookmark once a video is finished, so no bookmark (or zero) counts as watched.
function share(item) {
  const duration = Number(item.duration);
  const bookmark = Number(item.bookmark);
  if (!(duration > 0) || !Number.isFinite(bookmark) || bookmark <= 0) return 1;
  return Math.min(1, bookmark / duration);
}

// One viewing-activity item -> a row like Crunchyroll's, keyed by title instead of ids.
export function activityRow(item) {
  if (!item || typeof item !== "object") return null;
  const playedAt = Number(item.date) || 0;
  const key = `${item.movieID ?? text(item.title, 80)}:${playedAt}`;
  const watched = share(item) >= WATCHED_SHARE;
  const info = netflixInfo(item);
  const series = text(item.seriesTitle);
  if (series && item.series != null) {
    // Without season fields, the full title still reads "Show: Season 2: Episode".
    const fromTitle = item.seasonDescriptor == null || item.episodeTitle == null ? splitTitle(text(item.title, 400).startsWith(`${series}: `) ? text(item.title, 400) : `${series}: ${text(item.title, 400)}`) : {};
    const season = text(item.seasonDescriptor) || fromTitle.season || "";
    const episode = text(item.episodeTitle) || fromTitle.episode || String(item.movieID ?? "");
    return episodeRow({ series, season, episode, playedAt, watched, key, info });
  }
  const title = text(item.videoTitle) || text(item.title);
  return title ? movieRow({ title, playedAt, watched, key, info }) : null;
}

export function parseActivity(payload, seenSoFar = 0) {
  const items = Array.isArray(payload?.viewedItems) ? payload.viewedItems : [];
  const rows = items.map(activityRow).filter(Boolean);
  const total = Number(payload?.vhSize);
  const known = Number.isFinite(total) && total > 0;
  const more = items.length > 0 && (known ? seenSoFar + items.length < total : true);
  return { rows, count: items.length, total: known ? total : null, more };
}

// Page 0 that already knows a history size but returned no rows is Netflix still booting after a reload,
// not an account with nothing watched. Treating it as the end of history commits an empty checkpoint.
export function netflixHistoryStalled(value, page = 0) {
  const items = value?.viewedItems;
  return (Number(page) || 0) === 0 && Number(value?.vhSize) > 0 && Array.isArray(items) && items.length === 0;
}

// ---- The CSV from netflix.com/viewingactivity -> "Download all" ----

export function parseCsv(source) {
  const input = String(source || "").replace(/^\uFEFF/, "");
  const table = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) table.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value !== "")) table.push(row);
  return table;
}

// Dates follow the account's region: month first unless the first number can't be a month; year-first is supported too.
export function csvDate(value) {
  const match = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/.exec(String(value || "").trim());
  if (!match) return 0;
  let [, a, b, c] = match.map(Number);
  let year;
  let month;
  let day;
  if (match[1].length === 4) [year, month, day] = [a, b, c];
  else {
    year = c < 100 ? 2000 + c : c;
    [month, day] = a > 12 ? [b, a] : [a, b];
  }
  const date = new Date(year, month - 1, day, 12);
  return date.getMonth() === month - 1 ? date.getTime() : 0;
}

// "Show: Season 2: Episode" -> series, season, episode. Two-part titles only count as a show when the same name
// has several different second parts in the file; otherwise "Film: Subtitle" stays a film.
export function splitTitle(title, heads = new Map()) {
  const parts = title.split(": ");
  const at = parts.findIndex((part, index) => index > 0 && SEASON_PART.test(part));
  if (at > 0) return { series: parts.slice(0, at).join(": "), season: parts[at], episode: parts.slice(at + 1).join(": ") || parts[at] };
  if (parts.length >= 3) return { series: parts[0], season: "", episode: parts.slice(1).join(": ") };
  if (parts.length === 2 && (heads.get(parts[0])?.size || 0) > 1) return { series: parts[0], season: "", episode: parts[1] };
  return { movie: title };
}

// Tab / chrome chrome that is never a show title.
const JUNK_TITLE = /^(netflix|home|browse|my list|title details|watch|loading|…|\.{3}|null|undefined)$/i;
export function usablePlayerSeries(name) {
  const series = text(name, 200);
  if (!series || JUNK_TITLE.test(series) || series.length < 2) return "";
  return series;
}

// Live player / tab labels (mediaSession, document.title). Unlike CSV, "Show: Episode" is almost always a series.
// Also strips a leading "Watch " Netflix sometimes puts on the tab title.
export function splitPlayerTitle(title) {
  let line = text(title, 400).replace(/^\s*watch\s+/i, "").trim();
  if (!line || JUNK_TITLE.test(line)) return null;
  const parts = line.split(": ");
  const at = parts.findIndex((part, index) => index > 0 && SEASON_PART.test(part));
  if (at > 0) {
    const series = usablePlayerSeries(parts.slice(0, at).join(": "));
    if (!series) return null;
    return {
      series,
      season: parts[at],
      seasonNumber: seasonNumberOf(parts[at]),
      episode: parts.slice(at + 1).join(": ") || parts[at],
    };
  }
  if (parts.length >= 2) {
    const series = usablePlayerSeries(parts[0]);
    if (!series) return null;
    return {
      series,
      season: "",
      seasonNumber: null,
      episode: parts.slice(1).join(": "),
    };
  }
  const series = usablePlayerSeries(line);
  return series ? { series, season: "", seasonNumber: null, episode: "" } : null;
}

export function parseNetflixCsv(source) {
  const table = parseCsv(source);
  const header = (table[0] || []).map((name) => name.trim().toLowerCase());
  const titleAt = header.indexOf("title");
  const dateAt = header.indexOf("date");
  if (titleAt < 0 || dateAt < 0) return [];
  const raw = table.slice(1).map((cells) => ({ title: text(cells[titleAt], 400), at: csvDate(cells[dateAt]) })).filter((item) => item.title);
  const heads = new Map();
  for (const { title } of raw) {
    const parts = title.split(": ");
    if (parts.length !== 2) continue;
    if (!heads.has(parts[0])) heads.set(parts[0], new Set());
    heads.get(parts[0]).add(parts[1]);
  }
  return raw.map(({ title, at }) => {
    const split = splitTitle(title, heads);
    const key = `${title}|${at}`;
    return split.movie ? movieRow({ title: split.movie, playedAt: at, watched: true, key }) : episodeRow({ ...split, playedAt: at, watched: true, key });
  }).filter(Boolean);
}

/**
 * Pull recent finishes back into a history read. Same Netflix date can already be stored
 * as still in progress; once the bookmark clears, that row has to count.
 */
export function mergeNetflixReplay(rows, replay) {
  const out = [...(rows || [])];
  const byKey = new Map();
  for (const row of out) if (row?.key) byKey.set(row.key, row);
  let added = 0;
  for (const row of replay || []) {
    if (!row?.watched || !row.key) continue;
    const prev = byKey.get(row.key);
    if (!prev) {
      out.push(row);
      byKey.set(row.key, row);
      added += 1;
    } else if (!prev.watched) {
      prev.watched = true;
      added += 1;
    }
  }
  return { rows: out, added };
}

/** Fill missing episode numbers between 1 and max (ep 2 then 4 → also 1 and 3). */
export function fillEpisodeGaps(episodes) {
  const list = [...new Set((episodes || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  if (!list.length) return [];
  const top = list[list.length - 1];
  return Array.from({ length: top }, (_, index) => index + 1);
}

// Live unnumbered catch-up. Titles first played before this are backlog, not a lift onto AniList.
const NETFLIX_CATCH_UP_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Distinct unnumbered titles whose first play is inside the catch-up window.
 * `played` is the group map of episode → first-play time. Gap-fill zeros and older
 * history do not count — the whole scan's 1..n is not a fresh lift.
 */
export function unnumberedCatchUpCount(played, { now = Date.now(), windowMs = NETFLIX_CATCH_UP_MS } = {}) {
  const floor = now - windowMs;
  let count = 0;
  for (const at of Object.values(played || {})) {
    const time = Number(at) || 0;
    if (time >= floor) count += 1;
  }
  return count;
}

// Rows -> one group per season (or film).
// When Netflix labels carry absolute episode numbers, keep those and fill gaps (2 then 4 → progress 4).
// Otherwise fall back to counting distinct episodes 1..n in the order first played.
export function groupNetflix(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    if (!row?.groupId || !row.watched) continue;
    let group = groups.get(row.groupId);
    if (!group) {
      group = {
        id: row.groupId, kind: row.kind, seriesId: row.seriesId, seasonId: row.seasonId,
        series: row.series, year: row.year, anime: row.anime ?? null, season: row.season,
        seasonNumber: row.seasonNumber, seen: new Map(), numbered: true,
      };
      groups.set(row.groupId, group);
    }
    if (row.anime != null && group.anime == null) group.anime = row.anime;
    if (row.year && !group.year) group.year = row.year;
    if (!row.episode) group.numbered = false;
    const id = row.episode ? `#${row.episode}` : row.episodeKey || row.key;
    const earlier = group.seen.get(id)?.at || 0;
    const at = row.playedAt || 0;
    group.seen.set(id, {
      episode: row.episode || null,
      at: earlier && at ? Math.min(earlier, at) : earlier || at,
    });
  }
  return [...groups.values()].map(({ seen, numbered, ...group }) => {
    const list = [...seen.values()];
    const played = {};
    if (numbered) {
      for (const { episode, at } of list) if (episode) played[episode] = at;
      const filled = fillEpisodeGaps(Object.keys(played).map(Number));
      for (const episode of filled) if (played[episode] == null) played[episode] = 0;
    } else {
      list.sort((a, b) => (a.at || Infinity) - (b.at || Infinity)).forEach(({ at }, index) => { played[index + 1] = at; });
    }
    const episodes = Object.keys(played).map(Number).sort((a, b) => a - b);
    const times = Object.values(played).filter(Boolean);
    return {
      ...group,
      absolute: numbered,
      // How many distinct titles this pass saw — used to lift catch-up onto AniList progress when unnumbered.
      catchUpCount: list.length,
      played,
      episodes,
      firstPlayed: times.length ? Math.min(...times) : 0,
      lastPlayed: times.length ? Math.max(...times) : 0,
    };
  });
}
