// Builds feeds/youtube.json: shows with free, official, full uploads on YouTube, with their AniList facts.
//   node scripts/youtube-catalog.mjs            (needs YOUTUBE_API_KEY; the weekly GitHub job runs this)
//   node scripts/youtube-catalog.mjs --pages    (local run without a key: reads public YouTube pages, AniList links only)
// Options: --floor=5000 (least AniList popularity), --out=feeds
// Shows come from AniList's YouTube streaming links and from the official channels in feeds/youtube-channels.json,
// whose playlists are matched against the local title index in feeds/anilist-titles.json (scripts/anilist-titles.mjs).
// Rejected links and unmatched playlists go to feeds/youtube-review.json for a person to look over.
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { MEDIA_DETAIL_FIELDS, catalogMatchQuery, catalogMatchVariables, mediaToCacheHit } from "../lib/anilist.js";
import { pickMatch } from "../lib/title-match.js";
import {
  FEED_REGIONS,
  FEED_VERSION,
  classifyLink,
  cleanFacts,
  completeness,
  inOrder,
  minSeconds,
  playableIn,
  videoFlags,
} from "../lib/youtube-catalog.js";
import { refreshTitles, titleIndex } from "./anilist-titles.mjs";
import { apiSource, pageSource } from "./youtube-sources.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const YOUTUBE_SOURCE_ID = 13;
const MEDIA_FIELDS = `${MEDIA_DETAIL_FIELDS.replace(/rankings \{[^}]*\}/, "")} externalLinks { site url type } nextAiringEpisode { episode }`;
// A new feed this much smaller than the last one means something broke upstream, so the old one stays.
const SHRINK_LIMIT = 0.6;

export function anilistClient({ fetchImpl = fetch, spacing = 2100, log = () => {} } = {}) {
  let last = 0;
  return async function query(text, variables = {}) {
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const wait = last + spacing - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      let response;
      try {
        response = await fetchImpl("https://graphql.anilist.co", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ query: text, variables }),
        });
      } catch {
        await sleep(5000 * attempt);
        continue;
      }
      if (response.status === 429) {
        const seconds = Number(response.headers.get("retry-after")) || 60;
        log(`AniList rate limit, waiting ${seconds}s`);
        await sleep(seconds * 1000);
        continue;
      }
      const body = await response.json().catch(() => null);
      if (response.status >= 500) {
        await sleep(5000 * attempt);
        continue;
      }
      if (!response.ok || (body?.errors?.length && !body.data)) throw new Error(`AniList: ${body?.errors?.[0]?.message || response.status}`);
      return body;
    }
    throw new Error("AniList kept failing.");
  };
}

const youtubeLinks = (media) => (media.externalLinks || []).filter((link) => link?.type === "STREAMING" && /youtube/i.test(link.site || "")).map((link) => link.url);

// Every non-adult show AniList lists a YouTube streaming link for, most popular first.
export async function discover(anilist, { floor = 5000, maxPages = 100, log = () => {} } = {}) {
  const text = `query ($page: Int) { Page(page: $page, perPage: 50) { pageInfo { hasNextPage } media(type: ANIME, licensedById_in: [${YOUTUBE_SOURCE_ID}], isAdult: false, popularity_greater: ${Math.max(0, floor - 1)}, sort: POPULARITY_DESC) { ${MEDIA_FIELDS} } } }`;
  const media = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const body = await anilist(text, { page });
    const rows = body?.data?.Page?.media || [];
    media.push(...rows);
    if (page % 10 === 0) log(`AniList: ${media.length} shows with YouTube links so far`);
    if (!rows.length || !body.data.Page.pageInfo?.hasNextPage) break;
  }
  return media;
}

// Channel playlist names carry extras like "| Full Episodes" or "[English Sub]".
const BOILERPLATE = /\b(full episodes?|all episodes|episodes?|english\s*(sub(bed|titled)?|dub(bed)?)|eng\s*(sub|dub)|sub(bed)?|dub(bed)?|official|playlist|full series|complete series|anime)\b/gi;
const HAS_BOILERPLATE = new RegExp(BOILERPLATE.source, "i");
export function playlistQuery(title) {
  const parts = String(title || "")
    .replace(/\[[^\]]*\]|【[^】]*】|「|」/g, " ")
    .replace(/\(([^)]*)\)/g, (whole, inner) => (HAS_BOILERPLATE.test(inner) ? " " : whole))
    .split(/\s[|｜]\s|\s[-–—]\s/);
  for (const part of parts) {
    const clean = part.replace(BOILERPLATE, " ").replace(/\b(ep\.?|episode)\s*\d+\s*[-~]\s*\d+\b/gi, " ").replace(/[\s:,]+$/, "").replace(/\s+/g, " ").trim();
    if (clean.length >= 2) return clean;
  }
  return "";
}

// Official channel playlists matched to AniList by title: against the local title index first, then a live AniList
// search for titles the index has never heard of. Unsure matches are left for review, never guessed.
export async function channelCandidates(anilist, source, channels, { log = () => {}, known = new Set(), titles = null } = {}) {
  const lists = [];
  for (const handle of channels || []) {
    const found = await source.channelPlaylists(handle);
    log(`${handle}: ${found.length} playlists`);
    lists.push(...found.filter((list) => list.count >= 1));
  }
  const unmatched = [];
  const matched = [];
  const named = lists.map((list) => ({ list, query: playlistQuery(list.title) })).filter((row) => {
    if (row.query) return true;
    unmatched.push({ channel: row.list.channel, playlist: row.list.id, title: row.list.title, reason: "no show name in the playlist title" });
    return false;
  });
  const queries = [];
  for (const row of named) {
    const local = titles?.match(row.query);
    if (!local || !local.candidates) {
      queries.push(row);
      continue;
    }
    if (local.confidence === "high") matched.push({ list: row.list, anilistId: local.media.id });
    else unmatched.push({ channel: row.list.channel, playlist: row.list.id, title: row.list.title, reason: `no sure AniList match for "${row.query}"` });
  }
  if (titles) log(`Playlists: ${named.length - queries.length} settled from the local title index, ${queries.length} need a live AniList search`);
  const BATCH = 4;
  for (let index = 0; index < queries.length; index += BATCH) {
    const batch = queries.slice(index, index + BATCH);
    const body = await anilist(catalogMatchQuery(batch.length), catalogMatchVariables(batch.map((row) => row.query)));
    batch.forEach((row, at) => {
      const media = body?.data?.[`p${at}`]?.media || [];
      const match = pickMatch(row.query, media);
      if (match.confidence !== "high") unmatched.push({ channel: row.list.channel, playlist: row.list.id, title: row.list.title, reason: `no sure AniList match for "${row.query}"` });
      else matched.push({ list: row.list, anilistId: match.media.id });
    });
  }
  const ids = [...new Set(matched.map((row) => row.anilistId).filter((id) => !known.has(id)))];
  const details = new Map();
  for (let index = 0; index < ids.length; index += 50) {
    const body = await anilist(`query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { ${MEDIA_FIELDS} } } }`, { ids: ids.slice(index, index + 50) });
    for (const media of body?.data?.Page?.media || []) details.set(media.id, media);
  }
  const candidates = [];
  for (const row of matched) {
    const media = details.get(row.anilistId);
    if (!media || media.isAdult) continue;
    candidates.push({ media, link: { kind: "playlist", id: row.list.id, url: `https://www.youtube.com/playlist?list=${row.list.id}`, channel: row.list.channel } });
  }
  return { candidates, unmatched };
}

function rejectVideo(video, floor) {
  if (!video) return "private or deleted";
  if (!video.public) return "not public";
  if (!video.embeddable) return "embedding off";
  if (video.live) return "live or upcoming";
  if (video.seconds && video.seconds < floor) return "too short";
  const flags = videoFlags(video.title).filter((flag) => flag !== "Japanese or Chinese only");
  return flags.length ? flags[0] : "";
}

// Checks one link: which uploads play, embed, run full length and are in English, and whether that's most of the show.
export async function verify(candidate, source, { regions = FEED_REGIONS } = {}) {
  const hit = mediaToCacheHit(candidate.media, 0);
  const next = candidate.media.nextAiringEpisode?.episode;
  const facts = cleanFacts({ ...hit, aired: Number.isInteger(next) ? next - 1 : null });
  const { link } = candidate;
  if (link.kind === "channel") return { ok: false, reason: "channel page, no episode list" };
  if (link.kind === "broken") return { ok: false, reason: "not a YouTube link" };
  let items;
  if (link.kind === "playlist") {
    const list = await source.playlist(link.id);
    if (list.gone || !list.items.length) return { ok: false, reason: "playlist empty or gone" };
    items = list.items;
  } else {
    items = [{ id: link.id, title: "" }];
  }
  const details = new Map((await source.videos(items.map((item) => item.id), items)).map((video) => [video.id, video]));
  const floor = minSeconds(hit.format);
  const kept = [];
  const dropped = {};
  for (const item of items) {
    const video = details.get(item.id);
    const reason = rejectVideo(video, floor);
    if (reason) {
      dropped[reason] = (dropped[reason] || 0) + 1;
      continue;
    }
    kept.push({ ...video, seconds: video.seconds || item.seconds || 0 });
  }
  const ordered = inOrder(kept);
  const why = Object.entries(dropped).map(([reason, count]) => `${count} ${reason}`).join(", ");
  if (!ordered.length) return { ok: false, reason: `no usable uploads${why ? ` (${why})` : ""}` };
  const foreign = ordered.filter((video) => videoFlags(video.title).includes("Japanese or Chinese only")).length;
  if (foreign > ordered.length / 2) return { ok: false, reason: "upload titles aren't in English" };
  if (hit.episodes && hit.format !== "MOVIE" && ordered.length > hit.episodes * 1.5 + 2) {
    return { ok: false, reason: `${ordered.length} uploads for ${hit.episodes} episodes (mixed seasons or extras?)` };
  }
  // Complete in at least one region; the extension repeats the check for the viewer's own country.
  const checks = regions.map((region) => ({ region, ...completeness(ordered.filter((video) => playableIn(video, region)), facts) }));
  const passed = checks.find((check) => check.complete);
  if (!passed) {
    const best = checks.reduce((top, check) => (check.have > top.have ? check : top), checks[0]);
    return { ok: false, reason: `incomplete: ${best.reason}${why ? ` (dropped ${why})` : ""}`, missing: best.missing };
  }
  return {
    ok: true,
    check: { region: passed.region, have: passed.have, want: passed.want },
    show: {
      anilistId: hit.anilistId,
      title: hit.titles.english || hit.titles.romaji || "",
      channel: link.channel || ordered[0].channel || "",
      playlist: link.kind === "playlist" ? link.id : "",
      url: link.kind === "playlist" ? `https://www.youtube.com/playlist?list=${link.id}` : `https://www.youtube.com/watch?v=${link.id}`,
      facts,
      videos: ordered.map((video) => ({
        id: video.id,
        title: video.title,
        seconds: video.seconds,
        ...(video.allow ? { allow: video.allow } : video.block?.length ? { block: video.block } : {}),
      })),
    },
  };
}

export async function buildFeed({ anilist, source, channels = [], titles = null, floor = 5000, maxPages = 100, log = () => {} }) {
  const media = await discover(anilist, { floor, maxPages, log });
  log(`AniList: ${media.length} shows with YouTube links`);
  const candidates = [];
  for (const row of media) for (const url of youtubeLinks(row)) candidates.push({ media: row, link: { url, ...classifyLink(url) } });
  const known = new Set(media.map((row) => row.id));
  const fromChannels = channels.length ? await channelCandidates(anilist, source, channels, { log, known, titles }) : { candidates: [], unmatched: [] };
  for (const extra of fromChannels.candidates) {
    if (candidates.some((row) => row.link.id === extra.link.id)) continue;
    candidates.push(extra);
  }
  const accepted = new Map();
  const rejected = [];
  let done = 0;
  for (const candidate of candidates) {
    done += 1;
    if (done % 50 === 0) log(`checked ${done}/${candidates.length} links`);
    const id = candidate.media.id;
    const title = candidate.media.title?.english || candidate.media.title?.romaji || "";
    let result;
    try {
      result = await verify(candidate, source);
    } catch (error) {
      if (error?.code === "quota" || error?.code === "key") throw error;
      result = { ok: false, reason: error?.message || "check failed" };
    }
    if (!result.ok) {
      rejected.push({ anilistId: id, title, url: candidate.link.url, reason: result.reason, ...(result.missing?.length ? { missing: result.missing } : {}) });
      continue;
    }
    const previous = accepted.get(id);
    if (!previous || result.show.videos.length > previous.videos.length) accepted.set(id, result.show);
  }
  // One playlist serving several AniList entries usually holds more than one season; a person should split it.
  const byPlaylist = new Map();
  for (const show of accepted.values()) if (show.playlist) byPlaylist.set(show.playlist, [...(byPlaylist.get(show.playlist) || []), show]);
  for (const shows of byPlaylist.values()) {
    if (shows.length < 2) continue;
    for (const show of shows) {
      accepted.delete(show.anilistId);
      rejected.push({ anilistId: show.anilistId, title: show.title, url: show.url, reason: `playlist shared by ${shows.length} AniList entries` });
    }
  }
  const shows = [...accepted.values()].sort((a, b) => (b.facts.popularity || 0) - (a.facts.popularity || 0) || a.anilistId - b.anilistId);
  rejected.sort((a, b) => a.anilistId - b.anilistId || a.url.localeCompare(b.url));
  return { shows, rejected, unmatched: fromChannels.unmatched, links: candidates.length, units: source.units() };
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

// Writes the feed only when its shows changed, so the weekly job doesn't commit a new date every week.
export async function writeFeed(result, { out = "feeds", source = "api", now = new Date() } = {}) {
  const path = `${out}/youtube.json`;
  const previous = await readJson(path);
  const before = previous?.shows?.length || 0;
  if (before && result.shows.length < before * SHRINK_LIMIT) {
    throw new Error(`The new feed has ${result.shows.length} shows against ${before} last time, so it wasn't saved.`);
  }
  const same = previous && JSON.stringify(previous.shows) === JSON.stringify(result.shows);
  const feed = { version: FEED_VERSION, builtAt: same ? previous.builtAt : now.toISOString(), source, shows: result.shows };
  if (!same) await writeFile(path, `${JSON.stringify(feed)}\n`);
  const reasons = {};
  for (const row of result.rejected) {
    const key = row.reason.replace(/\s*\(.*$/, "").replace(/"[^"]*"/g, "\"…\"").replace(/\d+(-\d+)?(, \d+(-\d+)?)*(, …)?/g, "N");
    reasons[key] = (reasons[key] || 0) + 1;
  }
  const review = { shows: result.shows.length, links: result.links, reasons, rejected: result.rejected, unmatched: result.unmatched };
  await writeFile(`${out}/youtube-review.json`, `${JSON.stringify(review, null, 1)}\n`);
  return { changed: !same, feed, review };
}

async function main(argv) {
  const pages = argv.includes("--pages");
  const option = (name, fallback) => argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1] || fallback;
  const key = process.env.YOUTUBE_API_KEY || "";
  if (!key && !pages) {
    console.error("Set YOUTUBE_API_KEY, or pass --pages for a local run that reads public YouTube pages.");
    process.exit(1);
  }
  const out = option("out", "feeds");
  const config = await readJson(`${out}/youtube-channels.json`);
  const source = pages ? pageSource() : apiSource(key);
  const anilist = anilistClient({ log: console.log });
  const channels = pages ? [] : config?.channels || [];
  let titles = null;
  if (channels.length) {
    const { titles: rows } = await refreshTitles(anilist, { path: `${out}/anilist-titles.json`, log: console.log });
    titles = titleIndex(rows);
    console.log(`AniList titles: ${titles.size} in the local index`);
  }
  const result = await buildFeed({
    anilist,
    source,
    titles,
    channels,
    floor: Number(option("floor", 5000)),
    log: console.log,
  });
  const { changed, review } = await writeFeed(result, { out, source: source.name });
  console.log(JSON.stringify({ shows: result.shows.length, episodes: result.shows.reduce((sum, show) => sum + show.videos.length, 0), links: result.links, apiUnits: result.units, changed, reasons: review.reasons }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
