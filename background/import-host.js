// Import / daily sync / as-you-watch tracking / site hello handlers absorbed from Crunchilist Search.
import { BACKUP_KEYS, diagnostics, makeBackup, readBackup } from "../lib/backup.js";
import { SITE_DATA_KEYS, forgetNote, forgetSite } from "../lib/forget-site.js";
import { KEYS } from "../lib/keys.js";
import { publicSession } from "../lib/anilist-auth.js";
import { LIST_SOURCES } from "../lib/list-import.js";
import { anilistSession } from "../lib/settings.js";
import { SERVICES, connectedIds, contentScriptsFor, onService, returnNote, serviceById } from "../lib/services.js";
import { cleanKitsuLink, publicKitsuLink } from "../lib/trackers.js";
import { hidiveEntries, hidiveEntryFinished } from "../lib/hidive-history.js";
import { groupNetflix, parseActivity, splitPlayerTitle, usablePlayerSeries } from "../lib/netflix-history.js";
import { TRACKED, TRACK_SETTING, addToLog, cleanItem, itemText } from "../lib/watch-tracking.js";
import { titleReadiness } from "../lib/title-api.js";
import { watchActivity } from "./activity.js";
import { clearActivityLog, exportActivityText, listActivity, noteActivity } from "./app-notices.js";
import { appData } from "./app-data.js";
import { expireProvisionalContinueActivity, noteContinueFromTrackedPlay } from "./continue-activity.js";
import { sendWatchGuide } from "./watch-guide.js";
import { checkShowLinks } from "./dead-links.js";
import { idMapStatus } from "./id-map-store.js";
import { loadCatalogs, readCatalogs } from "./catalog-reader.js";
import {
  applyImport, backgroundSync, cancelImport, dismissImport, importBusy, importKitsu, importMalFile,
  importNetflixCsv, importStatus, resolvePending, saveCrunchyrollToken, startImport, startImportAll, undoImport,
} from "./importer.js";
import { connectMal, disconnectMal, malStatus, setMalClientId } from "./mal-store.js";
import { grantedOrigins, syncSiteScripts } from "./site-scripts.js";
import { loadState } from "./store.js";
import { runTrackerPull } from "./tracker-pull.js";
import { whereMapStatus } from "./where-map-store.js";

const SYNC_EVERY_MS = 20 * 60 * 60 * 1000;
const SYNC_ALARM = "ks-daily-sync";
const SYNC_SOON_ALARM = "ks-sync-soon";
const TRACK_ALARM = "ks-track-netflix";
const TRACK_HIDIVE_ALARM = "ks-track-hidive";
const WATCH_ALARM = "ks-watch-track";
const CATALOG_ALARM = "ks-catalogs";
const TRACKER_ALARM = "ks-tracker-pull";
const CW_EXPIRE_ALARM = "ks-cw-expire";
const TRACK_DELAY_MIN = 2;
const TRACK_RETRY_MIN = 1;
const TRACK_TRIES = 4;
const WATCH_DELAY_MIN = 1;

const SITE_TABS = { netflix: KEYS.netflixTab, prime: KEYS.primeTab, hidive: KEYS.hidiveTab, tubi: KEYS.tubiTab };
const HISTORY_TRACKING = {
  netflix: { alarm: TRACK_ALARM, setting: "trackNetflix" },
  hidive: { alarm: TRACK_HIDIVE_ALARM, setting: "trackHidive" },
};

const WAITING = {
  busy: "Waiting for the current import to finish.",
  preview: "Waiting: apply or dismiss the preview in Import first.",
  draft: "Waiting: an import was stopped partway. Run it again from Import to finish it.",
};

async function loadImportSettings() {
  const state = await loadState();
  const s = state.settings || {};
  const dailySync = Boolean(s.dailySync);
  const syncApply = Boolean(s.syncApply);
  const trackNetflix = Boolean(s.trackNetflix);
  const trackTubi = Boolean(s.trackTubi);
  const trackHidive = Boolean(s.trackHidive);
  return {
    hiddenSites: s.hiddenSites || [],
    readCatalogs: s.readCatalogs !== false,
    hideOffSiteShows: s.hideOffSiteShows !== false,
    dailySync,
    syncApply,
    dailySyncMode: !dailySync ? "off" : syncApply ? "apply" : "preview",
    trackNetflix,
    trackTubi,
    trackHidive,
    trackWhileWatching: trackNetflix || trackTubi || trackHidive,
    weeklyTrackerPull: s.weeklyTrackerPull !== false,
    writeMal: s.writeMal !== false,
  };
}

async function loadSync() {
  return (await chrome.storage.local.get(KEYS.syncState))[KEYS.syncState] || { sites: {}, lastRun: 0, lastResult: "" };
}

async function openedTabs() {
  return (await chrome.storage.session.get(KEYS.openedTabs))[KEYS.openedTabs] || {};
}

async function openPurposes() {
  return (await chrome.storage.session.get(KEYS.openPurpose))[KEYS.openPurpose] || {};
}

async function forgetTab(tabId) {
  const tabs = await openedTabs();
  const purposes = await openPurposes();
  if (!(tabId in tabs) && !(tabId in purposes)) return;
  delete tabs[tabId];
  delete purposes[tabId];
  await chrome.storage.session.set({ [KEYS.openedTabs]: tabs, [KEYS.openPurpose]: purposes });
}

async function siteReady(id) {
  if (id === "crunchyroll") {
    const auth = (await chrome.storage.session.get(KEYS.crunchyrollAuth))[KEYS.crunchyrollAuth];
    if (auth?.token) return true;
    const { crCatalogToken } = await chrome.storage.session.get("crCatalogToken");
    return typeof crCatalogToken === "string" && crCatalogToken.length >= 20;
  }
  const tabId = SITE_TABS[id] ? (await chrome.storage.session.get(SITE_TABS[id]))[SITE_TABS[id]] : null;
  return tabId != null && Boolean(await chrome.tabs.get(tabId).catch(() => null));
}

async function waitSiteReady(id, { tries = 40, ms = 500 } = {}) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (await siteReady(id)) return true;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
  return siteReady(id);
}

export async function importAllNeeds() {
  const connected = connectedIds(await grantedOrigins());
  connected.push("crunchyroll");
  const sites = SERVICES.filter((service) => service.imports && connected.includes(service.id)).map((service) => service.id);
  const missing = [];
  for (const id of sites) if (!(await siteReady(id))) missing.push(id);
  return { sites, missing };
}

export async function openSites({ services }) {
  const connected = new Set(connectedIds(await grantedOrigins()));
  connected.add("crunchyroll");
  const ids = (Array.isArray(services) ? services : []).map(String).filter((id) => serviceById(id) && connected.has(id));
  await syncSiteScripts();
  const tabIds = [];
  for (const id of ids) {
    const tab = await chrome.tabs.create({ url: serviceById(id).home, active: false });
    if (tab?.id != null) tabIds.push(tab.id);
  }
  return { opened: ids, tabIds };
}

export async function closeTabs({ tabIds } = {}) {
  const ids = [...new Set((Array.isArray(tabIds) ? tabIds : []).map(Number).filter((id) => id > 0))];
  let closed = 0;
  for (const id of ids) {
    try {
      await chrome.tabs.remove(id);
      closed += 1;
    } catch {
      /* tab already gone */
    }
  }
  return { closed, requested: ids.length };
}

async function openSite({ service: id, purpose = "" }) {
  const service = serviceById(String(id || ""));
  if (!service) throw new Error("That service isn't known.");
  const connected = new Set(connectedIds(await grantedOrigins()));
  connected.add("crunchyroll");
  if (!connected.has(service.id)) throw new Error(`Connect ${service.name} first.`);
  await syncSiteScripts();
  const tab = await chrome.tabs.create({ url: service.home, active: true });
  const patch = { [KEYS.openedTabs]: { ...(await openedTabs()), [tab.id]: service.id } };
  if (purpose === "catalog") {
    patch[KEYS.openPurpose] = { ...(await openPurposes()), [tab.id]: "catalog" };
    patch[KEYS.pendingCatalog] = service.id;
  }
  await chrome.storage.session.set(patch);
  return { opened: service.id, purpose: purpose || "" };
}

export async function syncSoon() {
  if (!(await loadImportSettings()).dailySync || (await chrome.alarms.get(SYNC_SOON_ALARM))) return;
  await chrome.alarms.create(SYNC_SOON_ALARM, { delayInMinutes: 1 });
}

export async function catalogSoon() {
  if (!(await loadImportSettings()).readCatalogs || (await chrome.alarms.get(CATALOG_ALARM))) return;
  await chrome.alarms.create(CATALOG_ALARM, { delayInMinutes: 1 });
}

async function runDailySync() {
  const settings = await loadImportSettings();
  if (!settings.dailySync) return;
  const state = await loadSync();
  const due = [];
  for (const id of (await importAllNeeds()).sites) {
    if (Date.now() - (state.sites?.[id] || 0) >= SYNC_EVERY_MS && (await siteReady(id))) due.push(id);
  }
  if (!due.length) return;
  const result = await backgroundSync(due, { trigger: "daily", apply: settings.syncApply }).catch((error) => ({ ran: false, why: "", message: error.message }));
  const latest = await loadSync();
  if (!result.ran) {
    await chrome.storage.local.set({ [KEYS.syncState]: { ...latest, lastResult: WAITING[result.why] || result.message || latest.lastResult } });
    return;
  }
  const sites = { ...latest.sites, ...Object.fromEntries(result.attempted.map((id) => [id, Date.now()])) };
  await chrome.storage.local.set({ [KEYS.syncState]: { ...latest, sites, lastRun: Date.now(), lastResult: result.message } });
}

async function trackHistory(id, tries = 0) {
  await chrome.storage.session.set({ [`ksTrackTries-${id}`]: tries });
  await chrome.alarms.create(HISTORY_TRACKING[id].alarm, { delayInMinutes: tries ? TRACK_RETRY_MIN : TRACK_DELAY_MIN });
}

async function runTracking(id) {
  const settings = await loadImportSettings();
  const connected = new Set(connectedIds(await grantedOrigins()));
  connected.add("crunchyroll");
  if (!settings[HISTORY_TRACKING[id].setting] || !connected.has(id)) return;
  const triesKey = `ksTrackTries-${id}`;
  const tries = (await chrome.storage.session.get(triesKey))[triesKey] || 0;
  const result = await backgroundSync([id], { trigger: "tracking", apply: true }).catch((error) => ({ ran: false, why: "", message: error.message }));
  const retry = result.ran ? /nothing new/i.test(result.message) : result.why === "busy";
  if (retry && tries + 1 < TRACK_TRIES) await trackHistory(id, tries + 1);
  await chrome.storage.local.set({ [KEYS.syncState]: { ...(await loadSync()), lastTrack: Date.now(), trackResult: result.ran ? result.message : WAITING[result.why] || result.message || "" } });
}

async function askSiteTab(id, message, preferTabId = null) {
  const key = SITE_TABS[id];
  if (!key) return null;
  const stored = (await chrome.storage.session.get(key))[key];
  const tabId = preferTabId != null ? preferTabId : stored;
  if (tabId == null) return null;
  const reply = await chrome.tabs.sendMessage(tabId, message).catch(() => null);
  if (reply?.ok) return reply.payload ?? reply;
  // Watch tab may differ from the last hello tab — fall back to the remembered one.
  if (preferTabId != null && stored != null && stored !== preferTabId) {
    const again = await chrome.tabs.sendMessage(stored, message).catch(() => null);
    return again?.ok ? again.payload ?? again : null;
  }
  return null;
}

function metaFromLabels(labels = []) {
  const list = (Array.isArray(labels) ? labels : []).map((label) => String(label || "").trim()).filter(Boolean);
  // Prefer "Show: …" lines — a single bare token is often the episode title, not the series.
  const ordered = [
    ...list.filter((label) => label.includes(": ")),
    ...list.filter((label) => !label.includes(": ")),
  ];
  for (const label of ordered) {
    const split = splitPlayerTitle(label);
    // Bare single-token labels are last-resort only and still need usablePlayerSeries.
    if (!split?.series) continue;
    if (!label.includes(": ") && ordered.some((row) => row.includes(": "))) continue;
    return {
      series: split.series,
      season: split.season || "",
      seasonNumber: split.seasonNumber,
      episode: 1,
      anime: null,
      title: label,
    };
  }
  return null;
}

async function bumpFromNetflixMeta(meta, { provisional }) {
  const series = usablePlayerSeries(meta?.series);
  if (!series || meta.anime === false) return null;
  return noteContinueFromTrackedPlay({
    service: "netflix",
    series,
    season: meta.season || "",
    seasonNumber: meta.seasonNumber,
    episode: Math.max(1, Number(meta.episode) || 1),
    provisional,
  });
}

// Activity page 0 is only ~50 rows. Phone watches of the same show often sit on later pages;
// numbering 1..n inside a short page-0 window undercounts (e.g. browser eps 3–4 look like 1–2).
const NETFLIX_ACTIVITY_PAGES = 6;

// Track-while-watching rule (Netflix + HIDIVE): when the player URL names a video id, history may
// only bump that title (or its series group). Never promote whatever is still sitting at the top.
function netflixVideoId(videoId) {
  const raw = String(videoId || "").trim();
  return /^\d+$/.test(raw) ? Number(raw) : NaN;
}

async function bumpFromNetflixActivity({ provisional, videoId, tabId }) {
  const wanted = netflixVideoId(videoId);
  const collected = [];
  let seriesId = null;
  let seen = 0;
  let foundWanted = !Number.isInteger(wanted);

  for (let page = 0; page < NETFLIX_ACTIVITY_PAGES; page += 1) {
    const payload = await askSiteTab("netflix", { type: "netflixActivity", page }, tabId);
    if (!payload) break;
    const pageItems = Array.isArray(payload.viewedItems) ? payload.viewedItems : [];
    if (!pageItems.length) break;

    if (Number.isInteger(wanted) && seriesId == null) {
      const hit = pageItems.find((row) => row?.movieID === wanted);
      if (!hit) {
        // Current /watch/id should be on page 0; don't scan the whole history for a stale id.
        if (page === 0) return null;
        break;
      }
      seriesId = hit.series;
      foundWanted = true;
    }

    collected.push(...pageItems);
    const parsed = parseActivity(payload, seen);
    seen += pageItems.length;
    if (!parsed.more) break;
  }

  if (Number.isInteger(wanted) && !foundWanted) return null;

  // Keep the whole series so groupNetflix can number episodes across devices; drop every other show.
  let items = collected;
  if (seriesId != null) items = collected.filter((row) => row?.series === seriesId);
  else if (Number.isInteger(wanted)) items = collected.filter((row) => row?.movieID === wanted);
  if (!items.length) return null;

  // Player already crossed FINISHED for this videoId — bookmark may still look mid-episode.
  if (!provisional && Number.isInteger(wanted)) {
    items = items.map((item) => (item?.movieID === wanted ? { ...item, bookmark: 0 } : item));
  }

  const { rows } = parseActivity({ viewedItems: items, vhSize: items.length }, 0);
  // Starts: count in-progress rows. Finishes: force the just-finished movieID watched (bookmark lag).
  const ranked = rows.map((row) => {
    if (provisional) return { ...row, watched: true };
    if (Number.isInteger(wanted) && String(row.key || "").startsWith(`${wanted}:`)) return { ...row, watched: true };
    return row;
  });
  const all = ranked.length ? groupNetflix(ranked) : [];
  const groups = all.filter((group) => group.anime !== false && group.episodes?.length);
  const newest = groups.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))[0];
  if (!newest) return null;
  return noteContinueFromTrackedPlay({
    service: "netflix",
    series: newest.series,
    season: newest.season || "",
    seasonNumber: newest.seasonNumber,
    episode: Math.max(...newest.episodes),
    provisional,
  });
}

// Speeds Continue Watching from Netflix; provisional start names the /watch/{id} title (activity often lags).
async function bumpContinueFromNetflix({ provisional = false, videoId = "", labels = [], tabId = null } = {}) {
  const tryBump = async () => {
    const fromLabels = () => bumpFromNetflixMeta(metaFromLabels(labels), { provisional });
    const fromWatchNow = async () => {
      if (!videoId) return null;
      const meta = await askSiteTab("netflix", { type: "netflixWatchNow", videoId, labels }, tabId);
      return bumpFromNetflixMeta(meta, { provisional });
    };
    const fromActivity = () => bumpFromNetflixActivity({ provisional, videoId, tabId });
    // Prefer Netflix APIs (seriesTitle) over page labels — mediaSession.title is often only the episode name.
    // Finishes: activity only (watchNow/labels hardcode episode:1 and would fake a successful undercount).
    // Starts: watchNow, then activity, labels last.
    const order = provisional
      ? [fromWatchNow, fromActivity, fromLabels]
      : [fromActivity];
    for (const step of order) {
      const row = await step().catch(() => null);
      if (row) return row;
    }
    return null;
  };
  const hasTab = tabId != null || (await chrome.storage.session.get(KEYS.netflixTab))[KEYS.netflixTab] != null;
  const first = await tryBump();
  if (provisional) {
    if (first) return first;
    if (!hasTab) return null;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    return (await tryBump()) || null;
  }
  // Finishes: bump now when activity is ready; one delayed retry can raise an undercount (Math.max in noteContinue).
  if (first) {
    if (hasTab) {
      const retry = setTimeout(() => {
        tryBump().catch(() => {});
      }, 2500);
      retry.unref?.();
    }
    return first;
  }
  // No video id → nothing useful to retry; history catch-up still runs from the handler.
  if (!hasTab || !Number.isInteger(netflixVideoId(videoId))) return null;
  await new Promise((resolve) => setTimeout(resolve, 2500));
  return (await tryBump()) || null;
}

function pickHidiveHistoryEntry(entries, { videoId = "", provisional = false } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const wanted = String(videoId || "");
  if (wanted) {
    const hit = list.find((row) => String(row.id) === wanted) || null;
    if (!hit) return null;
    if (!provisional && !hidiveEntryFinished(hit)) return null;
    return hit;
  }
  // No /video/{id} on the message: last-resort newest (start) or newest finished (watch).
  return provisional ? (list[0] || null) : (list.find((row) => hidiveEntryFinished(row)) || null);
}

async function bumpContinueFromHidive({ hint = null, videoId = "", provisional = false } = {}) {
  const tryBump = async () => {
    if (hint?.series && hint.episode) {
      return noteContinueFromTrackedPlay({
        service: "hidive",
        series: hint.series,
        season: hint.season || "",
        seasonNumber: hint.seasonNumber,
        episode: hint.episode,
        provisional,
      });
    }
    const payload = await askSiteTab("hidive", { type: "hidiveHistory", page: 1 });
    const entries = Array.isArray(payload?.entries) ? payload.entries : hidiveEntries(payload);
    const entry = pickHidiveHistoryEntry(entries, { videoId, provisional });
    if (!entry) return null;
    return noteContinueFromTrackedPlay({
      service: "hidive",
      series: entry.series || entry.title,
      season: entry.seasonTitle || "",
      seasonNumber: entry.season,
      episode: entry.episode || 1,
      provisional,
    });
  };
  // Early starts often beat HIDIVE writing history — retry once. Finishes still get the track alarm.
  const first = await tryBump();
  if (first) return first;
  if (!provisional) return null;
  await new Promise((resolve) => setTimeout(resolve, 2500));
  return (await tryBump()) || null;
}

async function noteWatchedStart({ service: id, item }, sender) {
  const service = serviceById(String(id || ""));
  if (!service || !TRACKED.includes(service.id) || sender?.id !== chrome.runtime.id || sender.frameId !== 0 || !onService(service, sender.url)) return {};
  if (!(await loadImportSettings())[TRACK_SETTING[service.id]]) return {};
  const clean = cleanItem(item);
  if (!clean || clean.anime === false) return {};
  const bumped = await noteContinueFromTrackedPlay({
    service: service.id,
    series: clean.series,
    season: clean.season ? `Season ${clean.season}` : "",
    seasonNumber: clean.season,
    episode: clean.episode,
    provisional: true,
  }).catch(() => null);
  if (bumped) {
    sendWatchGuide(sender.tab?.id, {
      kind: "tracked",
      title: bumped.title || clean.series,
      episode: clean.episode,
      service: service.id,
    }).catch(() => {});
  }
  return {};
}

async function noteWatched({ service: id, item, miss }, sender) {
  const service = serviceById(String(id || ""));
  if (!service || !TRACKED.includes(service.id) || sender?.id !== chrome.runtime.id || sender.frameId !== 0 || !onService(service, sender.url)) return {};
  if (!(await loadImportSettings())[TRACK_SETTING[service.id]]) return {};
  const clean = cleanItem(item);
  let note;
  if (!clean) note = `Something finished, but it couldn't be told which episode: ${String(miss || "no title on the page").slice(0, 200)}.`;
  else if (clean.anime === false) note = `${itemText(clean)} finished. ${service.name} doesn't file it under anime, so it was left out.`;
  else {
    const { log, added } = addToLog((await chrome.storage.local.get(KEYS.watchLog))[KEYS.watchLog], service.id, clean, Date.now());
    if (added) {
      await chrome.storage.local.set({ [KEYS.watchLog]: log });
      await chrome.alarms.create(WATCH_ALARM, { delayInMinutes: WATCH_DELAY_MIN });
      const bumped = await noteContinueFromTrackedPlay({
        service: service.id,
        series: clean.series,
        season: clean.season ? `Season ${clean.season}` : "",
        seasonNumber: clean.season,
        episode: clean.episode,
        provisional: false,
      }).catch(() => null);
      if (bumped) {
        sendWatchGuide(sender.tab?.id, {
          kind: "watched",
          title: bumped.title || clean.series,
          episode: clean.episode,
          service: service.id,
        }).catch(() => {});
      }
    }
    note = added ? `${itemText(clean)} finished.` : `${itemText(clean)} finished again; already noted.`;
  }
  const state = await loadSync();
  await chrome.storage.local.set({ [KEYS.syncState]: { ...state, watch: { ...state.watch, [service.id]: { at: Date.now(), note } } } });
  return {};
}

async function watchDue() {
  const settings = await loadImportSettings();
  const connected = new Set(connectedIds(await grantedOrigins()));
  const { [KEYS.watchLog]: log = [], [KEYS.checkpoints]: points = {} } = await chrome.storage.local.get([KEYS.watchLog, KEYS.checkpoints]);
  return TRACKED.filter((id) => settings[TRACK_SETTING[id]] && connected.has(id)
    && (Array.isArray(log) ? log : []).some((row) => row?.service === id && row.playedAt > (points[`${id}:main`]?.newestAt || 0)));
}

async function runWatchTracking() {
  const due = await watchDue();
  if (!due.length) return;
  const result = await backgroundSync(due, { trigger: "tracking", apply: true }).catch((error) => ({ ran: false, why: "", message: error.message }));
  if (!result.ran && result.why === "busy") await chrome.alarms.create(WATCH_ALARM, { delayInMinutes: TRACK_RETRY_MIN });
  await chrome.storage.local.set({ [KEYS.syncState]: { ...(await loadSync()), lastTrack: Date.now(), trackResult: result.ran ? result.message : WAITING[result.why] || result.message || "" } });
}

async function readyCatalogs() {
  const connected = new Set(connectedIds(await grantedOrigins()));
  connected.add("crunchyroll");
  const ready = [];
  for (const id of ["crunchyroll", "hidive", "tubi", "netflix"]) if (connected.has(id) && (await siteReady(id))) ready.push(id);
  return ready;
}

async function runCatalogs() {
  if (!(await loadImportSettings()).readCatalogs) return;
  await readCatalogs(await readyCatalogs());
}

async function rememberTab(id, key, sender) {
  if (sender?.id === chrome.runtime.id && onService(serviceById(id), sender.url) && sender.tab?.id != null && sender.frameId === 0) {
    await chrome.storage.session.set({ [key]: sender.tab.id });
  }
  return {};
}

const onSite = (sender, origin) => String(sender?.url || "").startsWith(origin) && sender?.id === chrome.runtime.id;

async function openedFor(sender) {
  if (sender?.id !== chrome.runtime.id || sender.tab?.id == null || sender.frameId !== 0) return null;
  const service = serviceById((await openedTabs())[sender.tab.id]);
  return service && onService(service, sender.url) ? service : null;
}

async function loadKitsuLink() {
  return cleanKitsuLink((await chrome.storage.local.get(KEYS.kitsuLink))[KEYS.kitsuLink]);
}

export async function importSnapshot() {
  const [imp, settings, sync, mal, kitsu, catalogs, connected, state] = await Promise.all([
    importStatus(),
    loadImportSettings(),
    loadSync(),
    malStatus(),
    loadKitsuLink(),
    loadCatalogs(),
    grantedOrigins().then(connectedIds),
    loadState(),
  ]);
  if (!connected.includes("crunchyroll")) connected.push("crunchyroll");
  const anilist = anilistSession(state.settings);
  return {
    ...imp,
    settings,
    sync,
    mal,
    kitsu: publicKitsuLink(kitsu),
    catalogs,
    connected,
    listSources: LIST_SOURCES,
    // Prefer live AniList session so Import doesn't stay gated on a stale Prism view.
    anilistConnected: Boolean(anilist.connected),
  };
}

async function buildDiagnostics({ userAgent }) {
  const [snap, granted, idMap, whereMap, session, state] = await Promise.all([
    importSnapshot(),
    grantedOrigins(),
    idMapStatus(),
    whereMapStatus(),
    chrome.storage.local.get(KEYS.session).then((row) => row[KEYS.session]),
    loadState(),
  ]);
  const now = Date.now();
  const main = anilistSession(state.settings, now);
  const mirrored = publicSession(session, now);
  const anilist = mirrored.connected || mirrored.expired
    ? mirrored
    : { connected: main.connected, expired: main.expired, name: main.viewerName || "", avatar: "", renewSoon: false };
  const title = titleReadiness({
    idMap,
    whereMap,
    catalogs: snap.catalogs || {},
    connected: snap.connected || [],
  });
  const imp = await importStatus();
  const { [KEYS.importLog]: log = [], [KEYS.checkpoints]: checkpoints = {} } = await chrome.storage.local.get([KEYS.importLog, KEYS.checkpoints]);
  return {
    text: diagnostics({
      version: chrome.runtime.getManifest().version,
      userAgent: String(userAgent || "").slice(0, 300),
      connected: snap.connected || [],
      anilist,
      mal: snap.mal,
      kitsu: snap.kitsu,
      idMap,
      whereMap,
      settings: snap.settings,
      job: imp.job,
      log,
      checkpoints,
      pendingCount: imp.pendingCount,
      granted,
      catalogs: snap.catalogs || {},
      title,
    }),
  };
}

export async function forgetSiteData({ service: id }) {
  const service = serviceById(String(id || ""));
  if (!service) throw new Error("Unknown site.");
  if (importBusy()) throw new Error("Wait for the current import to finish, then try again.");
  const plan = forgetSite(await chrome.storage.local.get(SITE_DATA_KEYS), service.id);
  if (plan.blocked) throw new Error(plan.blocked);
  if (Object.keys(plan.set).length) await chrome.storage.local.set(plan.set);
  if (plan.remove.length) await chrome.storage.local.remove(plan.remove);
  if (plan.remove.includes(KEYS.importPreview)) await chrome.action.setBadgeText({ text: "" }).catch(() => {});
  const session = [SITE_TABS[service.id], service.id === "crunchyroll" && KEYS.crunchyrollAuth].filter(Boolean);
  if (session.length) await chrome.storage.session.remove(session);
  return { note: forgetNote(service.name, plan.counts) };
}

const pageHandlers = {
  importStatus: async () => importSnapshot(),
  startImport: async ({ service, full }) => {
    await startImport({ service: String(service || ""), full: Boolean(full) });
    return importSnapshot();
  },
  startImportAll: async () => {
    await startImportAll();
    return importSnapshot();
  },
  importAllNeeds,
  openSites,
  closeTabs,
  openSite: async (message) => openSite(message),
  importNetflixCsv: async ({ text }) => { await importNetflixCsv(text); return importSnapshot(); },
  importMalFile: async ({ text }) => { await importMalFile(text); return importSnapshot(); },
  importKitsu: async ({ username }) => { await importKitsu(username); return importSnapshot(); },
  cancelImport: async () => { cancelImport(); return importSnapshot(); },
  applyImport: async ({ skip }) => ({ result: await applyImport({ skip: Array.isArray(skip) ? skip.map(Number) : [] }), ...(await importSnapshot()) }),
  dismissImport: async () => { await dismissImport(); return importSnapshot(); },
  undoImport: async ({ id }) => ({ result: await undoImport(String(id)), ...(await importSnapshot()) }),
  resolvePending: async ({ key, anilistId }) => ({
    result: await resolvePending(String(key), anilistId == null ? null : Number(anilistId)),
    ...(await importSnapshot()),
  }),
  forgetSiteData,
  connectMal: async () => ({ ...(await connectMal()), ...(await importSnapshot()) }),
  disconnectMal: async () => { await disconnectMal(); return importSnapshot(); },
  setMalClientId: async ({ clientId }) => { await setMalClientId(clientId); return importSnapshot(); },
  connectKitsu: async ({ username }) => {
    const link = cleanKitsuLink({ username, at: Date.now() });
    if (!link) throw new Error("Enter your Kitsu username, as in kitsu.app/users/NAME.");
    await chrome.storage.local.set({ [KEYS.kitsuLink]: link });
    return importSnapshot();
  },
  disconnectKitsu: async () => { await chrome.storage.local.remove(KEYS.kitsuLink); return importSnapshot(); },
  pullTrackers: async () => ({ ...(await runTrackerPull({ force: true })), ...(await importSnapshot()) }),
  backup: async ({ theme }) => {
    const stored = await chrome.storage.local.get(BACKUP_KEYS);
    return { file: makeBackup(stored, { version: chrome.runtime.getManifest().version, theme: theme && typeof theme === "object" ? theme : null }) };
  },
  restore: async ({ text }) => {
    if (importBusy()) throw new Error("Wait for the import to finish before restoring.");
    const { data, theme } = readBackup(text);
    await chrome.storage.local.remove(BACKUP_KEYS.filter((key) => !(key in data)));
    await chrome.storage.local.set(data);
    return { restored: Object.keys(data).length, theme, ...(await importSnapshot()) };
  },
  activityLog: async ({ kind } = {}) => ({ rows: await listActivity({ kind }) }),
  exportActivity: async () => ({ text: await exportActivityText() }),
  clearActivity: async () => {
    await clearActivityLog();
    return {};
  },
  openFeedback: async ({ userAgent }) => {
    const { text: diag } = await buildDiagnostics({ userAgent });
    const activity = await exportActivityText();
    const text = `${diag}\n\n${activity}\n`;
    const title = encodeURIComponent("Kivori SekAI feedback");
    const body = encodeURIComponent([
      "## What happened",
      "",
      "## Steps to reproduce",
      "",
      "## Paste diagnostics below",
      "(Help → Send feedback copies them to your clipboard.)",
      "",
    ].join("\n"));
    return {
      text,
      issueUrl: `https://github.com/Phoniix/crunchilist/issues/new?title=${title}&body=${body}`,
    };
  },
  copyDiagnostics: async ({ userAgent }) => buildDiagnostics({ userAgent }),
  checkShowLinks: async ({ id }) => {
    const { shows } = await appData();
    const show = shows.find((row) => row.id === id || String(row.anilistId) === String(id));
    if (show) checkShowLinks(show).catch(() => {});
    return {};
  },
  refreshCatalogs: async ({ service, openIfNeeded, wait }) => {
    const id = String(service || "");
    if (id && wait) await waitSiteReady(id);
    const ready = await readyCatalogs();
    if (id && !ready.includes(id)) {
      if (!openIfNeeded) {
        throw new Error(`Open ${serviceById(id)?.name || "that site"} in a tab first${id === "crunchyroll" ? ", signed in" : ""}.`);
      }
      const connected = new Set(connectedIds(await grantedOrigins()));
      connected.add("crunchyroll");
      if (!connected.has(id)) throw new Error(`Connect ${serviceById(id)?.name || "that site"} first.`);
      // Back from the return card: wait for hello, never open a second tab.
      const pending = (await chrome.storage.session.get(KEYS.pendingCatalog))[KEYS.pendingCatalog];
      if (pending === id) {
        if (!(await waitSiteReady(id))) {
          throw new Error(`${serviceById(id)?.name || "That site"} isn't ready yet. Pick your profile, keep the tab open, then try Read now again.`);
        }
      } else {
        await openSite({ service: id, purpose: "catalog" });
        return { opened: id, ...(await importSnapshot()) };
      }
    }
    const ids = id ? [id] : await readyCatalogs();
    if (!ids.length) {
      throw new Error(openIfNeeded
        ? "Connect a catalog site first (Crunchyroll, HIDIVE, Tubi or Netflix)."
        : "Open Crunchyroll, HIDIVE, Tubi or Netflix in a tab first.");
    }
    const results = await readCatalogs(ids, { force: true });
    if (id) await chrome.storage.session.remove(KEYS.pendingCatalog);
    return { results, ...(await importSnapshot()) };
  },
};

const contentHandlers = {
  crunchyrollAuth: async ({ token }, sender) => {
    if (onSite(sender, "https://www.crunchyroll.com/")) {
      await saveCrunchyrollToken(token);
      await syncSoon();
      await catalogSoon();
    }
    return {};
  },
  netflixHello: async (_message, sender) => {
    if (onSite(sender, "https://www.netflix.com/") && sender.tab?.id != null && sender.frameId === 0) {
      await chrome.storage.session.set({ [KEYS.netflixTab]: sender.tab.id });
      await syncSoon();
      await catalogSoon();
    }
    return {};
  },
  netflixStarted: async (message, sender) => {
    if (onSite(sender, "https://www.netflix.com/") && sender.frameId === 0 && (await loadImportSettings()).trackNetflix) {
      if (sender.tab?.id != null) await chrome.storage.session.set({ [KEYS.netflixTab]: sender.tab.id });
      const bumped = await bumpContinueFromNetflix({
        provisional: true,
        videoId: message?.videoId || "",
        labels: Array.isArray(message?.labels) ? message.labels : [],
        tabId: sender.tab?.id ?? null,
      }).catch(() => null);
      noteActivity({
        kind: "tracking",
        title: bumped ? `Netflix: watching ${bumped.title || "a show"}` : "Netflix: playback noticed (naming Continue Watching…)",
        ok: Boolean(bumped),
      }).catch(() => {});
      if (bumped) {
        sendWatchGuide(sender.tab?.id, {
          kind: "tracked",
          title: bumped.title,
          episode: bumped.progress != null ? bumped.progress + 1 : null,
          service: "netflix",
        }).catch(() => {});
      }
    }
    return {};
  },
  netflixWatched: async (message, sender) => {
    if (onSite(sender, "https://www.netflix.com/") && sender.frameId === 0 && (await loadImportSettings()).trackNetflix) {
      if (sender.tab?.id != null) await chrome.storage.session.set({ [KEYS.netflixTab]: sender.tab.id });
      const bumped = await bumpContinueFromNetflix({
        provisional: false,
        videoId: message?.videoId || "",
        labels: Array.isArray(message?.labels) ? message.labels : [],
        tabId: sender.tab?.id ?? null,
      }).catch(() => null);
      noteActivity({
        kind: "tracking",
        title: bumped ? `Netflix: finished ${bumped.title || "an episode"} — catching up AniList` : "Netflix: episode finished — catching up AniList",
        ok: true,
      }).catch(() => {});
      if (bumped) {
        sendWatchGuide(sender.tab?.id, {
          kind: "watched",
          title: bumped.title,
          episode: bumped.progress || bumped.next ? (bumped.progress || (bumped.next - 1)) : null,
          service: "netflix",
        }).catch(() => {});
      }
      await trackHistory("netflix");
    }
    return {};
  },
  hidiveHello: async (_message, sender) => { await rememberTab("hidive", KEYS.hidiveTab, sender); await syncSoon(); await catalogSoon(); return {}; },
  tubiHello: async (_message, sender) => { await rememberTab("tubi", KEYS.tubiTab, sender); await catalogSoon(); return {}; },
  hidiveStarted: async (message, sender) => {
    if (onSite(sender, "https://www.hidive.com/") && sender.frameId === 0 && (await loadImportSettings()).trackHidive) {
      const hint = message?.entry && typeof message.entry === "object" ? message.entry : null;
      const bumped = await bumpContinueFromHidive({ hint, videoId: message?.videoId || "", provisional: true }).catch(() => null);
      if (bumped) {
        sendWatchGuide(sender.tab?.id, {
          kind: "tracked",
          title: bumped.title,
          episode: bumped.progress != null ? bumped.progress + 1 : hint?.episode || null,
          service: "hidive",
        }).catch(() => {});
      }
    }
    return {};
  },
  hidiveWatched: async (message, sender) => {
    if (onSite(sender, "https://www.hidive.com/") && sender.frameId === 0 && (await loadImportSettings()).trackHidive) {
      const hint = message?.entry && typeof message.entry === "object" ? message.entry : null;
      const bumped = await bumpContinueFromHidive({ hint, videoId: message?.videoId || "", provisional: false }).catch(() => null);
      if (bumped) {
        sendWatchGuide(sender.tab?.id, {
          kind: "watched",
          title: bumped.title,
          episode: bumped.progress || hint?.episode || null,
          service: "hidive",
        }).catch(() => {});
      }
      await trackHistory("hidive");
    }
    return {};
  },
  watchedStart: noteWatchedStart,
  watched: noteWatched,
  primeHello: async (_message, sender) => { await rememberTab("prime", KEYS.primeTab, sender); await syncSoon(); return {}; },
  returnCheck: async (_message, sender) => {
    const service = await openedFor(sender);
    if (!service) return { show: false };
    const purpose = (await openPurposes())[sender.tab.id] || "";
    const ready = await siteReady(service.id);
    return { show: true, name: service.name, note: returnNote(service, purpose, { ready }), purpose, ready };
  },
  returnBack: async (_message, sender) => {
    const service = await openedFor(sender);
    if (!service) return {};
    const purpose = (await openPurposes())[sender.tab.id] || "";
    const pending = (await chrome.storage.session.get(KEYS.pendingCatalog))[KEYS.pendingCatalog];
    await forgetTab(sender.tab.id);
    if (purpose === "catalog" || pending === service.id) {
      await chrome.storage.session.set({
        [KEYS.pendingCatalog]: service.id,
        [KEYS.catalogKick]: { service: service.id, at: Date.now() },
      });
      return { openHash: "#settings/where" };
    }
    return { openHash: `#settings/import?ready=${service.id}` };
  },
  returnDismiss: async (_message, sender) => {
    if (await openedFor(sender)) await forgetTab(sender.tab.id);
    return {};
  },
};

export function importHandles(type) {
  return Boolean(pageHandlers[type] || contentHandlers[type]);
}

export async function handleImportMessage(message, sender) {
  const type = message?.type;
  const fromPage = sender?.id === chrome.runtime.id && String(sender.url || "").startsWith(chrome.runtime.getURL(""));
  const handler = fromPage ? pageHandlers[type] : contentHandlers[type];
  if (!handler) throw new Error("Unknown import message");
  return handler(message, sender);
}

export function setupImportAlarms() {
  chrome.alarms.create(SYNC_ALARM, { delayInMinutes: 5, periodInMinutes: 60 });
  chrome.alarms.create(TRACKER_ALARM, { delayInMinutes: 10, periodInMinutes: 24 * 60 });
  chrome.alarms.create(CW_EXPIRE_ALARM, { delayInMinutes: 15, periodInMinutes: 24 * 60 });
}

export function onImportAlarm(alarm) {
  if (alarm.name === SYNC_ALARM) runDailySync().catch(() => {}).then(() => runWatchTracking()).catch(() => {}).then(() => runCatalogs()).catch(() => {});
  if (alarm.name === SYNC_SOON_ALARM) runDailySync().catch(() => {});
  for (const [id, { alarm: name }] of Object.entries(HISTORY_TRACKING)) if (alarm.name === name) runTracking(id).catch(() => {});
  if (alarm.name === WATCH_ALARM) runWatchTracking().catch(() => {});
  if (alarm.name === CATALOG_ALARM) runCatalogs().catch(() => {});
  if (alarm.name === TRACKER_ALARM) runTrackerPull().catch(() => {});
  if (alarm.name === CW_EXPIRE_ALARM) expireProvisionalContinueActivity().catch(() => {});
  watchActivity();
}

export { contentScriptsFor, forgetTab };
