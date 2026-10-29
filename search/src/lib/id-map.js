// The master list feed: one row per AniList id, built weekly by search/scripts/id-map.mjs from open data.
export const FEED_VERSION = 1;
// Crunchilist Search lives on its own branch until it's merged; the feed is read from wherever the job commits it.
export const FEED_BRANCH = "search";
const FEED_BASE = `https://raw.githubusercontent.com/Phoniix/crunchilist/${FEED_BRANCH}/search/feeds`;
export const ID_MAP_URL = `${FEED_BASE}/id-map.json`;
export const ID_MAP_META_URL = `${FEED_BASE}/id-map-meta.json`;

export const CREDITS = [
  { name: "anime-offline-database", by: "manami-project, continued by cedya77", license: "ODbL 1.0 + DbCL 1.0", url: "https://github.com/cedya77/anime-offline-database" },
  { name: "Wikidata", by: "Wikimedia contributors", license: "CC0 1.0", url: "https://www.wikidata.org" },
];

// A feed row -> the full show record the app and matcher use.
export function decodeRow(row, feed) {
  const picture = row.picture ? (/^https:/.test(row.picture) ? row.picture : `${feed.pictureBase}${row.picture}.jpg`) : "";
  return {
    anilistId: row.a,
    ids: {
      anilist: row.a,
      mal: row.mal ?? null,
      kitsu: row.kitsu ?? null,
      anidb: row.anidb ?? null,
      anisearch: row.anisearch ?? null,
      animePlanet: row.animePlanet ?? null,
      livechart: row.livechart ?? null,
      simkl: row.simkl ?? null,
      ann: row.ann ?? null,
      wikidata: row.wikidata ?? null,
      tmdbTv: row.tmdbTv ?? null,
      tmdbMovie: row.tmdbMovie || [],
      tvdb: row.tvdb ?? null,
      imdb: row.imdb || [],
    },
    title: row.title,
    synonyms: row.synonyms || [],
    format: row.format || null,
    episodes: row.episodes ?? null,
    status: row.status || null,
    season: row.season || null,
    year: row.year ?? null,
    duration: row.duration ?? null,
    picture,
    score: row.score ?? null,
    studios: (row.studios || []).map((index) => feed.studios[index]).filter(Boolean),
    tags: (row.tags || []).map((index) => feed.tags[index]).filter(Boolean),
    related: row.related || [],
    addedOn: row.since || null,
    missingSince: row.lost || null,
  };
}

export function validFeed(feed) {
  return Boolean(feed && feed.version === FEED_VERSION && Array.isArray(feed.rows) && Array.isArray(feed.tags) && Array.isArray(feed.studios) && feed.rows.length > 1000 && feed.rows.every((row) => Number.isInteger(row.a) && typeof row.title === "string"));
}
