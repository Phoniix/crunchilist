// Runs on hidive.com only after the user connects HIDIVE. Tells the background this tab can read watch history,
// then reads history pages and the Series and Movies catalog on request through the page script, with the user's own
// HIDIVE sign-in. Only what was watched and the catalog's titles leave this tab; the profile id is hashed first.
// Nothing is changed on HIDIVE.
import { CATALOG_MAX_ITEMS, HIDIVE_GRIDS, HIDIVE_MAX_PAGES, hidiveGridUrl, hidivePageUrl, parseHidiveGrid } from "../../lib/catalogs.js";
import { hidiveEntries, hidiveEntryFinished } from "../../lib/hidive-history.js";
import { FINISHED, MIN_SECONDS } from "../../lib/watch-tracking.js";
import { START_SECONDS } from "../../lib/watch-loop.js";

// Re-injection (import soft-refresh / Connect) must not stack intervals or message listeners.
if (window.__ksHidiveContent) {
  if (window.top === window) chrome.runtime.sendMessage({ type: "hidiveHello" }).catch(() => {});
} else {
window.__ksHidiveContent = true;

const PAGE_SOURCE = "crunchilist-search-page";
const CHECK_MS = 5000;
const HISTORY_EVERY = 3;

if (window.top === window) chrome.runtime.sendMessage({ type: "hidiveHello" }).catch(() => {});

// Videos in open shadow roots (DICE/Bitmovin UI) as well as the light DOM.
function videosIn(root, out = []) {
  for (const video of root.querySelectorAll("video")) out.push(video);
  for (const node of root.querySelectorAll("*")) {
    if (node.shadowRoot) videosIn(node.shadowRoot, out);
  }
  return out;
}

// Longest episode-length video that's actually been played (skip ads / trailers / empty players).
function mainVideo() {
  const videos = videosIn(document).filter((video) => Number.isFinite(video.duration) && video.duration >= MIN_SECONDS && video.played?.length);
  return videos.sort((a, b) => b.duration - a.duration)[0] || null;
}

function videoDone() {
  const video = mainVideo();
  return Boolean(video && video.currentTime / video.duration >= FINISHED);
}

function videoStarted() {
  const video = mainVideo();
  return Boolean(video && video.currentTime >= START_SECONDS);
}

function hintFrom(entry) {
  return entry ? {
    series: entry.series || entry.title || "",
    season: entry.seasonTitle || "",
    seasonNumber: entry.season,
    episode: entry.episode || 1,
  } : null;
}

// Tracking as you watch: ~5s → provisional CW; finish (video or history) → confirm + catch-up.
// HIDIVE's player often keeps <video> out of reach, so history backs both signals.
// Video can fire before history lists this /video/{id}; allow one upgrade once history names it
// (background never falls back to a different history title when videoId is known).
const started = new Set();
const named = new Set();
const finished = new Set();
let historyTick = 0;
let historyChecking = false;
if (window.top === window) {
  setInterval(async () => {
    const id = /^\/video\/(\d+)/.exec(location.pathname)?.[1];
    if (!id) return;
    const signalStart = (entry = null) => {
      if (finished.has(id)) return;
      if (entry) {
        if (named.has(id)) return;
        named.add(id);
        started.add(id);
        chrome.runtime.sendMessage({ type: "hidiveStarted", videoId: id, entry: hintFrom(entry) }).catch(() => {});
        return;
      }
      if (started.has(id)) return;
      started.add(id);
      chrome.runtime.sendMessage({ type: "hidiveStarted", videoId: id, entry: null }).catch(() => {});
    };
    const signalFinish = (entry = null) => {
      if (entry) {
        if (finished.has(id) && named.has(id)) return;
        named.add(id);
      } else if (finished.has(id)) {
        return;
      }
      finished.add(id);
      started.add(id);
      chrome.runtime.sendMessage({ type: "hidiveWatched", videoId: id, entry: hintFrom(entry) }).catch(() => {});
    };
    if (videoDone()) signalFinish();
    else if (videoStarted()) signalStart();
    historyTick = (historyTick + 1) % HISTORY_EVERY;
    if (historyTick !== 0 || historyChecking) return;
    historyChecking = true;
    try {
      const reply = await askPage("hidive-history", { page: 1 });
      if (!reply?.ok || !reply.body) return;
      const entry = hidiveEntries(reply.body).find((row) => row.id === id);
      if (!entry) return;
      if (hidiveEntryFinished(entry)) signalFinish(entry);
      else if ((Number(entry.position) || 0) >= START_SECONDS) signalStart(entry);
    } finally {
      historyChecking = false;
    }
  }, CHECK_MS);
}

async function digest(value) {
  if (!value) return "";
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function askPage(kind, fields, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => { removeEventListener("message", onReply); resolve(null); }, timeoutMs);
    function onReply(event) {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data;
      if (data?.source !== PAGE_SOURCE || data.kind !== kind || data.id !== id) return;
      clearTimeout(timer);
      removeEventListener("message", onReply);
      resolve(data);
    }
    addEventListener("message", onReply);
    window.postMessage({ source: "crunchilist-search-ext", kind, id, ...fields }, location.origin);
  });
}

// Every title in HIDIVE's Series and Movies grids, page by page.
async function catalog() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const items = [];
  for (const grid of HIDIVE_GRIDS) {
    let url = hidivePageUrl(hidiveGridUrl(grid), timezone);
    for (let page = 0; url && page < HIDIVE_MAX_PAGES && items.length < CATALOG_MAX_ITEMS; page += 1) {
      const reply = await askPage("hidive-grid", { url });
      if (!reply) throw new Error("HIDIVE isn't ready in that tab. Reload hidive.com, then try again.");
      if (!reply.ok) throw new Error(reply.error || "HIDIVE didn't answer.");
      const parsed = parseHidiveGrid(reply.body);
      items.push(...parsed.items);
      url = parsed.next ? hidivePageUrl(parsed.next, timezone) : "";
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  return { items };
}

async function history(page) {
  const reply = await askPage("hidive-history", { page: Number(page) || 1 });
  if (!reply) throw new Error("HIDIVE isn't ready in that tab. Reload hidive.com while signed in, then try again.");
  if (!reply.ok) throw new Error(reply.error || "HIDIVE didn't answer.");
  const body = reply.body;
  if (!body || !Array.isArray(body.vods)) throw new Error("HIDIVE changed how its watch history is sent. Nothing was imported.");
  return { entries: hidiveEntries(body), page: body.page, totalPages: body.totalPages, totalResults: body.totalResults, profile: await digest(reply.profile) };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Service-worker → tab messages sometimes omit sender.id; reject only clear cross-extension / tab senders.
  if ((sender.id && sender.id !== chrome.runtime.id) || sender.tab) return false;
  if (message?.type === "hidivePing") {
    askPage("hidive-ready", {}, 800).then((reply) => {
      sendResponse({ ok: true, ping: true, ready: Boolean(reply?.ready) });
    });
    return true;
  }
  if (!["hidiveHistory", "hidiveCatalog"].includes(message?.type)) return false;
  (message.type === "hidiveCatalog" ? catalog() : history(message.page))
    .then((payload) => ({ ok: true, payload }), (error) => ({ ok: false, error: error?.message || "HIDIVE didn't answer." }))
    .then(sendResponse);
  return true;
});
} // end reinjection guard
