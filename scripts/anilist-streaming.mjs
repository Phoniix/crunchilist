// Every AniList anime with its official streaming links, for comparing against the Crunchyroll catalog.
// node scripts/anilist-streaming.mjs            -> data/anilist-streaming.json (resumes if interrupted)
// AniList stops paging after 5,000 results, so this walks one start year at a time; shows with no start
// date at all (unannounced projects) are left out and counted.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve("data/anilist-streaming.json");
const PER_PAGE = 50;
const GAP_MS = 2100;
const FIRST_YEAR = 1900;
const LAST_YEAR = new Date().getFullYear() + 3;
const FIELDS = `
  id title { romaji english } format status seasonYear episodes isAdult countryOfOrigin popularity
  startDate { year }
  externalLinks { site type url language }
  streamingEpisodes { title url site }
  relations { edges { relationType node { id type } } }`;
const QUERY = `query ($page: Int, $from: FuzzyDateInt, $to: FuzzyDateInt) {
  Page(page: $page, perPage: ${PER_PAGE}) {
    pageInfo { hasNextPage }
    media(type: ANIME, sort: ID, startDate_greater: $from, startDate_lesser: $to) { ${FIELDS} }
  }
}`;
const TOTAL = `{ Page(perPage: 1) { pageInfo { total } media(type: ANIME) { id } } }`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ask(query, variables = {}) {
  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      response = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
      if (attempt >= 6) throw error;
      await sleep(5000 * attempt);
      continue;
    }
    if (response.status === 429) {
      const wait = Number(response.headers.get("retry-after")) || 60;
      console.log(`  rate limited, waiting ${wait}s`);
      await sleep(wait * 1000 + 500);
      continue;
    }
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.errors?.length) {
      if (response.status === 400 || attempt >= 6) throw new Error(`AniList ${response.status}: ${json.errors?.map((error) => error.message).join("; ")}`);
      await sleep(5000 * attempt);
      continue;
    }
    return json.data.Page;
  }
}

const saved = existsSync(OUT) ? JSON.parse(await readFile(OUT, "utf8")) : null;
const resume = saved && !saved.complete && saved.doneYears;
const anime = new Map(resume ? saved.anime.map((media) => [media.id, media]) : []);
let doneYear = resume ? saved.doneYear : FIRST_YEAR - 1;
const save = async (complete, extra = {}) => {
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), complete, doneYears: true, doneYear, count: anime.size, ...extra, anime: [...anime.values()] }));
};

for (let year = doneYear + 1; year <= LAST_YEAR; year += 1) {
  for (let page = 1; ; page += 1) {
    const result = await ask(QUERY, { page, from: (year - 1) * 10000 + 1231, to: (year + 1) * 10000 });
    for (const media of result.media) anime.set(media.id, media);
    await sleep(GAP_MS);
    if (!result.pageInfo.hasNextPage || !result.media.length) break;
  }
  doneYear = year;
  if (year % 5 === 0 || year >= 1990) { console.log(`${year}: ${anime.size} anime`); await save(false); }
}
const total = (await ask(TOTAL)).pageInfo.total;
await save(true, { anilistTotal: total, withoutStartDate: Math.max(0, total - anime.size) });
console.log(`Saved ${anime.size} of AniList's ${total} anime to ${OUT}`);
