const SEASON = /^(.*?)[\s:,–-]*\b((?:season|series|part)\s+(\d{1,3})\b.*)$/i;

// "Vikings: Season 5" / "Vikings Season 4" -> series and season; names without a season stay whole.
export function splitSeasonTitle(name) {
  const match = SEASON.exec(name || "");
  const series = match ? match[1].replace(/[\s:,–-]+$/, "").trim() : "";
  return series ? { series, season: match[2].trim(), seasonNumber: Number(match[3]) } : { series: name || "", season: "", seasonNumber: null };
}

// Rows from services that name episodes by number most of the time (Prime Video) -> one group per season.
// A season where every episode has its number keeps those numbers; otherwise its distinct episodes count 1..n
// in the order first played, like Netflix.
export function groupEpisodes(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    if (!row?.groupId || !row.watched) continue;
    let group = groups.get(row.groupId);
    if (!group) {
      group = { id: row.groupId, kind: row.kind, seriesId: row.seriesId, seasonId: row.seasonId, series: row.series, year: row.year ?? null, anime: row.anime ?? null, season: row.season, seasonNumber: row.seasonNumber, seen: new Map(), numbered: true };
      groups.set(row.groupId, group);
    }
    if (!row.episode) group.numbered = false;
    const id = row.episode ? `#${row.episode}` : row.episodeKey || row.key;
    const earlier = group.seen.get(id)?.at || 0;
    const at = row.playedAt || 0;
    group.seen.set(id, { episode: row.episode || null, at: earlier && at ? Math.min(earlier, at) : earlier || at });
  }
  return [...groups.values()].map(({ seen, numbered, ...group }) => {
    const list = [...seen.values()];
    const played = {};
    if (numbered) for (const { episode, at } of list) played[episode] = at;
    else list.sort((a, b) => (a.at || Infinity) - (b.at || Infinity)).forEach(({ at }, index) => { played[index + 1] = at; });
    const episodes = Object.keys(played).map(Number).sort((a, b) => a - b);
    const times = Object.values(played).filter(Boolean);
    return { ...group, played, episodes, firstPlayed: times.length ? Math.min(...times) : 0, lastPlayed: times.length ? Math.max(...times) : 0 };
  });
}
