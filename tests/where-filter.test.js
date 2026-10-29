import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { matchesWhereSite } from "../lib/catalogs.js";
import { applySettingsPatch, defaultSettings, whereFilterMode } from "../lib/settings.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("whereFilterMode defaults to remember and accepts host", () => {
  assert.equal(whereFilterMode(defaultSettings()), "remember");
  assert.equal(whereFilterMode(applySettingsPatch(defaultSettings(), { whereFilterMode: "host" })), "host");
  assert.equal(whereFilterMode({ whereFilterMode: "nope" }), "remember");
});

test("panelHello siteFilter uses host service only in host mode; remember opens all until a chip is chosen", () => {
  const source = readFileSync(join(root, "background/site-scripts.js"), "utf8");
  assert.match(source, /whereFilterMode\(state\.settings\)/);
  assert.match(source, /mode === "host" \? service\.id : \(last \|\| "all"\)/);
});

test("search-view and site-panel persist lastWhereSite when the filter changes", () => {
  const search = readFileSync(join(root, "ui/search-view.js"), "utf8");
  const panel = readFileSync(join(root, "content/site-panel.js"), "utf8");
  assert.match(search, /lastWhereSite:\s*currentSite === "all" \? "" : currentSite/);
  assert.match(panel, /lastWhereSite:\s*currentSite === "all" \? "" : currentSite/);
});

test("Where chips cycle on → only → off in search-view", () => {
  const search = readFileSync(join(root, "ui/search-view.js"), "utf8");
  assert.match(search, /if \(!siteOnly\) siteOnly = true/);
  assert.match(search, /currentSite = "all"/);
  assert.match(search, /siteOnly/);
  assert.match(search, /is-only/);
});

test("matchesWhereSite: on-site vs site-only", () => {
  assert.equal(matchesWhereSite(["netflix", "crunchyroll"], "netflix"), true);
  assert.equal(matchesWhereSite(["netflix", "crunchyroll"], "netflix", { only: true }), false);
  assert.equal(matchesWhereSite(["hidive"], "hidive", { only: true }), true);
  assert.equal(matchesWhereSite(["hidive"], "netflix"), false);
  assert.equal(matchesWhereSite(["HIDIVE"], "hidive", { only: true }), true);
  assert.equal(matchesWhereSite([], "all"), true);
});
