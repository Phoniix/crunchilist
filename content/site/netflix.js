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
      home: "https://www.hidive.com/",
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
  var cleanTitle = (text) => String(text || "").replace(/\s+/g, " ").trim().slice(0, 180);
  var year = (value2) => Number.isInteger(Number(value2)) && Number(value2) > 1900 && Number(value2) < 2100 ? Number(value2) : null;
  var HIDIVE_API = "https://dce-frontoffice.imggaming.com/";
  var GRID_PATH = `${HIDIVE_API}api/v1/view/content-grid?`;
  var NETFLIX_ANIME_TV = 6721;
  var NETFLIX_ANIME_MOVIES = 3063;
  var NETFLIX_GENRES = [NETFLIX_ANIME_TV, NETFLIX_ANIME_MOVIES];
  var NETFLIX_CATALOG_PAGE = 48;
  var NETFLIX_MAX_PAGES = 80;
  var falcorValue = (node) => {
    if (!node || typeof node !== "object") return node;
    if (node.$type === "atom") return node.value;
    if (node.$type === "ref") return null;
    if ("value" in node) return node.value;
    return node;
  };
  var falcorRef = (node) => {
    if (!node || typeof node !== "object") return null;
    if (node.$type === "ref" && Array.isArray(node.value)) return node.value;
    if (node.reference?.$type === "ref" && Array.isArray(node.reference.value)) return node.reference.value;
    if (Array.isArray(node.reference)) return node.reference;
    if (Array.isArray(node)) return node;
    return null;
  };
  function parseNetflixGenrePage(graph, genreId, { kindHint = "series" } = {}) {
    const items = [];
    const ids = [];
    const list = graph?.genres?.[genreId]?.az;
    if (!list || typeof list !== "object") return { items, ids, count: 0, more: false };
    const indexes = Object.keys(list).filter((key) => /^\d+$/.test(key)).map(Number).sort((a, b) => a - b);
    let hitEnd = false;
    for (const index of indexes) {
      const entry = list[index];
      if (entry?.$type === "atom" || entry?.$type === "sentinel") {
        hitEnd = true;
        break;
      }
      const ref = falcorRef(entry);
      const videoId = ref?.[0] === "videos" ? String(ref[1] || "") : "";
      if (!/^\d+$/.test(videoId)) continue;
      ids.push(videoId);
      const video = graph?.videos?.[videoId];
      const title = cleanTitle(falcorValue(video?.title) || falcorValue(entry?.title) || falcorValue(entry?.reference?.title));
      if (!title) continue;
      const summary = falcorValue(video?.summary) || falcorValue(entry?.summary);
      const type = String(summary?.type || falcorValue(video?.type) || "").toLowerCase();
      const movie = type === "movie" || type !== "show" && kindHint === "movie";
      items.push({
        title,
        kind: movie ? "movie" : "series",
        year: year(falcorValue(video?.releaseYear) ?? summary?.releaseYear),
        url: `https://www.netflix.com/title/${videoId}`
      });
    }
    return { items, ids, count: indexes.length, more: indexes.length >= NETFLIX_CATALOG_PAGE && !hitEnd };
  }

  // content/sites/netflix.js
  var PAGE_SOURCE = "crunchilist-search-page";
  var PAGE_SIZE = 50;
  var cached = null;
  if (window.top === window) chrome.runtime.sendMessage({ type: "netflixHello" }).catch(() => {
  });
  var FINISHED = 0.9;
  var finished = /* @__PURE__ */ new Set();
  if (window.top === window) {
    setInterval(() => {
      const id = /^\/watch\/(\d+)/.exec(location.pathname)?.[1];
      if (!id || finished.has(id)) return;
      const video = document.querySelector("video");
      if (!video || !(video.duration > 60) || video.currentTime / video.duration < FINISHED) return;
      finished.add(id);
      chrome.runtime.sendMessage({ type: "netflixWatched" }).catch(() => {
      });
    }, 5e3);
  }
  function askPage() {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        removeEventListener("message", onReply);
        resolve(null);
      }, 1500);
      function onReply(event) {
        if (event.source !== window || event.origin !== location.origin) return;
        const data = event.data;
        if (data?.source !== PAGE_SOURCE || data.kind !== "profile" || data.id !== id) return;
        clearTimeout(timer);
        removeEventListener("message", onReply);
        const text = (value2, max = 400) => String(value2 || "").slice(0, max);
        resolve({ build: text(data.build, 60), guid: text(data.guid, 60), name: text(data.name, 80), authURL: text(data.authURL), esn: text(data.esn, 120) });
      }
      addEventListener("message", onReply);
      window.postMessage({ source: "crunchilist-search-ext", kind: "profile-request", id }, location.origin);
    });
  }
  async function profile() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const found = await askPage();
      if (found?.guid && found.build) {
        cached = found;
        return found;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Netflix isn't ready in that tab. Open netflix.com, pick your profile, then try again.");
  }
  var baseHeaders = (me) => ({
    "Content-Type": "application/x-www-form-urlencoded",
    "x-netflix.uiversion": me.build,
    "x-netflix.clienttype": "akira",
    "x-netflix.nq.stack": "prod"
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
        "x-netflix.request.routing": JSON.stringify({ path: "/nq/aui/endpoint/^1.0.0-web/pathEvaluator", control_tag: "auinqweb" })
      },
      `param=${encodeURIComponent(JSON.stringify({ guid: me.guid }))}`
    );
    const value2 = json?.jsonGraph?.aui?.viewingActivity?.value;
    if (!value2 || !Array.isArray(value2.viewedItems)) throw new Error("Netflix changed how viewing activity is sent. Use the file upload for now: netflix.com/viewingactivity, then Download all.");
    return value2;
  }
  async function videoData(me, path) {
    if (!me.authURL) return null;
    const headers = { ...baseHeaders(me), "x-netflix.client.request.name": "ui/falcorUnclassified", "x-netflix.request.client.user.guid": me.guid };
    if (me.esn) headers["x-netflix.esn"] = me.esn;
    try {
      const json = await post(
        `/nq/website/memberapi/release/pathEvaluator?webp=true&falcor_server=0.1.0&withSize=true&materialize=true&original_path=${encodeURIComponent(`/shakti/${me.build}/pathEvaluator`)}`,
        headers,
        `authURL=${encodeURIComponent(me.authURL)}&path=${encodeURIComponent(JSON.stringify(path))}`
      );
      return json?.jsonGraph || null;
    } catch {
      return null;
    }
  }
  var value = (node) => node && typeof node === "object" && "value" in node ? node.value : node;
  var number = (node) => typeof value(node) === "number" ? value(node) : void 0;
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
  var shows = /* @__PURE__ */ new Map();
  async function showInfo(me, ids) {
    const fresh = ids.filter((id) => !shows.has(id));
    if (fresh.length) {
      const [years, genres] = await Promise.all([
        videoData(me, ["videos", fresh, ["releaseYear", "title"]]),
        videoData(me, ["videos", fresh, "genres", { from: 0, to: 19 }, "name"])
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
    const me = cached || await profile();
    const history = await historyPage(me, Number(page) || 0);
    const items = history.viewedItems.filter((item) => item && typeof item === "object");
    const ids = [...new Set(items.map((item) => item.movieID).filter(Number.isInteger))];
    const showIds = [...new Set(items.map((item) => Number.isInteger(item.series) ? item.series : item.movieID).filter(Number.isInteger))];
    const [progress, info] = await Promise.all([videoData(me, ["videos", ids, ["runtime", "bookmarkPosition"]]), showInfo(me, showIds)]);
    const viewedItems = items.map((item) => {
      const video = progress?.videos?.[item.movieID];
      const show = info[Number.isInteger(item.series) ? item.series : item.movieID];
      return {
        ...item,
        ...video ? { duration: number(video.runtime), bookmark: number(video.bookmarkPosition) } : {},
        showYear: show?.year ?? null,
        genres: show?.genres ?? null
      };
    });
    return { viewedItems, vhSize: history.vhSize, profileName: history.profileInfo?.profileName || "" };
  }
  async function genrePage(me, genreId, from) {
    const to = from + NETFLIX_CATALOG_PAGE - 1;
    const kindHint = genreId === NETFLIX_ANIME_MOVIES ? "movie" : "series";
    const graph = await videoData(me, ["genres", genreId, "az", { from, to }, "reference", ["title", "summary", "releaseYear", "type"]]);
    if (!graph) throw new Error("Netflix didn't return its anime list. Reload Netflix, pick your profile, then try again.");
    let parsed = parseNetflixGenrePage(graph, genreId, { kindHint });
    if (!parsed.items.length && parsed.ids.length) {
      const ids = parsed.ids.map(Number).filter(Number.isInteger);
      const detail = await videoData(me, ["videos", ids, ["title", "summary", "releaseYear", "type"]]);
      parsed = parseNetflixGenrePage({ genres: graph.genres, videos: { ...graph.videos || {}, ...detail?.videos || {} } }, genreId, { kindHint });
    }
    return parsed;
  }
  async function catalog() {
    const me = cached || await profile();
    if (!me.authURL) throw new Error("Netflix isn't ready in that tab. Open netflix.com, pick your profile, then try again.");
    const items = [];
    const seen = /* @__PURE__ */ new Set();
    for (const genreId of NETFLIX_GENRES) {
      for (let page = 0; page < NETFLIX_MAX_PAGES && items.length < CATALOG_MAX_ITEMS; page += 1) {
        const from = page * NETFLIX_CATALOG_PAGE;
        const parsed = await genrePage(me, genreId, from);
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
    const work = message?.type === "netflixProfile" ? profile().then(({ guid, name }) => ({ ok: true, guid, name })) : message?.type === "netflixActivity" ? activity(message.page).then((payload) => ({ ok: true, payload })) : message?.type === "netflixCatalog" ? catalog().then((payload) => ({ ok: true, payload })) : null;
    if (!work) return false;
    work.catch((error) => ({ ok: false, error: error?.message || "Netflix didn't answer." })).then(sendResponse);
    return true;
  });
})();
