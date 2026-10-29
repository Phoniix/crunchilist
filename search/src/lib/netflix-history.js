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

// Titles Netflix sends without the show's name (': "Episode 14"') can't be matched.
const usable = (name) => /^\p{L}|^\p{N}/u.test(name || "") && /\p{L}/u.test(name);

function episodeRow({ series: full, season, episode, playedAt, watched, key, info = {} }) {
  if (!usable(full)) return null;
  const { name: series, year } = splitYear(full);
  const label = GENERIC_SEASON.test(season) ? "" : season;
  const seriesId = looseKey(full);
  const seasonId = looseKey(label);
  if (!seriesId) return null;
  return {
    key, kind: "episode", groupId: `season:${seriesId}/${seasonId}`, seriesId, seasonId,
    series, year: info.year || year, anime: info.anime ?? null, season: label, seasonNumber: seasonNumberOf(label), episodeKey: looseKey(episode) || key, watched, playedAt,
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

// Rows -> one group per season (or film). Episodes are numbered 1..n in the order first played.
export function groupNetflix(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    if (!row?.groupId || !row.watched) continue;
    let group = groups.get(row.groupId);
    if (!group) {
      group = { id: row.groupId, kind: row.kind, seriesId: row.seriesId, seasonId: row.seasonId, series: row.series, year: row.year, anime: row.anime ?? null, season: row.season, seasonNumber: row.seasonNumber, seen: new Map() };
      groups.set(row.groupId, group);
    }
    if (row.anime != null && group.anime == null) group.anime = row.anime;
    if (row.year && !group.year) group.year = row.year;
    const earlier = group.seen.get(row.episodeKey);
    group.seen.set(row.episodeKey, earlier ? Math.min(earlier, row.playedAt || earlier) : row.playedAt || 0);
  }
  return [...groups.values()].map(({ seen, ...group }) => {
    const order = [...seen.values()].sort((a, b) => a - b);
    const played = Object.fromEntries(order.map((at, index) => [index + 1, at]));
    const times = order.filter(Boolean);
    return { ...group, played, episodes: order.map((_, index) => index + 1), firstPlayed: times.length ? Math.min(...times) : 0, lastPlayed: times.length ? Math.max(...times) : 0 };
  });
}
