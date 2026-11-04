// What each connected service actually carries, read from the service's own catalog with the user's open tab:
// Crunchyroll's browse API, HIDIVE's Series and Movies grids, Tubi's Anime category, and Netflix's Anime TV /
// Anime Movies genre lists (signed-in tab). Titles are matched to AniList ids with the master list.
import { looseKey } from "./match-engine.js";
import { serviceById, serviceForSite, visibleLink } from "./services.js";

export const CATALOG_SERVICES = ["crunchyroll", "hidive", "tubi", "netflix"];
// Prime / Hulu (and Netflix when its tab catalog isn't read yet) use the gap map + AniList links.
export const GAP_SERVICES = ["netflix", "prime", "hulu"];
export const CATALOG_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
// High enough that CR / HIDIVE / Tubi anime catalogs finish paging instead of stopping mid-list.
export const CATALOG_MAX_ITEMS = 25000;
const UNMATCHED_KEEP = 300;
const BRAND = { crunchyroll: "#F47521", hidive: "#00AEEF", tubi: "#7408FF", netflix: "#E50914", prime: "#00A8E1", hulu: "#1CE783" };

const cleanTitle = (text) => String(text || "").replace(/\s+/g, " ").trim().slice(0, 180);
const year = (value) => (Number.isInteger(Number(value)) && Number(value) > 1900 && Number(value) < 2100 ? Number(value) : null);

// ---- Crunchyroll ----

export const CRUNCHYROLL_PAGE = 50;
// Alphabetical so a cap (if hit) still spans the alphabet; popularity would drop the long tail first.
// categories: optional CR genre slug(s), e.g. "action" — not an anime-only filter (CR has no such browse flag).
export function crunchyrollBrowseUrl(start = 0, { type = "", categories = "" } = {}) {
  const url = new URL("https://www.crunchyroll.com/content/v2/discover/browse");
  url.searchParams.set("n", String(CRUNCHYROLL_PAGE));
  url.searchParams.set("start", String(start));
  url.searchParams.set("sort_by", "alphabetical");
  url.searchParams.set("locale", "en-US");
  if (type) url.searchParams.set("type", type);
  if (categories) url.searchParams.set("categories", categories);
  return url.toString();
}

export function parseCrunchyrollBrowse(payload) {
  const items = [];
  for (const raw of Array.isArray(payload?.data) ? payload.data : []) {
    const id = String(raw?.id || "");
    const title = cleanTitle(raw?.title);
    if (!/^[A-Z0-9]{6,}$/i.test(id) || !title) continue;
    const movie = /movie/i.test(String(raw?.type || ""));
    const slug = String(raw?.slug_title || "").replace(/[^a-z0-9-]/gi, "");
    items.push({
      title,
      kind: movie ? "movie" : "series",
      year: year(movie ? raw?.movie_listing_metadata?.movie_release_year : raw?.series_metadata?.series_launch_year),
      url: `https://www.crunchyroll.com/series/${id}${slug ? `/${slug}` : ""}`,
    });
  }
  const total = Number(payload?.total ?? payload?.meta?.total);
  return { items, total: Number.isFinite(total) ? total : null, count: Array.isArray(payload?.data) ? payload.data.length : 0 };
}

// ---- HIDIVE ----

export const HIDIVE_API = "https://dce-frontoffice.imggaming.com/";
const GRID_PATH = `${HIDIVE_API}api/v1/view/content-grid?`;
export const HIDIVE_GRIDS = ["266043db-02a8-4646-82bc-9da24127ccdc", "05d9e1ad-8dca-4dd9-8aac-5c1b5c660115"];
export const HIDIVE_PAGE = 63;
export const HIDIVE_MAX_PAGES = 400;
const HIDIVE_PATHS = { SERIES: "series", VOD: "video", PLAYLIST: "playlist" };

export const hidiveGridUrl = (grid) => `${GRID_PATH}gridViewConfigId=${encodeURIComponent(grid)}`;
// Only grid pages are ever asked for; "Load more" links leave out the page size and time zone, so both are added back.
export function hidivePageUrl(url, timezone = "UTC") {
  const text = String(url || "");
  if (!text.startsWith(GRID_PATH)) return "";
  const full = new URL(text);
  full.searchParams.set("rpp", String(HIDIVE_PAGE));
  if (!full.searchParams.has("timezone")) full.searchParams.set("timezone", timezone);
  return full.toString();
}

// Cards are routes to SERIES#n (a show), VOD#n (a film) or PLAYLIST#n; the next page is the grid's "Load More" action.
export function parseHidiveGrid(body) {
  const items = [];
  let next = "";
  const seen = new Set();
  const walk = (value, depth) => {
    if (depth > 30 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const item of value) walk(item, depth + 1); return; }
    const action = value.action;
    if (action?.type === "route" && action.data && typeof action.data.id === "string") {
      const [type, number] = action.data.id.split("#");
      const title = cleanTitle(action.data.title);
      if (HIDIVE_PATHS[type] && /^\d+$/.test(number || "") && title && !seen.has(action.data.id)) {
        seen.add(action.data.id);
        items.push({ title, kind: type === "VOD" ? "movie" : "series", year: null, url: `https://www.hidive.com/${HIDIVE_PATHS[type]}/${number}` });
      }
    }
    if (action?.type === "CARDLIST_PAGE_NEXT" && typeof action.data?.url === "string" && action.data.url.startsWith(GRID_PATH)) next = action.data.url;
    for (const child of Object.values(value)) walk(child, depth + 1);
  };
  walk(body, 0);
  return { items, next };
}

// ---- Tubi ----

export const TUBI_API = "https://tensor-cdn.production-public.tubi.io/";
export const TUBI_PAGE = 100;
export const TUBI_MAX_PAGES = 250;
export const tubiContainerUrl = (cursor = 0) => `${TUBI_API}api/v7/containers/anime?contents_limit=${TUBI_PAGE}&cursor=${Number(cursor) || 0}`;

// "s" is a series, "v" a film; the category is Tubi's own Anime row, so everything in it counts.
export function parseTubiContainer(body) {
  const items = [];
  for (const raw of Object.values(body?.contents && typeof body.contents === "object" ? body.contents : {})) {
    const id = String(raw?.id || "");
    const title = cleanTitle(raw?.title);
    if (!/^\d+$/.test(id) || !title || !["s", "v"].includes(raw?.type)) continue;
    const series = raw.type === "s";
    items.push({ title, kind: series ? "series" : "movie", year: year(raw.year), url: `https://tubitv.com/${series ? "series" : "movies"}/${id}` });
  }
  const cursor = Number(body?.container?.cursor);
  return { items, cursor: Number.isInteger(cursor) && cursor > 0 ? cursor : null };
}

// ---- Netflix (signed-in genre A–Z lists) ----
// browse/genre/6721 = Anime Series, browse/genre/3063 = Anime Movies (?bc= is only UI chrome).
export const NETFLIX_ANIME_TV = 6721;
export const NETFLIX_ANIME_MOVIES = 3063;
export const NETFLIX_GENRES = [NETFLIX_ANIME_TV, NETFLIX_ANIME_MOVIES];
export const NETFLIX_CATALOG_PAGE = 48;
// Hard cap so a bad Falcor page shape can't spin forever (48 × 80 ≈ 3840 titles per genre).
export const NETFLIX_MAX_PAGES = 80;

const falcorValue = (node) => {
  if (!node || typeof node !== "object") return node;
  if (node.$type === "atom") return node.value;
  if (node.$type === "ref") return null;
  if ("value" in node) return node.value;
  return node;
};
const falcorRef = (node) => {
  if (!node || typeof node !== "object") return null;
  if (node.$type === "ref" && Array.isArray(node.value)) return node.value;
  if (node.reference?.$type === "ref" && Array.isArray(node.reference.value)) return node.reference.value;
  if (Array.isArray(node.reference)) return node.reference;
  if (Array.isArray(node)) return node;
  return null;
};

// One Falcor genre A–Z page -> catalog items. kindHint: "series" for 6721, "movie" for 3063.
// ids: every video id on the page (even without a title yet), so the tab can hydrate in a second request.
export function parseNetflixGenrePage(graph, genreId, { kindHint = "series" } = {}) {
  const items = [];
  const ids = [];
  const list = graph?.genres?.[genreId]?.az;
  if (!list || typeof list !== "object") return { items, ids, count: 0, more: false };
  const indexes = Object.keys(list).filter((key) => /^\d+$/.test(key)).map(Number).sort((a, b) => a - b);
  let hitEnd = false;
  for (const index of indexes) {
    const entry = list[index];
    if (entry?.$type === "atom" || entry?.$type === "sentinel") { hitEnd = true; break; }
    const ref = falcorRef(entry);
    const videoId = ref?.[0] === "videos" ? String(ref[1] || "") : "";
    if (!/^\d+$/.test(videoId)) continue;
    ids.push(videoId);
    const video = graph?.videos?.[videoId];
    const title = cleanTitle(falcorValue(video?.title) || falcorValue(entry?.title) || falcorValue(entry?.reference?.title));
    if (!title) continue;
    const summary = falcorValue(video?.summary) || falcorValue(entry?.summary);
    const type = String(summary?.type || falcorValue(video?.type) || "").toLowerCase();
    const movie = type === "movie" || (type !== "show" && kindHint === "movie");
    items.push({
      title,
      kind: movie ? "movie" : "series",
      year: year(falcorValue(video?.releaseYear) ?? summary?.releaseYear),
      url: `https://www.netflix.com/title/${videoId}`,
    });
  }
  // more only if this page looked full — an empty title page must not keep paging forever.
  return { items, ids, count: indexes.length, more: indexes.length >= NETFLIX_CATALOG_PAGE && !hitEnd };
}

// ---- Matching and links ----

const ITEM_URL = {
  crunchyroll: "https://www.crunchyroll.com/series/",
  hidive: "https://www.hidive.com/",
  tubi: "https://tubitv.com/",
  netflix: "https://www.netflix.com/title/",
};

// Titles passed on by a site's tab, kept only if they look like that site's own catalog entries.
// Same URL listed twice (grid overlap, type re-fetch) is kept once.
export function cleanCatalogItems(items, service) {
  const prefix = ITEM_URL[service];
  if (!prefix || !Array.isArray(items)) return [];
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (out.length >= CATALOG_MAX_ITEMS) break;
    const title = cleanTitle(item?.title);
    const url = typeof item?.url === "string" && item.url.startsWith(prefix) && item.url.length < 300 && !/[\s"'<>]/.test(item.url) ? item.url : "";
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    out.push({ title, kind: item?.kind === "movie" ? "movie" : "series", year: year(item?.year), url });
  }
  return out;
}

// Which version a listing is ("Naruto (Subtitled)", "Shaman King (Español)"); the show is the same either way.
const VERSION_TAG = /\s*[([](?:english|original japanese|uncut|subbed|subtitled|subtitulado|dubbed|english dubbed|english dub|doblado|español|espanol)[)\]]\s*$/i;
export const catalogTitle = (title) => cleanTitle(String(title || "").replace(VERSION_TAG, ""));
// A listing that names its part or season ("Lupin the 3rd - Part 1", "K-ON! Season 1") is only that one.
const NAMES_PART = /\b(?:part|season|cour)\s*(?:\d+|[ivx]+)\b|\b\d+(?:st|nd|rd|th)\s+season\b/i;
const FAMILY_SEARCH = 80;
// More relatives than this sharing the name means a franchise of separate shows (Lupin III), listed one by one.
const SEASONS_MAX = 20;

// Relatives named after the entry ("Sailor Moon S" after "Sailor Moon", "Made in Abyss: ..." after "Made in Abyss"):
// the seasons and specials a service lists under one show. Spin-offs with their own names are left to their own listing.
function seasonsOf(engine, id) {
  const base = looseKey(engine.row(id)?.title);
  if (base.length < 4) return [id];
  const found = [...engine.franchise(id, FAMILY_SEARCH)].filter((other) => {
    const row = engine.row(other);
    const name = looseKey(row?.title);
    // A year right after the name is a remake ("Shaman King (2021)"), a different show.
    return row && row.format !== "MOVIE" && (name === base || (name.startsWith(`${base} `) && !/^(?:19|20)\d\d\b/.test(name.slice(base.length + 1))));
  });
  return found.length > SEASONS_MAX ? [id] : found;
}

// A title found for sure is linked to its AniList entry; a series also covers its other seasons and specials
// (not its films, which services list separately). Titles found directly win over ones filled in from a franchise.
export function matchCatalog(engine, items) {
  const direct = {};
  const family = {};
  const unmatched = [];
  let matched = 0;
  for (const item of items) {
    const title = catalogTitle(item.title);
    const found = engine.match({ series: title, kind: item.kind === "movie" ? "movie" : "", year: item.year || null });
    if (!found.anilistId || found.confidence !== "high") {
      if (unmatched.length < UNMATCHED_KEEP) unmatched.push(item.title);
      continue;
    }
    matched += 1;
    direct[found.anilistId] ??= item.url;
    if (item.kind === "movie" || NAMES_PART.test(title)) continue;
    for (const id of seasonsOf(engine, found.anilistId)) family[id] ??= item.url;
  }
  return { links: { ...family, ...direct }, matched, unmatched };
}

// What the app is told about each catalog: no links, just how it went (incl. match rate for baselines).
export function catalogSummary(catalogs = {}) {
  return Object.fromEntries(CATALOG_SERVICES.filter((id) => catalogs[id]).map((id) => {
    const { at = 0, titles = 0, matched = 0, links = {}, error = "", tried = 0 } = catalogs[id];
    const matchRate = at && titles > 0 ? matched / titles : null;
    return [id, { at, titles, matched, shows: Object.keys(links).length, matchRate, error, tried }];
  }));
}

// Where a show watched on a service lives there. Crunchyroll and HIDIVE history carry the site's own series id;
// the others only know the show's name, so their link searches the service for it.
const SEARCH_URL = {
  netflix: (q) => `https://www.netflix.com/search?q=${encodeURIComponent(q)}`,
  prime: (q) => `https://www.primevideo.com/search/ref=atv_nb_sr?phrase=${encodeURIComponent(q)}`,
  tubi: (q) => `https://tubitv.com/search/${encodeURIComponent(q)}`,
};
function watchedUrl(service, seriesId, name) {
  if (service === "crunchyroll" && /^[A-Z0-9]{6,}$/i.test(seriesId)) return `https://www.crunchyroll.com/series/${seriesId}`;
  if (service === "hidive" && /^\d+$/.test(seriesId)) return `https://www.hidive.com/series/${seriesId}`;
  // Netflix title ids resume the profile's last episode when opened while signed in.
  if (service === "netflix" && /^\d+$/.test(seriesId)) return `https://www.netflix.com/title/${seriesId}`;
  const query = String(name || seriesId).split(" — ")[0].trim();
  return SEARCH_URL[service] && query ? SEARCH_URL[service](query) : serviceById(service)?.home || "";
}

// AniList id -> [{ service, url }] for every show matched from a service's watch history (KEYS.matches),
// whether or not the service is connected now. List sites (MyAnimeList, Kitsu) aren't streaming services.
export function watchedOn(matches = {}) {
  const found = {};
  for (const [key, record] of Object.entries(matches || {})) {
    const at = key.indexOf(":");
    const service = key.slice(0, at);
    if (!serviceById(service) || !record?.anilistId) continue;
    const seriesId = key.slice(at + 1).split("/")[0];
    const list = (found[record.anilistId] ||= []);
    if (!list.some((item) => item.service === service)) list.push({ service, url: watchedUrl(service, seriesId, record.names?.[0]) });
  }
  return found;
}

/** True when this connected service has a successful local catalog read — prefer it over the where-map gap feed. */
export function catalogCoversService(catalogs = {}, connected = [], service) {
  if (!service || !connected.includes(service)) return false;
  const row = catalogs?.[service];
  return Boolean(row?.at && !row.error && row.links && typeof row.links === "object");
}

// AniList id -> [{ service, url, checked, seen }]: catalogs of connected services (checked), gap-map / AniList
// fills for Netflix·Prime·Hulu when that service has no local catalog yet, and shows watched on any
// service (seen). Services switched off under Where to watch are left out. dead: { [url]: true } drops bad links.
export function availability(catalogs = {}, connected = [], { matches = {}, hidden = [], gaps = {}, dead = {} } = {}) {
  const off = new Set(hidden.map((site) => site.toLowerCase()));
  const shown = (service) => !off.has(serviceById(service)?.name.toLowerCase());
  const live = (url) => typeof url === "string" && url.startsWith("https://") && !dead[url];
  const covered = new Set(CATALOG_SERVICES.filter((id) => catalogCoversService(catalogs, connected, id)));
  const found = {};
  const add = (anilistId, service, url, flag) => {
    if (!shown(service) || !live(url)) return;
    const list = (found[anilistId] ||= []);
    const known = list.find((item) => item.service === service);
    if (known) {
      known[flag] = true;
      // A catalog / gap title URL beats a search page or an older AniList link for the same service.
      if (flag === "checked" && url && (!known.url || /\/search/i.test(known.url))) known.url = url;
    } else list.push({ service, url, checked: flag === "checked", seen: flag === "seen" });
  };
  for (const id of CATALOG_SERVICES) {
    if (!connected.includes(id) || !catalogs[id]?.links) continue;
    for (const [anilistId, url] of Object.entries(catalogs[id].links)) add(anilistId, id, url, "checked");
  }
  for (const [anilistId, row] of Object.entries(gaps || {})) {
    const id = Number(anilistId);
    if (!Number.isInteger(id)) continue;
    for (const service of GAP_SERVICES) {
      // Local Netflix/HIDIVE/… browse catalog is region-accurate; don't overlay AniList where-map chips on top.
      if (covered.has(service)) continue;
      const url = row?.[service];
      if (url) add(id, service, url, "checked");
    }
  }
  for (const [anilistId, list] of Object.entries(watchedOn(matches))) for (const { service, url } of list) add(anilistId, service, url, "seen");
  return found;
}

// The services that put shows in "On my services", by name.
export const availableServices = (found) => [...new Set(Object.values(found).flat().map((item) => item.service))].map((id) => serviceById(id)?.name).filter(Boolean);

// Changes whenever what the filter uses changes, so cached filtered pages are dropped.
export const catalogStamp = (catalogs = {}, connected = [], { matches = {}, hidden = [], gaps = {}, dead = {} } = {}) => [
  ...CATALOG_SERVICES.filter((id) => connected.includes(id) && catalogs[id]?.at).map((id) => `${id}${catalogs[id].at}`),
  `w${Object.keys(matches || {}).length}.${Object.values(matches || {}).reduce((sum, record) => (sum + (Number(record?.anilistId) || 0)) % 1e9, 0)}`,
  `g${Object.keys(gaps || {}).length}`,
  `d${Object.keys(dead || {}).length}`,
  ...hidden.map((site) => site.toLowerCase()).sort(),
].join("-");

/** Where chips: titles on `site`, or (when only) titles whose known sources are that site alone. */
export function matchesWhereSite(sources, site, { only = false } = {}) {
  if (!site || site === "all") return true;
  const list = [...new Set((Array.isArray(sources) ? sources : []).map((id) => String(id || "").toLowerCase()).filter(Boolean))];
  const want = String(site).toLowerCase();
  if (!list.includes(want)) return false;
  return only ? list.length === 1 : true;
}

// True when every place a show is known to stream (AniList's links, catalogs, watch history) is switched off.
// A show with no known place stays: there's nothing to say it's only on those sites.
// everywhere: availability() without hidden, so a switched-off service's catalog still counts here.
export function onlyOnHidden(show, everywhere, hidden = []) {
  if (!hidden.length) return false;
  const sites = [
    ...(show?.streaming || []).map((link) => link.site),
    ...(everywhere?.[show?.anilistId] || []).map((item) => serviceById(item.service)?.name),
  ].filter(Boolean);
  return sites.length > 0 && sites.every((site) => !visibleLink(site, hidden));
}

// A show's where-to-watch with catalogs and watch history folded in: AniList's link to such a service is marked
// (checked: in its catalog / gap map; seen: watched there), and a service AniList doesn't mention is added.
// When a catalog confirmed the title, its URL replaces AniList's (AniList deep links go stale often).
export function withCatalogLinks(show, found, { dead = {} } = {}) {
  const here = found?.[show?.anilistId];
  const streaming = (show.streaming || [])
    .filter((link) => link?.url && !dead[link.url] && serviceForSite(link.site))
    .map((link) => ({ ...link }));
  if (!here?.length) return streaming.length === (show.streaming || []).length ? show : { ...show, streaming };
  for (const { service, url, checked, seen } of here) {
    if (dead[url]) continue;
    const listed = streaming.find((link) => serviceForSite(link.site)?.id === service);
    if (listed) {
      Object.assign(listed, checked ? { checked } : {}, seen ? { seen } : {});
      if (checked && url) listed.url = url;
    } else streaming.push({ site: serviceById(service).name, url, color: BRAND[service] || "", icon: "", ...(checked ? { checked } : {}), ...(seen ? { seen } : {}) });
  }
  return { ...show, streaming, onServices: here.map((item) => item.service) };
}
