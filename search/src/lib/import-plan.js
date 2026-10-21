// Turns grouped history into a preview: AniList changes to apply, and shows that need a one-time pick.
import { looseKey } from "./match-engine.js";
import { safeChange } from "./safe-change.js";

// Which watched episodes, with their play times, landed on each AniList entry.
export function watchedParts(group, found) {
  const order = [...new Set(group.episodes)].sort((a, b) => a - b);
  const times = order.map((episode) => group.played?.[episode] || 0);
  const out = [];
  let used = 0;
  for (const part of found.parts || []) {
    const isMovie = part.episodes.length === 1 && part.episodes[0] === 1 && order.length > 1 && found.parts.length === 1;
    const slice = isMovie ? times : times.slice(used, used + part.episodes.length);
    used += isMovie ? order.length : part.episodes.length;
    const known = slice.filter(Boolean);
    out.push({ anilistId: part.anilistId, progress: part.progress, firstPlayed: known.length ? Math.min(...known) : 0, lastPlayed: known.length ? Math.max(...known) : 0 });
  }
  return out;
}

// Matches every group; confident results become watched parts, the rest wait for the user.
// With dropUnmatched, groups with no candidate at all are only counted (non-anime on general services).
// dropUnmatched can also be a function of the group, when groups come from several services.
export function matchGroups(groups, matchOne, { dropUnmatched = false } = {}) {
  const watched = [];
  const pending = [];
  let dropped = 0;
  const droppedNames = new Set();
  for (const group of groups) {
    const found = matchOne(group);
    const input = { series: group.series, season: group.season, seasonNumber: group.seasonNumber, episodes: group.episodes, played: group.played, kind: group.kind, year: group.year ?? null };
    const drop = typeof dropUnmatched === "function" ? dropUnmatched(group) : dropUnmatched;
    if (drop && !found.anilistId && !found.candidates?.length && !found.keep) { dropped += 1; droppedNames.add(group.series); continue; }
    if (!found.anilistId || found.confidence !== "high") {
      pending.push({ key: group.key, service: group.service, input, reason: found.reason, candidates: found.anilistId ? [found.anilistId, ...found.candidates] : found.candidates, suggested: found.anilistId || null, lastPlayed: group.lastPlayed });
      continue;
    }
    for (const part of watchedParts(group, found)) watched.push({ ...part, source: { key: group.key, series: group.series, season: group.season, how: found.how, remembered: Boolean(found.remembered) } });
  }
  return { watched, pending, dropped, droppedNames: [...droppedNames].sort((a, b) => a.localeCompare(b)) };
}

// Pending items made under older rules for general services are dropped when this goes up.
export const GENERAL_RULES = 3;
const WEAK_FORMATS = new Set(["SPECIAL", "MUSIC", "OVA", "PV", "CM"]);
const NONE = { anilistId: null, confidence: "none", parts: [], candidates: [], reason: "Not anime." };

// On services that carry everything, an entry only counts when the show's own name is one of the entry's names
// (or that name plus a season marker), it's a full show or film, it has room for the episodes watched, and,
// unless the service files the show under anime, it came out within a year of the service's own year for it.
export function generalFit(engine, group) {
  const name = looseKey(group.series);
  const season = looseKey(group.season);
  const watched = group.episodes?.length || 0;
  const year = group.anime === true ? null : group.year || null;
  return (id, { roomy = false } = {}) => {
    const row = engine.row(id);
    if (!row || !name || WEAK_FORMATS.has(row.format)) return false;
    const named = [row.title, ...(row.synonyms || [])].map(looseKey).some((other) => other === name
      || (other.startsWith(`${name} `) && (/\d|season|part|final/.test(other.slice(name.length)) || (season && other.includes(season)))));
    if (!named) return false;
    if (year && !(row.year && (Math.abs(row.year - year) <= 1 || ((group.seasonNumber || 1) > 1 && row.year > year)))) return false;
    return !roomy || !(row.episodes && row.status === "FINISHED" && watched > row.episodes);
  };
}

// Services with live action too: only strong anime matches go through; shared live-action names wait for a pick;
// a show whose seasons don't line up with AniList's is offered by its name; everything else is dropped as not anime.
// group.anime: true/false when the service says whether it's anime, null when it doesn't say.
export function checkGeneral(engine, group, found, liveActionNames = new Set(), serviceName = "Netflix") {
  if (group.anime === false) return NONE;
  const fits = generalFit(engine, group);
  if (found.anilistId && found.confidence === "high") {
    if (!fits(found.anilistId)) return NONE;
    if (liveActionNames.has(looseKey(group.series))) return { ...found, confidence: "low", reason: `${serviceName} also has a live-action version with this name. Pick the anime only if that's what you watched.` };
    return found;
  }
  const candidates = [found.anilistId, ...(found.candidates || [])].filter((id, index, list) => id && list.indexOf(id) === index && fits(id, { roomy: true }));
  if (candidates.length) return { ...found, anilistId: null, confidence: "none", candidates, reason: found.reason || "More than one AniList entry fits; pick the right one once." };
  const byName = group.season ? engine.match({ ...group, season: "", seasonNumber: null }) : null;
  if (byName?.anilistId && fits(byName.anilistId, { roomy: true })) {
    return { ...NONE, candidates: [byName.anilistId], reason: `${serviceName} splits this show into seasons its own way. Pick the entry; only this season's episodes are counted.` };
  }
  // The service files it under anime: never dropped. Offer entries whose names begin with it, or ask for a link.
  if (group.anime !== true) return NONE;
  const starts = (engine.startingWith?.(group.series) || []).filter((id) => !WEAK_FORMATS.has(engine.row(id)?.format)).slice(0, 6);
  return {
    ...NONE,
    keep: true,
    candidates: starts,
    reason: starts.length ? `${serviceName} calls this anime; these AniList entries start with its name.` : `${serviceName} calls this anime, but it isn't in the master list. Paste its AniList link, or skip it.`,
  };
}

// Several Crunchyroll seasons (sub and dub) can land on one entry: keep the furthest progress and the widest dates.
export function mergeWatched(watched) {
  const byId = new Map();
  for (const item of watched) {
    const current = byId.get(item.anilistId);
    if (!current) {
      byId.set(item.anilistId, { anilistId: item.anilistId, progress: item.progress, firstPlayed: item.firstPlayed, lastPlayed: item.lastPlayed, sources: [item.source] });
      continue;
    }
    current.progress = Math.max(current.progress, item.progress);
    current.firstPlayed = [current.firstPlayed, item.firstPlayed].filter(Boolean).reduce((a, b) => Math.min(a, b), Infinity);
    if (current.firstPlayed === Infinity) current.firstPlayed = 0;
    current.lastPlayed = Math.max(current.lastPlayed, item.lastPlayed);
    current.sources.push(item.source);
  }
  return [...byId.values()];
}

// entries/media: Map of anilistId -> AniList list entry / { episodes, status, title }.
export function planChanges(watched, entries, media) {
  const changes = [];
  let unchanged = 0;
  for (const item of mergeWatched(watched)) {
    const info = media.get(item.anilistId);
    if (!info) continue;
    const change = safeChange(entries.get(item.anilistId) || null, info, item);
    if (!change) { unchanged += 1; continue; }
    changes.push({ anilistId: item.anilistId, title: info.title || "", episodes: info.episodes || null, entryId: entries.get(item.anilistId)?.id || null, ...change, sources: item.sources, lastPlayed: item.lastPlayed });
  }
  changes.sort((a, b) => b.lastPlayed - a.lastPlayed);
  return { changes, unchanged };
}
