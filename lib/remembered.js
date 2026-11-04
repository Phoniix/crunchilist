// Remembered matches, stored under KEYS.matches: once a show is matched it stays matched.
// Later imports, feed refreshes and matcher changes only add to a record; a user's pick replaces anything,
// and nothing but another user pick or an explicit re-check replaces a user's pick.
import { looseKey } from "./match-engine.js";

export const matchKey = (service, seriesId, seasonId = "") => `${service}:${seriesId}${seasonId ? `/${seasonId}` : ""}`;

// sN is the current season id. Imports from before that stored looseKey("Season 1") ("season 1").
export function matchKeyCandidates(service, seriesId, { seasonId = "", season = "", seasonNumber = null } = {}) {
  if (!service || !seriesId) return [];
  const ids = [];
  const add = (id) => {
    const value = String(id || "").trim();
    if (!value || ids.includes(value)) return;
    ids.push(value);
  };
  add(seasonId);
  const number = Number(seasonNumber);
  if (Number.isInteger(number) && number > 0) add(`s${number}`);
  if (season) add(looseKey(season));
  if (Number.isInteger(number) && number > 0) add(looseKey(`Season ${number}`));
  return ids.map((id) => matchKey(service, seriesId, id));
}

/** First stored key among sN and legacy "season N", else the canonical key. */
export function resolveMatchKey(store, service, seriesId, season = {}) {
  const keys = matchKeyCandidates(service, seriesId, season);
  for (const key of keys) if (store?.[key]) return key;
  return keys[0] || matchKey(service, seriesId, season.seasonId || "");
}

export function recall(store, key) {
  return store?.[key] || null;
}

// Returns the updated store; the input store is never changed.
export function remember(store = {}, key, found, { by = "matcher", now = Date.now(), names = [] } = {}) {
  const existing = store[key];
  const seen = (record) => [...new Set([...(record?.names || []), ...names.filter(Boolean)])].slice(-12);
  if (by === "user") {
    if (!found?.anilistId) return store;
    return { ...store, [key]: { anilistId: found.anilistId, how: "user", by, at: existing?.at || now, updatedAt: now, names: seen(existing) } };
  }
  if (existing) return { ...store, [key]: { ...existing, names: seen(existing), seenAt: now } };
  if (!found?.anilistId || found.confidence !== "high") return store;
  return { ...store, [key]: { anilistId: found.anilistId, how: found.how, by, at: now, names: seen(null) } };
}

// Drops a record only when the user asks for a re-check.
export function forget(store = {}, key) {
  if (!store[key]) return store;
  const { [key]: _removed, ...rest } = store;
  return rest;
}

// Remembered first, the matcher otherwise; low-confidence and unclear results are returned for one-time confirmation.
export function matchWithMemory(matcher, store, key, input) {
  const record = recall(store, key);
  if (record) {
    const placed = matcher.placeOn(record.anilistId, input, record.how === "user" ? "user" : "remembered");
    if (placed) return { ...placed, remembered: true };
    // A user's pick of an entry the master list doesn't have yet still stands; the episodes go to it as they are.
    if (record.how === "user" && input.episodes?.length) {
      const parts = [{ anilistId: record.anilistId, episodes: input.episodes, progress: input.episodes.length }];
      return { anilistId: record.anilistId, title: "", how: "user", confidence: "high", parts, progress: input.episodes.length, reason: "", candidates: [], remembered: true };
    }
  }
  return { ...matcher.match(input), remembered: false };
}
