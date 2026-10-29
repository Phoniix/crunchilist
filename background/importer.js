// History import: read newest first down to the last checkpoint, continue an unfinished older read,
// match, preview, apply to AniList with an undo log. Checkpoints only move once a preview is applied or
// dismissed, so nothing read is ever lost, and history already read is never read again.
import { anilist } from "../lib/anilist-api.js";
import { readEntry, readList, saveEntry, deleteEntry } from "../lib/anilist-list.js";
import { ACCOUNT_URL, CATCH_UP_DAYS, catchUpCheckpoint, groupRows, historyPageUrl, newerThan, parsePage } from "../lib/crunchyroll-history.js";
import { groupEpisodes } from "../lib/episode-groups.js";
import { readAllShows } from "../lib/idb.js";
import { LIVE_ACTION_NAMES, groupNetflix, parseActivity, parseNetflixCsv } from "../lib/netflix-history.js";
import { GENERAL_RULES, checkGeneral, matchGroups, planChanges, watchedParts } from "../lib/import-plan.js";
import { keepLogs } from "../lib/import-log.js";
import { KEYS } from "../lib/keys.js";
import { anyPreview, asPreviewMap, blockingPreview, packPreviewMap } from "../lib/import-previews.js";
import { LIST_SOURCES, kitsuLibraryUrl, kitsuUserUrl, mergeRows, parseKitsuPage, parseMalXml, resolveIds } from "../lib/list-import.js";
import { createMatcher } from "../lib/match-engine.js";
import { matchKey, matchWithMemory, remember } from "../lib/remembered.js";
import { parseHidivePage } from "../lib/hidive-history.js";
import { parsePrimePage } from "../lib/prime-history.js";
import { listChange, safeChange, sameDate } from "../lib/safe-change.js";
import { anilistSession } from "../lib/settings.js";
import { connectedIds, serviceById } from "../lib/services.js";
import { cleanKitsuLink } from "../lib/trackers.js";
import { shouldBumpContinueFromImport } from "../lib/continue-activity.js";
import { noteActivity, pushSystemNotice } from "./app-notices.js";
import { mirrorAppliedChanges, noteContinueFromTrackedPlay } from "./continue-activity.js";
import { pullMalRows, pushMalChange } from "./mal-store.js";
import { findOpenServiceTab, injectSiteScripts } from "./site-scripts.js";
import { loadState } from "./store.js";

const TAB_KEYS = {
  netflix: KEYS.netflixTab,
  prime: KEYS.primeTab,
  hidive: KEYS.hidiveTab,
  tubi: KEYS.tubiTab,
};

function tabErrorMessage(raw, missing) {
  const text = String(raw || "");
  if (/disallow|permission|must request permission|Cannot access contents/i.test(text)) {
    return "This extension can't reach that tab yet. Reconnect the site under Where to watch, open it, reload the page, then try again.";
  }
  if (/Receiving end|establish connection/i.test(text)) {
    return missing;
  }
  return text || missing;
}

async function boundTabId(serviceId) {
  const key = TAB_KEYS[serviceId];
  if (!key) return null;
  let tabId = (await chrome.storage.session.get(key))[key];
  if (tabId != null && !(await chrome.tabs.get(tabId).catch(() => null))) tabId = null;
  if (tabId == null) {
    tabId = await findOpenServiceTab(serviceId);
    if (tabId != null) await chrome.storage.session.set({ [key]: tabId });
  }
  return tabId;
}

async function waitTabComplete(tabId, { tries = 40, ms = 500 } = {}) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return false;
    if (tab.status === "complete") return true;
    await sleep(ms);
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return Boolean(tab && tab.status === "complete");
}

// True when the site's content script can already answer — skip reload then (Netflix especially races after reload).
// Netflix uses a cheap ping (full profile can take many seconds while the page boots).
async function siteTabAlive(serviceId, tabId) {
  const probe = {
    netflix: { type: "netflixPing" },
    hidive: { type: "hidiveHistory", page: 1 },
    prime: { type: "primeHistory", token: "" },
    tubi: { type: "tubiCatalog" },
  }[serviceId];
  if (!probe || tabId == null) return false;
  const reply = await chrome.tabs.sendMessage(tabId, probe).catch(() => null);
  return Boolean(reply?.ok);
}

async function waitSiteAlive(serviceId, tabId, { tries = 24, ms = 500 } = {}) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (cancelled) return false;
    if (await siteTabAlive(serviceId, tabId)) return true;
    if (attempt === 2 || attempt === 8) await injectSiteScripts(serviceId, tabId).catch(() => {});
    await sleep(ms);
  }
  return false;
}

// Soft-refresh already-open site tabs so content scripts / sessions are live before a history read.
// Tabs that already answer are left alone — reloading Netflix mid-session often yields an empty activity page.
// requireAlive: single-site import fails clearly when the tab never comes back; Import all keeps going.
async function refreshOpenSiteTabs(serviceIds, { requireAlive = false } = {}) {
  const ids = [...new Set((serviceIds || []).filter(Boolean))];
  for (const id of ids) {
    if (cancelled) return;
    let tabId = TAB_KEYS[id] ? await boundTabId(id) : null;
    if (tabId == null && id === "crunchyroll") tabId = await findOpenServiceTab("crunchyroll");
    if (tabId == null) continue;
    const name = serviceById(id)?.name || id;
    if (TAB_KEYS[id] && await siteTabAlive(id, tabId)) {
      setJob({ note: `Using open ${name} tab…` });
      continue;
    }
    setJob({ note: `Refreshing ${name}…` });
    await chrome.tabs.reload(tabId).catch(() => {});
    await waitTabComplete(tabId);
    if (TAB_KEYS[id]) {
      await injectSiteScripts(id, tabId);
      if (!(await waitSiteAlive(id, tabId))) {
        if (requireAlive) {
          throw Object.assign(
            new Error(`Open ${name} in a tab while signed in${id === "netflix" ? " and pick your profile" : ""}, then try again.`),
            { code: "tab" },
          );
        }
      }
    } else {
      await sleep(250);
    }
  }
}
const MAX_PAGES = 5000;
const DRAFT_EVERY = 10;
const PAGE_GAP_MS = 250;
const WRITE_GAP_MS = 700;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const load = async (key, fallback) => (await chrome.storage.local.get(key))[key] ?? fallback;
const save = (key, value) => chrome.storage.local.set({ [key]: value });

async function previewMap() {
  return asPreviewMap(await load(KEYS.importPreview, null));
}

async function writePreview(preview) {
  const services = await previewMap();
  services[preview.service] = preview;
  await save(KEYS.importPreview, packPreviewMap(services));
}

async function clearPreview(service) {
  const services = await previewMap();
  if (service) delete services[service];
  else Object.keys(services).forEach((key) => delete services[key]);
  if (Object.keys(services).length) await save(KEYS.importPreview, packPreviewMap(services));
  else await chrome.storage.local.remove(KEYS.importPreview);
}

let job = { phase: "idle", running: false, service: "", note: "", done: 0, total: 0, error: "" };
let cancelled = false;
let matcherCache = { updated: "", matcher: null };

// sites: Import all's per-site progress, [{ id, name, state: waiting|reading|done|skipped, seen, found, note }];
// trigger: "daily" or "tracking" for background updates. Any other job starting clears both.
function setJob(patch) {
  job = { ...job, ...(patch.running === true ? { sites: null, trigger: "" } : {}), ...patch };
}

function setSite(id, patch) {
  if (job.sites) setJob({ sites: job.sites.map((site) => (site.id === id ? { ...site, ...patch } : site)) });
}

async function anilistAuth() {
  // Prefer the main Kivori SekAI AniList sign-in, then fall back to a mirrored Search session.
  // A stale ksAnilistSession must never win over a fresh main token after reconnect.
  // Static imports only — dynamic import() is disallowed on ServiceWorkerGlobalScope.
  const state = await loadState();
  const main = anilistSession(state.settings);
  if (main.connected && main.token && main.viewerId) {
    await chrome.storage.local.set({
      [KEYS.session]: {
        token: main.token,
        expiresAt: state.settings?.anilistExpiresAt || 0,
        viewer: { id: main.viewerId, name: main.viewerName || "", avatar: "" },
        connectedAt: Date.now(),
      },
    });
    return { token: main.token, userId: main.viewerId };
  }
  const session = (await chrome.storage.local.get(KEYS.session))[KEYS.session];
  if (session?.token && !(session.expiresAt && session.expiresAt <= Date.now()) && session.viewer?.id) {
    return { token: session.token, userId: session.viewer.id };
  }
  if (!main.token) throw new Error("Connect AniList first, in Settings.");
  if (main.expired) throw new Error("AniList sign-in expired. Reconnect under Account.");
  throw new Error("AniList didn't share your account. Disconnect and connect AniList again.");
}

export async function matcher() {
  const { rows, header } = await readAllShows();
  if (!rows.length) throw new Error("The master list hasn't downloaded yet. Open Settings and click Check now.");
  if (matcherCache.updated !== header?.updated || !matcherCache.matcher) matcherCache = { updated: header?.updated || "", matcher: createMatcher(rows) };
  return matcherCache.matcher;
}

// ---- Crunchyroll ----

export async function saveCrunchyrollToken(token) {
  if (typeof token !== "string" || token.length < 20 || token.length > 4000 || /\s/.test(token)) return;
  await chrome.storage.session.set({ [KEYS.crunchyrollAuth]: { token, at: Date.now() } });
}

async function crunchyrollToken() {
  const stored = (await chrome.storage.session.get(KEYS.crunchyrollAuth))[KEYS.crunchyrollAuth];
  if (stored?.token) return stored.token;
  // Main extension already keeps the browse token from the Crunchyroll page hook.
  const { crCatalogToken } = await chrome.storage.session.get("crCatalogToken");
  if (typeof crCatalogToken === "string" && crCatalogToken.length >= 20) return crCatalogToken;
  throw Object.assign(new Error("Open Crunchyroll in a tab while signed in, then start the import again."), { code: "tab" });
}

export async function crGet(url) {
  for (let attempt = 1; ; attempt += 1) {
    const token = await crunchyrollToken();
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } }).catch((error) => ({ ok: false, status: 0, error }));
    if (response.ok) return response.json();
    if (response.status === 401 || response.status === 403) {
      if (attempt === 1) {
        await chrome.storage.session.remove([KEYS.crunchyrollAuth, "crCatalogToken"]).catch(() => {});
        const tabId = await findOpenServiceTab("crunchyroll");
        if (tabId != null) await injectSiteScripts("crunchyroll", tabId).catch(() => {});
        await sleep(2000);
        continue;
      }
      if (attempt < 3) { await sleep(4000); continue; }
      throw Object.assign(new Error("Reload the Crunchyroll tab and try the import again (the page may need a fresh token)."), { code: "auth" });
    }
    if (attempt >= 4) throw new Error(`Crunchyroll didn't answer (${response.status || "offline"}).`);
    await sleep(attempt * 3000);
  }
}

function tokenAccount(token) {
  try {
    const body = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof body?.sub === "string" ? body.sub : "";
  } catch {
    return "";
  }
}

async function crunchyrollAccount() {
  try {
    const me = await crGet(ACCOUNT_URL);
    if (typeof me?.account_id === "string" && me.account_id) return me.account_id;
  } catch (error) {
    if (error.code === "auth") throw error;
  }
  const fromToken = tokenAccount(await crunchyrollToken());
  if (!fromToken) throw new Error("Crunchyroll didn't share your account id. Reload Crunchyroll and try again.");
  return fromToken;
}

// A history source: the account it belongs to, where reading starts, and how to read one page.
async function crunchyrollSource() {
  const account = await crunchyrollAccount();
  return {
    service: "crunchyroll",
    name: "Crunchyroll",
    account,
    label: "",
    first: { url: historyPageUrl(account, 1), page: 1 },
    async page(cursor, seen) {
      const parsed = parsePage(await crGet(cursor.url), seen);
      return { ...parsed, next: { url: parsed.nextUrl || historyPageUrl(account, cursor.page + 1), page: cursor.page + 1 } };
    },
    group: groupRows,
  };
}

async function talkToTab(serviceId, message, { missing, name }) {
  const tabId = await boundTabId(serviceId);
  if (tabId == null) throw Object.assign(new Error(missing), { code: "tab" });
  const send = () => chrome.tabs.sendMessage(tabId, message).then(
    (reply) => reply,
    (error) => ({ __fail: error?.message || String(error) }),
  );
  let reply = await send();
  // Tabs open before Connect never got the registered content script — inject once and retry.
  if (reply?.__fail && /Receiving end|establish connection/i.test(reply.__fail)) {
    await injectSiteScripts(serviceId, tabId);
    await sleep(150);
    reply = await send();
  }
  if (reply?.__fail || reply == null) {
    throw Object.assign(new Error(tabErrorMessage(reply?.__fail, missing)), { code: "tab" });
  }
  if (!reply.ok) throw new Error(reply.error || `${name} didn't answer.`);
  return reply;
}

async function netflixAsk(message) {
  return talkToTab("netflix", message, {
    name: "Netflix",
    missing: "Open Netflix in a tab (reload it if it's already open) and pick your profile, then try again.",
  });
}

async function netflixSource() {
  const profile = await netflixAsk({ type: "netflixProfile" });
  if (!profile.guid) throw Object.assign(new Error("Pick a profile on Netflix first, then start the import again."), { code: "tab" });
  return {
    service: "netflix",
    name: "Netflix",
    account: profile.guid,
    label: profile.name || "",
    first: { page: 0 },
    // Drafts read before Netflix's year and genres were collected are read again.
    rules: 2,
    async page(cursor, seen) {
      for (let attempt = 1; ; attempt += 1) {
        try {
          const { payload } = await netflixAsk({ type: "netflixActivity", page: cursor.page });
          return { ...parseActivity(payload, seen), next: { page: cursor.page + 1 } };
        } catch (error) {
          if (attempt >= 3 || /sign in/i.test(error.message)) throw error;
          await sleep(attempt * 3000);
        }
      }
    },
    group: groupNetflix,
  };
}

const askTab = (serviceId, message, opts) => talkToTab(serviceId, message, opts).then((reply) => reply.payload);

const primeAsk = (message) => askTab("prime", message, { name: "Prime Video", missing: "Open Prime Video in a tab (reload it if it's already open), sign in and pick your profile, then try again." });

// Pages are asked for again a couple of times before giving up, except when the site wants a sign-in.
async function retried(read) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      if (attempt >= 3 || /sign in/i.test(error.message)) throw error;
      await sleep(attempt * 3000);
    }
  }
}

// The first page also says which profile is open, so each profile keeps its own checkpoint.
async function primeSource() {
  const first = await primeAsk({ type: "primeHistory", token: "" });
  return {
    service: "prime",
    name: "Prime Video",
    account: first.profile || "main",
    label: "",
    first: { page: 1, token: "" },
    async page(cursor) {
      const payload = cursor.page === 1 ? first : await retried(() => primeAsk({ type: "primeHistory", token: cursor.token }));
      const parsed = parsePrimePage(payload);
      return { ...parsed, next: { page: cursor.page + 1, token: parsed.nextToken } };
    },
    group: groupEpisodes,
    notes: ["Prime Video lists every episode you started, without how much you watched, so an episode you only opened counts too."],
  };
}

const hidiveAsk = (message) => askTab("hidive", message, { name: "HIDIVE", missing: "Open HIDIVE in a tab (reload it if it's already open) while signed in, then try again." });

// The first page also says which profile is open, so each profile keeps its own checkpoint.
async function hidiveSource() {
  const first = await retried(() => hidiveAsk({ type: "hidiveHistory", page: 1 }));
  return {
    service: "hidive",
    name: "HIDIVE",
    account: first.profile || "main",
    label: "",
    first: { page: 1 },
    async page(cursor) {
      const payload = cursor.page === 1 ? first : await retried(() => hidiveAsk({ type: "hidiveHistory", page: cursor.page }));
      return { ...parseHidivePage(payload), next: { page: cursor.page + 1 } };
    },
    group: groupEpisodes,
    notes: ["Only episodes HIDIVE shows as mostly watched count."],
  };
}

// Sites with no history keep a log of episodes noticed finishing (tracking as you watch), read like a one-page history.
function trackedSource(service) {
  return async () => {
    const rows = (await load(KEYS.watchLog, [])).filter((row) => row?.service === service);
    const name = serviceById(service)?.name || service;
    return {
      service,
      name,
      account: "main",
      label: "",
      tracked: true,
      first: { page: 1 },
      async page() {
        return { rows, count: rows.length, total: null, more: false, next: null };
      },
      group: groupEpisodes,
      notes: [`Episodes noticed finishing on ${name} while you watched.`],
    };
  };
}

// Reads pages from `cursor` until the checkpoint, the end of history, or a failure. Saves a draft so a stopped read resumes.
async function readPages({ draft, source, cursor, newest, checkpoint, phase }) {
  let reachedCheckpoint = false;
  let ended = false;
  let failed = "";
  let hitPageCap = false;
  for (let count = 0; cursor && cursor.page <= MAX_PAGES; count += 1) {
    if (cancelled) throw new DOMException("Cancelled", "AbortError");
    let parsed;
    try {
      parsed = await source.page(cursor, draft.seen);
    } catch (error) {
      failed = error.message;
      break;
    }
    draft.seen += parsed.count;
    if (count === 0 && phase === "newer" && parsed.rows[0]) newest.value = { newestAt: parsed.rows[0].playedAt, newestKey: parsed.rows[0].key };
    const kept = phase === "newer" ? newerThan(parsed.rows, checkpoint) : { rows: parsed.rows, reached: false };
    draft.rows.push(...kept.rows);
    draft.fresh = (draft.fresh || 0) + kept.rows.length;
    if (parsed.rows.length) draft.oldestAt = parsed.rows[parsed.rows.length - 1].playedAt;
    setJob({ note: `Reading your ${source.name} history… ${draft.seen.toLocaleString()} entries`, done: draft.seen, total: parsed.total || 0 });
    if (kept.reached) { reachedCheckpoint = true; break; }
    if (!parsed.more) { ended = true; cursor = null; break; }
    if (cursor.page >= MAX_PAGES) {
      hitPageCap = true;
      cursor = null;
      break;
    }
    cursor = parsed.next;
    if (phase === "older") draft.cursor = cursor;
    if (count % DRAFT_EVERY === 0) await save(KEYS.importDraft, draft);
    await sleep(PAGE_GAP_MS);
  }
  return { reachedCheckpoint, ended, failed, cursor, hitPageCap };
}

// catchUp: last few days (or since the last checkpoint if newer); never walks older history / never marks end.
async function readHistory(source, { full, catchUp = false }) {
  const { service, account } = source;
  const checkpoints = await load(KEYS.checkpoints, {});
  const ckey = `${service}:${account}`;
  const stored = full ? {} : checkpoints[ckey] || {};
  const checkpoint = catchUp ? catchUpCheckpoint(stored) : stored;
  let draft = await load(KEYS.importDraft, null);
  if (!draft || draft.service !== service || draft.account !== account || draft.full !== Boolean(full) || (draft.rules || 0) !== (source.rules || 0) || Boolean(draft.catchUp) !== Boolean(catchUp)) {
    draft = { service, account, full: Boolean(full), catchUp: Boolean(catchUp), rules: source.rules || 0, rows: [], seen: 0, fresh: 0, newer: null, cursor: null, oldestAt: 0, startedAt: Date.now() };
  }
  const newest = { value: draft.newer?.newest || null };
  const notes = [];

  // 1. Newer than the checkpoint (everything, the first time; catch-up stops at the recent window).
  let stopped = false;
  if (!draft.newer?.done) {
    const read = await readPages({ draft, source, cursor: source.first, newest, checkpoint, phase: "newer" });
    if (read.hitPageCap) notes.push(`Reached the import page cap (${MAX_PAGES} pages). Older history was not read; run a full rescan later if needed.`);
    if (read.failed) {
      // A short catch-up read simply runs again; a long first read keeps what it has and continues later.
      if (checkpoint.newestAt || !draft.rows.length) {
        await save(KEYS.importDraft, draft);
        throw new Error(read.failed);
      }
      stopped = true;
      notes.push(`Stopped early: ${read.failed} The next import continues from there.`);
    }
    draft.newer = { done: true, newest: newest.value };
    if (!catchUp && !stored.newestAt && !read.ended && !read.reachedCheckpoint) draft.cursor = read.cursor;
    // A recent-only source ends where its page ends, not where the history does.
    if (!catchUp && read.ended && !source.recentOnly) draft.reachedEnd = true;
    if (source.recentOnly && stored.newestAt && !read.reachedCheckpoint) {
      notes.push(`The recent history didn't reach back to the last import (${new Date(stored.newestAt).toLocaleDateString()}), so some episodes in between may be missing. Upload a Google Takeout file to fill them in.`);
    }
    if (catchUp && !(Number(stored.newestAt) > checkpoint.newestAt)) {
      notes.push(`Catch-up reads the last ${CATCH_UP_DAYS} days of history.`);
    }
    await save(KEYS.importDraft, draft);
  }
  // 2. An older read left unfinished last time (or this time) continues from its cursor.
  const resume = draft.cursor || (!draft.reachedEnd && stored.resume) || null;
  if (resume && Number.isInteger(resume.page) && !stored.end && !stopped && !catchUp) {
    const read = await readPages({ draft, source, cursor: resume, newest, checkpoint: null, phase: "older" });
    if (read.ended) { draft.reachedEnd = true; draft.cursor = null; }
    else if (read.failed) { draft.cursor = read.cursor; notes.push(`Stopped early: ${read.failed} The next import continues from there.`); }
    await save(KEYS.importDraft, draft);
  }
  const nextCheckpoint = {
    newestAt: newest.value?.newestAt || stored.newestAt || 0,
    newestKey: newest.value?.newestKey || stored.newestKey || "",
    // Catch-up never claims a full archive; keep any prior end flag only.
    end: Boolean(catchUp ? stored.end : (stored.end || draft.reachedEnd)),
    oldestAt: catchUp ? stored.oldestAt || 0 : (draft.reachedEnd ? draft.oldestAt : stored.oldestAt || 0),
    resume: catchUp ? stored.resume || null : (draft.reachedEnd ? null : draft.cursor || stored.resume || null),
    label: source.label || stored.label || "",
  };
  return { ckey, rows: draft.rows, seen: draft.fresh || 0, checkpoint: nextCheckpoint, notes };
}

// ---- Matching and preview ----

// Picks queued for general services under older, looser rules are cleared.
async function loadPending() {
  const store = await load(KEYS.pending, {});
  const kept = Object.fromEntries(Object.entries(store).filter(([, item]) => item.service === "crunchyroll" || item.skipped || (item.rules || 0) >= GENERAL_RULES));
  if (Object.keys(kept).length !== Object.keys(store).length) await save(KEYS.pending, kept);
  return kept;
}

function mergePending(store, items) {
  const next = { ...store };
  for (const item of items) {
    const old = next[item.key];
    if (old?.skipped) continue;
    if (old) {
      const played = { ...old.input.played };
      for (const [episode, at] of Object.entries(item.input.played || {})) played[episode] = played[episode] ? Math.min(played[episode], at) : at;
      const episodes = Object.keys(played).map(Number).sort((a, b) => a - b);
      next[item.key] = { ...old, ...item, input: { ...item.input, played, episodes }, at: old.at };
    } else next[item.key] = { ...item, at: Date.now() };
  }
  return next;
}

// Every service but Crunchyroll carries more than anime, so titles with no anime match there are counted, not queued.
const isGeneral = (service) => service !== "crunchyroll";

// service: the one service read, or "all" for Import all, where each group carries its own service.
// checkpoints: [{ ckey, checkpoint }] that move once the preview is applied or dismissed.
async function buildPreview({ service, groups, checkpoints = [], seen, notes, trigger = "" }) {
  setJob({ phase: "matching", note: "Matching shows to AniList…", done: 0, total: groups.length });
  const engine = await matcher();
  let memory = await load(KEYS.matches, {});
  const matchOne = (group) => {
    const found = matchWithMemory(engine, memory, group.key, group);
    if (!isGeneral(group.service) || memory[group.key]?.by === "user") return found;
    const name = serviceById(group.service)?.name || group.service;
    return checkGeneral(engine, group, { ...found, remembered: false }, LIVE_ACTION_NAMES, name);
  };
  const { watched, pending: found, dropped, droppedNames } = matchGroups(groups, matchOne, { dropUnmatched: (group) => isGeneral(group.service) });
  const pending = found.map((item) => (isGeneral(item.service) ? { ...item, rules: GENERAL_RULES } : item));
  // Shows the service calls anime that still found no AniList entry: the ones worth a second look.
  const placed = new Set([...watched.map((item) => item.source.key), ...pending.map((item) => item.key)]);
  const animeMissed = groups.filter((group) => group.anime === true && !placed.has(group.key)).map((group) => [group.series, group.season].filter(Boolean).join(" — "));
  const netflix = groups.filter((group) => group.service === "netflix");
  if (netflix.some((group) => group.year || group.anime != null)) {
    const genres = netflix.filter((group) => group.anime != null).length;
    const years = netflix.filter((group) => group.year).length;
    notes = [...notes, `Netflix shared genres for ${genres} of ${netflix.length} shows and years for ${years}; titles it doesn't file under anime are left out.`];
  }
  for (const group of groups) {
    const item = watched.find((part) => part.source.key === group.key);
    if (item && !item.source.remembered) memory = remember(memory, group.key, { anilistId: item.anilistId, how: item.source.how, confidence: "high" }, { names: [`${group.series} — ${group.season}`] });
  }
  await save(KEYS.matches, memory);
  await save(KEYS.pending, mergePending(await loadPending(), pending));

  setJob({ phase: "anilist", note: "Checking your AniList list…" });
  const auth = await anilistAuth();
  const ids = [...new Set(watched.map((item) => item.anilistId))];
  const { entries, media } = await readList(ids, { ...auth, onProgress: (done, total) => setJob({ done, total }) });
  const { changes, unchanged } = planChanges(watched, entries, media);
  const preview = {
    id: `${service}-${Date.now()}`,
    service,
    trigger,
    createdAt: Date.now(),
    checkpoints,
    changes: changes.map((change) => ({ ...change, media: media.get(change.anilistId), watched: { progress: change.after.progress, firstPlayed: watchedFor(watched, change.anilistId).firstPlayed, lastPlayed: watchedFor(watched, change.anilistId).lastPlayed } })),
    stats: { entries: seen, seasons: groups.length, matched: groups.length - pending.length - dropped, pending: pending.length, dropped, unchanged },
    droppedNames: droppedNames.slice(0, 500),
    animeMissed: animeMissed.slice(0, 300),
    rules: GENERAL_RULES,
    notes,
  };
  await writePreview(preview);
  // Seed Continue Watching as soon as the preview knows a bumpable play — don't wait for Apply.
  for (const change of preview.changes || []) {
    if (!shouldBumpContinueFromImport({
      after: change.after,
      before: change.before,
      episodes: change.episodes,
      watched: change.watched,
    })) continue;
    const source = change.sources?.[0];
    const fromKey = String(source?.key || "").split(":")[0];
    const playService = fromKey || (service !== "all" ? service : "import");
    await noteContinueFromTrackedPlay({
      service: playService,
      series: change.title || source?.series || "",
      season: source?.season || "",
      episode: change.after?.progress,
      anilistId: change.anilistId,
    }).catch(() => {});
  }
  await notifyPreviewReady(preview).catch(() => {});
  return preview;
}

async function notifyPreviewReady(preview) {
  if (!preview?.changes?.length) return;
  const n = preview.changes.length;
  const fromSync = preview.trigger === "daily" || preview.trigger === "tracking";
  const label = TRIGGERS[preview.trigger] || "Import";
  const skipNote = (preview.notes || []).find((note) => /^Skipped:/i.test(note)) || "";
  await pushSystemNotice({
    kind: fromSync ? "sync_preview" : preview.trigger === "tracker" ? "tracker_preview" : "import_preview",
    title: fromSync ? `${label} found changes` : "Import preview ready",
    message: `${n} change${n === 1 ? "" : "s"} ready to review in Import.${skipNote ? ` ${skipNote}` : ""}`,
    href: "#settings/import",
    count: n,
  }, {
    kind: fromSync ? (preview.trigger === "tracking" ? "tracking" : "sync") : "import",
    title: `${label}: ${n} change${n === 1 ? "" : "s"} to review${skipNote ? ` · ${skipNote}` : ""}`,
    ok: !skipNote,
  });
}

function watchedFor(watched, anilistId) {
  const items = watched.filter((item) => item.anilistId === anilistId);
  const firsts = items.map((item) => item.firstPlayed).filter(Boolean);
  return { firstPlayed: firsts.length ? Math.min(...firsts) : 0, lastPlayed: Math.max(0, ...items.map((item) => item.lastPlayed)) };
}

// Checks run right away so the page hears about problems; the long read then runs on its own.
const SOURCES = {
  crunchyroll: crunchyrollSource,
  netflix: netflixSource,
  prime: primeSource,
  tubi: trackedSource("tubi"),
  hidive: hidiveSource,
};

async function readyToStart(service = "") {
  if (job.running) throw new Error("An import is already running.");
  const blocked = blockingPreview(await previewMap(), service || "all");
  if (blocked) {
    const name = blocked.service === "all" ? "Import all" : (serviceById(blocked.service)?.name || blocked.service);
    throw new Error(`Apply or dismiss the ${name} preview first.`);
  }
  await anilistAuth();
}

export async function startImport({ service = "crunchyroll", full = false } = {}) {
  if (!SOURCES[service]) throw new Error("That service's import isn't ready yet.");
  await readyToStart(service);
  cancelled = false;
  setJob({ phase: "reading", running: true, service, note: `Refreshing ${serviceById(service)?.name || service}…`, done: 0, total: 0, error: "", message: "", sites: null });
  try {
    await refreshOpenSiteTabs([service], { requireAlive: Boolean(TAB_KEYS[service]) });
    if (service === "crunchyroll") await crunchyrollToken();
    else if (TAB_KEYS[service] && (await boundTabId(service)) == null) {
      throw Object.assign(new Error(`Open ${serviceById(service)?.name || service} in a tab (reload it if it's already open), then try again.`), { code: "tab" });
    }
    const source = await SOURCES[service]();
    setJob({ note: `Connecting to ${source.name}…` });
    runImport(async () => {
      const read = await readHistory(source, { full });
      return { ...read, notes: [...(source.notes || []), ...read.notes], group: source.group };
    }, service).catch(() => {});
  } catch (error) {
    setJob({ phase: "idle", running: false, error: error?.name === "AbortError" ? "" : (error?.message || "Import failed."), note: "" });
    throw error;
  }
}

// Netflix's "Download all" file: read once, no checkpoint, the same matching and preview.
export async function importNetflixCsv(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("That file is empty.");
  if (text.length > 30_000_000) throw new Error("That file is too big.");
  await readyToStart("netflix");
  const rows = parseNetflixCsv(text);
  if (!rows.length) throw new Error("That doesn't look like Netflix's viewing activity file (NetflixViewingHistory.csv).");
  cancelled = false;
  setJob({ phase: "matching", running: true, service: "netflix", note: "Reading your Netflix file…", done: 0, total: 0, error: "", message: "" });
  runImport(async () => ({ ckey: null, checkpoint: null, rows, seen: rows.length, notes: ["From your uploaded Netflix file. It has no genres, years or how much of each episode you watched, so check this list closely: non-anime with the same name as an anime can slip in. Importing from the Netflix tab is more accurate."], group: groupNetflix }), "netflix").catch(() => {});
}

// ---- Lists from other trackers ----

const MAX_KITSU_PAGES = 40;
const MAL_LOOKUP = `query ($ids: [Int]) { Page(perPage: 50) { media(idMal_in: $ids, type: ANIME) { id idMal } } }`;

async function kitsuGet(url) {
  const response = await fetch(url, { headers: { accept: "application/vnd.api+json" } }).catch(() => null);
  if (!response) throw new Error("Kitsu didn't answer. Check your connection.");
  if (!response.ok) throw new Error(`Kitsu answered ${response.status}.`);
  return response.json();
}

async function readKitsu(username) {
  if (!(await chrome.permissions.contains({ origins: [LIST_SOURCES.kitsu.origin] }))) throw new Error("Allow Kitsu first: click Import from Kitsu again and accept Chrome's prompt.");
  const users = await kitsuGet(kitsuUserUrl(username));
  const user = users?.data?.[0];
  if (!user?.id) throw new Error(`Kitsu has no user called "${username}". Use the name in your profile link (kitsu.app/users/NAME).`);
  const rows = [];
  for (let page = 0; page < MAX_KITSU_PAGES; page += 1) {
    if (cancelled) throw new DOMException("Cancelled", "AbortError");
    const parsed = parseKitsuPage(await kitsuGet(kitsuLibraryUrl(user.id, page * 500)));
    rows.push(...parsed.rows);
    setJob({ note: `Reading ${user.attributes?.name || username}'s Kitsu library… ${rows.length.toLocaleString()} shows` });
    if (!parsed.more) break;
    await sleep(PAGE_GAP_MS);
  }
  const link = cleanKitsuLink({ username, userId: Number(user.id), at: Date.now(), lastPull: Date.now() });
  if (link) await save(KEYS.kitsuLink, link);
  return { rows, label: user.attributes?.name || username };
}

// MAL ids the master list doesn't know yet are asked of AniList directly, 50 at a time.
async function lookupMal(missing) {
  const malIds = [...new Set(missing.map((row) => row.malId).filter(Boolean))];
  const byMal = new Map();
  for (let index = 0; index < malIds.length; index += 50) {
    const data = await anilist(MAL_LOOKUP, { ids: malIds.slice(index, index + 50) }).catch(() => null);
    for (const media of data?.Page?.media || []) byMal.set(media.idMal, media.id);
  }
  return missing.map((row) => ({ ...row, anilistId: byMal.get(row.malId) || null }));
}

async function buildListPreview(source, rows, label) {
  setJob({ phase: "matching", note: "Finding each show on AniList…", done: 0, total: rows.length });
  const { rows: master } = await readAllShows();
  if (!master.length) throw new Error("The master list hasn't downloaded yet. Open Settings and click Check now.");
  const first = resolveIds(rows, master);
  const looked = first.missing.length ? await lookupMal(first.missing) : [];
  const found = mergeRows([...first.resolved, ...looked.filter((row) => row.anilistId)]);
  const missing = looked.filter((row) => !row.anilistId);
  setJob({ phase: "anilist", note: "Checking your AniList list…" });
  const auth = await anilistAuth();
  const { entries, media } = await readList(found.map((row) => row.anilistId), { ...auth, onProgress: (done, total) => setJob({ done, total }) });
  const changes = [];
  let unchanged = 0;
  for (const row of found) {
    const info = media.get(row.anilistId);
    if (!info) { missing.push(row); continue; }
    const theirs = { status: row.status, progress: row.progress, startedAt: row.startedAt, completedAt: row.completedAt };
    const change = listChange(entries.get(row.anilistId) || null, info, theirs);
    if (!change) { unchanged += 1; continue; }
    changes.push({
      anilistId: row.anilistId, title: info.title || row.title, episodes: info.episodes || null,
      entryId: entries.get(row.anilistId)?.id || null, malId: row.malId || null,
      ...change, media: info, theirs, sources: [{ series: row.title, season: "" }],
    });
  }
  const name = LIST_SOURCES[source].name;
  const preview = {
    id: `${source}-${Date.now()}`,
    service: source,
    createdAt: Date.now(),
    ckey: null,
    checkpoint: null,
    changes,
    stats: { entries: rows.length, seasons: rows.length, matched: found.length, pending: 0, dropped: missing.length, unchanged },
    droppedNames: missing.map((row) => row.title).slice(0, 500),
    animeMissed: [],
    rules: GENERAL_RULES,
    notes: [`From ${label ? `${label}'s ` : "your "}${name} list. Shows already further along on AniList are left alone, and nothing is ever lowered.${missing.length ? ` ${missing.length} couldn't be found on AniList and are listed below.` : ""}`],
  };
  await writePreview(preview);
  await notifyPreviewReady({ ...preview, trigger: "tracker" }).catch(() => {});
  return preview;
}

async function runListImport(source, read) {
  try {
    const { rows, label } = await read();
    if (!rows.length) {
      setJob({ phase: "idle", running: false, note: "", message: `That ${LIST_SOURCES[source].name} list is empty.` });
      return;
    }
    await buildListPreview(source, rows, label);
    setJob({ phase: "preview", running: false, note: "" });
  } catch (error) {
    setJob({ phase: "idle", running: false, error: error.name === "AbortError" ? "" : error.message, note: "" });
  }
}

export async function importMalFile(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("That file is empty.");
  if (text.length > 60_000_000) throw new Error("That file is too big.");
  await readyToStart("mal");
  const rows = parseMalXml(text);
  if (!rows.length) throw new Error("That doesn't look like a MyAnimeList anime list export (animelist_….xml).");
  cancelled = false;
  setJob({ phase: "matching", running: true, service: "mal", note: "Reading your MyAnimeList file…", done: 0, total: 0, error: "", message: "" });
  runListImport("mal", async () => ({ rows, label: "" }));
}

// Connected MAL account: pull the live animelist via OAuth (weekly pull / Accounts → Pull now).
export async function importMalApi() {
  await readyToStart("mal");
  cancelled = false;
  setJob({ phase: "reading", running: true, service: "mal", note: "Reading your MyAnimeList…", done: 0, total: 0, error: "", message: "" });
  return runListImport("mal", async () => {
    const rows = await pullMalRows();
    if (!rows.length) throw new Error("Your MyAnimeList anime list is empty.");
    return { rows, label: "" };
  });
}

export async function importKitsu(username) {
  const name = String(username || "").trim().replace(/^https?:\/\/kitsu\.(app|io)\/users\//i, "").replace(/\/.*$/, "");
  if (!/^[\w.-]{2,40}$/.test(name)) throw new Error("Enter your Kitsu username, as in kitsu.app/users/NAME.");
  await readyToStart("kitsu");
  cancelled = false;
  setJob({ phase: "reading", running: true, service: "kitsu", note: "Connecting to Kitsu…", done: 0, total: 0, error: "", message: "" });
  runListImport("kitsu", () => readKitsu(name));
}

export async function importKitsuFromLink(username) {
  return importKitsu(username);
}

async function runImport(read, service) {
  try {
    const result = await read();
    const groups = result.group(result.rows).map((group) => ({ ...group, service, key: matchKey(service, group.seriesId, group.seasonId) }));
    const checkpoints = result.ckey ? [{ ckey: result.ckey, checkpoint: result.checkpoint }] : [];
    if (!groups.length) {
      if (checkpoints.length) await commitCheckpoint({ checkpoints });
      setJob({ phase: "idle", running: false, note: "", message: result.seen ? `No newly finished episodes in ${result.seen.toLocaleString()} new history entries.` : "Nothing new since your last import." });
      return null;
    }
    const preview = await buildPreview({ service, groups, checkpoints, seen: result.seen, notes: result.notes });
    setJob({ phase: "preview", running: false, note: "" });
    return preview;
  } catch (error) {
    setJob({ phase: "idle", running: false, error: error.name === "AbortError" ? "" : error.message, note: "" });
    if (error.name !== "AbortError") throw error;
    return null;
  }
}

// ---- Import all: every connected site in turn, one preview ----

// Sites are read one after another, never opened by the extension: a site whose tab isn't ready is skipped and listed.
export async function startImportAll() {
  await readyToStart("all");
  const connected = new Set(connectedIds((await chrome.permissions.getAll()).origins));
  connected.add("crunchyroll");
  const services = Object.keys(SOURCES).filter((id) => connected.has(id));
  if (!services.length) throw new Error("Connect a site first (Crunchyroll, Netflix, Prime Video or HIDIVE), under Where to watch.");
  // Bind and soft-refresh already-open tabs so Import all doesn't skip them for a missing hello.
  for (const id of services) if (TAB_KEYS[id]) await boundTabId(id);
  cancelled = false;
  const sites = services.map((id) => ({ id, name: serviceById(id)?.name || id, state: "waiting", seen: 0, found: 0, note: "" }));
  setJob({ phase: "reading", running: true, service: "all", note: "Refreshing open site tabs…", done: 0, total: 0, error: "", message: "", sites });
  try {
    await refreshOpenSiteTabs(services);
    setJob({ note: "Starting Import all…" });
    runImportAll(services).catch(() => {});
  } catch (error) {
    setJob({ phase: "idle", running: false, error: error?.name === "AbortError" ? "" : (error?.message || "Import failed."), note: "" });
    throw error;
  }
}

// Reads each site in turn; a site that fails is skipped and listed, the rest carry on.
// catchUp: last few days of history (or since the last checkpoint if newer) — no full-import gate.
async function readSites(services, { catchUp = false } = {}) {
  const out = { groups: [], checkpoints: [], notes: [], skipped: [], summary: [], seen: 0 };
  for (const service of services) {
    if (cancelled) throw new DOMException("Cancelled", "AbortError");
    const name = serviceById(service)?.name || service;
    try {
      setJob({ phase: "reading", note: `Connecting to ${name}…`, done: 0, total: 0 });
      setSite(service, { state: "reading" });
      if (service === "crunchyroll") await crunchyrollToken();
      const source = await SOURCES[service]();
      const read = await readHistory(source, { full: false, catchUp });
      const found = source.group(read.rows).map((group) => ({ ...group, service, key: matchKey(service, group.seriesId, group.seasonId) }));
      out.groups.push(...found);
      out.checkpoints.push({ ckey: read.ckey, checkpoint: read.checkpoint });
      out.seen += read.seen;
      out.summary.push(`${name}: ${read.seen ? `${read.seen.toLocaleString()} new history ${read.seen === 1 ? "entry" : "entries"}, ${found.length.toLocaleString()} ${found.length === 1 ? "show or season" : "shows or seasons"} with finished episodes.` : "nothing new since the last import."}`);
      out.notes.push(...[...(source.notes || []), ...read.notes].map((note) => `${name}: ${note}`));
      setSite(service, { state: "done", seen: read.seen, found: found.length });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      out.skipped.push({ service, name, error: error.message });
      setSite(service, { state: "skipped", note: error.message });
    }
  }
  out.skippedNote = out.skipped.length ? [`Skipped: ${out.skipped.map((item) => `${item.name} (${item.error})`).join(" ")}`] : [];
  return out;
}

async function runImportAll(services) {
  try {
    const read = await readSites(services);
    if (!read.groups.length) {
      if (read.checkpoints.length) await commitCheckpoint({ checkpoints: read.checkpoints });
      setJob({ phase: "idle", running: false, note: "", message: [...read.summary, ...read.skippedNote].join(" ") || "Nothing new since your last import." });
      return;
    }
    await buildPreview({ service: "all", groups: read.groups, checkpoints: read.checkpoints, seen: read.seen, notes: [...read.summary, ...read.skippedNote, ...read.notes] });
    setJob({ phase: "preview", running: false, note: "" });
  } catch (error) {
    setJob({ phase: "idle", running: false, error: error.name === "AbortError" ? "" : error.message, note: "" });
  }
}

// ---- Background updates: daily sync and tracking as you watch ----

export const TRIGGERS = { daily: "Daily sync", tracking: "Tracking" };

// Never touches the user's own work: it waits while an import runs, a preview is open, or a read was stopped partway.
// apply: send the changes straight to AniList (logged, with undo); otherwise leave them as a preview to review.
// Returns { ran, why?, attempted, message }.
export async function backgroundSync(services, { trigger, apply }) {
  if (job.running) return { ran: false, why: "busy" };
  if (anyPreview(await previewMap())) return { ran: false, why: "preview" };
  if (await load(KEYS.importDraft, null)) return { ran: false, why: "draft" };
  await anilistAuth();
  const ids = services.filter((id) => SOURCES[id]);
  if (!ids.length) return { ran: false, why: "none" };
  const label = TRIGGERS[trigger] || "Sync";
  const service = ids.length === 1 ? ids[0] : "all";
  cancelled = false;
  const sites = ids.map((id) => ({ id, name: serviceById(id)?.name || id, state: "waiting", seen: 0, found: 0, note: "" }));
  setJob({ phase: "reading", running: true, service, note: `${label}: starting…`, done: 0, total: 0, error: "", message: "", sites, trigger });
  try {
    // Daily sync / tracking leave open tabs alone; Import all / single-site import soft-refresh them.
    for (const id of ids) if (TAB_KEYS[id]) await boundTabId(id);
    const read = await readSites(ids, { catchUp: true });
    const lines = [...read.summary, ...read.skippedNote];
    const skipNote = read.skippedNote.join(" ");
    if (!read.groups.length) {
      if (read.checkpoints.length) await commitCheckpoint({ checkpoints: read.checkpoints });
      const message = `${label}: ${lines.join(" ") || "nothing new."}`;
      setJob({ phase: "idle", running: false, note: "", message });
      if (skipNote) noteActivity({ kind: "sync", title: message, ok: !read.skipped.length, detail: skipNote }).catch(() => {});
      return { ran: true, attempted: ids, message, skipped: read.skipped };
    }
    const preview = await buildPreview({ service, groups: read.groups, checkpoints: read.checkpoints, seen: read.seen, notes: [...lines, ...read.notes], trigger });
    setJob({ phase: "preview", running: false, note: "" });
    if (!apply) {
      await chrome.action.setBadgeText({ text: "!" }).catch(() => {});
      const n = preview.changes.length;
      const message = `${label}: found ${n} change${n === 1 ? "" : "s"} to review.${skipNote ? ` ${skipNote}` : ""}`;
      return { ran: true, attempted: ids, message, skipped: read.skipped };
    }
    if (!preview.changes.length) {
      await commitCheckpoint(preview);
      const message = `${label}: AniList was already up to date.${skipNote ? ` ${skipNote}` : ""}`;
      setJob({ phase: "idle", message });
      noteActivity({ kind: "sync", title: message, ok: true }).catch(() => {});
      return { ran: true, attempted: ids, message, skipped: read.skipped };
    }
    const result = await applyImport();
    const message = result.error
      ? `${label} stopped: ${result.error}${skipNote ? ` ${skipNote}` : ""}`
      : `${label}: updated ${result.applied} on AniList.${skipNote ? ` ${skipNote}` : ""}`;
    setJob({ message });
    if (!result.error && result.applied > 0) {
      pushSystemNotice({
        kind: "sync_applied",
        title: `${label} updated AniList`,
        message: `Updated ${result.applied} on AniList.${skipNote ? ` ${skipNote}` : ""} Open Past imports to undo if needed.`,
        href: "#imports",
        count: result.applied,
      }, { kind: trigger === "tracking" ? "tracking" : "sync", title: message, ok: !read.skipped.length }).catch(() => {});
    } else if (result.error) {
      noteActivity({ kind: "error", title: message, ok: false }).catch(() => {});
    } else if (skipNote) {
      noteActivity({ kind: "sync", title: message, ok: false, detail: skipNote }).catch(() => {});
    }
    return { ran: true, attempted: ids, message, skipped: read.skipped };
  } catch (error) {
    const message = error.name === "AbortError" ? `${label} was stopped.` : `${label} stopped: ${error.message}`;
    setJob({ phase: "idle", running: false, error: error.name === "AbortError" ? "" : message, note: "" });
    return { ran: true, attempted: ids, message };
  }
}

export function cancelImport() {
  cancelled = true;
}

// Previews saved before Import all carry a single ckey and checkpoint.
const pointsOf = (preview) => (Array.isArray(preview?.checkpoints) ? preview.checkpoints : preview?.ckey ? [{ ckey: preview.ckey, checkpoint: preview.checkpoint }] : [])
  .filter((point) => point?.ckey && point.checkpoint);

async function commitCheckpoint(preview) {
  const points = pointsOf(preview);
  if (points.length) {
    const checkpoints = await load(KEYS.checkpoints, {});
    for (const { ckey, checkpoint } of points) checkpoints[ckey] = { ...checkpoint, savedAt: Date.now() };
    await save(KEYS.checkpoints, checkpoints);
  }
  // A preview from picks or a file isn't a history read, so an unfinished read's draft stays.
  if (points.length) await chrome.storage.local.remove(KEYS.importDraft);
  if (preview?.service) await clearPreview(preview.service);
  else await clearPreview();
  if (!anyPreview(await previewMap())) await chrome.action.setBadgeText({ text: "" }).catch(() => {});
}

// ---- Apply and undo ----

export async function applyImport({ skip = [], service = "" } = {}) {
  if (job.running) throw new Error("Something is already running.");
  const map = await previewMap();
  const preview = (service && map[service]) || map.all || Object.values(map)[0] || null;
  if (!preview) throw new Error("There's no preview to apply.");
  const auth = await anilistAuth();
  const chosen = preview.changes.filter((change) => !skip.includes(change.anilistId));
  cancelled = false;
  setJob({ phase: "saving", running: true, note: "Sending changes to AniList…", done: 0, total: chosen.length, error: "", message: "" });
  const log = { ...reportOf(preview, "applied"), changes: [], skipped: [], left: preview.changes.length - chosen.length, malWrites: 0 };
  try {
    for (const [index, change] of chosen.entries()) {
      if (cancelled) break;
      const fresh = await readEntry(change.anilistId, auth);
      const recheck = change.theirs ? listChange(fresh, change.media, change.theirs) : safeChange(fresh, change.media, change.watched);
      if (!recheck) { log.skipped.push({ anilistId: change.anilistId, title: change.title, why: "already up to date" }); continue; }
      const saved = await saveEntry(change.anilistId, recheck.after, auth);
      const after = pickEntry(saved || recheck.after);
      log.changes.push({ anilistId: change.anilistId, title: change.title, entryId: saved?.id || null, before: fresh ? pickEntry(fresh) : null, after });
      // Full tracking on MAL when connected: mirror the same never-downgrade result.
      const mal = await pushMalChange(change.anilistId, after, change.theirs?.malId || change.malId);
      if (mal?.ok) log.malWrites += 1;
      setJob({ done: index + 1, note: mal?.ok ? "Updating AniList and MyAnimeList…" : "Sending changes to AniList…" });
      await sleep(WRITE_GAP_MS);
    }
  } catch (error) {
    setJob({ error: error.message });
  } finally {
    const logs = keepLogs([log, ...(await load(KEYS.importLog, []))]);
    await save(KEYS.importLog, logs);
    if (!cancelled && !job.error) await commitCheckpoint(preview);
    else if (log.changes.length) {
      const done = new Set(log.changes.map((change) => change.anilistId));
      await writePreview({ ...preview, changes: preview.changes.filter((change) => !done.has(change.anilistId)) });
    }
    setJob({ phase: "idle", running: false, note: "" });
  }
  // Keep Prism Continue watching / My list in step without waiting for an AniList list pull.
  if (log.changes.length) await mirrorAppliedChanges(log.changes, preview.changes).catch(() => {});
  return { applied: log.changes.length, skipped: log.skipped.length, error: job.error };
}

// Dismissing still moves the checkpoint: those entries were read, and their shows stay remembered.
export async function dismissImport({ service = "" } = {}) {
  const map = await previewMap();
  const preview = (service && map[service]) || map.all || Object.values(map)[0] || null;
  if (preview?.stats) await save(KEYS.importLog, keepLogs([{ ...reportOf(preview, preview.changes.length ? "dismissed" : "nothing"), changes: [], skipped: [] }, ...(await load(KEYS.importLog, []))]));
  await commitCheckpoint(preview);
}

// What a past import found, kept with its log entry so it can be looked at later.
function reportOf(preview, outcome) {
  return {
    id: `${preview.id}-${Date.now()}`,
    service: preview.service,
    trigger: preview.trigger || "",
    at: Date.now(),
    outcome,
    stats: preview.stats || null,
    notes: (preview.notes || []).slice(0, 10),
    droppedNames: (preview.droppedNames || []).slice(0, 500),
    animeMissed: (preview.animeMissed || []).slice(0, 300),
    offered: preview.changes.length,
  };
}

const pickEntry = (entry) => ({ status: entry.status || null, progress: entry.progress || 0, startedAt: entry.startedAt || null, completedAt: entry.completedAt || null });
const sameEntry = (a, b) => a && b && a.status === b.status && a.progress === b.progress && sameDate(a.startedAt, b.startedAt) && sameDate(a.completedAt, b.completedAt);

// Puts entries back as they were, skipping any changed on AniList since the import.
export async function undoImport(logId) {
  if (job.running) throw new Error("Something is already running.");
  const logs = await load(KEYS.importLog, []);
  const log = logs.find((item) => item.id === logId);
  if (!log || log.undoneAt) throw new Error("That import was already undone.");
  const auth = await anilistAuth();
  setJob({ phase: "undoing", running: true, note: "Putting your AniList back…", done: 0, total: log.changes.length, error: "", message: "" });
  let restored = 0;
  const kept = [];
  try {
    for (const [index, change] of [...log.changes].reverse().entries()) {
      const current = await readEntry(change.anilistId, auth);
      if (!current || !sameEntry(pickEntry(current), change.after)) { kept.push(change.title || String(change.anilistId)); continue; }
      if (change.before) {
        await saveEntry(change.anilistId, change.before, auth);
        await pushMalChange(change.anilistId, pickEntry(change.before), change.malId);
      } else await deleteEntry(current.id, auth);
      restored += 1;
      setJob({ done: index + 1 });
      await sleep(WRITE_GAP_MS);
    }
  } finally {
    await save(KEYS.importLog, logs.map((item) => (item.id === logId ? { ...item, undoneAt: Date.now(), undoKept: kept } : item)));
    setJob({ phase: "idle", running: false, note: "" });
  }
  return { restored, kept };
}

// ---- Shows that need a pick ----

export async function resolvePending(key, choice) {
  const pending = await load(KEYS.pending, {});
  const item = pending[key];
  if (!item) throw new Error("That show was already handled.");
  if (choice === null) {
    await save(KEYS.pending, { ...pending, [key]: { ...item, skipped: true } });
    return { skipped: true };
  }
  const engine = await matcher();
  const anilistId = Number(choice);
  if (!Number.isInteger(anilistId) || anilistId <= 0) throw new Error("That isn't an AniList anime id.");
  // Entries missing from the master list still work: the episodes watched simply go to that entry as they are.
  const placed = engine.placeOn(anilistId, item.input, "user")
    || { anilistId, parts: [{ anilistId, episodes: item.input.episodes, progress: item.input.episodes.length }] };
  const group = { ...item.input, key, episodes: item.input.episodes, played: item.input.played };
  const watched = watchedParts(group, placed).map((part) => ({ ...part, source: { key, series: item.input.series, season: item.input.season, how: "user", remembered: true } }));
  const auth = await anilistAuth();
  const { entries, media } = await readList(watched.map((part) => part.anilistId), auth);
  if (!media.has(anilistId) && !watched.some((part) => media.has(part.anilistId))) throw new Error("AniList has no anime with that id.");
  await save(KEYS.matches, remember(await load(KEYS.matches, {}), key, { anilistId }, { by: "user", names: [`${item.input.series} — ${item.input.season}`] }));
  const { [key]: _done, ...rest } = pending;
  await save(KEYS.pending, rest);
  const { changes } = planChanges(watched, entries, media);
  const added = changes.map((change) => ({ ...change, media: media.get(change.anilistId), watched: { progress: change.after.progress, ...watchedFor(watched, change.anilistId) } }));
  const map = await previewMap();
  const current = map[item.service] || null;
  if (!added.length) return { added: 0 };
  const preview = current || { id: `${item.service}-picks-${Date.now()}`, service: item.service, createdAt: Date.now(), ckey: null, checkpoint: null, changes: [], stats: null, notes: [], rules: GENERAL_RULES };
  const others = preview.changes.filter((change) => !added.some((next) => next.anilistId === change.anilistId));
  await writePreview({ ...preview, changes: [...added, ...others] });
  return { added: added.length };
}

function describe(engine, id) {
  const row = engine?.row(id);
  if (!row) return { anilistId: id, title: `AniList ${id}` };
  const ascii = (name) => /^[\x20-\x7e’''\-:.!?&,]+$/.test(String(name || "").trim());
  const synonyms = row.synonyms || [];
  // Prefer an English / romaji synonym when the stored title is localized (e.g. Caderno da Morte → Death Note).
  const latin = synonyms.find((name) => ascii(name) && name !== row.title) || "";
  const titleLooksLatin = ascii(row.title);
  const english = latin || (titleLooksLatin ? row.title : "");
  const native = english && english !== row.title ? row.title : "";
  return {
    anilistId: id,
    title: english || row.title,
    english: native,
    format: row.format || "",
    year: row.year || null,
    episodes: row.episodes || null,
  };
}

// "Frieren — Season 1", with the site in front when one preview holds several sites.
function fromText(source, withSite) {
  const text = [source.series, source.season].filter(Boolean).join(" — ");
  const site = withSite ? serviceById(String(source.key || "").split(":")[0])?.name : "";
  return site ? `${site}: ${text}` : text;
}

export const importBusy = () => job.running;

function importProgress() {
  if (Number.isFinite(job.total) && job.total > 0 && Number.isFinite(job.done)) {
    return Math.min(0.99, Math.max(0, job.done / job.total));
  }
  return 0;
}

function importServiceTag() {
  const id = String(job.service || "");
  if (id === "mal" || id === "kitsu") return "global";
  if (id === "all" || !id) return "all";
  return id;
}

/** Background activity rows for the toolbar badge and site panels. */
export function importActivity() {
  if (!job.running) return [];
  if (job.service === "all" && Array.isArray(job.sites)) {
    const active = job.sites.filter((site) => site.state === "reading");
    if (active.length) {
      return active.map((site) => ({
        id: `import-${site.id}`,
        label: site.note || `Reading ${site.name}`,
        service: site.id,
        progress: Number.isFinite(site.seen) && site.seen > 0 ? Math.min(0.99, 0.05 + Math.min(site.seen, 500) / 2000) : 0.05,
        done: site.seen || 0,
        total: Math.max(site.seen || 0, 1),
      }));
    }
  }
  const progress = importProgress();
  return [{
    id: "import",
    label: job.note || "Importing watch history",
    service: importServiceTag(),
    progress,
    done: job.done || 0,
    total: job.total || 0,
  }];
}

function slimPreview(preview) {
  if (!preview) return null;
  return {
    id: preview.id,
    service: preview.service,
    trigger: preview.trigger || "",
    createdAt: preview.createdAt,
    stats: preview.stats,
    notes: preview.notes || [],
    droppedNames: preview.droppedNames || [],
    animeMissed: preview.animeMissed || [],
    changes: preview.changes.map(({ anilistId, title, before, after, notes, sources, episodes }) => ({
      anilistId, title, before, after, notes, episodes,
      from: sources?.map((source) => fromText(source, preview.service === "all")).slice(0, 3) || [],
    })),
  };
}

export async function importStatus() {
  let services = await previewMap();
  // Drop general-service previews built under older rules; their reads stay in the draft.
  let changed = false;
  for (const [id, preview] of Object.entries(services)) {
    if (preview && id !== "crunchyroll" && (preview.rules || 0) < GENERAL_RULES) {
      delete services[id];
      changed = true;
    }
  }
  if (changed) {
    if (Object.keys(services).length) await save(KEYS.importPreview, packPreviewMap(services));
    else await chrome.storage.local.remove(KEYS.importPreview);
  }
  const previews = Object.values(services).map(slimPreview).filter(Boolean)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  // Prefer the job's service preview, else newest — keeps one-card UI working while multiple can exist.
  const preview = (job.service && services[job.service] && slimPreview(services[job.service]))
    || previews[0]
    || null;
  const [pendingStore, logs, checkpoints] = await Promise.all([loadPending(), load(KEYS.importLog, []), load(KEYS.checkpoints, {})]);
  const open = Object.entries(pendingStore).filter(([, item]) => !item.skipped);
  let engine = null;
  if (open.length) engine = await matcher().catch(() => null);
  return {
    job,
    preview,
    previews,
    pending: open.sort(([, a], [, b]) => (b.lastPlayed || 0) - (a.lastPlayed || 0)).slice(0, 200).map(([key, item]) => ({
      key, service: item.service, series: item.input.series, season: item.input.season, episodes: item.input.episodes.length, reason: item.reason,
      candidates: (item.candidates || []).slice(0, 6).map((id) => describe(engine, id)),
    })),
    pendingCount: open.length,
    log: keepLogs(logs).map(({ id, service, trigger, at, changes, skipped, undoneAt, undoKept, outcome, stats, notes, droppedNames, animeMissed, offered, left }) => ({
      id, service, trigger: trigger || "", at, count: changes.length, undoneAt: undoneAt || null, undoKept: undoKept || [],
      outcome: outcome || "applied", stats: stats || null, notes: notes || [], droppedNames: droppedNames || [], animeMissed: animeMissed || [],
      offered: offered ?? null, left: left || 0, upToDate: skipped?.length || 0,
    })),
    checkpoints: Object.entries(checkpoints).reduce((byService, [key, value]) => {
      const service = key.split(":")[0];
      (byService[service] ||= []).push({ label: value.label || "", newestAt: value.newestAt, end: value.end, oldestAt: value.oldestAt, savedAt: value.savedAt, resume: Boolean(value.resume) });
      return byService;
    }, {}),
  };
}
