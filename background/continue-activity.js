// Persist and notify Continue watching activity from live watch sources.
import { mapListStatus } from "../lib/anilist.js";
import {
  CONTINUE_ACTIVITY_KEY,
  PROVISIONAL_MAX_AGE_MS,
  activityFromFinishedEpisode,
  activityFromWatchEpisode,
  activityFromWatchStart,
  expireProvisionalContinue,
  normalizeContinueActivity,
  resolveContinueTarget,
  shouldBumpContinueFromImport,
  upsertContinueActivity,
} from "../lib/continue-activity.js";
import { readAllShows } from "../lib/idb.js";
import { KEYS } from "../lib/keys.js";
import { setEntryProgress, setEntryStatus, touchLastWatched } from "../lib/library.js";
import { createMatcher, looseKey } from "../lib/match-engine.js";
import { pickPlayLink } from "../lib/play-url.js";
import { matchKey, remember } from "../lib/remembered.js";
import { noteActivity } from "./app-notices.js";
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

/** Quietly drop provisional CW rows older than 7 days. */
export async function expireProvisionalContinueActivity({ now = Date.now(), maxAgeMs = PROVISIONAL_MAX_AGE_MS } = {}) {
  const list = await loadContinueActivity();
  const next = expireProvisionalContinue(list, { now, maxAgeMs });
  if (next.length === list.length && next.every((row, i) => row.id === list[i]?.id && row.provisional === list[i]?.provisional)) {
    return next;
  }
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

async function resolveTrackedTarget({ service, series, season, seasonNumber, episode, anilistId, state, catalog, matches, catalogLinks }) {
  let memory = matches;
  let target = resolveContinueTarget({
    service,
    series,
    season,
    seasonNumber,
    matches: memory,
    library: state.library || {},
    catalog,
    catalogLinks,
    anilistId,
  });
  if (target) return { target, matches: memory };
  try {
    const { rows } = await readAllShows();
    const found = rows?.length
      ? createMatcher(rows).match({
        series,
        season: season || (seasonNumber ? `Season ${seasonNumber}` : ""),
        seasonNumber,
        episodes: [Math.max(1, Math.round(Number(episode) || 1))],
        kind: "episode",
      })
      : null;
    // High or low (unsure) is enough for Continue Watching — AniList still waits for import/tracking.
    if (found?.anilistId && (found.confidence === "high" || found.confidence === "low")) {
      const key = matchKey(service, looseKey(series), seasonNumber ? `s${seasonNumber}` : "");
      memory = remember(memory, key, { anilistId: found.anilistId, how: found.how, confidence: found.confidence }, {
        names: [[series, season || (seasonNumber ? `Season ${seasonNumber}` : "")].filter(Boolean).join(" — ")],
      });
      await chrome.storage.local.set({ [KEYS.matches]: memory });
      target = resolveContinueTarget({
        service,
        series,
        season,
        seasonNumber,
        matches: memory,
        library: state.library || {},
        catalog,
        catalogLinks,
        anilistId: found.anilistId,
      });
    }
  } catch {
    // Matcher / id-map unavailable — leave CW for the later import apply.
  }
  return { target, matches: memory };
}

/** Crunchyroll watch page → activity only (no AniList write). Confirmed (not provisional). */
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
  const now = Date.now();
  const show = {
    anilistId: entry?.anilistId || item?.anilistId || null,
    title: season?.seriesTitle || item?.title || observation.title || "",
    cover: item?.cover || entry?.cover || "",
    episodes: season?.episodeCount || item?.episodes || entry?.episodes || null,
    crSeriesId: observation.seriesId,
  };
  try {
    if (show.anilistId || show.crSeriesId) {
      state.library = touchLastWatched(state.library || {}, show, now);
      await saveState(state);
    }
  } catch {
    // Best-effort last-watched stamp.
  }
  const row = activityFromWatchEpisode({
    id: observation.seriesId,
    title: show.title,
    cover: show.cover,
    episodes: show.episodes,
    playUrl: item?.url || `https://www.crunchyroll.com/series/${observation.seriesId}`,
    anilistId: show.anilistId,
    episode,
    service: "crunchyroll",
    provisional: false,
  });
  if (row) await upsertContinueRow(row);
}

/**
 * Immediate Continue Watching bump when a tracked site starts or finishes an episode we can name.
 * provisional: early watch (~5s) — CW + My List watching, expires in 7 days if never finished.
 * AniList sync still runs later on the existing alarms for finishes.
 */
export async function noteContinueFromTrackedPlay({
  service,
  series,
  season = "",
  seasonNumber = null,
  episode,
  playUrl = "",
  anilistId = null,
  provisional = false,
} = {}) {
  const ep = Math.max(1, Math.round(Number(episode) || 0));
  if (!service || !series || !ep) return null;
  const [state, catalog, matchesBag, catalogsBag] = await Promise.all([
    loadState(),
    loadCatalog(),
    chrome.storage.local.get(KEYS.matches),
    chrome.storage.local.get(KEYS.catalogs),
  ]);
  const catalogs = catalogsBag?.[KEYS.catalogs] || {};
  const { target } = await resolveTrackedTarget({
    service,
    series,
    season,
    seasonNumber,
    episode: ep,
    anilistId,
    state,
    catalog,
    matches: matchesBag?.[KEYS.matches] || {},
    catalogLinks: catalogs?.[service]?.links || {},
  });
  const now = Date.now();
  // No AniList id yet: still put a provisional name on the rail so tracking feels alive.
  if (!target) {
    if (!provisional) return null;
    const pendingId = `pending:${service}:${looseKey(series)}`;
    const row = activityFromWatchStart({
      id: pendingId,
      title: String(series).slice(0, 180),
      cover: "",
      episodes: null,
      playUrl: playUrl || "",
      anilistId: null,
      episode: ep,
      progress: 0,
      service,
    });
    if (row) await upsertContinueRow(row);
    return row;
  }
  const priorLibrary = Math.max(0, Number(
    state.library?.[`anilist:${target.anilistId}`]?.progress
    || Object.values(state.library || {}).find((row) => row?.anilistId === target.anilistId && !row.removed)?.progress
    || 0,
  ));
  const priorRail = Math.max(0, Number(
    (await loadContinueActivity()).find((row) => row.id === target.id || row.anilistId === target.anilistId)?.progress || 0,
  ));
  const show = {
    anilistId: target.anilistId,
    title: target.title,
    episodes: target.episodes,
    cover: target.cover,
    crSeriesId: target.crSeriesId,
  };
  if (provisional) {
    try {
      state.library = touchLastWatched(state.library || {}, show, now);
      await saveState(state);
    } catch {
      // Best-effort.
    }
    const row = activityFromWatchStart({
      id: target.id,
      title: target.title,
      cover: target.cover,
      episodes: target.episodes,
      playUrl: playUrl || target.playUrl,
      anilistId: target.anilistId,
      episode: ep,
      progress: Math.max(priorLibrary, priorRail),
      service,
    });
    if (row) await upsertContinueRow(row);
    return row;
  }
  // Partial activity pages (Netflix page 0) can undercount episodes — never move progress backwards.
  const progress = Math.max(ep, priorLibrary, priorRail);
  try {
    state.library = setEntryProgress(state.library || {}, show, progress, now);
    await saveState(state);
  } catch {
    // Progress write is best-effort for the rail.
  }
  const row = activityFromFinishedEpisode({
    id: target.id,
    title: target.title,
    cover: target.cover,
    episodes: target.episodes,
    playUrl: playUrl || target.playUrl,
    anilistId: target.anilistId,
    episode: progress,
    service,
    provisional: false,
  });
  if (row) await upsertContinueRow(row);
  return row;
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
  const catalogsBag = await chrome.storage.local.get(KEYS.catalogs).catch(() => ({}));
  const serviceCatalogs = catalogsBag?.[KEYS.catalogs] || {};
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
    const showId = crId || `al-${change.anilistId}`;
    const episodes = entry?.episodes || preview.episodes || change.episodes || null;
    const bump = shouldBumpContinueFromImport({
      after: change.after,
      before: change.before,
      episodes,
      watched: preview.watched,
    });
    // Finished (or otherwise not bumpable) drops an existing rail row; in-progress with new plays upserts.
    if (!bump) {
      if (status === "finished" || (episodes && progress >= episodes)) {
        activity = upsertContinueActivity(activity, { id: showId, progress: episodes || progress, episodes: episodes || progress }, { now });
      }
      continue;
    }
    const item = showsByAnilist.get(change.anilistId) || (crId ? catalogItem(catalog, crId) : null);
    const sourceService = String(preview.sources?.[0]?.key || preview.service || "import").split(":")[0] || "import";
    const prefer = sourceService === "all" ? "" : sourceService;
    const serviceLink = prefer ? serviceCatalogs?.[prefer]?.links?.[change.anilistId] || "" : "";
    activity = upsertContinueActivity(activity, {
      id: showId,
      title: entry?.title || change.title || item?.title || "",
      cover: entry?.cover || item?.cover || "",
      progress,
      next: progress + 1,
      episodes,
      service: prefer || "import",
      at: now,
      playUrl: serviceLink
        || pickPlayLink({ id: crId || showId, url: item?.url, streaming: item?.streaming || [] }, { preferService: prefer })?.url
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
    noteActivity({
      kind: "continue",
      title: "Continue watching updated",
      detail: `${applied.length} tracking change${applied.length === 1 ? "" : "s"} mirrored locally`,
      ok: true,
    }).catch(() => {});
  }
}
