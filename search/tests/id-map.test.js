import assert from "node:assert/strict";
import test from "node:test";
import { checkDue, refreshPlan, CHECK_EVERY_MS } from "../src/background/id-map-store.js";
import { FEED_VERSION, decodeRow, validFeed } from "../src/lib/id-map.js";
import { compactPicture, externalIds, healthCheck, mergeRows, providerIds, rowsFromOffline, serializeFeed, wordList } from "../scripts/id-map.mjs";

const HXH = {
  sources: ["https://anidb.net/anime/8550", "https://anilist.co/anime/11061", "https://anime-planet.com/anime/hunter-x-hunter-2011", "https://animenewsnetwork.com/encyclopedia/anime.php?id=13262", "https://kitsu.app/anime/6448", "https://myanimelist.net/anime/11061"],
  title: "Hunter x Hunter (2011)",
  type: "TV",
  episodes: 148,
  status: "FINISHED",
  animeSeason: { season: "FALL", year: 2011 },
  picture: "https://cdn.myanimelist.net/images/anime/1337/99013.jpg",
  duration: { value: 1380, unit: "SECONDS" },
  score: { median: 8.966 },
  synonyms: ["HxH", "Hunter x Hunter (2011)", "HxH", "ハンター×ハンター (2011)"],
  studios: ["madhouse inc."],
  relatedAnime: ["https://anilist.co/anime/136", "https://myanimelist.net/anime/137", "https://anilist.co/anime/11061"],
  tags: ["action", "adventure", "action"],
};
const HXH_1999 = { sources: ["https://anilist.co/anime/136", "https://myanimelist.net/anime/136"], title: "Hunter x Hunter", type: "TV", episodes: 62, status: "FINISHED", animeSeason: { season: "FALL", year: 1999 }, picture: "https://raw.githubusercontent.com/cedya77/anime-offline-database/main/pics/no_pic.png", synonyms: [], studios: ["nippon animation"], relatedAnime: [], tags: ["adventure"] };
const OVA = { sources: ["https://anilist.co/anime/137", "https://myanimelist.net/anime/137"], title: "Hunter x Hunter OVA", type: "OVA", episodes: 8, status: "FINISHED", animeSeason: { season: "UNDEFINED", year: 2002 }, picture: "https://media.kitsu.app/anime/1.jpg", synonyms: [], studios: [], relatedAnime: [], tags: [] };
const MAL_ONLY = { sources: ["https://myanimelist.net/anime/999999"], title: "Only on MAL", type: "SPECIAL", episodes: 1, status: "FINISHED", animeSeason: {}, picture: "", synonyms: [], studios: [], relatedAnime: [], tags: [] };

test("provider ids are read from every source URL", () => {
  assert.deepEqual(providerIds(HXH.sources), { anidb: [8550], anilist: [11061], animePlanet: ["hunter-x-hunter-2011"], ann: [13262], kitsu: [6448], mal: [11061] });
  assert.deepEqual(providerIds(["https://kitsu.io/anime/5", "https://example.com/anime/1"]), { kitsu: [5] });
});

test("pictures are stored short for MAL and dropped when they're placeholders", () => {
  assert.equal(compactPicture(HXH.picture), "1337/99013");
  assert.equal(compactPicture(HXH_1999.picture), undefined);
  assert.equal(compactPicture(OVA.picture), OVA.picture);
});

test("rows are keyed by AniList id, with every id, fact and relation the source has", () => {
  const { rows, tags, studios } = rowsFromOffline([HXH, HXH_1999, OVA, MAL_ONLY]);
  assert.deepEqual([...rows.keys()], [11061, 136, 137], "shows without an AniList id are left out");
  const row = rows.get(11061);
  assert.deepEqual(row, {
    a: 11061, mal: 11061, kitsu: 6448, anidb: 8550, animePlanet: "hunter-x-hunter-2011", ann: 13262,
    title: "Hunter x Hunter (2011)", synonyms: ["HxH", "ハンター×ハンター (2011)"], format: "TV", episodes: 148, status: "FINISHED",
    season: "FALL", year: 2011, duration: 1380, picture: "1337/99013", score: 9, studios: [0], tags: [0, 1], related: [136, 137],
  });
  assert.deepEqual(tags.list, ["action", "adventure"]);
  assert.deepEqual(studios.list, ["madhouse inc.", "nippon animation"]);
  assert.equal(rows.get(137).season, undefined, "UNDEFINED seasons are dropped");
});

test("word lists only grow, so earlier indexes never move", () => {
  const tags = wordList(["zombies", "action"]);
  const { rows } = rowsFromOffline([HXH], { tags });
  assert.deepEqual(tags.list, ["zombies", "action", "adventure"]);
  assert.deepEqual(rows.get(11061).tags, [1, 2]);
});

test("Wikidata adds TMDB, TVDB and IMDb ids, joined by AniList, MAL or AniDB id", () => {
  const { rows } = rowsFromOffline([HXH, HXH_1999]);
  const bindings = [
    { item: { value: "http://www.wikidata.org/entity/Q1" }, al: { value: "11061" }, tv: { value: "46298" }, tvdb: { value: "252322" }, imdb: { value: "tt2098220" } },
    { item: { value: "http://www.wikidata.org/entity/Q2" }, mal: { value: "136" }, movie: { value: "5" } },
    { item: { value: "http://www.wikidata.org/entity/Q2" }, mal: { value: "136" }, movie: { value: "3" } },
    { item: { value: "http://www.wikidata.org/entity/Q3" }, anidb: { value: "424242" }, tv: { value: "1" } },
  ];
  const ids = externalIds(bindings, rows);
  assert.deepEqual(ids.get(11061), { wikidata: "Q1", tmdbTv: 46298, tvdb: 252322, imdb: ["tt2098220"] });
  assert.deepEqual(ids.get(136), { wikidata: "Q2", tmdbMovie: [3, 5] });
  assert.equal(ids.size, 2);
});

test("matched shows stay: known ids are kept, missing shows stay until their source deletes them", () => {
  const previous = [
    { a: 1, title: "Kept ids", mal: 10, tmdbTv: 77, since: "2026-01-01" },
    { a: 2, title: "Missing this week" },
    { a: 3, title: "Deleted on AniList" },
    { a: 4, title: "Missing for months", lost: "2026-01-01" },
  ];
  const fresh = new Map([[1, { a: 1, title: "Kept ids", mal: 10 }], [5, { a: 5, title: "Brand new" }]]);
  const { rows, kept, removed } = mergeRows(previous, fresh, { dead: new Set([3]), today: "2026-10-13" });
  assert.deepEqual(rows, [
    { a: 1, title: "Kept ids", mal: 10, tmdbTv: 77, since: "2026-01-01" },
    { a: 2, title: "Missing this week", lost: "2026-10-13" },
    { a: 5, title: "Brand new", since: "2026-10-13" },
  ]);
  assert.equal(kept, 1);
  assert.equal(removed, 2);
});

test("a show that comes back loses its missing mark; the first build marks nothing as new", () => {
  const back = mergeRows([{ a: 2, title: "Back", lost: "2026-09-01" }], new Map([[2, { a: 2, title: "Back" }]]), { today: "2026-10-13" });
  assert.deepEqual(back.rows, [{ a: 2, title: "Back" }]);
  const first = mergeRows([], new Map([[1, { a: 1, title: "One" }]]), { today: "2026-10-13" });
  assert.deepEqual(first.rows, [{ a: 1, title: "One" }]);
});

function manyRows(count, { mal = true } = {}) {
  return new Map(Array.from({ length: count }, (_, index) => [index + 1, { a: index + 1, title: `Show ${index + 1}`, ...(mal ? { mal: index + 1 } : {}) }]));
}

test("the health check refuses a feed that shrank, lost its MAL links or has broken rows", () => {
  assert.equal(healthCheck(manyRows(20000), { fresh: 20500, malShare: 0.93 }).ok, true);
  assert.match(healthCheck(manyRows(15000), { fresh: 20500 }).problems.join(), /dropped from 20500 to 15000/);
  assert.match(healthCheck(manyRows(20000, { mal: false }), { fresh: 20000, malShare: 0.93 }).problems.join(), /MAL links fell/);
  assert.match(healthCheck(manyRows(500)).problems.join(), /only 500 shows/);
  const broken = manyRows(2000);
  broken.set(0, { a: 0, title: "" });
  assert.match(healthCheck(broken).problems.join(), /1 malformed rows/);
});

test("the feed is one row per line and reads back as the same data", () => {
  const feed = { version: FEED_VERSION, updated: "2026-10-13", pictureBase: "https://cdn.myanimelist.net/images/anime/", tags: ["action"], studios: ["madhouse inc."], rows: [{ a: 1, title: "A" }, { a: 2, title: "B" }] };
  const text = serializeFeed(feed);
  assert.deepEqual(JSON.parse(text), feed);
  assert.equal(text.split("\n").filter((line) => line.startsWith('{"a":')).length, 2);
});

test("rows decode into full show records with names instead of indexes", () => {
  const { rows, tags, studios } = rowsFromOffline([HXH, OVA]);
  const feed = { pictureBase: "https://cdn.myanimelist.net/images/anime/", tags: tags.list, studios: studios.list };
  const show = decodeRow(rows.get(11061), feed);
  assert.equal(show.picture, HXH.picture);
  assert.deepEqual(show.tags, ["action", "adventure"]);
  assert.deepEqual(show.studios, ["madhouse inc."]);
  assert.equal(show.ids.tmdbTv, null);
  assert.deepEqual(show.ids.imdb, []);
  assert.equal(decodeRow(rows.get(137), feed).picture, OVA.picture);
});

test("the extension only accepts a feed of its version with real rows", () => {
  const rows = Array.from({ length: 1001 }, (_, index) => ({ a: index + 1, title: "x" }));
  assert.equal(validFeed({ version: FEED_VERSION, rows, tags: [], studios: [] }), true);
  assert.equal(validFeed({ version: FEED_VERSION + 1, rows, tags: [], studios: [] }), false);
  assert.equal(validFeed({ version: FEED_VERSION, rows: rows.slice(0, 10), tags: [], studios: [] }), false);
  assert.equal(validFeed({ version: FEED_VERSION, rows: [...rows, { a: "x" }], tags: [], studios: [] }), false);
  assert.equal(validFeed(null), false);
});

test("the extension checks twice a day and downloads only when the list changed", () => {
  const now = 10 * CHECK_EVERY_MS;
  assert.equal(checkDue({}, now), true);
  assert.equal(checkDue({ checkedAt: now - 1000 }, now), false);
  assert.equal(checkDue({ checkedAt: now - CHECK_EVERY_MS }, now), true);
  const meta = { version: FEED_VERSION, updated: "2026-10-13", stats: { total: 20890 } };
  assert.equal(refreshPlan({ updated: "2026-10-13" }, meta, 20890), "same");
  assert.equal(refreshPlan({ updated: "2026-10-06" }, meta, 20890), "download");
  assert.equal(refreshPlan({ updated: "2026-10-13" }, meta, 0), "download", "an emptied database downloads again");
  assert.equal(refreshPlan({}, { ...meta, version: FEED_VERSION + 1 }, 0), "skip");
});
