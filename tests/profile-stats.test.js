import assert from "node:assert/strict";
import test from "node:test";
import { profileStats } from "../lib/profile-stats.js";

const show = (id, extra = {}) => ({
  id,
  title: extra.title || id,
  cover: "",
  genres: extra.genres || [],
  tags: extra.tags || [],
  episodes: extra.episodes ?? 12,
  seasons: [{ label: "Season 1", episodes: extra.episodes ?? 12 }],
});

test("profileStats counts statuses and episodes logged", () => {
  const shows = [
    show("a", { genres: ["Fantasy", "Adventure"], tags: ["Magic"], episodes: 12 }),
    show("b", { genres: ["Fantasy"], episodes: 24 }),
    show("c", { genres: ["Comedy"], episodes: 12 }),
    show("d", { genres: ["Horror"], episodes: 10 }),
  ];
  const library = {
    a: { at: 0, lastWatchedAt: Date.parse("2026-03-01"), s: { 0: { status: "watching", progress: 5 } } },
    b: { at: 0, lastWatchedAt: Date.parse("2026-02-01"), s: { 0: { status: "finished", progress: 24 } } },
    c: { at: 0, lastWatchedAt: 0, s: { 0: { status: "plan", progress: 0 } } },
    d: { at: 0, lastWatchedAt: Date.parse("2025-12-01"), s: { 0: { status: "dropped", progress: 2 } } },
  };
  const stats = profileStats({ shows, library, now: Date.parse("2026-06-01T12:00:00Z") });
  assert.deepEqual(stats.counts, { watching: 1, plan: 1, finished: 1, dropped: 1 });
  assert.equal(stats.episodesLogged, 5 + 24 + 0 + 2);
  assert.equal(stats.finishedThisYear, 1);
  assert.deepEqual(stats.topGenres[0], { name: "Fantasy", count: 2 });
  assert.equal(stats.recent[0].id, "a");
  assert.equal(stats.recent.length, 3); // plan excluded from recent
});

test("profileStats finished without timestamp does not count toward this year", () => {
  const shows = [show("a", { episodes: 12 })];
  const library = { a: { at: 0, lastWatchedAt: 0, s: { 0: { status: "finished", progress: 12 } } } };
  const stats = profileStats({ shows, library, now: Date.parse("2026-06-01") });
  assert.equal(stats.counts.finished, 1);
  assert.equal(stats.finishedThisYear, 0);
  assert.equal(stats.episodesLogged, 12);
  assert.deepEqual(stats.recent, []);
});
