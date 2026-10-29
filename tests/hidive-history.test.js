import assert from "node:assert/strict";
import test from "node:test";
import { hidiveEntries, hidiveEntryFinished, hidiveRows } from "../lib/hidive-history.js";

const vod = (id, episode, watchedAt, watchProgress, extra = {}) => ({
  id,
  type: "VOD",
  title: `E${episode} - Title ${episode}`,
  duration: 1465,
  watchProgress,
  watchedAt,
  episodeInformation: {
    seasonNumber: 2,
    episodeNumber: episode,
    season: 19999,
    seasonTitle: "Season 2",
    seriesInformation: { id: 1271, title: "MADE IN ABYSS" },
  },
  ...extra,
});

test("hidiveEntryFinished: missing progress means done; low progress does not", () => {
  const finishedVod = vod(10, 1, 9_000, undefined);
  delete finishedVod.watchProgress;
  assert.equal(hidiveEntryFinished(hidiveEntries({ vods: [finishedVod] })[0]), true);
  assert.equal(hidiveEntryFinished(hidiveEntries({ vods: [vod(11, 2, 9_500, 713)] })[0]), false);
  assert.equal(hidiveEntryFinished(hidiveEntries({ vods: [vod(12, 3, 9_600, 1300)] })[0]), true);
  assert.equal(hidiveEntryFinished(null), false);
});

test("hidiveRows still marks finished vs mid-watch the same way", () => {
  const finished = vod(10, 1, 9_000, undefined);
  delete finished.watchProgress;
  const rows = hidiveRows(hidiveEntries({ vods: [vod(11, 2, 9_500, 713), finished] }));
  assert.deepEqual(rows.map((row) => [row.episode, row.watched]), [[2, false], [1, true]]);
});
