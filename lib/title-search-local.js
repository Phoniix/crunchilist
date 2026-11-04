import { decodeRow } from "./id-map.js";
import { readAllShows } from "./idb.js";

const loose = (text) => String(text || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Title search against the local master list (id-map). Fast enough for the popup and site panels.
// Returns brief show rows { anilistId, title, year, format, episodes, cover, score }.
export async function searchLocalTitles(query, { limit = 20 } = {}) {
  const q = loose(query);
  if (q.length < 2) return [];
  const { rows, header } = await readAllShows();
  if (!header || !rows?.length) return [];
  const feed = { pictureBase: header.pictureBase || "", tags: header.tags || [], studios: header.studios || [] };
  const words = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const row of rows) {
    const names = [row.title, ...(row.synonyms || [])].map(loose).filter(Boolean);
    let best = 0;
    for (const name of names) {
      if (name === q) best = Math.max(best, 100);
      else if (name.startsWith(q)) best = Math.max(best, 80);
      else if (name.includes(q)) best = Math.max(best, 60);
      else if (words.every((word) => name.includes(word))) best = Math.max(best, 40);
    }
    if (!best) continue;
    const show = decodeRow(row, feed);
    scored.push({
      score: best,
      popularity: row.score || 0,
      show: {
        id: String(show.anilistId),
        anilistId: show.anilistId,
        title: show.title,
        year: show.year,
        format: show.format,
        episodes: show.episodes,
        cover: show.picture,
        score: show.score,
      },
    });
  }
  return scored.sort((a, b) => b.score - a.score || b.popularity - a.popularity).slice(0, limit).map((item) => item.show);
}
