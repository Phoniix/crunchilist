import assert from "node:assert/strict";
import test from "node:test";

// The real background search and Prism data, over an in-memory Chrome holding a small catalog and a YouTube feed.
const local = {};
const changeListeners = [];
const fetched = [];
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        const list = keys == null ? Object.keys(local) : [].concat(keys);
        return Object.fromEntries(list.filter((key) => key in local).map((key) => [key, structuredClone(local[key])]));
      },
      set: async (values) => {
        const changes = {};
        for (const [key, value] of Object.entries(values)) changes[key] = { oldValue: local[key], newValue: value };
        Object.assign(local, structuredClone(values));
        for (const listener of changeListeners) listener(changes, "local");
      },
      remove: async (keys) => { for (const key of [].concat(keys)) delete local[key]; },
    },
    session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    onChanged: { addListener: (fn) => changeListeners.push(fn) },
  },
  runtime: { getManifest: () => ({ version: "0.0.0" }), sendMessage: async () => {} },
};
globalThis.fetch = async (input) => {
  fetched.push(String(input?.url || input));
  if (String(input).includes("graphql.anilist.co")) return new Response(JSON.stringify({ data: { Page: { media: [] } } }), { status: 200 });
  throw new TypeError("Failed to fetch");
};

const { catalogSearch, catalogSuggest } = await import("../background/search.js");
const { appData } = await import("../background/app-data.js");

const now = Date.now();
const hit = (anilistId, extra) => ({
  kind: "hit", anilistId, synonyms: [], hiddenTags: [], tagRanks: {}, format: "TV", episodes: 12, year: 2020, score: 80, popularity: 200000,
  cover: `https://s4.anilist.co/${anilistId}.jpg`, relations: [], cachedAt: now, detailed: true, detailVersion: 3, ...extra,
});
const CATALOG = [
  ["GRFRIEREN1", "Frieren: Beyond Journey's End", hit(154587, { titles: { english: "Frieren: Beyond Journey's End", romaji: "Sousou no Frieren" }, genres: ["Adventure", "Fantasy"], tags: ["Elf", "Travel"], about: "An elf mage outlives her party and travels again.", relations: [{ type: "SEQUEL", anilistId: 182255 }] })],
  ["GRSPYFAM01", "SPY x FAMILY", hit(140960, { titles: { english: "SPY x FAMILY" }, genres: ["Action", "Comedy"], tags: ["Espionage", "Family Life"], about: "A spy builds a fake family." })],
  ["GRGEASS001", "Code Geass: Lelouch of the Rebellion", hit(1575, { titles: { english: "Code Geass: Lelouch of the Rebellion" }, genres: ["Action", "Mecha", "Drama"], tags: ["Mecha", "Military", "Super Power"], about: "An exiled prince leads a rebellion with giant robots." })],
];

const video = (n, prefix) => ({ id: `${prefix}${String(n).padStart(11 - prefix.length, "0")}`, title: `Episode ${n}`, seconds: 1420 });
const feedShow = (anilistId, title, facts, extra = {}) => ({
  anilistId,
  title,
  channel: "GUNDAM CHANNEL INTL",
  playlist: "PLgundam0001",
  url: "https://www.youtube.com/playlist?list=PLgundam0001",
  facts: { titles: { english: title }, format: "TV", releaseStatus: "FINISHED", episodes: 3, duration: 24, popularity: 150000, score: 78, year: 2022, cover: "https://s4.anilist.co/yt.jpg", relations: [], ...facts },
  videos: [1, 2, 3].map((n) => video(n, String(anilistId))),
  ...extra,
});
const FEED = {
  version: 1,
  builtAt: "2026-10-12T00:00:00.000Z",
  shows: [
    feedShow(139274, "Mobile Suit Gundam: The Witch from Mercury", { genres: ["Mecha", "Sci-Fi", "Drama"], tags: ["Mecha", "Space", "School"], about: "A transfer student pilots a mobile suit at a school in space." }),
    feedShow(182255, "Frieren: Beyond Journey's End Season 2", { genres: ["Fantasy"], tags: ["Elf"], about: "The elf mage travels on." }),
    feedShow(700001, "Island Only Show", { genres: ["Mecha"], tags: ["Mecha"], about: "Robots on an island." }, { videos: [1, 2, 3].map((n) => ({ ...video(n, "is"), allow: ["PH"] })) }),
  ],
};

function seed({ feed = FEED, settings = {} } = {}) {
  for (const key of Object.keys(local)) delete local[key];
  local.crCatalog = { items: CATALOG.map(([id, title, row]) => ({ id, title, type: "series", anilistId: row.anilistId, cover: row.cover })), newest: [], complete: true, updatedAt: now, locale: "en-US" };
  local.crCornerState = { version: 2, library: {}, anilistCache: Object.fromEntries(CATALOG.map(([id, , row]) => [`series:${id}`, row])), settings, taste: {} };
  if (feed) local.crYoutube = { feed, fetchedAt: now, checkedAt: now };
}

const ids = (reply) => reply.results.map((row) => row.id);

test("a YouTube title is found by name and by mood, labeled as free on YouTube", async () => {
  seed();
  const byName = await catalogSearch("gundam the witch from mercury", "", "all");
  assert.equal(byName.results[0].id, "sight:yt-139274");
  assert.ok(byName.results[0].tags.includes("Free on YouTube"));
  assert.equal(byName.results[0].url, "https://www.youtube.com/playlist?list=PLgundam0001");
  const byMood = await catalogSearch("mecha in space", "", "all");
  assert.ok(ids(byMood).includes("sight:yt-139274"));
  const suggested = await catalogSuggest("gundam", "", "all");
  assert.equal(suggested.suggestions[0].id, "sight:yt-139274");
});

test("Crunchyroll-only searches (the Crunchyroll page panel) rank exactly as without the feed", async () => {
  seed({ feed: null });
  const before = await catalogSearch("mecha", "", "crunchyroll");
  seed();
  const after = await catalogSearch("mecha", "", "crunchyroll");
  assert.deepEqual(after, before);
  assert.ok(!ids(after).some((id) => id.includes("yt-")));
});

test("Crunchyroll's own titles still come first for their names", async () => {
  seed();
  assert.equal((await catalogSearch("frieren", "", "all")).results[0].id, "sight:GRFRIEREN1");
  assert.equal((await catalogSearch("code geass", "", "all")).results[0].id, "sight:GRGEASS001");
});

test("a season of a Crunchyroll show and a show blocked in the viewer's country stay out", async () => {
  seed();
  const all = ids(await catalogSearch("", "", "all", { browse: true, limit: 60 }));
  assert.ok(all.includes("sight:yt-139274"));
  assert.ok(!all.includes("sight:yt-182255"));
  assert.ok(!all.includes("sight:yt-700001"));
});

test("Home's Popular row stays Crunchyroll's", async () => {
  seed();
  const home = await catalogSearch("", "", "all");
  const popular = home.sections.find((section) => section.title === "Popular");
  assert.ok(popular.items.every((item) => !item.id.includes("yt-")));
});

test("turning the setting off removes YouTube titles everywhere", async () => {
  seed({ settings: { youtubeTitles: false } });
  assert.ok(!ids(await catalogSearch("gundam the witch from mercury", "", "all")).includes("sight:yt-139274"));
  const { shows } = await appData();
  assert.ok(!shows.some((show) => show.id.startsWith("yt-")));
});

test("Prism gets the YouTube title as a show with its episodes, and the same id search links to", async () => {
  seed();
  const { shows, view } = await appData();
  const show = shows.find((row) => row.id === "yt-139274");
  assert.ok(show);
  assert.equal(show.onCrunchyroll, false);
  assert.equal(show.youtube.videos.length, 3);
  assert.equal(show.youtube.expected, 3);
  assert.deepEqual(show.streaming, [{ site: "YouTube", url: "https://www.youtube.com/playlist?list=PLgundam0001" }]);
  assert.deepEqual(show.genres, ["Mecha", "Sci-Fi", "Drama"]);
  assert.equal(show.seasons.length, 1);
  assert.ok(!shows.some((row) => row.id === "yt-182255"));
  assert.equal(view.settings.youtubeTitles, true);
  const crIds = shows.filter((row) => row.onCrunchyroll).map((row) => row.id);
  assert.deepEqual(crIds, ["GRFRIEREN1", "GRSPYFAM01", "GRGEASS001"]);
});

test("a fresh feed doesn't trigger a download", () => {
  assert.ok(!fetched.some((url) => url.includes("raw.githubusercontent.com")));
});
