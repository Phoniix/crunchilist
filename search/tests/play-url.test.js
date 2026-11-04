import assert from "node:assert/strict";
import test from "node:test";
import { pickPlayLink, SERVICE_BRAND } from "../src/lib/play-url.js";

test("pickPlayLink prefers a preferred service, then catalog-checked, then seen", () => {
  const show = {
    streaming: [
      { site: "Netflix", url: "https://www.netflix.com/search?q=x", seen: true },
      { site: "Crunchyroll", url: "https://www.crunchyroll.com/series/ABC123", checked: true, color: "#F47521" },
      { site: "HIDIVE", url: "https://www.hidive.com/series/9" },
    ],
  };
  assert.equal(pickPlayLink(show, { preferService: "hidive" }).service, "hidive");
  assert.equal(pickPlayLink(show).site, "Crunchyroll");
  assert.equal(pickPlayLink(show, { preferService: "netflix" }).url, "https://www.netflix.com/search?q=x");
  assert.equal(pickPlayLink({ streaming: [] }), null);
});

test("HIDIVE continue links carry an episode hash when we know the next episode", () => {
  const show = { streaming: [{ site: "HIDIVE", url: "https://www.hidive.com/series/42" }] };
  assert.equal(pickPlayLink(show, { episode: 5 }).url, "https://www.hidive.com/series/42#episode=5");
  assert.equal(SERVICE_BRAND.netflix, "#E50914");
});

test("Netflix title URLs resume last watched — no episode hint added", () => {
  const titled = { streaming: [{ site: "Netflix", url: "https://www.netflix.com/title/81516223", checked: true }] };
  assert.equal(pickPlayLink(titled, { episode: 3 }).url, "https://www.netflix.com/title/81516223");
});
