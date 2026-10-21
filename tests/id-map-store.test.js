import assert from "node:assert/strict";
import test from "node:test";
import { FEED_VERSION } from "../lib/id-map.js";
import { checkDue, refreshPlan } from "../background/id-map-store.js";

test("checkDue is true when never checked or older than the interval", () => {
  assert.equal(checkDue({}), true);
  assert.equal(checkDue({ checkedAt: Date.now() }), false);
  assert.equal(checkDue({ checkedAt: Date.now() - 13 * 60 * 60 * 1000 }), true);
});

test("refreshPlan skips wrong feed version, same when unchanged, else download", () => {
  assert.equal(refreshPlan({}, { version: 99, updated: "2026-01-01", stats: { total: 10 } }, 10), "skip");
  assert.equal(refreshPlan(
    { updated: "2026-01-01" },
    { version: FEED_VERSION, updated: "2026-01-01", stats: { total: 10 } },
    10,
  ), "same");
  assert.equal(refreshPlan(
    { updated: "2026-01-01" },
    { version: FEED_VERSION, updated: "2026-02-01", stats: { total: 11 } },
    10,
  ), "download");
  assert.equal(refreshPlan(
    { updated: "2026-01-01" },
    { version: FEED_VERSION, updated: "2026-01-01", stats: { total: 10 } },
    0,
  ), "download");
});
