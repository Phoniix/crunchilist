// Builds search/feeds/id-map.json, the master list keyed by AniList id: node search/scripts/id-map.mjs
// Sources, all openly licensed:
//  - anime-offline-database (ODbL 1.0 + DbCL 1.0), continued by cedya77 after manami-project archived it in July 2026;
//    manami's final release is the fallback if the continuation is unavailable.
//  - Wikidata (CC0) for TMDB, TVDB and IMDb ids.
// Rows only grow: a show missing from this week's data is kept unless its source lists it as deleted,
// known ids are never dropped, and the health check refuses to publish a feed that shrank or lost its shape.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FEED_VERSION } from "../src/lib/id-map.js";

const SEARCH = path.resolve(import.meta.dirname, "..");
export const FEEDS = path.join(SEARCH, "feeds");
const USER_AGENT = "CrunchilistSearch-idmap/1.0 (https://github.com/Phoniix/crunchilist)";

export const OFFLINE_SOURCES = [
  { name: "cedya77/anime-offline-database", base: "https://github.com/cedya77/anime-offline-database/releases/latest/download" },
  { name: "manami-project/anime-offline-database", base: "https://github.com/manami-project/anime-offline-database/releases/latest/download", frozen: true },
];

const PROVIDERS = [
  [/^https:\/\/anilist\.co\/anime\/(\d+)$/, "anilist", Number],
  [/^https:\/\/myanimelist\.net\/anime\/(\d+)$/, "mal", Number],
  [/^https:\/\/kitsu\.(?:app|io)\/anime\/(\d+)$/, "kitsu", Number],
  [/^https:\/\/anidb\.net\/anime\/(\d+)$/, "anidb", Number],
  [/^https:\/\/anisearch\.com\/anime\/(\d+)$/, "anisearch", Number],
  [/^https:\/\/anime-planet\.com\/anime\/([\w-]+)$/, "animePlanet", String],
  [/^https:\/\/livechart\.me\/anime\/(\d+)$/, "livechart", Number],
  [/^https:\/\/simkl\.com\/anime\/(\d+)$/, "simkl", Number],
  [/^https:\/\/animenewsnetwork\.com\/encyclopedia\/anime\.php\?id=(\d+)$/, "ann", Number],
];

// Every provider id in a list of source URLs; a row can carry more than one AniList id when AniList has duplicates.
export function providerIds(urls = []) {
  const ids = {};
  for (const url of urls) {
    for (const [pattern, key, cast] of PROVIDERS) {
      const match = pattern.exec(url);
      if (!match) continue;
      (ids[key] ||= []).push(cast(match[1]));
      break;
    }
  }
  return ids;
}

const MAL_PICTURE = /^https:\/\/cdn\.myanimelist\.net\/images\/anime\/(\d+\/\d+)\.(?:jpg|webp)$/;

export function compactPicture(url = "") {
  if (!url || /\/no_pic\.png$/.test(url)) return undefined;
  const mal = MAL_PICTURE.exec(url);
  return mal ? mal[1] : url;
}

function seconds(duration) {
  if (!duration?.value) return undefined;
  const scale = { SECONDS: 1, MINUTES: 60, HOURS: 3600 }[duration.unit] || 1;
  return Math.round(duration.value * scale);
}

function words(dict, values = []) {
  const index = [];
  for (const value of new Set(values.map((item) => String(item).trim()).filter(Boolean))) {
    if (!dict.lookup.has(value)) {
      dict.lookup.set(value, dict.list.length);
      dict.list.push(value);
    }
    index.push(dict.lookup.get(value));
  }
  return index.sort((a, b) => a - b);
}

// Append-only word lists: earlier indexes never move, so unchanged rows stay byte-identical week to week.
export function wordList(previous = []) {
  return { list: [...previous], lookup: new Map(previous.map((value, index) => [value, index])) };
}

const drop = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null && !(Array.isArray(value) && !value.length)));

// One feed row per AniList id in the offline database.
export function rowsFromOffline(entries, { tags = wordList(), studios = wordList() } = {}) {
  const parsed = entries.map((entry) => ({ entry, ids: providerIds(entry.sources) }));
  const anilistBy = { mal: new Map(), kitsu: new Map(), anidb: new Map() };
  for (const { ids } of parsed) {
    const anilist = ids.anilist?.[0];
    if (!anilist) continue;
    for (const key of Object.keys(anilistBy)) for (const id of ids[key] || []) if (!anilistBy[key].has(id)) anilistBy[key].set(id, anilist);
  }
  const rows = new Map();
  for (const { entry, ids } of parsed) {
    if (!ids.anilist?.length) continue;
    const related = providerIds(entry.relatedAnime);
    const relatedAnilist = new Set(related.anilist || []);
    for (const key of Object.keys(anilistBy)) for (const id of related[key] || []) if (anilistBy[key].has(id)) relatedAnilist.add(anilistBy[key].get(id));
    const median = entry.score?.median;
    for (const anilist of ids.anilist) {
      if (rows.has(anilist)) continue;
      relatedAnilist.delete(anilist);
      rows.set(anilist, drop({
        a: anilist,
        mal: ids.mal?.[0],
        kitsu: ids.kitsu?.[0],
        anidb: ids.anidb?.[0],
        anisearch: ids.anisearch?.[0],
        animePlanet: ids.animePlanet?.[0],
        livechart: ids.livechart?.[0],
        simkl: ids.simkl?.[0],
        ann: ids.ann?.[0],
        title: entry.title,
        synonyms: [...new Set((entry.synonyms || []).filter((name) => name && name !== entry.title))].sort(),
        format: entry.type && entry.type !== "UNKNOWN" ? entry.type : undefined,
        episodes: entry.episodes || undefined,
        status: entry.status && entry.status !== "UNKNOWN" ? entry.status : undefined,
        season: entry.animeSeason?.season && entry.animeSeason.season !== "UNDEFINED" ? entry.animeSeason.season : undefined,
        year: entry.animeSeason?.year || undefined,
        duration: seconds(entry.duration),
        picture: compactPicture(entry.picture),
        score: Number.isFinite(median) ? Math.round(median * 10) / 10 : undefined,
        studios: words(studios, entry.studios),
        tags: words(tags, entry.tags),
        related: [...relatedAnilist].sort((a, b) => a - b),
      }));
    }
  }
  return { rows, tags, studios };
}

// Wikidata SPARQL bindings -> TMDB/TVDB/IMDb ids per AniList id, joined through AniList, MAL or AniDB ids.
export function externalIds(bindings, rows) {
  const byMal = new Map();
  const byAnidb = new Map();
  for (const row of rows.values()) {
    if (row.mal) byMal.set(row.mal, row.a);
    if (row.anidb) byAnidb.set(row.anidb, row.a);
  }
  const found = new Map();
  for (const binding of bindings) {
    const value = (key) => binding[key]?.value;
    const anilist = Number(value("al")) || byMal.get(Number(value("mal"))) || byAnidb.get(Number(value("anidb")));
    if (!anilist || !rows.has(anilist)) continue;
    const ids = found.get(anilist) || {};
    // Wikidata returns rows in no fixed order; the lowest id wins so the feed doesn't change between runs.
    const lowest = (current, next) => (current === undefined || next < current ? next : current);
    const wikidata = /Q(\d+)$/.exec(value("item") || "")?.[1];
    if (wikidata) ids.wikidata = `Q${lowest(Number(ids.wikidata?.slice(1)) || undefined, Number(wikidata))}`;
    if (/^\d+$/.test(value("tv") || "")) ids.tmdbTv = lowest(ids.tmdbTv, Number(value("tv")));
    if (/^\d+$/.test(value("movie") || "")) ids.tmdbMovie = [...new Set([...(ids.tmdbMovie || []), Number(value("movie"))])].sort((a, b) => a - b);
    if (/^\d+$/.test(value("tvdb") || "")) ids.tvdb = lowest(ids.tvdb, Number(value("tvdb")));
    if (/^tt\d+$/.test(value("imdb") || "")) ids.imdb = [...new Set([...(ids.imdb || []), value("imdb")])].sort();
    found.set(anilist, ids);
  }
  return found;
}

const ID_KEYS = ["mal", "kitsu", "anidb", "anisearch", "animePlanet", "livechart", "simkl", "ann", "wikidata", "tmdbTv", "tmdbMovie", "tvdb", "imdb"];

// Fresh rows win, but known ids are kept, and rows missing this week stay unless the source deleted them.
export function mergeRows(previous = [], fresh, { dead = new Set(), today, keepLostDays = 120 } = {}) {
  const merged = new Map();
  const before = new Map(previous.map((row) => [row.a, row]));
  let kept = 0;
  let removed = 0;
  for (const [id, row] of fresh) {
    const old = before.get(id);
    const next = { ...row };
    if (old) for (const key of ID_KEYS) if (next[key] === undefined && old[key] !== undefined) next[key] = old[key];
    next.since = old ? old.since : before.size ? today : undefined;
    merged.set(id, drop(next));
  }
  for (const [id, old] of before) {
    if (merged.has(id)) continue;
    const lostDays = old.lost ? (Date.parse(today) - Date.parse(old.lost)) / 86400000 : 0;
    if (dead.has(id) || lostDays > keepLostDays) {
      removed += 1;
      continue;
    }
    merged.set(id, { ...old, lost: old.lost || today });
    kept += 1;
  }
  return { rows: [...merged.values()].sort((a, b) => a.a - b.a), kept, removed };
}

// Refuses a feed that shrank, lost most of its MAL links, or has malformed rows; the published feed stays live.
export function healthCheck(fresh, previous, { maxDrop = 0.15 } = {}) {
  const problems = [];
  const rows = [...fresh.values()];
  if (rows.length < 1000) problems.push(`only ${rows.length} shows`);
  if (previous?.fresh && rows.length < previous.fresh * (1 - maxDrop)) problems.push(`shows dropped from ${previous.fresh} to ${rows.length}`);
  const withMal = rows.filter((row) => row.mal).length / Math.max(rows.length, 1);
  if (previous?.malShare && withMal < previous.malShare - 0.1) problems.push(`MAL links fell from ${Math.round(previous.malShare * 100)}% to ${Math.round(withMal * 100)}%`);
  const broken = rows.filter((row) => !Number.isInteger(row.a) || row.a <= 0 || typeof row.title !== "string" || !row.title.trim());
  if (broken.length) problems.push(`${broken.length} malformed rows, first: ${JSON.stringify(broken[0]).slice(0, 120)}`);
  return { ok: !problems.length, problems, malShare: withMal };
}

// One row per line so git diffs stay small and readable.
export function serializeFeed(feed) {
  const { rows, ...head } = feed;
  const header = JSON.stringify(head).slice(0, -1);
  return `${header},"rows":[\n${rows.map((row) => JSON.stringify(row)).join(",\n")}\n]}\n`;
}

async function fetchText(url, { fetchImpl = fetch, tries = 3 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers: { "user-agent": USER_AGENT } });
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      return await response.text();
    } catch (error) {
      if (attempt >= tries) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
    }
  }
}

export function parseJsonl(text) {
  const lines = text.split("\n").filter((line) => line.trim());
  const meta = JSON.parse(lines[0]);
  return { meta, entries: lines.slice(1).map((line) => JSON.parse(line)) };
}

async function loadOffline({ fetchImpl, log }) {
  for (const source of OFFLINE_SOURCES) {
    try {
      const { meta, entries } = parseJsonl(await fetchText(`${source.base}/anime-offline-database.jsonl`, { fetchImpl }));
      let dead = new Set();
      try {
        const deadFile = JSON.parse(await fetchText(`${source.base}/anilist-minified.json`, { fetchImpl }));
        dead = new Set((deadFile.deadEntries || []).map(Number));
      } catch (error) {
        log(`No dead-entry list from ${source.name}: ${error.message}`);
      }
      log(`${source.name}: ${entries.length} entries, updated ${meta.lastUpdate}${source.frozen ? " (frozen fallback)" : ""}`);
      return { source, meta, entries, dead };
    } catch (error) {
      log(`${source.name} unavailable: ${error.message}`);
    }
  }
  throw new Error("No anime-offline-database source could be loaded");
}

const WIKIDATA_QUERY = `SELECT ?item ?al ?mal ?anidb ?tv ?movie ?tvdb ?imdb WHERE {
  { ?item wdt:P8729 ?x } UNION { ?item wdt:P4086 ?x } UNION { ?item wdt:P5646 ?x }
  OPTIONAL { ?item wdt:P8729 ?al } OPTIONAL { ?item wdt:P4086 ?mal } OPTIONAL { ?item wdt:P5646 ?anidb }
  OPTIONAL { ?item wdt:P4983 ?tv } OPTIONAL { ?item wdt:P4947 ?movie } OPTIONAL { ?item wdt:P4835 ?tvdb } OPTIONAL { ?item wdt:P345 ?imdb } }`;

async function loadWikidata({ fetchImpl, log }) {
  try {
    const response = await fetchImpl("https://query.wikidata.org/sparql", {
      method: "POST",
      headers: { "user-agent": USER_AGENT, accept: "application/sparql-results+json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ query: WIKIDATA_QUERY }),
    });
    if (!response.ok) throw new Error(`Wikidata answered ${response.status}`);
    return (await response.json()).results.bindings;
  } catch (error) {
    log(`Wikidata unavailable, keeping last week's TMDB/TVDB/IMDb ids: ${error.message}`);
    return [];
  }
}

export async function readPrevious(out = FEEDS) {
  try {
    return JSON.parse(await readFile(path.join(out, "id-map.json"), "utf8"));
  } catch {
    return null;
  }
}

export async function buildIdMap({ fetchImpl = fetch, out = FEEDS, now = new Date(), log = console.log } = {}) {
  const previous = await readPrevious(out);
  const offline = await loadOffline({ fetchImpl, log });
  const { rows: fresh, tags, studios } = rowsFromOffline(offline.entries, { tags: wordList(previous?.tags), studios: wordList(previous?.studios) });
  const health = healthCheck(fresh, previous?.stats);
  if (!health.ok) throw new Error(`Health check failed, the published feed stays live:\n- ${health.problems.join("\n- ")}`);
  const bindings = await loadWikidata({ fetchImpl, log });
  for (const [anilist, ids] of externalIds(bindings, fresh)) fresh.set(anilist, { ...fresh.get(anilist), ...ids });
  const today = now.toISOString().slice(0, 10);
  const { rows, kept, removed } = mergeRows(previous?.rows, fresh, { dead: offline.dead, today });
  const stats = { fresh: fresh.size, total: rows.length, kept, removed, malShare: Math.round(health.malShare * 1000) / 1000, tmdb: rows.filter((row) => row.tmdbTv || row.tmdbMovie).length };
  const feed = {
    version: FEED_VERSION,
    updated: today,
    sources: {
      offline: { name: offline.source.name, lastUpdate: offline.meta.lastUpdate, license: "ODbL 1.0 + DbCL 1.0", url: `https://github.com/${offline.source.name}` },
      wikidata: { license: "CC0 1.0", url: "https://www.wikidata.org", rows: bindings.length },
    },
    pictureBase: "https://cdn.myanimelist.net/images/anime/",
    stats,
    tags: tags.list,
    studios: studios.list,
    rows,
  };
  if (previous && serializeFeed({ ...feed, updated: previous.updated }) === serializeFeed(previous)) {
    log("No change.");
    return { feed, changed: false };
  }
  const text = serializeFeed(feed);
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "id-map.json"), text);
  await writeFile(path.join(out, "id-map-meta.json"), `${JSON.stringify({ version: FEED_VERSION, updated: today, stats, bytes: Buffer.byteLength(text) })}\n`);
  log(`Wrote ${rows.length} shows (${stats.fresh} fresh, ${kept} kept from earlier weeks, ${removed} removed, ${stats.tmdb} with TMDB), ${(Buffer.byteLength(text) / 1e6).toFixed(1)} MB`);
  return { feed, changed: true };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  buildIdMap().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
