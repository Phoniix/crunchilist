(() => {
  // lib/match-engine.js
  var LANGUAGES = "English|Japanese|Korean|Chinese|Mandarin|Cantonese|Spanish|Castilian|Latin American Spanish|Latin American|European Spanish|Portuguese|Brazilian Portuguese|European Portuguese|French|German|Italian|Russian|Arabic|Hindi|Tamil|Telugu|Thai|Indonesian|Malay|Vietnamese|Turkish|Polish|Dutch|Swedish";
  var LANGUAGE_TAG = new RegExp(`\\s*\\((?:(?:${LANGUAGES})(?:\\s+(?:Dub|Dubbed|Sub|Subbed|Subtitled|Audio))?|(?:[\\w-]+\\s+)?(?:Dub|Dubbed|Sub|Subbed|Subtitled)|Uncut|Uncensored|Simulcast)\\)`, "gi");

  // lib/services.js
  var SERVICES = [
    {
      id: "crunchyroll",
      name: "Crunchyroll",
      origins: ["https://www.crunchyroll.com/*"],
      home: "https://www.crunchyroll.com/",
      sites: ["Crunchyroll"],
      imports: true,
      why: "Reads your Crunchyroll watch history and notices what you play, using your own sign-in. Nothing is changed on Crunchyroll.",
      // The page script only notices the sign-in token the site already uses; the content script passes it on.
      scripts: [
        { file: "crunchyroll-page", world: "MAIN", runAt: "document_start" },
        { file: "crunchyroll", world: "ISOLATED", runAt: "document_start" }
      ]
    },
    {
      id: "netflix",
      name: "Netflix",
      origins: ["https://www.netflix.com/*"],
      home: "https://www.netflix.com/",
      sites: ["Netflix"],
      imports: true,
      why: "Reads your Netflix viewing activity and notices what you play, using your own sign-in. Nothing is changed on Netflix.",
      // The page script only reports the site's build id and open profile; the content script reads activity pages.
      scripts: [
        { file: "netflix-page", world: "MAIN", runAt: "document_idle" },
        { file: "netflix", world: "ISOLATED", runAt: "document_idle" }
      ]
    },
    {
      id: "prime",
      name: "Prime Video",
      origins: ["https://www.primevideo.com/*", "https://www.amazon.com/gp/video/*"],
      home: "https://www.primevideo.com/",
      sites: ["Amazon Prime Video", "Prime Video", "Amazon"],
      imports: true,
      why: "Reads your Prime Video watch history, using your own sign-in. Nothing is changed on Prime Video.",
      // Loads the Watch History page in the user's tab and passes on the list of what was watched.
      scripts: [{ file: "prime", world: "ISOLATED", runAt: "document_idle" }]
    },
    {
      id: "hulu",
      name: "Hulu",
      origins: ["https://www.hulu.com/*"],
      home: "https://www.hulu.com/",
      sites: ["Hulu"],
      imports: false,
      // No history to read, so episodes are noted as they're played.
      tracks: true,
      // Not connectable until it can be tested against a real account.
      untested: true,
      why: "Coming later \u2014 Hulu connection and tracking aren't ready yet.",
      scripts: []
    },
    {
      id: "tubi",
      name: "Tubi",
      origins: ["https://tubitv.com/*"],
      home: "https://tubitv.com/",
      sites: ["Tubi TV", "Tubi"],
      imports: false,
      tracks: true,
      why: "Notices the anime episodes and films you finish on Tubi, and reads Tubi's Anime category. Nothing is changed on Tubi.",
      // The page script only notices the guest token Tubi's app signs catalog requests with, and loads Anime pages with it.
      scripts: [
        { file: "tubi-page", world: "MAIN", runAt: "document_start" },
        { file: "tubi", world: "ISOLATED", runAt: "document_idle" }
      ]
    },
    {
      id: "hidive",
      name: "HIDIVE",
      origins: ["https://www.hidive.com/*"],
      home: "https://www.hidive.com/login",
      sites: ["HIDIVE"],
      imports: true,
      why: "Reads your HIDIVE watch history and notices what you play, using your own sign-in. Nothing is changed on HIDIVE.",
      // The page script only notices the headers HIDIVE's app already sends, and loads history pages with them.
      scripts: [
        { file: "hidive-page", world: "MAIN", runAt: "document_start" },
        { file: "hidive", world: "ISOLATED", runAt: "document_idle" }
      ]
    }
  ];
  var LISTING_SITES = SERVICES.map((service) => ({ site: service.name, service: service.id }));

  // lib/catalogs.js
  var CATALOG_EVERY_MS = 7 * 24 * 60 * 60 * 1e3;
  var CATALOG_MAX_ITEMS = 25e3;
  var cleanTitle = (text2) => String(text2 || "").replace(/\s+/g, " ").trim().slice(0, 180);
  var HIDIVE_API = "https://dce-frontoffice.imggaming.com/";
  var GRID_PATH = `${HIDIVE_API}api/v1/view/content-grid?`;
  var HIDIVE_GRIDS = ["266043db-02a8-4646-82bc-9da24127ccdc", "05d9e1ad-8dca-4dd9-8aac-5c1b5c660115"];
  var HIDIVE_PAGE = 63;
  var HIDIVE_MAX_PAGES = 400;
  var HIDIVE_PATHS = { SERIES: "series", VOD: "video", PLAYLIST: "playlist" };
  var hidiveGridUrl = (grid) => `${GRID_PATH}gridViewConfigId=${encodeURIComponent(grid)}`;
  function hidivePageUrl(url, timezone = "UTC") {
    const text2 = String(url || "");
    if (!text2.startsWith(GRID_PATH)) return "";
    const full = new URL(text2);
    full.searchParams.set("rpp", String(HIDIVE_PAGE));
    if (!full.searchParams.has("timezone")) full.searchParams.set("timezone", timezone);
    return full.toString();
  }
  function parseHidiveGrid(body) {
    const items = [];
    let next = "";
    const seen = /* @__PURE__ */ new Set();
    const walk = (value, depth) => {
      if (depth > 30 || !value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        for (const item of value) walk(item, depth + 1);
        return;
      }
      const action = value.action;
      if (action?.type === "route" && action.data && typeof action.data.id === "string") {
        const [type, number] = action.data.id.split("#");
        const title = cleanTitle(action.data.title);
        if (HIDIVE_PATHS[type] && /^\d+$/.test(number || "") && title && !seen.has(action.data.id)) {
          seen.add(action.data.id);
          items.push({ title, kind: type === "VOD" ? "movie" : "series", year: null, url: `https://www.hidive.com/${HIDIVE_PATHS[type]}/${number}` });
        }
      }
      if (action?.type === "CARDLIST_PAGE_NEXT" && typeof action.data?.url === "string" && action.data.url.startsWith(GRID_PATH)) next = action.data.url;
      for (const child of Object.values(value)) walk(child, depth + 1);
    };
    walk(body, 0);
    return { items, next };
  }

  // lib/watch-tracking.js
  var REPEAT_MS = 6 * 60 * 60 * 1e3;

  // lib/hidive-history.js
  var text = (value, max = 200) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
  var count = (value) => Number.isInteger(value) && value > 0 && value < 1e5 ? value : null;
  var seconds = (value) => Number.isFinite(value) && value >= 0 ? value : null;
  var id = (value) => Number.isInteger(value) && value > 0 ? String(value) : "";
  function hidiveEntries(body) {
    const vods = Array.isArray(body?.vods) ? body.vods.slice(0, 100) : [];
    return vods.filter((vod) => vod && typeof vod === "object" && id(vod.id)).map((vod) => {
      const info = vod.episodeInformation && typeof vod.episodeInformation === "object" ? vod.episodeInformation : null;
      return {
        id: id(vod.id),
        title: text(vod.title),
        series: text(info?.seriesInformation?.title),
        seriesId: id(info?.seriesInformation?.id),
        seasonId: id(info?.season),
        seasonTitle: text(info?.seasonTitle),
        season: count(info?.seasonNumber),
        episode: count(info?.episodeNumber),
        at: Number.isFinite(vod.watchedAt) && vod.watchedAt > 0 ? vod.watchedAt : 0,
        duration: seconds(vod.duration),
        position: seconds(vod.watchProgress),
        episodic: Boolean(info)
      };
    });
  }

  // content/sites/hidive.js
  var PAGE_SOURCE = "crunchilist-search-page";
  if (window.top === window) chrome.runtime.sendMessage({ type: "hidiveHello" }).catch(() => {
  });
  var FINISHED2 = 0.9;
  var finished = /* @__PURE__ */ new Set();
  if (window.top === window) {
    setInterval(() => {
      const id2 = /^\/video\/(\d+)/.exec(location.pathname)?.[1];
      if (!id2 || finished.has(id2)) return;
      const video = document.querySelector("video");
      if (!video || !(video.duration > 300) || video.currentTime / video.duration < FINISHED2) return;
      finished.add(id2);
      chrome.runtime.sendMessage({ type: "hidiveWatched" }).catch(() => {
      });
    }, 5e3);
  }
  async function digest(value) {
    if (!value) return "";
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
    return [...bytes.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function askPage(kind, fields) {
    return new Promise((resolve) => {
      const id2 = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        removeEventListener("message", onReply);
        resolve(null);
      }, 2e4);
      function onReply(event) {
        if (event.source !== window || event.origin !== location.origin) return;
        const data = event.data;
        if (data?.source !== PAGE_SOURCE || data.kind !== kind || data.id !== id2) return;
        clearTimeout(timer);
        removeEventListener("message", onReply);
        resolve(data);
      }
      addEventListener("message", onReply);
      window.postMessage({ source: "crunchilist-search-ext", kind, id: id2, ...fields }, location.origin);
    });
  }
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
    (message.type === "hidiveCatalog" ? catalog() : history(message.page)).then((payload) => ({ ok: true, payload }), (error) => ({ ok: false, error: error?.message || "HIDIVE didn't answer." })).then(sendResponse);
    return true;
  });
})();
