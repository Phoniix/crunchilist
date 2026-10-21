// HIDIVE watch history: the list hidive.com/history loads from HIDIVE's API, read in the user's own tab with the
// site's own sign-in. Each page is { vods: [...], page, totalPages, totalResults }; each video carries its show,
// season and episode in episodeInformation, when it was watched (watchedAt, ms) and how far (watchProgress, seconds).
import { splitSeasonTitle } from "./episode-groups.js";
import { looseKey } from "./match-engine.js";
import { FINISHED, cleanSeries } from "./watch-tracking.js";

export const API_ORIGIN = "https://dce-frontoffice.imggaming.com";
// HIDIVE refuses pages larger than 25.
export const PAGE_SIZE = 25;
const MAX_PAGES = 400;

export const historyUrl = (page) => `${API_ORIGIN}/api/v2/customer/history/vod?p=${page}&rpp=${PAGE_SIZE}`;

const text = (value, max = 200) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const count = (value) => (Number.isInteger(value) && value > 0 && value < 100000 ? value : null);
const seconds = (value) => (Number.isFinite(value) && value >= 0 ? value : null);
const id = (value) => (Number.isInteger(value) && value > 0 ? String(value) : "");

// One API page -> plain entries, without descriptions, images or anything else not needed.
export function hidiveEntries(body) {
  const vods = Array.isArray(body?.vods) ? body.vods.slice(0, 100) : [];
  return vods.filter((vod) => vod && typeof vod === "object" && id(vod.id)).map((vod) => {
    const info = vod.episodeInformation && typeof vod.episodeInformation === "object" ? vod.episodeInformation : null;
    return {
      id: id(vod.id),
      title: text(vod.title),
      series: text(info?.seriesInformation?.title),
      seriesId: id(info?.seriesInformation?.id),
      seasonId: id(info?.season),
      seasonTitle: text(info?.seasonTitle),
      season: count(info?.seasonNumber),
      episode: count(info?.episodeNumber),
      at: Number.isFinite(vod.watchedAt) && vod.watchedAt > 0 ? vod.watchedAt : 0,
      duration: seconds(vod.duration),
      position: seconds(vod.watchProgress),
      episodic: Boolean(info),
    };
  });
}

// Entries -> rows like Crunchyroll's, newest first. HIDIVE drops watchProgress once an episode is finished and keeps
// it while one is part-watched, so an entry without it counts, and one with it counts from 85% on.
export function hidiveRows(entries) {
  const rows = [];
  for (const entry of entries || []) {
    if (!entry?.id || !entry.at) continue;
    const watched = entry.duration > 0 && entry.position != null ? entry.position / entry.duration >= FINISHED : true;
    const key = `${entry.id}:${entry.at}`;
    if (!entry.episodic) {
      const series = cleanSeries(entry.title);
      const seriesId = looseKey(series);
      if (seriesId) rows.push({ key, kind: "movie", groupId: `movie:${entry.id}`, seriesId, seasonId: "", series, year: null, anime: true, season: "", seasonNumber: null, episode: 1, episodeKey: "movie", watched, playedAt: entry.at });
      continue;
    }
    const series = cleanSeries(entry.series);
    const seriesId = looseKey(series);
    if (!seriesId) continue;
    // "Season 2" alone says nothing about the show; a season named after it ("Oshi no Ko Season 2") is kept whole.
    const split = splitSeasonTitle(entry.seasonTitle);
    const seasonNumber = entry.season || split.seasonNumber || null;
    const season = entry.seasonTitle || (seasonNumber ? `Season ${seasonNumber}` : "");
    const seasonId = entry.seasonId || (seasonNumber ? `s${seasonNumber}` : "");
    rows.push({
      key, kind: "episode", groupId: `season:${entry.seriesId || seriesId}:${seasonId}`, seriesId, seasonId, series, year: null, anime: true,
      season, seasonNumber, episode: entry.episode, episodeKey: entry.episode ? `#${entry.episode}` : entry.id, watched, playedAt: entry.at,
    });
  }
  return rows.sort((a, b) => b.playedAt - a.playedAt);
}

// One page from the content script -> the shape the history reader expects.
export function parseHidivePage(payload) {
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  const page = count(payload?.page) || 1;
  const pages = Math.min(count(payload?.totalPages) || 0, MAX_PAGES);
  return { rows: hidiveRows(entries), count: entries.length, total: count(payload?.totalResults), more: entries.length > 0 && page < pages };
}
