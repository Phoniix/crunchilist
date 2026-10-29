import assert from "node:assert/strict";
import test from "node:test";
import { KEYS } from "../lib/keys.js";
import { matchKey } from "../lib/remembered.js";
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
    get: async (id) => ({ id, status: "complete", url: "https://www.netflix.com/" }),
    query: async () => [],
    sendMessage: async () => null,
    reload: async () => {},
    create: async () => ({ id: 99 }),
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

test("mainVideo accepts a lower floor for Netflix-length specials", () => {
  const doc = {
    querySelectorAll: () => [
      { duration: 45, currentTime: 45, played: { length: 1 } },
      { duration: 90, currentTime: 80, played: { length: 1 } },
    ],
  };
  assert.equal(mainVideo(doc), null);
  assert.equal(mainVideo(doc, { minSeconds: 61 }).duration, 90);
});

test("Netflix started bumps provisional Continue Watching without scheduling AniList catch-up", async () => {
  reset();
  withTracking();
  session[KEYS.netflixTab] = 1;
  stored[KEYS.matches] = {
    [matchKey("netflix", "death note", "s1")]: {
      anilistId: 1535,
      how: "auto",
      names: ["Death Note — Season 1"],
    },
  };
  stored.crCatalog = {
    items: [{ id: "GY35BM4", title: "Death Note", anilistId: 1535, url: "https://www.crunchyroll.com/series/GY35BM4", episodes: 37 }],
  };
  const send = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async (_tabId, message) => {
    if (message?.type === "netflixWatchNow") {
      return {
        ok: true,
        payload: {
          series: "Death Note",
          season: "Season 1",
          seasonNumber: 1,
          episode: 1,
          anime: true,
          title: "Death Note: Season 1: Rebirth",
        },
      };
    }
    return null;
  };
  try {
    await handleImportMessage(
      { type: "netflixStarted", videoId: "1", labels: ["Death Note: Season 1: Rebirth"] },
      { id: "ext-id", frameId: 0, url: "https://www.netflix.com/watch/1", tab: { id: 1 } },
    );
  } finally {
    chrome.tabs.sendMessage = send;
  }
  const activity = stored[KEYS.continueActivity];
  assert.equal(activity[0].id, "GY35BM4");
  assert.equal(activity[0].provisional, true);
  assert.equal(activity[0].service, "netflix");
  assert.equal(alarms.length, 0);
  assert.equal(stored[STORAGE_KEY].library["anilist:1535"].status, "in_progress");
  assert.ok(stored[STORAGE_KEY].library["anilist:1535"].lastWatchedAt > 0);
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
    { id: "ext-id", frameId: 0, url: "https://www.hidive.com/video/590403", tab: { id: 2 } },
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

test("Netflix watched bumps Continue Watching from activity then schedules AniList catch-up", async () => {
  reset();
  withTracking();
  session[KEYS.netflixTab] = 1;
  stored[KEYS.matches] = {
    [matchKey("netflix", "death note", "s1")]: {
      anilistId: 1535,
      how: "auto",
      confidence: "high",
      names: ["Death Note — Season 1"],
    },
  };
  stored.crCatalog = {
    items: [{ id: "GY35BM4", title: "Death Note", anilistId: 1535, url: "https://www.crunchyroll.com/series/GY35BM4", episodes: 37 }],
  };
  const send = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async (tabId, message) => {
    assert.equal(tabId, 1);
    if (message?.type === "netflixActivity") {
      return {
        ok: true,
        payload: {
          vhSize: 2,
          viewedItems: [
            {
              seriesTitle: "Death Note",
              series: 70143836,
              seasonDescriptor: "Season 1",
              episodeTitle: "Confrontation",
              movieID: 70157540,
              date: Date.now(),
              duration: 1400,
              bookmark: 0,
              genres: ["Anime Series"],
              title: "Death Note: Season 1: Confrontation",
            },
            {
              seriesTitle: "Death Note",
              series: 70143836,
              seasonDescriptor: "Season 1",
              episodeTitle: "Rebirth",
              movieID: 70157539,
              date: Date.now() - 86_400_000,
              duration: 1400,
              bookmark: 0,
              genres: ["Anime Series"],
              title: "Death Note: Season 1: Rebirth",
            },
          ],
        },
      };
    }
    return null;
  };
  try {
    await handleImportMessage(
      { type: "netflixWatched", videoId: "70157540" },
      { id: "ext-id", frameId: 0, url: "https://www.netflix.com/watch/70157540", tab: { id: 1 } },
    );
  } finally {
    chrome.tabs.sendMessage = send;
  }
  const activity = stored[KEYS.continueActivity];
  assert.ok(Array.isArray(activity) && activity.length >= 1);
  assert.equal(activity[0].id, "GY35BM4");
  assert.equal(activity[0].service, "netflix");
  assert.equal(activity[0].progress, 2);
  assert.equal(activity[0].next, 3);
  assert.equal(activity[0].anilistId, 1535);
  assert.ok(alarms.some((alarm) => alarm.name === "ks-track-netflix" && alarm.delayInMinutes === 2));
});

test("Netflix activity bump never promotes a different show still at the top of history", async () => {
  reset();
  withTracking();
  session[KEYS.netflixTab] = 1;
  stored[KEYS.matches] = {
    [matchKey("netflix", "reincarnated as a sword", "")]: {
      anilistId: 151807,
      how: "auto",
      names: ["Reincarnated as a Sword"],
    },
    [matchKey("netflix", "tetsuryo meet with tetsudou musume", "")]: {
      anilistId: 180000,
      how: "auto",
      names: ["TETSURYO! Meet with Tetsudou Musume"],
    },
  };
  stored.crCatalog = {
    items: [
      { id: "GSWORD", title: "Reincarnated as a Sword", anilistId: 151807, url: "https://www.crunchyroll.com/series/GSWORD", episodes: 12 },
      { id: "GTETSU", title: "TETSURYO! Meet with Tetsudou Musume", anilistId: 180000, url: "https://www.crunchyroll.com/series/GTETSU", episodes: 12 },
    ],
  };
  const send = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async (_tabId, message) => {
    if (message?.type === "netflixWatchNow") return { ok: true, payload: null };
    if (message?.type === "netflixActivity") {
      return {
        ok: true,
        payload: {
          vhSize: 2,
          viewedItems: [
            // Still the newest history row — must NOT become Continue Watching for a different /watch/id.
            {
              seriesTitle: "Reincarnated as a Sword",
              series: 1,
              seasonDescriptor: "Season 1",
              episodeTitle: "Episode 3",
              movieID: 111,
              date: Date.now(),
              duration: 1400,
              bookmark: 0,
              genres: ["Anime Series"],
              title: "Reincarnated as a Sword: Season 1: Episode 3",
            },
            {
              seriesTitle: "TETSURYO! Meet with Tetsudou Musume",
              series: 2,
              seasonDescriptor: "Season 1",
              episodeTitle: "Episode 1",
              movieID: 222,
              date: Date.now() - 60_000,
              duration: 1400,
              bookmark: 100,
              genres: ["Anime Series"],
              title: "TETSURYO! Meet with Tetsudou Musume: Season 1: Episode 1",
            },
          ],
        },
      };
    }
    return null;
  };
  try {
    await handleImportMessage(
      { type: "netflixStarted", videoId: "222", labels: [] },
      { id: "ext-id", frameId: 0, url: "https://www.netflix.com/watch/222", tab: { id: 1 } },
    );
  } finally {
    chrome.tabs.sendMessage = send;
  }
  const activity = stored[KEYS.continueActivity] || [];
  assert.ok(!activity.some((row) => row.anilistId === 151807 || /reincarnated/i.test(row.title || "")), "must not bump the previous history title");
  assert.ok(activity.some((row) => row.anilistId === 180000 || /tetsuryo/i.test(row.title || "")), "must bump the /watch/id being played");
});

test("HIDIVE history bump never promotes a different show still at the top of history", async () => {
  reset();
  withTracking();
  session[KEYS.hidiveTab] = 2;
  stored[KEYS.matches] = {
    [matchKey("hidive", "reincarnated as a sword", "s1")]: {
      anilistId: 151807,
      how: "auto",
      names: ["Reincarnated as a Sword"],
    },
    [matchKey("hidive", "tetsuryo meet with tetsudou musume", "s1")]: {
      anilistId: 180000,
      how: "auto",
      names: ["TETSURYO! Meet with Tetsudou Musume"],
    },
  };
  stored.crCatalog = {
    items: [
      { id: "GSWORD", title: "Reincarnated as a Sword", anilistId: 151807, url: "https://www.crunchyroll.com/series/GSWORD", episodes: 12 },
      { id: "GTETSU", title: "TETSURYO! Meet with Tetsudou Musume", anilistId: 180000, url: "https://www.crunchyroll.com/series/GTETSU", episodes: 12 },
    ],
  };
  const send = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async (_tabId, message) => {
    if (message?.type === "hidiveHistory") {
      return {
        ok: true,
        payload: {
          entries: [
            {
              id: "111",
              title: "Episode 3",
              series: "Reincarnated as a Sword",
              seasonTitle: "Season 1",
              season: 1,
              episode: 3,
              at: Date.now(),
              duration: 1400,
              position: null,
              episodic: true,
            },
            {
              id: "222",
              title: "Episode 1",
              series: "TETSURYO! Meet with Tetsudou Musume",
              seasonTitle: "Season 1",
              season: 1,
              episode: 1,
              at: Date.now() - 60_000,
              duration: 1400,
              position: 120,
              episodic: true,
            },
          ],
        },
      };
    }
    return null;
  };
  try {
    await handleImportMessage(
      { type: "hidiveStarted", videoId: "222", entry: null },
      { id: "ext-id", frameId: 0, url: "https://www.hidive.com/video/222", tab: { id: 2 } },
    );
  } finally {
    chrome.tabs.sendMessage = send;
  }
  const activity = stored[KEYS.continueActivity] || [];
  assert.ok(!activity.some((row) => row.anilistId === 151807 || /reincarnated/i.test(row.title || "")), "must not bump the previous HIDIVE history title");
  assert.ok(activity.some((row) => row.anilistId === 180000 || /tetsuryo/i.test(row.title || "")), "must bump the /video/id being played");
  assert.equal(activity[0]?.service, "hidive");
});

test("HIDIVE start with known videoId does not fall back to newest history when that id is missing", async () => {
  reset();
  withTracking();
  session[KEYS.hidiveTab] = 2;
  stored[KEYS.matches] = {
    [matchKey("hidive", "reincarnated as a sword", "s1")]: {
      anilistId: 151807,
      how: "auto",
      names: ["Reincarnated as a Sword"],
    },
  };
  stored.crCatalog = {
    items: [
      { id: "GSWORD", title: "Reincarnated as a Sword", anilistId: 151807, url: "https://www.crunchyroll.com/series/GSWORD", episodes: 12 },
    ],
  };
  const send = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async (_tabId, message) => {
    if (message?.type === "hidiveHistory") {
      return {
        ok: true,
        payload: {
          entries: [{
            id: "111",
            title: "Episode 3",
            series: "Reincarnated as a Sword",
            seasonTitle: "Season 1",
            season: 1,
            episode: 3,
            at: Date.now(),
            duration: 1400,
            position: null,
            episodic: true,
          }],
        },
      };
    }
    return null;
  };
  const wait = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => wait(fn, ms === 2500 ? 0 : ms, ...args);
  try {
    await handleImportMessage(
      { type: "hidiveStarted", videoId: "222", entry: null },
      { id: "ext-id", frameId: 0, url: "https://www.hidive.com/video/222", tab: { id: 2 } },
    );
  } finally {
    globalThis.setTimeout = wait;
    chrome.tabs.sendMessage = send;
  }
  const activity = stored[KEYS.continueActivity] || [];
  assert.equal(activity.length, 0, "missing /video/id must not promote another history title");
});

test("Netflix Continue Watching counts series episodes across activity pages", async () => {
  // Page 0 only has the two browser finishes; phone watches of eps 1–2 sit on page 1.
  // Old code numbered page-0 rows as 1..2 and stuck progress at 2.
  reset();
  withTracking();
  session[KEYS.netflixTab] = 1;
  stored[KEYS.matches] = {
    [matchKey("netflix", "love through a prism", "s1")]: {
      anilistId: 999001,
      how: "auto",
      confidence: "high",
      names: ["Love Through a Prism — Season 1"],
    },
  };
  stored.crCatalog = {
    items: [{ id: "GPRISM", title: "Love Through a Prism", anilistId: 999001, url: "https://www.crunchyroll.com/series/GPRISM", episodes: 12 }],
  };
  stored[KEYS.continueActivity] = [{
    id: "GPRISM",
    title: "Love Through a Prism",
    progress: 2,
    next: 3,
    episodes: 12,
    service: "netflix",
    at: Date.now() - 1000,
    anilistId: 999001,
  }];
  const series = 800001;
  const send = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async (_tabId, message) => {
    if (message?.type !== "netflixActivity") return null;
    const page = Number(message.page) || 0;
    if (page === 0) {
      return {
        ok: true,
        payload: {
          vhSize: 4,
          viewedItems: [
            {
              seriesTitle: "Love Through a Prism",
              series,
              seasonDescriptor: "Season 1",
              episodeTitle: "Episode 4",
              movieID: 104,
              date: Date.now(),
              duration: 1400,
              bookmark: 0,
              genres: ["Anime Series"],
              title: "Love Through a Prism: Season 1: Episode 4",
            },
            {
              seriesTitle: "Love Through a Prism",
              series,
              seasonDescriptor: "Season 1",
              episodeTitle: "Episode 3",
              movieID: 103,
              date: Date.now() - 3600_000,
              duration: 1400,
              bookmark: 0,
              genres: ["Anime Series"],
              title: "Love Through a Prism: Season 1: Episode 3",
            },
          ],
        },
      };
    }
    if (page === 1) {
      return {
        ok: true,
        payload: {
          vhSize: 4,
          viewedItems: [
            {
              seriesTitle: "Love Through a Prism",
              series,
              seasonDescriptor: "Season 1",
              episodeTitle: "Episode 2",
              movieID: 102,
              date: Date.now() - 86_400_000,
              duration: 1400,
              bookmark: 0,
              genres: ["Anime Series"],
              title: "Love Through a Prism: Season 1: Episode 2",
            },
            {
              seriesTitle: "Love Through a Prism",
              series,
              seasonDescriptor: "Season 1",
              episodeTitle: "Episode 1",
              movieID: 101,
              date: Date.now() - 172_800_000,
              duration: 1400,
              bookmark: 0,
              genres: ["Anime Series"],
              title: "Love Through a Prism: Season 1: Episode 1",
            },
          ],
        },
      };
    }
    return { ok: true, payload: { vhSize: 4, viewedItems: [] } };
  };
  try {
    await handleImportMessage(
      { type: "netflixWatched", videoId: "104" },
      { id: "ext-id", frameId: 0, url: "https://www.netflix.com/watch/104", tab: { id: 1 } },
    );
  } finally {
    chrome.tabs.sendMessage = send;
  }
  assert.equal(stored[KEYS.continueActivity][0].progress, 4);
  assert.equal(stored[KEYS.continueActivity][0].next, 5);
});

test("Netflix Continue Watching bump never regresses when activity page undercounts", async () => {
  reset();
  withTracking();
  session[KEYS.netflixTab] = 1;
  stored[STORAGE_KEY] = {
    ...stored[STORAGE_KEY],
    library: {
      "anilist:1535": {
        key: "anilist:1535",
        anilistId: 1535,
        title: "Death Note",
        status: "in_progress",
        progress: 11,
        episodes: 37,
        dirty: false,
        removed: false,
      },
    },
  };
  stored[KEYS.matches] = {
    [matchKey("netflix", "death note", "s1")]: { anilistId: 1535, how: "auto", names: ["Death Note — Season 1"] },
  };
  stored[KEYS.continueActivity] = [{
    id: "G4",
    title: "Death Note",
    progress: 11,
    next: 12,
    episodes: 37,
    service: "netflix",
    at: Date.now() - 1000,
    anilistId: 1535,
  }];
  const send = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async () => ({
    ok: true,
    payload: {
      vhSize: 1,
      viewedItems: [{
        seriesTitle: "Death Note",
        series: 70143836,
        seasonDescriptor: "Season 1",
        episodeTitle: "Love",
        movieID: 99,
        date: Date.now(),
        duration: 1400,
        bookmark: 0,
        genres: ["Anime Series"],
        title: "Death Note: Season 1: Love",
      }],
    },
  });
  try {
    await handleImportMessage(
      { type: "netflixWatched" },
      { id: "ext-id", frameId: 0, url: "https://www.netflix.com/watch/99", tab: { id: 1 } },
    );
  } finally {
    chrome.tabs.sendMessage = send;
  }
  assert.equal(stored[KEYS.continueActivity][0].progress, 11);
  assert.equal(stored[STORAGE_KEY].library["anilist:1535"].progress, 11);
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
