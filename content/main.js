import { applyBadges } from "./badges.js";
import { createPanel } from "./panel.js";
import { scanDocument } from "./scan.js";
import { buildObservation, parseCmsObjects, parseCmsSeasons } from "../lib/page-model.js";

if (!globalThis.__crCornerBooted) {
  globalThis.__crCornerBooted = true;
  boot();
}

function boot() {
  const begin = () => start();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", begin, { once: true });
  else begin();
}

let panel;
let observer;
let catalogPoll = 0;
let gatherPoll = 0;
let modelPoll = 0;
let mode = { type: "auto" };
let cmsEpisodes = [];
let cmsSeasons = [];
let lastPath = location.pathname;
let scanTimer = 0;
let scanGeneration = 0;
let lastSignature = "";
let latestView = null;
let hydrated = false;

function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload }).catch((error) => ({
    ok: false,
    error: error?.message || "Extension unavailable",
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
    onSearch: async (query, chip) => {
      mode = { type: "search", query, chip: chip || "" };
      if (query) panel.setNote("Searching…");
      const response = await send("catalogSearch", { query, chip });
      if (mode.type !== "search" || mode.query !== query || (mode.chip || "") !== (chip || "")) return;
      if (!response?.ok) panel.setNote(response?.error || "Could not search.");
      else panel.setResults(response);
    },
    onSuggest: async (query, chip) => send("catalogSuggest", { query, chip }),
    onPrompt: async (text, chip) => {
      mode = { type: "prompt", query: text, chip: chip || "" };
      panel.setNote("Thinking…");
      const response = await send("catalogPrompt", { text, chip });
      refreshModelStatus();
      if (mode.type !== "prompt" || mode.query !== text || (mode.chip || "") !== (chip || "")) return;
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
      panel.setNote("Looking…");
      const response = await send("recommend", { chip });
      if (!response?.ok) panel.setNote(response?.error || "Could not rank this page.");
      else panel.setResults(response);
    },
    onChat: async (text) => {
      mode = { type: "chat" };
      panel.setNote("Thinking…");
      const response = await send("chat", { text });
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
      panel.setNote("Refreshing AniList…");
      const response = await send("refreshAnilist");
      if (!response?.ok) panel.setNote(response?.error || "Could not refresh AniList.");
      else if (response.view) await showView(response.view, `Refreshed ${response.imported} anime from AniList.`);
    },
    onRefreshCovers: async () => {
      window.clearInterval(catalogPoll);
      panel.setNote("Updating the catalog…", { progress: 0 });
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
      panel.setNote("Importing AniList list…");
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
    onOpenOptions: () => send("openOptions"),
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
  if (message.kind !== "cms" || (message.page && message.page !== location.href)) return;
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
      season.genres,
    ]),
    sightings: (observation.sightings || []).map((sighting) => [sighting.seriesId, sighting.title]),
  });
}

async function runScan() {
  const generation = ++scanGeneration;
  let observation;
  try {
    observation = buildObservation({
      ...scanDocument(document, location.href),
      cmsEpisodes,
      cmsSeasons,
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
