import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { KEYS } from "../src/lib/keys.js";
import { SERVICES, connectedIds, contentScriptsFor } from "../src/lib/services.js";
import { storeManifest } from "../scripts/package.mjs";

const SEARCH = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(path.join(SEARCH, "manifest.json"), "utf8"));

function sources(dir = path.join(SEARCH, "src")) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sources(full) : [full];
  });
}

test("installing asks only for AniList and the data feeds; every streaming site is optional", () => {
  assert.deepEqual(manifest.host_permissions, [
    "https://graphql.anilist.co/*",
    "https://raw.githubusercontent.com/*",
    "https://api.myanimelist.net/*",
    "https://myanimelist.net/*",
  ]);
  assert.ok(!manifest.permissions.some((name) => ["tabs", "webNavigation", "history", "<all_urls>"].includes(name)));
  for (const service of SERVICES) for (const origin of service.origins) assert.ok(manifest.optional_host_permissions.includes(origin), origin);
  assert.ok(!manifest.optional_host_permissions.some((origin) => /^https?:\/\/\*\//.test(origin)), "no wildcard sites");
});

test("the store upload drops the local key but keeps everything else", () => {
  assert.ok(manifest.key, "the source manifest keeps a fixed key for local loading");
  const store = storeManifest(manifest);
  assert.equal(store.key, undefined);
  assert.equal(store.version, manifest.version);
  assert.deepEqual(store.optional_host_permissions, manifest.optional_host_permissions);
});

test("a service counts as connected only when all of its sites are granted", () => {
  assert.deepEqual(connectedIds([]), []);
  assert.deepEqual(connectedIds(["https://www.netflix.com/*", "https://graphql.anilist.co/*"]), ["netflix"]);
  assert.deepEqual(connectedIds(SERVICES.flatMap((service) => service.origins)), SERVICES.map((service) => service.id));
  // Chrome reports path-limited grants as the whole site.
  assert.deepEqual(connectedIds(["https://www.primevideo.com/*", "https://www.amazon.com/*"]), ["prime"]);
  assert.deepEqual(connectedIds(["https://www.amazon.com/*"]), []);
});

test("every service has content script files to register, with unique ids and a known world", () => {
  const ids = new Set();
  for (const service of SERVICES) {
    for (const script of contentScriptsFor(service)) {
      assert.deepEqual(script.matches, service.origins);
      assert.ok(existsSync(path.join(SEARCH, "src", script.js[0])), script.js[0]);
      assert.ok(["MAIN", "ISOLATED"].includes(script.world), script.id);
      assert.match(script.id, /^cs-/);
      assert.ok(!ids.has(script.id), `duplicate ${script.id}`);
      ids.add(script.id);
    }
  }
});

test("the Crunchyroll page script only reads the sign-in header and never alters a request", () => {
  const text = readFileSync(path.join(SEARCH, "src", "content", "crunchyroll-page.js"), "utf8");
  assert.match(text, /originalFetch\.apply\(this, args\)/);
  assert.match(text, /originalSetHeader\.apply\(this, arguments\)/);
  assert.match(text, /postMessage\([^)]*location\.origin\)/);
  assert.ok(!/chrome\./.test(text), "page script has no extension access");
  const bridge = readFileSync(path.join(SEARCH, "src", "content", "crunchyroll.js"), "utf8");
  assert.match(bridge, /event\.source !== window/);
  assert.match(bridge, /event\.origin !== location\.origin/);
});

test("no remote code, eval, or self-update: the store build stays plain MV3", () => {
  for (const file of sources()) {
    const text = readFileSync(file, "utf8");
    const name = path.relative(SEARCH, file);
    assert.ok(!/\beval\s*\(|new Function\s*\(|importScripts\s*\(/.test(text), `${name} evaluates code`);
    assert.ok(!/<script[^>]+src=["']https?:/i.test(text), `${name} loads a remote script`);
    assert.ok(!/import\s*\(\s*["']https?:/.test(text), `${name} imports remote code`);
    assert.ok(!/update-check|update-files|showDirectoryPicker|runtime\.reload/.test(text), `${name} carries update code`);
  }
});

test("every storage key is prefixed so Crunchilist's data is never touched", () => {
  for (const key of Object.values(KEYS)) assert.match(key, /^cs[A-Z]/);
});
