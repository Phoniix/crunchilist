import assert from "node:assert/strict";
import test from "node:test";
import { matchGroups, mergeWatched, planChanges, watchedParts } from "../lib/import-plan.js";
import { safeChange, sameDate, toFuzzy } from "../lib/safe-change.js";

const T = (iso) => Date.parse(iso);
const finished = { episodes: 12, status: "FINISHED" };
const watched = (progress) => ({ progress, firstPlayed: T("2024-02-01T12:00:00Z"), lastPlayed: T("2024-02-20T12:00:00Z") });

test("a new show becomes Watching, or Completed once every episode of a finished show is watched", () => {
  const partial = safeChange(null, finished, watched(5));
  assert.deepEqual(partial.after, { status: "CURRENT", progress: 5, startedAt: toFuzzy(T("2024-02-01T12:00:00Z")), completedAt: null });
  const done = safeChange(null, finished, watched(12));
  assert.equal(done.after.status, "COMPLETED");
  assert.equal(safeChange(null, { episodes: 12, status: "RELEASING" }, watched(12)).after.status, "CURRENT");
  assert.equal(safeChange(null, { episodes: null, status: "FINISHED" }, watched(30)).after.status, "CURRENT");
});

test("progress never goes down and never passes the episode count", () => {
  assert.equal(safeChange({ status: "CURRENT", progress: 8 }, finished, watched(5)), null);
  assert.equal(safeChange({ status: "CURRENT", progress: 8 }, finished, watched(40)).after.progress, 12);
});

test("paused, dropped, completed and rewatching stay the user's choice", () => {
  const paused = safeChange({ status: "PAUSED", progress: 2, startedAt: { year: 2023, month: 1, day: 1 } }, finished, watched(6));
  assert.equal(paused.after.status, "PAUSED");
  assert.equal(paused.after.progress, 6);
  assert.equal(safeChange({ status: "DROPPED", progress: 2, startedAt: { year: 2023 } }, finished, watched(12)).after.status, "DROPPED");
  assert.equal(safeChange({ status: "COMPLETED", progress: 12, startedAt: { year: 2023 }, completedAt: { year: 2023 } }, finished, watched(3)), null);
  assert.equal(safeChange({ status: "REPEATING", progress: 3, startedAt: { year: 2023 } }, finished, watched(9)), null);
});

test("planning moves on, watching completes, and dates are only filled when empty", () => {
  assert.equal(safeChange({ status: "PLANNING", progress: 0 }, finished, watched(1)).after.status, "CURRENT");
  const set = { year: 2020, month: 5, day: 5 };
  const done = safeChange({ status: "CURRENT", progress: 10, startedAt: set }, finished, watched(12));
  assert.equal(done.after.status, "COMPLETED");
  assert.deepEqual(done.after.startedAt, set);
  assert.ok(sameDate(null, { year: null }));
  assert.ok(!sameDate(set, { year: 2020, month: 5, day: 6 }));
});

test("watched episodes split across AniList entries with their own dates", () => {
  const group = { episodes: [1, 2, 3, 4], played: { 1: 10, 2: 20, 3: 30, 4: 40 } };
  const parts = watchedParts(group, { parts: [{ anilistId: 1, episodes: [1, 2], progress: 2 }, { anilistId: 2, episodes: [1, 2], progress: 2 }] });
  assert.deepEqual(parts, [{ anilistId: 1, progress: 2, firstPlayed: 10, lastPlayed: 20 }, { anilistId: 2, progress: 2, firstPlayed: 30, lastPlayed: 40 }]);
});

test("only confident matches are applied; the rest wait for a pick", () => {
  const groups = [
    { key: "a", service: "crunchyroll", series: "A", season: "A", episodes: [1], played: { 1: 5 }, lastPlayed: 5 },
    { key: "b", service: "crunchyroll", series: "B", season: "B", episodes: [1], played: { 1: 6 }, lastPlayed: 6 },
    { key: "c", service: "crunchyroll", series: "C", season: "C", episodes: [1], played: { 1: 7 }, lastPlayed: 7 },
  ];
  const results = {
    a: { anilistId: 1, confidence: "high", how: "title", parts: [{ anilistId: 1, episodes: [1], progress: 1 }], candidates: [] },
    b: { anilistId: 2, confidence: "low", how: "franchise", parts: [], candidates: [3], reason: "unsure" },
    c: { anilistId: null, confidence: "none", parts: [], candidates: [], reason: "no match" },
  };
  const { watched: seen, pending } = matchGroups(groups, (group) => results[group.key]);
  assert.deepEqual(seen.map((item) => item.anilistId), [1]);
  assert.deepEqual(pending.map((item) => [item.key, item.candidates, item.suggested]), [["b", [2, 3], 2], ["c", [], null]]);
});

test("sub and dub seasons on one entry merge to furthest progress", () => {
  const merged = mergeWatched([
    { anilistId: 1, progress: 5, firstPlayed: 30, lastPlayed: 50, source: { key: "sub" } },
    { anilistId: 1, progress: 9, firstPlayed: 10, lastPlayed: 40, source: { key: "dub" } },
  ]);
  assert.deepEqual(merged, [{ anilistId: 1, progress: 9, firstPlayed: 10, lastPlayed: 50, sources: [{ key: "sub" }, { key: "dub" }] }]);
});

test("the plan lists only real changes, newest first, and counts up to date", () => {
  const items = [
    { anilistId: 1, progress: 3, firstPlayed: 1, lastPlayed: 100, source: {} },
    { anilistId: 2, progress: 12, firstPlayed: 1, lastPlayed: 200, source: {} },
    { anilistId: 3, progress: 2, firstPlayed: 1, lastPlayed: 300, source: {} },
  ];
  const entries = new Map([[3, { id: 33, status: "COMPLETED", progress: 12, startedAt: { year: 2020 }, completedAt: { year: 2020 } }]]);
  const media = new Map([[1, { ...finished, title: "One" }], [2, { ...finished, title: "Two" }], [3, { ...finished, title: "Three" }]]);
  const { changes, unchanged } = planChanges(items, entries, media);
  assert.deepEqual(changes.map((change) => [change.title, change.after.status]), [["Two", "COMPLETED"], ["One", "CURRENT"]]);
  assert.equal(unchanged, 1);
});
