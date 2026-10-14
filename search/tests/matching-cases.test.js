import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const cases = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures", "matching-cases.json"), "utf8"));

test("every reported show has a series, a correct AniList entry and a cause", () => {
  for (const item of cases) {
    assert.ok(item.series, JSON.stringify(item));
    assert.ok(Number.isInteger(item.expect) && item.expect > 0, item.series);
    assert.ok(item.cause, item.series);
  }
});

// Real shows that Crunchilist's matcher misses. They turn into real assertions once the layered matcher exists.
for (const item of cases) {
  test(`matches ${item.series}${item.season ? ` — ${item.season}` : ""} to AniList ${item.expect}`, { todo: item.cause }, () => {});
}
