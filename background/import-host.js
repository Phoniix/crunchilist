// Import / daily sync / as-you-watch tracking / site hello handlers absorbed from Crunchilist Search.
import { BACKUP_KEYS, diagnostics, makeBackup, readBackup } from "../lib/backup.js";
import { SITE_DATA_KEYS, forgetNote, forgetSite } from "../lib/forget-site.js";
import { KEYS } from "../lib/keys.js";
import { publicSession } from "../lib/anilist-auth.js";
import { LIST_SOURCES } from "../lib/list-import.js";
import { anilistSession } from "../lib/settings.js";
import { SERVICES, connectedIds, contentScriptsFor, onService, returnNote, serviceById } from "../lib/services.js";
import { cleanKitsuLink, publicKitsuLink } from "../lib/trackers.js";
import { TRACKED, TRACK_SETTING, addToLog, cleanItem, itemText } from "../lib/watch-tracking.js";
import { titleReadiness } from "../lib/title-api.js";
import { watchActivity } from "./activity.js";
import { appData } from "./app-data.js";
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
  for (const id of ids) await chrome.tabs.create({ url: serviceById(id).home, active: false });
  return { opened: ids };
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
  copyDiagnostics: async ({ userAgent }) => {
    const [snap, granted, idMap, whereMap, session, state] = await Promise.all([
      importSnapshot(),
      grantedOrigins(),
      idMapStatus(),
      whereMapStatus(),
      chrome.storage.local.get(KEYS.session).then((row) => row[KEYS.session]),
      loadState(),
    ]);
    const now = Date.now();
    // Prefer the Search-style session mirror; fall back to Prism's main AniList settings so diagnostics match Import.
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
  },
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
  netflixWatched: async (_message, sender) => {
    if (onSite(sender, "https://www.netflix.com/") && sender.frameId === 0 && (await loadImportSettings()).trackNetflix) await trackHistory("netflix");
    return {};
  },
  hidiveHello: async (_message, sender) => { await rememberTab("hidive", KEYS.hidiveTab, sender); await syncSoon(); await catalogSoon(); return {}; },
  tubiHello: async (_message, sender) => { await rememberTab("tubi", KEYS.tubiTab, sender); await catalogSoon(); return {}; },
  hidiveWatched: async (_message, sender) => {
    if (onSite(sender, "https://www.hidive.com/") && sender.frameId === 0 && (await loadImportSettings()).trackHidive) await trackHistory("hidive");
    return {};
  },
  watched: noteWatched,
  primeHello: async (_message, sender) => { await rememberTab("prime", KEYS.primeTab, sender); await syncSoon(); return {}; },
  returnCheck: async (_message, sender) => {
    const service = await openedFor(sender);
    if (!service) return { show: false };
    const purpose = (await openPurposes())[sender.tab.id] || "";
    return { show: true, name: service.name, note: returnNote(service, purpose), purpose };
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
}

export function onImportAlarm(alarm) {
  if (alarm.name === SYNC_ALARM) runDailySync().catch(() => {}).then(() => runWatchTracking()).catch(() => {}).then(() => runCatalogs()).catch(() => {});
  if (alarm.name === SYNC_SOON_ALARM) runDailySync().catch(() => {});
  for (const [id, { alarm: name }] of Object.entries(HISTORY_TRACKING)) if (alarm.name === name) runTracking(id).catch(() => {});
  if (alarm.name === WATCH_ALARM) runWatchTracking().catch(() => {});
  if (alarm.name === CATALOG_ALARM) runCatalogs().catch(() => {});
  if (alarm.name === TRACKER_ALARM) runTrackerPull().catch(() => {});
  watchActivity();
}

export { contentScriptsFor, forgetTab };
