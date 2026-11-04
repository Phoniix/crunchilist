import assert from "node:assert/strict";
import test from "node:test";
import { forgetNote, forgetSite } from "../src/lib/forget-site.js";
import { KEYS } from "../src/lib/keys.js";

const STORED = {
  [KEYS.checkpoints]: { "netflix:Me": { newestAt: 5 }, "crunchyroll:abc": { newestAt: 6 } },
  [KEYS.matches]: { "netflix:frieren": { anilistId: 3 }, "netflix:mob": { anilistId: 4 }, "crunchyroll:G1": { anilistId: 1 }, "mal:9": { anilistId: 9 } },
  [KEYS.pending]: { "netflix:odd": { service: "netflix" }, "crunchyroll:odd": { service: "crunchyroll" } },
  [KEYS.watchLog]: [{ service: "netflix", series: "A" }, { service: "hidive", series: "B" }],
  [KEYS.importDraft]: { service: "netflix", rows: [] },
  [KEYS.syncState]: { sites: { netflix: 1, hidive: 2 }, watch: { netflix: { at: 1 } }, lastRun: 3 },
  [KEYS.catalogs]: { hidive: { at: 1 } },
};

test("forgetting a site clears only that site's data", () => {
  const plan = forgetSite(STORED, "netflix");
  assert.deepEqual(Object.keys(plan.set[KEYS.checkpoints]), ["crunchyroll:abc"]);
  assert.deepEqual(Object.keys(plan.set[KEYS.matches]), ["crunchyroll:G1", "mal:9"]);
  assert.deepEqual(Object.keys(plan.set[KEYS.pending]), ["crunchyroll:odd"]);
  assert.deepEqual(plan.set[KEYS.watchLog], [{ service: "hidive", series: "B" }]);
  assert.deepEqual(plan.set[KEYS.syncState], { sites: { hidive: 2 }, watch: {}, lastRun: 3 });
  assert.ok(!(KEYS.catalogs in plan.set), "other sites' catalogs aren't touched");
  assert.deepEqual(plan.remove, [KEYS.importDraft]);
  assert.deepEqual(plan.counts, { checkpoints: 1, matches: 2, picks: 1, watched: 1 });
  assert.equal(forgetNote("Netflix", plan.counts), "Forgot your Netflix data: 2 remembered matches, 1 waiting pick, 1 tracked episode, where imports left off.");
});

test("a site with nothing stored changes nothing", () => {
  const plan = forgetSite(STORED, "tubi");
  assert.deepEqual(plan, { set: {}, remove: [], counts: { checkpoints: 0, matches: 0, picks: 0, watched: 0 } });
  assert.equal(forgetNote("Tubi", plan.counts), "There was no Tubi data left to forget.");
});

test("the site's own preview goes; an Import all preview with its history has to be settled first", () => {
  assert.ok(forgetSite({ [KEYS.importPreview]: { service: "hidive", ckey: "hidive:1" } }, "hidive").remove.includes(KEYS.importPreview));
  const all = { [KEYS.importPreview]: { service: "all", checkpoints: [{ ckey: "hidive:1" }, { ckey: "netflix:Me" }] } };
  assert.match(forgetSite(all, "hidive").blocked, /Import all preview/);
  assert.ok(!forgetSite(all, "tubi").blocked);
  assert.deepEqual(forgetSite(STORED, "hidive").set[KEYS.catalogs], {}, "its catalog goes");
});
