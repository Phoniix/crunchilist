import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { availability, withCatalogLinks } from "../lib/streaming-links.js";
import { cleanWhereMap, gapUrlOk, preferGapUrl, validWhereMap } from "../lib/where-map.js";

const packaged = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "feeds", "where-map.json"), "utf8"));

test("packaged where-map cleans to Netflix/Prime/Hulu https links", () => {
  const cleaned = cleanWhereMap(packaged);
  assert.ok(cleaned);
  assert.equal(cleaned.version, 1);
  assert.ok(Object.keys(cleaned.links).length > 100);
  const sample = Object.values(cleaned.links)[0];
  for (const service of Object.keys(sample)) {
    assert.ok(gapUrlOk(service, sample[service]));
  }
  assert.equal(validWhereMap(packaged), true);
  assert.equal(validWhereMap({ version: 99, links: {} }), false);
});

test("preferGapUrl keeps a title page over a search URL", () => {
  const search = "https://www.netflix.com/search?q=Naruto";
  const title = "https://www.netflix.com/title/80057281";
  assert.equal(preferGapUrl(search, title), title);
  assert.equal(preferGapUrl(title, search), title);
});

test("availability + withCatalogLinks folds gap URLs into streaming", () => {
  const gaps = { 16498: { netflix: "https://www.netflix.com/title/80057281", hulu: "https://www.hulu.com/series/attack-on-titan" } };
  const found = availability({}, [], { gaps });
  assert.equal(found[16498].length, 2);
  const show = withCatalogLinks({ anilistId: 16498, title: "Attack on Titan", streaming: [] }, found);
  assert.deepEqual(show.onServices.sort(), ["hulu", "netflix"]);
  assert.equal(show.streaming.find((link) => link.site === "Netflix")?.url, "https://www.netflix.com/title/80057281");
  assert.equal(show.streaming.find((link) => link.site === "Hulu")?.checked, true);
});

test("withCatalogLinks upgrades an AniList search link when the gap map has a title URL", () => {
  const found = availability({}, [], {
    gaps: { 1: { netflix: "https://www.netflix.com/title/80100172" } },
  });
  const show = withCatalogLinks({
    anilistId: 1,
    streaming: [{ site: "Netflix", url: "https://www.netflix.com/search?q=Cowboy+Bebop" }],
  }, found);
  assert.equal(show.streaming.length, 1);
  assert.equal(show.streaming[0].url, "https://www.netflix.com/title/80100172");
  assert.equal(show.streaming[0].checked, true);
});
