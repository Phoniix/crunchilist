import assert from "node:assert/strict";
import test from "node:test";
import { CATCH_UP_DAYS, PAGE_SIZE, catchUpCheckpoint, checkpointNewest, newerThan, parsePage, tipFromWatched } from "../lib/crunchyroll-history.js";

const episode = (number, { date = "2026-10-01T00:00:00Z", id = `ep-${number}` } = {}) => ({
  id,
  parent_id: "series",
  parent_type: "series",
  date_played: date,
  playhead: 1400,
  fully_watched: true,
  panel: {
    id,
    type: "episode",
    episode_metadata: {
      series_id: "series",
      series_title: "Frieren",
      season_id: "season",
      season_title: "Frieren",
      season_number: 1,
      episode_number: number,
      duration_ms: 1_440_000,
    },
  },
});

test("parsePage ignores page-size totals when more history remains", () => {
  const data = Array.from({ length: PAGE_SIZE }, (_, i) => episode(i + 1));
  const page = parsePage({ data, total: PAGE_SIZE, meta: { next_page: "/content/v2/abc/watch-history?start=100" } }, 0);
  assert.equal(page.more, true);
  assert.equal(page.total, null);
  assert.equal(page.count, PAGE_SIZE);
});

test("parsePage keeps a real grand total across pages", () => {
  const data = Array.from({ length: PAGE_SIZE }, (_, i) => episode(i + 1));
  const page = parsePage({ data, total: 250, meta: { next_page: "/content/v2/abc/watch-history?start=100" } }, 0);
  assert.equal(page.more, true);
  assert.equal(page.total, 250);
});

test("parsePage keeps total on the final page", () => {
  const data = [episode(1), episode(2)];
  const page = parsePage({ data, total: 102, meta: { next_page: "" } }, 100);
  assert.equal(page.more, false);
  assert.equal(page.total, 102);
});

test("parsePage drops a page-size total mid-history and empty pages", () => {
  const data = Array.from({ length: PAGE_SIZE }, (_, i) => episode(i + 1));
  const mid = parsePage({ data, total: PAGE_SIZE, meta: { next_page: "/content/v2/abc/watch-history?start=200" } }, 100);
  assert.equal(mid.more, true);
  assert.equal(mid.total, null);
  const empty = parsePage({ data: [], total: 0, meta: { next_page: "/next" } }, 0);
  assert.equal(empty.more, false);
  assert.equal(empty.total, null);
  assert.equal(parsePage({ data: [episode(1)], total: "nope" }, 0).total, null);
});

test("newerThan keeps only history past the checkpoint for catch-up reads", () => {
  const { rows } = parsePage({
    data: [
      episode(3, { date: "2026-10-03T00:00:00Z", id: "new" }),
      episode(2, { date: "2026-10-02T00:00:00Z", id: "same-time-other" }),
      episode(1, { date: "2026-10-02T00:00:00Z", id: "checkpoint" }),
      episode(4, { date: "2026-10-01T00:00:00Z", id: "older" }),
    ],
  });
  const cut = newerThan(rows, { newestAt: Date.parse("2026-10-02T00:00:00Z"), newestKey: "checkpoint" });
  assert.equal(cut.reached, true);
  assert.deepEqual(cut.rows.map((row) => row.key), ["new", "same-time-other"]);
  assert.deepEqual(newerThan(rows, null).rows.map((row) => row.key), rows.map((row) => row.key));
  assert.equal(newerThan(rows, null).reached, false);
});

test("catchUpCheckpoint uses the last few days unless a newer checkpoint exists", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  const floor = now - CATCH_UP_DAYS * 24 * 60 * 60 * 1000;
  assert.deepEqual(catchUpCheckpoint(null, now), { newestAt: floor, newestKey: "" });
  assert.deepEqual(catchUpCheckpoint({ newestAt: floor - 1, newestKey: "old" }, now), { newestAt: floor, newestKey: "" });
  assert.deepEqual(catchUpCheckpoint({ newestAt: floor + 1, newestKey: "fresh" }, now), { newestAt: floor + 1, newestKey: "fresh" });
});

test("checkpoint tip ignores unfinished rows so in-progress Netflix titles cannot seal history", () => {
  const rows = [
    { key: "mid", playedAt: 300, watched: false },
    { key: "done", playedAt: 200, watched: true },
    { key: "older", playedAt: 100, watched: true },
  ];
  assert.deepEqual(tipFromWatched(rows), { newestAt: 200, newestKey: "done" });
  assert.equal(tipFromWatched([{ key: "mid", playedAt: 300, watched: false }]), null);
  assert.deepEqual(
    checkpointNewest({ newestAt: 150, newestKey: "prior" }, [{ key: "mid", playedAt: 300, watched: false }]),
    { newestAt: 150, newestKey: "prior" },
    "unfinished-only reads keep the stored tip",
  );
  assert.deepEqual(
    checkpointNewest({ newestAt: 250, newestKey: "prior" }, [{ key: "done", playedAt: 200, watched: true }]),
    { newestAt: 250, newestKey: "prior" },
    "never move the tip backwards",
  );
});
