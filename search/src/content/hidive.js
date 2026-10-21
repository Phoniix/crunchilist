// Runs on hidive.com only after the user connects HIDIVE. Tells the background this tab can read watch history,
// then reads history pages and the Series and Movies catalog on request through the page script, with the user's own
// HIDIVE sign-in. Only what was watched and the catalog's titles leave this tab; the profile id is hashed first.
// Nothing is changed on HIDIVE.
import { CATALOG_MAX_ITEMS, HIDIVE_GRIDS, HIDIVE_MAX_PAGES, hidiveGridUrl, hidivePageUrl, parseHidiveGrid } from "../lib/catalogs.js";
import { hidiveEntries } from "../lib/hidive-history.js";

const PAGE_SOURCE = "crunchilist-search-page";

if (window.top === window) chrome.runtime.sendMessage({ type: "hidiveHello" }).catch(() => {});

// Tracking as you watch: once most of an episode has played, the background is told that something finished
// (nothing about what), and catches up on watch history a little later if tracking is switched on.
const FINISHED = 0.9;
const finished = new Set();
if (window.top === window) {
  setInterval(() => {
    const id = /^\/video\/(\d+)/.exec(location.pathname)?.[1];
    if (!id || finished.has(id)) return;
    const video = document.querySelector("video");
    if (!video || !(video.duration > 300) || video.currentTime / video.duration < FINISHED) return;
    finished.add(id);
    chrome.runtime.sendMessage({ type: "hidiveWatched" }).catch(() => {});
  }, 5000);
}

async function digest(value) {
  if (!value) return "";
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function askPage(kind, fields) {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => { removeEventListener("message", onReply); resolve(null); }, 20000);
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
  if (sender.id !== chrome.runtime.id || sender.tab || !["hidiveHistory", "hidiveCatalog"].includes(message?.type)) return false;
  (message.type === "hidiveCatalog" ? catalog() : history(message.page))
    .then((payload) => ({ ok: true, payload }), (error) => ({ ok: false, error: error?.message || "HIDIVE didn't answer." }))
    .then(sendResponse);
  return true;
});
