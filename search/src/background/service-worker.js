import { VIEWER_QUERY, anilist } from "../lib/anilist-api.js";
import { authUrl, parseTokenRedirect, publicSession } from "../lib/anilist-auth.js";
import { BACKUP_KEYS, diagnostics, makeBackup, readBackup } from "../lib/backup.js";
import { CATALOG_SERVICES, availability, availableServices, catalogStamp, catalogSummary, onlyOnHidden, withCatalogLinks } from "../lib/catalogs.js";
import { TITLE_CONTRACT, titleReadiness } from "../lib/title-api.js";
import { SITE_DATA_KEYS, forgetNote, forgetSite } from "../lib/forget-site.js";
import { KEYS } from "../lib/keys.js";
import { brandForService, pickPlayLink } from "../lib/play-url.js";
import { SERVICES, connectedIds, contentScriptsFor, onService, returnNote, serviceById, serviceForSite } from "../lib/services.js";
import { cleanSettings, mergeSettings } from "../lib/settings.js";
import { searchLocalTitles } from "../lib/title-search.js";
import { TRACKED, TRACK_SETTING, addToLog, cleanItem, itemText } from "../lib/watch-tracking.js";
import { airingWeek, browse, browseOptions, homeRows, myList, removeEntry, saveEntry, showDetails } from "./catalog.js";
import { loadCatalogs, readCatalogs } from "./catalog-reader.js";
import { checkShowLinks, loadDead } from "./dead-links.js";
import { CHECK_EVERY_MS, getShow, idMapStatus, refreshIdMap } from "./id-map-store.js";
import { applyImport, backgroundSync, cancelImport, dismissImport, importBusy, importKitsu, importMalApi, importMalFile, importNetflixCsv, importStatus, resolvePending, saveCrunchyrollToken, startImport, startImportAll, undoImport } from "./importer.js";
import { connectMal, disconnectMal, malStatus, setMalClientId } from "./mal-store.js";
import { runTrackerPull } from "./tracker-pull.js";
import { loadGaps, refreshWhereMap, whereMapStatus } from "./where-map-store.js";
import { cleanKitsuLink, publicKitsuLink } from "../lib/trackers.js";
import { CHARACTERS, cleanFavorite, composeLine, publicFavorite, linePreview } from "../lib/characters.js";

const APP = "app/app.html";
const FEEDS_ALARM = "cs-feeds";
const SYNC_ALARM = "cs-sync";
const SYNC_SOON_ALARM = "cs-sync-soon";
const TRACK_ALARM = "cs-track-netflix";
const WATCH_ALARM = "cs-track-watch";
const WATCH_DELAY_MIN = 1;
const CATALOG_ALARM = "cs-catalogs";
const TRACKER_ALARM = "cs-tracker-pull";
// "Daily" with some slack, so a site opened at about the same time each day still syncs every day.
const SYNC_EVERY_MS = 20 * 60 * 60 * 1000;
const TRACK_DELAY_MIN = 2;
const TRACK_RETRY_MIN = 10;
const TRACK_TRIES = 3;

// The app's own tab is found through its extension context, which needs no "tabs" permission.
async function openApp(hash = "") {
  const url = chrome.runtime.getURL(APP);
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["TAB"] }).catch(() => []);
  const existing = contexts.find((context) => context.tabId >= 0 && String(context.documentUrl || "").startsWith(url));
  if (existing) {
    const tab = await chrome.tabs.update(existing.tabId, { active: true, ...(hash ? { url: url + hash } : {}) }).catch(() => null);
    if (tab) {
      if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      return;
    }
  }
  await chrome.tabs.create({ url: url + hash });
}

// Wait until a site's tab has said hello (Netflix profile, HIDIVE/Tubi page script, etc.).
async function waitSiteReady(id, { tries = 40, ms = 500 } = {}) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (await siteReady(id)) return true;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
  return siteReady(id);
}

async function grantedOrigins() {
  return (await chrome.permissions.getAll()).origins || [];
}

// Content scripts follow the permissions: registered for connected services, removed for the rest.
// Runs on install, on startup and whenever the user grants or removes a site.
async function syncContentScripts() {
  const connected = new Set(connectedIds(await grantedOrigins()));
  const wanted = SERVICES.filter((service) => connected.has(service.id)).flatMap(contentScriptsFor);
  const wantedIds = new Set(wanted.map((script) => script.id));
  const registered = new Set((await chrome.scripting.getRegisteredContentScripts()).map((script) => script.id));
  const stale = [...registered].filter((id) => !wantedIds.has(id));
  if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale }).catch(() => {});
  const fresh = wanted.filter((script) => !registered.has(script.id));
  const known = wanted.filter((script) => registered.has(script.id));
  if (fresh.length) await chrome.scripting.registerContentScripts(fresh).catch(() => {});
  if (known.length) await chrome.scripting.updateContentScripts(known).catch(() => {});
}

async function loadSession() {
  return (await chrome.storage.local.get(KEYS.session))[KEYS.session] || null;
}

// Tabs the app opened on a streaming site, so only those show the "Back to Crunchilist Search" card.
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

// purpose: "catalog" shows a catalog return note and, on Back, kicks off a catalog read.
async function openSite({ service: id, purpose = "" }) {
  const service = serviceById(String(id || ""));
  if (!service) throw new Error("That service isn't known.");
  if (!connectedIds(await grantedOrigins()).includes(service.id)) throw new Error(`Connect ${service.name} first.`);
  await syncContentScripts();
  const tab = await chrome.tabs.create({ url: service.home, active: true });
  const patch = { [KEYS.openedTabs]: { ...(await openedTabs()), [tab.id]: service.id } };
  if (purpose === "catalog") {
    patch[KEYS.openPurpose] = { ...(await openPurposes()), [tab.id]: "catalog" };
    patch[KEYS.pendingCatalog] = service.id;
  }
  await chrome.storage.session.set(patch);
  return { opened: service.id, purpose: purpose || "" };
}

// Whether a site's history can be read right now: its tab has said hello (Crunchyroll: its sign-in was seen this session).
const SITE_TABS = { netflix: KEYS.netflixTab, prime: KEYS.primeTab, hidive: KEYS.hidiveTab, tubi: KEYS.tubiTab };
async function siteReady(id) {
  if (id === "crunchyroll") return Boolean((await chrome.storage.session.get(KEYS.crunchyrollAuth))[KEYS.crunchyrollAuth]?.token);
  const tabId = SITE_TABS[id] ? (await chrome.storage.session.get(SITE_TABS[id]))[SITE_TABS[id]] : null;
  return tabId != null && Boolean(await chrome.tabs.get(tabId).catch(() => null));
}

// The connected sites Import all reads, and which of them still need a tab.
async function importAllNeeds() {
  const connected = connectedIds(await grantedOrigins());
  const sites = SERVICES.filter((service) => service.imports && connected.includes(service.id)).map((service) => service.id);
  const missing = [];
  for (const id of sites) if (!(await siteReady(id))) missing.push(id);
  return { sites, missing };
}

// Opened only after the user agrees in the app, in the background so the app stays in front.
async function openSites({ services }) {
  const connected = connectedIds(await grantedOrigins());
  const ids = (Array.isArray(services) ? services : []).map(String).filter((id) => serviceById(id) && connected.includes(id));
  await syncContentScripts();
  for (const id of ids) await chrome.tabs.create({ url: serviceById(id).home, active: false });
  return { opened: ids };
}

async function loadSettings() {
  return cleanSettings((await chrome.storage.local.get(KEYS.settings))[KEYS.settings]);
}

async function loadSync() {
  return (await chrome.storage.local.get(KEYS.syncState))[KEYS.syncState] || { sites: {}, lastRun: 0, lastResult: "" };
}

async function loadKitsuLink() {
  return cleanKitsuLink((await chrome.storage.local.get(KEYS.kitsuLink))[KEYS.kitsuLink]);
}

async function loadFavorite() {
  return cleanFavorite((await chrome.storage.local.get(KEYS.favoriteCharacter))[KEYS.favoriteCharacter]);
}

async function status() {
  const [mal, kitsu, idMap, whereMap, catalogs, favorite] = await Promise.all([
    malStatus(), loadKitsuLink(), idMapStatus(), whereMapStatus(), loadCatalogs(), loadFavorite(),
  ]);
  const connected = connectedIds(await grantedOrigins());
  const summary = catalogSummary(catalogs);
  const fav = publicFavorite(favorite);
  return {
    version: chrome.runtime.getManifest().version,
    connected,
    anilist: publicSession(await loadSession()),
    mal,
    kitsu: publicKitsuLink(kitsu),
    favorite: fav,
    lines: fav.id ? {
      welcome: composeLine({ characterId: fav.id, kind: "welcome" }),
      look_here: composeLine({ characterId: fav.id, kind: "look_here", hint: "Something on your services may be ready" }),
      tip: composeLine({ characterId: fav.id, kind: "tip", tip: "Open Settings → Where to watch → Read now after a site tab is open." }),
    } : null,
    idMap,
    whereMap,
    settings: await loadSettings(),
    sync: await loadSync(),
    catalogs: summary,
    title: titleReadiness({ idMap, catalogs, whereMap, connected }),
    titleContract: TITLE_CONTRACT,
    mineServices: availableServices((await catalogState()).found),
  };
}

async function setFavoriteCharacter({ id }) {
  const clean = cleanFavorite(id);
  if (!clean) {
    await chrome.storage.local.remove(KEYS.favoriteCharacter);
    return status();
  }
  await chrome.storage.local.set({ [KEYS.favoriteCharacter]: clean });
  return status();
}

async function saveSettings({ patch }) {
  const settings = mergeSettings(await loadSettings(), patch);
  await chrome.storage.local.set({ [KEYS.settings]: settings });
  if (settings.dailySync) syncSoon().catch(() => {});
  if (settings.readCatalogs) catalogSoon().catch(() => {});
  if (settings.weeklyTrackerPull) scheduleTrackerPull();
  return { settings, mineServices: availableServices((await catalogState()).found) };
}

async function connectKitsu({ username }) {
  const link = cleanKitsuLink({ username, at: Date.now() });
  if (!link) throw new Error("Enter your Kitsu username, as in kitsu.app/users/NAME.");
  await chrome.storage.local.set({ [KEYS.kitsuLink]: link });
  return status();
}

async function disconnectKitsu() {
  await chrome.storage.local.remove(KEYS.kitsuLink);
  return status();
}

// ---- Daily sync and Netflix tracking (both opt-in) ----
// Only sites already open in a tab are read; the extension never opens a site on its own for this.

const WAITING = {
  busy: "Waiting for the current import to finish.",
  preview: "Waiting: apply or dismiss the preview in Import first.",
  draft: "Waiting: an import was stopped partway. Run it again from Import to finish it.",
};

async function runDailySync() {
  const settings = await loadSettings();
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

// A site's tab just loaded: if daily sync is on, check in a minute whether anything is due.
async function syncSoon() {
  if (!(await loadSettings()).dailySync || (await chrome.alarms.get(SYNC_SOON_ALARM))) return;
  await chrome.alarms.create(SYNC_SOON_ALARM, { delayInMinutes: 1 });
}

// An episode finished on a site with history (Netflix, HIDIVE): catch up on its history a couple of minutes later,
// once the site has recorded it. Another episode finishing first pushes the check back, so a binge is caught up in one go.
const HISTORY_TRACKING = {
  netflix: { alarm: TRACK_ALARM, setting: "trackNetflix" },
  hidive: { alarm: "cs-track-hidive", setting: "trackHidive" },
};

async function trackHistory(id, tries = 0) {
  await chrome.storage.session.set({ [`csTrackTries-${id}`]: tries });
  await chrome.alarms.create(HISTORY_TRACKING[id].alarm, { delayInMinutes: tries ? TRACK_RETRY_MIN : TRACK_DELAY_MIN });
}

async function runTracking(id) {
  const settings = await loadSettings();
  if (!settings[HISTORY_TRACKING[id].setting] || !connectedIds(await grantedOrigins()).includes(id)) return;
  const triesKey = `csTrackTries-${id}`;
  const tries = (await chrome.storage.session.get(triesKey))[triesKey] || 0;
  const result = await backgroundSync([id], { trigger: "tracking", apply: true }).catch((error) => ({ ran: false, why: "", message: error.message }));
  const retry = result.ran ? /nothing new/i.test(result.message) : result.why === "busy";
  if (retry && tries + 1 < TRACK_TRIES) await trackHistory(id, tries + 1);
  await chrome.storage.local.set({ [KEYS.syncState]: { ...(await loadSync()), lastTrack: Date.now(), trackResult: result.ran ? result.message : WAITING[result.why] || result.message || "" } });
}

// ---- Tracking as you watch on Tubi ----
// Their content scripts name each episode as it finishes; it's logged, then sent to AniList a minute later
// (another episode finishing first pushes that back, so a binge goes in one go).

async function noteWatched({ service: id, item, miss }, sender) {
  const service = serviceById(String(id || ""));
  if (!service || !TRACKED.includes(service.id) || sender?.id !== chrome.runtime.id || sender.frameId !== 0 || !onService(service, sender.url)) return {};
  if (!(await loadSettings())[TRACK_SETTING[service.id]]) return {};
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

// Sites with logged episodes newer than what was last sent.
async function watchDue() {
  const settings = await loadSettings();
  const connected = connectedIds(await grantedOrigins());
  const { [KEYS.watchLog]: log = [], [KEYS.checkpoints]: points = {} } = await chrome.storage.local.get([KEYS.watchLog, KEYS.checkpoints]);
  return TRACKED.filter((id) => settings[TRACK_SETTING[id]] && connected.includes(id)
    && (Array.isArray(log) ? log : []).some((row) => row?.service === id && row.playedAt > (points[`${id}:main`]?.newestAt || 0)));
}

async function runWatchTracking() {
  const due = await watchDue();
  if (!due.length) return;
  const result = await backgroundSync(due, { trigger: "tracking", apply: true }).catch((error) => ({ ran: false, why: "", message: error.message }));
  if (!result.ran && result.why === "busy") await chrome.alarms.create(WATCH_ALARM, { delayInMinutes: TRACK_RETRY_MIN });
  await chrome.storage.local.set({ [KEYS.syncState]: { ...(await loadSync()), lastTrack: Date.now(), trackResult: result.ran ? result.message : WAITING[result.why] || result.message || "" } });
}

// ---- Service catalogs ----
// Read about once a week from a site's open tab (on by default, switchable in Settings), so show pages can link
// what each connected service carries and Browse can keep to it.

async function catalogSoon() {
  if (!(await loadSettings()).readCatalogs || (await chrome.alarms.get(CATALOG_ALARM))) return;
  await chrome.alarms.create(CATALOG_ALARM, { delayInMinutes: 1 });
}

async function readyCatalogs() {
  const connected = connectedIds(await grantedOrigins());
  const ready = [];
  for (const id of CATALOG_SERVICES) if (connected.includes(id) && (await siteReady(id))) ready.push(id);
  return ready;
}

async function runCatalogs() {
  if (!(await loadSettings()).readCatalogs) return;
  await readCatalogs(await readyCatalogs());
}

async function refreshCatalogs({ service, openIfNeeded = false, wait = false }) {
  const id = String(service || "");
  if (id && wait) await waitSiteReady(id);
  const ready = await readyCatalogs();
  if (id && !ready.includes(id)) {
    if (!openIfNeeded) throw new Error(`Open ${serviceById(id)?.name || "that site"} in a tab first${id === "crunchyroll" ? ", signed in" : ""}.`);
    if (!connectedIds(await grantedOrigins()).includes(id)) throw new Error(`Connect ${serviceById(id)?.name || "that site"} first.`);
    // Already opened for this catalog read (Back from the return card) — don't open a second tab.
    const pending = (await chrome.storage.session.get(KEYS.pendingCatalog))[KEYS.pendingCatalog];
    if (pending === id) {
      if (!(await waitSiteReady(id))) throw new Error(`${serviceById(id)?.name || "That site"} isn't ready yet. Pick your profile, keep the tab open, then try Read now again.`);
    } else {
      await openSite({ service: id, purpose: "catalog" });
      return { opened: id, ...(await status()) };
    }
  }
  const ids = id ? [id] : await readyCatalogs();
  if (!ids.length) {
    if (!openIfNeeded) throw new Error("Open Crunchyroll, HIDIVE, Tubi or Netflix in a tab first.");
    throw new Error("Connect a catalog site first (Crunchyroll, HIDIVE, Tubi or Netflix).");
  }
  const results = await readCatalogs(ids, { force: true });
  if (id) await chrome.storage.session.remove(KEYS.pendingCatalog);
  return { results, ...(await status()) };
}

// What "On my services" and where-to-watch draw on: catalogs of connected services, the Netflix/Prime/Hulu gap
// map, and shows watched on any service. Known-dead gap links are left out.
async function catalogState() {
  const [catalogs, connected, settings, matches, gaps, dead] = await Promise.all([
    loadCatalogs(), grantedOrigins().then(connectedIds), loadSettings(),
    chrome.storage.local.get(KEYS.matches).then((stored) => stored[KEYS.matches] || {}),
    loadGaps(), loadDead(),
  ]);
  const options = { matches, hidden: settings.hiddenSites, gaps, dead };
  const usable = settings.readCatalogs ? catalogs : {};
  const everywhere = availability(usable, connected, { matches, gaps, dead });
  const hidden = settings.hideOffSiteShows ? settings.hiddenSites : [];
  return {
    found: availability(usable, connected, options),
    stamp: catalogStamp(usable, connected, options),
    dead,
    keep: (show) => !onlyOnHidden(show, everywhere, hidden),
  };
}
const mineFilter = ({ found, stamp }) => ({ ids: Object.keys(found).map(Number), stamp });
// "Netflix only" / site-panel filter: shows known on that one service's catalog or history.
const serviceFilter = ({ found, stamp }, serviceId) => ({
  ids: Object.entries(found).filter(([, list]) => list.some((item) => item.service === serviceId)).map(([id]) => Number(id)),
  stamp: `${stamp}:s:${serviceId}`,
});
const linkShows = (shows, found, dead = {}) => (shows || []).map((show) => withCatalogLinks(show, found, { dead }));
// The same, leaving out shows that only stream on sites switched off (when that setting is on).
const linkKept = (shows, state) => linkShows((shows || []).filter(state.keep), state.found, state.dead);

async function homeRowsLinked({ mine }) {
  const state = await catalogState();
  const reply = await homeRows(mine ? mineFilter(state) : null);
  const rows = Object.fromEntries(["trending", "thisSeason", "airing", "popular", "top"].map((key) => [key, linkKept(reply[key], state)]));
  return { ...reply, ...rows };
}

async function browseLinked({ filters, page, mine, service }) {
  const state = await catalogState();
  const serviceId = serviceById(String(service || ""))?.id || "";
  const scope = serviceId ? serviceFilter(state, serviceId) : mine ? mineFilter(state) : null;
  const reply = await browse(filters && typeof filters === "object" ? filters : {}, Math.max(1, Number(page) || 1), scope);
  return { ...reply, shows: linkKept(reply.shows, state), service: serviceId || "" };
}

// Popup and site-panel title search: local master list first, AniList browse as a fill-in. Optional one-service filter.
async function titleSearch({ query, service, limit = 12 }) {
  const q = String(query || "").trim();
  if (q.length < 2) return { shows: [], source: "" };
  const serviceId = serviceById(String(service || ""))?.id || "";
  const state = await catalogState();
  let local = [];
  try { local = await searchLocalTitles(q, { limit: Math.max(limit * 2, 24) }); } catch { /* feed not loaded yet */ }
  const localIds = new Set(local.map((show) => show.anilistId));
  let shows = local.map((show) => withCatalogLinks({ ...show, streaming: [] }, state.found, { dead: state.dead }));
  if (serviceId) shows = shows.filter((show) => (state.found[show.anilistId] || []).some((item) => item.service === serviceId));
  if (shows.length < limit) {
    // If this service has no catalog/history ids yet, search AniList broadly and keep titles that list the service.
    const scoped = serviceId && serviceFilter(state, serviceId).ids.length > 0;
    const reply = await browseLinked({ filters: { query: q, sort: "match" }, page: 1, service: scoped ? serviceId : "" });
    for (const show of reply.shows || []) {
      if (localIds.has(show.anilistId)) continue;
      if (serviceId && !scoped && !(show.streaming || []).some((link) => serviceForSite(link.site)?.id === serviceId)
        && !(state.found[show.anilistId] || []).some((item) => item.service === serviceId)) continue;
      shows.push(show);
      if (shows.length >= limit) break;
    }
  }
  shows = shows.slice(0, limit).map((show) => ({
    id: show.id,
    anilistId: show.anilistId,
    title: show.title,
    year: show.year,
    format: show.format,
    episodes: show.episodes,
    cover: show.cover,
    score: show.score,
    play: pickPlayLink(show, { preferService: serviceId }),
    onServices: show.onServices || [],
  }));
  return { shows, source: local.length ? "catalog" : "anilist", service: serviceId };
}

async function continueWatching({ service, limit = 8 } = {}) {
  const serviceId = serviceById(String(service || ""))?.id || "";
  const [reply, state] = await Promise.all([myList().catch(() => ({ connected: false, entries: {}, shows: [] })), catalogState()]);
  if (!reply.connected) return { connected: false, shows: [] };
  const linked = linkKept(reply.shows, state);
  const current = linked.filter((show) => {
    const entry = reply.entries[show.id];
    if (entry?.status !== "CURRENT" && entry?.status !== "REPEATING") return false;
    if (!serviceId) return true;
    return (state.found[show.anilistId] || []).some((item) => item.service === serviceId) || sourcesHas(show, serviceId);
  }).slice(0, limit);
  return {
    connected: true,
    shows: current.map((show) => {
      const entry = reply.entries[show.id];
      const next = Math.min((entry?.progress || 0) + 1, show.episodes || (entry?.progress || 0) + 1);
      return {
        id: show.id,
        anilistId: show.anilistId,
        title: show.title,
        cover: show.cover,
        progress: entry?.progress || 0,
        episodes: show.episodes,
        next,
        play: pickPlayLink(show, { preferService: serviceId, episode: next }),
      };
    }),
  };
}
const sourcesHas = (show, serviceId) => (show.streaming || []).some((link) => serviceForSite(link.site)?.id === serviceId);

async function panelHello(_message, sender) {
  const service = SERVICES.find((item) => onService(item, sender?.url));
  if (!service || service.untested) return { show: false };
  const connected = connectedIds(await grantedOrigins());
  if (!connected.includes(service.id)) return { show: false };
  return { show: true, service: service.id, name: service.name, color: brandForService(service.id) };
}

async function backup({ theme }) {
  const stored = await chrome.storage.local.get(BACKUP_KEYS);
  return { file: makeBackup(stored, { version: chrome.runtime.getManifest().version, theme: theme && typeof theme === "object" ? theme : null }) };
}

async function restore({ text }) {
  if ((await importStatus()).job.running) throw new Error("Wait for the import to finish before restoring.");
  const { data, theme } = readBackup(text);
  await chrome.storage.local.remove(BACKUP_KEYS.filter((key) => !(key in data)));
  await chrome.storage.local.set(data);
  return { restored: Object.keys(data).length, theme, ...(await status()) };
}

async function copyDiagnostics({ userAgent }) {
  const [base, imports, granted] = await Promise.all([status(), importStatus(), grantedOrigins()]);
  return { text: diagnostics({ ...base, ...imports, userAgent: String(userAgent || "").slice(0, 300), granted }) };
}

// Opens AniList's own sign-in window; the token comes back in the redirect and stays in the background.
async function connectAnilist() {
  let redirect;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({ url: authUrl(), interactive: true });
  } catch (error) {
    throw new Error(/did not approve|cancel|closed/i.test(String(error?.message)) ? "AniList sign-in was cancelled." : "AniList sign-in didn't finish. Try again.");
  }
  const result = parseTokenRedirect(redirect || "");
  if (result.error) throw new Error(result.error);
  const data = await anilist(VIEWER_QUERY, {}, { token: result.token });
  const viewer = { id: data?.Viewer?.id || null, name: data?.Viewer?.name || "", avatar: data?.Viewer?.avatar?.medium || "" };
  await chrome.storage.local.set({ [KEYS.session]: { token: result.token, expiresAt: result.expiresAt, viewer, connectedAt: Date.now() } });
  return status();
}

// Asked for when a site is disconnected. Session-only sign-in and tab details for it go too.
async function forgetSiteData({ service: id }) {
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
  return { note: forgetNote(service.name, plan.counts), ...(await status()) };
}

async function disconnectAnilist() {
  await chrome.storage.local.remove(KEYS.session);
  return status();
}

const handlers = {
  status,
  connectAnilist,
  disconnectAnilist,
  connectMal: async () => ({ ...(await connectMal()), ...(await status()) }),
  disconnectMal: async () => { await disconnectMal(); return status(); },
  setMalClientId: async ({ clientId }) => { await setMalClientId(clientId); return status(); },
  connectKitsu,
  disconnectKitsu,
  setFavoriteCharacter,
  characterRoster: async () => ({ characters: CHARACTERS.map(({ id, name, show, tone }) => ({ id, name, show, tone })), preview: Object.fromEntries(CHARACTERS.map((c) => [c.id, linePreview(c.id)])) }),
  pullTrackers: async () => ({ ...(await runTrackerPull({ force: true })), ...(await status()) }),
  importMalApi: async () => { await importMalApi(); return importStatus(); },
  forgetSiteData,
  syncServices: async () => { await syncContentScripts(); return status(); },
  refreshFeeds: async () => {
    await Promise.all([refreshIdMap({ force: true }), refreshWhereMap({ force: true })]);
    return status();
  },
  show: async ({ anilistId }) => ({ show: await getShow(anilistId) }),
  homeRows: homeRowsLinked,
  browse: browseLinked,
  titleSearch,
  continueWatching,
  openApp: async ({ hash } = {}) => { await openApp(hash || ""); return {}; },
  browseOptions,
  airingWeek: async ({ from }) => {
    const [reply, state] = await Promise.all([airingWeek(from), catalogState()]);
    return { ...reply, slots: reply.slots.filter((slot) => state.keep(slot.show)).map((slot) => ({ ...slot, show: withCatalogLinks(slot.show, state.found, { dead: state.dead }) })) };
  },
  showDetails: async ({ anilistId }) => {
    const [reply, state] = await Promise.all([showDetails(anilistId), catalogState()]);
    const show = withCatalogLinks(reply.show, state.found, { dead: state.dead });
    // Re-check Netflix / Prime / Hulu links in the background; next open drops any that went dead.
    checkShowLinks(show).catch(() => {});
    return { ...reply, show, similar: linkKept(reply.similar, state) };
  },
  myList: async () => {
    const [reply, state] = await Promise.all([myList(), catalogState()]);
    return { ...reply, shows: linkShows(reply.shows, state.found, state.dead) };
  },
  refreshCatalogs,
  saveEntry,
  removeEntry,
  importStatus,
  startImport: async ({ service, full }) => { await startImport({ service: String(service || ""), full: Boolean(full) }); return importStatus(); },
  startImportAll: async () => { await startImportAll(); return importStatus(); },
  importAllNeeds,
  openSites,
  importNetflixCsv: async ({ text }) => { await importNetflixCsv(text); return importStatus(); },
  importMalFile: async ({ text }) => { await importMalFile(text); return importStatus(); },
  importKitsu: async ({ username }) => { await importKitsu(username); return importStatus(); },
  openSite,
  saveSettings,
  backup,
  restore,
  copyDiagnostics,
  cancelImport: async () => { cancelImport(); return importStatus(); },
  applyImport: async ({ skip }) => ({ result: await applyImport({ skip: Array.isArray(skip) ? skip.map(Number) : [] }), ...(await importStatus()) }),
  dismissImport: async () => { await dismissImport(); return importStatus(); },
  undoImport: async ({ id }) => ({ result: await undoImport(String(id)), ...(await importStatus()) }),
  resolvePending: async ({ key, anilistId }) => ({ result: await resolvePending(String(key), anilistId == null ? null : Number(anilistId)), ...(await importStatus()) }),
};

// The tab a service's history is read from: the latest top-level page of that service to say hello.
async function rememberTab(id, key, sender) {
  if (sender?.id === chrome.runtime.id && onService(serviceById(id), sender.url) && sender.tab?.id != null && sender.frameId === 0) await chrome.storage.session.set({ [key]: sender.tab.id });
  return {};
}

// Content scripts on streaming sites get their own small set of messages, never account actions.
const onSite = (sender, origin) => String(sender?.url || "").startsWith(origin) && sender?.id === chrome.runtime.id;
const fromContent = {
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
    if (onSite(sender, "https://www.netflix.com/") && sender.frameId === 0 && (await loadSettings()).trackNetflix) await trackHistory("netflix");
    return {};
  },
  hidiveHello: async (_message, sender) => { await rememberTab("hidive", KEYS.hidiveTab, sender); await syncSoon(); await catalogSoon(); return {}; },
  tubiHello: async (_message, sender) => { await rememberTab("tubi", KEYS.tubiTab, sender); await catalogSoon(); return {}; },
  hidiveWatched: async (_message, sender) => {
    if (onSite(sender, "https://www.hidive.com/") && sender.frameId === 0 && (await loadSettings()).trackHidive) await trackHistory("hidive");
    return {};
  },
  watched: noteWatched,
  primeHello: async (_message, sender) => { await rememberTab("prime", KEYS.primeTab, sender); await syncSoon(); return {}; },
  panelHello,
  titleSearch,
  continueWatching,
  openApp: async ({ hash } = {}) => { await openApp(hash || ""); return {}; },
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
      // Keep the site tab open — catalog read needs it. Kick the app via session storage (extension
      // pages don't receive tabs.sendMessage) and open Settings.
      await chrome.storage.session.set({
        [KEYS.pendingCatalog]: service.id,
        [KEYS.catalogKick]: { service: service.id, at: Date.now() },
      });
      await openApp("#settings");
      return {};
    }
    await openApp(`#settings/import?ready=${service.id}`);
    return {};
  },
  returnDismiss: async (_message, sender) => {
    if (await openedFor(sender)) await forgetTab(sender.tab.id);
    return {};
  },
};

// The service a content script's tab was opened for, if the app opened it and it's still on that site.
async function openedFor(sender) {
  if (sender?.id !== chrome.runtime.id || sender.tab?.id == null || sender.frameId !== 0) return null;
  const service = serviceById((await openedTabs())[sender.tab.id]);
  return service && onService(service, sender.url) ? service : null;
}
const fromExtensionPage = (sender) => sender?.id === chrome.runtime.id && String(sender.url || "").startsWith(chrome.runtime.getURL(""));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = fromExtensionPage(sender) ? handlers[message?.type] : fromContent[message?.type];
  if (!handler) return false;
  handler(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || "Something went wrong", code: error?.code || "" }));
  return true;
});

function scheduleFeeds() {
  chrome.alarms.create(FEEDS_ALARM, { delayInMinutes: 1, periodInMinutes: CHECK_EVERY_MS / 60000 });
  chrome.alarms.create(SYNC_ALARM, { delayInMinutes: 5, periodInMinutes: 60 });
  scheduleTrackerPull();
}

function scheduleTrackerPull() {
  // Daily check; runTrackerPull itself enforces the weekly cadence when weeklyTrackerPull is on.
  chrome.alarms.create(TRACKER_ALARM, { delayInMinutes: 10, periodInMinutes: 24 * 60 });
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  syncContentScripts().catch(() => {});
  scheduleFeeds();
  refreshIdMap({ force: true }).catch(() => {});
  refreshWhereMap({ force: true }).catch(() => {});
  if (reason === "install") openApp("#welcome").catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  syncContentScripts().catch(() => {});
  scheduleFeeds();
  refreshIdMap().catch(() => {});
  refreshWhereMap().catch(() => {});
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FEEDS_ALARM) {
    refreshIdMap().catch(() => {});
    refreshWhereMap().catch(() => {});
  }
  // Episodes left waiting behind a preview or a running import are sent on a later hourly check, after daily sync.
  if (alarm.name === SYNC_ALARM) runDailySync().catch(() => {}).then(() => runWatchTracking()).catch(() => {}).then(() => runCatalogs()).catch(() => {});
  if (alarm.name === SYNC_SOON_ALARM) runDailySync().catch(() => {});
  for (const [id, { alarm: name }] of Object.entries(HISTORY_TRACKING)) if (alarm.name === name) runTracking(id).catch(() => {});
  if (alarm.name === WATCH_ALARM) runWatchTracking().catch(() => {});
  if (alarm.name === CATALOG_ALARM) runCatalogs().catch(() => {});
  if (alarm.name === TRACKER_ALARM) runTrackerPull().catch(() => {});
});
chrome.permissions.onAdded.addListener(() => { syncContentScripts().catch(() => {}); });
chrome.permissions.onRemoved.addListener(() => { syncContentScripts().catch(() => {}); });
chrome.tabs.onRemoved.addListener((tabId) => { forgetTab(tabId).catch(() => {}); });
