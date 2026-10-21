import assert from "node:assert/strict";
import test from "node:test";
import { KEYS } from "../lib/keys.js";
import { serviceById } from "../lib/services.js";
import { applySettingsPatch, cleanSettings, defaultSettings } from "../lib/settings.js";

const stored = {};
const session = {};
const replies = [];

function storageGet(bag, keys) {
  if (keys == null) return { ...bag };
  if (typeof keys === "string") return { [keys]: bag[keys] };
  if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, bag[key]]));
  return Object.fromEntries(Object.keys(keys).map((key) => [key, key in bag ? bag[key] : keys[key]]));
}

globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => storageGet(stored, keys),
      set: async (values) => Object.assign(stored, values),
      remove: async (keys) => { for (const key of [].concat(keys)) delete stored[key]; },
    },
    session: {
      get: async (keys) => storageGet(session, keys),
      set: async (values) => Object.assign(session, values),
    },
  },
  tabs: {
    get: async (id) => ({ id }),
    sendMessage: async (_tab, message) => replies.find((reply) => reply.type === message.type)?.reply ?? null,
  },
  action: { setBadgeText: async () => {} },
  scripting: { executeScript: async () => [], getRegisteredContentScripts: async () => [] },
  permissions: { getAll: async () => ({ origins: [], permissions: [] }) },
};

const { backgroundSync } = await import("../background/importer.js");

const reset = () => {
  for (const key of Object.keys(stored)) delete stored[key];
  for (const key of Object.keys(session)) delete session[key];
  replies.length = 0;
  session[KEYS.netflixTab] = 7;
};
const signedIn = () => { stored[KEYS.session] = { token: "t", viewer: { id: 1 } }; };

test("background updates are off by default and only true switches them on", () => {
  assert.equal(defaultSettings().dailySync, false);
  assert.equal(defaultSettings().syncApply, false);
  assert.equal(cleanSettings(undefined).dailySync, false);
  assert.equal(cleanSettings({ dailySync: "yes", trackNetflix: 1 }).dailySync, false);
  assert.equal(cleanSettings({ dailySync: true, syncApply: true }).dailySync, true);
  assert.equal(cleanSettings({ dailySync: true, syncApply: true }).syncApply, true);
  const patched = applySettingsPatch(defaultSettings(), { dailySync: true, syncApply: true });
  assert.equal(patched.dailySync, true);
  assert.equal(patched.syncApply, true);
  assert.equal(applySettingsPatch(patched, { dailySync: "yes" }).dailySync, true, "non-boolean patches are ignored");
});

test("combined settings patches expand to the underlying switches", async () => {
  const { dailySyncMode, openEpisodes, notificationStyle, publicSettings, trackWhileWatching } = await import("../lib/settings.js");
  const preview = applySettingsPatch(defaultSettings(), { dailySyncMode: "preview" });
  assert.equal(preview.dailySync, true);
  assert.equal(preview.syncApply, false);
  assert.equal(dailySyncMode(preview), "preview");
  const apply = applySettingsPatch(preview, { dailySyncMode: "apply" });
  assert.equal(apply.syncApply, true);
  assert.equal(dailySyncMode(apply), "apply");
  const off = applySettingsPatch(apply, { dailySyncMode: "off" });
  assert.equal(off.dailySync, false);
  assert.equal(off.syncApply, false);

  const auto = applySettingsPatch(defaultSettings(), { openEpisodes: "tab-auto" });
  assert.equal(auto.openIn, "tab");
  assert.equal(auto.tabManage, true);
  assert.equal(auto.tabAuto, true);
  assert.equal(openEpisodes(auto), "tab-auto");
  assert.equal(openEpisodes(applySettingsPatch(auto, { openEpisodes: "new" })), "new");

  const silent = applySettingsPatch(defaultSettings(), { notificationStyle: "silent" });
  assert.equal(silent.episodeDialogs, false);
  assert.equal(silent.muteNotifications, false);
  assert.equal(notificationStyle(silent), "silent");
  assert.equal(notificationStyle(applySettingsPatch(silent, { notificationStyle: "off" })), "off");

  const tracking = applySettingsPatch(defaultSettings(), { trackWhileWatching: true, trackSites: ["netflix", "tubi"] });
  assert.equal(tracking.trackNetflix, true);
  assert.equal(tracking.trackTubi, true);
  assert.equal(tracking.trackHidive, false);
  assert.equal(trackWhileWatching(tracking), true);
  assert.equal(trackWhileWatching(applySettingsPatch(tracking, { trackWhileWatching: false })), false);

  const pub = publicSettings(applySettingsPatch(defaultSettings(), { whereFilterMode: "remember", lastWhereSite: "hidive" }));
  assert.equal(pub.whereFilterMode, "remember");
  assert.equal(pub.lastWhereSite, "hidive");
  assert.equal(pub.favoriteCharacterId, "");
  assert.equal("youtubeTitles" in defaultSettings(), false);
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

test("tracked sites need no earlier import, and an empty log just moves on", async () => {
  reset();
  signedIn();
  const result = await backgroundSync(["tubi"], { trigger: "tracking", apply: true });
  assert.equal(result.ran, true);
  assert.match(result.message, /^Tracking: Tubi: nothing new/);
  assert.equal(stored[KEYS.checkpoints]["tubi:main"].end, true);
  assert.equal(stored[KEYS.importDraft], undefined);
});
