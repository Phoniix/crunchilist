import { uniqueStrings } from "./text.js";

export const ANILIST_GENRES = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Horror",
  "Mahou Shoujo",
  "Mecha",
  "Music",
  "Mystery",
  "Psychological",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Sports",
  "Supernatural",
  "Thriller",
];

export function defaultTaste() {
  return {
    liked: [],
    disliked: [],
    dropped: [],
    subDub: "any",
    hardAvoids: [],
  };
}

export function sanitizeTaste(input) {
  const source = input || {};
  const taste = defaultTaste();
  taste.liked = uniqueStrings(source.liked);
  taste.disliked = uniqueStrings(source.disliked);
  taste.dropped = uniqueStrings(source.dropped);
  taste.hardAvoids = uniqueStrings(source.hardAvoids);
  taste.subDub = ["any", "sub", "dub"].includes(source.subDub) ? source.subDub : "any";
  return taste;
}

function overlap(labels, needles) {
  const wanted = new Set((needles || []).map((item) => item.toLowerCase()));
  const found = [];
  const seen = new Set();
  for (const label of labels || []) {
    const key = String(label).toLowerCase();
    if (wanted.has(key) && !seen.has(key)) {
      seen.add(key);
      found.push(label);
    }
  }
  return found;
}

export function isThisForMe(candidate, taste) {
  const profile = sanitizeTaste(taste);
  if (!candidate) return "Open a series or episode to check it against your taste.";

  const labels = [...(candidate.tags || []), ...(candidate.genres || [])];
  const avoids = overlap(labels, profile.hardAvoids);
  const liked = overlap(labels, profile.liked);
  const disliked = overlap(labels, profile.disliked);
  const dropped = overlap(labels, profile.dropped);
  const bits = [];

  if (avoids.length) bits.push(`hits your hard avoids (${avoids.slice(0, 3).join(", ")})`);
  if (liked.length) bits.push(`matches likes (${liked.slice(0, 3).join(", ")})`);
  if (disliked.length) bits.push(`matches dislikes (${disliked.slice(0, 3).join(", ")})`);
  if (dropped.length) bits.push(`matches tags you dropped (${dropped.slice(0, 3).join(", ")})`);
  if (profile.subDub === "sub" && candidate.audio === "dub") bits.push("this listing is dubbed and you prefer subs");
  if (profile.subDub === "dub" && candidate.audio === "sub") bits.push("this listing is subtitled and you prefer dubs");
  if (candidate.status === "finished") bits.push("you already finished this season");
  if (candidate.status === "dropped") bits.push("you dropped this season");
  if (candidate.status === "in_progress") bits.push("you already started this season");
  if (!candidate.anilistMatched) bits.push("no confident AniList match, so only Crunchyroll genres are available");

  if (!bits.length) return "No strong signal yet. Add liked or avoided tags, or mark a few seasons.";
  const lead = avoids.length ? "Probably not for you" : liked.length && !disliked.length && !dropped.length ? "Looks like a fit" : "Mixed signal";
  return `${lead}: ${bits.join("; ")}.`;
}

function bump(map, labels, amount) {
  for (const label of labels || []) {
    const key = String(label || "").trim().toLowerCase();
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + amount);
  }
}

function mediaLabels(media) {
  if (!media) return [];
  const tags = (media.tags || []).map((tag) => (typeof tag === "string" ? tag : tag?.name)).filter(Boolean);
  return [...(media.genres || []), ...tags];
}

export function buildWeights(state) {
  const liked = new Map();
  const disliked = new Map();
  const taste = sanitizeTaste(state?.taste);
  bump(liked, taste.liked, 5);
  bump(disliked, taste.disliked, 5);
  bump(disliked, taste.dropped, 3);

  for (const entry of Object.values(state?.imports || {})) {
    const labels = mediaLabels(entry.media);
    if (entry.status === "finished" || entry.status === "in_progress") bump(liked, labels, 1);
    if (entry.status === "dropped") bump(disliked, labels, 1);
  }

  return { liked, disliked };
}

export function allowedByTaste(labels, taste) {
  const blocked = new Set((sanitizeTaste(taste).hardAvoids || []).map((item) => item.toLowerCase()));
  if (!blocked.size) return true;
  return !(labels || []).some((label) => blocked.has(String(label).toLowerCase()));
}

export function scoreLabels(labels, weights) {
  let score = 0;
  for (const label of labels || []) {
    const key = String(label || "").trim().toLowerCase();
    if (!key) continue;
    score += weights?.liked?.get(key) || 0;
    score -= weights?.disliked?.get(key) || 0;
  }
  return score;
}

export function collectTagSuggestions(state) {
  const values = [...ANILIST_GENRES];
  for (const row of Object.values(state?.anilistCache || {})) {
    if (row?.kind !== "hit") continue;
    values.push(...(row.genres || []), ...(row.tags || []));
  }
  for (const entry of Object.values(state?.imports || {})) {
    values.push(...(entry.media?.genres || []));
    for (const tag of entry.media?.tags || []) values.push(typeof tag === "string" ? tag : tag?.name);
  }
  return uniqueStrings(values, 500).sort((a, b) => a.localeCompare(b));
}

export function filterTagSuggestions(query, options, exclude, limit = 8) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return [];
  const skip = new Set((exclude || []).map((item) => String(item).toLowerCase()));
  const starts = [];
  const contains = [];
  for (const option of options || []) {
    const key = String(option).toLowerCase();
    if (skip.has(key)) continue;
    if (key.startsWith(needle)) starts.push(option);
    else if (key.includes(needle)) contains.push(option);
  }
  return [...starts, ...contains].slice(0, limit);
}

export function compactProfile(taste) {
  const profile = sanitizeTaste(taste);
  return {
    liked: profile.liked,
    disliked: profile.disliked,
    dropped: profile.dropped,
    hardAvoids: profile.hardAvoids,
    audioPreference: profile.subDub,
  };
}
