// Daily mood chips under the Search landing heading: AI (or a fallback) names short search phrases.
import { RECENT_LIMIT } from "./inspired.js";
import { parseJsonBlob } from "./llm.js";
import { activitySignature, sessionMood } from "./home-rows.js";

export const SEARCH_MOODS_COUNT = 6;
export const SEARCH_MOODS_TTL_MS = 24 * 60 * 60_000;
export const SEARCH_MOODS_RETRY_MS = 60 * 60_000;
export const SEARCH_MOODS_ACTIVITY_MS = 60 * 60_000;
const MAX_MOOD = 40;

export const DEFAULT_MOODS = [
  "something cozy",
  "big fights",
  "make me cry",
  "smart mystery",
  "short and sweet",
  "found family",
];

const STOCK_EXTRA = [
  "quiet character drama",
  "tournament arc energy",
  "found family adventure",
  "slow burn romance",
  "weird and wonderful",
  "space adventure",
  "school year chaos",
  "revenge fantasy",
];

export const SEARCH_MOODS_SCHEMA = {
  type: "object",
  required: ["moods"],
  properties: {
    moods: {
      type: "array",
      minItems: SEARCH_MOODS_COUNT,
      maxItems: SEARCH_MOODS_COUNT,
      items: { type: "string", maxLength: MAX_MOOD },
    },
  },
};

export const SEARCH_MOODS_SYSTEM = [
  "You write short mood chips for an anime search page.",
  `Return exactly ${SEARCH_MOODS_COUNT} moods. Each mood is a short search phrase under ${MAX_MOOD} characters.`,
  "Phrases should sound like what a viewer would type: moods, vibes, or light genre cues, for example \"something cozy\", \"big tournament fights\", \"make me cry\", \"smart mystery\".",
  "Do not use show titles. Prefer variety across tone, pace and genre. Never use a hardAvoids tag.",
  "Personalize from topTags, recentlyWatched and recentSearches. If sessionMood is given, lightly steer a couple of chips toward it.",
  "Avoid repeating phrases or near-duplicates from previousMoods.",
  'Return JSON only: {"moods":["something cozy","big fights","make me cry","smart mystery","short and sweet","found family"]}',
].join(" ");

function tidyMood(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= MAX_MOOD) return text;
  const cut = text.slice(0, MAX_MOOD - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > MAX_MOOD / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

function dayKey(now = Date.now()) {
  const date = new Date(now);
  return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
}

function hashSeed(text) {
  let hash = 2166136261;
  for (const char of String(text || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededShuffle(list, seed) {
  const out = [...list];
  let state = hashSeed(seed) || 1;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function blockedByAvoid(mood, avoids = []) {
  const lower = String(mood || "").toLowerCase();
  return (avoids || []).some((label) => {
    const word = String(label || "").toLowerCase().trim();
    if (!word) return false;
    return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower);
  });
}

export function cleanMoods(list, avoids = [], { previous = [] } = {}) {
  const seen = new Set((previous || []).map((mood) => String(mood).toLowerCase()));
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const mood = tidyMood(raw);
    if (!mood) continue;
    const key = mood.toLowerCase();
    if (seen.has(key) || blockedByAvoid(mood, avoids)) continue;
    seen.add(key);
    out.push(mood);
    if (out.length >= SEARCH_MOODS_COUNT) break;
  }
  return out;
}

export function parseSearchMoods(text, avoids = [], { previous = [] } = {}) {
  const blob = parseJsonBlob(text);
  const moods = cleanMoods(Array.isArray(blob) ? blob : blob?.moods, avoids, { previous });
  return moods.length >= 4 ? { ok: true, moods: moods.slice(0, SEARCH_MOODS_COUNT) } : { ok: false, moods: [] };
}

export function buildSearchMoodsPrompt({ profile, liked = [], watched = [], searches = [], previous = [], sessionMood: mood = "" }) {
  return {
    system: SEARCH_MOODS_SYSTEM,
    user: JSON.stringify({
      profile,
      topTags: liked.slice(0, 8),
      recentlyWatched: watched.slice(0, 6),
      recentSearches: searches.slice(0, RECENT_LIMIT),
      ...(previous.length ? { previousMoods: previous.slice(0, 12) } : {}),
      ...(mood ? { sessionMood: mood } : {}),
    }),
  };
}

export function fallbackMoods({
  liked = [],
  watched = [],
  searches = [],
  avoids = [],
  previous = [],
  now = Date.now(),
  sessionMood: mood = "",
} = {}) {
  const flavored = [];
  if (liked[0]) flavored.push(`more ${liked[0]}`);
  if (liked[1]) flavored.push(`${liked[1]} vibes`);
  if (searches[0]) flavored.push(String(searches[0]).slice(0, MAX_MOOD));
  if (watched[0]) flavored.push(`like ${String(watched[0]).split(/\s*[:–—]\s+/)[0]}`.slice(0, MAX_MOOD));
  if (mood === "morning quick picks") flavored.push("short and sweet");
  if (mood === "evening cozy or binge") flavored.push("something cozy");
  if (mood === "late-night chill") flavored.push("quiet character drama");
  if (mood === "weekend longer watches") flavored.push("epic adventure");

  const pool = seededShuffle(
    [...DEFAULT_MOODS, ...STOCK_EXTRA, ...flavored],
    `${dayKey(now)}:${liked[0] || ""}:${searches[0] || ""}`,
  );
  const moods = cleanMoods(pool, avoids, { previous });
  if (moods.length >= SEARCH_MOODS_COUNT) return moods.slice(0, SEARCH_MOODS_COUNT);
  return cleanMoods([...moods, ...DEFAULT_MOODS, ...STOCK_EXTRA], avoids).slice(0, SEARCH_MOODS_COUNT);
}

export function needsMoodRefresh(saved, signature, now = Date.now()) {
  if (!saved || !Array.isArray(saved.moods) || !saved.moods.length) return true;
  if (now >= (saved.expiresAt || 0)) return true;
  if (now < (saved.createdAt || 0)) return true;
  return saved.signature !== signature && now - (saved.createdAt || 0) >= SEARCH_MOODS_ACTIVITY_MS;
}

export function moodExpiryFor({ wantedAi, gotAi, now = Date.now() }) {
  return now + (wantedAi && !gotAi ? SEARCH_MOODS_RETRY_MS : SEARCH_MOODS_TTL_MS);
}

export { activitySignature, sessionMood, dayKey };
