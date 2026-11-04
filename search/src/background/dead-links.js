// Remembers which where-to-watch URLs were probed dead, and re-checks gap / AniList links when a show is opened.
import { deadUrlSet, cleanDeadStore, probeLinks } from "../lib/link-check.js";
import { GAP_SERVICES } from "../lib/catalogs.js";
import { KEYS } from "../lib/keys.js";
import { serviceForSite } from "../lib/services.js";

export async function loadDead() {
  return deadUrlSet((await chrome.storage.local.get(KEYS.deadLinks))[KEYS.deadLinks] || {});
}

async function loadStore() {
  return cleanDeadStore((await chrome.storage.local.get(KEYS.deadLinks))[KEYS.deadLinks] || {});
}

export async function rememberProbes(results = [], { now = Date.now() } = {}) {
  if (!results.length) return loadDead();
  const store = await loadStore();
  for (const row of results) {
    if (!row?.url || row.skipped || row.error) continue;
    store[row.url] = { url: row.url, dead: row.dead === true, at: now };
  }
  await chrome.storage.local.set({ [KEYS.deadLinks]: cleanDeadStore(store, { now }) });
  return deadUrlSet(store);
}

// Probe gap-service links on a show (Netflix / Prime / Hulu). Catalog services are left alone — their
// URLs come from a live catalog read. Skips URLs probed in the last week.
export async function checkShowLinks(show, { fetchImpl = fetch, now = Date.now() } = {}) {
  const store = await loadStore();
  const week = 7 * 24 * 60 * 60 * 1000;
  const urls = (show?.streaming || [])
    .filter((link) => {
      const id = serviceForSite(link.site)?.id;
      if (!GAP_SERVICES.includes(id) || !link.url) return false;
      const known = store[link.url];
      return !known || now - known.at >= week;
    })
    .map((link) => link.url);
  if (!urls.length) return loadDead();
  const results = await probeLinks(urls, { fetchImpl });
  return rememberProbes(results, { now });
}
