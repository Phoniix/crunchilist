(() => {
  // lib/text.js
  function uniqueStrings(values, max = 40) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const value of values || []) {
      const text2 = String(value || "").replace(/\s+/g, " ").trim();
      if (!text2 || text2.length > 48) continue;
      const key = text2.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(text2);
      if (out.length >= max) break;
    }
    return out;
  }
  function slugify(value) {
    return String(value || "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  }
  function numberOrNull(value) {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  // lib/page-model.js
  function seriesIdFromHref(href) {
    if (!href) return null;
    const path = String(href).split("?")[0].split("#")[0];
    const match = path.match(/\/series\/([A-Za-z0-9]+)(?:\/|$)/);
    return match ? match[1] : null;
  }
  function pageKindFromPath(pathname) {
    const parts = String(pathname || "").split("/").filter(Boolean);
    const seriesAt = parts.indexOf("series");
    const watchAt = parts.indexOf("watch");
    if (seriesAt >= 0) {
      return {
        kind: "series",
        seriesId: parts[seriesAt + 1] || null,
        slug: parts[seriesAt + 2] || null
      };
    }
    if (watchAt >= 0) {
      return { kind: "watch", seriesId: null, watchId: parts[watchAt + 1] || null };
    }
    return { kind: "browse", seriesId: null };
  }
  function crunchyrollSeriesUrl(seriesId, slug) {
    const suffix = slug ? `/${slug}` : "";
    return `https://www.crunchyroll.com/series/${seriesId}${suffix}`;
  }
  function asList(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.items)) return payload.items;
    if (payload.data && Array.isArray(payload.data.items)) return payload.data.items;
    if (payload.type === "episode" || payload.episode_metadata) return [payload];
    return [];
  }
  function parseCmsObjects(payload) {
    const episodes = [];
    for (const item of asList(payload)) {
      if (item?.type && item.type !== "episode" && !item.episode_metadata) continue;
      const meta = item?.episode_metadata || item;
      if (!meta?.series_id) continue;
      const seasonSlug = meta.season_slug_title || (meta.season_id ? `id-${meta.season_id}` : "");
      if (!seasonSlug) continue;
      episodes.push({
        episodeId: item.id || meta.id || null,
        episodeNumber: numberOrNull(meta.episode_number),
        seasonId: meta.season_id || null,
        seasonNumber: numberOrNull(meta.season_number),
        seasonTitle: meta.season_title || "",
        seasonSlug,
        seriesId: meta.series_id,
        seriesSlug: meta.series_slug_title || "",
        seriesTitle: meta.series_title || "",
        audioLocale: meta.audio_locale || "",
        isDubbed: Boolean(meta.is_dubbed)
      });
    }
    return episodes;
  }
  function parseCmsSeasons(payload) {
    const seasons = [];
    for (const item of asList(payload)) {
      if (!item?.series_id) continue;
      const seasonSlug = item.slug_title || (item.id ? `id-${item.id}` : "");
      if (!seasonSlug) continue;
      seasons.push({
        seasonId: item.id || null,
        title: item.title || "",
        seasonNumber: numberOrNull(item.season_number),
        seriesId: item.series_id,
        seasonSlug,
        episodeCount: numberOrNull(item.number_of_episodes)
      });
    }
    return seasons;
  }
  function episodeNumberFromLabel(text2) {
    if (!text2) return null;
    const match = String(text2).match(/\bE(\d+)\b/i);
    return match ? Number(match[1]) : null;
  }
  function episodeCountFromText(text2) {
    if (!text2) return null;
    const match = String(text2).match(/\b(\d+)\s+episodes?\b/i);
    return match ? Number(match[1]) : null;
  }
  function audioModeFromLocales(locales, dubbedFlags) {
    const values = (locales || []).map((locale) => String(locale || "").toLowerCase()).filter(Boolean);
    const japanese = values.some((locale) => locale.startsWith("ja"));
    const english = values.some((locale) => locale.startsWith("en"));
    if ((dubbedFlags || []).some(Boolean) && japanese) return "unknown";
    if ((dubbedFlags || []).some(Boolean) && !japanese) return "dub";
    if (japanese && english) return "unknown";
    if (japanese) return "sub";
    if (english) return "dub";
    return "unknown";
  }
  function inferAudioMode(audioText, subtitleText) {
    const audio = String(audioText || "");
    const subs = String(subtitleText || "");
    const audioLower = audio.toLowerCase();
    const dub = /\bdub(?:bed)?\b/.test(audioLower) || /\benglish\b/.test(audioLower) && !/\bjapanese\b/.test(audioLower);
    const sub = /\bsub(?:titled|titles)?\b/.test(audioLower) || /\bjapanese\b/.test(audioLower);
    let mode2 = "unknown";
    if (sub && dub) mode2 = "unknown";
    else if (dub) mode2 = "dub";
    else if (sub) mode2 = "sub";
    else if (/\benglish\b/.test(subs.toLowerCase()) && !audio) mode2 = "sub";
    return { mode: mode2, audioText: audio, subtitleText: subs };
  }
  function absoluteUrl(href, seriesId, slug) {
    if (href && /^https?:\/\//i.test(href)) return href.split("?")[0];
    if (href && href.startsWith("/")) return `https://www.crunchyroll.com${href.split("?")[0]}`;
    return crunchyrollSeriesUrl(seriesId, slug || "");
  }
  function dedupeAnchors(anchors) {
    const map = /* @__PURE__ */ new Map();
    for (const anchor of anchors || []) {
      const seriesId = anchor.seriesId || seriesIdFromHref(anchor.href);
      if (!seriesId) continue;
      const title = String(anchor.title || "").replace(/\s+/g, " ").trim();
      const previous = map.get(seriesId);
      if (!previous) {
        map.set(seriesId, {
          seriesId,
          title: title.slice(0, 140),
          href: anchor.href || "",
          url: absoluteUrl(anchor.href, seriesId, "")
        });
      } else if (!previous.title && title) {
        previous.title = title.slice(0, 140);
      }
    }
    return [...map.values()];
  }
  function buildObservation(facts) {
    const kindInfo = facts.kindInfo || pageKindFromPath(facts.pathname || "");
    const kind = facts.kind || kindInfo.kind || "browse";
    const cmsSeriesId = facts.cmsEpisodes?.find((episode) => episode.seriesId)?.seriesId || facts.cmsSeasons?.find((season) => season.seriesId)?.seriesId || null;
    const seriesId = facts.seriesId || kindInfo.seriesId || (kind === "watch" ? cmsSeriesId : null);
    const inferred = inferAudioMode(facts.audioText, facts.subtitleText);
    const locales = (facts.cmsEpisodes || []).map((episode) => episode.audioLocale);
    const cmsAudio = audioModeFromLocales(locales, (facts.cmsEpisodes || []).map((episode) => episode.isDubbed));
    const audio = inferred.mode !== "unknown" ? inferred.mode : cmsAudio;
    const pageGenres = uniqueStrings(facts.genres || []);
    const seasons = [];
    const seasonIndex = /* @__PURE__ */ new Map();
    function addSeason(partial) {
      if (!partial.seriesId || !partial.seasonSlug) return null;
      const key = `${partial.seriesId}|${partial.seasonSlug}`;
      let row = seasonIndex.get(key);
      if (!row) {
        row = {
          seriesId: partial.seriesId,
          seasonSlug: partial.seasonSlug,
          seasonId: null,
          seasonNumber: null,
          seasonTitle: "",
          seriesTitle: "",
          seriesSlug: "",
          episodeCount: null,
          url: "",
          audio,
          subtitles: facts.subtitleText || "",
          genres: [],
          watchingEpisode: null,
          movieSignal: Boolean(facts.movieSignal)
        };
        seasonIndex.set(key, row);
        seasons.push(row);
      }
      if (partial.seasonId) row.seasonId = partial.seasonId;
      if (partial.seasonNumber != null) row.seasonNumber = partial.seasonNumber;
      if (partial.seasonTitle) row.seasonTitle = partial.seasonTitle;
      if (partial.seriesTitle) row.seriesTitle = partial.seriesTitle;
      if (partial.seriesSlug) row.seriesSlug = partial.seriesSlug;
      if (partial.episodeCount != null) row.episodeCount = partial.episodeCount;
      if (partial.watchingEpisode != null) row.watchingEpisode = partial.watchingEpisode;
      row.audio = audio;
      row.url = crunchyrollSeriesUrl(row.seriesId, row.seriesSlug);
      if (partial.seriesId === seriesId) row.genres = pageGenres.slice();
      return row;
    }
    for (const season of facts.cmsSeasons || []) addSeason({
      seriesId: season.seriesId,
      seasonSlug: season.seasonSlug,
      seasonId: season.seasonId,
      seasonNumber: season.seasonNumber,
      seasonTitle: season.title,
      episodeCount: season.episodeCount,
      seriesTitle: facts.seriesTitle || "",
      seriesSlug: kindInfo.slug || ""
    });
    for (const episode of facts.cmsEpisodes || []) {
      addSeason({
        seriesId: episode.seriesId,
        seasonSlug: episode.seasonSlug,
        seasonId: episode.seasonId,
        seasonNumber: episode.seasonNumber,
        seasonTitle: episode.seasonTitle,
        seriesTitle: episode.seriesTitle,
        seriesSlug: episode.seriesSlug
      });
      if (kind === "watch" && facts.watchId && episode.episodeId === facts.watchId && episode.episodeNumber != null) {
        addSeason({
          seriesId: episode.seriesId,
          seasonSlug: episode.seasonSlug,
          watchingEpisode: episode.episodeNumber
        });
      }
    }
    if ((kind === "series" || kind === "watch") && !seasons.length && seriesId && (facts.seriesTitle || facts.activeSeasonTitle)) {
      addSeason({
        seriesId,
        seasonSlug: `dom-${slugify(facts.activeSeasonTitle || "season") || "season"}`,
        seasonTitle: facts.activeSeasonTitle || "",
        seriesTitle: facts.seriesTitle || "",
        seriesSlug: kindInfo.slug || "",
        episodeCount: facts.domEpisodeCount ?? null
      });
    }
    if (seasons.length === 1 && facts.domEpisodeCount != null && seasons[0].episodeCount == null) {
      seasons[0].episodeCount = facts.domEpisodeCount;
    }
    if (kind === "watch" && facts.domEpisodeNumber != null && seasons.length === 1 && seasons[0].watchingEpisode == null) {
      seasons[0].watchingEpisode = facts.domEpisodeNumber;
    }
    const sightings = dedupeAnchors(facts.anchors).map((anchor) => ({
      seriesId: anchor.seriesId,
      title: anchor.title,
      url: anchor.url,
      genres: anchor.seriesId === seriesId ? pageGenres.slice() : [],
      audio: anchor.seriesId === seriesId ? audio : "unknown"
    }));
    if (seriesId && (kind === "series" || kind === "watch") && !sightings.some((item) => item.seriesId === seriesId)) {
      const title = facts.seriesTitle || seasons.find((season) => season.seriesId === seriesId)?.seriesTitle || "";
      sightings.push({
        seriesId,
        title,
        url: crunchyrollSeriesUrl(seriesId, kindInfo.slug || seasons[0]?.seriesSlug || ""),
        genres: pageGenres.slice(),
        audio
      });
    }
    let currentKey = null;
    const ownSeasons = seriesId ? seasons.filter((season) => season.seriesId === seriesId) : seasons;
    if (facts.activeSeasonTitle) {
      const wantSlug = slugify(facts.activeSeasonTitle);
      const wantText = facts.activeSeasonTitle.trim().toLowerCase();
      const found = ownSeasons.find((season) => {
        const title = (season.seasonTitle || "").trim().toLowerCase();
        const loose = wantText.length >= 4 && title && (title.includes(wantText) || wantText.includes(title));
        return slugify(season.seasonTitle) === wantSlug || season.seasonSlug === wantSlug || season.seasonSlug === `dom-${wantSlug}` || loose;
      });
      if (found) currentKey = `${found.seriesId}|${found.seasonSlug}`;
    }
    if (!currentKey) {
      const watching = seasons.find((season) => season.watchingEpisode != null);
      if (watching) currentKey = `${watching.seriesId}|${watching.seasonSlug}`;
    }
    if (!currentKey && ownSeasons.length === 1) currentKey = `${ownSeasons[0].seriesId}|${ownSeasons[0].seasonSlug}`;
    if (!currentKey && kind === "watch" && seasons[0]) currentKey = `${seasons[0].seriesId}|${seasons[0].seasonSlug}`;
    return {
      kind,
      url: facts.pageUrl || "",
      seriesId,
      watchId: facts.watchId || kindInfo.watchId || null,
      seasons,
      sightings,
      currentKey,
      audio
    };
  }

  // content/badges.js
  var BADGE_TEXT = {
    finished: "Watched",
    in_progress: "In progress",
    dropped: "Dropped",
    plan: "Plan",
    unwatched: "Unwatched"
  };
  var ROUNDED = '"Crunchilist Rounded", "Trebuchet MS", Candara, sans-serif';
  function ensureBadgeFont(doc) {
    if (doc.getElementById("cr-corner-font")) return;
    let url = "";
    try {
      url = chrome.runtime.getURL("fonts/nunito-latin.woff2");
    } catch {
      return;
    }
    try {
      const style = doc.createElement("style");
      style.id = "cr-corner-font";
      style.textContent = `@font-face{font-family:"Crunchilist Rounded";src:url("${url}") format("woff2");font-weight:600 700;font-style:normal;font-display:swap;}`;
      (doc.head || doc.documentElement).append(style);
    } catch {
    }
  }
  function badgeStyle(mark) {
    const common = `display:inline-block;margin:0 6px 4px 0;padding:2px 8px;border-radius:999px;font:700 12px/1.35 ${ROUNDED};letter-spacing:.01em;vertical-align:middle;pointer-events:none;position:relative;z-index:1;`;
    if (mark === "finished") return `${common}background:#f47521;color:#1a0d05;`;
    if (mark === "in_progress") return `${common}background:#f5c16c;color:#1a0d05;`;
    if (mark === "dropped") return `${common}background:#5c3030;color:#ffd5d5;`;
    if (mark === "plan") return `${common}background:#24384a;color:#d7e8f8;`;
    return `${common}background:transparent;color:#d0d0d0;border:1px solid #8a8a8a;`;
  }
  function seriesIdsIn(element) {
    const ids = /* @__PURE__ */ new Set();
    element.querySelectorAll('a[href*="/series/"]').forEach((anchor) => {
      const id = seriesIdFromHref(anchor.getAttribute("href") || "");
      if (id) ids.add(id);
    });
    return ids;
  }
  function cardRoot(anchor) {
    let node = anchor;
    for (let depth = 0; depth < 5 && node.parentElement && node.parentElement !== document.body; depth += 1) {
      const parent = node.parentElement;
      if (parent.closest("header, nav, footer")) break;
      if (seriesIdsIn(parent).size > 1) break;
      node = parent;
    }
    return node;
  }
  function applyBadges(doc, marks, hideWatched) {
    ensureBadgeFont(doc);
    const used = /* @__PURE__ */ new Set();
    doc.querySelectorAll('a[href*="/series/"]').forEach((anchor) => {
      try {
        if (anchor.closest("#cr-corner-host, header, nav, footer")) return;
        const seriesId = seriesIdFromHref(anchor.getAttribute("href") || "");
        if (!seriesId) return;
        const root = cardRoot(anchor);
        if (used.has(root)) return;
        used.add(root);
        const decision = marks?.[seriesId] || { mark: "unwatched", hide: false };
        const mark = decision.mark || "unwatched";
        let badge = [...root.children].find((child) => child.dataset?.crCornerBadge);
        if (!badge) {
          badge = doc.createElement("span");
          root.prepend(badge);
        }
        if (badge.dataset.crCornerBadge !== mark) {
          badge.dataset.crCornerBadge = mark;
          badge.textContent = BADGE_TEXT[mark] || BADGE_TEXT.unwatched;
          badge.style.cssText = badgeStyle(mark);
        }
        const shouldHide = Boolean(hideWatched && decision.hide);
        if (shouldHide && root.dataset.crCornerHidden !== "1") {
          root.dataset.crCornerPrevDisplay = root.style.display || "";
          root.dataset.crCornerHidden = "1";
          root.style.display = "none";
        } else if (!shouldHide && root.dataset.crCornerHidden === "1") {
          root.style.display = root.dataset.crCornerPrevDisplay || "";
          delete root.dataset.crCornerHidden;
          delete root.dataset.crCornerPrevDisplay;
        }
      } catch {
      }
    });
    doc.querySelectorAll("[data-cr-corner-badge]").forEach((badge) => {
      if (!used.has(badge.parentElement)) badge.remove();
    });
  }

  // lib/taste.js
  function filterTagSuggestions(query2, options, exclude, limit = 8) {
    const needle = String(query2 || "").trim().toLowerCase();
    if (!needle) return [];
    const skip = new Set((exclude || []).map((item) => String(item).toLowerCase()));
    const starts = [];
    const contains = [];
    for (const option of options || []) {
      const key = String(option).toLowerCase();
      if (skip.has(key)) continue;
      if (key.startsWith(needle)) starts.push(option);
      else if (key.includes(needle)) contains.push(option);
    }
    return [...starts, ...contains].slice(0, limit);
  }

  // content/panel.js
  var CORNERS = ["bottom-right", "bottom-left", "top-left", "top-right"];
  var ROUNDED2 = '"Crunchilist Rounded", "Trebuchet MS", Candara, sans-serif';
  function roundedFontFace() {
    let url = "/fonts/nunito-latin.woff2";
    try {
      if (globalThis.chrome?.runtime?.getURL) url = chrome.runtime.getURL("fonts/nunito-latin.woff2");
    } catch {
      url = "/fonts/nunito-latin.woff2";
    }
    return `@font-face{font-family:"Crunchilist Rounded";src:url("${url}") format("woff2");font-weight:400 700;font-style:normal;font-display:swap;}`;
  }
  var CSS = `
  :host { color-scheme: dark; pointer-events: none; font: 400 15px/1.4 ${ROUNDED2}; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  button, input, select, a, summary, label { font-family: inherit; }
  .launcher {
    width: 56px; height: 56px; border: 0; border-radius: 18px; cursor: pointer;
    background: #ff7a2f; color: #1a0d05;
    font: 700 14px/1 ${ROUNDED2};
    box-shadow: 0 10px 28px rgba(0,0,0,.4);
  }
  .launcher:hover { background: #ff8b4a; }
  .launcher, .backdrop, .panel, .drawer { pointer-events: auto; }
  .launcher { position: relative; z-index: 2; }
  .launcher.is-locked { cursor: progress; }
  .launcher.is-locked::after {
    content: "";
    position: absolute; inset: -5px; border-radius: 22px;
    border: 1.5px solid rgba(255, 247, 237, .18);
    border-top-color: #f7f2eb;
    animation: gather-spin .9s linear infinite;
  }
  :host(.fullscreen) .launcher.is-locked::after { display: none; }
  .gather {
    display: flex; align-items: center; gap: 10px; max-width: 240px;
    margin: 0 0 10px; padding: 10px 14px; pointer-events: none;
    background: #161310; color: #f7f2eb;
    border: 1px solid rgba(255, 226, 196, .16); border-radius: 16px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, .45);
    font: 600 13px/1.35 ${ROUNDED2};
  }
  .gather[hidden] { display: none !important; }
  .gather-spin {
    width: 16px; height: 16px; flex: none; border-radius: 50%;
    border: 1.5px solid rgba(255, 226, 196, .22);
    border-top-color: #f7f2eb;
    animation: gather-spin .9s linear infinite;
  }
  @keyframes gather-spin { to { transform: rotate(360deg); } }
  .backdrop {
    position: fixed; inset: 0; z-index: 1;
    border: 0; padding: 0; margin: 0;
    background: rgba(8, 6, 4, .55);
    display: none; cursor: pointer;
  }
  .backdrop.is-open { display: block; }
  .launcher:focus-visible, .panel button:focus-visible, .panel a:focus-visible, .panel select:focus-visible, .panel summary:focus-visible, .drawer button:focus-visible, .drawer a:focus-visible, .drawer select:focus-visible, .drawer summary:focus-visible {
    outline: 2px solid #ff8a3d; outline-offset: 2px;
  }
  input:focus, input:focus-visible { outline: none; }
  * {
    scrollbar-width: thin;
    scrollbar-color: #2c2622 transparent;
  }
  *::-webkit-scrollbar { width: 10px; height: 10px; }
  *::-webkit-scrollbar-track { background: transparent; }
  *::-webkit-scrollbar-thumb {
    background: #2c2622;
    border-radius: 999px;
    border: 3px solid transparent;
    background-clip: padding-box;
  }
  *::-webkit-scrollbar-corner { background: transparent; }
  :host(.fullscreen) .launcher {
    width: 14px; height: 64px; border-radius: 8px 0 0 8px; font-size: 0; box-shadow: none;
  }
  :host(.fullscreen) .panel, :host(.fullscreen) .backdrop { display: none; }
  .backdrop.is-open { backdrop-filter: blur(6px); background: rgba(0, 0, 0, .5); }
  .panel {
    position: fixed; z-index: 2;
    left: 50%; top: 12vh; transform: translateX(-50%);
    width: min(560px, calc(100vw - 32px));
    max-height: min(68vh, 640px);
    display: none;
    flex-direction: column;
    overflow: hidden;
    margin: 0;
    border-radius: 28px;
    background: #161310;
    color: #f7f2eb;
    font: 400 15px/1.4 ${ROUNDED2};
    border: 1px solid rgba(255, 226, 196, .16);
    box-shadow: 0 30px 80px rgba(0, 0, 0, .55);
  }
  .panel.is-open { display: flex; }
  .chip.is-on { background: #ff7a2f; color: #1a0d05; }
  .ghost, .chip, .quiet, .primary {
    border: 0; background: transparent; color: #cbbfb4; border-radius: 999px;
    min-height: 32px; padding: 4px 12px; cursor: pointer; flex: none;
  }
  .ghost:hover, .quiet:hover, .chip:hover { background: rgba(255,255,255,.06); color: #f6f1ea; }
  .primary { background: #ff7a2f; color: #1a0d05; font-weight: 700; }
  .primary:hover { background: #ff8b4a; }
  .icon-close, .icon-btn {
    width: 36px; height: 36px; min-height: 36px; padding: 0; flex: none;
    border-radius: 12px; background: transparent; color: #cbbfb4;
    display: grid; place-items: center;
  }
  .icon-close:hover, .icon-btn:hover { background: rgba(255, 226, 196, .08); color: #f7f2eb; }
  .icon-btn.is-on {
    color: #f7f2eb;
    background: rgba(255, 226, 196, .08);
    box-shadow: inset 0 0 0 1px rgba(255, 226, 196, .22);
  }
  .icon-btn svg, .icon-close svg { width: 18px; height: 18px; display: block; }
  .account-icon.is-connected {
    color: #f7f2eb;
    box-shadow: inset 0 0 0 1px rgba(255, 226, 196, .28);
  }
  .account-icon.is-connected:hover { background: rgba(255, 226, 196, .08); }
  .account-icon .mark {
    width: auto; height: auto; background: transparent; box-shadow: none;
    font: 700 13px/1 ${ROUNDED2}; color: inherit;
  }
  .account-icon svg[hidden], .account-icon .mark[hidden] { display: none !important; }
  .drawer {
    position: fixed; z-index: 2;
    display: none; flex-direction: column; gap: 4px;
    overflow: auto; padding: 16px 16px 18px;
    border-radius: 28px; background: #161310; color: #f7f2eb;
    font: 400 15px/1.4 ${ROUNDED2};
    border: 1px solid rgba(255, 226, 196, .16);
    box-shadow: 0 30px 80px rgba(0, 0, 0, .55);
  }
  .drawer.is-open { display: flex; }
  .drawer-title { margin: 2px 2px 8px; font: 700 16px/1.2 ${ROUNDED2}; }
  .drawer > .quiet { margin: 8px 8px 0 0; background: #241f1b; border: 1px solid rgba(255, 226, 196, .1); color: #f7f2eb; }
  .topbar {
    display: flex; justify-content: flex-end; align-items: center; gap: 2px;
    flex: none; padding: 8px 10px 0;
  }
  .body { overflow: auto; flex: 1; min-height: 0; padding: 8px 14px; }
  .account {
    display: grid; grid-template-columns: 28px 1fr auto; gap: 10px; align-items: center;
    margin-top: 12px; padding: 10px 12px;
    background: #241f1b; border: 1px solid rgba(255, 226, 196, .1); border-radius: 16px;
  }
  .mark {
    width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center;
    background: transparent; color: #f7f2eb; font: 700 13px/1 ${ROUNDED2};
    box-shadow: inset 0 0 0 1px rgba(255, 226, 196, .28);
  }
  .account-name, .account-meta, .context, .forme, .note, .reason { margin: 0; }
  .account-name { font: 700 14px/1.2 ${ROUNDED2}; }
  .account-meta, .context, .note, .reason { color: #cbbfb4; }
  .account-meta { font: 600 12px/1.3 ${ROUNDED2}; }
  .note, .reason { font-size: 13px; }
  .public { display: flex; gap: 8px; margin-top: 8px; }
  .public[hidden] { display: none; }
  .public input { flex: 1; }
  .context { margin-top: 12px; }
  .forme, .refine { margin-top: 8px; }
  .season { display: flex; flex-direction: column; align-items: stretch; gap: 8px; margin-top: 12px; }
  .season-line { display: flex; align-items: center; gap: 8px; }
  .season-label { color: #a89b90; font-size: 13px; }
  .season select { flex: 1; min-width: 0; }
  .toolbar { display: flex; align-items: center; gap: 8px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; }
  .chip { background: #241f1b; color: #f7f2eb; font-size: 13px; border: 1px solid rgba(255, 226, 196, .16); }
  .check {
    display: flex; flex-direction: row; align-items: center; gap: 6px;
    margin: 0; padding: 6px 10px; color: #f7f2eb; cursor: pointer; font-size: 13px; flex: none;
    background: #241f1b; border: 1px solid rgba(255, 226, 196, .16); border-radius: 999px;
  }
  .body > .note {
    position: relative; overflow: hidden;
    margin-top: 12px; padding: 8px 12px;
    background: #201b17; border-radius: 12px; color: #e6d9cc;
  }
  .note-fill {
    position: absolute; left: 0; top: 0; bottom: 0; width: 0;
    background: rgba(255, 226, 196, .16);
    transition: width .35s ease;
  }
  .note.is-wait .note-fill {
    width: 38%;
    animation: note-slide 1.15s ease-in-out infinite;
  }
  .note.is-under .note-fill {
    top: auto; height: 3px;
    background: rgba(255, 226, 196, .55);
  }
  .note.is-under.is-wait .note-fill { height: 3px; }
  @keyframes note-slide {
    from { transform: translateX(-120%); }
    to { transform: translateX(320%); }
  }
  .note-text { position: relative; z-index: 1; }
  .results { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
  .rail-title { margin: 6px 0 8px; font: 700 15px/1.2 ${ROUNDED2}; }
  .rail { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; }
  .poster { width: 112px; flex: none; display: flex; flex-direction: column; gap: 6px; }
  .poster-link { display: flex; flex-direction: column; gap: 6px; color: #f7f2eb; text-decoration: none; }
  .poster img, .poster-fallback {
    width: 112px; height: 158px; object-fit: cover; border-radius: 12px; background: #2a241f; display: block;
  }
  .poster-fallback { display: grid; place-items: center; color: #ff8a3d; font: 700 28px/1 ${ROUNDED2}; }
  .poster-title { font: 700 13px/1.25 ${ROUNDED2}; }
  .poster select { width: 100%; max-width: none; font-size: 12px; padding: 4px 6px; }
  .card {
    position: relative; overflow: hidden;
    display: flex; gap: 12px; align-items: flex-start;
    padding: 10px 12px;
    background: #241f1b; border: 1px solid rgba(255, 226, 196, .1); border-radius: 16px;
  }
  .card-fill {
    position: absolute; left: 0; top: 0; bottom: 0; width: var(--fill, 0%);
    background: rgba(255, 226, 196, .16);
    pointer-events: none;
  }
  .card > :not(.card-fill) { position: relative; z-index: 1; }
  .card-body { flex: 1; min-width: 0; }
  .rank { flex: none; color: #f7f2eb; font: 700 18px/1 ${ROUNDED2}; }
  .fit { flex: none; color: #cbbfb4; font: 700 12px/1 ${ROUNDED2}; }
  .mention-title { margin-top: 16px; }
  .thumb, .thumb-fallback {
    width: 48px; height: 68px; flex: none; object-fit: cover; border-radius: 10px; background: #2a241f; display: block;
  }
  .thumb-fallback { display: grid; place-items: center; color: #cbbfb4; font: 700 16px/1 ${ROUNDED2}; }
  .card-top { display: flex; align-items: center; gap: 12px; }
  .card a { flex: 1; min-width: 0; color: #f6f1ea; font-weight: 700; font-size: 16px; text-decoration: none; }
  .card a:hover { color: #ff8a3d; }
  .reason { margin-top: 4px; line-height: 1.45; }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
  .tag, .token {
    border-radius: 999px; padding: 3px 8px; background: #3a312a; color: #f7f2eb;
    font: 700 12px/1.3 ${ROUNDED2};
  }
  .token { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; border: 0; }
  .token:hover { background: rgba(255,255,255,.1); }
  .token-x { color: #cbbfb4; font-size: 14px; line-height: 1; }
  .field-hint { color: #cbbfb4; font: 600 12px/1.35 ${ROUNDED2}; }
  .taste-field { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; }
  .suggest { position: relative; }
  .suggest-list {
    position: absolute; z-index: 3; left: 0; right: 0; top: calc(100% + 4px);
    display: flex; flex-direction: column; gap: 2px;
    margin: 0; padding: 4px; max-height: 180px; overflow: auto;
    background: #241f1b; border: 1px solid rgba(255, 226, 196, .16); border-radius: 12px;
  }
  .suggest-list[hidden] { display: none !important; }
  .suggest-list button {
    width: 100%; text-align: left; border: 0; background: transparent; color: #f7f2eb;
    border-radius: 8px; padding: 6px 8px; cursor: pointer;
  }
  .suggest-list button.is-on, .suggest-list button:hover { background: rgba(255, 226, 196, .08); }
  .card select { width: auto; max-width: 46%; margin: 0; }
  label { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
  input, select {
    background: #100e0c; color: #f7f2eb; border: 1px solid rgba(255, 226, 196, .18);
    border-radius: 12px; padding: 8px 12px;
  }
  .chat {
    position: relative;
    display: flex; align-items: center; gap: 8px; flex: none;
    margin: 0 14px 14px; padding: 4px 16px;
    background: #100e0c; border: 0; border-radius: 18px;
  }
  .ai-switch {
    height: 28px; min-height: 28px; padding: 0 10px; margin-right: -8px;
    border: 0; border-radius: 999px; background: transparent; cursor: pointer;
    color: #8f8278; font: 700 12px/1 ${ROUNDED2}; letter-spacing: .04em;
  }
  .ai-switch.is-on {
    color: #f7f2eb;
    background: rgba(255, 226, 196, .06);
    box-shadow: inset 0 0 0 1px rgba(255, 226, 196, .28);
  }
  .ai-switch:hover { color: #f7f2eb; }
  .ai-dot {
    display: inline-block; width: 6px; height: 6px; margin-left: 6px; border-radius: 50%;
    vertical-align: middle; box-shadow: inset 0 0 0 1px #8f8278;
  }
  .ai-dot.is-online { background: #ffe2c4; box-shadow: none; }
  .ai-dot.is-unknown { background: #ff7a2f; box-shadow: none; opacity: .8; }
  .model-state { margin-left: 6px; font-weight: 700; color: #8f8278; }
  .model-state.is-online { color: #f7f2eb; }
  .model-state.is-unknown { color: #ff9a5c; }
  .model-detail { display: block; margin-top: 2px; color: #a8988c; font-size: 12px; }
  .search-drop {
    position: absolute; z-index: 4; left: 0; right: 0; bottom: calc(100% + 8px);
    display: flex; flex-direction: column; gap: 2px;
    margin: 0; padding: 6px; max-height: 320px; overflow: auto;
    background: #241f1b; border: 1px solid rgba(255, 226, 196, .16); border-radius: 16px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, .45);
  }
  .search-drop[hidden] { display: none !important; }
  .search-drop a {
    display: flex; flex-direction: row; align-items: center; gap: 10px;
    padding: 6px 8px; border-radius: 10px;
    color: #f7f2eb; text-decoration: none;
  }
  .search-drop a.is-on, .search-drop a:hover { background: rgba(255, 226, 196, .08); }
  .search-drop .thumb, .search-drop .thumb-fallback { width: 36px; height: 50px; border-radius: 8px; font-size: 14px; }
  .drop-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .drop-title { font: 700 14px/1.25 ${ROUNDED2}; }
  .drop-reason { color: #cbbfb4; font: 600 12px/1.3 ${ROUNDED2}; }
  .chat input {
    flex: 1; height: 48px; border: 0; background: transparent;
    border-radius: 0; padding: 0; font-size: 18px; font-weight: 700;
  }
  .chat input::placeholder { color: #a8988c; font-weight: 650; }
  details { margin-top: 8px; }
  summary {
    cursor: pointer; list-style: none; padding: 10px 12px;
    color: #f7f2eb; background: #241f1b; border-radius: 12px;
    border: 1px solid rgba(255, 226, 196, .1);
  }
  summary::-webkit-details-marker { display: none; }
  .row, .reveal { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .row { margin-top: 10px; }
  .reveal { flex-wrap: nowrap; }
  .reveal input { flex: 1; min-width: 0; }
  .tokens { display: flex; flex-wrap: wrap; gap: 4px; }
  .empty { padding: 28px 0; text-align: center; }
`;
  function icon(parts) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.6");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    for (const [tag, attrs] of parts) {
      const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      svg.append(node);
    }
    return svg;
  }
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children) if (child) node.append(child);
    return node;
  }
  function fillSelect(select, value) {
    const options = [
      ["", "Set status"],
      ["finished", "Finished"],
      ["in_progress", "In progress"],
      ["dropped", "Dropped"],
      ["plan", "Plan to watch"],
      ["clear", "Clear"]
    ];
    select.replaceChildren();
    for (const [optionValue, label] of options) {
      select.append(el("option", { value: optionValue, text: label }));
    }
    select.value = value || "";
  }
  function createPanel(doc, handlers) {
    const host = doc.createElement("div");
    host.id = "cr-corner-host";
    host.dataset.corner = "bottom-right";
    const shadow = host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = roundedFontFace() + CSS;
    const backdrop = el("button", { class: "backdrop", type: "button", "aria-label": "Close Crunchilist" });
    const launcher = el("button", {
      class: "launcher",
      type: "button",
      "aria-expanded": "false",
      "aria-controls": "cr-corner-panel",
      text: "Find"
    });
    launcher.title = "Open Crunchilist";
    const gatherText = el("span", { class: "gather-text", text: "Gathering the Crunchyroll list" });
    const gather = el("div", { class: "gather", hidden: true }, [
      el("span", { class: "gather-spin", "aria-hidden": "true" }),
      gatherText
    ]);
    const panel2 = el("section", { class: "panel", id: "cr-corner-panel", role: "dialog", "aria-label": "Crunchilist" });
    panel2.hidden = true;
    const drawer = el("section", { class: "drawer", role: "dialog", "aria-label": "Settings" });
    drawer.hidden = true;
    shadow.append(style, backdrop, launcher, gather, panel2, drawer);
    const cornerButton = el("button", { class: "quiet", type: "button", text: "Move button", "aria-label": "Move Crunchilist to the next corner" });
    const refreshCovers = el("button", {
      class: "quiet",
      type: "button",
      text: "Refresh catalog",
      title: "Update Crunchyroll titles, AniList matches, and Chrome's model"
    });
    const closeButton = el("button", { class: "ghost icon-close", type: "button", "aria-label": "Minimize Crunchilist" }, [
      icon([["path", { d: "M7 7l10 10M17 7L7 17" }]])
    ]);
    const accountMark = el("span", { class: "mark", text: "A", hidden: true });
    const accountIcon = el("button", {
      class: "icon-btn account-icon",
      type: "button",
      "aria-label": "Sign in to AniList",
      "aria-expanded": "false",
      title: "Sign in to AniList"
    }, [
      icon([
        ["circle", { cx: "12", cy: "8", r: "3.25" }],
        ["path", { d: "M5.75 19.25a6.5 6.5 0 0 1 12.5 0" }]
      ]),
      accountMark
    ]);
    const settingsButton = el("button", {
      class: "icon-btn",
      type: "button",
      "aria-label": "Settings",
      "aria-expanded": "false",
      title: "Settings"
    }, [
      icon([
        ["circle", { cx: "12", cy: "12", r: "3" }],
        ["path", { d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" }]
      ])
    ]);
    const accountName = el("p", { class: "account-name", text: "Not connected" });
    const accountMeta = el("p", { class: "account-meta", text: "Connect AniList to write marks back." });
    const accountButton = el("button", { class: "primary", type: "button", text: "Set up" });
    const account = el("div", { class: "account" }, [
      accountMark,
      el("div", {}, [accountName, accountMeta]),
      accountButton
    ]);
    const userInput = el("input", { type: "text", "aria-label": "AniList username", placeholder: "Public AniList username" });
    const importButton = el("button", { class: "quiet", type: "button", text: "Import" });
    const publicRow = el("form", { class: "public" }, [userInput, importButton]);
    const context = el("p", { class: "context", text: "Looking at this page." });
    const forMe = el("p", { class: "forme" });
    forMe.hidden = true;
    const refineButton = el("button", { class: "quiet refine", type: "button", text: "Refine with AI" });
    refineButton.hidden = true;
    const currentLabel = el("span", { class: "season-label", text: "This season" });
    const currentStatus = el("select", { "aria-label": "Status for the open season" });
    fillSelect(currentStatus, "");
    const progressButton = el("button", { class: "quiet", type: "button", text: "Update AniList" });
    progressButton.hidden = true;
    const currentRow = el("div", { class: "season" }, [
      el("div", { class: "season-line" }, [currentLabel, currentStatus]),
      progressButton
    ]);
    currentRow.hidden = true;
    const chips = el("div", { class: "chips" });
    const hideInput = el("input", { type: "checkbox", id: "cr-hide-watched" });
    const hideLabel = el("label", { class: "check", for: "cr-hide-watched" }, [hideInput, doc.createTextNode("Hide watched")]);
    const noteFill = el("span", { class: "note-fill", "aria-hidden": "true" });
    const noteText = el("span", { class: "note-text" });
    const notice = el("p", { class: "note", "aria-live": "polite", hidden: true }, [noteFill, noteText]);
    const results = el("div", { class: "results" });
    const chatInput = el("input", { type: "text", placeholder: "Search or ask", "aria-label": "Search or ask", autocomplete: "off" });
    const aiDot = el("span", { class: "ai-dot", "aria-hidden": "true" });
    const aiSwitch = el("button", {
      class: "ai-switch is-on",
      type: "button",
      "aria-pressed": "true",
      "aria-label": "Use AI",
      title: "On: Enter asks. Off: Enter shows the full list."
    }, [doc.createTextNode("AI"), aiDot]);
    let modelStatusText = "";
    const drop = el("div", { class: "search-drop", role: "listbox", hidden: true });
    const topbar = el("div", { class: "topbar" }, [accountIcon, settingsButton, closeButton]);
    const chat = el("form", { class: "chat" }, [chatInput, aiSwitch, drop]);
    const tasteBox = el("div");
    const settingsBox = el("div");
    const body = el("div", { class: "body" }, [
      el("div", { class: "toolbar" }, [chips, hideLabel]),
      notice,
      results
    ]);
    panel2.append(topbar, body, chat);
    drawer.append(
      el("h2", { class: "drawer-title", text: "Settings" }),
      account,
      context,
      forMe,
      refineButton,
      currentRow,
      publicRow,
      el("details", {}, [el("summary", { text: "Tags/Genre preferences" }), tasteBox]),
      el("details", {}, [el("summary", { text: "AI" }), settingsBox]),
      refreshCovers,
      cornerButton
    );
    const chipDefs = [
      ["in-progress", "In progress", "Shows you have started"],
      ["plan", "Plan to watch", "Shows you plan to watch"],
      ["unwatched", "Not started", "Shows you have not begun"],
      ["new", "New", "Newly added on Crunchyroll"],
      ["one-cour", "Short series", "About 10 to 13 episodes"],
      ["movie", "Movies", "Movies only"]
    ];
    let activeChip = "";
    const chipButtons = /* @__PURE__ */ new Map();
    for (const [id, label, hint] of chipDefs) {
      const button = el("button", { class: "chip", type: "button", text: label, title: hint });
      chipButtons.set(id, button);
      button.addEventListener("click", () => {
        activeChip = activeChip === id ? "" : id;
        for (const [chipId, node] of chipButtons) node.classList.toggle("is-on", chipId === activeChip);
        if (chatInput.value.trim()) refreshSuggest();
        else {
          closeDrop();
          handlers.onSearch("", activeChip);
        }
      });
      chips.append(button);
    }
    let open = false;
    let drawerOpen = false;
    let fullscreen = false;
    let gathering = false;
    let gatherMessage = "Gathering the Crunchyroll list";
    let corner = "bottom-right";
    let view = null;
    let refined = false;
    let useAi = true;
    let suggestions = [];
    let suggestActive = -1;
    let suggestToken = 0;
    function place() {
      const edge = {
        "bottom-right": "right:16px;bottom:16px;left:auto;top:auto;",
        "bottom-left": "left:16px;bottom:16px;right:auto;top:auto;",
        "top-left": "left:16px;top:16px;right:auto;bottom:auto;",
        "top-right": "right:16px;top:16px;left:auto;bottom:auto;"
      };
      const align = corner.endsWith("left") ? "flex-start" : "flex-end";
      const column = corner.startsWith("bottom") ? "column-reverse" : "column";
      const base = `all:initial;position:fixed;z-index:2147483646;display:flex;flex-direction:${column};align-items:${align};pointer-events:none;`;
      host.dataset.corner = corner;
      host.classList.toggle("fullscreen", fullscreen);
      host.style.cssText = fullscreen ? `${base}top:40%;right:0;left:auto;bottom:auto;` : `${base}${edge[corner] || edge["bottom-right"]}`;
      placeDrawer();
    }
    function placeDrawer() {
      if (!drawerOpen) return;
      const rect = panel2.getBoundingClientRect();
      const gap = 12;
      const width = Math.min(320, Math.max(240, window.innerWidth - 24));
      let left = rect.right + gap;
      if (left + width > window.innerWidth - 8) left = Math.max(8, rect.left - gap - width);
      drawer.style.top = `${Math.max(8, rect.top)}px`;
      drawer.style.left = `${left}px`;
      drawer.style.width = `${width}px`;
      drawer.style.maxHeight = `${Math.max(240, rect.height)}px`;
    }
    function setDrawer(next) {
      drawerOpen = Boolean(next) && open && !fullscreen;
      drawer.hidden = !drawerOpen;
      drawer.classList.toggle("is-open", drawerOpen);
      settingsButton.classList.toggle("is-on", drawerOpen);
      settingsButton.setAttribute("aria-expanded", drawerOpen ? "true" : "false");
      accountIcon.setAttribute("aria-expanded", drawerOpen ? "true" : "false");
      if (drawerOpen) placeDrawer();
    }
    function showPanel() {
      const shown = open && !fullscreen;
      panel2.hidden = !shown;
      panel2.classList.toggle("is-open", shown);
      backdrop.hidden = !shown;
      backdrop.classList.toggle("is-open", shown);
      launcher.setAttribute("aria-expanded", shown ? "true" : "false");
      launcher.title = shown ? "Minimize Crunchilist" : "Open Crunchilist";
      if (!shown) setDrawer(false);
      paintGather();
    }
    function paintGather() {
      const show = gathering && !fullscreen;
      gather.hidden = !show;
      gather.classList.toggle("is-on", show);
      gatherText.textContent = gatherMessage;
      launcher.classList.toggle("is-locked", gathering);
      launcher.disabled = fullscreen || gathering;
      launcher.setAttribute("aria-busy", gathering ? "true" : "false");
      if (gathering) launcher.title = gatherMessage;
      else if (!open) launcher.title = "Open Crunchilist";
    }
    function setOpen(next, { focus = false, silent = false } = {}) {
      if ((fullscreen || gathering) && next) return;
      open = next;
      if (!open) drawerOpen = false;
      showPanel();
      if (focus && open) chatInput.focus();
      if (!silent) handlers.onOpenChange(open);
      if (open) handlers.onSearch(chatInput.value.trim(), activeChip);
    }
    backdrop.addEventListener("click", () => {
      setOpen(false);
      launcher.focus();
    });
    launcher.addEventListener("click", () => {
      if (fullscreen || gathering) return;
      setOpen(!open, { focus: !open });
    });
    closeButton.addEventListener("click", () => {
      setOpen(false);
      launcher.focus();
    });
    settingsButton.addEventListener("click", () => setDrawer(!drawerOpen));
    accountIcon.addEventListener("click", () => setDrawer(!drawerOpen));
    window.addEventListener("resize", () => placeDrawer());
    refreshCovers.addEventListener("click", () => handlers.onRefreshCovers());
    cornerButton.addEventListener("click", () => {
      corner = CORNERS[(CORNERS.indexOf(corner) + 1) % CORNERS.length];
      place();
      handlers.onCorner(corner);
    });
    hideInput.addEventListener("change", () => handlers.onHideWatched(hideInput.checked));
    currentStatus.addEventListener("change", () => {
      if (!view?.currentId) return;
      const status = currentStatus.value === "clear" ? null : currentStatus.value || null;
      if (currentStatus.value === "") return;
      handlers.onStatus(view.currentId, status);
    });
    progressButton.addEventListener("click", () => {
      if (view?.progressOffer) handlers.onSyncProgress(view.progressOffer);
    });
    refineButton.addEventListener("click", () => handlers.onRefine());
    let searchTimer = 0;
    function paintAi() {
      aiSwitch.classList.toggle("is-on", useAi);
      aiSwitch.setAttribute("aria-pressed", useAi ? "true" : "false");
      aiSwitch.title = (useAi ? "On: Enter asks. Off: Enter shows the full list." : "Off: Enter shows the full list.") + modelStatusText;
      chatInput.placeholder = useAi ? "Search or ask" : "Search Crunchyroll";
      chatInput.setAttribute("aria-label", useAi ? "Search or ask" : "Search the Crunchyroll catalog");
    }
    function closeDrop() {
      suggestions = [];
      suggestActive = -1;
      drop.hidden = true;
      drop.replaceChildren();
    }
    function paintDrop(items) {
      suggestions = items || [];
      drop.replaceChildren();
      if (!suggestions.length) {
        drop.hidden = true;
        return;
      }
      suggestions.forEach((item, index) => {
        const link = el("a", { href: item.url || "#", role: "option" }, [
          artwork(item),
          el("span", { class: "drop-copy" }, [
            el("span", { class: "drop-title", text: item.title }),
            item.reason ? el("span", { class: "drop-reason", text: item.reason }) : null
          ])
        ]);
        if (index === suggestActive) link.classList.add("is-on");
        link.addEventListener("mousedown", (event) => event.preventDefault());
        drop.append(link);
      });
      drop.hidden = false;
    }
    function refreshSuggest() {
      const query2 = chatInput.value.trim();
      window.clearTimeout(searchTimer);
      if (!query2) {
        suggestToken += 1;
        closeDrop();
        return;
      }
      const token = ++suggestToken;
      searchTimer = window.setTimeout(async () => {
        const response = await handlers.onSuggest?.(query2, activeChip);
        if (token !== suggestToken || chatInput.value.trim() !== query2) return;
        suggestActive = -1;
        paintDrop(response?.suggestions || []);
      }, 140);
    }
    aiSwitch.addEventListener("click", () => {
      useAi = !useAi;
      paintAi();
      handlers.onUseAi?.(useAi);
    });
    chatInput.addEventListener("input", () => refreshSuggest());
    chatInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !drop.hidden) {
        event.preventDefault();
        event.stopPropagation();
        closeDrop();
        return;
      }
      if (drop.hidden || !suggestions.length) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = suggestActive < 0 ? 0 : suggestActive + step;
      suggestActive = (next + suggestions.length) % suggestions.length;
      paintDrop(suggestions);
    });
    chat.addEventListener("submit", (event) => {
      event.preventDefault();
      window.clearTimeout(searchTimer);
      suggestToken += 1;
      closeDrop();
      const query2 = chatInput.value.trim();
      if (useAi && query2) handlers.onPrompt?.(query2, activeChip);
      else handlers.onSearch(query2, activeChip);
    });
    accountButton.addEventListener("click", () => {
      if (view?.settings?.anilistConnected) handlers.onRefresh();
      else handlers.onOpenOptions();
    });
    publicRow.addEventListener("submit", (event) => {
      event.preventDefault();
      handlers.onImport(userInput.value.trim());
    });
    importButton.addEventListener("click", () => handlers.onImport(userInput.value.trim()));
    host.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape" && open && !fullscreen) {
        if (!drop.hidden) closeDrop();
        else if (drawerOpen) setDrawer(false);
        else {
          setOpen(false);
          launcher.focus();
        }
      }
    });
    host.addEventListener("click", (event) => event.stopPropagation());
    place();
    function renderTokens(container, values, field) {
      container.replaceChildren();
      for (const value of values || []) {
        const button = el("button", { class: "token", type: "button", "aria-label": `Remove ${value}` }, [
          el("span", { text: value }),
          el("span", { class: "token-x", "aria-hidden": "true", text: "\xD7" })
        ]);
        button.addEventListener("click", () => {
          const taste = { ...view.taste, [field]: view.taste[field].filter((item) => item !== value) };
          handlers.onTaste(taste);
        });
        container.append(button);
      }
    }
    function tasteField(field, label, hint) {
      const tokens = el("div", { class: "tokens" });
      const input = el("input", { type: "text", "aria-label": label, "aria-autocomplete": "list", placeholder: "Type a tag", autocomplete: "off" });
      const list = el("div", { class: "suggest-list", role: "listbox", hidden: true });
      let matches = [];
      let active = -1;
      function paintList() {
        list.replaceChildren();
        if (!matches.length) {
          list.hidden = true;
          return;
        }
        matches.forEach((name, index) => {
          const option = el("button", { type: "button", role: "option", text: name });
          if (index === active) option.classList.add("is-on");
          option.addEventListener("mousedown", (event) => {
            event.preventDefault();
            addTag(name);
          });
          list.append(option);
        });
        list.hidden = false;
      }
      function closeList() {
        matches = [];
        active = -1;
        list.hidden = true;
        list.replaceChildren();
      }
      function addTag(value) {
        const next = String(value || "").trim();
        if (!next || !view) return;
        const exists = (view.taste[field] || []).some((item) => item.toLowerCase() === next.toLowerCase());
        input.value = "";
        closeList();
        if (exists) return;
        handlers.onTaste({ ...view.taste, [field]: [...view.taste[field], next] });
      }
      input.addEventListener("input", () => {
        matches = filterTagSuggestions(input.value, view?.tagSuggestions || [], view?.taste?.[field] || []);
        active = matches.length ? 0 : -1;
        paintList();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !list.hidden) {
          event.preventDefault();
          event.stopPropagation();
          closeList();
          return;
        }
        if (!list.hidden && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          active = (active + step + matches.length) % matches.length;
          paintList();
          return;
        }
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (!list.hidden && active >= 0) addTag(matches[active]);
        else addTag(input.value);
      });
      input.addEventListener("blur", () => closeList());
      const wrap = el("div", { class: "taste-field" }, [
        el("span", { class: "account-name", text: label }),
        el("span", { class: "field-hint", text: hint }),
        tokens,
        el("div", { class: "suggest" }, [input, list])
      ]);
      wrap.dataset.field = field;
      return { wrap, tokens };
    }
    const liked = tasteField("liked", "What I like", "Shows with these tags rank higher.");
    const disliked = tasteField("disliked", "What I don't like", "Shows with these tags rank lower.");
    const dropped = tasteField("dropped", "Dropped", "A softer dislike, for tags on shows you stopped watching.");
    const avoids = tasteField("hardAvoids", "Hard avoids", "Shows with these tags are left out.");
    const audio = el("select", { "aria-label": "Audio preference" });
    for (const [value, label] of [["any", "Any audio"], ["sub", "Prefer sub"], ["dub", "Prefer dub"]]) {
      audio.append(el("option", { value, text: label }));
    }
    audio.addEventListener("change", () => {
      if (!view) return;
      handlers.onTaste({ ...view.taste, subDub: audio.value });
    });
    tasteBox.append(liked.wrap, disliked.wrap, dropped.wrap, avoids.wrap, el("label", {}, [el("span", { text: "Sub or dub" }), audio]));
    const keyInput = el("input", { type: "password", autocomplete: "off", "aria-label": "API key", placeholder: "API key" });
    const keyToggle = el("button", { class: "quiet", type: "button", text: "Show", "aria-label": "Show API key", "aria-pressed": "false" });
    keyToggle.addEventListener("click", () => {
      const shown = keyInput.type === "text";
      keyInput.type = shown ? "password" : "text";
      keyToggle.textContent = shown ? "Show" : "Hide";
      keyToggle.setAttribute("aria-label", shown ? "Show API key" : "Hide API key");
      keyToggle.setAttribute("aria-pressed", shown ? "false" : "true");
    });
    const saveSettings = el("button", { class: "primary", type: "button", text: "Save" });
    const clearKey = el("button", { class: "quiet", type: "button", text: "Clear key" });
    const optionsButton = el("button", { class: "quiet", type: "button", text: "Open settings" });
    const modelName = el("span", { text: "Selected model: Chrome" });
    const modelState = el("span", { class: "model-state", text: "Unknown" });
    const modelDetail = el("span", { class: "model-detail" });
    const modelLine = el("p", { class: "note" }, [modelName, modelState, modelDetail]);
    settingsBox.append(
      modelLine,
      el("label", {}, [el("span", { text: "Optional API key" }), el("div", { class: "reveal" }, [keyInput, keyToggle])]),
      el("div", { class: "row" }, [saveSettings, clearKey, optionsButton])
    );
    saveSettings.addEventListener("click", () => {
      const apiKey = keyInput.value.trim();
      if (!apiKey) return;
      keyInput.value = "";
      handlers.onSaveSettings({ apiKey });
    });
    clearKey.addEventListener("click", () => handlers.onClearKey());
    optionsButton.addEventListener("click", () => handlers.onOpenOptions());
    function writeNote(text2, progress, under = false) {
      const value = text2 || "";
      noteText.textContent = value;
      notice.hidden = !value;
      const hasProgress = typeof progress === "number" && Number.isFinite(progress);
      notice.classList.toggle("is-under", hasProgress && under);
      notice.classList.toggle("is-wait", hasProgress && progress <= 0);
      if (!hasProgress) {
        noteFill.style.width = "0";
        return;
      }
      const width = progress <= 0 ? 0 : Math.min(100, Math.max(6, Math.round(progress * 100)));
      noteFill.style.width = `${width}%`;
    }
    function artwork(item) {
      if (item.poster) return el("img", { class: "thumb", src: item.poster, alt: "", referrerpolicy: "no-referrer" });
      return el("span", { class: "thumb thumb-fallback", text: (item.title || "?").slice(0, 1).toUpperCase() });
    }
    function statusSelect(item) {
      const select = el("select", { "aria-label": `Status for ${item.title}` });
      fillSelect(select, item.status || "");
      select.addEventListener("change", () => {
        if (!select.value) return;
        handlers.onStatus(item.id, select.value === "clear" ? null : select.value);
      });
      return select;
    }
    function renderRail(section) {
      const rail = el("div", { class: "rail" });
      for (const item of section.items || []) {
        const art = item.poster ? el("img", { src: item.poster, alt: "", referrerpolicy: "no-referrer" }) : el("span", { class: "poster-fallback", text: (item.title || "?").slice(0, 1).toUpperCase() });
        rail.append(el("article", { class: "poster" }, [
          el("a", { class: "poster-link", href: item.url }, [
            art,
            el("span", { class: "poster-title", text: item.title })
          ]),
          statusSelect(item)
        ]));
      }
      return el("section", {}, [el("h2", { class: "rail-title", text: section.title }), rail]);
    }
    function contextText() {
      if (!view) return "Looking at this page.";
      if (view.kind === "series") return view.currentTitle ? `Series \xB7 ${view.currentTitle}` : "Series page";
      if (view.kind === "watch") return view.currentTitle ? `Watching \xB7 ${view.currentTitle}` : "Watching";
      return "Search the catalog";
    }
    function paintTaste() {
      if (!view?.taste) return;
      const active = shadow.activeElement;
      renderTokens(liked.tokens, view.taste.liked, "liked");
      renderTokens(disliked.tokens, view.taste.disliked, "disliked");
      renderTokens(dropped.tokens, view.taste.dropped, "dropped");
      renderTokens(avoids.tokens, view.taste.hardAvoids, "hardAvoids");
      if (active !== audio) audio.value = view.taste.subDub || "any";
    }
    return {
      host,
      setView(next, { syncOpen = false } = {}) {
        if (next?.url && next.url !== view?.url) refined = false;
        view = next || view;
        if (!view) return;
        context.textContent = contextText();
        context.hidden = context.textContent === "Search the catalog" || context.textContent === "Looking at this page.";
        if (!refined) forMe.textContent = view.forMe || "";
        forMe.hidden = !forMe.textContent;
        refineButton.hidden = !(view.settings?.hasKey && (view.kind === "series" || view.kind === "watch"));
        currentRow.hidden = !view.currentId;
        if (shadow.activeElement !== currentStatus) currentStatus.value = view.currentStatus || "";
        hideInput.checked = Boolean(view.settings?.hideWatched);
        const offer = view.progressOffer;
        progressButton.hidden = !offer;
        progressButton.textContent = offer ? `Update AniList to episode ${offer.to}` : "Update AniList";
        const connected = Boolean(view.settings?.anilistConnected && view.settings?.anilistViewerName);
        const importedAt = view.importMeta?.importedAt ? new Date(view.importMeta.importedAt).toLocaleString(void 0, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
        if (connected) {
          accountMark.hidden = false;
          accountIcon.querySelector("svg").hidden = true;
          accountIcon.classList.add("is-connected");
          accountMark.textContent = view.settings.anilistViewerName.slice(0, 1).toUpperCase();
          accountIcon.title = view.settings.anilistViewerName;
          accountIcon.setAttribute("aria-label", `AniList account, ${view.settings.anilistViewerName}`);
          accountName.textContent = view.settings.anilistViewerName;
          accountMeta.textContent = importedAt ? `AniList \xB7 ${importedAt}` : "AniList";
          accountButton.textContent = "Refresh";
          accountButton.className = "quiet";
          publicRow.hidden = true;
        } else if (view.importMeta?.username) {
          accountMark.hidden = true;
          accountIcon.querySelector("svg").hidden = false;
          accountIcon.classList.remove("is-connected");
          accountIcon.title = "Sign in to AniList";
          accountIcon.setAttribute("aria-label", "Sign in to AniList");
          accountMark.textContent = view.importMeta.username.slice(0, 1).toUpperCase();
          accountName.textContent = view.importMeta.username;
          accountMeta.textContent = importedAt ? `Public list \xB7 ${importedAt}` : "Public list";
          accountButton.textContent = "Set up";
          accountButton.className = "primary";
          publicRow.hidden = false;
        } else {
          accountMark.hidden = true;
          accountIcon.querySelector("svg").hidden = false;
          accountIcon.classList.remove("is-connected");
          accountIcon.title = "Sign in to AniList";
          accountIcon.setAttribute("aria-label", "Sign in to AniList");
          accountName.textContent = "Not connected";
          accountMeta.textContent = "Connect to keep marks in sync.";
          accountButton.textContent = "Set up";
          accountButton.className = "primary";
          publicRow.hidden = false;
        }
        if (typeof view.settings?.useAi === "boolean" && view.settings.useAi !== useAi) {
          useAi = view.settings.useAi;
          paintAi();
        }
        modelName.textContent = `Selected model: ${view.settings?.modelLabel || "Chrome"}`;
        keyInput.placeholder = view.settings?.hasKey ? "Key saved on this device" : "API key";
        if (shadow.activeElement !== userInput && view.settings?.anilistUsername) userInput.value = view.settings.anilistUsername;
        paintTaste();
        if (syncOpen) {
          corner = view.settings?.panelCorner || corner;
          place();
          setOpen(false, { silent: true });
        }
      },
      setResults(payload) {
        const note = [payload?.notice, payload?.note].filter(Boolean).join(" ");
        writeNote(note, payload?.downloading ? payload.progress ?? 0 : void 0, Boolean(payload?.downloading));
        results.replaceChildren();
        const sections = payload?.sections || [];
        if (sections.length) {
          for (const section of sections) results.append(renderRail(section));
          return;
        }
        const list = payload?.results || [];
        if (!list.length) {
          results.append(el("p", { class: "note empty", text: payload?.note || payload?.notice || "Type a title to search." }));
          return;
        }
        const renderResult = (item) => {
          const select = el("select", { "aria-label": `Status for ${item.title}` });
          fillSelect(select, item.status || "");
          select.addEventListener("change", () => {
            if (!select.value) return;
            handlers.onStatus(item.id, select.value === "clear" ? null : select.value);
          });
          const tags = el("div", { class: "tags" });
          for (const tag of item.tags || []) tags.append(el("span", { class: "tag", text: tag }));
          const confidence = Number.isInteger(item.confidence) ? item.confidence : null;
          const card = el("article", { class: item.mention ? "card is-mention" : "card" }, [
            confidence != null ? el("div", { class: "card-fill" }) : null,
            artwork(item),
            el("div", { class: "card-body" }, [
              el("div", { class: "card-top" }, [
                Number.isInteger(item.rank) ? el("span", { class: "rank", text: String(item.rank) }) : null,
                el("a", { href: item.url, text: item.title }),
                confidence != null ? el("span", { class: "fit", text: `${confidence}%` }) : null,
                select
              ]),
              el("p", { class: "reason", text: item.reason || "" }),
              tags
            ])
          ]);
          if (confidence != null) card.style.setProperty("--fill", `${confidence}%`);
          return card;
        };
        const picks = list.filter((item) => !item.mention);
        const mentions = list.filter((item) => item.mention);
        for (const item of picks) results.append(renderResult(item));
        if (!picks.length) {
          for (const item of list) results.append(renderResult(item));
        } else if (mentions.length) {
          results.append(el("p", { class: "rail-title mention-title", text: "Honorable mentions" }));
          for (const item of mentions) results.append(renderResult(item));
        }
      },
      setForMe(text2, note) {
        refined = true;
        forMe.hidden = false;
        forMe.textContent = text2 || "";
        if (note) writeNote(note);
      },
      setNote(text2, { progress, under = false } = {}) {
        writeNote(text2, progress, under);
      },
      setModelStatus(status) {
        const state = ["online", "offline", "unknown"].includes(status?.state) ? status.state : "unknown";
        const label = status?.label || "Unknown";
        for (const node of [aiDot, modelState]) {
          node.classList.toggle("is-online", state === "online");
          node.classList.toggle("is-unknown", state === "unknown");
        }
        modelState.textContent = label;
        modelDetail.textContent = status?.detail || "";
        modelStatusText = ` Model: ${label}.${status?.detail ? ` ${status.detail}` : ""}`;
        paintAi();
      },
      setGathering(on, message) {
        gathering = Boolean(on);
        if (message) gatherMessage = message;
        if (gathering && open) setOpen(false, { silent: true });
        paintGather();
      },
      setFullscreen(on) {
        fullscreen = Boolean(on);
        launcher.setAttribute("aria-label", fullscreen ? "Crunchilist is hidden during fullscreen" : "Open Crunchilist");
        place();
        showPanel();
      }
    };
  }

  // content/scan.js
  function text(node) {
    try {
      const value = node?.textContent;
      return value ? String(value).replace(/\s+/g, " ").trim() : "";
    } catch {
      return "";
    }
  }
  function query(node, selector) {
    try {
      return node?.querySelector?.(selector) || null;
    } catch {
      return null;
    }
  }
  function anchorTitle(anchor) {
    const heading = query(anchor, "h2, h3, h4");
    if (heading && text(heading).length <= 120) return text(heading);
    const alt = query(anchor, "img")?.getAttribute?.("alt")?.trim() || "";
    if (alt && alt.length <= 120) return alt;
    const titled = query(anchor, '[class*="title"]');
    if (titled && text(titled).length <= 120) return text(titled);
    const value = text(anchor);
    return value.length <= 80 ? value : "";
  }
  function readMeta(doc) {
    const result = { audioText: "", subtitleText: "", genres: [], episodeText: "", movieSignal: false };
    const root = doc.body;
    if (!root) return result;
    let walker;
    try {
      walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    } catch {
      return result;
    }
    let seen = 0;
    while (seen < 12e3) {
      let node;
      try {
        node = walker.nextNode();
      } catch {
        break;
      }
      if (!node) break;
      try {
        if (node.id === "cr-corner-host" || node.closest?.("#cr-corner-host")) continue;
        if (node.childElementCount) continue;
        seen += 1;
        const value = text(node);
        if (!value || value.length > 80) continue;
        const key = value.toLowerCase().replace(/:$/, "");
        const sibling = node.nextElementSibling;
        if (key === "audio") result.audioText = text(sibling) || result.audioText;
        if (key === "subtitles" || key === "subtitle") result.subtitleText = text(sibling) || result.subtitleText;
        if (key === "genres" || key === "genre") {
          const chips = sibling ? [...sibling.querySelectorAll("a, button, span")].map(text).filter((item) => item && item.length < 40) : [];
          result.genres = chips.length ? chips : text(sibling).split(/,|·/).map((part) => part.trim()).filter(Boolean);
        }
        if (/\b\d+\s+episodes?\b/i.test(value)) result.episodeText = value;
        if (/^movie$/i.test(value)) result.movieSignal = true;
      } catch {
        seen += 1;
      }
    }
    return result;
  }
  function scanDocument(doc, pageUrl) {
    const url = new URL(pageUrl);
    const kindInfo = pageKindFromPath(url.pathname);
    const heading = text(doc.querySelector("h1"));
    const seasonNode = doc.querySelector('.season-info [class*="select-trigger__title-truncated-text--"], .seasons-select [seasontitle]');
    const activeSeasonTitle = seasonNode ? seasonNode.getAttribute("seasontitle") || text(seasonNode) : "";
    const meta = readMeta(doc);
    const anchors = [];
    doc.querySelectorAll('a[href*="/series/"]').forEach((anchor) => {
      try {
        if (anchor.closest("#cr-corner-host, header, nav, footer")) return;
        const href = anchor.getAttribute("href") || "";
        const seriesId = seriesIdFromHref(href);
        if (!seriesId) return;
        anchors.push({ href, seriesId, title: anchorTitle(anchor) });
      } catch {
      }
    });
    return {
      kind: kindInfo.kind,
      kindInfo,
      pathname: url.pathname,
      pageUrl,
      seriesId: kindInfo.seriesId,
      watchId: kindInfo.watchId || null,
      seriesTitle: kindInfo.kind === "series" ? heading : "",
      activeSeasonTitle,
      audioText: meta.audioText,
      subtitleText: meta.subtitleText,
      genres: meta.genres,
      movieSignal: meta.movieSignal,
      domEpisodeCount: episodeCountFromText(meta.episodeText),
      domEpisodeNumber: kindInfo.kind === "watch" ? episodeNumberFromLabel(heading) : null,
      anchors: anchors.slice(0, 80)
    };
  }

  // content/main.js
  if (!globalThis.__crCornerBooted) {
    globalThis.__crCornerBooted = true;
    boot();
  }
  function boot() {
    const begin = () => start();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", begin, { once: true });
    else begin();
  }
  var panel;
  var observer;
  var catalogPoll = 0;
  var gatherPoll = 0;
  var modelPoll = 0;
  var mode = { type: "auto" };
  var cmsEpisodes = [];
  var cmsSeasons = [];
  var lastPath = location.pathname;
  var scanTimer = 0;
  var scanGeneration = 0;
  var lastSignature = "";
  var latestView = null;
  var hydrated = false;
  function send(type, payload = {}) {
    return chrome.runtime.sendMessage({ type, ...payload }).catch((error) => ({
      ok: false,
      error: error?.message || "Extension unavailable"
    }));
  }
  async function refreshModelStatus() {
    const response = await send("modelStatus");
    panel?.setModelStatus(response?.ok ? response.status : { state: "unknown", label: "Error", detail: response?.error || "" });
  }
  function start() {
    panel = createPanel(document, {
      onOpenChange: (panelOpen) => {
        if (panelOpen) refreshModelStatus();
        return send("setUi", { panelOpen });
      },
      onSearch: async (query2, chip) => {
        mode = { type: "search", query: query2, chip: chip || "" };
        if (query2) panel.setNote("Searching\u2026");
        const response = await send("catalogSearch", { query: query2, chip });
        if (mode.type !== "search" || mode.query !== query2 || (mode.chip || "") !== (chip || "")) return;
        if (!response?.ok) panel.setNote(response?.error || "Could not search.");
        else panel.setResults(response);
      },
      onSuggest: async (query2, chip) => send("catalogSuggest", { query: query2, chip }),
      onPrompt: async (text2, chip) => {
        mode = { type: "prompt", query: text2, chip: chip || "" };
        panel.setNote("Thinking\u2026");
        const response = await send("catalogPrompt", { text: text2, chip });
        refreshModelStatus();
        if (mode.type !== "prompt" || mode.query !== text2 || (mode.chip || "") !== (chip || "")) return;
        if (!response?.ok) panel.setNote(response?.error || "Could not answer that.");
        else {
          panel.setResults(response);
          if (response.downloading) watchModelDownload(response.note);
        }
      },
      onUseAi: (useAi) => send("setSettings", { patch: { useAi } }),
      onCorner: (panelCorner) => send("setUi", { panelCorner }),
      onHideWatched: async (hideWatched) => {
        const response = await send("setUi", { hideWatched });
        if (response?.view) renderView(response.view, { refreshQuery: mode.type === "chip" });
        if (mode.type === "search") {
          const again = await send("catalogSearch", { query: mode.query || "", chip: mode.chip || "" });
          if (again?.ok) panel.setResults(again);
        }
      },
      onChip: async (chip) => {
        mode = { type: "chip", chip };
        panel.setNote("Looking\u2026");
        const response = await send("recommend", { chip });
        if (!response?.ok) panel.setNote(response?.error || "Could not rank this page.");
        else panel.setResults(response);
      },
      onChat: async (text2) => {
        mode = { type: "chat" };
        panel.setNote("Thinking\u2026");
        const response = await send("chat", { text: text2 });
        refreshModelStatus();
        if (!response?.ok) panel.setNote(response?.error || "Could not answer that.");
        else {
          panel.setResults(response);
          if (response.downloading) watchModelDownload(response.note);
        }
      },
      onStatus: async (id, status) => {
        const response = await send("setStatus", { id, status });
        if (!response?.ok) panel.setNote(response?.error || "Could not save that status.");
        else if (response.view) await showView(response.view, response.syncNote);
      },
      onSyncProgress: async (offer) => {
        const response = await send("syncAnilistProgress", { id: offer.id });
        if (!response?.ok) panel.setNote(response?.error || "Could not update AniList.");
        else if (response.view) await showView(response.view, response.syncNote);
      },
      onRefresh: async () => {
        panel.setNote("Refreshing AniList\u2026");
        const response = await send("refreshAnilist");
        if (!response?.ok) panel.setNote(response?.error || "Could not refresh AniList.");
        else if (response.view) await showView(response.view, `Refreshed ${response.imported} anime from AniList.`);
      },
      onRefreshCovers: async () => {
        window.clearInterval(catalogPoll);
        panel.setNote("Updating the catalog\u2026", { progress: 0 });
        const response = await send("refreshCatalogCovers");
        const note = response?.ok ? response.note : response?.error || "Could not update the catalog.";
        if (!response?.running) {
          panel.setNote(note);
          return;
        }
        panel.setNote(note, { progress: response.progress || 0 });
        catalogPoll = window.setInterval(async () => {
          const progress = await send("catalogProgress");
          if (!progress?.ok) {
            window.clearInterval(catalogPoll);
            return;
          }
          if (!progress.running) {
            window.clearInterval(catalogPoll);
            panel.setNote("");
            return;
          }
          panel.setNote(progress.note || note, { progress: progress.progress || 0 });
        }, 500);
      },
      onTaste: async (taste) => {
        const response = await send("setTaste", { taste });
        if (!response?.ok) panel.setNote(response?.error || "Could not save taste.");
        else if (response.view) renderView(response.view, { refreshQuery: mode.type === "chip" });
      },
      onSaveSettings: async (patch) => {
        const response = await send("setSettings", { patch });
        if (!response?.ok) panel.setNote(response?.error || "Could not save settings.");
        else {
          panel.setNote(response.originOk ? "Key saved." : `Key saved. Allow ${response.origin} in extension settings before chat will call it.`);
          if (response.view) panel.setView(response.view);
        }
      },
      onClearKey: async () => {
        const response = await send("clearKey");
        panel.setNote(response?.ok ? "API key cleared." : response?.error || "Could not clear the key.");
        if (response?.view) panel.setView(response.view);
      },
      onImport: async (username) => {
        panel.setNote("Importing AniList list\u2026");
        const response = await send("importAnilist", { username });
        if (!response?.ok) panel.setNote(response?.error || "Import failed.");
        else {
          panel.setNote(`Imported ${response.imported} anime.`);
          if (response.view) renderView(response.view, { refreshQuery: true });
        }
      },
      onRefine: async () => {
        const response = await send("refine");
        if (!response?.ok) panel.setNote(response?.error || "Could not refine that.");
        else panel.setForMe(response.forMe, response.note || "");
      },
      onOpenOptions: () => send("openOptions")
    });
    document.documentElement.append(panel.host);
    window.addEventListener("message", onPageMessage);
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "enriched" && message.view) renderView(message.view, { refreshQuery: true });
    });
    document.addEventListener("fullscreenchange", syncFullscreen);
    document.addEventListener("webkitfullscreenchange", syncFullscreen);
    window.addEventListener("resize", syncFullscreen);
    observer = new MutationObserver(() => schedule());
    observer.observe(document.documentElement, { childList: true, subtree: true });
    send("catalogProgress").then((progress) => {
      if (progress?.gathering) beginGather(progress.phase);
    });
    schedule();
  }
  function watchModelDownload(note) {
    window.clearInterval(modelPoll);
    const message = note || "Chrome is downloading its model. Ask again when that finishes.";
    modelPoll = window.setInterval(async () => {
      const progress = await send("catalogProgress");
      if (!progress?.ok || !progress.modelDownloading) {
        window.clearInterval(modelPoll);
        panel.setNote(progress?.modelStalled ? progress.modelNote : "");
        refreshModelStatus();
        return;
      }
      panel.setNote(message, { progress: progress.modelProgress || 0, under: true });
    }, 500);
  }
  function beginGather(phase) {
    panel.setGathering(true, phase || "Gathering the Crunchyroll list");
    window.clearInterval(gatherPoll);
    gatherPoll = window.setInterval(async () => {
      const progress = await send("catalogProgress");
      if (!progress?.ok || !progress.gathering) {
        window.clearInterval(gatherPoll);
        panel.setGathering(false);
        return;
      }
      panel.setGathering(true, progress.phase || "Gathering the Crunchyroll list");
    }, 500);
  }
  function onPageMessage(event) {
    if (event.source !== window || event.data?.source !== "cr-corner-hook") return;
    const message = event.data;
    if (message.kind === "auth" && message.token) {
      const locale = document.documentElement.lang || navigator.language || "en-US";
      send("catalogSession", { token: message.token, locale }).then((response) => {
        if (response?.gathering) beginGather(response.phase);
      });
      return;
    }
    if (message.kind === "nav") {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        cmsEpisodes = [];
        cmsSeasons = [];
        mode = { type: "auto" };
      }
      schedule();
      return;
    }
    if (message.kind !== "cms" || message.page && message.page !== location.href) return;
    if (/\/cms\/objects\//.test(message.url || "")) {
      cmsEpisodes = cmsEpisodes.concat(parseCmsObjects(message.data)).slice(-120);
    } else if (/\/cms\/series\/[^/]+\/seasons/.test(message.url || "")) {
      cmsSeasons = parseCmsSeasons(message.data);
    }
    schedule();
  }
  function schedule() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(runScan, 450);
  }
  function observationSignature(observation) {
    return JSON.stringify({
      kind: observation.kind,
      url: observation.url,
      currentKey: observation.currentKey,
      seasons: (observation.seasons || []).map((season) => [
        season.seriesId,
        season.seasonSlug,
        season.episodeCount,
        season.watchingEpisode,
        season.audio,
        season.genres
      ]),
      sightings: (observation.sightings || []).map((sighting) => [sighting.seriesId, sighting.title])
    });
  }
  async function runScan() {
    const generation = ++scanGeneration;
    let observation;
    try {
      observation = buildObservation({
        ...scanDocument(document, location.href),
        cmsEpisodes,
        cmsSeasons
      });
    } catch {
      return;
    }
    syncFullscreen();
    const signature = observationSignature(observation);
    if (signature === lastSignature) {
      if (latestView) paintMarks(latestView);
      return;
    }
    const response = await send("pageUpdate", { observation });
    if (generation !== scanGeneration || !response?.ok || !response.view) return;
    lastSignature = signature;
    latestView = response.view;
    renderView(response.view, { syncOpen: true, refreshQuery: mode.type === "chip" });
  }
  function paintMarks(view) {
    if (observer) observer.disconnect();
    try {
      applyBadges(document, view.marks || {}, view.settings?.hideWatched);
    } finally {
      observer?.observe(document.documentElement, { childList: true, subtree: true });
    }
  }
  async function showView(view, note) {
    renderView(view, { refreshQuery: false });
    if (mode.type === "chip") {
      const ranked = await send("recommend", { chip: mode.chip });
      if (ranked?.ok) panel.setResults(ranked);
    }
    if (note) panel.setNote(note);
  }
  function renderView(view, { syncOpen = false, refreshQuery = false } = {}) {
    latestView = view;
    const openFromStorage = syncOpen && !hydrated;
    if (syncOpen) hydrated = true;
    panel.setView(view, { syncOpen: openFromStorage });
    paintMarks(view);
    if (refreshQuery && mode.type === "chip") {
      send("recommend", { chip: mode.chip }).then((response) => {
        if (response?.ok) panel.setResults(response);
      });
      return;
    }
  }
  function syncFullscreen() {
    if (!panel) return;
    const video = document.querySelector("video");
    const element = document.fullscreenElement || document.webkitFullscreenElement;
    const videoFullscreen = Boolean(video && (element === video || video.webkitDisplayingFullscreen));
    panel.setFullscreen(Boolean(element || videoFullscreen));
  }
})();
