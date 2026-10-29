import assert from "node:assert/strict";
import test from "node:test";
import {
  PROVISIONAL_MAX_AGE_MS,
  activityFromFinishedEpisode,
  activityFromWatchEpisode,
  activityFromWatchStart,
  cleanContinueRow,
  expireProvisionalContinue,
  mergeContinueRows,
  normalizeContinueActivity,
  resolveContinueTarget,
  shouldBumpContinueFromImport,
  upsertContinueActivity,
} from "../lib/continue-activity.js";
import { setEntryProgress, setEntryStatus, touchLastWatched } from "../lib/library.js";
import { matchKey } from "../lib/remembered.js";

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

test("junk titles and older pending stubs are scrubbed from Continue Watching", () => {
  const now = Date.now();
  let list = normalizeContinueActivity([
    { id: "pending:netflix:netflix", title: "Netflix", progress: 0, at: now - 1000, service: "netflix", provisional: true },
    { id: "pending:netflix:feeling blue", title: "Feeling Blue", progress: 0, at: now - 500, service: "netflix", provisional: true },
    { id: "pending:netflix:love through a prism", title: "Love Through a Prism", progress: 0, at: now, service: "netflix", provisional: true },
  ], { now });
  assert.deepEqual(list.map((row) => row.title), ["Love Through a Prism"]);
  list = upsertContinueActivity(list, {
    id: "al-999",
    title: "Love Through a Prism",
    progress: 0,
    at: now + 1,
    service: "netflix",
    anilistId: 999,
    provisional: true,
  }, { now: now + 1 });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "al-999");
  assert.equal(cleanContinueRow({ id: "x", title: "Netflix", progress: 0 }), null);
});

test("finished episode builds progress = episode, and completing a season drops the row", () => {
  const row = activityFromFinishedEpisode({
    id: "GFRIEREN",
    title: "Frieren",
    episode: 5,
    episodes: 28,
    service: "hidive",
  });
  assert.equal(row.progress, 5);
  assert.equal(row.next, 6);
  let list = upsertContinueActivity([], row);
  list = upsertContinueActivity(list, { id: "GFRIEREN", title: "Frieren", progress: 28, episodes: 28, service: "hidive" });
  assert.deepEqual(list, []);
});

test("resolveContinueTarget uses remembered matches and catalog ids", () => {
  const key = matchKey("tubi", "death note", "s1");
  const matches = { [key]: { anilistId: 1535, how: "auto", names: ["Death Note — Season 1"] } };
  const catalog = { items: [{ id: "G4", title: "Death Note", anilistId: 1535, url: "https://www.crunchyroll.com/series/G4" }] };
  const found = resolveContinueTarget({
    service: "tubi",
    series: "Death Note",
    seasonNumber: 1,
    matches,
    library: {},
    catalog,
    catalogLinks: { 1535: "https://tubitv.com/series/1" },
  });
  assert.equal(found.id, "G4");
  assert.equal(found.anilistId, 1535);
  assert.equal(found.playUrl, "https://tubitv.com/series/1");
  assert.equal(resolveContinueTarget({ service: "tubi", series: "Unknown Show", matches: {}, library: {}, catalog: {} }), null);
});

test("resolveContinueTarget finds HIDIVE matches stored with API season ids", () => {
  // Import remembers hidive:series/19999; watch lookup used to only try …/s2 and miss.
  const matches = {
    "hidive:made in abyss/19999": {
      anilistId: 97938,
      how: "auto",
      names: ["MADE IN ABYSS — Season 2"],
    },
  };
  const found = resolveContinueTarget({
    service: "hidive",
    series: "MADE IN ABYSS",
    seasonNumber: 2,
    matches,
    library: {},
    catalog: {},
    catalogLinks: { 97938: "https://www.hidive.com/series/1271" },
  });
  assert.equal(found?.anilistId, 97938);
  assert.equal(found?.id, "al-97938");
  assert.equal(found?.playUrl, "https://www.hidive.com/series/1271");
});

test("resolveContinueTarget uses library title and CR catalog title when matches are empty", () => {
  const fromLibrary = resolveContinueTarget({
    service: "hidive",
    series: "Oshi no Ko",
    matches: {},
    library: { "anilist:150672": { anilistId: 150672, title: "Oshi no Ko", status: "in_progress", progress: 3 } },
    catalog: {},
  });
  assert.equal(fromLibrary?.id, "al-150672");

  const fromCatalog = resolveContinueTarget({
    service: "hidive",
    series: "Frieren",
    matches: {},
    library: {},
    catalog: { items: [{ id: "GFRIEREN", title: "Frieren", anilistId: 154587 }] },
  });
  assert.equal(fromCatalog?.id, "GFRIEREN");
  assert.equal(fromCatalog?.anilistId, 154587);
});

test("mergeContinueRows can follow anilistId when activity id is al-*", () => {
  const activity = [{ id: "al-97938", anilistId: 97938, title: "Made in Abyss", progress: 4, at: 10 }];
  const library = [{ id: "al-97938", title: "Made in Abyss", progress: 1 }];
  assert.deepEqual(mergeContinueRows(activity, library, { limit: 5 }).map((row) => row.id), ["al-97938"]);
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

test("provisional watch-start rows keep prior progress and expire after 7 days", () => {
  const start = activityFromWatchStart({
    id: "G1",
    title: "Frieren",
    episode: 4,
    progress: 2,
    episodes: 28,
    service: "netflix",
    anilistId: 154587,
    at: 1_000,
  });
  assert.equal(start.provisional, true);
  assert.equal(start.progress, 2);
  assert.equal(start.next, 4);
  const confirmed = activityFromFinishedEpisode({
    id: "G1",
    title: "Frieren",
    episode: 4,
    episodes: 28,
    service: "netflix",
    provisional: false,
    at: 2_000,
  });
  assert.equal(confirmed.provisional, false);
  const mixed = normalizeContinueActivity([start, { id: "G2", title: "Other", progress: 1, provisional: true, at: 1_000 }]);
  const now = 1_000 + PROVISIONAL_MAX_AGE_MS + 1;
  const kept = expireProvisionalContinue(mixed, { now });
  assert.deepEqual(kept.map((row) => row.id), []);
  const fresh = expireProvisionalContinue([
    { id: "G1", progress: 1, provisional: true, at: now - 1000 },
    { id: "G2", progress: 1, provisional: false, at: 1 },
  ], { now });
  assert.deepEqual(fresh.map((row) => row.id), ["G1", "G2"]);
});

test("touchLastWatched stamps watching without raising progress", () => {
  let library = {};
  library = touchLastWatched(library, { anilistId: 1535, title: "Death Note" }, 5_000);
  assert.equal(library["anilist:1535"].status, "in_progress");
  assert.equal(library["anilist:1535"].progress, 0);
  assert.equal(library["anilist:1535"].lastWatchedAt, 5_000);
  library = setEntryProgress(library, { anilistId: 1535, title: "Death Note" }, 3, 6_000);
  assert.equal(library["anilist:1535"].progress, 3);
  assert.equal(library["anilist:1535"].lastWatchedAt, 6_000);
  library = touchLastWatched(library, { anilistId: 1535, title: "Death Note" }, 7_000);
  assert.equal(library["anilist:1535"].progress, 3);
  assert.equal(library["anilist:1535"].lastWatchedAt, 7_000);
});

test("shouldBumpContinueFromImport skips finished and no-new-activity rows", () => {
  assert.equal(shouldBumpContinueFromImport({
    after: { status: "CURRENT", progress: 5 },
    before: { status: "CURRENT", progress: 3 },
    episodes: 12,
    watched: { lastPlayed: 1_700_000_000_000 },
  }), true);
  assert.equal(shouldBumpContinueFromImport({
    after: { status: "COMPLETED", progress: 12 },
    before: { status: "CURRENT", progress: 11 },
    episodes: 12,
    watched: { lastPlayed: 1_700_000_000_000 },
  }), false);
  assert.equal(shouldBumpContinueFromImport({
    after: { status: "CURRENT", progress: 5 },
    before: { status: "CURRENT", progress: 5 },
    episodes: 12,
    watched: { lastPlayed: 0 },
  }), false, "no new plays since last import");
  assert.equal(shouldBumpContinueFromImport({
    after: { status: "CURRENT", progress: 1 },
    before: null,
    episodes: 12,
    watched: { lastPlayed: 0 },
  }), true, "progress increased from empty counts as started");
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
