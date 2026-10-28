// Crunchyroll watch history: page URLs, row parsing and grouping by season.
// Rows keep when each episode was played, so AniList gets real started and completed dates.
export const PAGE_SIZE = 100;
export const ACCOUNT_URL = "https://www.crunchyroll.com/accounts/v1/me";
const WATCHED_SHARE = 0.9;

export function historyPageUrl(accountId, page) {
  const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE), locale: "en-US" });
  return `https://www.crunchyroll.com/content/v2/${encodeURIComponent(accountId)}/watch-history?${params}`;
}

export function nextPageUrl(next) {
  if (typeof next !== "string" || !next) return "";
  try {
    const url = new URL(next, "https://www.crunchyroll.com");
    return url.hostname === "www.crunchyroll.com" && url.pathname.includes("/watch-history") ? url.href : "";
  } catch {
    return "";
  }
}

const text = (value, max = 180) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const positive = (value) => { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; };

function share(row, durationMs) {
  if (row?.fully_watched === true) return 1;
  const playhead = Number(row?.playhead);
  return Number.isFinite(playhead) && durationMs > 0 ? Math.min(1, (playhead * 1000) / durationMs) : 0;
}

// One history row -> { key, kind, groupId, seriesId, seasonId, titles, episode, watched, playedAt }.
export function historyRow(row) {
  const panel = row?.panel;
  if (!panel || typeof panel !== "object") return null;
  const playedAt = Date.parse(row.date_played) || 0;
  const key = text(panel.id || row.id, 60);
  const movie = panel.movie_metadata;
  if (panel.type === "movie" || movie) {
    const listingId = text(movie?.movie_listing_id || row.parent_id, 60);
    if (!listingId) return null;
    return {
      key, kind: "movie", groupId: `movie:${listingId}`, seriesId: listingId, seasonId: "",
      series: text(movie?.movie_listing_title || panel.title), season: "", seasonNumber: null,
      episode: 1, watched: share(row, Number(movie?.duration_ms)) >= WATCHED_SHARE, playedAt,
    };
  }
  const meta = panel.episode_metadata;
  const seasonId = text(meta?.season_id, 60);
  const seriesId = text(meta?.series_id || row.parent_id, 60);
  if (!meta || !seasonId || !seriesId) return null;
  return {
    key, kind: "episode", groupId: `season:${seasonId}`, seriesId, seasonId,
    series: text(meta.series_title), season: text(meta.season_title), seasonNumber: positive(meta.season_number),
    episode: positive(meta.episode_number), watched: share(row, Number(meta.duration_ms)) >= WATCHED_SHARE, playedAt,
  };
}

export function parsePage(payload, seenSoFar = 0) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const rows = data.map(historyRow).filter(Boolean);
  const next = payload?.meta?.next_page;
  const reported = Number(payload?.total);
  const hasTotal = Number.isFinite(reported) && reported > 0;
  let more;
  if (typeof next === "string") more = next.length > 0;
  else if (hasTotal) more = seenSoFar + data.length < reported;
  else more = data.length >= PAGE_SIZE;
  more = more && data.length > 0;
  // CR often reports this page's size (page_size=100) as `total`, not the full history length.
  const total = hasTotal && (!more || reported > seenSoFar + data.length) ? reported : null;
  return { rows, count: data.length, total, more, nextUrl: more ? nextPageUrl(next) : "" };
}

// Rows -> one group per season (or movie), with watched episodes and when each was first and last played.
export function groupRows(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    if (!row?.groupId || !row.watched || !row.episode) continue;
    let group = groups.get(row.groupId);
    if (!group) {
      group = { id: row.groupId, kind: row.kind, seriesId: row.seriesId, seasonId: row.seasonId, series: row.series, season: row.season, seasonNumber: row.seasonNumber, played: {} };
      groups.set(row.groupId, group);
    }
    const earlier = group.played[row.episode];
    group.played[row.episode] = earlier ? Math.min(earlier, row.playedAt || earlier) : row.playedAt || 0;
  }
  return [...groups.values()].filter((group) => group.series || group.season).map((group) => {
    const episodes = Object.keys(group.played).map(Number).sort((a, b) => a - b);
    const times = Object.values(group.played).filter(Boolean);
    return { ...group, episodes, firstPlayed: times.length ? Math.min(...times) : 0, lastPlayed: times.length ? Math.max(...times) : 0 };
  });
}

// Keeps rows newer than the checkpoint; `reached` says the checkpoint was found, so older pages aren't needed.
export function newerThan(rows, checkpoint) {
  if (!checkpoint?.newestAt) return { rows, reached: false };
  const fresh = [];
  for (const row of rows) {
    if (row.playedAt < checkpoint.newestAt || (row.playedAt === checkpoint.newestAt && row.key === checkpoint.newestKey)) return { rows: fresh, reached: true };
    fresh.push(row);
  }
  return { rows: fresh, reached: false };
}

/** Daily/tracking catch-up window: only the last few days, or since the last checkpoint if that's newer. */
export const CATCH_UP_DAYS = 7;

export function catchUpCheckpoint(checkpoint, now = Date.now()) {
  const floor = now - CATCH_UP_DAYS * 24 * 60 * 60 * 1000;
  const newestAt = Number(checkpoint?.newestAt) || 0;
  if (newestAt > floor) return { newestAt, newestKey: String(checkpoint?.newestKey || "") };
  return { newestAt: floor, newestKey: "" };
}
