import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCatalogChip,
  browseRequestUrl,
  buildHomeSections,
  catalogDue,
  displayPoster,
  filterCatalog,
  promptMatchLabels,
  promptFallbackBrief,
  rankCatalogSuggestions,
  rankPromptCandidates,
  promptFits,
  scorePromptCandidates,
  mergeCatalogItems,
  retainSeenCatalog,
  stampCatalogCovers,
  parseBrowsePayload,
  parseSearchPayload,
  searchRequestUrl,
} from "../lib/catalog.js";

const series = {
  id: "G6NQ5DWZ6",
  title: "Frieren",
  slug_title: "frieren",
  type: "series",
  series_metadata: { episode_count: 28 },
};

test("browse and search urls ask Crunchyroll for the regional catalog", () => {
  const browse = new URL(browseRequestUrl({ start: 50, type: "series", locale: "en-US" }));
  assert.equal(browse.pathname, "/content/v2/discover/browse");
  assert.equal(browse.searchParams.get("start"), "50");
  assert.equal(browse.searchParams.get("type"), "series");
  assert.equal(browse.searchParams.get("sort_by"), "popularity");
  const fresh = new URL(browseRequestUrl({ sort: "newly_added", pageSize: 24 }));
  assert.equal(fresh.searchParams.get("sort_by"), "newly_added");
  assert.equal(fresh.searchParams.get("n"), "24");
  const search = new URL(searchRequestUrl({ query: "frieren", type: "series", locale: "en" }));
  assert.equal(search.pathname, "/content/v2/discover/search");
  assert.equal(search.searchParams.get("locale"), "en-US");
  assert.equal(search.searchParams.get("q"), "frieren");
});

test("keeps an https poster from the browse image list", () => {
  const parsed = parseBrowsePayload({
    data: [{
      ...series,
      images: { poster_tall: [[{ source: "https://imgsrv.crunchyroll.com/frieren.jpg" }, { source: "http://evil.example/x.jpg" }]] },
    }],
  });
  assert.equal(parsed.items[0].poster, "https://imgsrv.crunchyroll.com/frieren.jpg");
});

test("home rows keep for-you only when it differs from popular", () => {
  const items = [
    { id: "GAAAAAAA", title: "Seen", type: "series", url: "https://www.crunchyroll.com/series/GAAAAAAA", episodes: 12, poster: "" },
    { id: "GBBBBBBB", title: "New to me", type: "series", url: "https://www.crunchyroll.com/series/GBBBBBBB", episodes: 12, poster: "" },
  ];
  const status = (id) => (id === "GAAAAAAA" ? "finished" : "unwatched");
  const sections = buildHomeSections({ items, newest: [items[1]], continueItems: [] }, status, false);
  assert.deepEqual(sections.map((section) => section.title), ["For you", "New releases", "Popular"]);
  assert.equal(sections[0].items[0].id, "GBBBBBBB");
  const same = buildHomeSections({ items: [items[1]], newest: [], continueItems: [] }, () => "unwatched", false);
  assert.deepEqual(same.map((section) => section.title), ["Popular"]);
});

test("parses a browse page and a grouped search payload", () => {
  const browsed = parseBrowsePayload({ total: 2, data: [series, { id: "nope", title: "Skip" }] });
  assert.equal(browsed.total, 2);
  assert.equal(browsed.items[0].url, "https://www.crunchyroll.com/series/G6NQ5DWZ6/frieren");
  assert.equal(browsed.items[0].episodes, 28);
  const found = parseSearchPayload({
    data: [
      { type: "series", items: [series] },
      { type: "movie_listing", items: [{ id: "GMOVIE01", title: "A Movie", type: "movie_listing" }] },
    ],
  });
  assert.deepEqual(found.map((item) => item.type), ["series", "movie"]);
});

test("a finished daily catalog waits, and a failed attempt waits an hour", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  assert.equal(catalogDue({ complete: true, updatedAt: now - 60 * 60 * 1000 }, now), false);
  assert.equal(catalogDue({ complete: true, updatedAt: now - 25 * 60 * 60 * 1000 }, now), true);
  assert.equal(catalogDue({ complete: false, attemptedAt: now - 5 * 60 * 1000 }, now), false);
  assert.equal(catalogDue({ complete: false, attemptedAt: now - 2 * 60 * 60 * 1000 }, now), true);
});

test("suggestions put a title match first, then For you and liked tags", () => {
  const items = [
    { id: "plain", title: "Frieren" },
    { id: "liked", title: "Frieren: Beyond" },
    { id: "other", title: "Spy x Family" },
    { id: "contains", title: "After Frieren" },
  ];
  const scoreFor = (item) => (item.id === "liked" ? 8 : 0);
  const ranked = rankCatalogSuggestions(items, "frieren", {
    scoreFor,
    forYouIds: new Set(["plain"]),
    limit: 4,
  });
  assert.deepEqual(ranked.map((item) => item.id), ["plain", "liked", "contains"]);
  assert.equal(rankCatalogSuggestions(items, "", { scoreFor, forYouIds: new Set(["other"]), limit: 1 })[0].id, "other");
});

test("search prefers titles that start with the query and chips keep one meaning each", () => {
  const items = mergeCatalogItems(
    [{ id: "GAAAAAAA", title: "Other Frieren Story", url: "https://www.crunchyroll.com/series/GAAAAAAA", type: "series", episodes: 12 }],
    [{ id: "G6NQ5DWZ6", title: "Frieren", url: "https://www.crunchyroll.com/series/G6NQ5DWZ6", type: "series", episodes: 28 }],
  );
  assert.equal(filterCatalog(items, "frieren")[0].id, "G6NQ5DWZ6");
  const movies = [
    { id: "GMOVIE01", title: "Movie", type: "movie", episodes: null },
    { id: "GSERIES1", title: "Show", type: "series", episodes: 12 },
  ];
  const status = (id) => (id === "GMOVIE01" ? "finished" : id === "GSERIES1" ? "in_progress" : "unwatched");
  assert.equal(applyCatalogChip(movies, "movie", false, status)[0].id, "GMOVIE01");
  assert.equal(applyCatalogChip(movies, "one-cour", false, status)[0].id, "GSERIES1");
  assert.equal(applyCatalogChip(movies, "unwatched", false, status).length, 0);
  const watching = [
    { id: "GAAAAAAA", title: "Watching", type: "series", episodes: 12 },
    { id: "GBBBBBBB", title: "Planned", type: "series", episodes: 12 },
    { id: "GCCCCCCCC", title: "Fresh", type: "series", episodes: 24 },
  ];
  const marks = (id) => (id === "GAAAAAAA" ? "in_progress" : id === "GBBBBBBB" ? "plan" : "unwatched");
  assert.equal(applyCatalogChip(watching, "in-progress", false, marks)[0].id, "GAAAAAAA");
  assert.equal(applyCatalogChip(watching, "plan", false, marks)[0].id, "GBBBBBBB");
});

test("a later browse page keeps an anilist cover already saved on the title", () => {
  const saved = [{
    id: "G6NQ5DWZ6",
    title: "Frieren",
    url: "https://www.crunchyroll.com/series/G6NQ5DWZ6",
    type: "series",
    episodes: 28,
    poster: "https://imgsrv.crunchyroll.com/old.jpg",
    cover: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1.jpg",
    anilistId: 154587,
  }];
  const merged = mergeCatalogItems(saved, [{
    id: "G6NQ5DWZ6",
    title: "Frieren",
    url: "https://www.crunchyroll.com/series/G6NQ5DWZ6/frieren",
    type: "series",
    episodes: 28,
    poster: "https://imgsrv.crunchyroll.com/new.jpg",
    cover: "",
    anilistId: null,
  }]);
  assert.equal(merged[0].cover, saved[0].cover);
  assert.deepEqual(retainSeenCatalog([...saved, { id: "GONE", title: "Old" }], ["G6NQ5DWZ6"]).map((item) => item.id), ["G6NQ5DWZ6"]);
  assert.equal(merged[0].anilistId, 154587);
  assert.equal(merged[0].poster, "https://imgsrv.crunchyroll.com/new.jpg");
  assert.equal(displayPoster(merged[0]), saved[0].cover);
  const stamped = stampCatalogCovers({ items: [{ id: "GAAAAAAA", title: "New", cover: "" }], newest: [{ id: "GAAAAAAA", title: "New", cover: "" }] }, {
    GAAAAAAA: { anilistId: 1, cover: "https://s4.anilist.co/file/cover.jpg" },
  });
  assert.equal(stamped.items[0].cover, "https://s4.anilist.co/file/cover.jpg");
  assert.equal(stamped.newest[0].anilistId, 1);
});

test("a sentence search changes the first titles instead of repeating for you", () => {
  const items = [
    { id: "frieren", title: "Frieren", type: "series", episodes: 28 },
    { id: "loafer", title: "Skip and Loafer", type: "series", episodes: 12 },
    { id: "another", title: "Another", type: "series", episodes: 12 },
    { id: "popular", title: "Popular Action", type: "series", episodes: 24 },
  ];
  const labels = {
    frieren: ["Adventure", "Fantasy"],
    loafer: ["Romance", "Slice of Life"],
    another: ["Horror", "Mystery"],
    popular: ["Action"],
  };
  const rank = (query) => rankPromptCandidates(items, query, {
    labelsFor: (item) => labels[item.id],
    statusFor: () => "unwatched",
    scoreFor: (item) => (item.id === "frieren" || item.id === "popular" ? 40 : 0),
    limit: 4,
  });
  const romance = rank("a short romance I have not seen");
  const horror = rank("something scary");
  assert.equal(romance[0].id, "loafer");
  assert.equal(horror[0].id, "another");
  assert.notEqual(romance[0].id, horror[0].id);
  assert.equal(romance.some((item) => item.id === "popular"), false);
  assert.equal(horror.some((item) => item.id === "frieren"), false);
  assert.deepEqual(promptMatchLabels(items[1], "a short romance I have not seen", labels.loafer), ["Romance", "Short"]);
  assert.equal(rank("frieren")[0].id, "frieren");
  const story = rankPromptCandidates(
    [
      { id: "plain", title: "Plain Show", type: "series", episodes: 12 },
      { id: "vampire", title: "Night Class", type: "series", episodes: 24 },
    ],
    "a vampire story",
    {
      labelsFor: () => [],
      aboutFor: (item) => (item.id === "vampire" ? "Students hide a vampire in their class." : "A sports team trains for a tournament."),
      statusFor: () => "unwatched",
      scoreFor: (item) => (item.id === "plain" ? 40 : 0),
    },
  );
  assert.equal(story[0].id, "vampire");
  assert.equal(
    promptFallbackBrief(items[1], "a short romance I have not seen", labels.loafer, "Mitsumi moves to Tokyo and starts again."),
    "Mitsumi moves to Tokyo and starts again.",
  );
  assert.equal(promptFallbackBrief(items[1], "a short romance I have not seen", labels.loafer, ""), "Romance, Short");
});

test("genre words in a sentence beat the same word in a title", () => {
  const shows = [
    { id: "dramatical", title: "DRAMAtical Murder", type: "series", episodes: 12 },
    { id: "sad", title: "Clannad", type: "series", episodes: 23 },
    { id: "kaya", title: "Kaya-chan Isn't Scary", type: "series", episodes: 12 },
    { id: "another", title: "Another", type: "series", episodes: 12 },
    { id: "moviename", title: "Movie", type: "series", episodes: null },
    { id: "film", title: "A Silent Voice", type: "movie", episodes: 1 },
    { id: "frieren", title: "Frieren", type: "series", episodes: 28 },
  ];
  const labels = {
    dramatical: ["Action", "Boys' Love"],
    sad: ["Drama", "Romance", "Tragedy"],
    kaya: ["Comedy", "Slice of Life"],
    another: ["Horror", "Mystery"],
    moviename: [],
    film: ["Drama"],
    frieren: ["Adventure", "Fantasy"],
  };
  const rank = (query) => rankPromptCandidates(shows, query, {
    labelsFor: (item) => labels[item.id],
    statusFor: () => "unwatched",
    limit: 7,
  });
  assert.equal(rank("a sad drama that will make me cry")[0].id, "sad");
  assert.equal(rank("a sad drama that will make me cry").some((item) => item.id === "dramatical"), false);
  assert.equal(rank("something scary")[0].id, "another");
  assert.equal(rank("something scary").some((item) => item.id === "kaya"), false);
  const movie = rank("a movie for tonight");
  assert.equal(movie[0].id, "film");
  assert.equal(movie.some((item) => item.id === "moviename"), false);
  assert.equal(rank("frieren")[0].id, "frieren");
  const scored = scorePromptCandidates(shows, "a sad drama that will make me cry", { labelsFor: (item) => labels[item.id] });
  const fits = promptFits(scored);
  assert.ok(fits.get("sad") > fits.get("film"));
  assert.ok(fits.get("sad") <= 1 && fits.get("film") > 0);
});
