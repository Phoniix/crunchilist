import assert from "node:assert/strict";
import test from "node:test";
import { KEYS } from "../lib/keys.js";

const stored = {};

function storageGet(bag, keys) {
  if (keys == null) return { ...bag };
  if (typeof keys === "string") return { [keys]: bag[keys] };
  if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, bag[key]]));
  return Object.fromEntries(Object.keys(keys).map((key) => [key, key in bag ? bag[key] : keys[key]]));
}

globalThis.chrome = {
  runtime: {
    id: "ext-id",
    getURL: (path) => `chrome-extension://ext-id/${path}`,
    getManifest: () => ({ version: "0.0.0" }),
    onMessage: { addListener() {} },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    sendMessage: async () => {},
  },
  storage: {
    local: {
      get: async (keys) => storageGet(stored, keys),
      set: async (values) => Object.assign(stored, values),
      remove: async (keys) => { for (const key of [].concat(keys)) delete stored[key]; },
    },
    session: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
  },
  alarms: { create: async () => {}, get: async () => undefined, clear: async () => {}, getAll: async () => [], onAlarm: { addListener() {} } },
  permissions: { getAll: async () => ({ origins: [], permissions: [] }), contains: async () => true, onAdded: { addListener() {} }, onRemoved: { addListener() {} } },
  tabs: { get: async () => null, query: async () => [], sendMessage: async () => null, onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
  scripting: { executeScript: async () => [], registerContentScripts: async () => {}, unregisterContentScripts: async () => {}, getRegisteredContentScripts: async () => [] },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
  webNavigation: {
    onBeforeNavigate: { addListener() {} },
    onCommitted: { addListener() {} },
    onErrorOccurred: { addListener() {} },
    onReferenceFragmentUpdated: { addListener() {} },
  },
};

const { resolvePending, backgroundSync } = await import("../background/importer.js");

test("resolvePending skip marks the item skipped and leaves it out of open picks", async () => {
  Object.keys(stored).forEach((key) => delete stored[key]);
  stored[KEYS.pending] = {
    "netflix:show": {
      service: "netflix",
      input: { series: "Show", season: "Show", episodes: [1], played: { 1: 10 } },
      candidates: [1],
      reason: "unsure",
      lastPlayed: 10,
    },
  };
  const result = await resolvePending("netflix:show", null);
  assert.deepEqual(result, { skipped: true });
  assert.equal(stored[KEYS.pending]["netflix:show"].skipped, true);
});

test("resolvePending throws when the key is already gone", async () => {
  Object.keys(stored).forEach((key) => delete stored[key]);
  stored[KEYS.pending] = {};
  await assert.rejects(resolvePending("missing", null), /already handled/);
});

test("backgroundSync waits while a preview is open", async () => {
  Object.keys(stored).forEach((key) => delete stored[key]);
  stored[KEYS.importPreview] = { id: "block", changes: [] };
  stored[KEYS.session] = { token: "t", viewer: { id: 1 } };
  assert.deepEqual(await backgroundSync(["tubi"], { trigger: "tracking", apply: true }), { ran: false, why: "preview" });
});
