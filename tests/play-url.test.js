import test from "node:test";
import assert from "node:assert/strict";
import { pickPlayLink, SERVICE_BRAND } from "../lib/play-url.js";

test("pickPlayLink prefers a preferred service, then catalog-checked, then seen", () => {
  const show = {
    streaming: [
      { site: "Crunchyroll", url: "https://www.crunchyroll.com/series/abc", checked: true },
      { site: "Netflix", url: "https://www.netflix.com/search?q=x" },
      { site: "HIDIVE", url: "https://www.hidive.com/series/1", seen: true },
    ],
  };
  assert.equal(pickPlayLink(show, { preferService: "hidive" }).service, "hidive");
  assert.equal(pickPlayLink(show).site, "Crunchyroll");
  assert.equal(pickPlayLink(show, { preferService: "netflix" }).url, "https://www.netflix.com/search?q=x");
  assert.equal(pickPlayLink({ streaming: [] }), null);
  assert.equal(SERVICE_BRAND.crunchyroll, "#F47521");
});

test("pickPlayLink adds HIDIVE episode hint", () => {
  const show = { streaming: [{ site: "HIDIVE", url: "https://www.hidive.com/series/42" }] };
  assert.equal(pickPlayLink(show, { episode: 5 }).url, "https://www.hidive.com/series/42#episode=5");
});

test("pickPlayLink leaves Netflix title URLs alone", () => {
  const titled = { streaming: [{ site: "Netflix", url: "https://www.netflix.com/title/81516223" }] };
  assert.equal(pickPlayLink(titled, { episode: 3 }).url, "https://www.netflix.com/title/81516223");
});
