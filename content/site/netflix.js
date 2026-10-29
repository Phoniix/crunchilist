(() => {
  // lib/match-engine.js
  var LANGUAGES = "English|Japanese|Korean|Chinese|Mandarin|Cantonese|Spanish|Castilian|Latin American Spanish|Latin American|European Spanish|Portuguese|Brazilian Portuguese|European Portuguese|French|German|Italian|Russian|Arabic|Hindi|Tamil|Telugu|Thai|Indonesian|Malay|Vietnamese|Turkish|Polish|Dutch|Swedish";
  var LANGUAGE_TAG = new RegExp(`\\s*\\((?:(?:${LANGUAGES})(?:\\s+(?:Dub|Dubbed|Sub|Subbed|Subtitled|Audio))?|(?:[\\w-]+\\s+)?(?:Dub|Dubbed|Sub|Subbed|Subtitled)|Uncut|Uncensored|Simulcast)\\)`, "gi");
  function looseKey(text2) {
    return String(text2 || "").normalize("NFKC").toLowerCase().replace(/[’‘`]/g, "'").normalize("NFKD").replace(new RegExp("\\p{M}", "gu"), "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }

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

  // lib/netflix-history.js
  var SEASON_PART = /^(?:season|part|volume|vol\.|chapter|book|series|collection|limited series|miniseries)\b/i;
  var text = (value, max = 200) => typeof value === "string" ? value.trim().slice(0, max) : "";
  var LIVE_ACTION_NAMES = new Set([
    "one piece",
    "cowboy bebop",
    "yu yu hakusho",
    "death note",
    "fullmetal alchemist",
    "bleach",
    "alice in borderland",
    "kakegurui",
    "erased",
    "kingdom",
    "city hunter",
    "rurouni kenshin",
    "tokyo ghoul",
    "parasyte",
    "ghost in the shell",
    "golden kamuy",
    "kaiji",
    "liar game",
    "gintama",
    "the promised neverland",
    "my happy marriage",
    "sakamoto days",
    "kaguya sama love is war",
    "assassination classroom",
    "blade of the immortal",
    "inuyashiki",
    "nana",
    "thermae romae"
  ].map((name) => looseKey(name)));
  function seasonNumberOf(season) {
    const match = /\bseason\s+(\d{1,3})\b/i.exec(season || "");
    return match ? Number(match[1]) : null;
  }
  function netflixInfo(item) {
    const year2 = Number.isInteger(item?.showYear) && item.showYear > 1900 ? item.showYear : null;
    const genres = Array.isArray(item?.genres) ? item.genres.filter((name) => typeof name === "string") : [];
    return { year: year2, anime: genres.length ? genres.some((name) => /anime/i.test(name)) : null };
  }
  var JUNK_TITLE = /^(netflix|home|browse|my list|title details|watch|loading|…|\.{3}|null|undefined)$/i;
  function usablePlayerSeries(name) {
    const series = text(name, 200);
    if (!series || JUNK_TITLE.test(series) || series.length < 2) return "";
    return series;
  }
  function splitPlayerTitle(title) {
    let line = text(title, 400).replace(/^\s*watch\s+/i, "").trim();
    if (!line || JUNK_TITLE.test(line)) return null;
    const parts = line.split(": ");
    const at = parts.findIndex((part, index) => index > 0 && SEASON_PART.test(part));
    if (at > 0) {
      const series2 = usablePlayerSeries(parts.slice(0, at).join(": "));
      if (!series2) return null;
      return {
        series: series2,
        season: parts[at],
        seasonNumber: seasonNumberOf(parts[at]),
        episode: parts.slice(at + 1).join(": ") || parts[at]
      };
    }
    if (parts.length >= 2) {
      const series2 = usablePlayerSeries(parts[0]);
      if (!series2) return null;
      return {
        series: series2,
        season: "",
        seasonNumber: null,
        episode: parts.slice(1).join(": ")
      };
    }
    const series = usablePlayerSeries(line);
    return series ? { series, season: "", seasonNumber: null, episode: "" } : null;
  }

  // lib/watch-tracking.js
  var FINISHED = 0.85;
  var REPEAT_MS = 6 * 60 * 60 * 1e3;

  // lib/watch-loop.js
  var START_SECONDS = 5;

  // content/sites/netflix.js
  if (window.__ksNetflixContent) {
    if (window.top === window) chrome.runtime.sendMessage({ type: "netflixHello" }).catch(() => {
    });
  } else {
    let netflixPlayer = function() {
      const videos = [...document.querySelectorAll("video")].filter((video) => Number.isFinite(video.duration) && video.duration > 60);
      return videos.sort((a, b) => (b.currentTime || 0) - (a.currentTime || 0) || b.duration - a.duration)[0] || null;
    }, pageLabels = function() {
      const meta = navigator.mediaSession?.metadata;
      const labels = [];
      const junk = /^(netflix|home|browse|my list|title details|watch|loading|…|\.{3})$/i;
      const clean = (value2) => {
        const text2 = String(value2 || "").replace(/\s+/g, " ").trim();
        return text2 && !junk.test(text2) ? text2 : "";
      };
      const show = clean(meta?.album || meta?.artist);
      const ep = clean(meta?.title);
      if (show && ep) labels.push(`${show}: ${ep}`);
      if (show) labels.push(show);
      const doc = clean(String(document.title || "").replace(/\s*[-–|]\s*Netflix\s*$/i, "").replace(/^\s*Watch\s+/i, ""));
      if (doc && doc !== ep) labels.push(doc);
      return [...new Set(labels)];
    }, askPage = function(kind, extra = {}, timeoutMs = PAGE_TIMEOUT_MS) {
      return new Promise((resolve) => {
        const id = Math.random().toString(36).slice(2);
        const timer = setTimeout(() => {
          removeEventListener("message", onReply);
          resolve(null);
        }, timeoutMs);
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
    }, genreNames = function(graph, video) {
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
    }, metaFromLabel = function(label, anime) {
      const split = splitPlayerTitle(label);
      if (!split?.series) return null;
      return {
        series: split.series,
        season: split.season || "",
        seasonNumber: split.seasonNumber ?? seasonNumberOf(split.season || ""),
        // Netflix doesn't expose a reliable episode number on the player — season progress is filled from activity later.
        episode: 1,
        anime,
        title: label
      };
    }, metaFromLabelList = function(labelList, anime = null) {
      const ordered = [
        ...labelList.filter((label) => label.includes(": ")),
        ...labelList.filter((label) => !label.includes(": "))
      ];
      for (const label of ordered) {
        const found = metaFromLabel(label, anime);
        if (found) return found;
      }
      return null;
    }, parentVideoId = function(node, graph) {
      const parent = node?.parent;
      if (parent?.$type === "ref" && Array.isArray(parent.value)) {
        const id = parent.value[parent.value.length - 1];
        if (Number.isInteger(id)) return id;
        const target = parent.value.reduce((next, key) => next?.[key], graph);
        const summary2 = value(target?.summary);
        if (Number.isInteger(summary2?.id)) return summary2.id;
      }
      const summary = value(node?.summary);
      if (Number.isInteger(summary?.id) && /^(show|series)$/i.test(String(summary?.type || ""))) return summary.id;
      return null;
    };
    window.__ksNetflixContent = true;
    const PAGE_SOURCE = "crunchilist-search-page";
    const PAGE_SIZE = 50;
    const CHECK_MS = 2e3;
    const PAGE_TIMEOUT_MS = 4e3;
    let cached = null;
    if (window.top === window) chrome.runtime.sendMessage({ type: "netflixHello" }).catch(() => {
    });
    const started = /* @__PURE__ */ new Set();
    const finished = /* @__PURE__ */ new Set();
    if (window.top === window) {
      setInterval(() => {
        const id = /^\/watch\/(\d+)/.exec(location.pathname)?.[1];
        if (!id) return;
        const video = netflixPlayer();
        if (!video) return;
        if (!started.has(id) && video.currentTime >= START_SECONDS) {
          started.add(id);
          chrome.runtime.sendMessage({ type: "netflixStarted", videoId: id, labels: pageLabels() }).catch(() => {
          });
        }
        if (!finished.has(id) && video.duration > 0 && video.currentTime / video.duration >= FINISHED) {
          finished.add(id);
          chrome.runtime.sendMessage({ type: "netflixWatched", videoId: id, labels: pageLabels() }).catch(() => {
          });
        }
      }, CHECK_MS);
    }
    async function askPageProfile() {
      const data = await askPage("profile-request", {}, 2e3);
      if (!data) return null;
      const text2 = (value2, max = 400) => String(value2 || "").slice(0, max);
      return {
        build: text2(data.build, 60),
        guid: text2(data.guid, 60),
        name: text2(data.name, 80),
        authURL: text2(data.authURL),
        esn: text2(data.esn, 120)
      };
    }
    async function profile() {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const found = await askPageProfile();
        if (found?.guid && found.build) {
          cached = found;
          return found;
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      throw new Error("Netflix isn't ready in that tab. Open netflix.com, pick your profile, then try again.");
    }
    const baseHeaders = (me) => ({
      "Content-Type": "application/x-www-form-urlencoded",
      "x-netflix.uiversion": me.build,
      "x-netflix.clienttype": "akira",
      "x-netflix.nq.stack": "prod",
      "x-netflix.esnprefix": "NFCDCH-LX-"
    });
    async function post(url, headers, body) {
      const viaPage = await askPage("fetch-request", { url, headers, body }, 12e3);
      if (viaPage) {
        if (viaPage.status === 401) throw new Error("Netflix asked you to sign in again. Reload Netflix, then continue the import.");
        if (!viaPage.ok) {
          cached = null;
          throw new Error(`Netflix didn't answer (${viaPage.status || 0}). Reload Netflix and try again, or use the file upload: netflix.com/viewingactivity, then Download all.`);
        }
        return viaPage.json;
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
    const value = (node) => node && typeof node === "object" && "value" in node ? node.value : node;
    const number = (node) => typeof value(node) === "number" ? value(node) : void 0;
    const shows = /* @__PURE__ */ new Map();
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
        title: String(episodeTitle || name).trim()
      };
    }
    async function watchNow(videoId, labels = []) {
      const id = Number(videoId);
      if (!Number.isInteger(id)) return null;
      const labelList = (Array.isArray(labels) ? labels : []).map((label) => String(label || "")).filter(Boolean);
      const me = cached || await profile().catch(() => null);
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
          seriesId: Number.isInteger(item.series) ? item.series : null
        });
      }
      const graph = await videoData(me, ["videos", id, ["title", "summary", "parent"]]);
      const video = graph?.videos?.[id];
      const episodeTitle = typeof value(video?.title) === "string" ? value(video.title).trim() : "";
      let seriesId = Number.isInteger(item?.series) ? item.series : parentVideoId(video, graph);
      if (!seriesId) {
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
            seriesId
          });
        }
      }
      return metaFromLabelList(labelList);
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
      if (sender.id && sender.id !== chrome.runtime.id || sender.tab) return false;
      if (message?.type === "netflixPing") {
        sendResponse({ ok: true, ping: true, hasProfile: Boolean(cached?.guid) });
        return false;
      }
      const work = message?.type === "netflixProfile" ? profile().then(({ guid, name }) => ({ ok: true, guid, name })) : message?.type === "netflixActivity" ? activity(message.page).then((payload) => ({ ok: true, payload })) : message?.type === "netflixWatchNow" ? watchNow(message.videoId, message.labels).then((payload) => ({ ok: true, payload })) : message?.type === "netflixCatalog" ? catalog().then((payload) => ({ ok: true, payload })) : null;
      if (!work) return false;
      work.catch((error) => ({ ok: false, error: error?.message || "Netflix didn't answer." })).then(sendResponse);
      return true;
    });
  }
})();
