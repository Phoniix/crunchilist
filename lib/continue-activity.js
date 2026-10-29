// Continue watching activity: recent plays from Crunchyroll / tracking, merged ahead of list status.
import { looseKey } from "./match-engine.js";
import { matchKey, recall } from "./remembered.js";

export const CONTINUE_ACTIVITY_KEY = "ksContinueActivity";
export const CONTINUE_ACTIVITY_MAX = 20;
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
function collapseContinueDuplicates(rows, { now = Date.now(), sessionMs = 6 * 60 * 60 * 1000 } = {}) {
  const ranked = [...rows].sort((a, b) => {
    const ap = isPendingId(a.id) ? 1 : 0;
    const bp = isPendingId(b.id) ? 1 : 0;
    return ap - bp || (b.at || 0) - (a.at || 0);
  });
  const seenAnilist = new Set();
  const seenTitle = new Set();
  const out = [];
  for (const row of ranked) {
    const titleKey = `${row.service || ""}:${looseKey(row.title)}`;
    if (row.anilistId && seenAnilist.has(row.anilistId)) continue;
    if (titleKey !== ":" && seenTitle.has(titleKey)) continue;
    if (row.anilistId) seenAnilist.add(row.anilistId);
    if (titleKey !== ":") seenTitle.add(titleKey);
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
    .sort((a, b) => b.at - a.at || a.title.localeCompare(b.title))
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

/** Early-watch rail row: keep known progress, point next at the episode being played. */
export function activityFromWatchStart({ id, title, cover, episodes, playUrl, anilistId, episode, progress = 0, service, at = Date.now() } = {}) {
  const watching = Math.max(1, Math.round(Number(episode) || 0));
  if (!id || !watching) return null;
  const prior = Math.max(0, Math.round(Number(progress) || 0));
  return cleanContinueRow({
    id,
    title,
    cover,
    episodes,
    playUrl,
    anilistId,
    service,
    at,
    progress: prior,
    next: Math.max(prior + 1, watching),
    provisional: true,
  });
}

function anilistFromMatches(matches, service, seriesId, seasonNumber = null) {
  if (!service || !seriesId) return null;
  const seasonId = seasonNumber ? `s${seasonNumber}` : "";
  const exact = recall(matches, matchKey(service, seriesId, seasonId))
    || recall(matches, matchKey(service, seriesId, ""));
  if (Number(exact?.anilistId) > 0) return Number(exact.anilistId);
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
  if (!anilistId && service) anilistId = anilistFromMatches(matches, service, seriesId, seasonNumber);
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
