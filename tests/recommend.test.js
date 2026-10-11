import assert from "node:assert/strict";
import test from "node:test";
import { recommend } from "../lib/recommend.js";

function candidate(partial) {
  return {
    status: null,
    episodes: null,
    crEpisodes: null,
    format: null,
    tags: [],
    genres: [],
    anilistMatched: false,
    franchiseKey: partial.seriesId,
    seasonNumber: null,
    audio: "unknown",
    url: `https://www.crunchyroll.com/series/${partial.seriesId}/title`,
    movieSignal: false,
    ...partial,
  };
}

test("unwatched keeps unmatched titles and drops finished or dropped ones", () => {
  const results = recommend({
    chip: "unwatched",
    taste: { subDub: "sub", hardAvoids: ["Horror"] },
    candidates: [
      candidate({ id: "fin", title: "Finished Show", seriesId: "fin", status: "finished", anilistMatched: true, episodes: 12, format: "TV" }),
      candidate({ id: "drop", title: "Dropped Show", seriesId: "drop", status: "dropped", anilistMatched: true, format: "TV" }),
      candidate({ id: "prog", title: "Progress Show", seriesId: "prog", status: "in_progress", anilistMatched: false, audio: "sub" }),
      candidate({ id: "plain", title: "Matched Show", seriesId: "plain", anilistMatched: true, episodes: 24, format: "TV", audio: "sub", tags: ["Drama"] }),
      candidate({ id: "miss", title: "Unmatched Show", seriesId: "miss", anilistMatched: false, audio: "sub", genres: ["Comedy"] }),
      candidate({ id: "avoid", title: "Avoid Show", seriesId: "avoid", anilistMatched: true, genres: ["Horror"], format: "TV" }),
      candidate({ id: "dub", title: "Dub Show", seriesId: "dub", anilistMatched: true, format: "TV", audio: "dub" }),
    ],
  });

  assert.deepEqual(results.results.map((item) => item.id), ["plain", "miss", "prog", "dub"]);
  assert.equal(results.skippedUnmatched, 0);
  assert.equal(results.results.find((item) => item.id === "miss").reason, "Not marked watched.");
});

test("one cour uses anilist or crunchyroll counts and skips unknown titles", () => {
  const results = recommend({
    chip: "one-cour",
    candidates: [
      candidate({ id: "a", title: "A", seriesId: "a", anilistMatched: true, episodes: 12, format: "TV" }),
      candidate({ id: "b", title: "B", seriesId: "b", anilistMatched: true, episodes: 24, format: "TV" }),
      candidate({ id: "c", title: "C", seriesId: "c", anilistMatched: false }),
      candidate({ id: "d", title: "D", seriesId: "d", anilistMatched: false, crEpisodes: 11 }),
      candidate({ id: "e", title: "E", seriesId: "e", anilistMatched: true, episodes: 13, status: "finished", format: "TV" }),
    ],
  });
  assert.deepEqual(results.results.map((item) => item.id), ["a", "d"]);
  assert.equal(results.skippedUnmatched, 1);
  assert.match(results.notice, /skipped for lack of a confident match/);
});

test("movie keeps clear movies and skips unmatched titles without a movie mark", () => {
  const results = recommend({
    chip: "movie",
    candidates: [
      candidate({ id: "m", title: "Feature", seriesId: "m", anilistMatched: true, format: "MOVIE", episodes: 1 }),
      candidate({ id: "tv", title: "Series", seriesId: "tv", anilistMatched: true, format: "TV", episodes: 12 }),
      candidate({ id: "u", title: "Unknown", seriesId: "u", anilistMatched: false }),
      candidate({ id: "cm", title: "Page Movie", seriesId: "cm", anilistMatched: false, movieSignal: true, episodes: 1 }),
      candidate({ id: "sp", title: "Special Movie", seriesId: "sp", anilistMatched: true, format: "SPECIAL", episodes: 1 }),
    ],
  });
  assert.deepEqual(results.results.map((item) => item.id), ["m", "cm", "sp"]);
  assert.equal(results.skippedUnmatched, 1);
});

test("more like this skips unmatched titles and sinks finished sequels", () => {
  const current = candidate({
    id: "cur",
    title: "Current",
    seriesId: "cur",
    anilistMatched: true,
    tags: ["Mecha"],
    genres: ["Action"],
    franchiseKey: "al:1",
    format: "TV",
    seasonNumber: 1,
  });
  const similar = candidate({
    id: "sim",
    title: "Similar",
    seriesId: "sim",
    anilistMatched: true,
    tags: ["Mecha", "Space"],
    genres: ["Action"],
    franchiseKey: "al:9",
    format: "TV",
  });
  const sequel = candidate({
    id: "seq",
    title: "Sequel",
    seriesId: "seq",
    anilistMatched: true,
    tags: ["Mecha"],
    genres: ["Action"],
    franchiseKey: "al:1",
    status: "finished",
    format: "TV",
    seasonNumber: 2,
  });
  const unmatched = candidate({
    id: "nope",
    title: "Unmatched",
    seriesId: "nope",
    anilistMatched: false,
    genres: ["Action"],
  });
  const other = candidate({
    id: "other",
    title: "Other",
    seriesId: "other",
    anilistMatched: true,
    tags: ["Cooking"],
    genres: ["Slice of Life"],
    franchiseKey: "al:3",
    format: "TV",
  });

  const ranked = recommend({
    chip: "more-like-this",
    currentId: "cur",
    candidates: [current, similar, sequel, unmatched, other],
  });
  assert.deepEqual(ranked.results.map((item) => item.id), ["sim", "seq"]);
  assert.match(ranked.results[0].reason, /Mecha/);
  assert.equal(ranked.skippedUnmatched, 1);
  assert.deepEqual(ranked.results[0].tags.sort(), ["Action", "Mecha"]);

  const skipped = recommend({
    chip: "more-like-this",
    currentId: "cur",
    skipSeenSequels: true,
    candidates: [current, similar, sequel, unmatched],
  });
  assert.deepEqual(skipped.results.map((item) => item.id), ["sim"]);
});
