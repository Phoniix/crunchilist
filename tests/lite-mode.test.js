import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { badgeOptions } from "../ui/badge-style.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

test("performance mode forces static badges", () => {
  assert.equal(badgeOptions({ liteMode: true }).motion, "static");
  assert.equal(badgeOptions({ liteMode: true }).lite, true);
});

test("performance mode skips Chrome model preload", () => {
  assert.match(read("background/model.js"), /liteMode/);
  assert.match(read("background/model.js"), /preloadChromeModel/);
});

test("performance mode skips AniList page enrich and auto cover matching", () => {
  assert.match(read("background/page.js"), /liteMode/);
  assert.match(read("background/catalog-sync.js"), /liteMode/);
});

test("performance mode slows CR scans and skips search AI rerank", () => {
  assert.match(read("content/main.js"), /liteMode \? 2000/);
  assert.match(read("ui/search-view.js"), /!liteMode && response\.rerank/);
  assert.match(read("ui/search-view.js"), /liteMode \? 450/);
});

test("performance mode gates Prism AI live work and banner fades", () => {
  assert.match(read("app/prism.js"), /const aiLive = \(\) => aiOn\(\) && !lite\(\)/);
  assert.match(read("app/prism-home.js"), /prefs\(\)\.reduce/);
});

test("player bar learns liteMode from tab role", () => {
  assert.match(read("background/player.js"), /liteMode:\s*Boolean\(prefs\.liteMode\)/);
  assert.match(read("content/player-bar.js"), /role\?\.liteMode/);
});
