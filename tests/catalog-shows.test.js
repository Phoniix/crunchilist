import assert from "node:assert/strict";
import test from "node:test";
import { catalogOnlyShows } from "../lib/catalog-shows.js";

test("catalog-only shows skip titles already on Crunchyroll and bare stubs when enriching", () => {
  const found = {
    1: [{ service: "netflix", url: "https://netflix.com/1" }],
    2: [{ service: "hidive", url: "https://hidive.com/2" }],
    3: [{ service: "tubi", url: "https://tubi.tv/3" }],
  };
  const media = {
    1: { title: "Already", genres: ["Action"], about: "yes" },
    2: { title: "Stub only" },
    3: { title: "Enriched", genres: ["Drama"], about: "A story." },
  };
  const rows = catalogOnlyShows(found, media, new Set([1]), { enrich: true });
  assert.deepEqual(rows.map((row) => row.id), ["al-3"]);
  assert.deepEqual(rows[0].sources, ["tubi"]);
  assert.equal(rows[0].onCrunchyroll, false);
  assert.deepEqual(rows[0].streaming, [{ site: "Tubi", url: "https://tubi.tv/3", color: "#7408FF" }]);
  assert.equal(rows[0].url, "https://tubi.tv/3");
});

test("catalog-only shows pick a preferred play URL when several services list the title", () => {
  const found = {
    9: [
      { service: "netflix", url: "https://www.netflix.com/title/9", checked: true },
      { service: "hidive", url: "https://www.hidive.com/series/9" },
    ],
  };
  const media = { 9: { title: "Multi", genres: ["Action"], about: "Yes." } };
  const [row] = catalogOnlyShows(found, media, new Set(), { enrich: true });
  assert.equal(row.url, "https://www.netflix.com/title/9");
  assert.deepEqual(row.sources, ["netflix", "hidive"]);
  assert.equal(row.streaming.length, 2);
});
