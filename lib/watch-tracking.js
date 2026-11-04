// Tracking as you watch, for sites that keep no history to import (Tubi).
// The site's content script notices an episode finishing and names it; the background keeps it in a short log,
// which then goes through the same matching, preview and undo as an import.
import { decodeEntities } from "./prime-history.js";
import { looseKey } from "./match-engine.js";

export const TRACKED = ["tubi"];
export const TRACK_SETTING = { tubi: "trackTubi" };
export const FINISHED = 0.85;
// Shorter videos are ads, trailers and previews.
export const MIN_SECONDS = 300;
export const LOG_MAX = 300;
const REPEAT_MS = 6 * 60 * 60 * 1000;

const text = (value, max = 200) => (typeof value === "string" ? decodeEntities(value).replace(/\s+/g, " ").trim().slice(0, max) : "");
const count = (value) => (Number.isInteger(value) && value > 0 && value < 10000 ? value : null);

// Language tags sites add to titles, which AniList names don't carry.
const TAGS = /\s*[([](?:english\s+)?(?:dubbed|dub|subtitled|subbed|sub|uncut|uncensored)[)\]]\s*$/i;
export const cleanSeries = (name) => text(name).replace(TAGS, "").replace(TAGS, "").replace(/[\s:–-]+$/, "").trim();

// "Show S01:E02 - Title", "Show S1 E2", "Show Season 2 Episode 3", "Show Episode 3", "Show Ep. 3".
const PATTERNS = [
  /^(.*?)[\s:,–-]*\bS(\d{1,3})\s*[:.]?\s*E(\d{1,4})\b\s*[:.–-]*\s*(.*)$/i,
  /^(.*?)[\s:,–-]*\bSeason\s+(\d{1,3})[\s:,–-]*(?:Episode|Ep\.?)\s*(\d{1,4})\b\s*[:.–-]*\s*(.*)$/i,
  /^(.*?)[\s:,–-]*\b()(?:Episode|Ep\.?)\s*(\d{1,4})\b\s*[:.–-]*\s*(.*)$/i,
];

// A title line -> { series, season, episode, title }, or null when it names no episode.
export function parseEpisodeLabel(label) {
  const line = text(label, 300);
  for (const pattern of PATTERNS) {
    const match = pattern.exec(line);
    if (!match) continue;
    const episode = count(Number(match[3]));
    if (!episode) continue;
    return { series: cleanSeries(match[1]), season: count(Number(match[2])), episode, title: text(match[4]) };
  }
  return null;
}

function metaContent(html, property) {
  for (const tag of String(html || "").match(/<meta\b[^>]*>/gi) || []) {
    if (!new RegExp(`(?:property|name)=["']${property}["']`, "i").test(tag)) continue;
    const content = /content=(["'])([\s\S]*?)\1/i.exec(tag);
    if (content) return text(content[2], 300);
  }
  return "";
}

// Every JSON-LD object on a page, with @graph lists opened up.
export function jsonLd(html) {
  const found = [];
  const add = (node) => {
    if (Array.isArray(node)) node.forEach(add);
    else if (node && typeof node === "object") { found.push(node); if (node["@graph"]) add(node["@graph"]); }
  };
  for (const match of String(html || "").matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { add(JSON.parse(match[1])); } catch { /* a broken block is skipped */ }
  }
  return found.slice(0, 50);
}

const typeIs = (node, type) => [].concat(node?.["@type"] || []).includes(type);
const genres = (node) => [].concat(node?.genre || []).filter((genre) => typeof genre === "string");
const animeFrom = (list) => (list.length ? list.some((genre) => /\banime\b/i.test(genre)) : null);

// A Tubi title page's HTML -> what plays there. Tubi renders each episode and film page on its server, with
// og:title "Show S01:E02 - Title" and JSON-LD carrying the genres ("Anime" for anime).
export function tubiItem(html, path) {
  const id = /^\/(tv-shows|movies)\/(\d{1,12})\b/.exec(String(path || ""));
  if (!id) return null;
  const nodes = jsonLd(html);
  if (id[1] === "movies") {
    const movie = nodes.find((node) => typeIs(node, "Movie"));
    const name = cleanSeries(movie?.name || metaContent(html, "og:title"));
    return name ? { id: `movie:${id[2]}`, kind: "movie", series: name, season: null, episode: 1, title: "", anime: animeFrom(genres(movie)) } : null;
  }
  const episode = nodes.find((node) => typeIs(node, "TVEpisode"));
  const series = nodes.find((node) => typeIs(node, "TVSeries")) || episode?.partOfSeries;
  const label = parseEpisodeLabel(metaContent(html, "og:title")) || parseEpisodeLabel(`${series?.name || ""} ${episode?.name || ""}`);
  if (!label?.series) return null;
  return { id: `episode:${id[2]}`, kind: "episode", ...label, anime: animeFrom([...genres(episode), ...genres(series)]) };
}

// What a content script sends, checked again in the background. Returns null for anything malformed.
export function cleanItem(item) {
  if (!item || typeof item !== "object") return null;
  const kind = item.kind === "movie" ? "movie" : "episode";
  const series = cleanSeries(item.series);
  const id = text(item.id, 120);
  const episode = kind === "movie" ? 1 : count(item.episode);
  if (!series || !looseKey(series) || !id || !episode) return null;
  return { id, kind, series, season: kind === "movie" ? null : count(item.season), episode, title: text(item.title), anime: typeof item.anime === "boolean" ? item.anime : null };
}

// One finished video -> a history row, in the shape the importer groups by season.
export function watchRow(service, item, at) {
  const seriesId = looseKey(item.series);
  if (item.kind === "movie") {
    return { key: `${service}:${item.id}:${at}`, kind: "movie", groupId: `movie:${seriesId}`, seriesId, seasonId: "", series: item.series, year: null, anime: item.anime, season: "", seasonNumber: null, episode: 1, episodeKey: "movie", watched: true, playedAt: at };
  }
  const seasonNumber = item.season || null;
  const seasonId = seasonNumber ? `s${seasonNumber}` : "";
  return {
    key: `${service}:${item.id}:${at}`, kind: "episode", groupId: `season:${seriesId}:${seasonId}`, seriesId, seasonId, series: item.series, year: null, anime: item.anime,
    season: seasonNumber ? `Season ${seasonNumber}` : "", seasonNumber, episode: item.episode, episodeKey: `#${item.episode}`, watched: true, playedAt: at,
  };
}

// Adds a row to the log, newest first. The same video finishing again within a few hours (a replay) isn't added twice.
export function addToLog(log, service, item, at) {
  const rows = Array.isArray(log) ? log.filter((row) => row && typeof row === "object") : [];
  const repeat = rows.some((row) => row.service === service && row.itemId === item.id && Math.abs(at - row.playedAt) < REPEAT_MS);
  if (repeat) return { log: rows, added: false };
  return { log: [{ ...watchRow(service, item, at), service, itemId: item.id }, ...rows].slice(0, LOG_MAX), added: true };
}

// A short line naming what was noticed: "Death Note S1 E2".
export const itemText = (item) => (item.kind === "movie" ? item.series : `${item.series}${item.season ? ` S${item.season}` : ""} E${item.episode}`);
