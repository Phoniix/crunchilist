import assert from "node:assert/strict";
import test from "node:test";
import {
  STALE_MS,
  applyHistoryChanges,
  groupHistory,
  historyItems,
  historyPageUrl,
  historyProgress,
  historySearch,
  parseHistoryPage,
  planHistoryImport,
} from "../lib/history.js";
import { pendingSync } from "../lib/library.js";

const NOW = Date.parse("2026-10-11T12:00:00Z");

function episode({ season = "S1", series = "G1", seriesTitle = "Frieren", seasonTitle = "Frieren", seasonNumber = 1, number, watched = true, playhead = 0, date = "2026-10-01T00:00:00Z" }) {
  return {
    id: `${season}-${number}`,
    parent_id: series,
    parent_type: "series",
    date_played: date,
    playhead,
    fully_watched: watched,
    panel: {
      type: "episode",
      episode_metadata: {
        series_id: series,
        series_title: seriesTitle,
        season_id: season,
        season_title: seasonTitle,
        season_number: seasonNumber,
        episode_number: number,
        duration_ms: 1_440_000,
      },
    },
  };
}

test("history page url carries the account, page, and locale", () => {
  const url = new URL(historyPageUrl("abc-123", 2, "en-US"));
  assert.equal(url.pathname, "/content/v2/abc-123/watch-history");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("page_size"), "100");
  assert.equal(url.searchParams.get("locale"), "en-US");
});

test("history pages stop on an empty next page or a reached total", () => {
  const data = [episode({ number: 1 })];
  assert.equal(parseHistoryPage({ data, meta: { next_page: "/next" } }).more, true);
  assert.equal(parseHistoryPage({ data, meta: { next_page: "" } }).more, false);
  assert.equal(parseHistoryPage({ data, total: 1 }, 0).more, false);
  assert.equal(parseHistoryPage({ data, total: 5 }, 0).more, true);
  assert.equal(parseHistoryPage({ data: [], meta: { next_page: "/next" } }).more, false);
});

test("history paging follows Crunchyroll's own next-page link", () => {
  const data = [episode({ number: 1 })];
  const page = parseHistoryPage({ data, meta: { next_page: "/content/v2/abc/watch-history?page_size=100&start=100" } });
  assert.equal(page.nextUrl, "https://www.crunchyroll.com/content/v2/abc/watch-history?page_size=100&start=100");
  assert.equal(parseHistoryPage({ data, meta: { next_page: "https://evil.example/watch-history" } }).nextUrl, "");
  assert.equal(parseHistoryPage({ data, meta: { next_page: "" } }).nextUrl, "");
});

test("episodes count as watched when finished or nearly finished", () => {
  const { rows } = parseHistoryPage({
    data: [
      episode({ number: 1, watched: true }),
      episode({ number: 2, watched: false, playhead: 1400 }),
      episode({ number: 3, watched: false, playhead: 300 }),
      { id: "x", panel: null },
    ],
  });
  assert.deepEqual(rows.map((row) => row.watched), [true, true, false]);
});

test("grouping keeps the furthest watched episode per season", () => {
  const { rows } = parseHistoryPage({
    data: [
      episode({ number: 1 }),
      episode({ number: 3 }),
      episode({ number: 4, watched: false }),
      episode({ season: "S2", seasonTitle: "Season 2", seasonNumber: 2, number: 1, watched: false }),
    ],
  });
  const groups = groupHistory(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].maxEpisode, 3);
  assert.equal(groups[0].watchedCount, 2);
});

test("generic season titles search with the series name", () => {
  const plan = historySearch({ kind: "episode", seriesTitle: "Spy x Family", seasonTitle: "Season 2", seasonNumber: 2 });
  assert.equal(plan.search, "Spy x Family Season 2");
  const dub = historySearch({ kind: "episode", seriesTitle: "Frieren", seasonTitle: "Frieren (English Dub)", seasonNumber: 1 });
  assert.equal(dub.search, "Frieren");
});

test("absolute episode numbers fall back to the watched count", () => {
  assert.equal(historyProgress({ kind: "episode", maxEpisode: 18, watchedCount: 6 }, 12), 6);
  assert.equal(historyProgress({ kind: "episode", maxEpisode: 7, watchedCount: 5 }, 12), 7);
  assert.equal(historyProgress({ kind: "episode", maxEpisode: 30, watchedCount: 30 }, null), 30);
  assert.equal(historyProgress({ kind: "movie", maxEpisode: 1, watchedCount: 1 }, 1), 1);
});

test("dub and sub copies of a season merge into one AniList entry", () => {
  const groups = [
    { id: "season:A", kind: "episode", seriesId: "G1", seriesTitle: "Frieren", seasonTitle: "Frieren", maxEpisode: 10, watchedCount: 10, lastPlayed: NOW - 1000 },
    { id: "season:B", kind: "episode", seriesId: "G1", seriesTitle: "Frieren", seasonTitle: "Frieren (English Dub)", maxEpisode: 14, watchedCount: 4, lastPlayed: NOW - 5000 },
    { id: "season:C", kind: "episode", seriesId: "G9", seriesTitle: "Obscure Show", seasonTitle: "Obscure Show", maxEpisode: 2, watchedCount: 2, lastPlayed: NOW },
  ];
  const { items, unmatched } = historyItems(groups, (group) => (group.seriesId === "G1" ? { anilistId: 154587, episodes: 28, primary: true, title: "Frieren" } : null));
  assert.equal(items.length, 1);
  assert.equal(items[0].progress, 14);
  assert.equal(items[0].crSeriesId, "G1");
  assert.equal(items[0].lastPlayed, NOW - 1000);
  assert.deepEqual(unmatched, ["Obscure Show"]);
});

test("the plan never lowers progress or touches finished and dropped shows", () => {
  const library = {
    "anilist:1": { key: "anilist:1", anilistId: 1, status: "finished", progress: 12 },
    "anilist:2": { key: "anilist:2", anilistId: 2, status: "dropped", progress: 3 },
    "anilist:3": { key: "anilist:3", anilistId: 3, status: "in_progress", progress: 9 },
    "anilist:4": { key: "anilist:4", anilistId: 4, status: "in_progress", progress: 2 },
    "anilist:5": { key: "anilist:5", anilistId: 5, status: "plan", progress: null },
  };
  const item = (anilistId, progress, episodes = 12) => ({ anilistId, progress, episodes, finished: progress >= episodes, lastPlayed: NOW, title: `Show ${anilistId}` });
  const plan = planHistoryImport(library, [item(1, 12), item(2, 8), item(3, 5), item(4, 6), item(5, 12), item(6, 1)], { now: NOW });
  assert.deepEqual(plan.changes.map((change) => [change.anilistId, change.status, change.isNew]), [
    [4, "in_progress", false],
    [5, "finished", false],
    [6, "in_progress", true],
  ]);
  assert.equal(plan.current, 3);
  assert.equal(plan.changes[0].fromProgress, 2);
});

test("old unfinished shows follow the chosen stale rule", () => {
  const old = { anilistId: 7, progress: 3, episodes: 12, finished: false, lastPlayed: NOW - STALE_MS - 1, title: "Old" };
  const done = { anilistId: 8, progress: 12, episodes: 12, finished: true, lastPlayed: NOW - STALE_MS - 1, title: "Done" };
  assert.equal(planHistoryImport({}, [old, done], { now: NOW, stale: "watching" }).changes[0].status, "in_progress");
  assert.equal(planHistoryImport({}, [old, done], { now: NOW, stale: "dropped" }).changes[0].status, "dropped");
  const skipped = planHistoryImport({}, [old, done], { now: NOW, stale: "skip" });
  assert.deepEqual(skipped.changes.map((change) => change.anilistId), [8]);
  assert.equal(skipped.staleCount, 1);
});

test("applied changes land in the library queued for AniList", () => {
  const plan = planHistoryImport({}, [
    { anilistId: 10, progress: 12, episodes: 12, finished: true, lastPlayed: NOW, title: "Done", crSeriesId: "G10" },
    { anilistId: 11, progress: 4, episodes: 12, finished: false, lastPlayed: NOW - STALE_MS - 1, title: "Old" },
  ], { now: NOW, stale: "dropped" });
  const { library, keys } = applyHistoryChanges({}, plan.changes, NOW);
  assert.deepEqual(keys, ["anilist:10", "anilist:11"]);
  assert.equal(library["anilist:10"].status, "finished");
  assert.equal(library["anilist:10"].crSeriesId, "G10");
  assert.equal(library["anilist:11"].status, "dropped");
  assert.equal(library["anilist:11"].progress, 4);
  assert.equal(pendingSync(library).length, 2);
});
