import assert from "node:assert/strict";
import test from "node:test";
import { updatesInLabel, updatesInParts } from "../lib/update-eta.js";

test("updatesInLabel floors to days and hours", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  assert.equal(updatesInLabel(now + 3 * 60 * 60 * 1000, now), "Updates in: 0D 3H");
  assert.equal(updatesInLabel(now + (2 * 24 + 5) * 60 * 60 * 1000, now), "Updates in: 2D 5H");
  assert.equal(updatesInLabel(now, now), "");
  assert.equal(updatesInLabel(now - 1, now), "");
  assert.deepEqual(updatesInParts(now + 90 * 60 * 1000, now), { days: 0, hours: 1, overdue: false });
});
