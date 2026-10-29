// Prime Video watch history: the Watch History page Amazon renders for the signed-in profile, read in the user's own tab.
// The page carries its list as JSON ("ActivityHistoryItems"): days, each with films and seasons, each season with the
// episodes watched that day. Older days come from the same page with its nextToken.
// Prime lists everything started, with no share watched, so every episode listed counts.
import { splitSeasonTitle } from "./episode-groups.js";
import { looseKey } from "./match-engine.js";

const HISTORY_PATHS = {
  "www.amazon.com": "/gp/video/settings/watch-history",
  "www.amazon.co.uk": "/gp/video/settings/watch-history",
  "www.amazon.ca": "/gp/video/settings/watch-history",
  "www.amazon.de": "/gp/video/settings/watch-history",
  "www.amazon.co.jp": "/gp/video/settings/watch-history",
  "www.primevideo.com": "/settings/watch-history",
};
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

function isHistoryItems(node) {
  if (!node || typeof node !== "object" || !Array.isArray(node.titles)) return false;
  const type = String(node.__type || node.type || "");
  return /ActivityHistoryItems/i.test(type) || (node.titles.length > 0 && node.titles.some((day) => day && typeof day === "object" && ("date" in day || Array.isArray(day.titles))));
}

// Finds the history list and the open profile's id anywhere in the page's JSON.
function walk(node, found, depth = 0) {
  if (!node || typeof node !== "object" || depth > 16 || (found.items && found.profile)) return;
  if (!found.items && isHistoryItems(node)) found.items = node;
  if (!found.profile && typeof node.currentProfileID === "string") found.profile = node.currentProfileID.slice(0, 120);
  for (const value of Object.values(node)) walk(value, found, depth + 1);
}

function parseScriptBodies(html) {
  const bodies = [];
  for (const match of String(html || "").matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1] || "";
    const body = (match[2] || "").trim();
    if (!body || body.startsWith("//")) continue;
    if (/type\s*=\s*["'](?!text\/template|application\/json|application\/ld\+json)[^"']*["']/i.test(attrs) && !/text\/template|application\/json/i.test(attrs)) continue;
    bodies.push(body);
  }
  return bodies;
}

const entry = (title) => ({ gti: gti(title?.gti), type: text(title?.titleType, 20), time: time(title?.time), title: text(title?.title?.text) });

function packHistory(found) {
  const days = list(found.items.titles, MAX_DAYS).map((day) => ({
    date: text(day?.date, 40),
    titles: list(day?.titles, MAX_TITLES).map((title) => ({ ...entry(title), children: list(title?.children, MAX_TITLES).map(entry) })),
  }));
  const token = found.items.nextToken;
  return { days, nextToken: typeof token === "string" && token.length < 4000 ? token : "", profile: found.profile || "" };
}

/** @returns {{ ok: true, data } | { ok: false, reason: string, detail?: string }} */
export function inspectPrimeHistory(html) {
  const page = String(html || "");
  if (!page.trim()) return { ok: false, reason: "empty-html", detail: "Prime returned an empty Watch History page." };
  if (/\/ap\/signin|name=["']email["']|Sign in to your account/i.test(page.slice(0, 8000))) {
    return { ok: false, reason: "signed-out", detail: "Prime Video showed a sign-in page. Sign in on that tab, pick your profile, then try again." };
  }
  if (/choose.?profile|Who'?s watching|Select a profile/i.test(page.slice(0, 12000))) {
    return { ok: false, reason: "pick-profile", detail: "Pick your Prime Video profile on that tab, then try the import again." };
  }
  const found = { items: null, profile: "" };
  for (const body of parseScriptBodies(page)) {
    let data;
    try { data = JSON.parse(body); } catch { continue; }
    walk(data, found);
    if (found.items && found.profile) break;
  }
  // Last resort: find the type string in raw HTML and parse a nearby JSON object.
  if (!found.items) {
    const anchor = page.search(/ActivityHistoryItems/i);
    if (anchor >= 0) {
      const start = page.lastIndexOf("{", anchor);
      const end = page.indexOf("</script>", anchor);
      if (start >= 0 && end > start) {
        try {
          walk(JSON.parse(page.slice(start, end)), found);
        } catch { /* keep falling through */ }
      }
    }
  }
  if (!found.items) {
    return {
      ok: false,
      reason: "no-history-json",
      detail: "Could not find Prime Video's watch-history list in the page HTML (Amazon may have changed the page). Reload the Watch History tab and try again.",
    };
  }
  return { ok: true, data: packHistory(found) };
}

// The page's HTML -> { days, nextToken, profile }, or null when it has no history list (signed out, or changed).
export function extractPrimeHistory(html) {
  const result = inspectPrimeHistory(html);
  return result.ok ? result.data : null;
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
