// Builds search/feeds/where-map.json — Netflix / Prime / Hulu title links keyed by AniList id.
//   node search/scripts/where-map.mjs
// Sources (licensed / public):
//   1. AniList GraphQL externalLinks (STREAMING) for Netflix, Amazon Prime Video, Hulu
//   2. Optional TMDB watch/providers when TMDB_API_KEY is set — fills presence using TMDB ids from id-map.json
//      (search URLs only when TMDB has no deep link; title URLs from AniList win over search)
// Dead / malformed URLs are dropped at build time (HEAD/GET probe). Ship the feed; the extension re-checks later.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GAP_SERVICES } from "../src/lib/catalogs.js";
import { isDeadResponse, isSearchUrl } from "../src/lib/link-check.js";
import { ANILIST_GAP_SITE, WHERE_MAP_VERSION, cleanWhereMap, gapUrlOk, preferGapUrl } from "../src/lib/where-map.js";

const SEARCH = path.resolve(import.meta.dirname, "..");
const FEEDS = path.join(SEARCH, "feeds");
const USER_AGENT = "CrunchilistSearch-wheremap/1.0 (https://github.com/Phoniix/crunchilist)";
const ANILIST = "https://graphql.anilist.co";
const TMDB = "https://api.themoviedb.org/3";
// TMDB / JustWatch provider ids (US).
const TMDB_PROVIDER = { netflix: 8, prime: 9, hulu: 15 };
const SEARCH_URL = {
  netflix: (q) => `https://www.netflix.com/search?q=${encodeURIComponent(q)}`,
  prime: (q) => `https://www.primevideo.com/search/ref=atv_nb_sr?phrase=${encodeURIComponent(q)}`,
  hulu: (q) => `https://www.hulu.com/search?q=${encodeURIComponent(q)}`,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function anilistPage(page, { fetchImpl = fetch } = {}) {
  const query = `query ($page: Int) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      media(type: ANIME, sort: POPULARITY_DESC) {
        id title { romaji english } externalLinks { site url type }
      }
    }
  }`;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetchImpl(ANILIST, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify({ query, variables: { page } }),
    });
    if (response.status === 429) {
      await sleep(2_000 * (attempt + 1) ** 2);
      continue;
    }
    if (!response.ok) throw new Error(`AniList answered ${response.status}`);
    const json = await response.json();
    if (json.errors?.length) throw new Error(json.errors[0].message || "AniList GraphQL error");
    return json.data.Page;
  }
  throw new Error("AniList rate-limited (429) after retries");
}

export function mergeGapEntry(into, service, url) {
  if (!gapUrlOk(service, url)) return into;
  const next = { ...into, [service]: preferGapUrl(into[service], url) };
  return next;
}

export function gapsFromMedia(media) {
  let entry = {};
  for (const link of media?.externalLinks || []) {
    if (link?.type !== "STREAMING") continue;
    const service = ANILIST_GAP_SITE[link.site];
    if (service) entry = mergeGapEntry(entry, service, link.url);
  }
  return entry;
}

async function harvestAnilist({ maxPages = 80, fetchImpl = fetch } = {}) {
  const links = {};
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await anilistPage(page, { fetchImpl });
    for (const media of data.media || []) {
      const entry = gapsFromMedia(media);
      if (!Object.keys(entry).length) continue;
      const id = media.id;
      links[id] = { ...(links[id] || {}), ...entry };
      for (const service of GAP_SERVICES) if (entry[service]) links[id][service] = preferGapUrl(links[id][service], entry[service]);
    }
    if (!data.pageInfo?.hasNextPage) break;
    await sleep(1_100);
  }
  return links;
}

async function tmdbProviders(kind, id, { key, region = "US", fetchImpl = fetch } = {}) {
  const url = `${TMDB}/${kind}/${id}/watch/providers?api_key=${encodeURIComponent(key)}`;
  const response = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) return null;
  const json = await response.json();
  const flatrate = json?.results?.[region]?.flatrate;
  if (!Array.isArray(flatrate)) return null;
  const ids = new Set(flatrate.map((row) => row.provider_id));
  return Object.fromEntries(GAP_SERVICES.map((service) => [service, ids.has(TMDB_PROVIDER[service])]));
}

async function fillFromTmdb(links, idMapRows, { key, fetchImpl = fetch, limit = 4000 } = {}) {
  let n = 0;
  for (const row of idMapRows || []) {
    if (n >= limit) break;
    const anilist = row.a;
    if (!anilist) continue;
    const tv = row.tmdbTv;
    const movies = Array.isArray(row.tmdbMovie) ? row.tmdbMovie : [];
    let providers = null;
    if (tv) providers = await tmdbProviders("tv", tv, { key, fetchImpl });
    if (!providers && movies[0]) providers = await tmdbProviders("movie", movies[0], { key, fetchImpl });
    if (!providers) continue;
    n += 1;
    const title = row.title || String(anilist);
    const entry = { ...(links[anilist] || {}) };
    for (const service of GAP_SERVICES) {
      if (!providers[service]) continue;
      if (entry[service] && !isSearchUrl(entry[service])) continue;
      entry[service] = preferGapUrl(entry[service], SEARCH_URL[service](title));
    }
    if (Object.keys(entry).length) links[anilist] = entry;
    await sleep(30);
  }
  return links;
}

export async function probeDead(links, { fetchImpl = fetch, concurrency = 4 } = {}) {
  const urls = [...new Set(Object.values(links).flatMap((row) => GAP_SERVICES.map((s) => row[s]).filter(Boolean)))];
  const dead = new Set();
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    await Promise.all(batch.map(async (url) => {
      if (isSearchUrl(url)) return;
      try {
        let response = await fetchImpl(url, { method: "HEAD", redirect: "follow", headers: { "User-Agent": USER_AGENT } });
        if (response.status === 405 || response.status === 501) {
          response = await fetchImpl(url, { method: "GET", redirect: "follow", headers: { "User-Agent": USER_AGENT, Range: "bytes=0-0" } });
        }
        if (isDeadResponse(response.status, response.url, url)) dead.add(url);
      } catch { /* keep — extension will re-check */ }
    }));
    await sleep(100);
  }
  const cleaned = {};
  for (const [id, row] of Object.entries(links)) {
    const next = {};
    for (const service of GAP_SERVICES) {
      const url = row[service];
      if (url && !dead.has(url) && gapUrlOk(service, url)) next[service] = url;
    }
    if (Object.keys(next).length) cleaned[id] = next;
  }
  return { links: cleaned, dropped: dead.size };
}

export async function buildWhereMap({ fetchImpl = fetch, maxPages = 80, probe = true, tmdbKey = process.env.TMDB_API_KEY || "" } = {}) {
  let links = await harvestAnilist({ maxPages, fetchImpl });
  if (tmdbKey) {
    try {
      const feed = JSON.parse(await readFile(path.join(FEEDS, "id-map.json"), "utf8"));
      links = await fillFromTmdb(links, feed.rows, { key: tmdbKey, fetchImpl });
    } catch (error) {
      console.warn("TMDB fill skipped:", error.message);
    }
  }
  let dropped = 0;
  if (probe) ({ links, dropped } = await probeDead(links, { fetchImpl }));
  // Include time so same-calendar-day rebuilds still change `updated` and clients re-download.
  const updated = process.env.WHERE_MAP_UPDATED || new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const feed = cleanWhereMap({
    version: WHERE_MAP_VERSION,
    updated,
    source: tmdbKey ? "anilist+tmdb" : "anilist",
    links,
  });
  return { feed, dropped, count: Object.keys(feed.links).length };
}

async function main() {
  // Default 80 — still a partial gap fill, not full Netflix/Prime/Hulu catalogs.
  const maxPages = Number(process.env.WHERE_MAP_PAGES || 80);
  const probe = process.env.WHERE_MAP_PROBE !== "0";
  console.log(`Harvesting AniList streaming links (up to ${maxPages} pages)${process.env.TMDB_API_KEY ? " + TMDB" : ""}…`);
  const { feed, dropped, count } = await buildWhereMap({ maxPages, probe });
  await mkdir(FEEDS, { recursive: true });
  await writeFile(path.join(FEEDS, "where-map.json"), `${JSON.stringify(feed)}\n`);
  const meta = {
    version: WHERE_MAP_VERSION,
    updated: feed.updated,
    stats: { total: count, dropped, source: feed.source, pages: maxPages },
  };
  await writeFile(path.join(FEEDS, "where-map-meta.json"), `${JSON.stringify(meta)}\n`);
  console.log(`where-map: ${count} shows, dropped ${dropped} dead URLs -> search/feeds/where-map.json`);
  console.log(`where-map meta updated=${feed.updated}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
