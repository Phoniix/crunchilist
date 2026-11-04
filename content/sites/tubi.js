// Runs on tubitv.com only after the user connects Tubi. When most of an episode or film has played, the page's own
// HTML is fetched again (Tubi doesn't update the page head while moving between videos) to read its title and
// genres, and the background is told what finished. On request it also reads Tubi's Anime category through the
// page script, so show pages know what Tubi carries. Nothing is changed on Tubi.
import { CATALOG_MAX_ITEMS, TUBI_MAX_PAGES, parseTubiContainer, tubiContainerUrl } from "../../lib/catalogs.js";
import { watchLoop } from "../../lib/watch-loop.js";
import { tubiItem } from "../../lib/watch-tracking.js";

const PAGE_SOURCE = "crunchilist-search-page";

if (window.top === window) chrome.runtime.sendMessage({ type: "tubiHello" }).catch(() => {});

watchLoop("tubi", {
  place: () => (/^\/(tv-shows|movies)\/\d+/.test(location.pathname) ? location.pathname : ""),
  async identify(path) {
    const response = await fetch(path, { credentials: "include" });
    if (!response.ok) return { miss: `Tubi didn't answer (${response.status})` };
    const item = tubiItem(await response.text(), path);
    return item ? { item } : { miss: "Tubi's page didn't name the episode" };
  },
});

function askPage(url) {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => { removeEventListener("message", onReply); resolve(null); }, 20000);
    function onReply(event) {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data;
      if (data?.source !== PAGE_SOURCE || data.kind !== "tubi-catalog" || data.id !== id) return;
      clearTimeout(timer);
      removeEventListener("message", onReply);
      resolve(data);
    }
    addEventListener("message", onReply);
    window.postMessage({ source: "crunchilist-search-ext", kind: "tubi-catalog", id, url }, location.origin);
  });
}

async function catalog() {
  const items = [];
  let cursor = 0;
  for (let page = 0; cursor != null && page < TUBI_MAX_PAGES && items.length < CATALOG_MAX_ITEMS; page += 1) {
    const reply = await askPage(tubiContainerUrl(cursor));
    if (!reply) throw new Error("Tubi isn't ready in that tab. Reload tubitv.com, then try again.");
    if (!reply.ok) throw new Error(reply.error || "Tubi didn't answer.");
    const parsed = parseTubiContainer(reply.body);
    if (!parsed.items.length) break;
    items.push(...parsed.items);
    cursor = parsed.cursor;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return { items };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.tab || message?.type !== "tubiCatalog" || window.top !== window) return false;
  catalog()
    .then((payload) => ({ ok: true, payload }), (error) => ({ ok: false, error: error?.message || "Tubi didn't answer." }))
    .then(sendResponse);
  return true;
});
