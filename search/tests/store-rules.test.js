import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { KEYS } from "../src/lib/keys.js";
import { SERVICES, connectedIds, contentScriptFor } from "../src/lib/services.js";
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
  assert.deepEqual(manifest.host_permissions, ["https://graphql.anilist.co/*", "https://raw.githubusercontent.com/*"]);
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
});

test("every service has a content script file to register", () => {
  for (const service of SERVICES) {
    const script = contentScriptFor(service);
    assert.deepEqual(script.matches, service.origins);
    assert.ok(existsSync(path.join(SEARCH, "src", script.js[0])), script.js[0]);
  }
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
