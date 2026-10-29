// Generated home rows: the AI (or a fallback) names 5-6 themes, and the search engine fills each one with real shows.
import { RECENT_LIMIT } from "./inspired.js";
import { parseJsonBlob } from "./llm.js";

export const HOME_ROWS_MIN = 5;
export const HOME_ROWS_MAX = 6;
export const HOME_ROWS_TTL_MS = 12 * 60 * 60_000;
export const HOME_ROWS_ACTIVITY_MS = 60 * 60_000;
export const HOME_ROWS_RETRY_MS = 60 * 60_000;
/** How many prior Home refreshes to remember when avoiding repeated genres. */
export const HOME_ROWS_CYCLE_AVOID = 6;
/** Most recent cycles whose genre tokens are hard-dropped (not just deferred). */
export const HOME_ROWS_HARD_AVOID = 3;
/** Featured show ids demoted for this many prior cycles. */
export const HOME_ROWS_TITLE_DEMOTE = 2;
const MAX_TITLE = 48;
const MAX_QUERY = 80;
const MAX_WHY = 120;
export const NUDGE_MAX = 80;

const STOP = new Set([
  "a", "an", "and", "or", "the", "of", "in", "on", "to", "for", "with", "from", "like", "set",
  "more", "short", "long", "new", "old", "best", "top", "hidden", "gems", "picks", "underrated",
  "popular", "classic", "acclaimed", "movie", "movies", "series", "show", "shows", "anime",
  "you", "watched", "because", "inspired", "by", "twist", "binges", "quick", "crowd", "favorites",
]);

function tidy(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}
const titleCase = (label) => String(label || "").replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

// "Frieren: Beyond Journey's End" reads as "Frieren" in a row title.
export function shortTitle(title) {
  const text = String(title || "").trim();
  const head = text.split(/\s*[:–—]\s+|\s+-\s+/)[0].trim();
  return head.length >= 3 ? head : text;
}

export const HOME_ROWS_SCHEMA = {
  type: "object",
  required: ["rows"],
  properties: {
    rows: {
      type: "array",
      minItems: HOME_ROWS_MIN,
      maxItems: HOME_ROWS_MAX,
      items: {
        type: "object",
        required: ["title", "query", "why"],
        properties: {
          title: { type: "string", maxLength: MAX_TITLE },
          query: { type: "string", maxLength: MAX_QUERY },
          why: { type: "string", maxLength: MAX_WHY },
        },
      },
    },
  },
};

export const HOME_ROWS_SYSTEM = [
  "You name rows for an anime streaming home page, like Netflix category rows, personalised for one viewer.",
  `Return ${HOME_ROWS_MIN} to ${HOME_ROWS_MAX} rows. Each row has a title, a query and a why.`,
  `title is a short, catchy row name under ${MAX_TITLE} characters. Do not name a specific show in the title unless the row is "Because you watched" that show.`,
  "query is a short search phrase that finds shows for the row. Use genres, tags, moods, settings or eras, for example \"cozy slice of life\", \"dark fantasy revenge\", \"short sports\", \"underrated mystery\", \"set in space\", or \"like <a show the viewer watched>\". Do not put show titles in the query except after \"like\".",
  "why is one short sentence telling the viewer why the row is for them, mentioning their taste, a show they watched, or a recent search.",
  "Make every row different: vary genres, moods and lengths. Never use a hardAvoids tag. At most two rows may use \"like\".",
  "Each refresh must feel new. Prefer genres, moods and settings that are not in recentThemes. Do not reuse those queries or their main genre words until several refreshes have passed.",
  "If sessionMood is given, lightly steer most rows toward that time-of-day mood, but keep at least one row purely from their taste.",
  "If nudge is given, the viewer typed it to steer today's rows. Let it influence most rows by blending it with their taste and history, for example a mood, setting or theme mixed with genres they like. It is a nudge, not a filter: keep variety, and keep at least one row purely from their taste.",
  'Return JSON only: {"rows":[{"title":"Cozy evenings","query":"cozy slice of life","why":"You keep coming back to gentle slice of life."}]}',
].join(" ");

export function cleanNudge(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, NUDGE_MAX).trim();
}

/** Soft time-of-day / weekend steer for theme rows. */
export function sessionMood(now = Date.now()) {
  const date = new Date(now);
  const hour = date.getHours();
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  if (weekend && hour >= 10 && hour < 18) return "weekend longer watches";
  if (hour >= 5 && hour < 11) return "morning quick picks";
  if (hour >= 11 && hour < 17) return "daytime variety";
  if (hour >= 17 && hour < 22) return "evening cozy or binge";
  return "late-night chill";
}

/** Rotate which recent title anchors "Because you watched", skipping recent anchors when possible. */
export function rotateWatched(watched = [], cycle = 0, recentAnchors = []) {
  const list = (watched || []).map((title) => String(title || "").trim()).filter(Boolean);
  if (list.length <= 1) return list;
  const blocked = new Set((recentAnchors || []).map((title) => String(title).toLowerCase()));
  const preferred = list.filter((title) => !blocked.has(title.toLowerCase()));
  const pool = preferred.length ? preferred : list;
  const start = Math.abs(Number(cycle) || 0) % pool.length;
  const rotated = [...pool.slice(start), ...pool.slice(0, start)];
  const rest = list.filter((title) => !rotated.includes(title));
  return [...rotated, ...rest];
}

export function recentAnchors(history, cycles = HOME_ROWS_HARD_AVOID) {
  const out = [];
  for (const entry of cycleHistory({ history }).slice(-cycles)) {
    for (const query of entry.queries || []) {
      const match = /^like\s+(.+)$/i.exec(String(query || "").trim());
      if (match) out.push(match[1]);
    }
  }
  return out;
}

/** Genre-ish tokens from a theme query, used to avoid repeating the same categories too soon. */
export function themeTokens(query) {
  return String(query || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .split(/[\s/-]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && !STOP.has(part) && !/^\d+$/.test(part));
}

export function cycleHistory(saved, limit = HOME_ROWS_CYCLE_AVOID) {
  const list = Array.isArray(saved?.history) ? saved.history : [];
  return list.filter((entry) => Array.isArray(entry?.tokens) || Array.isArray(entry?.queries)).slice(-limit);
}

export function recentThemeTokens(history, limit = HOME_ROWS_CYCLE_AVOID) {
  const tokens = new Set();
  for (const entry of cycleHistory({ history }, limit)) {
    for (const token of entry.tokens || []) tokens.add(String(token).toLowerCase());
    for (const query of entry.queries || []) {
      for (const token of themeTokens(query)) tokens.add(token);
    }
  }
  return [...tokens];
}

export function recentHardTokens(history) {
  const recent = cycleHistory({ history }).slice(-HOME_ROWS_HARD_AVOID);
  return recentThemeTokens(recent, HOME_ROWS_HARD_AVOID);
}

export function recentSoftTokens(history) {
  const all = cycleHistory({ history });
  const older = all.slice(0, Math.max(0, all.length - HOME_ROWS_HARD_AVOID));
  return recentThemeTokens(older, HOME_ROWS_CYCLE_AVOID);
}

export function recentFeaturedIds(history, cycles = HOME_ROWS_TITLE_DEMOTE) {
  const ids = new Set();
  for (const entry of cycleHistory({ history }).slice(-cycles)) {
    for (const id of entry.ids || []) ids.add(String(id));
  }
  return [...ids];
}

export function recordCycle(themes, previous = [], now = Date.now(), ids = []) {
  const queries = (themes || []).map((row) => String(row.query || "").toLowerCase()).filter(Boolean);
  const tokens = [...new Set(queries.flatMap(themeTokens))];
  const featured = [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 48);
  const next = [...cycleHistory({ history: previous }), { at: now, queries, tokens, ids: featured }];
  return next.slice(-HOME_ROWS_CYCLE_AVOID);
}

function overlapsTokens(query, recentTokens) {
  if (!recentTokens?.length) return false;
  const blocked = new Set(recentTokens.map((token) => String(token).toLowerCase()));
  const parts = themeTokens(query);
  if (!parts.length) return false;
  const hit = parts.filter((token) => blocked.has(token));
  return hit.length > 0 && hit.length >= Math.ceil(parts.length / 2);
}

export function buildHomeRowsPrompt({ profile, liked = [], watched = [], searches = [], nudge = "", recentThemes = [], sessionMood: mood = "" }) {
  return {
    system: HOME_ROWS_SYSTEM,
    user: JSON.stringify({
      profile,
      topTags: liked.slice(0, 8),
      recentlyWatched: watched.slice(0, 6),
      recentSearches: searches.slice(0, RECENT_LIMIT),
      ...(recentThemes.length ? { recentThemes: recentThemes.slice(0, 36) } : {}),
      ...(mood ? { sessionMood: mood } : {}),
      ...(nudge ? { nudge } : {}),
    }),
  };
}

export function cleanThemes(rows, avoids = [], { recentTokens = [], hardTokens = [] } = {}) {
  const blocked = (avoids || []).map((label) => String(label).toLowerCase()).filter(Boolean);
  const titles = new Set();
  const queries = new Set();
  const preferred = [];
  const deferred = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const title = tidy(row?.title, MAX_TITLE);
    const query = String(row?.query || "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY).trim();
    const why = tidy(row?.why, MAX_WHY);
    if (!title || !query) continue;
    const lower = query.toLowerCase();
    if (titles.has(title.toLowerCase()) || queries.has(lower)) continue;
    if (blocked.some((label) => new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower))) continue;
    if (overlapsTokens(query, hardTokens)) continue;
    titles.add(title.toLowerCase());
    queries.add(lower);
    const item = { title, query, why };
    if (overlapsTokens(query, recentTokens)) deferred.push(item);
    else preferred.push(item);
  }
  return [...preferred, ...deferred].slice(0, HOME_ROWS_MAX);
}

export function parseHomeRows(text, avoids = [], { recentTokens = [], hardTokens = [] } = {}) {
  const blob = parseJsonBlob(text);
  const rows = cleanThemes(Array.isArray(blob) ? blob : blob?.rows, avoids, { recentTokens, hardTokens });
  return rows.length >= 3 ? { ok: true, rows } : { ok: false, rows: [] };
}

const STOCK_FALLBACKS = [
  { title: "Hidden gems", query: "underrated", why: "Well-rated shows that fly under the radar." },
  { title: "Quick binges", query: "short", why: "Series you can finish in a weekend." },
  { title: "Acclaimed classics", query: "classic acclaimed", why: "Older shows that still hold up." },
  { title: "Movie night", query: "movie", why: "Films for when you want a whole story in one sitting." },
  { title: "Crowd favorites", query: "popular", why: "What lots of viewers keep watching." },
  { title: "Slow-burn stories", query: "slow burn drama", why: "Stories that take their time." },
  { title: "High-stakes action", query: "intense action thriller", why: "When you want momentum." },
  { title: "Quiet character studies", query: "character drama slice of life", why: "People-first storytelling." },
  { title: "Weird and wonderful", query: "surreal experimental", why: "Odd premises that stick with you." },
  { title: "Found family", query: "found family adventure", why: "Crews that become home." },
  { title: "School-year chaos", query: "school comedy drama", why: "Campus energy, high and low." },
  { title: "Epic journeys", query: "adventure fantasy journey", why: "Roads, maps and long arcs." },
];

const MOOD_FALLBACKS = {
  "morning quick picks": { title: "Morning quick picks", query: "short", why: "Easy watches to start the day." },
  "daytime variety": { title: "Daytime variety", query: "popular", why: "A mix for the middle of the day." },
  "evening cozy or binge": { title: "Evening comfort", query: "cozy slice of life", why: "Settle in after the day." },
  "late-night chill": { title: "Late-night chill", query: "calm atmospheric", why: "Quieter picks for late hours." },
  "weekend longer watches": { title: "Weekend deep cuts", query: "long epic adventure", why: "More room for longer stories." },
};

// Themes built from history and taste alone, for when AI is off or fails.
export function fallbackThemes({
  liked = [],
  watched = [],
  searches = [],
  nudge = "",
  recentTokens = [],
  hardTokens = [],
  cycle = 0,
  sessionMood: mood = "",
  recentAnchors: anchors = [],
} = {}) {
  const rows = [];
  const tags = liked.map(titleCase);
  const seeded = rotateWatched(watched, cycle, anchors);
  if (nudge) {
    rows.push({ title: `Inspired by "${nudge}"`, query: nudge, why: "Steered by what you typed." });
    if (tags[0]) rows.push({ title: `${tags[0]} with a "${nudge}" twist`, query: `${nudge} ${liked[0]}`, why: `What you typed, mixed with ${tags[0].toLowerCase()}, a favorite tag.` });
  }
  const watchedRow = (title) => ({ title: `Because you watched ${shortTitle(title)}`, query: `like ${title}`, why: `Shows that share the most with ${shortTitle(title)}.` });
  if (seeded[0]) rows.push(watchedRow(seeded[0]));
  if (tags[0]) rows.push({ title: `More ${tags[0]}`, query: liked[0], why: `${tags[0]} is one of your favorite tags.` });
  if (searches[0]) rows.push({ title: `More like "${searches[0]}"`, query: searches[0], why: "Based on something you searched for recently." });
  if (mood && MOOD_FALLBACKS[mood] && !nudge) rows.push(MOOD_FALLBACKS[mood]);
  if (tags[1]) rows.push({ title: `${tags[1]} picks`, query: liked[1], why: `You often watch ${tags[1].toLowerCase()} shows.` });
  if (tags[0]) rows.push({ title: `Short ${tags[0]} binges`, query: `short ${liked[0]}`, why: "Quick series you can finish in a weekend." });
  if (seeded[1]) rows.push(watchedRow(seeded[1]));
  if (tags[2]) rows.push({ title: `Hidden ${tags[2]} gems`, query: `underrated ${liked[2]}`, why: `Less talked-about ${tags[2].toLowerCase()} shows.` });
  if (searches[1]) rows.push({ title: `More like "${searches[1]}"`, query: searches[1], why: "Based on something you searched for recently." });
  // Rotate stock fillers so each refresh isn't the same five genres.
  const start = Math.abs(Number(cycle) || 0) % STOCK_FALLBACKS.length;
  const stock = [...STOCK_FALLBACKS.slice(start), ...STOCK_FALLBACKS.slice(0, start)];
  if (rows.length < HOME_ROWS_MIN) rows.push(...stock);
  else rows.push(...stock.slice(0, 3));
  return cleanThemes(rows, [], { recentTokens, hardTokens });
}

// Changes when the viewer's taste, history, recent searches or AI setup change.
export function activitySignature({ taste, watchedIds = [], searches = [], aiKey = "" }) {
  const profile = taste || {};
  return JSON.stringify([
    profile.liked || [],
    profile.disliked || [],
    profile.hardAvoids || [],
    [...watchedIds].map(String).sort(),
    searches.slice(0, 2).map((query) => String(query).toLowerCase()),
    aiKey,
  ]);
}

// Regenerate after 12 hours, or after an hour when the viewer has done something new since.
export function needsRefresh(saved, signature, now = Date.now()) {
  if (!saved || !Array.isArray(saved.themes) || !saved.themes.length) return true;
  if (now >= (saved.expiresAt || 0)) return true;
  if (now < (saved.createdAt || 0)) return true;
  return saved.signature !== signature && now - (saved.createdAt || 0) >= HOME_ROWS_ACTIVITY_MS;
}

export function expiryFor({ wantedAi, gotAi, now = Date.now() }) {
  return now + (wantedAi && !gotAi ? HOME_ROWS_RETRY_MS : HOME_ROWS_TTL_MS);
}

export function themesOverlapHigh(themes, history) {
  const recent = new Set(recentThemeTokens(cycleHistory({ history }).slice(-1), 1));
  if (!recent.size || !themes?.length) return false;
  let hit = 0;
  for (const row of themes) {
    if (overlapsTokens(row.query, [...recent])) hit += 1;
  }
  return hit >= Math.ceil(themes.length / 2);
}

// Each show appears in only one row; rows too thin to scroll are dropped.
// demoteIds: prefer fresher titles but still fill if needed. excludeIds: never use (cross-section / muted).
export function fillThemes(themes, ranker, { perRow = 14, minRow = 5, demoteIds = [], excludeIds = [] } = {}) {
  const used = new Set();
  const demote = new Set((demoteIds || []).map(String));
  const exclude = new Set((excludeIds || []).map(String));
  const out = [];
  for (const theme of themes) {
    const fresh = [];
    const stale = [];
    for (const id of ranker(theme.query)) {
      const key = String(id);
      if (!key || used.has(key) || exclude.has(key) || fresh.includes(key) || stale.includes(key)) continue;
      (demote.has(key) ? stale : fresh).push(key);
    }
    const ids = [...fresh, ...stale].slice(0, perRow);
    if (ids.length < minRow) continue;
    ids.forEach((id) => used.add(id));
    out.push({ ...theme, ids });
  }
  return out;
}
