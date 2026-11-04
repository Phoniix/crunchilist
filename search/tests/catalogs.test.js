import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { cleanSettings } from "../src/lib/settings.js";
import {
  availability, availableServices, catalogStamp, catalogSummary, catalogTitle, cleanCatalogItems, crunchyrollBrowseUrl, hidiveGridUrl, hidivePageUrl,
  matchCatalog, NETFLIX_ANIME_MOVIES, NETFLIX_ANIME_TV, onlyOnHidden, parseCrunchyrollBrowse, parseHidiveGrid, parseNetflixGenrePage, parseTubiContainer, tubiContainerUrl, watchedOn, withCatalogLinks,
} from "../src/lib/catalogs.js";
import { streamingLinks } from "../src/background/catalog.js";
import { createMatcher } from "../src/lib/match-engine.js";
import { contentScriptsFor, serviceById } from "../src/lib/services.js";

const feed = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "feeds", "id-map.json"), "utf8"));
const engine = createMatcher(feed.rows);
const SEARCH = path.resolve(import.meta.dirname, "..");

test("Crunchyroll catalog: browse pages of 50, series and films with their links", () => {
  const url = new URL(crunchyrollBrowseUrl(100, { type: "series" }));
  assert.equal(url.origin + url.pathname, "https://www.crunchyroll.com/content/v2/discover/browse");
  assert.equal(url.searchParams.get("start"), "100");
  assert.equal(url.searchParams.get("n"), "50");
  assert.equal(url.searchParams.get("sort_by"), "alphabetical");
  assert.equal(url.searchParams.get("type"), "series");
  const parsed = parseCrunchyrollBrowse({
    total: 2,
    data: [
      { id: "GR751KNZY", type: "series", title: "Attack on Titan", slug_title: "attack-on-titan", series_metadata: { series_launch_year: 2013 } },
      { id: "G25FVD45Q", type: "movie_listing", title: "Jujutsu Kaisen 0", slug_title: "jujutsu-kaisen-0", movie_listing_metadata: { movie_release_year: 2021 } },
      { id: "bad id", title: "Nope" },
    ],
  });
  assert.equal(parsed.total, 2);
  assert.equal(parsed.count, 3);
  assert.deepEqual(parsed.items, [
    { title: "Attack on Titan", kind: "series", year: 2013, url: "https://www.crunchyroll.com/series/GR751KNZY/attack-on-titan" },
    { title: "Jujutsu Kaisen 0", kind: "movie", year: 2021, url: "https://www.crunchyroll.com/series/G25FVD45Q/jujutsu-kaisen-0" },
  ]);
});

// The shape hidive.com/series receives (checked against the live site), trimmed to what matters.
const card = (type, id, title) => ({ $type: "card", attributes: { header: [{ $type: "image" }], action: { type: "route", data: { type, title, accessLevel: "GRANTED", id: `${type}#${id}` } } } });
const GRID = {
  elements: [
    { $type: "gridBlock", attributes: { elements: [{ $type: "buttonList", attributes: { buttons: [{ attributes: { action: { type: "SELECT_TAB", data: { tab: "x" } } } }] } }] } },
    { $type: "cardList", attributes: {
      cards: [card("SERIES", 5296, "I'm Dating a Dark Summoner"), card("VOD", 977315, "The Dangers in My Heart: The Movie"), card("SERIES", 5296, "I'm Dating a Dark Summoner")],
      actions: { next: { text: "Load More", action: { type: "CARDLIST_PAGE_NEXT", data: { url: "https://dce-frontoffice.imggaming.com/api/v1/view/content-grid?lastSeen=abc&gridViewConfigId=g1&sort=publicationDate" } } } },
    } },
  ],
};

test("HIDIVE catalog: series and films from the grid, and the next page with its size and time zone added back", () => {
  const { items, next } = parseHidiveGrid(GRID);
  assert.deepEqual(items, [
    { title: "I'm Dating a Dark Summoner", kind: "series", year: null, url: "https://www.hidive.com/series/5296" },
    { title: "The Dangers in My Heart: The Movie", kind: "movie", year: null, url: "https://www.hidive.com/video/977315" },
  ]);
  const page = new URL(hidivePageUrl(next, "America/New_York"));
  assert.equal(page.searchParams.get("lastSeen"), "abc");
  assert.equal(page.searchParams.get("rpp"), "63");
  assert.equal(page.searchParams.get("timezone"), "America/New_York");
  assert.ok(hidiveGridUrl("g 1").endsWith("gridViewConfigId=g%201"));
  assert.equal(hidivePageUrl("https://dce-frontoffice.imggaming.com/api/v2/customer/history/vod?p=1"), "", "only grid pages are loaded");
  assert.equal(parseHidiveGrid({ elements: [] }).next, "");
});

test("Netflix catalog: Anime Series and Movies genre A–Z pages become title links", () => {
  assert.equal(NETFLIX_ANIME_TV, 6721);
  assert.equal(NETFLIX_ANIME_MOVIES, 3063);
  const graph = {
    genres: {
      6721: {
        az: {
          0: { $type: "ref", value: ["videos", "80057281"] },
          1: { reference: { $type: "ref", value: ["videos", "80100172"] } },
          2: { $type: "atom" },
        },
      },
    },
    videos: {
      80057281: { title: { $type: "atom", value: "Attack on Titan" }, summary: { $type: "atom", value: { type: "show" } }, releaseYear: { $type: "atom", value: 2013 } },
      80100172: { title: "Your Name.", summary: { type: "movie" }, releaseYear: 2016 },
    },
  };
  const parsed = parseNetflixGenrePage(graph, 6721, { kindHint: "series" });
  assert.deepEqual(parsed.items, [
    { title: "Attack on Titan", kind: "series", year: 2013, url: "https://www.netflix.com/title/80057281" },
    { title: "Your Name.", kind: "movie", year: 2016, url: "https://www.netflix.com/title/80100172" },
  ]);
  assert.deepEqual(parsed.ids, ["80057281", "80100172"]);
  assert.equal(parsed.more, false);
  assert.deepEqual(cleanCatalogItems(parsed.items, "netflix"), parsed.items);
  // Refs without titles still expose ids so the tab can hydrate — and must not claim "more" on a short page.
  const bare = parseNetflixGenrePage({
    genres: { 6721: { az: { 0: { $type: "ref", value: ["videos", "1"] }, 1: { $type: "ref", value: ["videos", "2"] } } } },
    videos: {},
  }, 6721);
  assert.equal(bare.items.length, 0);
  assert.deepEqual(bare.ids, ["1", "2"]);
  assert.equal(bare.more, false);
});

test("Tubi catalog: the Anime category, series and films, until the cursor runs out", () => {
  assert.equal(tubiContainerUrl(100), "https://tensor-cdn.production-public.tubi.io/api/v7/containers/anime?contents_limit=100&cursor=100");
  const parsed = parseTubiContainer({
    container: { cursor: 100 },
    contents: {
      "0300021419": { id: "300021419", type: "s", title: "Pokémon the Series: Sun & Moon", year: 2019 },
      283884: { id: "283884", type: "v", title: "Dante's Inferno", year: 2010 },
      x: { id: "x", type: "s", title: "No id" },
    },
  });
  assert.equal(parsed.cursor, 100);
  assert.deepEqual(parsed.items.map((item) => [item.kind, item.url]).sort(), [["movie", "https://tubitv.com/movies/283884"], ["series", "https://tubitv.com/series/300021419"]]);
  assert.equal(parseTubiContainer({ container: { cursor: null }, contents: {} }).cursor, null);
});

test("items from a tab are kept only with that site's own links", () => {
  const items = cleanCatalogItems([
    { title: "  Made  in Abyss ", kind: "series", url: "https://www.hidive.com/series/1271" },
    { title: "Elsewhere", url: "https://evil.example/series/1" },
    { title: "Quote", url: "https://www.hidive.com/series/1\"onclick" },
    { title: "", url: "https://www.hidive.com/series/2" },
    { title: "Made in Abyss again", kind: "series", url: "https://www.hidive.com/series/1271" },
  ], "hidive");
  assert.deepEqual(items, [{ title: "Made in Abyss", kind: "series", year: null, url: "https://www.hidive.com/series/1271" }]);
  assert.deepEqual(cleanCatalogItems("nope", "hidive"), []);
  assert.deepEqual(cleanCatalogItems(items, "netflix"), []);
});

test("matching: a series covers its seasons but not its films; a film links only itself", () => {
  const series = { title: "Made in Abyss", kind: "series", year: 2017, url: "https://www.hidive.com/series/1271" };
  const film = { title: "Made in Abyss: Dawn of the Deep Soul", kind: "movie", year: 2020, url: "https://www.hidive.com/video/9" };
  const { links, matched, unmatched } = matchCatalog(engine, [series, film, { title: "Zzzz no such anime qqq", kind: "series", url: "https://www.hidive.com/series/3" }]);
  assert.equal(matched, 2);
  assert.deepEqual(unmatched, ["Zzzz no such anime qqq"]);
  const first = engine.match({ series: "Made in Abyss" }).anilistId;
  const movie = engine.match({ series: film.title, kind: "movie" }).anilistId;
  assert.equal(links[first], series.url);
  assert.equal(links[movie], film.url, "the film keeps its own link, not the series'");
  const seasons = Object.entries(links).filter(([, url]) => url === series.url).map(([id]) => Number(id));
  assert.ok(seasons.length > 1, "later seasons are covered too");
  assert.ok(seasons.every((id) => engine.row(id).format !== "MOVIE"));
});

test("matching: version tags are dropped, named parts stay single, and remakes and huge franchises aren't spread to", () => {
  assert.equal(catalogTitle("Shaman King (Español)"), "Shaman King");
  assert.equal(catalogTitle("Megalo Box (Subtitulado)"), "Megalo Box");
  assert.equal(catalogTitle("Tokyo Magnitude 8.0 (Original Japanese)"), "Tokyo Magnitude 8.0");
  assert.equal(catalogTitle("Mushibugyo (TV)"), "Mushibugyo (TV)");
  const urls = (title) => Object.keys(matchCatalog(engine, [{ title, kind: "series", url: "https://tubitv.com/series/1" }]).links).map((id) => engine.row(Number(id)).title);
  assert.ok(urls("Shaman King (Español)").includes("Shaman King"));
  assert.ok(!urls("Shaman King (Español)").some((title) => /2021/.test(title)), "the 2021 remake is its own show");
  assert.equal(urls("Lupin the 3rd: Part II").length, 1, "a named part is only that part");
  assert.ok(urls("Sailor Moon").some((title) => /Sailor Moon SuperS$/.test(title)), "a show's later seasons count");
});

const CATALOGS = {
  crunchyroll: { at: 5, titles: 2, matched: 1, links: { 1: "https://www.crunchyroll.com/series/A" }, unmatched: ["x"], error: "" },
  hidive: { at: 7, titles: 1, matched: 1, links: { 1: "https://www.hidive.com/series/9", 2: "https://www.hidive.com/series/8" }, error: "" },
};

test("availability counts connected services only, and the stamp changes when a catalog is read again", () => {
  assert.deepEqual(availability(CATALOGS, ["crunchyroll"]), { 1: [{ service: "crunchyroll", url: "https://www.crunchyroll.com/series/A", checked: true, seen: false }] });
  assert.equal(Object.keys(availability(CATALOGS, ["crunchyroll", "hidive"])).length, 2);
  const stamp = catalogStamp(CATALOGS, ["crunchyroll", "hidive"]);
  assert.equal(stamp, "crunchyroll5-hidive7-w0.0-g0-d0");
  assert.notEqual(catalogStamp({ ...CATALOGS, hidive: { ...CATALOGS.hidive, at: 8 } }, ["crunchyroll", "hidive"]), stamp);
  assert.notEqual(catalogStamp(CATALOGS, ["crunchyroll", "hidive"], { hidden: ["HIDIVE"] }), stamp);
  assert.notEqual(catalogStamp(CATALOGS, ["crunchyroll", "hidive"], { matches: { "netflix:x": { anilistId: 5 } } }), stamp);
  assert.notEqual(catalogStamp(CATALOGS, ["crunchyroll", "hidive"], { gaps: { 9: { netflix: "https://www.netflix.com/title/1" } } }), stamp);
  const summary = catalogSummary(CATALOGS);
  assert.deepEqual(summary.hidive, { at: 7, titles: 1, matched: 1, shows: 2, matchRate: 1, error: "", tried: 0 });
  assert.ok(!("links" in summary.crunchyroll), "the app isn't sent the links");
});

test("show links: catalog URL replaces AniList's, a missing service is added, dead links drop", () => {
  const found = availability(CATALOGS, ["crunchyroll", "hidive"]);
  const show = { anilistId: 1, streaming: [{ site: "Crunchyroll", url: "https://www.crunchyroll.com/series/OTHER", color: "#f00", icon: "" }] };
  const linked = withCatalogLinks(show, found);
  assert.deepEqual(linked.streaming.map((link) => [link.site, link.url, Boolean(link.checked)]), [
    ["Crunchyroll", "https://www.crunchyroll.com/series/A", true],
    ["HIDIVE", "https://www.hidive.com/series/9", true],
  ]);
  assert.deepEqual(linked.onServices, ["crunchyroll", "hidive"]);
  assert.equal(show.streaming.length, 1, "the original show isn't changed");
  assert.equal(withCatalogLinks({ anilistId: 3, streaming: [] }, found).streaming.length, 0);
  const gaps = availability({}, [], { gaps: { 3: { netflix: "https://www.netflix.com/title/801" } }, dead: { "https://www.netflix.com/title/801": true } });
  assert.equal(gaps[3], undefined, "dead gap URLs are excluded");
  const liveGap = availability({}, [], { gaps: { 3: { netflix: "https://www.netflix.com/title/801" } } });
  assert.deepEqual(liveGap[3], [{ service: "netflix", url: "https://www.netflix.com/title/801", checked: true, seen: false }]);
});

test("local Netflix catalog wins over where-map gaps for the same service", () => {
  const gaps = {
    143338: { netflix: "https://www.netflix.com/title/81662402", hulu: "https://www.hulu.com/series/x" },
    5: { netflix: "https://www.netflix.com/title/80057281" },
  };
  const catalogs = {
    netflix: { at: 10, error: "", titles: 1, matched: 1, links: { 5: "https://www.netflix.com/title/80057281" } },
  };
  const found = availability(catalogs, ["netflix"], { gaps });
  assert.equal(found[143338]?.some((row) => row.service === "netflix"), false);
  assert.equal(found[143338]?.find((row) => row.service === "hulu")?.checked, true);
  assert.deepEqual(found[5], [{ service: "netflix", url: "https://www.netflix.com/title/80057281", checked: true, seen: false }]);
  // No successful catalog yet → gaps still fill Netflix.
  const fromGaps = availability({ netflix: { tried: 10, error: "tab closed", links: {} } }, ["netflix"], { gaps });
  assert.equal(fromGaps[143338]?.find((row) => row.service === "netflix")?.url, "https://www.netflix.com/title/81662402");
});

const MATCHES = {
  "netflix:frieren": { anilistId: 3, how: "auto", names: ["Frieren: Beyond Journey's End — Season 1"] },
  "prime:frieren": { anilistId: 3, how: "auto", names: ["Frieren"] },
  "crunchyroll:GG5H5XQX4/GY2P": { anilistId: 1, how: "auto", names: ["Show A"] },
  "hidive:123": { anilistId: 4, how: "auto", names: ["Show H"] },
  "mal:55": { anilistId: 6, how: "list" },
  "youtube:old": { anilistId: 3, how: "auto", names: ["Frieren"] },
  "netflix:nothing": { anilistId: null },
};

test("shows watched on any service count, linked straight to the show or to a search for it", () => {
  const seen = watchedOn(MATCHES);
  assert.deepEqual(seen[3], [
    { service: "netflix", url: "https://www.netflix.com/search?q=Frieren%3A%20Beyond%20Journey's%20End" },
    { service: "prime", url: "https://www.primevideo.com/search/ref=atv_nb_sr?phrase=Frieren" },
  ]);
  assert.ok(!seen[3].some((item) => item.service === "youtube"), "YouTube history is ignored");
  assert.deepEqual(seen[1], [{ service: "crunchyroll", url: "https://www.crunchyroll.com/series/GG5H5XQX4" }]);
  assert.deepEqual(seen[4], [{ service: "hidive", url: "https://www.hidive.com/series/123" }]);
  assert.ok(!seen[6], "list sites aren't streaming services");

  const found = availability(CATALOGS, [], { matches: MATCHES });
  assert.deepEqual(found[1], [{ service: "crunchyroll", url: "https://www.crunchyroll.com/series/GG5H5XQX4", checked: false, seen: true }], "history counts even when not connected");
  const both = availability(CATALOGS, ["crunchyroll"], { matches: MATCHES });
  assert.deepEqual(both[1], [{ service: "crunchyroll", url: "https://www.crunchyroll.com/series/A", checked: true, seen: true }]);
  assert.deepEqual(availableServices(both).sort(), ["Crunchyroll", "HIDIVE", "Netflix", "Prime Video"]);
});

test("a service switched off under Where to watch is left out, connected or not", () => {
  const found = availability(CATALOGS, ["crunchyroll", "hidive"], { matches: MATCHES, hidden: ["Crunchyroll", "Netflix"] });
  assert.deepEqual(found[1].map((item) => item.service), ["hidive"], "Crunchyroll's catalog and history are both hidden");
  assert.deepEqual(found[3].map((item) => item.service), ["prime"]);
  assert.deepEqual(found[2].map((item) => item.service), ["hidive"]);
  const linked = withCatalogLinks({ anilistId: 3, streaming: [] }, found);
  assert.deepEqual(linked.streaming.map((link) => [link.site, Boolean(link.seen), link.color]), [["Prime Video", true, "#00A8E1"]]);
});

test("a show is only on switched-off sites when every known place for it is switched off", () => {
  const everywhere = availability(CATALOGS, ["crunchyroll", "hidive"], { matches: MATCHES });
  const crOnly = { anilistId: 50, streaming: [{ site: "Crunchyroll", url: "x" }] };
  assert.equal(onlyOnHidden(crOnly, everywhere, ["Crunchyroll"]), true);
  assert.equal(onlyOnHidden(crOnly, everywhere, []), false, "nothing switched off, nothing hidden");
  assert.equal(onlyOnHidden({ ...crOnly, streaming: [...crOnly.streaming, { site: "Netflix", url: "y" }] }, everywhere, ["Crunchyroll"]), false);
  assert.equal(onlyOnHidden({ anilistId: 51, streaming: [] }, everywhere, ["Crunchyroll"]), false, "no known place to watch stays");
  assert.equal(onlyOnHidden({ anilistId: 2, streaming: [] }, everywhere, ["HIDIVE"]), true, "a switched-off service's catalog still counts");
  assert.equal(onlyOnHidden({ anilistId: 1, streaming: [] }, everywhere, ["HIDIVE"]), false, "show 1 is also on Crunchyroll");
  assert.equal(onlyOnHidden({ anilistId: 1, streaming: [] }, everywhere, ["HIDIVE", "Crunchyroll"]), true);
  assert.equal(cleanSettings({}).hideOffSiteShows, true);
});

test("where-to-watch only keeps services this extension supports", () => {
  const links = [
    { site: "YouTube", type: "STREAMING", url: "https://www.youtube.com/playlist?list=PLzzz" },
    { site: "Disney Plus", type: "STREAMING", url: "https://www.disneyplus.com/x" },
    { site: "Crunchyroll", type: "STREAMING", url: "https://www.crunchyroll.com/series/X" },
    { site: "Hulu", type: "STREAMING", url: "https://www.hulu.com/series/y" },
  ];
  assert.deepEqual(streamingLinks(links).map((link) => link.site), ["Crunchyroll", "Hulu"]);
});

test("catalog reading is on unless switched off; Tubi gets a page script for its catalog", () => {
  assert.equal(cleanSettings({}).readCatalogs, true);
  assert.equal(cleanSettings({ readCatalogs: false }).readCatalogs, false);
  assert.equal(cleanSettings({ readCatalogs: "no" }).readCatalogs, true);
  const scripts = contentScriptsFor(serviceById("tubi"));
  assert.deepEqual(scripts.map((script) => [script.js[0], script.world]), [["content/tubi-page.js", "MAIN"], ["content/tubi.js", "ISOLATED"], ["content/return.js", "ISOLATED"], ["content/site-panel.js", "ISOLATED"]]);
  const page = readFileSync(path.join(SEARCH, "src", "content", "tubi-page.js"), "utf8");
  assert.ok(!/postMessage\([^)]*headers/.test(page), "the token is never posted out of the page");
});
