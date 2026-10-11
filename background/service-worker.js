import {
  DELETE_ENTRY_MUTATION,
  LIST_QUERY,
  MEDIA_LIST_QUERY,
  SAVE_ENTRY_MUTATION,
  SEARCH_QUERY,
  VIEWER_QUERY,
  anilistAuthUrl,
  anilistTokenBody,
  applyCachedIdentity,
  cacheKeyForSeason,
  cacheKeyForSeries,
  clearMisses,
  clearSeriesMisses,
  dropUnusedSeriesCache,
  flattenListCollection,
  CATALOG_MATCH_BATCH,
  DETAIL_BATCH,
  catalogMatchQuery,
  catalogMatchVariables,
  mediaDetailQuery,
  mediaDetailVariables,
  titlesNeedingDetail,
  applyMediaDetails,
  showFactsFromHit,
  localCoverStamps,
  matchTitleToMedia,
  matchesFromBatch,
  mediaToCacheHit,
  missEntry,
  titlesNeedingAnilist,
  parseCodeRedirect,
  queriesForObservation,
  readCache,
  rememberImportMatches,
  saveEntryInput,
  toAnilistStatus,
} from "../lib/anilist.js";
import {
  applyCatalogChip,
  browseRequestUrl,
  buildHomeSections,
  catalogDue,
  displayPoster,
  mergeCatalogItems,
  retainSeenCatalog,
  promptFallbackBrief,
  rankCatalogSuggestions,
  promptFits,
  scorePromptCandidates,
  stampCatalogCovers,
  normalizeCatalog,
  normalizeLocale,
  parseBrowsePayload,
  parseSearchPayload,
  searchRequestUrl,
} from "../lib/catalog.js";
import { buildCandidates } from "../lib/candidates.js";
import { interpretLocalRequest } from "../lib/intent.js";
import { buildChatBody, buildChromeMessages, buildRefineBody, CHROME_PICK_SCHEMA, messageText, resolveModelResults, pickChatModel } from "../lib/llm.js";
import { describeModelStatus } from "../lib/model-status.js";
import { recommend } from "../lib/recommend.js";
import { applyObservations, progressOfferFor, seriesCardDecision, seriesMarkKey, setRecordStatus } from "../lib/season.js";
import { anilistSession, applySettingsPatch, publicSettings, validateClientId, validateClientSecret } from "../lib/settings.js";
import { STORAGE_KEY, normalizeState } from "../lib/state.js";
import { allowedByTaste, buildWeights, collectTagSuggestions, isThisForMe, sanitizeTaste, scoreLabels } from "../lib/taste.js";

const ANILIST_URL = "https://graphql.anilist.co";
const CATALOG_KEY = "crCatalog";
const STATUSES = new Set([null, "finished", "in_progress", "dropped", "plan"]);
let enrichToken = 0;

async function loadState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeState(stored[STORAGE_KEY]);
}

async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function delay(ms, signal) {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function originPattern(baseUrl) {
  return `${new URL(baseUrl).origin}/*`;
}

async function originAllowed(baseUrl) {
  try {
    return await chrome.permissions.contains({ origins: [originPattern(baseUrl)] });
  } catch {
    return false;
  }
}

async function anilist(query, variables, token, signal) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(ANILIST_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
    signal,
  });
  if (response.status === 401) throw new Error("AniList session expired. Connect again.");
  if (!response.ok) throw new Error(`AniList returned ${response.status}`);
  const payload = await response.json();
  if (payload.errors?.length && !payload.data) {
    throw new Error(payload.errors[0].message || "AniList request failed");
  }
  return payload;
}

function apiUrl(settings, path) {
  return `${settings.baseUrl.replace(/\/$/, "")}${path}`;
}

async function postChat(settings, body) {
  const allowed = await originAllowed(settings.baseUrl);
  if (!allowed) throw new Error("Allow this API origin in extension settings.");
  return fetch(apiUrl(settings, "/chat/completions"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

async function readModelError(response) {
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  const code = payload?.error?.code || "";
  const message = payload?.error?.message || "";
  const missing = response.status === 404 || code === "model_not_found" || /does not exist|model_not_found|invalid model/i.test(message);
  return { missing, status: response.status, message };
}

async function resolveModel(settings, avoid = "") {
  const allowed = await originAllowed(settings.baseUrl);
  if (!allowed) throw new Error("Allow this API origin in extension settings.");
  const response = await fetch(apiUrl(settings, "/models"), {
    headers: { authorization: `Bearer ${settings.apiKey}` },
  });
  if (response.status === 401 || response.status === 403) throw new Error("That API key was rejected.");
  if (!response.ok) return null;
  const payload = await response.json();
  const ids = (payload.data || []).map((item) => item?.id);
  return pickChatModel(ids, avoid);
}

const CHROME_MODEL = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

function languageModel() {
  return globalThis.LanguageModel || null;
}

async function chromeModelStatus() {
  const model = languageModel();
  if (!model?.availability) return "unavailable";
  try {
    return await model.availability(CHROME_MODEL);
  } catch {
    return "unavailable";
  }
}

let chromeSession = null;
let chromeSessionKey = "";
let chromeModelDownload = null;
let modelDownloadRatio = 0;
let chromeDownloadAbort = null;
let modelDownloadStartedAt = 0;
let modelDownloadMovedAt = 0;
let modelStalledAt = 0;
let modelStallTimer = 0;
const MODEL_STALL_KEY = "crModelStall";
const MODEL_STALL_MS = 60_000;
const MODEL_STALL_RETRY_MS = 30 * 60_000;
const MODEL_PRELOAD_RETRY_MS = 24 * 60 * 60_000;
const MODEL_STALLED_NOTE = "Chrome's model isn't downloading. Chrome needs about 22 GB of free disk space and a supported device; chrome://on-device-internals shows why.";
const MODEL_UNAVAILABLE_NOTE = "Chrome's model isn't available on this device.";
const MODEL_DOWNLOADING_NOTE = "Chrome is downloading its model. Ask again when that finishes.";

function destroyChromeSession() {
  const session = chromeSession;
  chromeSession = null;
  chromeSessionKey = "";
  try {
    session?.destroy?.();
  } catch {
    // The previous session was already closed.
  }
}

function startChromeModelDownload() {
  const model = languageModel();
  if (!model?.create || chromeModelDownload || chromeSession) return;
  chromeDownloadAbort?.abort();
  const controller = new AbortController();
  chromeDownloadAbort = controller;
  modelDownloadStartedAt = Date.now();
  modelDownloadMovedAt = 0;
  clearInterval(modelStallTimer);
  modelStallTimer = setInterval(() => {
    if (!chromeModelDownload) clearInterval(modelStallTimer);
    else checkModelStall();
  }, 15_000);
  chromeModelDownload = model.create({
    ...CHROME_MODEL,
    signal: controller.signal,
    monitor(download) {
      download.addEventListener("downloadprogress", (event) => {
        const ratio = Number(event.loaded);
        if (!Number.isFinite(ratio)) return;
        if (ratio > modelDownloadRatio) modelDownloadMovedAt = Date.now();
        modelDownloadRatio = Math.max(modelDownloadRatio, Math.min(0.99, ratio));
      });
    },
  }).then((session) => {
    if (controller.signal.aborted) {
      session?.destroy?.();
      return false;
    }
    destroyChromeSession();
    chromeSession = session;
    modelStalledAt = 0;
    chrome.storage.local.remove(MODEL_STALL_KEY).catch(() => {});
    return true;
  }).catch(() => false).finally(() => {
    if (chromeDownloadAbort !== controller) return;
    chromeDownloadAbort = null;
    chromeModelDownload = null;
    modelDownloadRatio = 0;
    modelDownloadStartedAt = 0;
    modelDownloadMovedAt = 0;
  });
}

function checkModelStall() {
  if (!chromeModelDownload) return false;
  const since = modelDownloadMovedAt || modelDownloadStartedAt;
  if (Date.now() - since < MODEL_STALL_MS) return false;
  modelStalledAt = Date.now();
  chrome.storage.local.set({ [MODEL_STALL_KEY]: modelStalledAt }).catch(() => {});
  clearInterval(modelStallTimer);
  chromeDownloadAbort?.abort();
  chromeDownloadAbort = null;
  chromeModelDownload = null;
  modelDownloadRatio = 0;
  modelDownloadStartedAt = 0;
  modelDownloadMovedAt = 0;
  return true;
}

async function modelRecentlyStalled(span = MODEL_STALL_RETRY_MS) {
  if (!modelStalledAt) {
    try {
      modelStalledAt = Number((await chrome.storage.local.get(MODEL_STALL_KEY))[MODEL_STALL_KEY]) || 0;
    } catch {
      modelStalledAt = 0;
    }
  }
  return modelStalledAt > 0 && Date.now() - modelStalledAt < span;
}

async function preloadChromeModel(state) {
  if (state.settings.apiKey || state.settings.useAi === false) return "";
  const status = await chromeModelStatus();
  if (status !== "downloadable" && status !== "downloading") return status;
  if (chromeModelDownload || await modelRecentlyStalled(MODEL_PRELOAD_RETRY_MS)) return status;
  startChromeModelDownload();
  return status;
}

function modelDownloadNote() {
  return chromeModelIsDownloading() ? " Chrome's model is downloading." : "";
}

async function askChrome(system, user) {
  const model = languageModel();
  if (!model?.create) throw new Error("Chrome model unavailable");
  if (!chromeSession || chromeSessionKey !== system) {
    destroyChromeSession();
    chromeDownloadAbort?.abort();
    let sampling = {};
    try {
      const params = await model.params();
      const topK = Number(params?.defaultTopK);
      const temperature = Math.min(0.2, Number(params?.maxTemperature));
      if (topK > 0 && Number.isFinite(temperature)) sampling = { temperature, topK };
    } catch {
      sampling = {};
    }
    chromeSession = await model.create({
      ...CHROME_MODEL,
      ...sampling,
      initialPrompts: [{ role: "system", content: system }],
    });
    chromeSessionKey = system;
  }
  const input = String(user || "");
  const copies = [];
  const freshSession = async () => {
    try {
      const copy = typeof chromeSession.clone === "function" ? await chromeSession.clone() : null;
      if (copy) copies.push(copy);
      return copy || chromeSession;
    } catch {
      return chromeSession;
    }
  };
  try {
    try {
      const constrained = await promptWithin(await freshSession(), input, { responseConstraint: CHROME_PICK_SCHEMA });
      if (constrained.trim()) {
        chromeLastFailed = false;
        return constrained;
      }
    } catch {
      // The schema was rejected, or the reply ran past Chrome's output limit or our clock. Ask again in plain text.
    }
    const plain = await promptWithin(await freshSession(), input);
    chromeLastFailed = !plain.trim();
    return plain;
  } catch (error) {
    chromeLastFailed = true;
    if (!copies.length) destroyChromeSession();
    throw error;
  } finally {
    for (const copy of copies) {
      try {
        copy.destroy();
      } catch {
        // The copy was already closed.
      }
    }
    if (!copies.length) destroyChromeSession();
  }
}

const CHROME_PROMPT_MS = 45000;

async function promptWithin(session, input, options = {}) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), CHROME_PROMPT_MS);
  try {
    return String(await session.prompt(input, { ...options, signal: stop.signal }) || "");
  } finally {
    clearTimeout(timer);
  }
}

let chromeLastFailed = false;
let remoteHealth = { ok: null, error: "" };

async function modelStatus() {
  const state = await loadState();
  const hasKey = Boolean(state.settings.apiKey);
  let availability = "";
  let availabilityError = false;
  const model = languageModel();
  if (!hasKey && model?.availability) {
    try {
      availability = await model.availability(CHROME_MODEL);
    } catch {
      availabilityError = true;
    }
  }
  return describeModelStatus({
    hasKey,
    modelName: state.settings.model,
    remoteOk: remoteHealth.ok,
    remoteError: remoteHealth.error,
    chromePresent: Boolean(model?.availability),
    availability,
    availabilityError,
    downloading: chromeModelIsDownloading(),
    progress: modelDownloadRatio,
    stalled: await modelRecentlyStalled(),
    chromeFailed: chromeLastFailed,
  });
}

function chromeModelIsDownloading() {
  checkModelStall();
  return Boolean(chromeModelDownload);
}

async function answerWithChrome(system, user, candidates) {
  const status = await chromeModelStatus();
  if (status === "available" || (chromeSession && !chromeModelDownload)) {
    try {
      const parsed = resolveModelResults(candidates, await askChrome(system, user));
      if (!parsed.ok) return { ok: false, failed: true };
      return { ok: true, parsed };
    } catch {
      return { ok: false, failed: true };
    }
  }
  if (status === "downloadable" || status === "downloading") {
    if (chromeModelIsDownloading()) return { ok: false, downloading: true };
    if (await modelRecentlyStalled()) return { ok: false, failed: true, note: MODEL_STALLED_NOTE };
    startChromeModelDownload();
    if (chromeModelDownload) return { ok: false, downloading: true };
  }
  return { ok: false, failed: true, note: status === "unavailable" ? MODEL_UNAVAILABLE_NOTE : "" };
}

async function complete(state, body) {
  try {
    const payload = await completeOnce(state, body);
    remoteHealth = { ok: true, error: "" };
    return payload;
  } catch (error) {
    remoteHealth = { ok: false, error: String(error?.message || "") };
    throw error;
  }
}

async function completeOnce(state, body) {
  let response = await postChat(state.settings, body);
  if (!response.ok) {
    const info = await readModelError(response);
    if (info.missing) {
      const picked = await resolveModel(state.settings, body.model);
      if (picked && picked !== body.model) {
        state.settings = applySettingsPatch(state.settings, { model: picked });
        await saveState(state);
        response = await postChat(state.settings, { ...body, model: picked });
        if (!response.ok) throw new Error(`Model request failed (${response.status})`);
        return response.json();
      }
    }
    throw new Error(info.message || `Model request failed (${info.status})`);
  }
  return response.json();
}

function pageContext(state) {
  const observation = state.lastObservation;
  const candidates = buildCandidates(state, observation, Date.now());
  const current = candidates.find((candidate) => candidate.id === observation?.currentKey) || null;
  return { observation, candidates, current };
}

function makeView(state, observation) {
  const { candidates, current } = observation
    ? {
        candidates: buildCandidates(state, observation, Date.now()),
        current: null,
      }
    : { candidates: [], current: null };
  const resolvedCurrent = candidates.find((candidate) => candidate.id === observation?.currentKey) || current;
  const marks = {};
  const seriesIds = new Set();
  for (const candidate of candidates) if (candidate.seriesId) seriesIds.add(candidate.seriesId);
  for (const sighting of observation?.sightings || []) seriesIds.add(sighting.seriesId);
  for (const season of observation?.seasons || []) seriesIds.add(season.seriesId);
  for (const seriesId of seriesIds) {
    if (seriesId) marks[seriesId] = seriesCardDecision(seriesId, state.seasons);
  }

  let results = null;
  let notice = "";
  if (observation?.kind === "browse") {
    const ranked = recommend({
      chip: "browse",
      candidates,
      taste: state.taste,
      weights: buildWeights(state),
      currentId: resolvedCurrent?.id || null,
    });
    results = ranked.results;
    notice = ranked.notice;
  }

  const kind = observation?.kind || "browse";
  const currentRecord = resolvedCurrent ? state.seasons?.[resolvedCurrent.id] : null;
  const connected = anilistSession(state.settings).connected;
  return {
    settings: publicSettings(state.settings),
    taste: state.taste,
    tagSuggestions: collectTagSuggestions(state),
    kind,
    url: observation?.url || "",
    currentId: resolvedCurrent?.id || null,
    currentTitle: resolvedCurrent?.title || "",
    currentStatus: resolvedCurrent?.status || "",
    forMe: kind === "series" || kind === "watch" ? isThisForMe(resolvedCurrent, state.taste) : "",
    marks,
    results,
    notice,
    importMeta: state.importMeta,
    progressOffer: connected ? progressOfferFor(currentRecord) : null,
  };
}

function localRecommend(state, chip, skipSequels) {
  const { candidates, current } = pageContext(state);
  return recommend({
    chip,
    skipSeenSequels: skipSequels,
    candidates,
    taste: state.taste,
    weights: buildWeights(state),
    currentId: current?.id || null,
  });
}

async function pageUpdate(observation, sender) {
  if (!observation || typeof observation !== "object") throw new Error("Missing page");
  let state = await loadState();
  const now = Date.now();
  state = applyObservations(state, observation, now);
  rememberImportMatches(state, queriesForObservation(state, observation, now), now);
  applyCachedIdentity(state, now);
  applyImportedSightings(state, now);
  state.lastObservation = observation;
  await saveState(state);
  const tabId = sender.tab?.id;
  if (tabId != null) {
    const token = ++enrichToken;
    enrich(tabId, token).catch(() => {});
  }
  return { view: makeView(state, observation) };
}

async function enrich(tabId, token) {
  const started = await loadState();
  const observation = started.lastObservation;
  if (!observation) return;
  const queries = queriesForObservation(started, observation, Date.now()).slice(0, 8);
  const updates = {};
  for (const query of queries) {
    if (token !== enrichToken) return;
    try {
      const payload = await anilist(SEARCH_QUERY, { search: query.search });
      const media = payload?.data?.Page?.media || [];
      const match = matchTitleToMedia(query.matchTitle, media);
      updates[query.cacheKey] = match.confidence === "high"
        ? mediaToCacheHit(match.media, Date.now())
        : missEntry(Date.now());
    } catch {
      break;
    }
    await delay(280);
  }
  if (!Object.keys(updates).length || token !== enrichToken) return;

  const fresh = await loadState();
  if (token !== enrichToken) return;
  fresh.anilistCache = { ...fresh.anilistCache, ...updates };
  applyCachedIdentity(fresh, Date.now());
  applyImportedSightings(fresh, Date.now());
  await saveState(fresh);
  try {
    await chrome.tabs.sendMessage(tabId, { type: "enriched", view: makeView(fresh, fresh.lastObservation) });
  } catch {
    // The tab can close before enrichment finishes.
  }
}

function resolveAnilistId(state, record) {
  if (!record) return null;
  if (record.anilistId) return record.anilistId;
  const key = record.seriesLevel
    ? cacheKeyForSeries(record.seriesId)
    : cacheKeyForSeason(record.seriesId, record.seasonSlug);
  const cache = readCache(state.anilistCache, key, Date.now());
  return cache?.kind === "hit" ? cache.anilistId : null;
}

async function saveListEntry(token, input) {
  const variables = { mediaId: input.mediaId, status: input.status };
  if (input.progress != null) variables.progress = input.progress;
  const payload = await anilist(SAVE_ENTRY_MUTATION, variables, token);
  const saved = payload?.data?.SaveMediaListEntry;
  if (!saved?.id) throw new Error("AniList did not save that entry.");
  return saved;
}

async function deleteListEntry(session, record) {
  let listId = record.anilistListId || null;
  if (!listId && session.viewerId && record.anilistId) {
    const payload = await anilist(MEDIA_LIST_QUERY, { mediaId: record.anilistId, userId: session.viewerId }, session.token);
    listId = payload?.data?.MediaList?.id || null;
  }
  if (!listId) return;
  await anilist(DELETE_ENTRY_MUTATION, { id: listId }, session.token);
}

async function updateStatus(id, status) {
  if (!STATUSES.has(status)) throw new Error("Unknown status");
  if (!id) throw new Error("Missing title");
  let state = await loadState();
  state = setRecordStatus(state, id, status, Date.now());
  const session = anilistSession(state.settings);
  let syncNote = "";
  if (session.connected) {
    const record = state.seasons[id];
    const mediaId = resolveAnilistId(state, record);
    if (record && mediaId) {
      record.anilistId = mediaId;
      if (!record.anilistListId && state.imports?.[mediaId]?.listId) {
        record.anilistListId = state.imports[mediaId].listId;
      }
      try {
        if (status == null) {
          await deleteListEntry(session, record);
          delete state.imports[mediaId];
          record.statusSource = null;
          record.anilistListId = null;
          record.listProgress = null;
          syncNote = "Removed from your AniList list.";
        } else {
          const saved = await saveListEntry(session.token, saveEntryInput(record, status));
          const mapped = status;
          record.statusSource = "anilist";
          record.anilistListId = saved.id;
          record.listProgress = saved.progress ?? record.listProgress;
          if (saved.progress != null) record.episodesWatched = saved.progress;
          const previous = state.imports[mediaId] || {};
          state.imports[mediaId] = {
            ...previous,
            anilistId: mediaId,
            listId: saved.id,
            status: mapped,
            progress: saved.progress ?? previous.progress ?? null,
            media: previous.media || null,
          };
          syncNote = "Updated your AniList list.";
        }
      } catch (error) {
        record.statusSource = "user";
        syncNote = `Saved on this device. AniList was not updated: ${error.message}`;
      }
    } else {
      syncNote = "Saved on this device. No AniList match for this season yet.";
    }
  }
  await saveState(state);
  return { view: makeView(state, state.lastObservation), syncNote };
}

async function syncAnilistProgress(id) {
  const state = await loadState();
  const session = anilistSession(state.settings);
  if (!session.connected) throw new Error("Connect AniList in extension settings first.");
  const record = state.seasons?.[id];
  const offer = progressOfferFor(record);
  if (!offer) throw new Error("AniList is already caught up.");
  const saved = await saveListEntry(session.token, {
    mediaId: record.anilistId,
    status: toAnilistStatus(offer.status),
    progress: offer.to,
  });
  record.status = offer.status;
  record.statusSource = "anilist";
  record.listProgress = saved.progress ?? offer.to;
  record.episodesWatched = record.listProgress;
  record.crEpisode = offer.to;
  record.anilistListId = saved.id;
  const previous = state.imports[record.anilistId] || {};
  state.imports[record.anilistId] = {
    ...previous,
    anilistId: record.anilistId,
    listId: saved.id,
    status: offer.status,
    progress: record.listProgress,
    media: previous.media || null,
  };
  await saveState(state);
  return { view: makeView(state, state.lastObservation), syncNote: `AniList progress updated to episode ${record.listProgress}.` };
}

async function updateTaste(taste) {
  const state = await loadState();
  state.taste = sanitizeTaste(taste);
  await saveState(state);
  return { view: makeView(state, state.lastObservation) };
}

async function updateSettings(patch) {
  const state = await loadState();
  const clean = {};
  for (const key of ["apiKey", "baseUrl", "model", "anilistUsername", "anilistClientId", "panelOpen", "panelCorner", "hideWatched", "useAi"]) {
    if (patch?.[key] !== undefined) clean[key] = patch[key];
  }
  state.settings = applySettingsPatch(state.settings, clean);
  if (typeof clean.apiKey === "string" && clean.apiKey) {
    const picked = await resolveModel(state.settings);
    if (picked) state.settings = applySettingsPatch(state.settings, { model: picked });
  }
  await saveState(state);
  return {
    view: makeView(state, state.lastObservation),
    originOk: await originAllowed(state.settings.baseUrl),
    origin: new URL(state.settings.baseUrl).origin,
    model: state.settings.model,
  };
}

function storeImportedList(state, entries, meta) {
  state.imports = {};
  for (const entry of entries) state.imports[entry.anilistId] = entry;
  state.importMeta = meta;
  state.anilistCache = clearMisses(state.anilistCache);
  if (meta.source === "public") {
    for (const season of Object.values(state.seasons)) {
      if (season.statusSource === "anilist") season.statusSource = null;
    }
  }
  if (meta.source === "account") {
    for (const season of Object.values(state.seasons)) {
      if (season.statusSource === "user") season.statusSource = null;
    }
  }
  const now = Date.now();
  if (state.lastObservation) {
    rememberImportMatches(state, queriesForObservation(state, state.lastObservation, now), now);
  }
  applyCachedIdentity(state, now, { force: meta.source === "account" });
  applyImportedSightings(state, now);
}

function applyImportedSightings(state, now) {
  const source = state.importMeta?.source;
  if (source !== "account" && source !== "public") return;
  const account = source === "account";
  for (const sighting of Object.values(state.sightings || {})) {
    const specific = Object.values(state.seasons).some((season) => season.seriesId === sighting.seriesId && !season.seriesLevel);
    if (specific) continue;
    const cache = readCache(state.anilistCache, cacheKeyForSeries(sighting.seriesId), now);
    if (cache?.kind !== "hit") continue;
    const imported = state.imports?.[cache.anilistId];
    if (!imported) continue;
    const key = seriesMarkKey(sighting.seriesId);
    const previous = state.seasons[key];
    if (previous?.statusSource === "user") continue;
    if (!account && previous?.statusSetByUser) continue;
    state.seasons[key] = {
      ...(previous || {}),
      key,
      seriesId: sighting.seriesId,
      seasonSlug: "*",
      seriesLevel: true,
      seriesTitle: previous?.seriesTitle || sighting.title || "",
      url: previous?.url || sighting.url || "",
      status: imported.status,
      statusSource: account ? "anilist" : null,
      statusSetByUser: false,
      anilistId: cache.anilistId,
      anilistListId: imported.listId ?? previous?.anilistListId ?? null,
      listProgress: imported.progress ?? null,
      franchiseKey: cache.franchiseKey || previous?.franchiseKey || `cr:${sighting.seriesId}`,
      episodesWatched: imported.progress ?? previous?.episodesWatched ?? null,
      audio: sighting.audio || previous?.audio || "unknown",
      genres: sighting.genres?.length ? sighting.genres : previous?.genres || [],
      lastSeenAt: sighting.lastSeenAt || previous?.lastSeenAt || now,
      updatedAt: now,
    };
  }
}

async function pullAccountList(state) {
  const session = anilistSession(state.settings);
  if (!session.connected) throw new Error("Connect AniList in extension settings first.");
  const payload = await anilist(LIST_QUERY, { userName: session.viewerName }, session.token);
  const entries = flattenListCollection(payload);
  storeImportedList(state, entries, {
    username: session.viewerName,
    importedAt: Date.now(),
    source: "account",
  });
  return entries.length;
}

let pendingAuth = null;

function considerAuthNavigation(tabId, url, frameId) {
  if (!pendingAuth || pendingAuth.tabId !== tabId) return;
  if (frameId != null && frameId !== 0) return;
  if (!url || !url.startsWith(pendingAuth.redirectUri)) return;
  const current = pendingAuth;
  pendingAuth = null;
  clearTimeout(current.timer);
  chrome.tabs.remove(tabId).catch(() => {});
  current.resolve(url);
}

function watchAuthNavigation(details) {
  considerAuthNavigation(details.tabId, details.url, details.frameId);
}

chrome.webNavigation.onBeforeNavigate.addListener(watchAuthNavigation);
chrome.webNavigation.onCommitted.addListener(watchAuthNavigation);
chrome.webNavigation.onErrorOccurred.addListener(watchAuthNavigation);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(watchAuthNavigation);
chrome.tabs.onUpdated.addListener((tabId, info) => {
  considerAuthNavigation(tabId, info.url, 0);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (!pendingAuth || pendingAuth.tabId !== tabId) return;
  const current = pendingAuth;
  pendingAuth = null;
  clearTimeout(current.timer);
  current.reject(new Error("The AniList tab was closed before sign-in finished."));
});

async function exchangeAnilistCode({ clientId, clientSecret, redirectUri, code }) {
  const response = await fetch("https://anilist.co/api/v2/oauth/token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(anilistTokenBody(clientId, clientSecret, redirectUri, code)),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    const codeName = payload?.error || "";
    if (codeName === "invalid_client") {
      throw new Error("AniList rejected the client secret. Copy it again from your AniList app.");
    }
    throw new Error(payload?.message || payload?.hint || `AniList returned ${response.status}`);
  }
  return { token: payload.access_token, expiresIn: Number(payload.expires_in) || 0 };
}

async function startAnilistAuth({ clientId, clientSecret }) {
  const cleanId = validateClientId(clientId);
  if (!cleanId) throw new Error("AniList client id should be the number from your AniList app.");
  const saved = await loadState();
  const secret = validateClientSecret(clientSecret) || validateClientSecret(saved.settings.anilistClientSecret);
  if (!secret) throw new Error("Paste the client secret from your AniList app. AniList requires it to finish sign-in.");
  if (pendingAuth) {
    const previous = pendingAuth;
    pendingAuth = null;
    clearTimeout(previous.timer);
    chrome.tabs.remove(previous.tabId).catch(() => {});
    previous.reject(new Error("Started another AniList sign-in."));
  }
  const redirectUri = chrome.identity.getRedirectURL();
  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  const redirected = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pendingAuth || pendingAuth.tabId !== tab.id) return;
      pendingAuth = null;
      chrome.tabs.remove(tab.id).catch(() => {});
      reject(new Error("AniList sign-in timed out. Try Connect again."));
    }, 3 * 60 * 1000);
    pendingAuth = { tabId: tab.id, redirectUri, resolve, reject, timer };
  });
  try {
    await chrome.tabs.update(tab.id, { url: anilistAuthUrl(cleanId, redirectUri) });
  } catch (error) {
    if (pendingAuth?.tabId === tab.id) {
      const current = pendingAuth;
      pendingAuth = null;
      clearTimeout(current.timer);
      chrome.tabs.remove(tab.id).catch(() => {});
      current.reject(error);
    }
  }
  const parsed = parseCodeRedirect(await redirected);
  if (parsed.error) throw new Error(parsed.error);
  const exchanged = await exchangeAnilistCode({
    clientId: cleanId,
    clientSecret: secret,
    redirectUri,
    code: parsed.code,
  });
  const latest = await loadState();
  latest.settings = { ...latest.settings, anilistClientId: cleanId, anilistClientSecret: secret };
  await saveState(latest);
  return connectAnilist({ token: exchanged.token, expiresIn: exchanged.expiresIn, clientId: cleanId });
}

async function connectAnilist({ token, expiresIn, clientId }) {
  const cleanId = String(clientId || "").trim();
  if (!/^\d{1,20}$/.test(cleanId)) throw new Error("Enter the AniList client id.");
  if (!token) throw new Error("AniList did not return a token.");
  const expiresAt = Date.now() + Math.max(0, Number(expiresIn) || 0) * 1000;
  if (expiresAt <= Date.now()) throw new Error("AniList token expired. Connect again.");
  const viewerPayload = await anilist(VIEWER_QUERY, {}, token);
  const viewer = viewerPayload?.data?.Viewer;
  if (!viewer?.id || !viewer?.name) throw new Error("Could not read the AniList account.");
  const state = await loadState();
  state.settings = {
    ...state.settings,
    anilistClientId: cleanId,
    anilistToken: token,
    anilistExpiresAt: expiresAt,
    anilistViewerId: viewer.id,
    anilistViewerName: viewer.name,
  };
  const imported = await pullAccountList(state);
  await saveState(state);
  return { view: makeView(state, state.lastObservation), imported, viewerName: viewer.name };
}

async function disconnectAnilist() {
  const state = await loadState();
  state.settings = {
    ...state.settings,
    anilistToken: "",
    anilistExpiresAt: 0,
    anilistViewerId: null,
    anilistViewerName: "",
  };
  await saveState(state);
  return { view: makeView(state, state.lastObservation) };
}

async function refreshAnilist() {
  const state = await loadState();
  const imported = await pullAccountList(state);
  await saveState(state);
  return { view: makeView(state, state.lastObservation), imported };
}

async function importAnilist(username) {
  const name = String(username || "").trim();
  if (!/^[\w-]{2,50}$/.test(name)) throw new Error("Enter a public AniList username.");
  const state = await loadState();
  if (anilistSession(state.settings).connected) {
    throw new Error("Disconnect AniList to import a public username instead.");
  }
  const payload = await anilist(LIST_QUERY, { userName: name });
  const entries = flattenListCollection(payload);
  state.settings = applySettingsPatch(state.settings, { anilistUsername: name });
  storeImportedList(state, entries, { username: name, importedAt: Date.now(), source: "public" });
  await saveState(state);
  return { view: makeView(state, state.lastObservation), imported: entries.length };
}

function presentFromModel(candidates, parsed) {
  const rows = [...(parsed.results || []), ...(parsed.mentions || [])];
  return rows.map((item) => {
    const candidate = candidates.find((entry) => entry.id === item.id);
    return {
      id: item.id,
      title: candidate?.title || item.id,
      url: candidate?.url || "",
      reason: item.reason,
      rank: item.mention ? null : item.rank ?? null,
      confidence: item.mention ? null : item.confidence ?? null,
      mention: Boolean(item.mention),
      tags: [...(candidate?.tags || []), ...(candidate?.genres || [])].slice(0, 6),
      status: candidate?.status || null,
      audio: candidate?.audio || "unknown",
      poster: candidate?.poster || "",
    };
  });
}

async function chat(text) {
  const request = String(text || "").trim();
  if (!request) throw new Error("Enter a request.");
  const state = await loadState();
  const { candidates, current } = pageContext(state);
  const local = interpretLocalRequest(request);
  const fallbackChip = local?.chip || "unwatched";

  if (!state.settings.apiKey) {
    const ranked = localRecommend(state, fallbackChip, Boolean(local?.skipSequels));
    try {
      const chrome = buildChromeMessages({
        taste: state.taste,
        candidates,
        userText: request,
        chip: local?.chip || null,
      });
      const answer = await answerWithChrome(chrome.system, chrome.user, chrome.candidates);
      if (answer.ok) {
        return { results: presentFromModel(candidates, answer.parsed), notice: "", note: "", skippedUnmatched: 0 };
      }
      if (answer.downloading) {
        return { ...ranked, note: MODEL_DOWNLOADING_NOTE, downloading: true, progress: modelDownloadRatio };
      }
      return { ...ranked, note: answer.note || "Chrome's model could not be used." };
    } catch {
      return { ...ranked, note: "Chrome's model could not be used." };
    }
  }

  try {
    const payload = await complete(state, buildChatBody({
      model: state.settings.model,
      taste: state.taste,
      candidates,
      userText: request,
      chip: local?.chip || null,
    }));
    const parsed = resolveModelResults(candidates, messageText(payload));
    if (!parsed.ok) throw new Error("No usable recommendations");
    return {
      results: presentFromModel(candidates, parsed),
      notice: "",
      note: "",
      skippedUnmatched: 0,
    };
  } catch {
    const ranked = localRecommend(state, fallbackChip, Boolean(local?.skipSequels));
    return { ...ranked, note: "Assistant is offline. Showing local matches." };
  }
}

async function refine() {
  const state = await loadState();
  const { current } = pageContext(state);
  const draft = isThisForMe(current, state.taste);
  if (!state.settings.apiKey) {
    try {
      const body = buildRefineBody({ model: "chrome", taste: state.taste, candidate: current, draft });
      if ((await chromeModelStatus()) === "available") {
        const text = (await askChrome(body.messages[0].content, body.messages[1].content)).replace(/\s+/g, " ").trim().slice(0, 400);
        if (text) return { forMe: text, note: "" };
      }
    } catch {
      return { forMe: draft, note: "" };
    }
    return { forMe: draft, note: "" };
  }
  try {
    const payload = await complete(state, buildRefineBody({
      model: state.settings.model,
      taste: state.taste,
      candidate: current,
      draft,
    }));
    const text = messageText(payload).replace(/\s+/g, " ").trim().slice(0, 400);
    if (!text) throw new Error("empty");
    return { forMe: text, note: "" };
  } catch {
    return { forMe: draft, note: "Assistant is offline." };
  }
}

let catalogToken = "";
let catalogLocale = "en-US";
let catalogJob = null;
let anilistCatalogPass = false;
let catalogUi = { running: false, progress: 0, note: "", series: 0, movie: 0 };

function finishCatalogUi() {
  if (catalogJob || anilistCatalogPass) return;
  catalogUi.running = false;
  catalogUi.progress = 1;
  catalogUi.automatic = false;
}

function noteScrape(type, loaded, total, page) {
  const fraction = total > 0 ? Math.min(1, loaded / total) : Math.min(1, (page + 1) / 80);
  if (type === "movie_listing") catalogUi.movie = fraction;
  else catalogUi.series = fraction;
  catalogUi.running = true;
  catalogUi.progress = ((catalogUi.series + catalogUi.movie) / 2) * 0.7;
  if (catalogUi.automatic) catalogUi.phase = "Gathering the Crunchyroll list";
}
let anilistCatalogAbort = null;

async function loadCatalog() {
  const stored = await chrome.storage.local.get(CATALOG_KEY);
  return normalizeCatalog(stored[CATALOG_KEY]);
}

async function saveCatalog(catalog) {
  await chrome.storage.local.set({ [CATALOG_KEY]: catalog });
}

function validBearer(token) {
  return typeof token === "string" && token.length >= 20 && token.length <= 4000 && !/\s/.test(token);
}

async function currentToken() {
  if (validBearer(catalogToken)) return catalogToken;
  try {
    const stored = await chrome.storage.session.get(["crCatalogToken", "crCatalogLocale"]);
    catalogToken = validBearer(stored.crCatalogToken) ? stored.crCatalogToken : "";
    if (stored.crCatalogLocale) catalogLocale = normalizeLocale(stored.crCatalogLocale);
  } catch {
    catalogToken = "";
  }
  return catalogToken;
}

async function crGet(token, url) {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
    },
  });
  if (response.status === 401 || response.status === 403) {
    catalogToken = "";
    throw new Error("Crunchyroll session expired. Reload the page.");
  }
  if (!response.ok) throw new Error(`Crunchyroll returned ${response.status}`);
  return response.json();
}

async function syncCatalog({ forceMatch = false } = {}) {
  const token = await currentToken();
  if (!validBearer(token)) {
    finishCatalogUi();
    return;
  }
  catalogUi.running = true;
  catalogUi.series = 0;
  catalogUi.movie = 0;
  catalogUi.progress = 0;
  if (!catalogUi.note) catalogUi.note = "Updating the Crunchyroll list and AniList matches.";
  let catalog = await loadCatalog();
  catalog = { ...catalog, attemptedAt: Date.now(), locale: catalogLocale };
  await saveCatalog(catalog);
  const seen = new Set();
  try {
    const fresh = await crGet(token, browseRequestUrl({
      start: 0,
      type: "series",
      locale: catalogLocale,
      sort: "newly_added",
      pageSize: 24,
    }));
    const newest = parseBrowsePayload(fresh).items.slice(0, 24);
    for (const item of newest) if (item?.id) seen.add(item.id);
    catalog = { ...catalog, newest };
    await saveCatalog(catalog);
  } catch {
    // The popular list can still load if the new-release page fails.
  }
  for (const type of ["series", "movie_listing"]) {
    let start = 0;
    for (let page = 0; page < 80; page += 1) {
      const payload = await crGet(await currentToken(), browseRequestUrl({ start, type, locale: catalogLocale }));
      const parsed = parseBrowsePayload(payload);
      for (const item of parsed.items) if (item?.id) seen.add(item.id);
      catalog = { ...catalog, items: mergeCatalogItems(catalog.items, parsed.items), complete: false };
      await saveCatalog(catalog);
      const loaded = start + parsed.items.length;
      noteScrape(type, loaded, parsed.total || (parsed.items.length < 50 ? loaded : 0), page);
      if (!parsed.items.length) break;
      if (parsed.total != null && start + parsed.items.length >= parsed.total) break;
      if (parsed.items.length < 50) break;
      start += parsed.items.length;
      await delay(120);
    }
  }
  if (!seen.size) {
    finishCatalogUi();
    return;
  }
  for (const item of catalog.newest || []) if (item?.id) seen.add(item.id);
  catalog.items = retainSeenCatalog(catalog.items, seen);
  catalog.newest = retainSeenCatalog(catalog.newest, seen);
  catalog.updatedAt = Date.now();
  catalog.complete = true;
  catalogUi.progress = 0.7;
  await saveCatalog(catalog);
  const freshState = await loadState();
  freshState.anilistCache = dropUnusedSeriesCache(freshState.anilistCache, seen);
  await saveState(freshState);
  startAnilistCatalogMatch({ force: forceMatch });
}

function startAnilistCatalogMatch({ force = false } = {}) {
  if (anilistCatalogPass && !force) return;
  anilistCatalogAbort?.abort();
  anilistCatalogPass = true;
  const controller = new AbortController();
  anilistCatalogAbort = controller;
  matchCatalogCovers(controller.signal).catch((error) => {
    if (error?.name === "AbortError") return;
  }).finally(() => {
    if (anilistCatalogAbort !== controller) return;
    anilistCatalogPass = false;
    finishCatalogUi();
  });
}

async function runCatalogProtocol() {
  const state = await loadState();
  const catalog = await loadCatalog();
  const token = await currentToken();
  modelStalledAt = 0;
  await chrome.storage.local.remove(MODEL_STALL_KEY).catch(() => {});
  await preloadChromeModel(state);
  const modelNote = modelDownloadNote();
  if (!validBearer(token)) {
    if (!catalog.items.length) return { note: `Open Crunchyroll while signed in so the catalog can load.${modelNote}`, running: false, progress: 0 };
    state.anilistCache = clearSeriesMisses(state.anilistCache);
    await saveState(state);
    catalogUi = { ...catalogUi, running: true, progress: 0.7, note: `Crunchyroll session expired. Matching saved titles with AniList.${modelNote}` };
    startAnilistCatalogMatch({ force: true });
    return { note: catalogUi.note, running: true, progress: catalogUi.progress };
  }
  if (catalogJob || anilistCatalogPass) {
    return { note: catalogUi.note || `Catalog update is already running.${modelNote}`, running: true, progress: catalogUi.progress };
  }
  anilistCatalogAbort?.abort();
  state.anilistCache = clearSeriesMisses(state.anilistCache);
  await saveState(state);
  catalogUi = {
    running: true,
    progress: 0,
    note: `Updating the Crunchyroll list and AniList matches.${modelNote}`,
    series: 0,
    movie: 0,
  };
  catalogJob = syncCatalog({ forceMatch: true }).catch(() => {
    catalogUi.running = false;
  }).finally(() => {
    catalogJob = null;
    finishCatalogUi();
  });
  return { note: catalogUi.note, running: true, progress: 0 };
}

function catalogProgress() {
  return {
    running: catalogUi.running,
    progress: catalogUi.progress,
    note: catalogUi.note,
    phase: catalogUi.phase || "",
    gathering: Boolean(catalogUi.automatic && catalogUi.running),
    modelDownloading: chromeModelIsDownloading(),
    modelProgress: modelDownloadRatio,
    modelStalled: !chromeModelDownload && modelStalledAt > 0 && Date.now() - modelStalledAt < MODEL_STALL_RETRY_MS,
    modelNote: MODEL_STALLED_NOTE,
  };
}

async function matchCatalogCovers(signal) {
  let state = await loadState();
  let catalog = await loadCatalog();
  const local = localCoverStamps([...catalog.items, ...catalog.newest], state, Date.now());
  if (Object.keys(local.cacheUpdates).length) {
    state.anilistCache = { ...state.anilistCache, ...local.cacheUpdates };
    await saveState(state);
  }
  if (Object.keys(local.stamps).length) {
    catalog = stampCatalogCovers(catalog, local.stamps);
    await saveCatalog(catalog);
  }
  const pending = titlesNeedingAnilist([...catalog.items, ...catalog.newest], state.anilistCache, Date.now());
  if (pending.length) {
    if (catalogUi.automatic) catalogUi.phase = "Matching titles with AniList";
  }
  for (let index = 0; index < pending.length; index += CATALOG_MATCH_BATCH) {
    if (signal?.aborted) return;
    const batch = pending.slice(index, index + CATALOG_MATCH_BATCH);
    const variables = catalogMatchVariables(batch.map((item) => item.title));
    let payload;
    try {
      payload = await anilist(catalogMatchQuery(batch.length), variables, undefined, signal);
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") return;
      if (!/429/.test(String(error?.message))) break;
      await delay(60_000, signal);
      try {
        payload = await anilist(catalogMatchQuery(batch.length), variables, undefined, signal);
      } catch (retryError) {
        if (signal?.aborted || retryError?.name === "AbortError") return;
        break;
      }
    }
    if (signal?.aborted) return;
    catalogUi.running = true;
    catalogUi.progress = 0.7 + (Math.min(pending.length, index + batch.length) / pending.length) * 0.15;
    const result = matchesFromBatch(batch, payload, Date.now());
    const fresh = await loadState();
    fresh.anilistCache = { ...fresh.anilistCache, ...result.cacheUpdates };
    await saveState(fresh);
    if (Object.keys(result.stamps).length) await saveCatalog(stampCatalogCovers(await loadCatalog(), result.stamps));
    await delay(800, signal);
  }
  await fillCatalogDetails(signal);
  catalogUi.progress = 1;
}

async function storeDetailBatch(batch, signal) {
  if (!batch.length || signal?.aborted) return;
  let payload = null;
  try {
    payload = await anilist(mediaDetailQuery(batch.length), mediaDetailVariables(batch), undefined, signal);
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw error;
    if (/429/.test(String(error?.message))) {
      await delay(60_000, signal);
      try {
        payload = await anilist(mediaDetailQuery(batch.length), mediaDetailVariables(batch), undefined, signal);
      } catch (retryError) {
        if (signal?.aborted || retryError?.name === "AbortError") throw retryError;
        payload = null;
      }
    }
    if (!payload && batch.length > 1) {
      const mid = Math.ceil(batch.length / 2);
      await storeDetailBatch(batch.slice(0, mid), signal);
      await storeDetailBatch(batch.slice(mid), signal);
      return;
    }
    if (!payload) return;
  }
  const state = await loadState();
  state.anilistCache = { ...state.anilistCache, ...applyMediaDetails(batch, payload, Date.now(), state.anilistCache) };
  await saveState(state);
}

async function fillCatalogDetails(signal) {
  const state = await loadState();
  const catalog = await loadCatalog();
  const pending = titlesNeedingDetail([...catalog.items, ...catalog.newest], state.anilistCache, Date.now());
  if (!pending.length) return;
  if (catalogUi.automatic) catalogUi.phase = "Matching titles with AniList";
  for (let index = 0; index < pending.length; index += DETAIL_BATCH) {
    if (signal?.aborted) return;
    catalogUi.running = true;
    catalogUi.progress = 0.85 + (Math.min(pending.length, index + DETAIL_BATCH) / pending.length) * 0.15;
    try {
      await storeDetailBatch(pending.slice(index, index + DETAIL_BATCH), signal);
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") return;
      return;
    }
    await delay(800, signal);
  }
}

function applyStoredCovers(catalog, items) {
  const known = new Map();
  for (const item of [...catalog.items, ...catalog.newest]) {
    if (item?.cover) known.set(item.id, item);
  }
  return items.map((item) => {
    const saved = known.get(item.id);
    return saved ? { ...item, cover: saved.cover, anilistId: saved.anilistId || null } : item;
  });
}

async function catalogSession(token, locale) {
  if (!validBearer(token)) return {};
  catalogToken = token;
  catalogLocale = normalizeLocale(locale);
  try {
    await chrome.storage.session.set({ crCatalogToken: catalogToken, crCatalogLocale: catalogLocale });
  } catch {
    // The token for this visit stays in memory.
  }
  const catalog = await loadCatalog();
  preloadChromeModel(await loadState()).catch(() => {});
  if (catalogDue(catalog) && !catalogJob) {
    catalogUi.automatic = true;
    catalogUi.running = true;
    catalogUi.progress = 0;
    catalogUi.phase = "Gathering the Crunchyroll list";
    catalogUi.note = catalogUi.phase;
    catalogJob = syncCatalog().catch(() => {}).finally(() => {
      catalogJob = null;
      finishCatalogUi();
    });
  } else if (catalog.items.length && !catalogJob) {
    startAnilistCatalogMatch();
  }
  return {
    catalog: { count: catalog.items.length, updatedAt: catalog.updatedAt, updating: Boolean(catalogJob) },
    gathering: Boolean(catalogUi.automatic && catalogUi.running),
    phase: catalogUi.phase || "",
  };
}

async function liveSearch(token, query) {
  const [seriesPayload, moviePayload] = await Promise.all([
    crGet(token, searchRequestUrl({ query, type: "series", locale: catalogLocale })),
    crGet(token, searchRequestUrl({ query, type: "movie_listing", locale: catalogLocale })),
  ]);
  const seen = new Set();
  const items = [];
  for (const item of [...parseSearchPayload(seriesPayload), ...parseSearchPayload(moviePayload)]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items;
}

function presentCatalogItem(state, item) {
  const mark = seriesCardDecision(item.id, state.seasons).mark;
  const tags = [item.type === "movie" ? "Movie" : "Series"];
  if (item.episodes) tags.push(`${item.episodes} eps`);
  return {
    id: `sight:${item.id}`,
    title: item.title,
    url: item.url,
    reason: item.type === "movie" ? "Movie on Crunchyroll." : item.episodes ? `${item.episodes} episodes on Crunchyroll.` : "On Crunchyroll.",
    tags,
    status: mark === "unwatched" ? null : mark,
    poster: displayPoster(item),
  };
}

function continueFromCatalog(state, catalog) {
  const byId = new Map((catalog.items || []).map((item) => [item.id, item]));
  const seen = new Set();
  const items = [];
  for (const season of Object.values(state.seasons || {})) {
    if (season.status !== "in_progress" || !season.seriesId || seen.has(season.seriesId)) continue;
    const item = byId.get(season.seriesId);
    if (!item) continue;
    seen.add(season.seriesId);
    items.push(item);
    if (items.length >= 12) break;
  }
  return items;
}

function rememberSightings(state, items) {
  let changed = false;
  for (const item of items) {
    const previous = state.sightings[item.id] || {};
    if (previous.title === item.title && previous.url === item.url && previous.seriesId === item.id) continue;
    changed = true;
    state.sightings[item.id] = {
      seriesId: item.id,
      title: item.title || previous.title || "",
      url: item.url || previous.url || "",
      genres: previous.genres || [],
      audio: previous.audio || "unknown",
      lastSeenAt: previous.lastSeenAt || 0,
    };
  }
  return changed;
}

function labelsForCatalogItem(state, item) {
  const hit = readCache(state.anilistCache, cacheKeyForSeries(item.id), Date.now());
  if (hit?.kind !== "hit") return [];
  return [...(hit.genres || []), ...(hit.tags || [])];
}

function withoutAvoids(state, items) {
  return (items || []).filter((item) => allowedByTaste(labelsForCatalogItem(state, item), state.taste));
}

function tasteRank(state) {
  const weights = buildWeights(state);
  return {
    weights,
    scoreFor: (item) => scoreLabels(labelsForCatalogItem(state, item), weights),
  };
}

function forYouIdsFor(state, catalog, scoreFor) {
  const hide = Boolean(state.settings.hideWatched);
  const statusFor = (id) => seriesCardDecision(id, state.seasons).mark;
  const ranked = withoutAvoids(state, catalog.items || []).filter((item) => {
    const status = statusFor(item.id) || "unwatched";
    if (hide && (status === "finished" || status === "dropped")) return false;
    return status === "unwatched" || status === "plan";
  }).sort((a, b) => scoreFor(b) - scoreFor(a) || String(a.title).localeCompare(String(b.title)));
  return new Set(ranked.slice(0, 24).map((item) => item.id));
}

function presentSuggestion(state, item, forYou, weights) {
  const presented = presentCatalogItem(state, item);
  if (forYou.has(item.id)) {
    presented.reason = "For you";
    return presented;
  }
  const liked = labelsForCatalogItem(state, item).find((label) => weights.liked.has(String(label).toLowerCase()));
  if (liked) presented.reason = liked;
  return presented;
}

function candidateFromCatalogItem(state, item) {
  const hit = readCache(state.anilistCache, cacheKeyForSeries(item.id), Date.now());
  const matched = hit?.kind === "hit" ? hit : null;
  const mark = seriesCardDecision(item.id, state.seasons).mark;
  return {
    id: `sight:${item.id}`,
    title: item.title,
    url: item.url,
    status: mark || "unwatched",
    episodes: matched?.episodes ?? item.episodes ?? null,
    format: matched?.format || (item.type === "movie" ? "MOVIE" : null),
    tags: matched?.tags || [],
    genres: matched?.genres || [],
    audio: "unknown",
    anilistMatched: Boolean(matched),
    poster: displayPoster(item),
    ...showFactsFromHit(matched),
  };
}

const CATALOG_CHIPS = new Set(["unwatched", "one-cour", "movie", "in-progress", "plan", "new"]);

function mergePreferCatalog(savedItems, liveItems) {
  const map = new Map();
  for (const item of savedItems || []) if (item?.id) map.set(item.id, item);
  for (const item of liveItems || []) {
    if (!item?.id) continue;
    const saved = map.get(item.id);
    if (!saved) map.set(item.id, item);
  }
  return [...map.values()];
}

async function collectSearchItems(state, catalog, text, chip, live) {
  const catalogChip = CATALOG_CHIPS.has(chip) ? chip : "";
  let base = chip === "new" ? (catalog.newest || []) : (catalog.items || []);
  if (live && String(text || "").trim().length >= 2) {
    const token = await currentToken();
    if (validBearer(token)) {
      try {
        const found = applyStoredCovers(catalog, await liveSearch(token, text));
        const freshIds = new Set((catalog.newest || []).map((item) => item.id));
        const extra = chip === "new" ? found.filter((item) => freshIds.has(item.id)) : found;
        base = mergePreferCatalog(base, extra);
      } catch {
        // The saved list still ranks when live search misses.
      }
    }
  }
  return withoutAvoids(state, applyCatalogChip(
    base,
    catalogChip,
    Boolean(state.settings.hideWatched),
    (id) => seriesCardDecision(id, state.seasons).mark,
  ));
}

async function catalogSearch(query, chip) {
  const state = await loadState();
  const catalog = await loadCatalog();
  const text = String(query || "").trim();
  const token = await currentToken();
  const catalogChip = chip === "unwatched" || chip === "one-cour" || chip === "movie" || chip === "in-progress" || chip === "plan" || chip === "new";
  if (!text && !catalogChip) {
    const note = !catalog.items.length && !validBearer(token)
      ? "Open Crunchyroll while signed in so the catalog can load."
      : !catalog.complete && catalog.items.length
        ? `Catalog is still downloading. ${catalog.items.length} titles saved so far.`
        : !catalog.items.length
          ? "The catalog has not loaded yet. Stay on Crunchyroll for a moment."
          : "";
    const weights = buildWeights(state);
    const sections = buildHomeSections(
      {
        ...catalog,
        items: withoutAvoids(state, catalog.items),
        newest: withoutAvoids(state, catalog.newest),
        continueItems: withoutAvoids(state, continueFromCatalog(state, catalog)),
      },
      (id) => seriesCardDecision(id, state.seasons).mark,
      Boolean(state.settings.hideWatched),
      (item) => scoreLabels(labelsForCatalogItem(state, item), weights),
    );
    const shown = sections.flatMap((section) => section.items);
    if (rememberSightings(state, shown)) await saveState(state);
    return {
      results: [],
      sections: sections.map((section) => ({
        title: section.title,
        items: section.items.map((item) => presentCatalogItem(state, item)),
      })),
      note,
      notice: "",
    };
  }
  const { weights, scoreFor } = tasteRank(state);
  const forYou = forYouIdsFor(state, catalog, scoreFor);
  const pool = await collectSearchItems(state, catalog, text, chip, true);
  const chosen = rankCatalogSuggestions(pool, text, { scoreFor, forYouIds: forYou, limit: 24 });
  if (rememberSightings(state, chosen)) await saveState(state);
  const note = !chosen.length
    ? "No matches."
    : chip === "new" && !text
      ? "Newly added on Crunchyroll."
      : "";
  return {
    results: chosen.map((item) => presentSuggestion(state, item, forYou, weights)),
    note,
    notice: "",
  };
}

async function catalogSuggest(query, chip) {
  const text = String(query || "").trim();
  if (!text) return { suggestions: [] };
  const state = await loadState();
  const catalog = await loadCatalog();
  const { weights, scoreFor } = tasteRank(state);
  const forYou = forYouIdsFor(state, catalog, scoreFor);
  const pool = await collectSearchItems(state, catalog, text, chip, false);
  const chosen = rankCatalogSuggestions(pool, text, { scoreFor, forYouIds: forYou, limit: 6 });
  return { suggestions: chosen.map((item) => presentSuggestion(state, item, forYou, weights)) };
}

async function catalogPrompt(text, chip) {
  const request = String(text || "").trim();
  if (!request) throw new Error("Enter a request.");
  const state = await loadState();
  const catalog = await loadCatalog();
  const { scoreFor } = tasteRank(state);
  const wordCount = request.split(/\s+/).filter(Boolean).length;
  const pool = await collectSearchItems(state, catalog, request, chip, wordCount <= 3);
  const scored = scorePromptCandidates(pool, request, {
    scoreFor,
    labelsFor: (item) => labelsForCatalogItem(state, item),
    aboutFor: (item) => {
      const hit = readCache(state.anilistCache, cacheKeyForSeries(item.id), Date.now());
      return hit?.kind === "hit" ? hit.about || "" : "";
    },
    statusFor: (item) => seriesCardDecision(item.id, state.seasons).mark || "unwatched",
    limit: 12,
  });
  const chosen = scored.map((entry) => entry.item);
  const fits = promptFits(scored);
  const listed = async (note, extra = {}) => {
    if (rememberSightings(state, chosen)) await saveState(state);
    return {
      results: chosen.map((item) => {
        const presented = presentCatalogItem(state, item);
        const labels = labelsForCatalogItem(state, item);
        const hit = readCache(state.anilistCache, cacheKeyForSeries(item.id), Date.now());
        const brief = promptFallbackBrief(item, request, labels, hit?.kind === "hit" ? hit.about : "");
        if (brief) presented.reason = brief;
        return presented;
      }),
      note,
      notice: "",
      ...extra,
    };
  };
  if (!chosen.length) return { results: [], note: "No matches on your list yet.", notice: "" };
  const candidates = chosen.map((item) => ({ ...candidateFromCatalogItem(state, item), fit: fits.get(item.id) }));
  if (!state.settings.apiKey) {
    try {
      const chrome = buildChromeMessages({
        taste: state.taste,
        candidates,
        userText: request,
        chip: chip || null,
      });
      const answer = await answerWithChrome(chrome.system, chrome.user, chrome.candidates);
      if (answer.downloading) {
        return listed(MODEL_DOWNLOADING_NOTE, {
          downloading: true,
          progress: modelDownloadRatio,
        });
      }
      if (!answer.ok) return listed(answer.note || "Chrome's model could not be used.");
      return { results: presentFromModel(candidates, answer.parsed), notice: "", note: "" };
    } catch {
      return listed("Chrome's model could not answer. Showing your list.");
    }
  }
  try {
    const payload = await complete(state, buildChatBody({
      model: state.settings.model,
      taste: state.taste,
      candidates,
      userText: request,
      chip: chip || null,
      ordered: true,
    }));
    const parsed = resolveModelResults(candidates, messageText(payload));
    if (!parsed.ok) throw new Error("No usable recommendations");
    return { results: presentFromModel(candidates, parsed), notice: "", note: "" };
  } catch {
    return listed("Assistant is offline. Showing your list.");
  }
}

async function handle(message, sender) {
  switch (message?.type) {
    case "pageUpdate":
      return pageUpdate(message.observation, sender);
    case "recommend":
      return localRecommend(await loadState(), message.chip === "skip-sequels" ? "more-like-this" : message.chip, message.chip === "skip-sequels" || message.skipSequels);
    case "chat":
      return chat(message.text);
    case "catalogSession":
      return catalogSession(message.token, message.locale);
    case "catalogSearch":
      return catalogSearch(message.query, message.chip);
    case "catalogSuggest":
      return catalogSuggest(message.query, message.chip);
    case "modelStatus":
      return { status: await modelStatus() };
    case "catalogPrompt":
      return catalogPrompt(message.text, message.chip);
    case "setStatus":
      return updateStatus(message.id, message.status);
    case "setTaste":
      return updateTaste(message.taste);
    case "setSettings":
      return updateSettings(message.patch || {});
    case "clearKey":
      return updateSettings({ apiKey: "" });
    case "importAnilist":
      return importAnilist(message.username);
    case "startAnilistAuth":
      return startAnilistAuth(message);
    case "connectAnilist":
      return connectAnilist(message);
    case "disconnectAnilist":
      return disconnectAnilist();
    case "refreshAnilist":
      return refreshAnilist();
    case "refreshCatalogCovers":
      return runCatalogProtocol();
    case "catalogProgress":
      return catalogProgress();
    case "syncAnilistProgress":
      return syncAnilistProgress(message.id);
    case "refine":
      return refine();
    case "setUi":
      return updateSettings({
        panelOpen: message.panelOpen,
        panelCorner: message.panelCorner,
        hideWatched: message.hideWatched,
      });
    case "openOptions":
      await chrome.runtime.openOptionsPage();
      return {};
    case "getState": {
      const state = await loadState();
      return { view: makeView(state, state.lastObservation) };
    }
    default:
      throw new Error("Unknown message");
  }
}

chrome.runtime.onInstalled.addListener(() => {
  loadState().then(saveState).catch(() => {});
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || "Request failed" }));
  return true;
});
