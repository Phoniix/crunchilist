import assert from "node:assert/strict";
import test from "node:test";
import {
  activityFromWatchEpisode,
  cleanContinueRow,
  mergeContinueRows,
  normalizeContinueActivity,
  upsertContinueActivity,
} from "../lib/continue-activity.js";
import { setEntryProgress, setEntryStatus } from "../lib/library.js";

test("cleanContinueRow drops finished seasons and normalizes progress", () => {
  assert.equal(cleanContinueRow(null), null);
  assert.equal(cleanContinueRow({ id: "", progress: 1 }), null);
  assert.equal(cleanContinueRow({ id: "G1", progress: 12, episodes: 12 }), null);
  const row = cleanContinueRow({ id: "G1", title: "Frieren", progress: 3.6, episodes: 28, next: 5, service: "crunchyroll" });
  assert.equal(row.progress, 4);
  assert.equal(row.next, 5);
  assert.equal(row.episodes, 28);
  assert.equal(row.service, "crunchyroll");
});

test("watching an episode builds activity with progress = episode - 1", () => {
  const row = activityFromWatchEpisode({
    id: "GFRIEREN",
    title: "Frieren",
    episode: 5,
    episodes: 28,
    playUrl: "https://www.crunchyroll.com/series/GFRIEREN",
    anilistId: 154587,
  });
  assert.equal(row.id, "GFRIEREN");
  assert.equal(row.progress, 4);
  assert.equal(row.next, 5);
  assert.equal(row.anilistId, 154587);
  assert.equal(activityFromWatchEpisode({ id: "", episode: 5 }), null);
  // Episode 0 is treated as episode 1 at the helper layer; callers gate with episode >= 1.
  assert.equal(activityFromWatchEpisode({ id: "G1", episode: 0 }).progress, 0);
});

test("upsertContinueActivity keeps one row per show and newest first", () => {
  let list = upsertContinueActivity([], { id: "A", title: "Alpha", progress: 1, at: 10 });
  list = upsertContinueActivity(list, { id: "B", title: "Beta", progress: 2, at: 20 });
  list = upsertContinueActivity(list, { id: "A", title: "Alpha", progress: 3, at: 30 });
  assert.deepEqual(list.map((row) => [row.id, row.progress]), [["A", 3], ["B", 2]]);
});

test("normalizeContinueActivity dedupes, sorts by recency, and caps length", () => {
  const rows = normalizeContinueActivity([
    { id: "A", progress: 1, at: 1 },
    { id: "A", progress: 2, at: 5 },
    { id: "B", progress: 1, at: 3 },
    { id: "done", progress: 10, episodes: 10, at: 9 },
  ]);
  assert.deepEqual(rows.map((row) => row.id), ["A", "B"]);
  assert.equal(rows[0].progress, 2);
});

test("mergeContinueRows puts live activity ahead of library watching rows", () => {
  const activity = [
    { id: "live", title: "Live", progress: 2, at: 100 },
    { id: "both", title: "Both live", progress: 5, at: 90 },
  ];
  const library = [
    { id: "both", title: "Both library", progress: 1 },
    { id: "list", title: "List only", progress: 3 },
  ];
  const merged = mergeContinueRows(activity, library, { limit: 14 });
  assert.deepEqual(merged.map((row) => row.id), ["live", "both", "list"]);
  assert.equal(merged[1].progress, 5, "activity progress wins for shared ids");
});

test("mergeContinueRows respects the continue rail limit", () => {
  const activity = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, progress: 1, at: 100 - i }));
  const library = Array.from({ length: 5 }, (_, i) => ({ id: `l${i}`, progress: 1 }));
  assert.equal(mergeContinueRows(activity, library, { limit: 3 }).length, 3);
  assert.deepEqual(mergeContinueRows(activity, library, { limit: 3 }).map((r) => r.id), ["a0", "a1", "a2"]);
});

test("tracking apply write-back updates local library progress like mirrorAppliedChanges", () => {
  // Mirrors background/continue-activity.js mirrorAppliedChanges: after AniList save, write local library.
  const show = { anilistId: 154587, title: "Frieren", episodes: 28, cover: "https://cdn.example/f.png" };
  let library = {};
  library = setEntryProgress(library, show, 4, 1000);
  assert.equal(library["anilist:154587"].status, "in_progress");
  assert.equal(library["anilist:154587"].progress, 4);
  assert.equal(library["anilist:154587"].dirty, true);

  library = setEntryStatus(library, show, "finished", 2000);
  assert.equal(library["anilist:154587"].status, "finished");
  assert.equal(library["anilist:154587"].progress, 28);

  // Plan / dropped do not need a continue activity row; status alone is enough for My list.
  library = setEntryStatus({}, { anilistId: 21, title: "Plan me" }, "plan", 1);
  assert.equal(library["anilist:21"].status, "plan");
  assert.ok(!(library["anilist:21"].progress > 0));
});
