import assert from "node:assert/strict";
import test from "node:test";
import { createMatcher } from "../src/lib/match-engine.js";
import { forget, matchKey, matchWithMemory, recall, remember } from "../src/lib/remembered.js";

const ROWS = [
  { a: 1, title: "Show", synonyms: ["The Show"], format: "TV", episodes: 12, year: 2020, season: "SPRING", related: [2] },
  { a: 2, title: "Show 2", synonyms: ["The Show Season 2"], format: "TV", episodes: 12, year: 2021, season: "SPRING", related: [1] },
  { a: 3, title: "Other", synonyms: [], format: "TV", episodes: 24, year: 2019, season: "FALL", related: [] },
];
const matcher = createMatcher(ROWS);
const KEY = matchKey("crunchyroll", "G1", "S1");
const high = { anilistId: 1, how: "title", confidence: "high" };

test("keys name the service, the show and the season", () => {
  assert.equal(KEY, "crunchyroll:G1/S1");
  assert.equal(matchKey("netflix", "80000"), "netflix:80000");
});

test("only confident matches are remembered", () => {
  assert.equal(recall(remember({}, KEY, { ...high, confidence: "low" }), KEY), null);
  assert.equal(recall(remember({}, KEY, { anilistId: null, confidence: "none" }), KEY), null);
  const store = remember({}, KEY, high, { now: 5, names: ["Show — Season 1"] });
  assert.deepEqual(recall(store, KEY), { anilistId: 1, how: "title", by: "matcher", at: 5, names: ["Show — Season 1"] });
});

test("a matched show stays matched: later matcher results only add names", () => {
  const first = remember({}, KEY, high, { now: 5, names: ["Show"] });
  const later = remember(first, KEY, { anilistId: 3, how: "title", confidence: "high" }, { now: 9, names: ["Show (renamed)"] });
  assert.equal(recall(later, KEY).anilistId, 1);
  assert.deepEqual(recall(later, KEY).names, ["Show", "Show (renamed)"]);
  assert.equal(recall(later, KEY).seenAt, 9);
  assert.equal(recall(first, KEY).names.length, 1, "the earlier store isn't changed");
});

test("a user's pick replaces the matcher's, and the matcher never replaces the user's", () => {
  const matched = remember({}, KEY, high, { now: 5 });
  const picked = remember(matched, KEY, { anilistId: 3 }, { by: "user", now: 7 });
  assert.equal(recall(picked, KEY).anilistId, 3);
  assert.equal(recall(picked, KEY).how, "user");
  assert.equal(recall(remember(picked, KEY, high, { now: 8 }), KEY).anilistId, 3);
  assert.equal(recall(remember(picked, KEY, { anilistId: 1 }, { by: "user", now: 9 }), KEY).anilistId, 1);
});

test("forgetting is only for an explicit re-check", () => {
  const store = remember({}, KEY, high);
  assert.equal(recall(forget(store, KEY), KEY), null);
  assert.equal(forget(store, "missing"), store);
});

test("remembered matches are used before the matcher, with episodes placed on them", () => {
  const store = remember({}, KEY, { anilistId: 3 }, { by: "user" });
  const found = matchWithMemory(matcher, store, KEY, { series: "Show", season: "Season 1", episodes: [1, 2, 3] });
  assert.equal(found.anilistId, 3);
  assert.equal(found.how, "user");
  assert.equal(found.remembered, true);
  assert.equal(found.progress, 3);
  const fresh = matchWithMemory(matcher, {}, KEY, { series: "Show", season: "Season 2", episodes: [1] });
  assert.equal(fresh.anilistId, 2);
  assert.equal(fresh.remembered, false);
});

test("a remembered entry that left the master list falls back to the matcher", () => {
  const store = { [KEY]: { anilistId: 999, how: "title" } };
  assert.equal(matchWithMemory(matcher, store, KEY, { series: "Show", season: "Season 1" }).anilistId, 1);
});

test("a user's pick of an entry the master list doesn't have still stands, with the episodes as watched", () => {
  const store = { [KEY]: { anilistId: 999, how: "user", by: "user" } };
  const found = matchWithMemory(matcher, store, KEY, { series: "Show", season: "Season 1", episodes: [1, 2, 3] });
  assert.equal(found.anilistId, 999);
  assert.equal(found.confidence, "high");
  assert.deepEqual(found.parts, [{ anilistId: 999, episodes: [1, 2, 3], progress: 3 }]);
});
