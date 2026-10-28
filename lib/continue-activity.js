// Continue watching activity: recent plays from Crunchyroll / tracking, merged ahead of list status.

export const CONTINUE_ACTIVITY_KEY = "ksContinueActivity";
export const CONTINUE_ACTIVITY_MAX = 20;

export function cleanContinueRow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "").trim();
  if (!id) return null;
  const progress = Math.max(0, Math.round(Number(raw.progress) || 0));
  const episodes = Number(raw.episodes) > 0 ? Math.round(Number(raw.episodes)) : null;
  if (episodes && progress >= episodes) return null;
  const next = Math.max(progress + 1, Math.round(Number(raw.next) || 0) || progress + 1);
  return {
    id,
    title: String(raw.title || "").slice(0, 180),
    cover: typeof raw.cover === "string" && raw.cover.startsWith("https://") ? raw.cover : "",
    progress,
    next: episodes ? Math.min(next, episodes) : next,
    episodes,
    service: String(raw.service || "").slice(0, 40),
    at: Number(raw.at) || 0,
    playUrl: typeof raw.playUrl === "string" ? raw.playUrl.slice(0, 500) : "",
    anilistId: Number(raw.anilistId) > 0 ? Number(raw.anilistId) : null,
  };
}

export function normalizeContinueActivity(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.rows) ? raw.rows : [];
  const byId = new Map();
  for (const item of list) {
    const row = cleanContinueRow(item);
    if (!row) continue;
    const prev = byId.get(row.id);
    if (!prev || row.at >= prev.at) byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) => b.at - a.at || a.title.localeCompare(b.title)).slice(0, CONTINUE_ACTIVITY_MAX);
}

export function upsertContinueActivity(list, row, { now = Date.now(), limit = CONTINUE_ACTIVITY_MAX } = {}) {
  const next = cleanContinueRow({ ...row, at: Number(row?.at) || now });
  if (!next) return normalizeContinueActivity(list);
  const rest = (Array.isArray(list) ? list : []).filter((item) => String(item?.id) !== next.id);
  return normalizeContinueActivity([next, ...rest]).slice(0, limit);
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
export function activityFromWatchEpisode({ id, title, cover, episodes, playUrl, anilistId, episode, service = "crunchyroll", at = Date.now() }) {
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
  });
}
