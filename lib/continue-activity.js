// Continue watching activity: recent plays from Crunchyroll / tracking, merged ahead of list status.
import { looseKey } from "./match-engine.js";
import { matchKey, matchKeyCandidates, recall } from "./remembered.js";

export const CONTINUE_ACTIVITY_KEY = "ksContinueActivity";
export const CONTINUE_DISMISSED_KEY = "ksContinueDismissed";
export const CONTINUE_ACTIVITY_MAX = 20;
export const CONTINUE_DISMISSED_MAX = 80;
/** Provisional early-watch CW rows drop quietly if never confirmed finished. */
export const PROVISIONAL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const isPendingId = (id) => String(id || "").startsWith("pending:");
// Site chrome that briefly landed on the rail during Netflix naming bugs — not real shows.
const JUNK_CONTINUE_TITLE = /^(netflix|home|browse|my list|title details|watch|loading|…|\.{3}|null|undefined)$/i;

export function cleanContinueRow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "").trim();
  if (!id) return null;
  const title = String(raw.title || "").slice(0, 180);
  // Reject site chrome that landed on the rail; empty titles are allowed (filled from catalog later).
  if (title.trim() && JUNK_CONTINUE_TITLE.test(title.trim())) return null;
  const progress = Math.max(0, Math.round(Number(raw.progress) || 0));
  const episodes = Number(raw.episodes) > 0 ? Math.round(Number(raw.episodes)) : null;
  if (episodes && progress >= episodes) return null;
  const next = Math.max(progress + 1, Math.round(Number(raw.next) || 0) || progress + 1);
  return {
    id,
    title,
    cover: typeof raw.cover === "string" && raw.cover.startsWith("https://") ? raw.cover : "",
    progress,
    next: episodes ? Math.min(next, episodes) : next,
    episodes,
    service: String(raw.service || "").slice(0, 40),
    at: Number(raw.at) || 0,
    playUrl: typeof raw.playUrl === "string" ? raw.playUrl.slice(0, 500) : "",
    anilistId: Number(raw.anilistId) > 0 ? Number(raw.anilistId) : null,
    provisional: Boolean(raw.provisional),
  };
}

/** Drop provisional CW rows older than maxAgeMs; confirmed rows always stay. */
export function expireProvisionalContinue(list, { now = Date.now(), maxAgeMs = PROVISIONAL_MAX_AGE_MS } = {}) {
  const floor = now - maxAgeMs;
  return normalizeContinueActivity((Array.isArray(list) ? list : []).filter((row) => {
    if (!row?.provisional) return true;
    return (Number(row.at) || 0) >= floor;
  }), { now });
}

// Prefer resolved catalog rows over pending stubs; one row per anilist id / service+title.
// A later pending count can still raise the kept row — a progress-0 stub must not hide a real count.
function collapseContinueDuplicates(rows, { now = Date.now(), sessionMs = 6 * 60 * 60 * 1000 } = {}) {
  const ranked = [...rows].sort((a, b) => {
    const ap = isPendingId(a.id) ? 1 : 0;
    const bp = isPendingId(b.id) ? 1 : 0;
    return ap - bp || (b.at || 0) - (a.at || 0);
  });
  const byAnilist = new Map();
  const byTitle = new Map();
  const out = [];
  for (const row of ranked) {
    const titleKey = `${row.service || ""}:${looseKey(row.title)}`;
    const hit = (row.anilistId && byAnilist.get(row.anilistId)) || (titleKey !== ":" ? byTitle.get(titleKey) : null);
    if (hit) {
      if (continueDisplayProgress(row) > continueDisplayProgress(hit)) {
        hit.progress = row.progress;
        hit.next = row.next;
        hit.at = Math.max(Number(hit.at) || 0, Number(row.at) || 0);
        if (!row.provisional) hit.provisional = false;
        if (!hit.cover && row.cover) hit.cover = row.cover;
        if (!hit.playUrl && row.playUrl) hit.playUrl = row.playUrl;
        if (!hit.episodes && row.episodes) hit.episodes = row.episodes;
      }
      continue;
    }
    if (row.anilistId) byAnilist.set(row.anilistId, row);
    if (titleKey !== ":") byTitle.set(titleKey, row);
    out.push(row);
  }
  // Same watch session often leaves misnamed pending stubs (episode title, "Netflix"). Keep only the newest pending per service in-session.
  const floor = now - sessionMs;
  const newestPendingAt = new Map();
  for (const row of out) {
    if (!isPendingId(row.id) || (Number(row.at) || 0) < floor) continue;
    const service = row.service || "";
    newestPendingAt.set(service, Math.max(newestPendingAt.get(service) || 0, Number(row.at) || 0));
  }
  return out.filter((row) => {
    if (!isPendingId(row.id) || (Number(row.at) || 0) < floor) return true;
    return (Number(row.at) || 0) >= (newestPendingAt.get(row.service || "") || 0);
  });
}

export function normalizeContinueActivity(raw, { now = Date.now() } = {}) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.rows) ? raw.rows : [];
  const byId = new Map();
  for (const item of list) {
    const row = cleanContinueRow(item);
    if (!row) continue;
    const prev = byId.get(row.id);
    if (!prev || row.at >= prev.at) byId.set(row.id, row);
  }
  return collapseContinueDuplicates([...byId.values()], { now })
    .sort((a, b) => {
      const az = isPendingId(a.id) && continueDisplayProgress(a) === 0 ? 1 : 0;
      const bz = isPendingId(b.id) && continueDisplayProgress(b) === 0 ? 1 : 0;
      return az - bz || b.at - a.at || a.title.localeCompare(b.title);
    })
    .slice(0, CONTINUE_ACTIVITY_MAX);
}

export function upsertContinueActivity(list, row, { now = Date.now(), limit = CONTINUE_ACTIVITY_MAX } = {}) {
  const raw = { ...row, at: Number(row?.at) || now };
  const next = cleanContinueRow(raw);
  const id = String(raw?.id || next?.id || "").trim();
  let rest = (Array.isArray(list) ? list : []).filter((item) => String(item?.id) !== id);
  if (next) {
    const titleKey = looseKey(next.title);
    const service = next.service || "";
    const sessionFloor = now - 6 * 60 * 60 * 1000;
    rest = rest.filter((item) => {
      if (!isPendingId(item?.id)) return true;
      if (service && item.service && item.service !== service) return true;
      if (looseKey(item.title) === titleKey) return false;
      // Drop other recent pending stubs from this service (wrong episode-title names from the same session).
      if ((Number(item.at) || 0) >= sessionFloor) return false;
      return true;
    });
  }
  // Finished / invalid rows drop an existing activity entry so the rail doesn't keep a done show.
  if (!next) return normalizeContinueActivity(rest, { now }).slice(0, limit);
  return normalizeContinueActivity([next, ...rest], { now }).slice(0, limit);
}

function continueMatchKeys({ id = "", anilistId = null, anilistIds = [], title = "" } = {}) {
  const showId = String(id || "").trim();
  const ids = [...new Set(
    [anilistId, ...(Array.isArray(anilistIds) ? anilistIds : [])]
      .map((value) => Number(value))
      .filter((value) => value > 0),
  )];
  const titleKey = looseKey(title);
  return { showId, ids, titleKey };
}

function matchesContinueShow(row, { showId, ids, titleKey }) {
  if (!row) return false;
  if (showId && String(row.id) === showId) return true;
  if (ids.includes(Number(row.anilistId))) return true;
  if (ids.some((al) => String(row.id) === `al-${al}`)) return true;
  if (titleKey && isPendingId(row.id) && looseKey(row.title) === titleKey) return true;
  return false;
}

/**
 * Drop Continue Watching rows for a show the user marked finished / dropped / removed.
 * Matches catalog id, al-{anilistId}, anilistId(s), and pending stubs with the same title.
 */
export function removeContinueForShow(list, target = {}, { now = Date.now() } = {}) {
  const keys = continueMatchKeys(target);
  const next = (Array.isArray(list) ? list : []).filter((row) => !matchesContinueShow(row, keys));
  return normalizeContinueActivity(next, { now });
}

/** Local CW-rail dismissals: hide a title from Continue watching without changing list status. */
export function sanitizeContinueDismissed(raw, { limit = CONTINUE_DISMISSED_MAX } = {}) {
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(raw) ? raw : []) {
    const id = String(row?.id || "").trim();
    const anilistId = Number(row?.anilistId) > 0 ? Number(row.anilistId) : null;
    const title = String(row?.title || "").slice(0, 180);
    if (!id && !anilistId && !looseKey(title)) continue;
    const key = id || (anilistId ? `al:${anilistId}` : `t:${looseKey(title)}`);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, anilistId, title, at: Number(row?.at) || 0 });
    if (out.length >= limit) break;
  }
  return out;
}

function dismissedMatches(row, keys) {
  if (!row) return false;
  if (keys.showId && String(row.id) === keys.showId) return true;
  if (keys.ids.includes(Number(row.anilistId))) return true;
  if (keys.ids.some((al) => String(row.id) === `al-${al}`)) return true;
  if (keys.titleKey && looseKey(row.title) === keys.titleKey) return true;
  return false;
}

export function isContinueDismissed(list, target = {}) {
  const keys = continueMatchKeys(target);
  return sanitizeContinueDismissed(list).some((row) => dismissedMatches(row, keys));
}

export function addContinueDismissed(list, target = {}, { now = Date.now(), limit = CONTINUE_DISMISSED_MAX } = {}) {
  const keys = continueMatchKeys(target);
  if (!keys.showId && !keys.ids.length && !keys.titleKey) return sanitizeContinueDismissed(list, { limit });
  const next = sanitizeContinueDismissed(list, { limit: limit * 2 }).filter((row) => !dismissedMatches(row, keys));
  next.unshift({
    id: keys.showId,
    anilistId: keys.ids[0] || null,
    title: String(target.title || "").slice(0, 180),
    at: now,
  });
  return sanitizeContinueDismissed(next, { limit });
}

export function clearContinueDismissed(list, target = {}, { limit = CONTINUE_DISMISSED_MAX } = {}) {
  const keys = continueMatchKeys(target);
  return sanitizeContinueDismissed(list, { limit: limit * 2 })
    .filter((row) => !dismissedMatches(row, keys))
    .slice(0, limit);
}

/** Activity first (by recency), then library watching rows not already listed. */
export function mergeContinueRows(activity, libraryRows, { limit = 14 } = {}) {
  const out = [];
  const seen = new Set();
  for (const row of normalizeContinueActivity(activity)) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
    if (out.length >= limit) return out;
  }
  for (const row of libraryRows || []) {
    const id = String(row?.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

/** Build an activity row from a Crunchyroll watch-page episode number. */
export function activityFromWatchEpisode({ id, title, cover, episodes, playUrl, anilistId, episode, service = "crunchyroll", at = Date.now(), provisional = false } = {}) {
  const watching = Math.max(1, Math.round(Number(episode) || 0));
  if (!watching) return null;
  return cleanContinueRow({
    id,
    title,
    cover,
    episodes,
    playUrl,
    anilistId,
    service,
    at,
    progress: Math.max(0, watching - 1),
    next: watching,
    provisional,
  });
}

/**
 * Whether an applied import/sync change should bump Continue Watching.
 * Skips finished shows, and shows with no new watch activity in this pass
 * (no history play time and no progress increase vs before).
 */
export function shouldBumpContinueFromImport({ after, before, episodes, watched } = {}) {
  const progress = Math.max(0, Number(after?.progress) || 0);
  const eps = Number(episodes) > 0 ? Number(episodes) : null;
  const status = String(after?.status || "").toUpperCase();
  if (status === "COMPLETED" || (eps && progress >= eps)) return false;
  if (status === "PLANNING" || status === "DROPPED" || status === "PAUSED") return false;
  if (!(progress > 0)) return false;
  const lastPlayed = Number(watched?.lastPlayed) || 0;
  const beforeProgress = Math.max(0, Number(before?.progress) || 0);
  return lastPlayed > 0 || progress > beforeProgress;
}

/** Build an activity row after an episode finished (progress = that episode). */
export function activityFromFinishedEpisode({ id, title, cover, episodes, playUrl, anilistId, episode, service, at = Date.now(), provisional = false } = {}) {
  const progress = Math.max(1, Math.round(Number(episode) || 0));
  if (!id || !progress) return null;
  return cleanContinueRow({
    id,
    title,
    cover,
    episodes,
    playUrl,
    anilistId,
    service,
    at,
    progress,
    next: progress + 1,
    provisional,
  });
}

/**
 * Early-watch rail row. Progress is the episode before the one on screen (so the label shows it),
 * and never drops below progress already known. Watching episode 4 with nothing stored counts 1–3.
 */
export function activityFromWatchStart({ id, title, cover, episodes, playUrl, anilistId, episode, progress = 0, service, at = Date.now() } = {}) {
  const watching = Math.max(1, Math.round(Number(episode) || 0));
  if (!id || !watching) return null;
  const prior = Math.max(0, Math.round(Number(progress) || 0));
  const completed = Math.max(prior, watching - 1);
  return cleanContinueRow({
    id,
    title,
    cover,
    episodes,
    playUrl,
    anilistId,
    service,
    at,
    progress: completed,
    next: Math.max(completed + 1, watching),
    provisional: true,
  });
}

/**
 * Episode on screen for a provisional start. Unnumbered catch-up (phone plays + this play)
 * sits at baseline + lift so titles in the recent window are assumed before the current one.
 */
export function watchingEpisode({ episode, prior = 0, absolute = true, catchUpLift = 0 } = {}) {
  const ep = Math.max(1, Math.round(Number(episode) || 0));
  const baseline = Math.max(0, Math.round(Number(prior) || 0));
  const lift = Math.max(0, Math.round(Number(catchUpLift) || 0));
  if (!absolute && baseline > 0 && lift > 0) return baseline + lift;
  return ep;
}

/**
 * Progress after a finished play. Absolute numbers use the episode (gaps already filled).
 * Unnumbered catch-up adds only the recent new titles onto the baseline. A long activity
 * scan's 1..n is not that count, and it must not replace progress already stored.
 */
export function trackedProgress({ episode, prior = 0, absolute = true, catchUpLift = 0 } = {}) {
  const ep = Math.max(0, Math.round(Number(episode) || 0));
  const baseline = Math.max(0, Math.round(Number(prior) || 0));
  if (!absolute && baseline > 0) {
    const lift = Math.max(0, Math.round(Number(catchUpLift) || 0));
    if (lift > 0) return baseline + lift;
    if (ep <= baseline) return baseline + 1;
  }
  return Math.max(ep, baseline);
}

/** Rail/library progress that follows `next` when it jumps ahead of progress + 1. */
export function continueDisplayProgress(row) {
  const progress = Math.max(0, Math.round(Number(row?.progress) || 0));
  const next = Math.max(0, Math.round(Number(row?.next) || 0));
  if (next > progress + 1) return next - 1;
  return progress;
}

function anilistFromMatches(matches, service, seriesId, seasonNumber = null, season = "") {
  if (!service || !seriesId) return null;
  const keys = matchKeyCandidates(service, seriesId, {
    seasonId: seasonNumber ? `s${seasonNumber}` : "",
    season,
    seasonNumber,
  });
  for (const key of keys) {
    const exact = recall(matches, key);
    if (Number(exact?.anilistId) > 0) return Number(exact.anilistId);
  }
  const bare = recall(matches, matchKey(service, seriesId, ""));
  if (Number(bare?.anilistId) > 0) return Number(bare.anilistId);
  // HIDIVE (and similar) store API season ids in match keys, not "s2" — accept any season suffix.
  const prefix = `${service}:${seriesId}`;
  for (const [key, record] of Object.entries(matches || {})) {
    if (!(Number(record?.anilistId) > 0)) continue;
    if (key === prefix || key.startsWith(`${prefix}/`)) return Number(record.anilistId);
  }
  const needle = seriesId;
  for (const record of Object.values(matches || {})) {
    if (!(Number(record?.anilistId) > 0)) continue;
    const names = Array.isArray(record.names) ? record.names : [];
    if (names.some((label) => {
      const head = looseKey(String(label).split("—")[0]);
      return head === needle || head.includes(needle) || needle.includes(head);
    })) return Number(record.anilistId);
  }
  return null;
}

function anilistFromLibraryTitle(library, seriesId) {
  if (!seriesId) return null;
  for (const entry of Object.values(library || {})) {
    if (!entry || entry.removed || !(Number(entry.anilistId) > 0)) continue;
    if (looseKey(entry.title) === seriesId) return Number(entry.anilistId);
  }
  return null;
}

function catalogItemByAnilistOrTitle(catalog, anilistId, seriesId) {
  const items = [...(catalog?.items || []), ...(catalog?.newest || [])];
  if (anilistId) {
    const hit = items.find((row) => row?.anilistId === anilistId);
    if (hit) return hit;
  }
  if (seriesId) {
    const hit = items.find((row) => looseKey(row?.title) === seriesId);
    if (hit) return hit;
  }
  return null;
}

/**
 * Map a tracked play (series name + episode) onto a Prism show id using remembered matches,
 * the local library, and the Crunchyroll catalog. Returns null when nothing known yet.
 */
export function resolveContinueTarget({
  service,
  series,
  season = "",
  seasonNumber = null,
  matches = {},
  library = {},
  catalog = {},
  catalogLinks = {},
  anilistId: knownId = null,
} = {}) {
  const name = String(series || "").trim();
  const seriesId = looseKey(name);
  if (!seriesId && !(Number(knownId) > 0)) return null;
  let anilistId = Number(knownId) > 0 ? Number(knownId) : null;
  if (!anilistId && service) anilistId = anilistFromMatches(matches, service, seriesId, seasonNumber, season);
  if (!anilistId) anilistId = anilistFromLibraryTitle(library, seriesId);
  const item = catalogItemByAnilistOrTitle(catalog, anilistId, seriesId);
  if (!anilistId && item?.anilistId) anilistId = Number(item.anilistId);
  if (!anilistId) return null;

  const entry = library[`anilist:${anilistId}`]
    || Object.values(library || {}).find((row) => row?.anilistId === anilistId && !row.removed)
    || null;
  const crId = entry?.crSeriesId || item?.id || "";
  const id = crId || `al-${anilistId}`;
  const playUrl = (typeof catalogLinks?.[anilistId] === "string" && catalogLinks[anilistId])
    || item?.url
    || (crId ? `https://www.crunchyroll.com/series/${crId}` : "");
  return {
    id,
    anilistId,
    title: entry?.title || item?.title || name,
    cover: entry?.cover || item?.cover || item?.poster || "",
    episodes: entry?.episodes || item?.episodes || null,
    playUrl,
    crSeriesId: crId || null,
  };
}
