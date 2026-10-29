import assert from "node:assert/strict";
import test from "node:test";
import { MASTER_BADGE, badgeForTasks } from "../lib/activity-badge.js";
import { SERVICE_BRAND } from "../lib/play-url.js";

test("idle tasks yield no badge", () => {
  assert.equal(badgeForTasks([]), null);
  assert.equal(badgeForTasks(null), null);
});

test("one site uses that brand color and its percent", () => {
  const badge = badgeForTasks([{ label: "Reading Netflix", service: "netflix", progress: 0.42 }]);
  assert.equal(badge.color, SERVICE_BRAND.netflix);
  assert.equal(badge.text, "42%");
  assert.match(badge.title, /Reading Netflix: 42%/);
});

test("multiple sites use a weighted master percent and product accent", () => {
  const badge = badgeForTasks([
    { label: "Netflix", service: "netflix", done: 10, total: 100, progress: 0.1 },
    { label: "Tubi", service: "tubi", done: 90, total: 10, progress: 0.9 },
  ]);
  // Weights 100 and 10 → (0.1*100 + 0.9*10) / 110 ≈ 0.172 → 17%
  assert.equal(badge.color, MASTER_BADGE);
  assert.equal(badge.text, "17%");
  assert.match(badge.title, /Netflix/);
  assert.match(badge.title, /Tubi/);
});

test("an all-sites task forces master accent", () => {
  const badge = badgeForTasks([
    { label: "Matching", service: "all", progress: 0.5 },
    { label: "Netflix", service: "netflix", progress: 0.2 },
  ]);
  assert.equal(badge.color, MASTER_BADGE);
  assert.equal(badge.text, "35%");
});

test("global-only tasks use the product accent", () => {
  const badge = badgeForTasks([{ label: "Syncing AniList", service: "global", progress: 0.8 }]);
  assert.equal(badge.color, MASTER_BADGE);
  assert.equal(badge.text, "80%");
});

test("badge text never shows 100%", () => {
  assert.equal(badgeForTasks([{ label: "Done", service: "crunchyroll", progress: 1 }]).text, "99%");
});
