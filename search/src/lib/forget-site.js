import { KEYS } from "./keys.js";

// The stored keys a site's data lives in; forgetSite works out what's left of each once that site is gone.
export const SITE_DATA_KEYS = [KEYS.checkpoints, KEYS.matches, KEYS.pending, KEYS.watchLog, KEYS.importDraft, KEYS.importPreview, KEYS.syncState, KEYS.catalogs];

const ofSite = (key, id) => String(key).startsWith(`${id}:`);
const without = (store, drop) => Object.fromEntries(Object.entries(store || {}).filter(([key, value]) => !drop(key, value)));

// Clears one streaming site's checkpoints, remembered matches, waiting picks, watch log, unfinished read,
// sync times and catalog. AniList, settings and Past imports (needed for undo) are left alone.
// An Import all preview holding this site's history has to be applied or dismissed first.
// stored: { [key]: value } for SITE_DATA_KEYS. Returns { set, remove, counts } or { blocked }.
export function forgetSite(stored = {}, id) {
  const preview = stored[KEYS.importPreview];
  const previewPoints = Array.isArray(preview?.checkpoints) ? preview.checkpoints : preview?.ckey ? [{ ckey: preview.ckey }] : [];
  if (preview && preview.service !== id && previewPoints.some((point) => ofSite(point?.ckey, id))) {
    return { blocked: "Apply or dismiss the Import all preview first; it includes this site's history." };
  }

  const set = {};
  const remove = [];
  const counts = { checkpoints: 0, matches: 0, picks: 0, watched: 0 };
  const trim = (key, drop, count) => {
    const store = stored[key];
    if (!store) return;
    const kept = without(store, drop);
    const gone = Object.keys(store).length - Object.keys(kept).length;
    if (!gone) return;
    if (count) counts[count] = gone;
    set[key] = kept;
  };
  trim(KEYS.checkpoints, (key) => ofSite(key, id), "checkpoints");
  trim(KEYS.matches, (key) => ofSite(key, id), "matches");
  trim(KEYS.pending, (key, item) => item?.service === id || ofSite(key, id), "picks");
  trim(KEYS.catalogs, (key) => key === id);

  const log = stored[KEYS.watchLog];
  if (Array.isArray(log)) {
    const kept = log.filter((row) => row?.service !== id);
    if (kept.length !== log.length) { counts.watched = log.length - kept.length; set[KEYS.watchLog] = kept; }
  }
  if (stored[KEYS.importDraft]?.service === id) remove.push(KEYS.importDraft);
  if (preview?.service === id) remove.push(KEYS.importPreview);

  const sync = stored[KEYS.syncState];
  if (sync && (sync.sites?.[id] != null || sync.watch?.[id] != null)) {
    set[KEYS.syncState] = { ...sync, sites: without(sync.sites, (key) => key === id), watch: without(sync.watch, (key) => key === id) };
  }
  return { set, remove, counts };
}

export function forgetNote(name, counts = {}) {
  const parts = [
    counts.matches && `${counts.matches} remembered match${counts.matches === 1 ? "" : "es"}`,
    counts.picks && `${counts.picks} waiting pick${counts.picks === 1 ? "" : "s"}`,
    counts.watched && `${counts.watched} tracked episode${counts.watched === 1 ? "" : "s"}`,
    counts.checkpoints && "where imports left off",
  ].filter(Boolean);
  return parts.length ? `Forgot your ${name} data: ${parts.join(", ")}.` : `There was no ${name} data left to forget.`;
}
