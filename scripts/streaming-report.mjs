// Compares AniList's official streaming links with what the Crunchyroll catalog already covers.
// node scripts/streaming-report.mjs   (needs data/anilist-streaming.json and fixtures/catalog-snapshot.json)
import { readFile, writeFile } from "node:fs/promises";

const dump = JSON.parse(await readFile("data/anilist-streaming.json", "utf8"));
const catalog = JSON.parse(await readFile("fixtures/catalog-snapshot.json", "utf8")).shows;
const all = dump.anime.filter((media) => !media.isAdult);
const byId = new Map(all.map((media) => [media.id, media]));
const SEASON_FORMATS = new Set(["TV", "TV_SHORT", "ONA"]);

// Crunchyroll series cover their seasons: walk sequel/prequel links out from every matched show. AniList
// chains often run through recap movies, so the walk passes through any format but only TV seasons count.
const crIds = new Set(catalog.map((show) => show.id));
const covered = new Set();
const seen = new Set();
const queue = catalog.map((show) => show.anilistId).filter(Boolean);
for (const id of queue) { covered.add(id); seen.add(id); }
while (queue.length) {
  const media = byId.get(queue.pop());
  for (const edge of media?.relations?.edges || []) {
    const next = byId.get(edge.node.id);
    if (!next || seen.has(next.id) || !["SEQUEL", "PREQUEL"].includes(edge.relationType)) continue;
    seen.add(next.id);
    if (SEASON_FORMATS.has(next.format)) covered.add(next.id);
    queue.push(next.id);
  }
}
for (const media of all) {
  const link = (media.externalLinks || []).find((entry) => /crunchyroll\.com\/(?:[a-z-]+\/)?series\/([A-Z0-9]+)/.test(entry.url || ""));
  if (link && crIds.has(link.url.match(/series\/([A-Z0-9]+)/)[1])) covered.add(media.id);
}

const count = (items, key) => items.reduce((out, item) => { for (const value of [].concat(key(item))) out[value] = (out[value] || 0) + 1; return out; }, {});
const sorted = (object) => Object.fromEntries(Object.entries(object).sort((a, b) => b[1] - a[1]));
const episodeSites = (media) => [...new Set((media.streamingEpisodes || []).map((episode) => episode.site))];
const streamSites = (media) => [...new Set((media.externalLinks || []).filter((link) => link.type === "STREAMING").map((link) => link.site))];
const popularityBand = (media) => (media.popularity >= 50000 ? "50k+" : media.popularity >= 10000 ? "10k-50k" : media.popularity >= 1000 ? "1k-10k" : "<1k");

const withEpisodes = all.filter((media) => media.streamingEpisodes?.length);
const withStreamLinks = all.filter((media) => streamSites(media).length);
const notCovered = withEpisodes.filter((media) => !covered.has(media.id));
const linksNotCovered = withStreamLinks.filter((media) => !covered.has(media.id));
const onlyElsewhere = notCovered.filter((media) => !episodeSites(media).includes("Crunchyroll"));
const top = (list, n = 30) => [...list].sort((a, b) => b.popularity - a.popularity).slice(0, n).map((media) => ({
  id: media.id, title: media.title.english || media.title.romaji, format: media.format, year: media.seasonYear, popularity: media.popularity,
  episodes: media.streamingEpisodes?.length || 0, sites: episodeSites(media).length ? episodeSites(media) : streamSites(media),
}));

const report = {
  fetchedAt: dump.fetchedAt,
  anilist: { total: dump.anime.length, adultExcluded: dump.anime.length - all.length, nonAdult: all.length },
  catalog: { crunchyrollShows: catalog.length, matchedToAniList: catalog.filter((show) => show.anilistId).length, anilistEntriesCovered: covered.size },
  streamingEpisodes: {
    entries: withEpisodes.length,
    episodes: withEpisodes.reduce((sum, media) => sum + media.streamingEpisodes.length, 0),
    bySite: sorted(count(withEpisodes, episodeSites)),
    coveredByCatalog: withEpisodes.length - notCovered.length,
    notCovered: notCovered.length,
    notCoveredBySite: sorted(count(notCovered, episodeSites)),
    notCoveredByFormat: sorted(count(notCovered, (media) => media.format || "?")),
    notCoveredByPopularity: sorted(count(notCovered, popularityBand)),
    notCoveredAndNotOnCrunchyroll: onlyElsewhere.length,
    topNotCovered: top(notCovered),
    topOnlyElsewhere: top(onlyElsewhere),
  },
  streamingLinks: {
    entries: withStreamLinks.length,
    bySite: sorted(count(withStreamLinks, streamSites)),
    notCovered: linksNotCovered.length,
    notCoveredBySite: sorted(count(linksNotCovered, streamSites)),
    topNotCovered: top(linksNotCovered),
  },
};
await writeFile("data/streaming-report.json", JSON.stringify(report, null, 2));
const { topNotCovered, topOnlyElsewhere, ...summary } = report.streamingEpisodes;
console.log(JSON.stringify({ ...report, streamingEpisodes: summary, streamingLinks: { ...report.streamingLinks, topNotCovered: undefined } }, null, 2));
