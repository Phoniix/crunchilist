import assert from "node:assert/strict";
import test from "node:test";
import { cleanDeadStore, deadUrlSet, dropDeadLinks, isDeadResponse, isSearchUrl, probeLink } from "../lib/link-check.js";

test("dead responses: hard 404 and soft Netflix browse redirects", () => {
  assert.equal(isDeadResponse(404, "https://www.netflix.com/title/1", "https://www.netflix.com/title/1"), true);
  assert.equal(isDeadResponse(200, "https://www.netflix.com/browse", "https://www.netflix.com/title/1"), true);
  assert.equal(isDeadResponse(200, "https://www.netflix.com/title/80117457", "https://www.netflix.com/title/80117457"), false);
  assert.equal(isDeadResponse(403, "https://www.netflix.com/title/1", "https://www.netflix.com/title/1"), false);
  assert.equal(isSearchUrl("https://www.netflix.com/search?q=a"), true);
});

test("probe skips search URLs; marks 404 dead; network errors stay live", async () => {
  assert.deepEqual(await probeLink("https://www.netflix.com/search?q=x"), { url: "https://www.netflix.com/search?q=x", dead: false, skipped: true });
  const dead = await probeLink("https://www.netflix.com/title/0", {
    fetchImpl: async () => ({ status: 404, url: "https://www.netflix.com/title/0" }),
  });
  assert.equal(dead.dead, true);
  const flaky = await probeLink("https://www.hulu.com/series/x", { fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(flaky.dead, false);
  assert.equal(flaky.error, true);
});

test("dead store trims and dropDeadLinks filters streaming rows", () => {
  const store = cleanDeadStore({
    "https://www.netflix.com/title/1": { url: "https://www.netflix.com/title/1", dead: true, at: Date.now() },
    "https://www.netflix.com/title/2": { url: "https://www.netflix.com/title/2", dead: false, at: Date.now() },
  });
  assert.deepEqual(deadUrlSet(store), { "https://www.netflix.com/title/1": true });
  assert.deepEqual(dropDeadLinks([
    { site: "Netflix", url: "https://www.netflix.com/title/1" },
    { site: "Netflix", url: "https://www.netflix.com/title/2" },
  ], deadUrlSet(store)).map((link) => link.url), ["https://www.netflix.com/title/2"]);
});
