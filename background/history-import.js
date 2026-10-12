import {
  CATALOG_MATCH_BATCH,
  cacheKeyForSeries,
  catalogMatchQuery,
  catalogMatchVariables,
  matchTitleToMedia,
  readCache,
} from "../lib/anilist.js";
import {
  HISTORY_MAX_PAGES,
  HISTORY_PAGE_SIZE,
  applyHistoryChanges,
  groupHistory,
  historyItems,
  historyPageUrl,
  historySearch,
  historySummary,
  parseHistoryPage,
  planHistoryImport,
} from "../lib/history.js";
import { anilistSession } from "../lib/settings.js";
import { normalizeTitle } from "../lib/title-match.js";
import { syncKeysPaced } from "./anilist-sync.js";
import { crGet, currentLocale, currentToken, linkLibraryToCatalog, validBearer } from "./catalog-sync.js";
import { anilist, delay, loadState, saveState } from "./store.js";

const PREVIEW_KEY = "historyPreview";
const ACCOUNT_URL = "https://www.crunchyroll.com/accounts/v1/me";

const SECONDS_PER = { page: 0.6, batch: 1.5 };
const EPISODES_PER_SEASON = 10;

let job = { phase: "idle", running: false, progress: 0, note: "" };
let controller = null;
let scan = { pages: 1, pagesDone: 0, batches: 0, batchesDone: 0 };

function bumpScan() {
  const total = scan.pages * SECONDS_PER.page + scan.batches * SECONDS_PER.batch;
  const done = Math.min(scan.pagesDone, scan.pages) * SECONDS_PER.page + Math.min(scan.batchesDone, scan.batches) * SECONDS_PER.batch;
  job.progress = Math.max(job.progress || 0, total ? Math.min(0.99, done / total) : 0);
}

function snapshot() {
  return { phase: job.phase, running: job.running, progress: job.progress, note: job.note };
}

export function historyActivity() {
  if (!job.running) return null;
  return {
    id: "history",
    label: job.phase === "saving" ? "Sending history to AniList" : "Importing Crunchyroll history",
    progress: job.progress,
  };
}

function hitTitle(media) {
  return media?.title?.english || media?.title?.romaji || media?.title?.native || "";
}

function tokenAccount(token) {
  try {
    const body = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof body?.sub === "string" ? body.sub : "";
  } catch {
    return "";
  }
}

async function accountId(token) {
  try {
    const me = await crGet(token, ACCOUNT_URL);
    if (typeof me?.account_id === "string" && me.account_id) return me.account_id;
  } catch (error) {
    if (/expired/i.test(String(error?.message))) throw error;
  }
  const fromToken = tokenAccount(token);
  if (!fromToken) throw new Error("Crunchyroll did not share your account id. Reload Crunchyroll and try again.");
  return fromToken;
}

async function readHistory(token, signal) {
  const account = await accountId(token);
  const locale = currentLocale();
  const rows = [];
  let seen = 0;
  let url = historyPageUrl(account, 1, locale);
  let cutShort = false;
  for (let page = 1; page <= HISTORY_MAX_PAGES; page += 1) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const fresh = await currentToken();
    if (!validBearer(fresh)) {
      if (!rows.length) throw new Error("Crunchyroll session expired. Reload Crunchyroll and try again.");
      cutShort = true;
      break;
    }
    let payload;
    try {
      payload = await crGet(fresh, url);
    } catch (error) {
      if (!rows.length) throw error;
      cutShort = true;
      break;
    }
    const parsed = parseHistoryPage(payload, seen);
    seen += Array.isArray(payload?.data) ? payload.data.length : 0;
    rows.push(...parsed.rows);
    const total = Number(payload?.total);
    scan.pagesDone = page;
    scan.pages = Number.isFinite(total) && total > seen ? Math.ceil(total / HISTORY_PAGE_SIZE) : parsed.more ? page + 1 : page;
    scan.batches = Math.ceil(Math.max(seen, Number.isFinite(total) ? total : 0) / EPISODES_PER_SEASON / CATALOG_MATCH_BATCH);
    bumpScan();
    job.note = `Reading your Crunchyroll history… ${seen} episodes so far`;
    if (!parsed.more) break;
    url = parsed.nextUrl || historyPageUrl(account, page + 1, locale);
    await delay(150, signal);
  }
  return { rows, seen, cutShort };
}

async function searchBatch(batch, signal) {
  const query = catalogMatchQuery(batch.length);
  const variables = catalogMatchVariables(batch.map((row) => row.search));
  try {
    return await anilist(query, variables, undefined, signal);
  } catch (error) {
    if (signal.aborted || error?.name === "AbortError") throw error;
    if (!/busy|429/i.test(String(error?.message))) return null;
    job.note = "AniList asked us to slow down. Waiting a minute…";
    await delay(60_000, signal);
    return anilist(query, variables, undefined, signal).catch(() => null);
  }
}

async function matchGroups(groups, state, signal) {
  const now = Date.now();
  const bySearch = new Map();
  const seriesHit = (group) => {
    const hit = readCache(state.anilistCache, cacheKeyForSeries(group.seriesId), now);
    return hit?.kind === "hit" && hit.anilistId ? hit : null;
  };
  const firstSeason = (group) => group.kind === "movie"
    || !group.seasonNumber
    || group.seasonNumber === 1
    || normalizeTitle(group.seasonTitle) === normalizeTitle(group.seriesTitle);
  const pending = [];
  for (const group of groups) {
    const plan = historySearch(group);
    group.searchKey = normalizeTitle(plan.search);
    if (!group.searchKey || bySearch.has(group.searchKey)) continue;
    const known = firstSeason(group) ? seriesHit(group) : null;
    if (known) {
      bySearch.set(group.searchKey, { anilistId: known.anilistId, episodes: known.episodes, cover: known.cover, title: known.titles?.english || known.titles?.romaji || "" });
      continue;
    }
    bySearch.set(group.searchKey, null);
    pending.push({ key: group.searchKey, search: plan.search, matchTitle: plan.matchTitle, kind: group.kind === "movie" ? "movie" : "series" });
  }
  scan.pages = scan.pagesDone;
  scan.batches = Math.ceil(pending.length / CATALOG_MATCH_BATCH);
  scan.batchesDone = 0;
  bumpScan();
  for (let index = 0; index < pending.length; index += CATALOG_MATCH_BATCH) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const batch = pending.slice(index, index + CATALOG_MATCH_BATCH);
    const payload = await searchBatch(batch, signal);
    batch.forEach((row, offset) => {
      const media = payload?.data?.[`p${offset}`]?.media || [];
      const match = matchTitleToMedia(row.matchTitle, media, { kind: row.kind });
      if (match.confidence !== "high") return;
      bySearch.set(row.key, {
        anilistId: match.media.id,
        episodes: match.media.episodes ?? null,
        cover: match.media.coverImage?.large || "",
        title: hitTitle(match.media),
      });
    });
    scan.batchesDone += 1;
    bumpScan();
    job.note = `Matching with AniList… ${Math.min(pending.length, index + batch.length)} of ${pending.length}`;
    await delay(800, signal);
  }
  return historyItems(groups, (group) => {
    const hit = bySearch.get(group.searchKey);
    if (!hit) return null;
    return { ...hit, primary: hit.anilistId === seriesHit(group)?.anilistId };
  });
}

async function savePreview(preview) {
  await chrome.storage.session.set({ [PREVIEW_KEY]: preview });
}

async function loadPreview() {
  const stored = await chrome.storage.session.get(PREVIEW_KEY);
  return stored[PREVIEW_KEY] || null;
}

async function clearPreview() {
  await chrome.storage.session.remove(PREVIEW_KEY);
}

export async function scanHistory() {
  if (job.running) return snapshot();
  const state = await loadState();
  if (!anilistSession(state.settings).connected) throw new Error("Connect your AniList account first.");
  const token = await currentToken();
  if (!validBearer(token)) throw new Error("Open Crunchyroll while signed in, then start the import from the Crunchilist panel there.");
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  scan = { pages: 1, pagesDone: 0, batches: 0, batchesDone: 0 };
  job = { phase: "reading", running: true, progress: 0, note: "Reading your Crunchyroll history…" };
  (async () => {
    await clearPreview();
    const { rows, seen, cutShort } = await readHistory(token, signal);
    const groups = groupHistory(rows);
    if (!groups.length) {
      job = { phase: "done", running: false, progress: 1, note: "No finished episodes found in your Crunchyroll history." };
      return;
    }
    job.phase = "matching";
    const { items, unmatched } = await matchGroups(groups, await loadState(), signal);
    await savePreview({ items, unmatched, scannedAt: Date.now(), seen, cutShort });
    job = { phase: "ready", running: false, progress: 1, note: "" };
  })().catch((error) => {
    if (error?.name === "AbortError") {
      job = { phase: "idle", running: false, progress: 0, note: "Import canceled." };
      return;
    }
    job = { phase: "error", running: false, progress: 0, note: String(error?.message || "Could not read your Crunchyroll history.") };
  });
  return snapshot();
}

export async function historyPlan(stale) {
  const preview = await loadPreview();
  if (!preview) return { summary: null, changes: [], unmatched: [], scanned: false };
  const state = await loadState();
  const plan = planHistoryImport(state.library, preview.items, { now: Date.now(), stale });
  return {
    summary: historySummary(plan, preview.unmatched),
    changes: plan.changes
      .sort((a, b) => b.lastPlayed - a.lastPlayed)
      .map((change) => ({
        id: change.anilistId,
        title: change.title,
        cover: change.cover,
        status: change.status,
        progress: change.progress,
        episodes: change.episodes,
        isNew: change.isNew,
        stale: change.stale,
        fromStatus: change.fromStatus,
        fromProgress: change.fromProgress,
        lastPlayed: change.lastPlayed,
      })),
    unmatched: preview.unmatched.slice(0, 200),
    scanned: true,
    seen: preview.seen || 0,
    cutShort: Boolean(preview.cutShort),
    matched: preview.items.length,
  };
}

function pickIds(ids) {
  if (!Array.isArray(ids)) return null;
  return new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0));
}

export async function skipHistory(ids) {
  const preview = await loadPreview();
  const chosen = pickIds(ids);
  if (!preview || !chosen?.size) return {};
  await savePreview({ ...preview, items: preview.items.filter((item) => !chosen.has(item.anilistId)) });
  return {};
}

async function commitChanges(changes, preview, chosen) {
  const state = await loadState();
  const now = Date.now();
  const { library, keys } = applyHistoryChanges(state.library, changes, now);
  state.library = library;
  state.historyImport = { at: now, shows: (state.historyImport?.shows || 0) + keys.length };
  await saveState(state);
  await linkLibraryToCatalog();
  const remaining = chosen ? preview.items.filter((item) => !chosen.has(item.anilistId)) : [];
  await savePreview({ ...preview, items: remaining });
  return keys;
}

export async function applyHistory(stale, ids) {
  if (job.running) throw new Error("The import is still running.");
  const preview = await loadPreview();
  if (!preview) throw new Error("Scan your Crunchyroll history first.");
  const state = await loadState();
  if (!anilistSession(state.settings).connected) throw new Error("Connect your AniList account first.");
  const chosen = pickIds(ids);
  const plan = planHistoryImport(state.library, preview.items, { now: Date.now(), stale });
  const changes = chosen ? plan.changes.filter((change) => chosen.has(change.anilistId)) : plan.changes;
  if (!changes.length) {
    if (!chosen) await savePreview({ ...preview, items: [] });
    job = { phase: "done", running: false, progress: 1, note: chosen ? "That show is already up to date." : "Your AniList already has everything from your Crunchyroll history." };
    return snapshot();
  }
  const keys = await commitChanges(changes, preview, chosen);
  if (chosen && keys.length === 1) {
    const { synced, error } = await syncKeysPaced(keys);
    const title = changes[0].title || "That show";
    job = { phase: "ready", running: false, progress: 1, note: synced ? `Updated ${title} on AniList.` : `Saved ${title} here. It will sync to AniList automatically${error ? ` (${error})` : ""}.` };
    return snapshot();
  }
  const count = keys.length === 1 ? "1 show" : `${keys.length} shows`;
  controller?.abort();
  controller = new AbortController();
  job = { phase: "saving", running: true, progress: 0, note: `Sending ${count} to AniList…` };
  syncKeysPaced(keys, {
    signal: controller.signal,
    onStep: (done) => {
      job.progress = done / keys.length;
      job.note = `Sending to AniList… ${done} of ${keys.length}`;
    },
  }).then(({ synced, error }) => {
    const rest = keys.length - synced;
    job = {
      phase: "done",
      running: false,
      progress: 1,
      note: rest > 0
        ? `Saved ${count} here; ${synced} reached AniList so far. The other ${rest} will sync automatically${error ? ` (${error})` : ""}.`
        : `Added ${count} from your Crunchyroll history to AniList.`,
    };
  }).catch(() => {
    job = { phase: "done", running: false, progress: 1, note: `Saved ${count} here. They will sync to AniList automatically.` };
  });
  return snapshot();
}

export async function cancelHistory() {
  controller?.abort();
  await clearPreview();
  if (!job.running) job = { phase: "idle", running: false, progress: 0, note: "" };
  return snapshot();
}

export async function historyProgress() {
  return { ...snapshot(), waiting: Boolean((await loadPreview())?.items?.length) };
}
