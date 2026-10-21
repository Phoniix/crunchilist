// Runs on netflix.com only after the user connects Netflix. Tells the background this tab can read viewing activity
// and the Anime Series / Anime Movies genre catalogs, then reads them on request with the user's own Netflix
// sign-in (the same calls Netflix's pages make). Nothing is changed on Netflix; tokens never leave this tab.
import { CATALOG_MAX_ITEMS, NETFLIX_ANIME_MOVIES, NETFLIX_CATALOG_PAGE, NETFLIX_GENRES, NETFLIX_MAX_PAGES, parseNetflixGenrePage } from "../../lib/catalogs.js";

const PAGE_SOURCE = "crunchilist-search-page";
const PAGE_SIZE = 50;
let cached = null;

if (window.top === window) chrome.runtime.sendMessage({ type: "netflixHello" }).catch(() => {});

// Tracking as you watch: once most of an episode has played, the background is told that something finished
// (nothing about what), and catches up on viewing activity a little later if tracking is switched on.
const FINISHED = 0.9;
const finished = new Set();
if (window.top === window) {
  setInterval(() => {
    const id = /^\/watch\/(\d+)/.exec(location.pathname)?.[1];
    if (!id || finished.has(id)) return;
    const video = document.querySelector("video");
    if (!video || !(video.duration > 60) || video.currentTime / video.duration < FINISHED) return;
    finished.add(id);
    chrome.runtime.sendMessage({ type: "netflixWatched" }).catch(() => {});
  }, 5000);
}

function askPage() {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => { removeEventListener("message", onReply); resolve(null); }, 1500);
    function onReply(event) {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data;
      if (data?.source !== PAGE_SOURCE || data.kind !== "profile" || data.id !== id) return;
      clearTimeout(timer);
      removeEventListener("message", onReply);
      const text = (value, max = 400) => String(value || "").slice(0, max);
      resolve({ build: text(data.build, 60), guid: text(data.guid, 60), name: text(data.name, 80), authURL: text(data.authURL), esn: text(data.esn, 120) });
    }
    addEventListener("message", onReply);
    window.postMessage({ source: "crunchilist-search-ext", kind: "profile-request", id }, location.origin);
  });
}

async function profile() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const found = await askPage();
    if (found?.guid && found.build) { cached = found; return found; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Netflix isn't ready in that tab. Open netflix.com, pick your profile, then try again.");
}

const baseHeaders = (me) => ({
  "Content-Type": "application/x-www-form-urlencoded",
  "x-netflix.uiversion": me.build,
  "x-netflix.clienttype": "akira",
  "x-netflix.nq.stack": "prod",
});

async function post(url, headers, body) {
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
    `/api/aui/pathEvaluator/web/%5E2.0.0?method=call&callPath=${path}&falcor_server=0.1.0`,
    {
      ...baseHeaders(me),
      "x-netflix.client.request.name": "ui/xhrUnclassified",
      "x-netflix.request.routing": JSON.stringify({ path: "/nq/aui/endpoint/^1.0.0-web/pathEvaluator", control_tag: "auinqweb" }),
    },
    `param=${encodeURIComponent(JSON.stringify({ guid: me.guid }))}`,
  );
  const value = json?.jsonGraph?.aui?.viewingActivity?.value;
  if (!value || !Array.isArray(value.viewedItems)) throw new Error("Netflix changed how viewing activity is sent. Use the file upload for now: netflix.com/viewingactivity, then Download all.");
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
  if (sender.id !== chrome.runtime.id || sender.tab) return false;
  const work = message?.type === "netflixProfile" ? profile().then(({ guid, name }) => ({ ok: true, guid, name }))
    : message?.type === "netflixActivity" ? activity(message.page).then((payload) => ({ ok: true, payload }))
      : message?.type === "netflixCatalog" ? catalog().then((payload) => ({ ok: true, payload }))
        : null;
  if (!work) return false;
  work.catch((error) => ({ ok: false, error: error?.message || "Netflix didn't answer." })).then(sendResponse);
  return true;
});
