// Title search for site panels / popup: master list (id-map) first, then Prism shows for play links.
import { pickPlayLink } from "../lib/play-url.js";
import { serviceById, serviceForSite } from "../lib/services.js";
import { searchLocalTitles } from "../lib/title-search-local.js";
import { appData } from "./app-data.js";

function playUrlFor(show, serviceId) {
  return pickPlayLink(show, { preferService: serviceId || "" })?.url || show.url || show.streaming?.[0]?.url || "";
}

function onService(show, serviceId) {
  if (!serviceId) return true;
  if (serviceId === "crunchyroll" && show.onCrunchyroll) return true;
  return (show.streaming || []).some((link) => serviceForSite(link.site)?.id === serviceId)
    || (show.onServices || []).includes(serviceId);
}

function scoreTitle(show, query) {
  const q = query.toLowerCase();
  const titles = [show.title, show.romaji, show.native].filter(Boolean).map((text) => String(text).toLowerCase());
  if (titles.some((text) => text === q)) return 100;
  if (titles.some((text) => text.startsWith(q))) return 80;
  if (titles.some((text) => text.includes(q))) return 50;
  return 0;
}

function rowFromShow(show, serviceId) {
  return {
    id: show.id,
    anilistId: show.anilistId || null,
    title: show.title,
    cover: show.cover,
    year: show.year,
    episodes: show.episodes,
    playUrl: playUrlFor(show, serviceId),
  };
}

export async function titleSearch({ query = "", service = "", limit = 10 } = {}) {
  const q = String(query || "").trim();
  if (q.length < 2) return { shows: [] };
  const serviceId = serviceById(service)?.id || "";
  const cap = Math.min(30, Number(limit) || 10);
  const { shows } = await appData();
  const byAnilist = new Map(shows.filter((show) => show.anilistId).map((show) => [show.anilistId, show]));

  // Prefer the local master list so panels can find titles that aren't on Crunchyroll yet.
  let local = [];
  try {
    local = await searchLocalTitles(q, { limit: Math.max(cap * 3, 40) });
  } catch {
    local = [];
  }

  if (local.length) {
    const ranked = [];
    const seen = new Set();
    for (const hit of local) {
      const show = byAnilist.get(hit.anilistId);
      if (show) {
        if (!onService(show, serviceId)) continue;
        ranked.push(rowFromShow(show, serviceId));
        seen.add(show.id);
      } else if (!serviceId) {
        // Master-list hit with no Prism show yet — still list it; play URL may be empty until catalogs catch up.
        ranked.push({
          id: `al-${hit.anilistId}`,
          anilistId: hit.anilistId,
          title: hit.title,
          cover: hit.cover,
          year: hit.year,
          episodes: hit.episodes,
          playUrl: "",
        });
        seen.add(`al-${hit.anilistId}`);
      }
      if (ranked.length >= cap) break;
    }
    if (ranked.length) return { shows: ranked };
  }

  // Fallback: score the Prism corpus (Crunchyroll + catalog-linked + library).
  const ranked = shows
    .filter((show) => onService(show, serviceId))
    .map((show) => ({ show, score: scoreTitle(show, q) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || (b.show.popularity || 0) - (a.show.popularity || 0))
    .slice(0, cap)
    .map(({ show }) => rowFromShow(show, serviceId));
  return { shows: ranked };
}

export async function continueWatching({ service = "", limit = 5 } = {}) {
  const serviceId = serviceById(service)?.id || "";
  const { shows, library } = await appData();
  const rows = [];
  for (const show of shows) {
    if (!onService(show, serviceId)) continue;
    const mirrored = library?.[show.id];
    if (!mirrored?.s) continue;
    const indexes = Object.keys(mirrored.s).map(Number);
    const watching = indexes.find((index) => mirrored.s[index]?.status === "watching");
    if (watching == null) continue;
    const progress = mirrored.s[watching].progress || 0;
    const season = show.seasons?.[watching];
    rows.push({
      id: show.id,
      title: show.title,
      cover: season?.cover || show.cover,
      episodes: season?.episodes || show.episodes,
      next: progress + 1,
      progress,
      playUrl: pickPlayLink(show, { preferService: serviceId, episode: progress + 1 })?.url || playUrlFor(show, serviceId),
    });
    if (rows.length >= (Number(limit) || 5)) break;
  }
  return { shows: rows };
}
