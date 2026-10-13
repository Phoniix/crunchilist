// Two ways to read YouTube for scripts/youtube-catalog.mjs, both with the same shape:
//   playlist(id)          -> { items: [{ id, title, seconds? }], gone }
//   videos(ids, items)    -> [{ id, title, seconds, embeddable, public, live, channel, allow?, block? }]
//   channelPlaylists(h)   -> [{ id, title, count, channel }]   (API only)
// apiSource uses the YouTube Data API (the weekly GitHub job). pageSource reads public watch and playlist pages
// for local runs without a key; it only samples the first video of a list for embedding and regions.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class SourceError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export function isoSeconds(value) {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(value || ""));
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match.map((part) => Number(part) || 0);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

export function apiSource(key, { fetchImpl = fetch, base = "https://www.googleapis.com/youtube/v3", spacing = 50 } = {}) {
  if (!key) throw new SourceError("YOUTUBE_API_KEY is missing.", "key");
  let units = 0;
  async function get(path, params) {
    const url = new URL(`${base}/${path}`);
    for (const [name, value] of Object.entries(params)) if (value != null && value !== "") url.searchParams.set(name, String(value));
    url.searchParams.set("key", key);
    for (let attempt = 1; ; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(url, { headers: { accept: "application/json" } });
      } catch {
        if (attempt >= 3) throw new SourceError("Couldn't reach the YouTube API.", "network");
        await sleep(2000 * attempt);
        continue;
      }
      units += 1;
      const body = await response.json().catch(() => null);
      const reason = body?.error?.errors?.[0]?.reason || "";
      if (response.status === 403 && /quota|rateLimit/i.test(reason)) throw new SourceError("The YouTube API quota is used up for today.", "quota");
      if (response.status === 400 && /keyInvalid|badRequest/i.test(reason) && /key/i.test(body?.error?.message || "")) throw new SourceError("The YouTube API key was rejected.", "key");
      if (response.status === 404) return null;
      if (response.status >= 500 && attempt < 3) {
        await sleep(2000 * attempt);
        continue;
      }
      if (!response.ok) throw new SourceError(`YouTube API answered ${response.status}${reason ? ` (${reason})` : ""}.`, "failed");
      await sleep(spacing);
      return body;
    }
  }
  return {
    name: "api",
    units: () => units,
    async playlist(id) {
      const items = [];
      let pageToken = "";
      for (let page = 0; page < 12; page += 1) {
        const body = await get("playlistItems", { part: "snippet,contentDetails", playlistId: id, maxResults: 50, pageToken });
        if (!body) return { items, gone: !items.length };
        for (const row of body.items || []) {
          const videoId = row.contentDetails?.videoId || row.snippet?.resourceId?.videoId;
          if (videoId) items.push({ id: videoId, title: row.snippet?.title || "" });
        }
        pageToken = body.nextPageToken || "";
        if (!pageToken) break;
      }
      return { items, gone: false };
    },
    async videos(ids) {
      const out = [];
      for (let index = 0; index < ids.length; index += 50) {
        const body = await get("videos", { part: "snippet,contentDetails,status", id: ids.slice(index, index + 50).join(","), maxResults: 50 });
        for (const row of body?.items || []) {
          const region = row.contentDetails?.regionRestriction || {};
          out.push({
            id: row.id,
            title: row.snippet?.title || "",
            channel: row.snippet?.channelTitle || "",
            seconds: isoSeconds(row.contentDetails?.duration),
            embeddable: row.status?.embeddable !== false,
            public: ["public", "unlisted"].includes(row.status?.privacyStatus) && row.status?.uploadStatus !== "rejected",
            live: ["live", "upcoming"].includes(row.snippet?.liveBroadcastContent),
            ...(Array.isArray(region.allowed) ? { allow: region.allowed } : {}),
            ...(Array.isArray(region.blocked) ? { block: region.blocked } : {}),
          });
        }
      }
      return out;
    },
    async channelPlaylists(handle) {
      const channel = await get("channels", { part: "id,snippet", forHandle: handle.replace(/^@?/, "@") });
      const channelId = channel?.items?.[0]?.id;
      if (!channelId) return [];
      const name = channel.items[0].snippet?.title || handle;
      const lists = [];
      let pageToken = "";
      for (let page = 0; page < 20; page += 1) {
        const body = await get("playlists", { part: "snippet,contentDetails", channelId, maxResults: 50, pageToken });
        for (const row of body?.items || []) lists.push({ id: row.id, title: row.snippet?.title || "", count: row.contentDetails?.itemCount || 0, channel: name });
        pageToken = body?.nextPageToken || "";
        if (!pageToken) break;
      }
      return lists;
    },
  };
}

async function page(url, fetchImpl) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers: { "accept-language": "en-US,en;q=0.9", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", cookie: "CONSENT=YES+1" } });
      if (response.status === 429) { await sleep(10000 * attempt); continue; }
      return { status: response.status, html: await response.text() };
    } catch {
      await sleep(3000 * attempt);
    }
  }
  return { status: 0, html: "" };
}

export function jsonAfter(html, marker) {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  const from = html.indexOf("{", start);
  if (from < 0) return null;
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

export const findAll = (node, key, out = []) => {
  if (Array.isArray(node)) for (const item of node) findAll(item, key, out);
  else if (node && typeof node === "object") for (const [name, value] of Object.entries(node)) (name === key ? out.push(value) : findAll(value, key, out));
  return out;
};

const clock = (value) => String(value || "").split(":").reduce((total, part) => total * 60 + (Number(part) || 0), 0);

// YouTube's current playlist layout (lockupViewModel), then its older one (playlistVideoRenderer).
export function playlistFromHtml(html) {
  const data = jsonAfter(html, "ytInitialData = ");
  const lockups = findAll(data, "lockupViewModel")
    .filter((lockup) => /^[\w-]{11}$/.test(lockup.contentId || "") && (!lockup.contentType || lockup.contentType === "LOCKUP_CONTENT_TYPE_VIDEO"))
    .map((lockup) => ({
      id: lockup.contentId,
      title: lockup.metadata?.lockupMetadataViewModel?.title?.content || "",
      seconds: clock(findAll(lockup.contentImage, "thumbnailBadgeViewModel")[0]?.text),
    }));
  const older = findAll(data, "playlistVideoRenderer").map((video) => ({
    id: video.videoId,
    title: video.title?.runs?.[0]?.text || video.title?.simpleText || "",
    seconds: Number(video.lengthSeconds) || 0,
  }));
  return [...new Map([...lockups, ...older].filter((item) => item.id && !/^\[(private|deleted) video\]$/i.test(item.title)).map((item) => [item.id, item])).values()];
}

export function videoFromHtml(id, html) {
  const player = jsonAfter(html, "ytInitialPlayerResponse = ");
  if (!player) return null;
  const countries = player.microformat?.playerMicroformatRenderer?.availableCountries;
  return {
    id,
    title: player.videoDetails?.title || "",
    channel: player.videoDetails?.author || "",
    seconds: Number(player.videoDetails?.lengthSeconds) || 0,
    embeddable: player.playabilityStatus?.playableInEmbed !== false,
    public: player.playabilityStatus?.status === "OK",
    live: Boolean(player.videoDetails?.isLiveContent && player.videoDetails?.isUpcoming),
    ...(Array.isArray(countries) ? { allow: countries } : {}),
  };
}

export function pageSource({ fetchImpl = fetch, spacing = 400 } = {}) {
  return {
    name: "pages",
    units: () => 0,
    async playlist(id) {
      const { status, html } = await page(`https://www.youtube.com/playlist?list=${id}`, fetchImpl);
      await sleep(spacing);
      const items = status === 200 ? playlistFromHtml(html) : [];
      return { items, gone: !items.length };
    },
    async videos(ids, items = []) {
      if (!ids.length) return [];
      const { html } = await page(`https://www.youtube.com/watch?v=${ids[0]}`, fetchImpl);
      await sleep(spacing);
      const first = videoFromHtml(ids[0], html);
      if (!first) return [];
      const known = new Map(items.map((item) => [item.id, item]));
      return ids.map((id, index) => (index === 0 ? first : {
        ...first,
        id,
        title: known.get(id)?.title || "",
        seconds: known.get(id)?.seconds || 0,
      }));
    },
    async channelPlaylists() {
      return [];
    },
  };
}
