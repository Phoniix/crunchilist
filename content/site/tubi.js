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
  var year = (value) => Number.isInteger(Number(value)) && Number(value) > 1900 && Number(value) < 2100 ? Number(value) : null;
  var HIDIVE_API = "https://dce-frontoffice.imggaming.com/";
  var GRID_PATH = `${HIDIVE_API}api/v1/view/content-grid?`;
  var TUBI_API = "https://tensor-cdn.production-public.tubi.io/";
  var TUBI_PAGE = 100;
  var TUBI_MAX_PAGES = 250;
  var tubiContainerUrl = (cursor = 0) => `${TUBI_API}api/v7/containers/anime?contents_limit=${TUBI_PAGE}&cursor=${Number(cursor) || 0}`;
  function parseTubiContainer(body) {
    const items = [];
    for (const raw of Object.values(body?.contents && typeof body.contents === "object" ? body.contents : {})) {
      const id = String(raw?.id || "");
      const title = cleanTitle(raw?.title);
      if (!/^\d+$/.test(id) || !title || !["s", "v"].includes(raw?.type)) continue;
      const series = raw.type === "s";
      items.push({ title, kind: series ? "series" : "movie", year: year(raw.year), url: `https://tubitv.com/${series ? "series" : "movies"}/${id}` });
    }
    const cursor = Number(body?.container?.cursor);
    return { items, cursor: Number.isInteger(cursor) && cursor > 0 ? cursor : null };
  }

  // lib/prime-history.js
  var ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  function decodeEntities(value) {
    return String(value || "").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
      if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? whole;
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return n > 0 && n < 1114112 ? String.fromCodePoint(n) : whole;
    });
  }

  // lib/watch-tracking.js
  var FINISHED = 0.85;
  var MIN_SECONDS = 300;
  var REPEAT_MS = 6 * 60 * 60 * 1e3;
  var text = (value, max = 200) => typeof value === "string" ? decodeEntities(value).replace(/\s+/g, " ").trim().slice(0, max) : "";
  var count = (value) => Number.isInteger(value) && value > 0 && value < 1e4 ? value : null;
  var TAGS = /\s*[([](?:english\s+)?(?:dubbed|dub|subtitled|subbed|sub|uncut|uncensored)[)\]]\s*$/i;
  var cleanSeries = (name) => text(name).replace(TAGS, "").replace(TAGS, "").replace(/[\s:–-]+$/, "").trim();
  var PATTERNS = [
    /^(.*?)[\s:,–-]*\bS(\d{1,3})\s*[:.]?\s*E(\d{1,4})\b\s*[:.–-]*\s*(.*)$/i,
    /^(.*?)[\s:,–-]*\bSeason\s+(\d{1,3})[\s:,–-]*(?:Episode|Ep\.?)\s*(\d{1,4})\b\s*[:.–-]*\s*(.*)$/i,
    /^(.*?)[\s:,–-]*\b()(?:Episode|Ep\.?)\s*(\d{1,4})\b\s*[:.–-]*\s*(.*)$/i
  ];
  function parseEpisodeLabel(label) {
    const line = text(label, 300);
    for (const pattern of PATTERNS) {
      const match = pattern.exec(line);
      if (!match) continue;
      const episode = count(Number(match[3]));
      if (!episode) continue;
      return { series: cleanSeries(match[1]), season: count(Number(match[2])), episode, title: text(match[4]) };
    }
    return null;
  }
  function metaContent(html, property) {
    for (const tag of String(html || "").match(/<meta\b[^>]*>/gi) || []) {
      if (!new RegExp(`(?:property|name)=["']${property}["']`, "i").test(tag)) continue;
      const content = /content=(["'])([\s\S]*?)\1/i.exec(tag);
      if (content) return text(content[2], 300);
    }
    return "";
  }
  function jsonLd(html) {
    const found = [];
    const add = (node) => {
      if (Array.isArray(node)) node.forEach(add);
      else if (node && typeof node === "object") {
        found.push(node);
        if (node["@graph"]) add(node["@graph"]);
      }
    };
    for (const match of String(html || "").matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        add(JSON.parse(match[1]));
      } catch {
      }
    }
    return found.slice(0, 50);
  }
  var typeIs = (node, type) => [].concat(node?.["@type"] || []).includes(type);
  var genres = (node) => [].concat(node?.genre || []).filter((genre) => typeof genre === "string");
  var animeFrom = (list) => list.length ? list.some((genre) => /\banime\b/i.test(genre)) : null;
  function tubiItem(html, path) {
    const id = /^\/(tv-shows|movies)\/(\d{1,12})\b/.exec(String(path || ""));
    if (!id) return null;
    const nodes = jsonLd(html);
    if (id[1] === "movies") {
      const movie = nodes.find((node) => typeIs(node, "Movie"));
      const name = cleanSeries(movie?.name || metaContent(html, "og:title"));
      return name ? { id: `movie:${id[2]}`, kind: "movie", series: name, season: null, episode: 1, title: "", anime: animeFrom(genres(movie)) } : null;
    }
    const episode = nodes.find((node) => typeIs(node, "TVEpisode"));
    const series = nodes.find((node) => typeIs(node, "TVSeries")) || episode?.partOfSeries;
    const label = parseEpisodeLabel(metaContent(html, "og:title")) || parseEpisodeLabel(`${series?.name || ""} ${episode?.name || ""}`);
    if (!label?.series) return null;
    return { id: `episode:${id[2]}`, kind: "episode", ...label, anime: animeFrom([...genres(episode), ...genres(series)]) };
  }

  // lib/watch-loop.js
  var CHECK_MS = 5e3;
  function mainVideo(doc = document) {
    const videos = [...doc.querySelectorAll("video")].filter((video) => Number.isFinite(video.duration) && video.duration >= MIN_SECONDS && video.played?.length);
    return videos.sort((a, b) => b.duration - a.duration)[0] || null;
  }
  function watchLoop(service, { place, identify }) {
    if (window.top !== window) return;
    const done = /* @__PURE__ */ new Set();
    let checking = false;
    setInterval(async () => {
      const id = place();
      if (!id || done.has(id) || checking) return;
      const video = mainVideo();
      if (!video || video.currentTime / video.duration < FINISHED) return;
      checking = true;
      done.add(id);
      try {
        const found = await identify(id);
        chrome.runtime.sendMessage({ type: "watched", service, ...found?.item ? { item: found.item } : { miss: String(found?.miss || "").slice(0, 200) } }).catch(() => {
        });
      } catch {
        chrome.runtime.sendMessage({ type: "watched", service, miss: "the page couldn't be read" }).catch(() => {
        });
      } finally {
        checking = false;
      }
    }, CHECK_MS);
  }

  // content/sites/tubi.js
  var PAGE_SOURCE = "crunchilist-search-page";
  if (window.top === window) chrome.runtime.sendMessage({ type: "tubiHello" }).catch(() => {
  });
  watchLoop("tubi", {
    place: () => /^\/(tv-shows|movies)\/\d+/.test(location.pathname) ? location.pathname : "",
    async identify(path) {
      const response = await fetch(path, { credentials: "include" });
      if (!response.ok) return { miss: `Tubi didn't answer (${response.status})` };
      const item = tubiItem(await response.text(), path);
      return item ? { item } : { miss: "Tubi's page didn't name the episode" };
    }
  });
  function askPage(url) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        removeEventListener("message", onReply);
        resolve(null);
      }, 2e4);
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
    catalog().then((payload) => ({ ok: true, payload }), (error) => ({ ok: false, error: error?.message || "Tubi didn't answer." })).then(sendResponse);
    return true;
  });
})();
