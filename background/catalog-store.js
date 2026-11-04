// Service catalog snapshots (AniList id → title URL) from weekly tab reads. Gap map fills Netflix/Prime/Hulu until then.
import { KEYS } from "../lib/keys.js";

export const CATALOGS_KEY = KEYS.catalogs;

export async function loadServiceCatalogs() {
  return (await chrome.storage.local.get(CATALOGS_KEY))[CATALOGS_KEY] || {};
}

export async function saveServiceCatalog(id, entry) {
  const all = await loadServiceCatalogs();
  await chrome.storage.local.set({ [CATALOGS_KEY]: { ...all, [id]: entry } });
  return entry;
}

export async function catalogStatus() {
  const catalogs = await loadServiceCatalogs();
  return Object.fromEntries(Object.entries(catalogs).map(([id, row]) => [id, {
    at: row?.at || 0,
    titles: row?.titles || 0,
    matched: row?.matched || 0,
    shows: Object.keys(row?.links || {}).length,
    matchRate: row?.matchRate ?? null,
    error: row?.error || "",
  }]));
}
