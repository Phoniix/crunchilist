// Checks AniList's official YouTube links for shows the Crunchyroll catalog doesn't have, and writes the
// playable ones for the lab player. node scripts/youtube-check.mjs (needs data/anilist-streaming.json)
// -> data/youtube-check.json (every link and its verdict) and lab/player/youtube-shows.json (the good ones)
import { readFile, writeFile } from "node:fs/promises";

const MIN_POPULARITY = 10000;
const dump = JSON.parse(await readFile("data/anilist-streaming.json", "utf8")).anime.filter((media) => !media.isAdult);
const catalog = JSON.parse(await readFile("fixtures/catalog-snapshot.json", "utf8")).shows;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Same coverage rule as scripts/streaming-report.mjs.
const byId = new Map(dump.map((media) => [media.id, media]));
const seen = new Set(catalog.map((show) => show.anilistId).filter(Boolean));
const covered = new Set(seen);
const queue = [...seen];
while (queue.length) {
  for (const edge of byId.get(queue.pop())?.relations?.edges || []) {
    const next = byId.get(edge.node.id);
    if (!next || seen.has(next.id) || !["SEQUEL", "PREQUEL"].includes(edge.relationType)) continue;
    seen.add(next.id);
    if (["TV", "TV_SHORT", "ONA"].includes(next.format)) covered.add(next.id);
    queue.push(next.id);
  }
}
const youtubeLinks = (media) => (media.externalLinks || []).filter((link) => link.type === "STREAMING" && link.site === "YouTube").map((link) => link.url);
const candidates = dump.filter((media) => !covered.has(media.id) && media.popularity >= MIN_POPULARITY && youtubeLinks(media).length);

function classify(url) {
  try {
    const parsed = new URL(url);
    const list = parsed.searchParams.get("list");
    if (list) return { kind: "playlist", id: list };
    const video = parsed.searchParams.get("v") || (parsed.hostname === "youtu.be" ? parsed.pathname.slice(1) : null) || parsed.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1];
    if (video) return { kind: "video", id: video.slice(0, 11) };
    return { kind: "channel", id: parsed.pathname };
  } catch {
    return { kind: "broken", id: url };
  }
}

async function page(url) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "accept-language": "en-US,en;q=0.9", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", cookie: "CONSENT=YES+1" } });
      if (response.status === 429) { await sleep(10000 * attempt); continue; }
      return { status: response.status, html: await response.text() };
    } catch {
      await sleep(3000 * attempt);
    }
  }
  return { status: 0, html: "" };
}

function jsonAfter(html, marker) {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  const from = html.indexOf("{", start);
  for (let index = from; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) {
      try { return JSON.parse(html.slice(from, index + 1)); } catch { return null; }
    }
  }
  return null;
}

async function checkVideo(id) {
  const { status, html } = await page(`https://www.youtube.com/watch?v=${id}`);
  const player = jsonAfter(html, "ytInitialPlayerResponse = ");
  const playability = player?.playabilityStatus;
  const micro = player?.microformat?.playerMicroformatRenderer;
  const countries = micro?.availableCountries || null;
  return {
    id,
    httpStatus: status,
    status: playability?.status || "UNKNOWN",
    reason: playability?.reason || "",
    embeddable: playability?.playableInEmbed !== false,
    seconds: Number(player?.videoDetails?.lengthSeconds) || 0,
    title: player?.videoDetails?.title || "",
    channel: player?.videoDetails?.author || "",
    inUS: countries ? countries.includes("US") : null,
    countries: countries ? countries.length : null,
  };
}

const findAll = (node, key, out = []) => {
  if (Array.isArray(node)) for (const item of node) findAll(item, key, out);
  else if (node && typeof node === "object") for (const [name, value] of Object.entries(node)) (name === key ? out.push(value) : findAll(value, key, out));
  return out;
};

// Some channels list the newest episode first; flip those when the titles carry episode numbers.
const episodeNumber = (title) => Number(title.match(/(?:\bEP(?:isode)?\.?\s*|\bE|第|S\d+:E)(\d{1,3})/i)?.[1]) || null;
function inOrder(items) {
  const numbers = items.map((item) => episodeNumber(item.title)).filter(Boolean);
  return numbers.length >= Math.max(2, items.length / 2) && numbers[0] > numbers.at(-1) ? items.slice().reverse() : items;
}

// Hints for a person reviewing the list: uploads that look like extras, or aren't in English.
function flags(title) {
  const out = [];
  if (/\b(PV|trailer|teaser|radio|after ?talk|making|ラジオ|アフレコ)\b/i.test(title)) out.push("looks like an extra");
  if (/capítulo|episodio|legendado|dublado/i.test(title)) out.push("not English");
  else if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(title) && !/english|sub|dub/i.test(title)) out.push("Japanese or Chinese only?");
  if (/限定|limited time/i.test(title)) out.push("limited-time upload");
  return out;
}

async function checkPlaylist(id) {
  const { status, html } = await page(`https://www.youtube.com/playlist?list=${id}`);
  const data = jsonAfter(html, "ytInitialData = ");
  const header = findAll(data, "pageHeaderRenderer")[0] || findAll(data, "playlistHeaderRenderer")[0];
  const clock = (text) => String(text || "").split(":").reduce((total, part) => total * 60 + (Number(part) || 0), 0);
  // YouTube's current layout (lockupViewModel), then its older one (playlistVideoRenderer).
  const lockups = findAll(data, "lockupViewModel").filter((lockup) => /^[\w-]{11}$/.test(lockup.contentId || "") && (!lockup.contentType || lockup.contentType === "LOCKUP_CONTENT_TYPE_VIDEO")).map((lockup) => {
    const title = lockup.metadata?.lockupMetadataViewModel?.title?.content || "";
    const badge = findAll(lockup.contentImage, "thumbnailBadgeViewModel")[0]?.text;
    return { id: lockup.contentId, title, seconds: clock(badge), playable: !/^\[(private|deleted) video\]$/i.test(title) };
  });
  const older = findAll(data, "playlistVideoRenderer").map((video) => ({
    id: video.videoId,
    title: video.title?.runs?.[0]?.text || video.title?.simpleText || "",
    seconds: Number(video.lengthSeconds) || 0,
    playable: video.isPlayable !== false,
  }));
  const items = [...new Map([...lockups, ...older].filter((item) => item.id).map((item) => [item.id, item])).values()];
  const alert = findAll(data, "alertRenderer").map((a) => a.text?.runs?.map((r) => r.text).join("") || a.text?.simpleText || "").join(" ");
  return { id, httpStatus: status, title: header?.pageTitle || header?.title?.simpleText || "", items: inOrder(items), alert, more: items.length >= 100 };
}

const results = [];
let done = 0;
for (const media of candidates) {
  const minSeconds = media.format === "TV_SHORT" ? 60 : media.format === "MOVIE" ? 1800 : 300;
  const links = [];
  for (const url of youtubeLinks(media)) {
    const link = { url, ...classify(url) };
    if (link.kind === "video") {
      link.video = await checkVideo(link.id);
      const v = link.video;
      link.verdict = v.status !== "OK" ? `unplayable: ${v.status}${v.reason ? ` (${v.reason})` : ""}` : !v.embeddable ? "embedding off" : v.seconds < minSeconds ? `too short (${v.seconds}s, likely a trailer)` : v.inUS === false ? "blocked in the US" : "good";
    } else if (link.kind === "playlist") {
      link.playlist = await checkPlaylist(link.id);
      const usable = link.playlist.items.filter((item) => item.playable && item.seconds >= Math.min(minSeconds, 300));
      if (usable.length) link.sample = await checkVideo(usable[0].id);
      const s = link.sample;
      link.usable = usable;
      link.verdict = !link.playlist.items.length ? `empty or gone${link.playlist.alert ? ` (${link.playlist.alert})` : ""}` : !usable.length ? "no full-length videos" : s.status !== "OK" ? `first episode unplayable: ${s.status}` : !s.embeddable ? "embedding off" : s.inUS === false ? "blocked in the US" : "good";
    } else {
      link.verdict = link.kind === "channel" ? "channel page, no episode list" : "broken link";
    }
    links.push(link);
    await sleep(400);
  }
  results.push({ id: media.id, title: media.title.english || media.title.romaji, format: media.format, year: media.seasonYear || media.startDate?.year, popularity: media.popularity, episodes: media.episodes, links });
  done += 1;
  if (done % 25 === 0) console.log(`${done}/${candidates.length} shows checked`);
}

// Covers for the good ones, 50 per AniList request.
const good = results.filter((show) => show.links.some((link) => link.verdict === "good"));
const covers = new Map();
for (let index = 0; index < good.length; index += 50) {
  const ids = good.slice(index, index + 50).map((show) => show.id);
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: "query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids) { id coverImage { large color } description(asHtml: false) } } }", variables: { ids } }),
  });
  for (const media of (await response.json()).data?.Page?.media || []) covers.set(media.id, media);
  await sleep(2100);
}

const shows = good.map((show) => {
  const link = show.links.find((entry) => entry.verdict === "good");
  const items = link.kind === "video"
    ? [{ id: link.video.id, title: show.format === "MOVIE" ? show.title : link.video.title, seconds: link.video.seconds }]
    : link.usable.map(({ id, title, seconds }) => ({ id, title, seconds }));
  const info = covers.get(show.id);
  return {
    id: show.id, title: show.title, format: show.format, year: show.year, popularity: show.popularity,
    cover: info?.coverImage?.large || "", color: info?.coverImage?.color || "",
    about: (info?.description || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 400),
    channel: link.kind === "video" ? link.video.channel : link.sample?.channel || "",
    source: link.url, kind: link.kind, partial: Boolean(link.playlist?.more), items,
    flags: [...new Set(items.slice(0, 3).flatMap((item) => flags(item.title)))],
    sharedPlaylist: link.kind === "playlist" && good.filter((other) => other.links.some((entry) => entry.verdict === "good" && entry.id === link.id)).length > 1,
  };
}).sort((a, b) => b.popularity - a.popularity);

const tally = {};
for (const show of results) for (const link of show.links) { const key = link.verdict.replace(/ \(.*$/, "").replace(/: .*/, ""); tally[key] = (tally[key] || 0) + 1; }
await writeFile("data/youtube-check.json", JSON.stringify({ checkedAt: new Date().toISOString(), shows: results.length, links: results.reduce((sum, show) => sum + show.links.length, 0), verdicts: tally, results }, null, 2));
await writeFile("lab/player/youtube-shows.json", JSON.stringify({ checkedAt: new Date().toISOString(), shows }, null, 2));
console.log(JSON.stringify({ shows: results.length, goodShows: shows.length, verdicts: tally, episodes: shows.reduce((sum, show) => sum + show.items.length, 0) }, null, 2));
