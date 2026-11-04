import assert from "node:assert/strict";
import test from "node:test";
import { catalogSummary } from "../src/lib/catalogs.js";
import {
  TITLE_CONTRACT, TITLE_KEYS, catalogRates, formatMatchRate, titleReadiness,
} from "../src/lib/title-api.js";
import { KEYS } from "../src/lib/keys.js";

test("title contract version and storage keys stay stable for main-page integration", () => {
  assert.equal(TITLE_CONTRACT.version, 1);
  assert.equal(TITLE_KEYS.catalogs, KEYS.catalogs);
  assert.equal(TITLE_KEYS.matches, KEYS.matches);
  assert.ok(TITLE_CONTRACT.availability.includes("availability("));
});

test("catalog rates and summary expose matchRate", () => {
  const catalogs = {
    crunchyroll: { at: 1, titles: 100, matched: 72, links: { 1: "https://www.crunchyroll.com/series/X" }, error: "", tried: 1 },
    tubi: { at: 0, titles: 0, matched: 0, links: {}, error: "Open Tubi", tried: 2 },
  };
  const summary = catalogSummary(catalogs);
  assert.equal(summary.crunchyroll.matchRate, 0.72);
  assert.equal(summary.tubi.matchRate, null);
  const rates = catalogRates(summary);
  assert.equal(rates.crunchyroll.matchRate, 0.72);
  assert.equal(rates.hidive, null);
  assert.equal(formatMatchRate(0.7234), "72.3%");
  assert.equal(formatMatchRate(null), "—");
});

test("title readiness waits on master list and treats where-map as partial", () => {
  const cold = titleReadiness({});
  assert.equal(cold.canMatch, false);
  assert.equal(cold.canShowAvailability, false);
  assert.equal(cold.whereMap.partial, true);

  const ready = titleReadiness({
    idMap: { count: 20000, updated: "2026-10-15" },
    whereMap: { count: 708, source: "anilist", updated: "2026-10-16" },
    connected: ["crunchyroll", "netflix"],
    catalogs: {
      crunchyroll: { at: Date.now(), titles: 10, matched: 8, links: { 1: "https://www.crunchyroll.com/series/A" } },
    },
  });
  assert.equal(ready.canMatch, true);
  assert.equal(ready.canShowAvailability, true);
  assert.deepEqual(ready.catalogsRead, ["crunchyroll"]);
  assert.equal(ready.catalogs.crunchyroll.matchRate, 0.8);
});
