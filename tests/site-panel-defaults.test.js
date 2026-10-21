import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("site-boot defaults the search site filter to the host service", () => {
  const source = readFileSync(join(root, "content/site-boot.js"), "utf8");
  assert.match(source, /site:\s*hello\.siteFilter\s*\|\|\s*service/);
  assert.match(source, /platforms:\s*SEARCH_PLATFORMS/);
  assert.match(source, /setFullscreen/);
  assert.match(source, /fullscreenchange/);
});

test("createPanel accepts site/accent/gatherLabel/layout options", () => {
  const source = readFileSync(join(root, "content/panel.js"), "utf8");
  assert.match(source, /gatherLabel\s*=/);
  assert.match(source, /accent\s*=/);
  assert.match(source, /layout\s*=/);
  assert.match(source, /createSearchView\(\{\s*send,\s*site,\s*platforms/);
});

test("non-CR sites register a MAIN-world key guard before the panel", () => {
  const source = readFileSync(join(root, "lib/services.js"), "utf8");
  assert.match(source, /ks-keys-\$\{service\.id\}/);
  assert.match(source, /content\/site\/key-guard\.js/);
  assert.match(source, /world:\s*"MAIN"/);
  const guard = readFileSync(join(root, "content/sites/key-guard.js"), "utf8");
  assert.match(guard, /composedPath/);
  assert.match(guard, /ks-site-panel/);
  assert.match(guard, /addEventListener/);
});
