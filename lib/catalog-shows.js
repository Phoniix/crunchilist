// Non-Crunchyroll titles matched from connected service catalogs (and gap links), shaped like Prism shows / search items.
import { SERVICE_BRAND, pickPlayLink } from "./play-url.js";
import { serviceById } from "./services.js";

function streamingFromLinks(links = []) {
  return links
    .map((link) => {
      const svc = serviceById(link.service);
      if (!link?.url || !svc) return null;
      return {
        site: svc.name,
        url: link.url,
        color: SERVICE_BRAND[link.service] || "",
        ...(link.checked ? { checked: true } : {}),
        ...(link.seen ? { seen: true } : {}),
      };
    })
    .filter(Boolean);
}

// Titles with AniList media that appear in availability but aren't already on the CR catalog.
// enrich: require genres and/or about so mood search isn't flooded with bare stubs.
// Availability already keeps high-confidence catalog matches only (matchCatalog).
export function catalogOnlyShows(found, media, already, { enrich = false } = {}) {
  const out = [];
  for (const [anilistId, links] of Object.entries(found || {})) {
    const id = Number(anilistId);
    if (!Number.isInteger(id) || already.has(id) || !links?.length) continue;
    const node = media[id] || {};
    const title = node.title || node.romaji || "";
    if (!title) continue;
    const genres = node.genres || [];
    const about = node.about || "";
    if (enrich && !genres.length && !about) continue;
    const sources = [...new Set(links.map((link) => link.service).filter(Boolean))];
    const streaming = streamingFromLinks(links);
    const play = pickPlayLink({ streaming });
    out.push({
      id: `al-${id}`,
      anilistId: id,
      title,
      romaji: node.romaji || "",
      native: node.native || "",
      genres,
      tags: node.tags || [],
      about,
      year: node.year || null,
      season: node.season || null,
      score: node.score ?? null,
      popularity: node.popularity ?? null,
      episodes: node.episodes ?? null,
      duration: node.duration ?? null,
      studio: node.studio || "",
      status: node.status || null,
      format: node.format || null,
      type: node.format === "MOVIE" ? "movie" : "series",
      cover: node.cover || "",
      banner: node.banner || "",
      color: node.color || "",
      trailer: node.trailer || "",
      airing: node.airing || null,
      url: play?.url || streaming[0]?.url || "",
      sources,
      rank: 1e6 + out.length,
      fresh: false,
      onCrunchyroll: false,
      streaming,
      seasons: [{
        anilistId: id,
        label: node.format === "MOVIE" ? "Movie" : "Season 1",
        title,
        format: node.format || "TV",
        episodes: node.episodes ?? null,
        year: node.year || null,
        season: node.season || null,
        status: node.status || null,
        score: node.score ?? null,
        cover: node.cover || "",
      }],
    });
  }
  return out;
}
