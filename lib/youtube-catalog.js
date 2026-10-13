// Free, official YouTube uploads of shows, gathered weekly by scripts/youtube-catalog.mjs into feeds/youtube.json.
// The extension serves them like catalog titles; anything Crunchyroll carries (or has a season of) stays Crunchyroll's.

export const YOUTUBE_FEED_URL = "https://raw.githubusercontent.com/Phoniix/crunchilist/master/feeds/youtube.json";
export const YOUTUBE_KEY = "crYoutube";
export const FEED_VERSION = 1;
export const FEED_TTL_MS = 12 * 60 * 60 * 1000;
export const FEED_RETRY_MS = 60 * 60 * 1000;
export const FEED_SHOW_LIMIT = 3000;
// Where most English-speaking viewers are. A show is kept when enough of it plays in at least one of these.
export const FEED_REGIONS = ["US", "CA", "GB", "AU", "NZ", "IE", "IN", "PH", "SG", "MY"];

const VIDEO_ID = /^[\w-]{11}$/;
const PLAYLIST_ID = /^[\w-]{10,64}$/;
const REGION = /^[A-Z]{2}$/;
const LINKED = new Set(["SEQUEL", "PREQUEL"]);

const text = (value, max) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const whole = (value) => (Number.isInteger(value) && value >= 0 ? value : null);
const https = (value) => (typeof value === "string" && /^https:\/\/[^\s"'<>]+$/.test(value) ? value.slice(0, 400) : "");
const words = (list, max, each = 60) => (Array.isArray(list) ? list.map((item) => text(item, each)).filter(Boolean).slice(0, max) : []);
const regions = (list) => (Array.isArray(list) ? [...new Set(list.filter((code) => REGION.test(code)))] : null);

export function minSeconds(format) {
  if (format === "TV_SHORT") return 60;
  if (format === "MOVIE") return 1800;
  return 300;
}

// How many episodes a complete upload needs, by AniList: all of a finished show, everything aired so far of an
// airing one (aired comes from nextAiringEpisode), one for a movie. null when AniList doesn't know.
export function expectedEpisodes(facts) {
  if (facts?.format === "MOVIE") return 1;
  if (facts?.releaseStatus === "RELEASING") return Number.isInteger(facts.aired) && facts.aired > 0 ? facts.aired : null;
  return Number.isInteger(facts?.episodes) && facts.episodes > 0 ? facts.episodes : null;
}

const median = (values) => {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

// Whether the uploads are the whole season, checked against AniList: the episode count, every episode number from
// 1 (or the season's first number, for seasons that keep counting) through the last, and episodes running about
// as long as AniList says. Crunchyroll and others often post only the first episode or two, or short digests.
export function completeness(videos, facts) {
  const want = expectedEpisodes(facts);
  const have = videos.length;
  const result = { complete: false, have, want, missing: [], reason: "" };
  if (!have) return { ...result, reason: "no uploads" };
  const minutes = Number.isInteger(facts?.duration) && facts.duration > 0 ? facts.duration : 0;
  const typical = median(videos.map((video) => video.seconds || 0));
  const share = facts?.format === "MOVIE" ? 0.8 : 0.6;
  if (minutes && typical && typical < minutes * 60 * share) {
    return { ...result, reason: `uploads run ${Math.round(typical / 60)} min against ${minutes} min episodes (clips or digests?)` };
  }
  if (facts?.format === "MOVIE") return { ...result, complete: true };
  if (!want) {
    const airing = facts?.releaseStatus === "RELEASING";
    return have >= 3 ? { ...result, complete: true } : { ...result, reason: `only ${have} uploads and AniList has no episode count${airing ? " yet" : ""}` };
  }
  const slack = facts?.releaseStatus === "RELEASING" ? 1 : 0;
  const numbers = videos.map((video) => episodeNumber(video.title)).filter(Boolean);
  if (numbers.length >= have * 0.6) {
    const first = Math.min(...numbers);
    const shift = first > 1 && Math.max(...numbers) - first + 1 >= want - slack ? first - 1 : 0;
    const seen = new Set(numbers.map((number) => number - shift));
    for (let number = 1; number <= want; number += 1) if (!seen.has(number)) result.missing.push(number);
    if (result.missing.length > slack || (slack && result.missing.length && result.missing[0] !== want)) {
      return { ...result, missing: result.missing.slice(0, 30), reason: `missing episode${result.missing.length > 1 ? "s" : ""} ${shortList(result.missing)} of ${want}` };
    }
  } else if (have < want - slack) {
    return { ...result, reason: `${have} of ${want} episodes` };
  }
  // A couple of OVAs or credits are fine; a second season stuffed into the same playlist is not.
  if (have > want + 2) return { ...result, missing: [], reason: `${have} uploads for ${want} episodes (mixed seasons or extras?)` };
  return { ...result, missing: [], complete: true };
}

function shortList(numbers) {
  const ranges = [];
  for (const number of numbers) {
    const last = ranges.at(-1);
    if (last && number === last[1] + 1) last[1] = number;
    else ranges.push([number, number]);
  }
  const text = ranges.slice(0, 6).map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`)).join(", ");
  return ranges.length > 6 ? `${text}, …` : text;
}

export function playableIn(video, country) {
  if (!country) return true;
  if (video?.allow) return video.allow.includes(country);
  if (video?.block) return !video.block.includes(country);
  return true;
}

export function countryOf(locale) {
  const match = /^[a-z]{2}[-_]([A-Z]{2})$/i.exec(String(locale || ""));
  return match ? match[1].toUpperCase() : "US";
}

// Upload titles that point at extras, other languages or uploads that will come down.
export function videoFlags(title) {
  const out = [];
  if (/\b(PV|trailer|teaser|preview|radio|after ?talk|making of|recap|ラジオ|アフレコ)\b/i.test(title)) out.push("extra");
  if (/capítulo|episodio|legendado|dublado|épisode|folge/i.test(title)) out.push("not English");
  else if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(title) && !/english|\bsub\b|\bdub\b|\beng\b/i.test(title)) out.push("Japanese or Chinese only");
  if (/限定|limited[- ]time/i.test(title)) out.push("limited time");
  return out;
}

export const episodeNumber = (title) => Number(String(title).match(/(?:\bEP(?:isode)?\.?\s*|\bE|第|S\d+\s*:?\s*E|#)(\d{1,4})/i)?.[1]) || null;

// Some channels list the newest episode first; flip those when the titles carry episode numbers.
export function inOrder(items) {
  const numbers = items.map((item) => episodeNumber(item.title)).filter(Boolean);
  return numbers.length >= Math.max(2, items.length / 2) && numbers[0] > numbers.at(-1) ? items.slice().reverse() : items;
}

// AniList's YouTube link: a playlist, a single video, or a channel page (which has no episode list).
export function classifyLink(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch {
    return { kind: "broken", id: "" };
  }
  if (!/(^|\.)youtube\.com$|^youtu\.be$/.test(parsed.hostname)) return { kind: "broken", id: "" };
  const list = parsed.searchParams.get("list");
  if (list && PLAYLIST_ID.test(list)) return { kind: "playlist", id: list };
  const video = parsed.searchParams.get("v")
    || (parsed.hostname === "youtu.be" ? parsed.pathname.slice(1, 12) : "")
    || parsed.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1]
    || "";
  if (VIDEO_ID.test(video)) return { kind: "video", id: video };
  return { kind: "channel", id: parsed.pathname };
}

// The AniList facts a feed show carries: the same fields the search engine reads from the AniList cache.
export function cleanFacts(raw) {
  const titles = raw?.titles || {};
  const ranks = {};
  for (const [name, rank] of Object.entries(raw?.tagRanks || {})) if (text(name, 60) && Number.isInteger(rank)) ranks[text(name, 60)] = rank;
  return {
    titles: { english: text(titles.english, 180), romaji: text(titles.romaji, 180), native: text(titles.native, 180) },
    synonyms: words(raw?.synonyms, 12, 180),
    genres: words(raw?.genres, 10),
    tags: words(raw?.tags, 15),
    hiddenTags: words(raw?.hiddenTags, 6),
    tagRanks: ranks,
    about: text(raw?.about, 1200),
    format: text(raw?.format, 20) || null,
    releaseStatus: text(raw?.releaseStatus, 30) || null,
    year: whole(raw?.year),
    season: text(raw?.season, 10) || null,
    episodes: whole(raw?.episodes),
    aired: whole(raw?.aired),
    duration: whole(raw?.duration),
    score: whole(raw?.score),
    popularity: whole(raw?.popularity),
    cover: https(raw?.cover),
    banner: https(raw?.banner),
    color: /^#[0-9a-f]{6}$/i.test(raw?.color || "") ? raw.color : "",
    country: text(raw?.country, 4) || null,
    relations: (Array.isArray(raw?.relations) ? raw.relations : [])
      .filter((row) => row && text(row.type, 30) && whole(row.anilistId))
      .slice(0, 12)
      .map((row) => ({ type: text(row.type, 30), anilistId: row.anilistId, title: text(row.title, 180) })),
  };
}

function cleanVideo(raw) {
  if (!VIDEO_ID.test(raw?.id || "")) return null;
  const video = { id: raw.id, title: text(raw.title, 200), seconds: whole(raw.seconds) || 0 };
  const allow = regions(raw.allow);
  const block = regions(raw.block);
  if (allow) video.allow = allow;
  else if (block?.length) video.block = block;
  return video;
}

function cleanShow(raw) {
  const anilistId = whole(raw?.anilistId);
  if (!anilistId) return null;
  const facts = cleanFacts(raw.facts);
  const videos = (Array.isArray(raw.videos) ? raw.videos : []).map(cleanVideo).filter(Boolean).slice(0, 600);
  const title = text(raw.title, 180) || facts.titles.english || facts.titles.romaji;
  if (!title || !videos.length) return null;
  return {
    anilistId,
    title,
    channel: text(raw.channel, 100),
    playlist: PLAYLIST_ID.test(raw.playlist || "") ? raw.playlist : "",
    url: https(raw.url).startsWith("https://www.youtube.com/") ? https(raw.url) : `https://www.youtube.com/watch?v=${videos[0].id}`,
    facts,
    videos,
  };
}

export function normalizeFeed(raw) {
  const seen = new Set();
  const shows = [];
  for (const row of Array.isArray(raw?.shows) ? raw.shows : []) {
    const show = cleanShow(row);
    if (!show || seen.has(show.anilistId)) continue;
    seen.add(show.anilistId);
    shows.push(show);
    if (shows.length >= FEED_SHOW_LIMIT) break;
  }
  return { version: Number(raw?.version) || 0, builtAt: text(raw?.builtAt, 40), shows };
}

export function feedDue(stored, now = Date.now(), force = false) {
  if (force) return true;
  if (!stored?.fetchedAt) return !stored?.checkedAt || now - stored.checkedAt >= FEED_RETRY_MS;
  if (stored.checkedAt > stored.fetchedAt && now - stored.checkedAt < FEED_RETRY_MS) return false;
  return now - stored.fetchedAt >= FEED_TTL_MS;
}

// AniList ids Crunchyroll already covers: its own titles plus every season linked to them as a sequel or prequel.
// links(id) returns linked ids from whatever AniList data the caller has (cache hits, season nodes).
export function coveredIds(baseIds, links, depth = 8) {
  const covered = new Set();
  let frontier = [...new Set((baseIds || []).filter(Boolean))];
  for (const id of frontier) covered.add(id);
  for (let step = 0; step < depth && frontier.length; step += 1) {
    const next = [];
    for (const id of frontier) {
      for (const other of links(id) || []) {
        if (!other || covered.has(other)) continue;
        covered.add(other);
        next.push(other);
      }
    }
    frontier = next;
  }
  return covered;
}

export function linkedIds(hit) {
  return (hit?.relations || []).filter((row) => LINKED.has(row.type)).map((row) => row.anilistId);
}

// Feed shows as catalog-like items for this viewer's country, without the ones Crunchyroll covers.
export function youtubeItems(feed, { country = "US", covered = new Set() } = {}) {
  const items = [];
  for (const show of feed?.shows || []) {
    if (covered.has(show.anilistId) || linkedIds(show.facts).some((id) => covered.has(id))) continue;
    const videos = show.videos.filter((video) => playableIn(video, country));
    const { facts } = show;
    const check = completeness(videos, facts);
    if (!check.complete) continue;
    items.push({
      id: `yt-${show.anilistId}`,
      title: show.title,
      url: show.url,
      type: facts.format === "MOVIE" ? "movie" : "series",
      episodes: facts.episodes || (facts.format === "MOVIE" ? 1 : videos.length),
      poster: "",
      cover: facts.cover,
      anilistId: show.anilistId,
      source: "youtube",
      hit: { kind: "hit", ...facts, anilistId: show.anilistId },
      youtube: {
        channel: show.channel,
        playlist: show.playlist,
        airing: facts.releaseStatus === "RELEASING",
        expected: check.want,
        videos: videos.map(({ id, title, seconds }) => ({ id, title, seconds })),
      },
    });
  }
  return items;
}

export const isYoutubeItem = (item) => item?.source === "youtube";

export function watchUrl(videoId, playlist = "") {
  if (!VIDEO_ID.test(videoId || "")) return "";
  return `https://www.youtube.com/watch?v=${videoId}${PLAYLIST_ID.test(playlist || "") ? `&list=${playlist}` : ""}`;
}
