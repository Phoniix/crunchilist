// Runs on netflix.com only after the user connects Netflix. Tells the background this tab can read viewing activity
// and the Anime Series / Anime Movies genre catalogs, then reads them on request with the user's own Netflix
// sign-in (the same calls Netflix's pages make). Nothing is changed on Netflix; tokens never leave this tab.
import { CATALOG_MAX_ITEMS, NETFLIX_ANIME_MOVIES, NETFLIX_CATALOG_PAGE, NETFLIX_GENRES, NETFLIX_MAX_PAGES, parseNetflixGenrePage } from "../../lib/catalogs.js";
import { netflixHistoryStalled, netflixInfo, seasonNumberOf, splitPlayerTitle } from "../../lib/netflix-history.js";
import { FINISHED } from "../../lib/watch-tracking.js";
import { START_SECONDS } from "../../lib/watch-loop.js";

// Re-injection (import soft-refresh / Connect) must not stack intervals or message listeners.
if (window.__ksNetflixContent) {
  // Still re-hello so the background remembers this tab after an inject.
  if (window.top === window) chrome.runtime.sendMessage({ type: "netflixHello" }).catch(() => {});
} else {
window.__ksNetflixContent = true;

const PAGE_SOURCE = "crunchilist-search-page";
const PAGE_SIZE = 50;
const CHECK_MS = 2000;
const PAGE_TIMEOUT_MS = 4000;
let cached = null;

if (window.top === window) chrome.runtime.sendMessage({ type: "netflixHello" }).catch(() => {});

// Netflix players often leave TimeRanges.played empty early — don't require it for start detection.
function netflixPlayer() {
  const videos = [...document.querySelectorAll("video")].filter((video) => Number.isFinite(video.duration) && video.duration > 60);
  return videos.sort((a, b) => (b.currentTime || 0) - (a.currentTime || 0) || b.duration - a.duration)[0] || null;
}

function pageLabels() {
  const meta = navigator.mediaSession?.metadata;
  const labels = [];
  const junk = /^(netflix|home|browse|my list|title details|watch|loading|…|\.{3})$/i;
  const clean = (value) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text && !junk.test(text) ? text : "";
  };
  const show = clean(meta?.album || meta?.artist);
  const ep = clean(meta?.title);
  // Never push a bare episode title — mediaSession.title is usually the episode, not the show.
  if (show && ep) labels.push(`${show}: ${ep}`);
  if (show) labels.push(show);
  const doc = clean(String(document.title || "").replace(/\s*[-–|]\s*Netflix\s*$/i, "").replace(/^\s*Watch\s+/i, ""));
  // Tab title is often the series name; skip if it only repeats the episode title.
  if (doc && doc !== ep) labels.push(doc);
  return [...new Set(labels)];
}

// Tracking as you watch: ~5s → provisional CW; most of the episode → finish + AniList catch-up.
const started = new Set();
const finished = new Set();
if (window.top === window) {
  setInterval(() => {
    const id = /^\/watch\/(\d+)/.exec(location.pathname)?.[1];
    if (!id) return;
    const video = netflixPlayer();
    if (!video) return;
    if (!started.has(id) && video.currentTime >= START_SECONDS) {
      started.add(id);
      chrome.runtime.sendMessage({ type: "netflixStarted", videoId: id, labels: pageLabels() }).catch(() => {});
    }
    if (!finished.has(id) && video.duration > 0 && video.currentTime / video.duration >= FINISHED) {
      finished.add(id);
      chrome.runtime.sendMessage({ type: "netflixWatched", videoId: id, labels: pageLabels() }).catch(() => {});
    }
  }, CHECK_MS);
}

function askPage(kind, extra = {}, timeoutMs = PAGE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => { removeEventListener("message", onReply); resolve(null); }, timeoutMs);
    function onReply(event) {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data;
      if (data?.source !== PAGE_SOURCE || data.id !== id) return;
      if (kind === "profile-request" && data.kind !== "profile") return;
      if (kind === "fetch-request" && data.kind !== "fetch-reply") return;
      clearTimeout(timer);
      removeEventListener("message", onReply);
      resolve(data);
    }
    addEventListener("message", onReply);
    window.postMessage({ source: "crunchilist-search-ext", kind, id, ...extra }, location.origin);
  });
}

async function askPageProfile() {
  const data = await askPage("profile-request", {}, 2000);
  if (!data) return null;
  const text = (value, max = 400) => String(value || "").slice(0, max);
  return {
    build: text(data.build, 60),
    guid: text(data.guid, 60),
    name: text(data.name, 80),
    authURL: text(data.authURL),
    esn: text(data.esn, 120),
  };
}

async function profile() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const found = await askPageProfile();
    if (found?.guid && found.build) { cached = found; return found; }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Netflix isn't ready in that tab. Open netflix.com, pick your profile, then try again.");
}

const baseHeaders = (me) => ({
  "Content-Type": "application/x-www-form-urlencoded",
  "x-netflix.uiversion": me.build,
  "x-netflix.clienttype": "akira",
  "x-netflix.nq.stack": "prod",
  "x-netflix.esnprefix": "NFCDCH-LX-",
});

// Prefer the page world for Netflix POSTs (cookies / CSRF match the site). Fall back to this world if needed.
async function post(url, headers, body) {
  const viaPage = await askPage("fetch-request", { url, headers, body }, 12000);
  // status 0 / no reply means the page hook never got an HTTP response (missing hook, timeout, or fetch throw).
  // A real HTTP status is final — don't hide a 401/500 behind the isolated-world fallback.
  if (viaPage?.status === 401) throw new Error("Netflix asked you to sign in again. Reload Netflix, then continue the import.");
  if (viaPage?.ok) return viaPage.json;
  if (viaPage?.status) {
    cached = null;
    throw new Error(`Netflix didn't answer (${viaPage.status}). Reload Netflix and try again, or use the file upload: netflix.com/viewingactivity, then Download all.`);
  }
  const response = await fetch(url, { method: "POST", credentials: "include", headers, body });
  if (response.status === 401) throw new Error("Netflix asked you to sign in again. Reload Netflix, then continue the import.");
  if (!response.ok) {
    cached = null;
    throw new Error(`Netflix didn't answer (${response.status}). Reload Netflix and try again, or use the file upload: netflix.com/viewingactivity, then Download all.`);
  }
  return response.json().catch(() => null);
}

async function historyPage(me, page) {
  const path = encodeURIComponent(JSON.stringify(["aui", "viewingActivity", page, PAGE_SIZE]));
  const json = await post(
    `/api/aui/pathEvaluator/web/^2.0.0?method=call&callPath=${path}&falcor_server=0.1.0`,
    {
      ...baseHeaders(me),
      "x-netflix.client.request.name": "ui/xhrUnclassified",
      "x-netflix.request.routing": JSON.stringify({ path: "/nq/aui/endpoint/^1.0.0-web/pathEvaluator", control_tag: "auinqweb" }),
    },
    `param=${encodeURIComponent(JSON.stringify({ guid: me.guid }))}`,
  );
  const value = json?.jsonGraph?.aui?.viewingActivity?.value;
  if (!value || !Array.isArray(value.viewedItems)) throw new Error("Netflix changed how viewing activity is sent. Use the file upload for now: netflix.com/viewingactivity, then Download all.");
  if (netflixHistoryStalled(value, page)) throw new Error("Netflix's viewing activity hasn't loaded in that tab yet. Wait a few seconds and try the import again.");
  return value;
}

// Netflix's member data for a list of videos; any failure just means less detail, never a failed import.
async function videoData(me, path) {
  if (!me.authURL) return null;
  const headers = { ...baseHeaders(me), "x-netflix.client.request.name": "ui/falcorUnclassified", "x-netflix.request.client.user.guid": me.guid };
  if (me.esn) headers["x-netflix.esn"] = me.esn;
  try {
    const json = await post(
      `/nq/website/memberapi/release/pathEvaluator?webp=true&falcor_server=0.1.0&withSize=true&materialize=true&original_path=${encodeURIComponent(`/shakti/${me.build}/pathEvaluator`)}`,
      headers,
      `authURL=${encodeURIComponent(me.authURL)}&path=${encodeURIComponent(JSON.stringify(path))}`,
    );
    return json?.jsonGraph || null;
  } catch {
    return null;
  }
}

const value = (node) => (node && typeof node === "object" && "value" in node ? node.value : node);
const number = (node) => (typeof value(node) === "number" ? value(node) : undefined);

// Genre names for a video, following Falcor references to the genres list when Netflix sends them that way.
function genreNames(graph, video) {
  const list = video?.genres;
  if (!list || typeof list !== "object") return null;
  const names = [];
  for (const [index, entry] of Object.entries(list)) {
    if (!/^\d+$/.test(index)) continue;
    const ref = entry?.$type === "ref" ? entry.value : null;
    const target = ref ? ref.reduce((node, key) => node?.[key], graph) : entry;
    const name = value(target?.name);
    if (typeof name === "string" && name) names.push(name);
  }
  return names;
}

const shows = new Map();

// Year and genres for each show (or film), asked once per show.
async function showInfo(me, ids) {
  const fresh = ids.filter((id) => !shows.has(id));
  if (fresh.length) {
    const [years, genres] = await Promise.all([
      videoData(me, ["videos", fresh, ["releaseYear", "title"]]),
      videoData(me, ["videos", fresh, "genres", { from: 0, to: 19 }, "name"]),
    ]);
    for (const id of fresh) {
      const yearNode = years?.videos?.[id];
      const genreNode = genres?.videos?.[id];
      shows.set(id, { year: number(yearNode?.releaseYear) ?? null, genres: genreNames(genres, genreNode) });
    }
  }
  return Object.fromEntries(ids.map((id) => [id, shows.get(id)]));
}

async function activity(page) {
  const me = cached || (await profile());
  const history = await historyPage(me, Number(page) || 0);
  const items = history.viewedItems.filter((item) => item && typeof item === "object");
  const ids = [...new Set(items.map((item) => item.movieID).filter(Number.isInteger))];
  const showIds = [...new Set(items.map((item) => (Number.isInteger(item.series) ? item.series : item.movieID)).filter(Number.isInteger))];
  const [progress, info] = await Promise.all([videoData(me, ["videos", ids, ["runtime", "bookmarkPosition"]]), showInfo(me, showIds)]);
  const viewedItems = items.map((item) => {
    const video = progress?.videos?.[item.movieID];
    const show = info[Number.isInteger(item.series) ? item.series : item.movieID];
    return {
      ...item,
      ...(video ? { duration: number(video.runtime), bookmark: number(video.bookmarkPosition) } : {}),
      showYear: show?.year ?? null,
      genres: show?.genres ?? null,
    };
  });
  return { viewedItems, vhSize: history.vhSize, profileName: history.profileInfo?.profileName || "" };
}

function metaFromLabel(label, anime) {
  const split = splitPlayerTitle(label);
  if (!split?.series) return null;
  return {
    series: split.series,
    season: split.season || "",
    seasonNumber: split.seasonNumber ?? seasonNumberOf(split.season || ""),
    // Netflix doesn't expose a reliable episode number on the player — season progress is filled from activity later.
    episode: 1,
    anime,
    title: label,
  };
}

function metaFromLabelList(labelList, anime = null) {
  const ordered = [
    ...labelList.filter((label) => label.includes(": ")),
    ...labelList.filter((label) => !label.includes(": ")),
  ];
  for (const label of ordered) {
    const found = metaFromLabel(label, anime);
    if (found) return found;
  }
  return null;
}

function parentVideoId(node, graph) {
  const parent = node?.parent;
  if (parent?.$type === "ref" && Array.isArray(parent.value)) {
    const id = parent.value[parent.value.length - 1];
    if (Number.isInteger(id)) return id;
    const target = parent.value.reduce((next, key) => next?.[key], graph);
    const summary = value(target?.summary);
    if (Number.isInteger(summary?.id)) return summary.id;
  }
  const summary = value(node?.summary);
  if (Number.isInteger(summary?.id) && /^(show|series)$/i.test(String(summary?.type || ""))) return summary.id;
  return null;
}

async function namedPlay(me, { series, season = "", episodeTitle = "", seriesId = null, anime = null }) {
  const name = String(series || "").trim();
  if (!name) return null;
  let resolvedAnime = anime;
  if (resolvedAnime == null && Number.isInteger(seriesId)) {
    const info = await showInfo(me, [seriesId]);
    resolvedAnime = netflixInfo({ genres: info[seriesId]?.genres ?? null }).anime;
  }
  return {
    series: name,
    season: String(season || "").trim(),
    seasonNumber: seasonNumberOf(season || ""),
    episode: 1,
    anime: resolvedAnime,
    title: String(episodeTitle || name).trim(),
  };
}

// Name the title currently on /watch/{id}. Prefer Netflix seriesTitle; never treat episode title as the series.
async function watchNow(videoId, labels = []) {
  const id = Number(videoId);
  if (!Number.isInteger(id)) return null;
  const labelList = (Array.isArray(labels) ? labels : []).map((label) => String(label || "")).filter(Boolean);

  const me = cached || (await profile().catch(() => null));
  if (!me) return metaFromLabelList(labelList);

  let item = null;
  try {
    const history = await historyPage(me, 0);
    item = (history.viewedItems || []).find((row) => row?.movieID === id) || null;
  } catch {
    item = null;
  }
  if (item?.seriesTitle) {
    return namedPlay(me, {
      series: item.seriesTitle,
      season: item.seasonDescriptor || "",
      episodeTitle: item.title || item.episodeTitle || "",
      seriesId: Number.isInteger(item.series) ? item.series : null,
    });
  }

  const graph = await videoData(me, ["videos", id, ["title", "summary", "parent"]]);
  const video = graph?.videos?.[id];
  const episodeTitle = typeof value(video?.title) === "string" ? value(video.title).trim() : "";
  let seriesId = Number.isInteger(item?.series) ? item.series : parentVideoId(video, graph);
  if (!seriesId) {
    // Parent may only be a ref until we ask for it.
    const withParent = await videoData(me, ["videos", id, "parent", ["title", "summary"]]);
    seriesId = parentVideoId(withParent?.videos?.[id], withParent) || seriesId;
    const parentTitle = value(withParent?.videos?.[id]?.parent?.title);
    if (typeof parentTitle === "string" && parentTitle.trim()) {
      return namedPlay(me, { series: parentTitle, episodeTitle, seriesId });
    }
  }
  if (Number.isInteger(seriesId) && seriesId !== id) {
    const parent = await videoData(me, ["videos", seriesId, "title"]);
    const parentTitle = value(parent?.videos?.[seriesId]?.title);
    if (typeof parentTitle === "string" && parentTitle.trim()) {
      return namedPlay(me, {
        series: parentTitle,
        season: item?.seasonDescriptor || "",
        episodeTitle,
        seriesId,
      });
    }
  }

  return metaFromLabelList(labelList);
}

// Anime Series (6721) and Anime Movies (3063) A–Z lists — the same lists as browse/genre/6721 and /3063.
// path must be a single Falcor path (same shape as videoData's history calls), not a list of paths.
async function genrePage(me, genreId, from) {
  const to = from + NETFLIX_CATALOG_PAGE - 1;
  const kindHint = genreId === NETFLIX_ANIME_MOVIES ? "movie" : "series";
  const graph = await videoData(me, ["genres", genreId, "az", { from, to }, "reference", ["title", "summary", "releaseYear", "type"]]);
  if (!graph) throw new Error("Netflix didn't return its anime list. Reload Netflix, pick your profile, then try again.");
  let parsed = parseNetflixGenrePage(graph, genreId, { kindHint });
  // Genre lists often return only refs; pull titles in a second call when the first page has ids but no names.
  if (!parsed.items.length && parsed.ids.length) {
    const ids = parsed.ids.map(Number).filter(Number.isInteger);
    const detail = await videoData(me, ["videos", ids, ["title", "summary", "releaseYear", "type"]]);
    parsed = parseNetflixGenrePage({ genres: graph.genres, videos: { ...(graph.videos || {}), ...(detail?.videos || {}) } }, genreId, { kindHint });
  }
  return parsed;
}

async function catalog() {
  const me = cached || (await profile());
  if (!me.authURL) throw new Error("Netflix isn't ready in that tab. Open netflix.com, pick your profile, then try again.");
  const items = [];
  const seen = new Set();
  for (const genreId of NETFLIX_GENRES) {
    for (let page = 0; page < NETFLIX_MAX_PAGES && items.length < CATALOG_MAX_ITEMS; page += 1) {
      const from = page * NETFLIX_CATALOG_PAGE;
      const parsed = await genrePage(me, genreId, from);
      // Empty page (or ids we couldn't name) means stop — never spin on the same from forever.
      if (!parsed.items.length) break;
      for (const item of parsed.items) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        items.push(item);
      }
      if (!parsed.more || parsed.count < NETFLIX_CATALOG_PAGE) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  return { items };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Service-worker → tab messages sometimes omit sender.id; reject only clear cross-extension / tab senders.
  if ((sender.id && sender.id !== chrome.runtime.id) || sender.tab) return false;
  if (message?.type === "netflixPing") {
    sendResponse({ ok: true, ping: true, hasProfile: Boolean(cached?.guid) });
    return false;
  }
  const work = message?.type === "netflixProfile" ? profile().then(({ guid, name }) => ({ ok: true, guid, name }))
    : message?.type === "netflixActivity" ? activity(message.page).then((payload) => ({ ok: true, payload }))
      : message?.type === "netflixWatchNow" ? watchNow(message.videoId, message.labels).then((payload) => ({ ok: true, payload }))
        : message?.type === "netflixCatalog" ? catalog().then((payload) => ({ ok: true, payload }))
          : null;
  if (!work) return false;
  work.catch((error) => ({ ok: false, error: error?.message || "Netflix didn't answer." })).then(sendResponse);
  return true;
});
} // end reinjection guard
