// Reads each connected service's catalog about once a week, while the site is open in a tab, and keeps the titles
// matched to AniList. Crunchyroll's is read here with the sign-in its tab shared; HIDIVE's and Tubi's through their tabs.
import { CATALOG_EVERY_MS, CATALOG_MAX_ITEMS, CATALOG_SERVICES, CRUNCHYROLL_PAGE, cleanCatalogItems, crunchyrollBrowseUrl, matchCatalog, parseCrunchyrollBrowse } from "../lib/catalogs.js";
import { KEYS } from "../lib/keys.js";
import { serviceById } from "../lib/services.js";
import { crGet, matcher } from "./importer.js";

// After a failed read, wait this long before trying again on its own.
const RETRY_MS = 6 * 60 * 60 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let reading = null;
/** @type {{ id: string, name: string, index: number, total: number } | null} */
let readerState = null;

export const loadCatalogs = async () => (await chrome.storage.local.get(KEYS.catalogs))[KEYS.catalogs] || {};

export function catalogReaderActivity() {
  if (!readerState) return [];
  const { id, name, index, total } = readerState;
  const progress = total > 0 ? Math.min(0.99, index / total) : 0;
  return [{
    id: `catalog-reader-${id}`,
    label: `Reading the ${name} catalog`,
    service: id,
    progress,
    done: index,
    total: Math.max(total, 1),
  }];
}

// Page every slice of the browse API until it ends (or we hit the safety cap). type: series | movie_listing | "".
async function crunchyrollSlice(type = "") {
  const items = [];
  for (let start = 0; items.length < CATALOG_MAX_ITEMS; start += CRUNCHYROLL_PAGE) {
    const parsed = parseCrunchyrollBrowse(await crGet(crunchyrollBrowseUrl(start, { type })));
    items.push(...parsed.items);
    if (parsed.count < CRUNCHYROLL_PAGE || (parsed.total != null && start + CRUNCHYROLL_PAGE >= parsed.total)) break;
    await sleep(200);
  }
  return items;
}

// Series and movie listings are requested separately so a huge series list can't starve films under the cap.
async function crunchyrollItems() {
  const series = await crunchyrollSlice("series");
  const films = await crunchyrollSlice("movie_listing");
  // Fall back to an unfiltered pass if typed browse returns nothing (API shape change).
  if (!series.length && !films.length) return crunchyrollSlice("");
  return [...series, ...films];
}

async function tabItems(key, type, name) {
  const tabId = (await chrome.storage.session.get(key))[key];
  if (tabId == null) throw new Error(`Open ${name} in a tab (reload it if it's already open) to read its catalog.`);
  // Catalog reads can take a while; still fail cleanly so the app doesn't sit on "Reading…" forever.
  const reply = await Promise.race([
    chrome.tabs.sendMessage(tabId, { type }).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: `${name} took too long to answer. Keep its tab open and try Read now again.` }), 90_000)),
  ]);
  if (!reply) throw new Error(`Open ${name} in a tab (reload it if it's already open) to read its catalog.`);
  if (!reply.ok) throw new Error(reply.error || `${name} didn't answer.`);
  return reply.payload?.items || [];
}

const READERS = {
  crunchyroll: crunchyrollItems,
  hidive: () => tabItems(KEYS.hidiveTab, "hidiveCatalog", "HIDIVE"),
  tubi: () => tabItems(KEYS.tubiTab, "tubiCatalog", "Tubi"),
  netflix: () => tabItems(KEYS.netflixTab, "netflixCatalog", "Netflix"),
};

async function readOne(id) {
  const name = serviceById(id).name;
  try {
    const items = cleanCatalogItems(await READERS[id](), id);
    if (!items.length) {
      throw new Error(id === "crunchyroll"
        ? "Crunchyroll listed no titles. Keep a signed-in Crunchyroll tab open and try Read now again."
        : `${name} listed no titles. Keep its tab open (reload if needed) and try Read now again.`);
    }
    const engine = await matcher();
    const { links, matched, unmatched } = matchCatalog(engine, items);
    const all = await loadCatalogs();
    await chrome.storage.local.set({
      [KEYS.catalogs]: {
        ...all,
        [id]: {
          at: Date.now(), tried: Date.now(), titles: items.length, matched, links, unmatched, error: "",
          // Snapshot for baselines / main-page readiness (also derived in catalogSummary).
          matchRate: items.length ? matched / items.length : null,
        },
      },
    });
    return { id, ok: true, titles: items.length, matched };
  } catch (error) {
    const all = await loadCatalogs();
    const message = error?.message || `${name}'s catalog couldn't be read.`;
    await chrome.storage.local.set({ [KEYS.catalogs]: { ...all, [id]: { ...all[id], tried: Date.now(), error: message } } });
    return { id, ok: false, error: message };
  }
}

// ids: the services to read. Without force, only those not read for a week (or not retried for a few hours) are read.
export async function readCatalogs(ids, { force = false } = {}) {
  if (reading) await reading.catch(() => {});
  const run = (async () => {
    const all = await loadCatalogs();
    const now = Date.now();
    const due = ids.filter((id) => CATALOG_SERVICES.includes(id)
      && (force || (now - (all[id]?.at || 0) >= CATALOG_EVERY_MS && now - (all[id]?.tried || 0) >= RETRY_MS)));
    const results = [];
    for (let index = 0; index < due.length; index += 1) {
      const id = due[index];
      const name = serviceById(id)?.name || id;
      readerState = { id, name, index, total: due.length };
      results.push(await readOne(id));
      readerState = { id, name, index: index + 1, total: due.length };
    }
    return results;
  })();
  reading = run;
  try {
    return await run;
  } finally {
    if (reading === run) reading = null;
    readerState = null;
  }
}
