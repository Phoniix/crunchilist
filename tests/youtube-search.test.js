import assert from "node:assert/strict";
import test from "node:test";

// Free YouTube catalog titles were removed from Prism search / app shows. Trailers still use youtube-nocookie.
const local = {};
const changeListeners = [];
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
  if (String(input).includes("graphql.anilist.co")) return new Response(JSON.stringify({ data: { Page: { media: [] } } }), { status: 200 });
  throw new TypeError("Failed to fetch");
};

const { catalogSearch } = await import("../background/search.js");
const { appData } = await import("../background/app-data.js");

const now = Date.now();
const hit = (anilistId, extra) => ({
  kind: "hit", anilistId, synonyms: [], hiddenTags: [], tagRanks: {}, format: "TV", episodes: 12, year: 2020, score: 80, popularity: 200000,
  cover: `https://s4.anilist.co/${anilistId}.jpg`, relations: [], cachedAt: now, detailed: true, detailVersion: 3, ...extra,
});
const CATALOG = [
  ["GRFRIEREN1", "Frieren: Beyond Journey's End", hit(154587, { titles: { english: "Frieren: Beyond Journey's End", romaji: "Sousou no Frieren" }, genres: ["Adventure", "Fantasy"], tags: ["Elf", "Travel"], about: "An elf mage outlives her party and travels again." })],
  ["GRSPYFAM01", "SPY x FAMILY", hit(140960, { titles: { english: "SPY x FAMILY" }, genres: ["Action", "Comedy"], tags: ["Espionage", "Family Life"], about: "A spy builds a fake family." })],
  ["GRGEASS001", "Code Geass: Lelouch of the Rebellion", hit(1575, { titles: { english: "Code Geass: Lelouch of the Rebellion" }, genres: ["Action", "Mecha", "Drama"], tags: ["Mecha", "Military", "Super Power"], about: "An exiled prince leads a rebellion with giant robots." })],
];

const FEED = {
  version: 1,
  builtAt: "2026-10-12T00:00:00.000Z",
  shows: [{
    anilistId: 139274,
    title: "Mobile Suit Gundam: The Witch from Mercury",
    channel: "GUNDAM CHANNEL INTL",
    playlist: "PLgundam0001",
    url: "https://www.youtube.com/playlist?list=PLgundam0001",
    facts: { titles: { english: "Mobile Suit Gundam: The Witch from Mercury" }, format: "TV", releaseStatus: "FINISHED", episodes: 3, duration: 24, popularity: 150000, score: 78, year: 2022, cover: "https://s4.anilist.co/yt.jpg", relations: [], genres: ["Mecha", "Sci-Fi"], tags: ["Mecha"], about: "A transfer student pilots a mobile suit." },
    videos: [{ id: "13927400001", title: "Episode 1", seconds: 1420 }],
  }],
};

function seed() {
  for (const key of Object.keys(local)) delete local[key];
  local.crCatalog = { items: CATALOG.map(([id, title, row]) => ({ id, title, type: "series", anilistId: row.anilistId, cover: row.cover })), newest: [], complete: true, updatedAt: now, locale: "en-US" };
  local.crCornerState = { version: 2, library: {}, anilistCache: Object.fromEntries(CATALOG.map(([id, , row]) => [`series:${id}`, row])), settings: {}, taste: {} };
  local.crYoutube = { feed: FEED, fetchedAt: now, checkedAt: now };
}

const ids = (reply) => (reply.results || []).map((row) => row.id);

test("YouTube catalog titles are not in search results even when a feed is stored", async () => {
  seed();
  const byName = await catalogSearch("gundam the witch from mercury", "", "all");
  assert.ok(!ids(byName).some((id) => String(id).includes("yt-")));
  assert.ok(!(byName.results || []).some((row) => (row.tags || []).includes("Free on YouTube")));
});

test("Crunchyroll titles still rank first for their names", async () => {
  seed();
  assert.equal((await catalogSearch("frieren", "", "all")).results[0].id, "sight:GRFRIEREN1");
  assert.equal((await catalogSearch("code geass", "", "all")).results[0].id, "sight:GRGEASS001");
});

test("Home Popular stays Crunchyroll-only", async () => {
  seed();
  const home = await catalogSearch("", "", "all");
  const popular = home.sections.find((section) => section.title === "Popular");
  assert.ok(popular.items.every((item) => !String(item.id).includes("yt-")));
});

test("Prism app shows do not include YouTube catalog entries", async () => {
  seed();
  const { shows } = await appData();
  assert.ok(!shows.some((show) => String(show.id).startsWith("yt-")));
  assert.ok(!shows.some((show) => (show.streaming || []).some((link) => /youtube/i.test(link.site || ""))));
  assert.deepEqual(shows.filter((row) => row.onCrunchyroll).map((row) => row.id), ["GRFRIEREN1", "GRSPYFAM01", "GRGEASS001"]);
});
