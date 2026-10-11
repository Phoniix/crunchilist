import { cloneState } from "./state.js";
import { isGenericSeasonTitle, slugify } from "./text.js";

export const SERIES_MARK = "*";

export function seasonKey(seriesId, seasonSlug) {
  return `${seriesId}|${seasonSlug}`;
}

export function seriesMarkKey(seriesId) {
  return seasonKey(seriesId, SERIES_MARK);
}

export function isSeriesLevel(record) {
  return Boolean(record?.seriesLevel || record?.seasonSlug === SERIES_MARK);
}

function emptySeason(key, incoming) {
  return {
    key,
    seriesId: incoming.seriesId,
    seasonSlug: incoming.seasonSlug,
    seasonId: null,
    seasonNumber: null,
    seasonTitle: "",
    seriesTitle: "",
    seriesSlug: "",
    url: "",
    episodeCount: null,
    episodesWatched: null,
    audio: "unknown",
    subtitles: "",
    genres: [],
    status: null,
    statusSetByUser: false,
    statusSource: null,
    crEpisode: null,
    listProgress: null,
    anilistListId: null,
    seriesLevel: false,
    anilistId: null,
    franchiseKey: `cr:${incoming.seriesId}`,
    lastSeenAt: 0,
    updatedAt: 0,
  };
}

function migrateDomKey(seasons, incoming) {
  const desired = seasonKey(incoming.seriesId, incoming.seasonSlug);
  if (seasons[desired]) return desired;
  if (String(incoming.seasonSlug).startsWith("dom-")) return desired;

  const doms = Object.values(seasons).filter(
    (season) => season.seriesId === incoming.seriesId && String(season.seasonSlug).startsWith("dom-"),
  );
  let dom = null;
  if (incoming.seasonNumber != null) dom = doms.find((season) => season.seasonNumber === incoming.seasonNumber) || null;
  if (!dom && incoming.seasonTitle) {
    const want = slugify(incoming.seasonTitle);
    dom = doms.find((season) => slugify(season.seasonTitle) === want || season.seasonSlug === `dom-${want}`) || null;
  }
  if (!dom && doms.length === 1) dom = doms[0];
  if (!dom) return desired;

  seasons[desired] = { ...seasons[dom.key], key: desired, seasonSlug: incoming.seasonSlug };
  delete seasons[dom.key];
  return desired;
}

function mergeSeason(previous, incoming, key, now) {
  const base = previous || emptySeason(key, incoming);
  const nextCount = incoming.episodeCount ?? base.episodeCount ?? null;
  let status = base.status ?? null;
  let episodesWatched = base.episodesWatched ?? null;
  let crEpisode = base.crEpisode ?? null;
  if (incoming.watchingEpisode != null) crEpisode = Math.max(crEpisode || 0, incoming.watchingEpisode);
  const anilistLocked = base.statusSource === "anilist";

  // A finished season with newly listed episodes is in progress again, same record.
  // A status that came from the connected AniList account stays until the user updates that list.
  if (!anilistLocked && status === "finished" && base.episodeCount != null && nextCount != null && nextCount > base.episodeCount) {
    status = "in_progress";
  }

  if (!anilistLocked && incoming.watchingEpisode != null && status !== "dropped" && status !== "finished") {
    status = "in_progress";
    episodesWatched = Math.max(episodesWatched || 0, incoming.watchingEpisode);
  } else if (anilistLocked && incoming.watchingEpisode != null) {
    episodesWatched = Math.max(episodesWatched || 0, incoming.watchingEpisode);
  }

  return {
    ...base,
    key,
    seriesId: incoming.seriesId,
    seasonSlug: incoming.seasonSlug,
    seasonId: incoming.seasonId || base.seasonId || null,
    seasonNumber: incoming.seasonNumber ?? base.seasonNumber ?? null,
    seasonTitle: incoming.seasonTitle || base.seasonTitle || "",
    seriesTitle: incoming.seriesTitle || base.seriesTitle || "",
    seriesSlug: incoming.seriesSlug || base.seriesSlug || "",
    url: incoming.url || base.url || "",
    episodeCount: nextCount,
    episodesWatched,
    audio: incoming.audio && incoming.audio !== "unknown" ? incoming.audio : base.audio || "unknown",
    subtitles: incoming.subtitles || base.subtitles || "",
    genres: incoming.genres?.length ? incoming.genres.slice() : base.genres || [],
    status,
    statusSetByUser: base.statusSetByUser || false,
    statusSource: base.statusSource || null,
    crEpisode,
    listProgress: base.listProgress ?? null,
    anilistListId: base.anilistListId ?? null,
    seriesLevel: false,
    anilistId: incoming.anilistId ?? base.anilistId ?? null,
    franchiseKey: incoming.franchiseKey || base.franchiseKey || `cr:${incoming.seriesId}`,
    movieSignal: Boolean(incoming.movieSignal || base.movieSignal),
    lastSeenAt: now,
    updatedAt: now,
  };
}

export function applyObservations(state, observation, now) {
  const next = cloneState(state);
  for (const incoming of observation?.seasons || []) {
    if (!incoming?.seriesId || !incoming.seasonSlug || incoming.seasonSlug === SERIES_MARK) continue;
    const key = migrateDomKey(next.seasons, incoming);
    next.seasons[key] = mergeSeason(next.seasons[key], incoming, key, now);
  }

  for (const link of observation?.sightings || []) {
    if (!link?.seriesId) continue;
    const previous = next.sightings[link.seriesId] || {};
    next.sightings[link.seriesId] = {
      seriesId: link.seriesId,
      title: link.title || previous.title || "",
      url: link.url || previous.url || "",
      genres: link.genres?.length ? link.genres.slice() : previous.genres || [],
      audio: link.audio && link.audio !== "unknown" ? link.audio : previous.audio || "unknown",
      lastSeenAt: now,
    };
  }

  return next;
}

const STATUSES = new Set([null, "finished", "in_progress", "dropped", "plan"]);

export function setRecordStatus(state, id, status, now) {
  if (!STATUSES.has(status)) throw new Error("Unknown status");
  const next = cloneState(state);

  if (String(id).startsWith("sight:")) {
    const seriesId = String(id).slice("sight:".length);
    const key = seriesMarkKey(seriesId);
    const sight = next.sightings[seriesId];
    const previous = next.seasons[key] || emptySeason(key, { seriesId, seasonSlug: SERIES_MARK });
    next.seasons[key] = {
      ...previous,
      key,
      seriesId,
      seasonSlug: SERIES_MARK,
      seriesLevel: true,
      seriesTitle: previous.seriesTitle || sight?.title || "",
      url: previous.url || sight?.url || "",
      franchiseKey: previous.franchiseKey || `cr:${seriesId}`,
      status,
      statusSetByUser: true,
      statusSource: "user",
      lastSeenAt: previous.lastSeenAt || sight?.lastSeenAt || now,
      updatedAt: now,
    };
    return next;
  }

  if (!next.seasons[id]) return next;
  next.seasons[id].status = status;
  next.seasons[id].statusSetByUser = true;
  next.seasons[id].statusSource = "user";
  next.seasons[id].updatedAt = now;
  if (status === "finished" && next.seasons[id].episodeCount != null) {
    next.seasons[id].episodesWatched = next.seasons[id].episodeCount;
  }
  if (status == null) next.seasons[id].episodesWatched = null;
  return next;
}

export function seriesCardDecision(seriesId, seasons) {
  const records = Object.values(seasons || {}).filter((season) => season.seriesId === seriesId);
  const specific = records.filter((season) => !isSeriesLevel(season));
  const seriesMark = records.find((season) => isSeriesLevel(season));

  if (!specific.length) {
    if (seriesMark?.status === "finished") return { hide: true, mark: "finished" };
    return { hide: false, mark: seriesMark?.status || "unwatched" };
  }

  if (specific.every((season) => season.status === "finished")) return { hide: true, mark: "finished" };
  if (specific.every((season) => season.status === "dropped")) return { hide: false, mark: "dropped" };
  if (specific.every((season) => season.status === "plan")) return { hide: false, mark: "plan" };
  if (specific.some((season) => season.status === "in_progress" || season.status === "finished")) {
    return { hide: false, mark: "in_progress" };
  }
  if (specific.some((season) => season.status === "dropped")) return { hide: false, mark: "dropped" };
  if (seriesMark?.status && seriesMark.status !== "finished") return { hide: false, mark: seriesMark.status };
  return { hide: false, mark: "unwatched" };
}

export function pickRepresentativeSeason(seasons) {
  const rank = { plan: 0, in_progress: 1, dropped: 2, finished: 3 };
  return seasons.slice().sort((a, b) => {
    const ra = a.status == null ? 0 : rank[a.status] ?? 0;
    const rb = b.status == null ? 0 : rank[b.status] ?? 0;
    if (ra !== rb) return ra - rb;
    return (a.seasonNumber ?? 99) - (b.seasonNumber ?? 99);
  })[0];
}

export function progressOfferFor(record) {
  if (!record || record.statusSource !== "anilist" || !record.anilistId) return null;
  if (record.status === "dropped" || record.status === "finished") return null;
  const to = record.crEpisode;
  if (to == null) return null;
  const from = record.listProgress ?? 0;
  if (to <= from) return null;
  const status = record.status === "plan" || record.status == null ? "in_progress" : record.status;
  return { id: record.key, from, to, status };
}

export function displayTitle(record) {
  const series = record.seriesTitle || "";
  const season = record.seasonTitle || "";
  if (series && season && !isGenericSeasonTitle(season) && season.toLowerCase() !== series.toLowerCase()) {
    return `${series} — ${season}`;
  }
  if (series && record.seasonNumber) return `${series} (Season ${record.seasonNumber})`;
  return series || season || "Untitled";
}
