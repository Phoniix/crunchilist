import assert from "node:assert/strict";
import test from "node:test";
import { KEYS } from "../src/lib/keys.js";
import { serviceById } from "../src/lib/services.js";
import { DEFAULT_SETTINGS, cleanSettings, mergeSettings } from "../src/lib/settings.js";

const stored = {};
const replies = [];
globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => ({ [key]: stored[key] }),
      set: async (values) => Object.assign(stored, values),
      remove: async (keys) => { for (const key of [].concat(keys)) delete stored[key]; },
    },
    session: { get: async () => ({ [KEYS.netflixTab]: 7 }), set: async () => {} },
  },
  tabs: { sendMessage: async (_tab, message) => replies.find((reply) => reply.type === message.type)?.reply ?? null },
  action: { setBadgeText: async () => {} },
};
const { backgroundSync } = await import("../src/background/importer.js");

const reset = () => { for (const key of Object.keys(stored)) delete stored[key]; replies.length = 0; };
const signedIn = () => { stored[KEYS.session] = { token: "t", viewer: { id: 1 } }; };

test("background updates are off by default and only true switches them on", () => {
  assert.deepEqual(cleanSettings(undefined), DEFAULT_SETTINGS);
  assert.equal(cleanSettings({ dailySync: "yes", trackNetflix: 1 }).dailySync, false);
  assert.deepEqual(mergeSettings({ dailySync: true }, { syncApply: true }), { ...DEFAULT_SETTINGS, dailySync: true, syncApply: true });
});

test("Hulu is listed but every option is off until it can be tested", () => {
  assert.equal(serviceById("hulu").untested, true);
  assert.equal(serviceById("netflix").untested, undefined);
});

test("a background sync waits for an open preview or a read stopped partway, and never touches them", async () => {
  reset();
  signedIn();
  stored[KEYS.importPreview] = { id: "mine", changes: [] };
  assert.deepEqual(await backgroundSync(["netflix"], { trigger: "daily", apply: true }), { ran: false, why: "preview" });
  assert.equal(stored[KEYS.importPreview].id, "mine");
  delete stored[KEYS.importPreview];
  stored[KEYS.importDraft] = { service: "crunchyroll", rows: [1] };
  assert.deepEqual(await backgroundSync(["netflix"], { trigger: "daily", apply: true }), { ran: false, why: "draft" });
  assert.deepEqual(stored[KEYS.importDraft], { service: "crunchyroll", rows: [1] });
});

test("a background sync needs AniList", async () => {
  reset();
  await assert.rejects(backgroundSync(["netflix"], { trigger: "tracking", apply: true }), /Connect AniList/);
});

test("a site never imported for that profile is skipped, so a sync never starts a whole-history read", async () => {
  reset();
  signedIn();
  stored[KEYS.checkpoints] = { "netflix:other-profile": { newestAt: 1 } };
  replies.push({ type: "netflixProfile", reply: { ok: true, guid: "kid-profile", name: "Kids" } });
  replies.push({ type: "netflixActivity", reply: { ok: false, error: "should not be read" } });
  const result = await backgroundSync(["netflix"], { trigger: "tracking", apply: true });
  assert.equal(result.ran, true);
  assert.match(result.message, /Tracking: Skipped: Netflix \(not imported yet for Kids/);
  assert.equal(stored[KEYS.importDraft], undefined);
  assert.equal(stored[KEYS.importPreview], undefined);
});
