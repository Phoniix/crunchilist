import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MOODS,
  cleanMoods,
  dayKey,
  fallbackMoods,
  moodExpiryFor,
  needsMoodRefresh,
  parseSearchMoods,
  SEARCH_MOODS_COUNT,
  SEARCH_MOODS_RETRY_MS,
  SEARCH_MOODS_TTL_MS,
} from "../lib/search-moods.js";

test("parseSearchMoods accepts JSON moods and clamps length", () => {
  const long = "a".repeat(80);
  const parsed = parseSearchMoods(JSON.stringify({
    moods: ["something cozy", "big fights", long, "smart mystery", "short and sweet", "found family", "extra"],
  }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.moods.length, SEARCH_MOODS_COUNT);
  assert.ok(parsed.moods[2].length <= 40);
});

test("parseSearchMoods rejects thin answers", () => {
  const parsed = parseSearchMoods(JSON.stringify({ moods: ["only one", "two"] }));
  assert.equal(parsed.ok, false);
});

test("cleanMoods drops hard avoids and duplicates", () => {
  const moods = cleanMoods(
    ["something cozy", "Something Cozy", "horror gore", "big fights", "smart mystery", "short and sweet", "found family"],
    ["horror"],
  );
  assert.deepEqual(moods, ["something cozy", "big fights", "smart mystery", "short and sweet", "found family"]);
});

test("fallbackMoods day-seed differs across days", () => {
  const base = {
    liked: ["Fantasy"],
    watched: ["Frieren"],
    searches: ["cozy slice of life"],
    avoids: [],
  };
  const a = fallbackMoods({ ...base, now: Date.parse("2026-01-01T12:00:00Z") });
  const b = fallbackMoods({ ...base, now: Date.parse("2026-01-02T12:00:00Z") });
  assert.equal(a.length, SEARCH_MOODS_COUNT);
  assert.equal(b.length, SEARCH_MOODS_COUNT);
  assert.notDeepEqual(a, b);
  assert.equal(dayKey(Date.parse("2026-01-01T12:00:00Z")), "2026-1-1");
});

test("needsMoodRefresh and moodExpiryFor follow TTL rules", () => {
  const now = 1_000_000;
  assert.equal(needsMoodRefresh(null, "sig", now), true);
  assert.equal(needsMoodRefresh({ moods: DEFAULT_MOODS, expiresAt: now + 10, createdAt: now, signature: "sig" }, "sig", now), false);
  assert.equal(needsMoodRefresh({ moods: DEFAULT_MOODS, expiresAt: now - 1, createdAt: now - 100, signature: "sig" }, "sig", now), true);
  assert.equal(moodExpiryFor({ wantedAi: true, gotAi: true, now }), now + SEARCH_MOODS_TTL_MS);
  assert.equal(moodExpiryFor({ wantedAi: true, gotAi: false, now }), now + SEARCH_MOODS_RETRY_MS);
});
