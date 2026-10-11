// Title equality is only for linking a Crunchyroll name to AniList.
// A sequel can share a franchise key and still keep its own season record.

export function normalizeTitle(input) {
  if (input == null) return "";
  let text = String(input).normalize("NFKC").toLowerCase();
  text = text.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
  text = text.replace(/\b(\d+)(st|nd|rd|th)\s+season\b/g, " ");
  text = text.replace(/\b(season|part|cour)\s*\d+\b/g, " ");
  text = text.replace(/[^\p{L}\p{N}\s]/gu, " ");
  return text.replace(/\s+/g, " ").trim();
}

function compactTitle(normalized) {
  return normalized.replace(/\s+/g, "");
}

export function titlesOf(media) {
  if (!media) return [];
  const title = media.title || {};
  return [title.english, title.romaji, title.native, ...(media.synonyms || [])].filter(Boolean);
}

function seasonMarker(text) {
  const match = String(text || "").toLowerCase().match(/\b(?:season|part|cour)\s*(\d+)\b/);
  return match ? Number(match[1]) : null;
}

function sameTitle(queryNorm, title) {
  const normalized = normalizeTitle(title);
  if (!normalized) return false;
  if (normalized === queryNorm) return true;
  return compactTitle(normalized) === compactTitle(queryNorm);
}

export function pickMatch(query, mediaList) {
  const queryNorm = normalizeTitle(query);
  if (!queryNorm) return { confidence: "none", reason: "empty" };

  const hits = [];
  for (const media of mediaList || []) {
    if (titlesOf(media).some((title) => sameTitle(queryNorm, title))) hits.push(media);
  }

  if (hits.length === 1) return { confidence: "high", media: hits[0] };
  if (hits.length === 0) return { confidence: "none", reason: "no-equal" };

  const querySeason = seasonMarker(query);
  const refined = hits.filter((media) => {
    const markers = titlesOf(media).map(seasonMarker);
    if (querySeason == null) return markers.every((marker) => marker == null);
    return markers.some((marker) => marker === querySeason);
  });

  if (refined.length === 1) return { confidence: "high", media: refined[0] };
  return { confidence: "none", reason: "ambiguous" };
}

export function tagsFromConfidentMatch(match) {
  if (!match || match.confidence !== "high" || !match.media) return [];
  return (match.media.tags || []).map((tag) => (typeof tag === "string" ? tag : tag?.name)).filter(Boolean);
}
