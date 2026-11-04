// Aggregate library stats and recently-watched history for the Prism profile page.

const STATUS_KEYS = ["watching", "plan", "finished", "dropped"];

function activeSeason(show, record) {
  if (!record?.s) return null;
  const index = Number.isInteger(record.at) ? record.at : 0;
  const state = record.s[index] || Object.values(record.s)[0];
  if (!state?.status) return null;
  const seasons = show?.seasons?.length ? show.seasons : [{ episodes: show?.episodes || null }];
  const season = seasons[index] || seasons[0] || {};
  return { index, state, season, episodes: season.episodes || show?.episodes || null };
}

function episodesFor(state, episodes) {
  const progress = Math.max(0, Number(state?.progress) || 0);
  const total = Number(episodes) > 0 ? Number(episodes) : 0;
  if (state?.status === "finished" && total) return total;
  return progress;
}

function countLabels(shows, key, limit = 8) {
  const counts = new Map();
  for (const show of shows || []) {
    for (const label of show?.[key] || []) {
      const name = String(label || "").trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

/**
 * @param {{ shows?: object[], library?: object, now?: number, recentLimit?: number }} opts
 * library is Prism's mirror: { [showId]: { at, lastWatchedAt, s: { [i]: { status, progress } } } }
 */
export function profileStats({ shows = [], library = {}, now = Date.now(), recentLimit = 30 } = {}) {
  const counts = Object.fromEntries(STATUS_KEYS.map((key) => [key, 0]));
  let episodesLogged = 0;
  let finishedThisYear = 0;
  const year = new Date(now).getFullYear();
  const listed = [];
  const recentPool = [];

  for (const show of shows || []) {
    const record = library?.[show.id];
    const active = activeSeason(show, record);
    if (!active) continue;
    const { state, episodes } = active;
    if (!STATUS_KEYS.includes(state.status)) continue;
    counts[state.status] += 1;
    episodesLogged += episodesFor(state, episodes);
    listed.push(show);
    const at = Number(record.lastWatchedAt) || 0;
    if (state.status === "finished" && at) {
      if (new Date(at).getFullYear() === year) finishedThisYear += 1;
    }
    if (at > 0 && (state.status === "watching" || state.status === "finished" || state.status === "dropped")) {
      recentPool.push({
        id: show.id,
        title: show.title,
        cover: show.cover || show.poster || "",
        status: state.status,
        progress: Math.max(0, Number(state.progress) || 0),
        episodes: Number(episodes) > 0 ? Number(episodes) : null,
        at,
      });
    }
  }

  recentPool.sort((a, b) => b.at - a.at || a.title.localeCompare(b.title));

  return {
    counts,
    listed: listed.length,
    episodesLogged,
    finishedThisYear,
    topGenres: countLabels(listed, "genres"),
    topTags: countLabels(listed, "tags"),
    recent: recentPool.slice(0, recentLimit),
  };
}
