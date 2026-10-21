// Prime Video watch history: the Watch History page Amazon renders for the signed-in profile, read in the user's own tab.
// The page carries its list as JSON ("ActivityHistoryItems"): days, each with films and seasons, each season with the
// episodes watched that day. Older days come from the same page with its nextToken.
// Prime lists everything started, with no share watched, so every episode listed counts.
import { splitSeasonTitle } from "./episode-groups.js";
import { looseKey } from "./match-engine.js";

const HISTORY_PATHS = { "www.amazon.com": "/gp/video/settings/watch-history", "www.primevideo.com": "/settings/watch-history" };
const MAX_DAYS = 400;
const MAX_TITLES = 500;

export function historyUrl(origin, token = "") {
  let host = "";
  try { host = new URL(origin).host; } catch { return ""; }
  const path = HISTORY_PATHS[host];
  return path ? `https://${host}${path}${token ? `?nextToken=${encodeURIComponent(token)}` : ""}` : "";
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(value) {
  return String(value || "").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? whole;
    const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
  });
}

const text = (value, max = 300) => (typeof value === "string" ? decodeEntities(value).replace(/\s+/g, " ").trim().slice(0, max) : "");
const time = (value) => (Number.isFinite(value) && value > 0 ? value : 0);
const gti = (value) => (typeof value === "string" && /^amzn1\.dv\.gti\.[\w-]{8,80}$/.test(value) ? value : "");
const list = (value, max) => (Array.isArray(value) ? value.slice(0, max) : []);

// Finds the history list and the open profile's id anywhere in the page's JSON.
function walk(node, found, depth = 0) {
  if (!node || typeof node !== "object" || depth > 14 || (found.items && found.profile)) return;
  if (!found.items && node.__type === "atv.wps#ActivityHistoryItems" && Array.isArray(node.titles)) found.items = node;
  if (!found.profile && typeof node.currentProfileID === "string") found.profile = node.currentProfileID.slice(0, 120);
  for (const value of Object.values(node)) walk(value, found, depth + 1);
}

const entry = (title) => ({ gti: gti(title?.gti), type: text(title?.titleType, 20), time: time(title?.time), title: text(title?.title?.text) });

// The page's HTML -> { days, nextToken, profile }, or null when it has no history list (signed out, or changed).
export function extractPrimeHistory(html) {
  const found = { items: null, profile: "" };
  for (const match of String(html || "").matchAll(/<script\b[^>]*type="text\/template"[^>]*>([\s\S]*?)<\/script>/g)) {
    let data;
    try { data = JSON.parse(match[1]); } catch { continue; }
    walk(data, found);
    if (found.items && found.profile) break;
  }
  if (!found.items) return null;
  const days = list(found.items.titles, MAX_DAYS).map((day) => ({
    date: text(day?.date, 40),
    titles: list(day?.titles, MAX_TITLES).map((title) => ({ ...entry(title), children: list(title?.children, MAX_TITLES).map(entry) })),
  }));
  const token = found.items.nextToken;
  return { days, nextToken: typeof token === "string" && token.length < 4000 ? token : "", profile: found.profile };
}

const EPISODE = /^(?:episode|ep\.?)\s*0*(\d{1,4})\b|^0*(\d{1,4})[.:]\s/i;

export function episodeNumber(title) {
  const match = EPISODE.exec(title || "");
  return match ? Number(match[1] || match[2]) || null : null;
}

// Days -> rows like Crunchyroll's, newest first. Live events and anything else that isn't a film or season is left out.
export function primeRows(days) {
  const rows = [];
  for (const day of days || []) {
    for (const title of day?.titles || []) {
      if (!title?.title) continue;
      if (title.type === "movie") {
        const seriesId = looseKey(title.title);
        if (!seriesId) continue;
        rows.push({ key: title.gti || `${seriesId}:${title.time}`, kind: "movie", groupId: `movie:${title.gti || seriesId}`, seriesId, seasonId: "", series: title.title, year: null, anime: null, season: "", seasonNumber: null, episode: 1, episodeKey: "movie", watched: true, playedAt: title.time });
        continue;
      }
      if (title.type !== "season") continue;
      const { series, season, seasonNumber } = splitSeasonTitle(title.title);
      const seriesId = looseKey(series);
      if (!seriesId) continue;
      const seasonId = title.gti ? title.gti.replace(/^amzn1\.dv\.gti\./, "") : looseKey(season);
      for (const child of title.children || []) {
        rows.push({
          key: child.gti || `${seasonId}:${child.title}:${child.time}`, kind: "episode", groupId: `season:${seasonId}`, seriesId, seasonId,
          series, year: null, anime: null, season, seasonNumber, episode: episodeNumber(child.title), episodeKey: child.gti || looseKey(child.title), watched: true, playedAt: child.time || title.time,
        });
      }
    }
  }
  return rows.sort((a, b) => b.playedAt - a.playedAt);
}

// One page from the content script -> the shape the history reader expects.
export function parsePrimePage(payload) {
  const days = Array.isArray(payload?.days) ? payload.days : [];
  const rows = primeRows(days);
  const nextToken = typeof payload?.nextToken === "string" ? payload.nextToken : "";
  return { rows, count: rows.length, total: null, more: Boolean(nextToken) && days.length > 0, nextToken };
}
