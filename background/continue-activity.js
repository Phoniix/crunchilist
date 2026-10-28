// Persist and notify Continue watching activity from live watch sources.
import { mapListStatus } from "../lib/anilist.js";
import {
  CONTINUE_ACTIVITY_KEY,
  activityFromWatchEpisode,
  normalizeContinueActivity,
  upsertContinueActivity,
} from "../lib/continue-activity.js";
import { KEYS } from "../lib/keys.js";
import { setEntryProgress, setEntryStatus } from "../lib/library.js";
import { pickPlayLink } from "../lib/play-url.js";
import { loadCatalog, loadState, saveState } from "./store.js";

const STORAGE_KEY = KEYS.continueActivity || CONTINUE_ACTIVITY_KEY;

export async function loadContinueActivity() {
  try {
    return normalizeContinueActivity((await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]);
  } catch {
    return [];
  }
}

async function saveContinueActivity(rows) {
  const next = normalizeContinueActivity(rows);
  await chrome.storage.local.set({ [STORAGE_KEY]: next }).catch(() => {});
  return next;
}

export function notifyContinueUpdated() {
  chrome.runtime.sendMessage({ type: "continueActivityUpdated" }).catch(() => {});
}

export async function upsertContinueRow(row) {
  const list = await loadContinueActivity();
  const next = upsertContinueActivity(list, row);
  await saveContinueActivity(next);
  notifyContinueUpdated();
  return next;
}

function catalogItem(catalog, seriesId) {
  return (catalog?.items || []).find((row) => row.id === seriesId)
    || (catalog?.newest || []).find((row) => row.id === seriesId)
    || null;
}

function currentSeason(observation) {
  if (!observation?.currentKey) return null;
  return (observation.seasons || []).find((season) => `${season.seriesId}|${season.seasonSlug}` === observation.currentKey) || null;
}

/** Crunchyroll watch page → activity only (no AniList write). */
export async function noteContinueFromCrObservation(observation) {
  if (observation?.kind !== "watch" || !observation.seriesId) return;
  const season = currentSeason(observation);
  const episode = Number(season?.watchingEpisode) || 0;
  if (!(episode >= 1)) return;
  const catalog = await loadCatalog();
  const item = catalogItem(catalog, observation.seriesId);
  const state = await loadState();
  const entry = state.library?.[`cr:${observation.seriesId}`]
    || Object.values(state.library || {}).find((row) => row?.crSeriesId === observation.seriesId && !row.removed);
  const row = activityFromWatchEpisode({
    id: observation.seriesId,
    title: season?.seriesTitle || item?.title || observation.title || "",
    cover: item?.cover || "",
    episodes: season?.episodeCount || item?.episodes || entry?.episodes || null,
    playUrl: item?.url || `https://www.crunchyroll.com/series/${observation.seriesId}`,
    anilistId: entry?.anilistId || item?.anilistId || null,
    episode,
    service: "crunchyroll",
  });
  if (row) await upsertContinueRow(row);
}

/** After import/tracking apply: mirror into local library + continue activity. */
export async function mirrorAppliedChanges(changes, previewChanges = []) {
  const applied = Array.isArray(changes) ? changes.filter((row) => row?.anilistId && row.after) : [];
  if (!applied.length) return;
  const byId = new Map((previewChanges || []).map((row) => [row.anilistId, row]));
  const state = await loadState();
  let library = state.library || {};
  const now = Date.now();
  const catalog = await loadCatalog();
  const showsByAnilist = new Map();
  for (const item of [...(catalog.items || []), ...(catalog.newest || [])]) {
    if (item?.anilistId) showsByAnilist.set(item.anilistId, item);
  }
  let activity = await loadContinueActivity();
  for (const change of applied) {
    const preview = byId.get(change.anilistId) || {};
    const status = mapListStatus(change.after.status) || (change.after.progress > 0 ? "in_progress" : null);
    const progress = Math.max(0, Number(change.after.progress) || 0);
    const show = {
      anilistId: change.anilistId,
      title: change.title || preview.title || "",
      episodes: preview.episodes || change.episodes || null,
      cover: preview.media?.coverImage?.large || "",
    };
    try {
      if (status === "plan" || status === "dropped") {
        library = setEntryStatus(library, show, status, now);
      } else if (progress > 0 || status === "in_progress" || status === "finished") {
        library = setEntryProgress(library, show, Math.max(progress, status === "finished" ? 1 : progress), now);
        if (status === "finished" && progress <= 0) library = setEntryStatus(library, show, "finished", now);
      } else if (status) {
        library = setEntryStatus(library, show, status, now);
      }
    } catch {
      // Skip rows we can't place.
    }
    const entry = library[`anilist:${change.anilistId}`];
    const crId = entry?.crSeriesId || showsByAnilist.get(change.anilistId)?.id || "";
    if (!crId) continue;
    if (status === "finished" || (entry?.episodes && progress >= entry.episodes)) continue;
    if (status && status !== "in_progress") continue;
    const item = showsByAnilist.get(change.anilistId) || catalogItem(catalog, crId);
    activity = upsertContinueActivity(activity, {
      id: crId,
      title: entry?.title || change.title || item?.title || "",
      cover: entry?.cover || item?.cover || "",
      progress,
      next: progress + 1,
      episodes: entry?.episodes || item?.episodes || null,
      service: preview.service || "import",
      at: now,
      playUrl: pickPlayLink({ id: crId, url: item?.url, streaming: item?.streaming || [] }, {})?.url
        || item?.url
        || "",
      anilistId: change.anilistId,
    }, { now });
  }
  state.library = library;
  await saveState(state);
  await saveContinueActivity(activity);
  notifyContinueUpdated();
  if (applied.length) {
    const { noteActivity } = await import("./app-notices.js");
    noteActivity({
      kind: "continue",
      title: "Continue watching updated",
      detail: `${applied.length} tracking change${applied.length === 1 ? "" : "s"} mirrored locally`,
      ok: true,
    }).catch(() => {});
  }
}
