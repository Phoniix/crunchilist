import assert from "node:assert/strict";
import test from "node:test";
import { DELETE_MUTATION, LIST_QUERY, SAVE_MUTATION, readEntry, readList, saveEntry } from "../src/lib/anilist-list.js";
import { groupRows, historyPageUrl, historyRow, newerThan, nextPageUrl, parsePage } from "../src/lib/crunchyroll-history.js";
import { matchGroups, mergeWatched, planChanges, watchedParts } from "../src/lib/import-plan.js";
import { safeChange, sameDate, toFuzzy } from "../src/lib/safe-change.js";

const T = (iso) => Date.parse(iso);
const episodeRow = ({ id, season = "S1", series = "SR1", number, played, full = true, seasonTitle = "Show", seriesTitle = "Show" }) => ({
  id, date_played: played, fully_watched: full, playhead: full ? 1400 : 60,
  panel: { id, type: "episode", episode_metadata: { season_id: season, series_id: series, season_title: seasonTitle, series_title: seriesTitle, season_number: 1, episode_number: number, duration_ms: 1440000 } },
});

// ---- Crunchyroll history ----

test("history pages use the account's watch-history endpoint and only follow Crunchyroll's own next links", () => {
  const url = new URL(historyPageUrl("acc 1", 3));
  assert.equal(url.pathname, "/content/v2/acc%201/watch-history");
  assert.equal(url.searchParams.get("page"), "3");
  assert.equal(url.searchParams.get("page_size"), "100");
  assert.equal(nextPageUrl("/content/v2/a/watch-history?start=100"), "https://www.crunchyroll.com/content/v2/a/watch-history?start=100");
  assert.equal(nextPageUrl("https://evil.example/content/v2/a/watch-history"), "");
  assert.equal(nextPageUrl("/content/v2/a/other"), "");
  assert.equal(nextPageUrl(null), "");
});

test("a history row keeps season, episode, watched share and when it was played", () => {
  const row = historyRow(episodeRow({ id: "E1", number: 4, played: "2024-03-01T10:00:00Z" }));
  assert.deepEqual(row, { key: "E1", kind: "episode", groupId: "season:S1", seriesId: "SR1", seasonId: "S1", series: "Show", season: "Show", seasonNumber: 1, episode: 4, watched: true, playedAt: T("2024-03-01T10:00:00Z") });
  assert.equal(historyRow(episodeRow({ id: "E2", number: 5, played: "2024-03-01T10:00:00Z", full: false })).watched, false);
  const movie = historyRow({ id: "M", date_played: "2024-01-01T00:00:00Z", fully_watched: true, panel: { id: "M", type: "movie", movie_metadata: { movie_listing_id: "L1", movie_listing_title: "Film", duration_ms: 6000000 } } });
  assert.equal(movie.kind, "movie");
  assert.equal(movie.groupId, "movie:L1");
  assert.equal(movie.episode, 1);
  assert.equal(historyRow({ panel: null }), null);
  assert.equal(historyRow({ panel: { type: "episode", episode_metadata: { episode_number: 1 } } }), null);
});

test("pages report whether more history follows", () => {
  const data = [episodeRow({ id: "E1", number: 1, played: "2024-01-01T00:00:00Z" })];
  assert.equal(parsePage({ data, meta: { next_page: "/content/v2/a/watch-history?start=1" } }).more, true);
  assert.equal(parsePage({ data, meta: { next_page: "" } }).more, false);
  assert.equal(parsePage({ data, total: 5 }, 0).more, true);
  assert.equal(parsePage({ data, total: 1 }, 0).more, false);
  assert.equal(parsePage({ data: [] , total: 50 }, 0).more, false);
  assert.equal(parsePage(null).rows.length, 0);
});

test("rows group by season with the first time each episode was played; unwatched rows are left out", () => {
  const rows = [
    episodeRow({ id: "a", number: 2, played: "2024-01-03T00:00:00Z" }),
    episodeRow({ id: "b", number: 1, played: "2024-01-02T00:00:00Z" }),
    episodeRow({ id: "c", number: 1, played: "2024-01-01T00:00:00Z" }),
    episodeRow({ id: "d", number: 3, played: "2024-01-04T00:00:00Z", full: false }),
  ].map(historyRow);
  const [group] = groupRows(rows);
  assert.deepEqual(group.episodes, [1, 2]);
  assert.equal(group.played[1], T("2024-01-01T00:00:00Z"));
  assert.equal(group.firstPlayed, T("2024-01-01T00:00:00Z"));
  assert.equal(group.lastPlayed, T("2024-01-03T00:00:00Z"));
});

test("reading stops at the checkpoint so history already read isn't read again", () => {
  const rows = [
    { key: "n2", playedAt: 300 }, { key: "n1", playedAt: 200 }, { key: "old", playedAt: 100 }, { key: "older", playedAt: 50 },
  ];
  assert.deepEqual(newerThan(rows, null), { rows, reached: false });
  assert.deepEqual(newerThan(rows, { newestAt: 100, newestKey: "old" }), { rows: rows.slice(0, 2), reached: true });
  // Same timestamp, different episode: still new.
  const tie = [{ key: "x", playedAt: 100 }, { key: "old", playedAt: 100 }];
  assert.deepEqual(newerThan(tie, { newestAt: 100, newestKey: "old" }).rows.map((row) => row.key), ["x"]);
  assert.equal(newerThan([{ key: "z", playedAt: 500 }], { newestAt: 100, newestKey: "old" }).reached, false);
});

// ---- Never-downgrade rules ----

const finished = { episodes: 12, status: "FINISHED" };
const watched = (progress) => ({ progress, firstPlayed: T("2024-02-01T12:00:00Z"), lastPlayed: T("2024-02-20T12:00:00Z") });

test("a new show becomes Watching, or Completed once every episode of a finished show is watched", () => {
  const partial = safeChange(null, finished, watched(5));
  assert.deepEqual(partial.after, { status: "CURRENT", progress: 5, startedAt: toFuzzy(T("2024-02-01T12:00:00Z")), completedAt: null });
  const done = safeChange(null, finished, watched(12));
  assert.equal(done.after.status, "COMPLETED");
  assert.deepEqual(done.after.completedAt, toFuzzy(T("2024-02-20T12:00:00Z")));
  assert.equal(safeChange(null, { episodes: 12, status: "RELEASING" }, watched(12)).after.status, "CURRENT", "still airing is never completed");
  assert.equal(safeChange(null, { episodes: null, status: "FINISHED" }, watched(30)).after.status, "CURRENT", "unknown length is never completed");
});

test("progress never goes down and never passes the episode count", () => {
  assert.equal(safeChange({ status: "CURRENT", progress: 8 }, finished, watched(5)), null);
  assert.equal(safeChange({ status: "CURRENT", progress: 8 }, finished, watched(40)).after.progress, 12);
});

test("paused, dropped, completed and rewatching are the user's choice and stay", () => {
  const paused = safeChange({ status: "PAUSED", progress: 2, startedAt: { year: 2023, month: 1, day: 1 } }, finished, watched(6));
  assert.equal(paused.after.status, "PAUSED");
  assert.equal(paused.after.progress, 6);
  assert.match(paused.notes[0], /Paused/);
  assert.equal(safeChange({ status: "DROPPED", progress: 2, startedAt: { year: 2023 } }, finished, watched(12)).after.status, "DROPPED");
  assert.equal(safeChange({ status: "COMPLETED", progress: 12, startedAt: { year: 2023 }, completedAt: { year: 2023 } }, finished, watched(3)), null);
  assert.equal(safeChange({ status: "REPEATING", progress: 3, startedAt: { year: 2023 } }, finished, watched(9)), null, "a rewatch keeps its own count");
});

test("planning moves on, watching completes, and dates are only filled when empty", () => {
  assert.equal(safeChange({ status: "PLANNING", progress: 0 }, finished, watched(1)).after.status, "CURRENT");
  const set = { year: 2020, month: 5, day: 5 };
  const done = safeChange({ status: "CURRENT", progress: 10, startedAt: set }, finished, watched(12));
  assert.equal(done.after.status, "COMPLETED");
  assert.deepEqual(done.after.startedAt, set);
  assert.ok(done.after.completedAt);
  assert.ok(sameDate(null, { year: null }));
  assert.ok(!sameDate(set, { year: 2020, month: 5, day: 6 }));
});

// ---- Import plan ----

test("watched episodes split across AniList entries with their own dates", () => {
  const group = { episodes: [1, 2, 3, 4], played: { 1: 10, 2: 20, 3: 30, 4: 40 } };
  const parts = watchedParts(group, { parts: [{ anilistId: 1, episodes: [1, 2], progress: 2 }, { anilistId: 2, episodes: [1, 2], progress: 2 }] });
  assert.deepEqual(parts, [{ anilistId: 1, progress: 2, firstPlayed: 10, lastPlayed: 20 }, { anilistId: 2, progress: 2, firstPlayed: 30, lastPlayed: 40 }]);
  const movie = watchedParts(group, { parts: [{ anilistId: 9, episodes: [1], progress: 1 }] });
  assert.deepEqual(movie, [{ anilistId: 9, progress: 1, firstPlayed: 10, lastPlayed: 40 }]);
});

test("only confident matches are applied; the rest wait for a pick with their candidates", () => {
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

test("sub and dub seasons on one entry merge to the furthest progress and widest dates", () => {
  const merged = mergeWatched([
    { anilistId: 1, progress: 5, firstPlayed: 30, lastPlayed: 50, source: { key: "sub" } },
    { anilistId: 1, progress: 9, firstPlayed: 10, lastPlayed: 40, source: { key: "dub" } },
  ]);
  assert.deepEqual(merged, [{ anilistId: 1, progress: 9, firstPlayed: 10, lastPlayed: 50, sources: [{ key: "sub" }, { key: "dub" }] }]);
});

test("the plan lists only real changes, newest first, and counts what's already up to date", () => {
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

// ---- AniList list calls ----

test("the list is read 50 ids at a time for the signed-in user only", async () => {
  const calls = [];
  const request = async (query, variables) => {
    calls.push(variables);
    return { list: { mediaList: variables.ids.slice(0, 1).map((id) => ({ id: id * 10, mediaId: id, status: "CURRENT", progress: 1 })) }, media: { media: variables.ids.map((id) => ({ id, episodes: 12, status: "FINISHED", title: { english: `E${id}`, romaji: `R${id}` } })) } };
  };
  const ids = Array.from({ length: 120 }, (_, index) => index + 1);
  const progress = [];
  const { entries, media } = await readList([...ids, 1, 2], { token: "t", userId: 7, request, onProgress: (done, total) => progress.push(`${done}/${total}`) });
  assert.deepEqual(calls.map((call) => call.ids.length), [50, 50, 20]);
  assert.ok(calls.every((call) => call.userId === 7));
  assert.equal(entries.size, 3);
  assert.equal(media.get(5).title, "E5");
  assert.deepEqual(progress, ["1/3", "2/3", "3/3"]);
  assert.match(LIST_QUERY, /mediaList\(userId: \$userId/);
});

test("saving sends only status, progress and dates; empty dates are cleared explicitly", async () => {
  let sent;
  await saveEntry(5, { status: "CURRENT", progress: 3, startedAt: { year: 2024, month: 1, day: 2 }, completedAt: null }, { token: "t", request: async (query, variables) => { sent = { query, variables }; return { SaveMediaListEntry: { id: 1 } }; } });
  assert.equal(sent.query, SAVE_MUTATION);
  assert.deepEqual(sent.variables, { mediaId: 5, status: "CURRENT", progress: 3, startedAt: { year: 2024, month: 1, day: 2 }, completedAt: { year: null, month: null, day: null } });
  assert.ok(!/score|notes|private|repeat/i.test(SAVE_MUTATION));
  assert.match(DELETE_MUTATION, /DeleteMediaListEntry/);
});

test("reading one entry treats AniList's not-found as not on the list, and other errors as errors", async () => {
  assert.equal(await readEntry(1, { request: async () => { throw new Error("Not Found."); } }), null);
  await assert.rejects(readEntry(1, { request: async () => { throw new Error("rate limited"); } }), /rate limited/);
});
