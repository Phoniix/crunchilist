import assert from "node:assert/strict";
import test from "node:test";
import { KEYS } from "../lib/keys.js";
import { STORAGE_KEY } from "../lib/state.js";
import { mainVideo } from "../lib/watch-loop.js";

const stored = {};
const session = {};
const alarms = [];

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
      get: async (keys) => storageGet(session, keys),
      set: async (values) => Object.assign(session, values),
      remove: async (keys) => { for (const key of [].concat(keys)) delete session[key]; },
    },
  },
  alarms: {
    create: async (name, info = {}) => { alarms.push({ name, ...info }); },
    get: async () => undefined,
    clear: async () => {},
    getAll: async () => [],
    onAlarm: { addListener() {} },
  },
  permissions: {
    getAll: async () => ({
      origins: ["https://tubitv.com/*", "https://www.netflix.com/*", "https://www.hidive.com/*"],
      permissions: [],
    }),
    contains: async () => true,
    onAdded: { addListener() {} },
    onRemoved: { addListener() {} },
  },
  tabs: {
    get: async (id) => ({ id }),
    query: async () => [],
    sendMessage: async () => null,
    onRemoved: { addListener() {} },
    onUpdated: { addListener() {} },
  },
  scripting: {
    executeScript: async () => [],
    registerContentScripts: async () => {},
    unregisterContentScripts: async () => {},
    getRegisteredContentScripts: async () => [],
  },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
  webNavigation: {
    onBeforeNavigate: { addListener() {} },
    onCommitted: { addListener() {} },
    onErrorOccurred: { addListener() {} },
    onReferenceFragmentUpdated: { addListener() {} },
  },
};

const { handleImportMessage, onImportAlarm } = await import("../background/import-host.js");
const { backgroundSync } = await import("../background/importer.js");

const reset = () => {
  for (const key of Object.keys(stored)) delete stored[key];
  for (const key of Object.keys(session)) delete session[key];
  alarms.length = 0;
};

const withTracking = (patch = {}) => {
  stored[STORAGE_KEY] = {
    version: 2,
    settings: {
      trackTubi: true,
      trackNetflix: true,
      trackHidive: true,
      ...patch,
    },
  };
};

const tubiSender = {
  id: "ext-id",
  frameId: 0,
  url: "https://tubitv.com/tv-shows/319043/s01-e02-confrontation",
  tab: { id: 3 },
};

const animeItem = {
  id: "episode:319043",
  kind: "episode",
  series: "Death Note",
  season: 1,
  episode: 2,
  title: "Confrontation",
  anime: true,
};

test("mainVideo ignores short ads and picks the longest played video", () => {
  const doc = {
    querySelectorAll: () => [
      { duration: 30, currentTime: 30, played: { length: 1 } },
      { duration: 1400, currentTime: 1200, played: { length: 1 } },
      { duration: 600, currentTime: 10, played: { length: 0 } },
    ],
  };
  assert.equal(mainVideo(doc).duration, 1400);
  assert.equal(mainVideo({ querySelectorAll: () => [] }), null);
});

test("Tubi watched notes the episode and schedules the watch-track alarm", async () => {
  reset();
  withTracking();
  await handleImportMessage({ type: "watched", service: "tubi", item: animeItem }, tubiSender);
  const log = stored[KEYS.watchLog];
  assert.equal(log.length, 1);
  assert.equal(log[0].service, "tubi");
  assert.equal(log[0].series, "Death Note");
  assert.equal(log[0].episode, 2);
  assert.ok(alarms.some((alarm) => alarm.name === "ks-watch-track" && alarm.delayInMinutes === 1));
  assert.match(stored[KEYS.syncState].watch.tubi.note, /Death Note S1 E2 finished/);
});

test("Tubi tracking off ignores a finished episode", async () => {
  reset();
  withTracking({ trackTubi: false });
  await handleImportMessage({ type: "watched", service: "tubi", item: animeItem }, tubiSender);
  assert.equal(stored[KEYS.watchLog], undefined);
  assert.equal(alarms.length, 0);
});

test("non-anime Tubi finishes are noted but not logged for AniList", async () => {
  reset();
  withTracking();
  await handleImportMessage({
    type: "watched",
    service: "tubi",
    item: { ...animeItem, id: "movie:9", kind: "movie", series: "A Drama", episode: 1, anime: false },
  }, tubiSender);
  assert.equal(stored[KEYS.watchLog], undefined);
  assert.match(stored[KEYS.syncState].watch.tubi.note, /left out/);
  assert.equal(alarms.length, 0);
});

test("Netflix and HIDIVE watched signals schedule a history catch-up when tracking is on", async () => {
  reset();
  withTracking();
  await handleImportMessage(
    { type: "netflixWatched" },
    { id: "ext-id", frameId: 0, url: "https://www.netflix.com/watch/123", tab: { id: 1 } },
  );
  await handleImportMessage(
    { type: "hidiveWatched" },
    { id: "ext-id", frameId: 0, url: "https://www.hidive.com/stream/x", tab: { id: 2 } },
  );
  assert.ok(alarms.some((alarm) => alarm.name === "ks-track-netflix" && alarm.delayInMinutes === 2));
  assert.ok(alarms.some((alarm) => alarm.name === "ks-track-hidive" && alarm.delayInMinutes === 2));
});

test("Netflix watched does nothing when tracking is off", async () => {
  reset();
  withTracking({ trackNetflix: false });
  await handleImportMessage(
    { type: "netflixWatched" },
    { id: "ext-id", frameId: 0, url: "https://www.netflix.com/watch/123", tab: { id: 1 } },
  );
  assert.equal(alarms.length, 0);
});

test("a finished Tubi episode newer than the checkpoint is due for tracking", async () => {
  reset();
  withTracking();
  stored[KEYS.session] = { token: "t", viewer: { id: 1 } };
  stored[KEYS.checkpoints] = { "tubi:main": { newestAt: 1_000, newestKey: "old", end: true } };
  alarms.length = 0;
  await handleImportMessage({ type: "watched", service: "tubi", item: animeItem }, tubiSender);
  const row = stored[KEYS.watchLog][0];
  assert.ok(row.playedAt > stored[KEYS.checkpoints]["tubi:main"].newestAt);
  assert.ok(alarms.some((alarm) => alarm.name === "ks-watch-track"));
  // Tracked sites never require a prior import; preview/draft gates still hold.
  stored[KEYS.importPreview] = { id: "block", changes: [] };
  assert.deepEqual(await backgroundSync(["tubi"], { trigger: "tracking", apply: true }), { ran: false, why: "preview" });
});

test("watch-track alarm waits when an import preview is still open", async () => {
  reset();
  withTracking();
  stored[KEYS.session] = { token: "t", viewer: { id: 1 } };
  stored[KEYS.watchLog] = [{
    service: "tubi",
    itemId: "episode:2",
    series: "Death Note",
    seasonNumber: 1,
    episode: 3,
    kind: "episode",
    groupId: "season:deathnote:s1",
    seriesId: "deathnote",
    seasonId: "s1",
    season: "Season 1",
    playedAt: Date.now(),
    watched: true,
    key: "tubi:episode:2:now",
  }];
  stored[KEYS.importPreview] = { id: "block", changes: [] };
  const tracked = new Promise((resolve) => {
    const set = chrome.storage.local.set;
    chrome.storage.local.set = async (values) => {
      await set(values);
      if (values[KEYS.syncState]?.trackResult) resolve(values[KEYS.syncState].trackResult);
    };
  });
  onImportAlarm({ name: "ks-watch-track" });
  assert.match(await tracked, /preview|Waiting/i);
});
