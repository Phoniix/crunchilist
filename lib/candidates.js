import {
  cacheKeyForSeason,
  cacheKeyForSeries,
  readCache,
  showFactsFromHit,
} from "./anilist.js";
import {
  displayTitle,
  isSeriesLevel,
  pickRepresentativeSeason,
  seriesCardDecision,
} from "./season.js";
import { uniqueStrings } from "./text.js";

function candidateFromRecord(state, record, now, extras = {}) {
  const cache = readCache(state.anilistCache, cacheKeyForSeason(record.seriesId, record.seasonSlug), now);
  const hit = cache?.kind === "hit" ? cache : null;
  const imported = hit ? state.imports?.[hit.anilistId] : null;
  let status = record.status ?? null;
  if (status == null && !record.statusSetByUser && imported) status = imported.status;

  return {
    id: record.key,
    title: extras.title || displayTitle(record),
    url: extras.url || record.url || `https://www.crunchyroll.com/series/${record.seriesId}`,
    status,
    episodes: hit?.episodes ?? null,
    crEpisodes: record.episodeCount ?? null,
    format: hit?.format || null,
    tags: hit ? hit.tags.slice() : [],
    genres: uniqueStrings([...(hit?.genres || []), ...(record.genres || [])]),
    anilistMatched: Boolean(hit),
    franchiseKey: hit?.franchiseKey || record.franchiseKey || `cr:${record.seriesId}`,
    seriesId: record.seriesId,
    seasonNumber: record.seasonNumber ?? null,
    audio: record.audio || extras.audio || "unknown",
    lastSeenAt: record.lastSeenAt || extras.lastSeenAt || 0,
    movieSignal: Boolean(record.movieSignal || extras.movieSignal),
    ...showFactsFromHit(hit?.detailed ? hit : readCache(state.anilistCache, cacheKeyForSeries(record.seriesId), now)),
  };
}

function candidateFromSighting(state, sighting, now) {
  const specific = Object.values(state.seasons).filter((season) => season.seriesId === sighting.seriesId && !isSeriesLevel(season));
  if (specific.length) {
    const record = pickRepresentativeSeason(specific);
    return candidateFromRecord(state, record, now, {
      title: displayTitle(record),
      url: sighting.url || record.url,
      audio: sighting.audio && sighting.audio !== "unknown" ? sighting.audio : record.audio,
      lastSeenAt: sighting.lastSeenAt || record.lastSeenAt,
    });
  }

  const cache = readCache(state.anilistCache, cacheKeyForSeries(sighting.seriesId), now);
  const hit = cache?.kind === "hit" ? cache : null;
  const decision = seriesCardDecision(sighting.seriesId, state.seasons);
  const imported = hit ? state.imports?.[hit.anilistId] : null;
  let status = decision.mark === "unwatched" ? null : decision.mark;
  if (status == null && imported) status = imported.status;

  return {
    id: `sight:${sighting.seriesId}`,
    title: sighting.title || hit?.titles?.english || hit?.titles?.romaji || "Untitled",
    url: sighting.url || `https://www.crunchyroll.com/series/${sighting.seriesId}`,
    status,
    episodes: hit?.episodes ?? null,
    crEpisodes: null,
    format: hit?.format || null,
    tags: hit ? hit.tags.slice() : [],
    genres: uniqueStrings([...(hit?.genres || []), ...(sighting.genres || [])]),
    anilistMatched: Boolean(hit),
    franchiseKey: hit?.franchiseKey || `cr:${sighting.seriesId}`,
    seriesId: sighting.seriesId,
    seasonNumber: null,
    audio: sighting.audio || "unknown",
    lastSeenAt: sighting.lastSeenAt || 0,
    movieSignal: hit?.format === "MOVIE",
    ...showFactsFromHit(hit),
  };
}

export function buildCandidates(state, observation, now) {
  if (!observation) return [];
  const out = [];
  const seen = new Set();
  const seasonSeries = new Set((observation.seasons || []).map((season) => season.seriesId));

  for (const partial of observation.seasons || []) {
    const key = `${partial.seriesId}|${partial.seasonSlug}`;
    const record = state.seasons?.[key];
    if (!record || seen.has(record.key)) continue;
    seen.add(record.key);
    out.push(candidateFromRecord(state, record, now));
  }

  for (const sighting of observation.sightings || []) {
    if (!sighting?.seriesId || seasonSeries.has(sighting.seriesId)) continue;
    const representative = Object.values(state.seasons || {}).find((season) => season.seriesId === sighting.seriesId && !isSeriesLevel(season));
    const id = representative ? representative.key : `sight:${sighting.seriesId}`;
    if (seen.has(id) || seen.has(`sight:${sighting.seriesId}`)) continue;
    const candidate = candidateFromSighting(state, sighting, now);
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    out.push(candidate);
  }

  return out;
}
