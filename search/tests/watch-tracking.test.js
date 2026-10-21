import assert from "node:assert/strict";
import test from "node:test";
import { groupEpisodes } from "../src/lib/episode-groups.js";
import { KEYS } from "../src/lib/keys.js";
import { addToLog, cleanItem, cleanSeries, itemText, parseEpisodeLabel, tubiItem } from "../src/lib/watch-tracking.js";

const stored = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => ({ [key]: stored[key] }),
      set: async (values) => Object.assign(stored, values),
      remove: async (keys) => { for (const key of [].concat(keys)) delete stored[key]; },
    },
    session: { get: async () => ({}), set: async () => {} },
  },
  action: { setBadgeText: async () => {} },
};
const { backgroundSync } = await import("../src/background/importer.js");

const TUBI_EPISODE = `<html><head>
<meta property="og:title" content="Death Note (Subtitled) S01:E02 - Confrontation"/>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"TVSeries","name":"Death Note (Subtitled)","genre":["Anime","Horror"]},{"@type":"TVEpisode","name":"S01:E02 - Confrontation","genre":["Anime","Horror"],"duration":"PT23M"}]}</script>
</head></html>`;

test("episode labels from titles, tabs and media controls", () => {
  assert.deepEqual(parseEpisodeLabel("Death Note (Subtitled) S01:E02 - Confrontation"), { series: "Death Note", season: 1, episode: 2, title: "Confrontation" });
  assert.deepEqual(parseEpisodeLabel("Oshi no Ko Season 2 Episode 3: Tokyo Blade"), { series: "Oshi no Ko", season: 2, episode: 3, title: "Tokyo Blade" });
  assert.deepEqual(parseEpisodeLabel("Episode 5 - The Return"), { series: "", season: null, episode: 5, title: "The Return" });
  assert.equal(parseEpisodeLabel("Great Teacher Onizuka"), null);
  assert.equal(cleanSeries("Cybersix (English Dubbed)"), "Cybersix");
});

test("Tubi pages name the episode and say whether it's anime", () => {
  assert.deepEqual(tubiItem(TUBI_EPISODE, "/tv-shows/319043/s01-e02-confrontation"), { id: "episode:319043", kind: "episode", series: "Death Note", season: 1, episode: 2, title: "Confrontation", anime: true });
  const movie = `<script type="application/ld+json">{"@type":"Movie","name":"Vampire Hunter D","genre":["Anime","Action"]}</script>`;
  assert.deepEqual(tubiItem(movie, "/movies/100/vampire-hunter-d"), { id: "movie:100", kind: "movie", series: "Vampire Hunter D", season: null, episode: 1, title: "", anime: true });
  const drama = `<script type="application/ld+json">{"@type":"Movie","name":"A Drama","genre":["Drama"]}</script>`;
  assert.equal(tubiItem(drama, "/movies/101/a-drama").anime, false);
  assert.equal(tubiItem(TUBI_EPISODE, "/home"), null);
});

test("what a site sends is checked again, and a replay within hours isn't counted twice", () => {
  assert.equal(cleanItem({ id: "x", series: "Show", episode: 0 }), null);
  assert.equal(cleanItem({ id: "", series: "Show", episode: 1 }), null);
  assert.equal(cleanItem({ id: "x", series: "<<>>", episode: 1 }), null);
  const item = cleanItem({ id: "episode:1", series: "Death Note", season: 1, episode: 2, anime: "yes" });
  assert.equal(item.anime, null);
  assert.equal(itemText(item), "Death Note S1 E2");
  const first = addToLog([], "tubi", item, 1000);
  assert.equal(first.added, true);
  assert.equal(addToLog(first.log, "tubi", item, 1000 + 60_000).added, false);
  assert.equal(addToLog(first.log, "tubi", item, 1000 + 7 * 60 * 60 * 1000).added, true);
  const next = addToLog(first.log, "tubi", cleanItem({ id: "episode:2", series: "Death Note", season: 1, episode: 3 }), 2000).log;
  const [group] = groupEpisodes(next);
  assert.deepEqual(group.episodes, [2, 3]);
  assert.equal(group.series, "Death Note");
  assert.equal(group.seasonNumber, 1);
});

test("tracked sites need no earlier import, and an empty log just moves on", async () => {
  stored[KEYS.session] = { token: "t", viewer: { id: 1 } };
  const result = await backgroundSync(["tubi"], { trigger: "tracking", apply: true });
  assert.equal(result.ran, true);
  assert.match(result.message, /^Tracking: Tubi: nothing new/);
  assert.equal(stored[KEYS.checkpoints]["tubi:main"].end, true);
  assert.equal(stored[KEYS.importDraft], undefined);
});
