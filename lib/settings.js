import { cleanKeys, MODELS_VERSION, PROVIDER_IDS, providerById, savedProviders } from "./providers.js";
import { LISTING_SITES } from "./services.js";

export const DAILY_SYNC_MODES = new Set(["off", "preview", "apply"]);
export const OPEN_EPISODES = new Set(["tab-ask", "tab-auto", "window", "new"]);
export const NOTIFICATION_STYLES = new Set(["ask", "silent", "off"]);
export const WHERE_FILTER_MODES = new Set(["host", "remember"]);
export const TRACK_SITE_KEYS = {
  netflix: "trackNetflix",
  tubi: "trackTubi",
  hidive: "trackHidive",
};

export function defaultSettings() {
  return {
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    aiService: "auto",
    apiKeys: {},
    models: {},
    anilistUsername: "",
    anilistClientId: "",
    anilistClientSecret: "",
    anilistToken: "",
    anilistExpiresAt: 0,
    anilistViewerId: null,
    anilistViewerName: "",
    panelOpen: false,
    panelCorner: "bottom-right",
    hideWatched: false,
    useAi: true,
    favorNamed: true,
    episodeDialogs: true,
    askModelDownload: true,
    muteNotifications: false,
    badgeStyle: "glow",
    badgeCorner: "bottom-left",
    badgeSize: "normal",
    badgeProgress: true,
    badgeUnwatched: "hover",
    badgeMotion: "animated",
    liteMode: false,
    openIn: "tab",
    tabManage: true,
    tabAuto: false,
    backButton: true,
    miniPlayer: false,
    showTips: true,
    // Search → Prism: where-to-watch and import opt-ins
    hiddenSites: [],
    readCatalogs: true,
    hideOffSiteShows: true,
    dailySync: false,
    syncApply: false,
    trackNetflix: false,
    trackTubi: false,
    trackHidive: false,
    weeklyTrackerPull: true,
    writeMal: true,
    whereFilterMode: "host",
    lastWhereSite: "",
    favoriteCharacterId: "",
  };
}

const SWITCHES = [
  "panelOpen", "hideWatched", "useAi", "favorNamed", "episodeDialogs", "askModelDownload",
  "muteNotifications", "badgeProgress", "liteMode", "tabManage", "tabAuto", "backButton", "miniPlayer", "showTips",
  "dailySync", "syncApply", "trackNetflix", "trackTubi", "trackHidive",
];
const ON_SWITCHES = ["readCatalogs", "hideOffSiteShows", "weeklyTrackerPull", "writeMal"];
const OPEN_IN = new Set(["tab", "window", "new"]);

const CORNERS = new Set(["bottom-right", "bottom-left", "top-right", "top-left"]);
const BADGE_CHOICES = {
  badgeStyle: new Set(["glow", "tinted", "footer", "corner"]),
  badgeCorner: CORNERS,
  badgeSize: new Set(["small", "normal"]),
  badgeUnwatched: new Set(["hover", "always", "never"]),
  badgeMotion: new Set(["animated", "static"]),
};

function badgeChoice(settings, key) {
  return BADGE_CHOICES[key].has(settings?.[key]) ? settings[key] : defaultSettings()[key];
}

export function dailySyncMode(settings) {
  if (!settings?.dailySync) return "off";
  return settings.syncApply ? "apply" : "preview";
}

export function openEpisodes(settings) {
  const openIn = OPEN_IN.has(settings?.openIn) ? settings.openIn : "tab";
  if (openIn === "window") return "window";
  if (openIn === "new") return "new";
  return settings?.tabAuto ? "tab-auto" : "tab-ask";
}

export function notificationStyle(settings) {
  if (settings?.muteNotifications) return "off";
  if (settings?.episodeDialogs === false) return "silent";
  return "ask";
}

export function trackWhileWatching(settings) {
  return Boolean(settings?.trackNetflix || settings?.trackTubi || settings?.trackHidive);
}

export function whereFilterMode(settings) {
  return WHERE_FILTER_MODES.has(settings?.whereFilterMode) ? settings.whereFilterMode : "host";
}

export function applyDailySyncMode(next, mode) {
  if (!DAILY_SYNC_MODES.has(mode)) return next;
  next.dailySync = mode !== "off";
  next.syncApply = mode === "apply";
  return next;
}

export function applyOpenEpisodes(next, mode) {
  if (!OPEN_EPISODES.has(mode)) return next;
  if (mode === "window") {
    next.openIn = "window";
    next.tabManage = false;
    next.tabAuto = false;
  } else if (mode === "new") {
    next.openIn = "new";
    next.tabManage = false;
    next.tabAuto = false;
  } else if (mode === "tab-auto") {
    next.openIn = "tab";
    next.tabManage = true;
    next.tabAuto = true;
  } else {
    next.openIn = "tab";
    next.tabManage = true;
    next.tabAuto = false;
  }
  return next;
}

export function applyNotificationStyle(next, style) {
  if (!NOTIFICATION_STYLES.has(style)) return next;
  next.muteNotifications = style === "off";
  next.episodeDialogs = style === "ask";
  return next;
}

export function validateBaseUrl(input) {
  let url;
  try {
    url = new URL(String(input || "").trim());
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path === "/" ? "" : path}`;
}

export function validateClientId(input) {
  const clientId = String(input || "").trim();
  if (!/^\d{1,20}$/.test(clientId)) return null;
  return clientId;
}

export function validateClientSecret(input) {
  const secret = String(input || "").trim();
  if (secret.length < 8 || secret.length > 200 || /\s/.test(secret)) return null;
  return secret;
}

export function anilistSession(settings, now = Date.now()) {
  const token = settings?.anilistToken || "";
  const expiresAt = Number(settings?.anilistExpiresAt) || 0;
  const connected = Boolean(token) && expiresAt > now;
  return {
    connected,
    expired: Boolean(token) && !connected,
    token: connected ? token : "",
    expiresAt,
    viewerId: settings?.anilistViewerId || null,
    viewerName: settings?.anilistViewerName || "",
    clientId: settings?.anilistClientId || "",
  };
}

export function validateModel(input) {
  const model = String(input || "").trim();
  if (!model || model.length > 80) return null;
  if (!/^[A-Za-z0-9_.:/-]+$/.test(model)) return null;
  return model;
}

export function withKeys(settings) {
  const next = { ...settings, apiKeys: cleanKeys(settings?.apiKeys), models: { ...(settings?.models || {}) } };
  if (next.apiKey) {
    if (!next.apiKeys.openai) next.apiKeys.openai = String(next.apiKey).trim();
    if (!next.models.openai && next.model) next.models.openai = next.model;
    next.apiKey = "";
  }
  if (next.aiService !== "auto" && !providerById(next.aiService)) next.aiService = "auto";
  if (next.modelsVersion !== MODELS_VERSION) {
    next.models = next.models.openai ? { openai: next.models.openai } : {};
    next.modelsVersion = MODELS_VERSION;
  }
  return next;
}

export function hasRemote(settings) {
  return savedProviders(withKeys(settings || {})).length > 0;
}

export function remoteSignature(raw) {
  const settings = withKeys(raw || {});
  const saved = savedProviders(settings);
  if (!saved.length) return "chrome";
  return [settings.aiService, ...saved.map((provider) => `${provider.id}:${settings.models?.[provider.id] || provider.model}`)].join("|");
}

function modelLabelFor(settings) {
  const saved = savedProviders(settings);
  if (!saved.length) return "Chrome";
  const chosen = settings.aiService !== "auto" ? providerById(settings.aiService) : saved.length === 1 ? saved[0] : null;
  if (!chosen) return "Auto";
  return settings.models?.[chosen.id] || chosen.model;
}

export function publicSettings(raw, now = Date.now()) {
  const settings = withKeys(raw || {});
  const session = anilistSession(settings, now);
  const keys = Object.fromEntries(PROVIDER_IDS.map((id) => [id, Boolean(settings.apiKeys[id])]));
  const published = {
    hasKey: Object.values(keys).some(Boolean),
    keys,
    aiService: settings.aiService || "auto",
    models: Object.fromEntries(PROVIDER_IDS.map((id) => [id, settings.models?.[id] || providerById(id).model])),
    modelLabel: modelLabelFor(settings),
    anilistUsername: settings?.anilistUsername || "",
    anilistConnected: session.connected,
    anilistExpired: session.expired,
    anilistViewerName: session.viewerName,
    anilistClientId: session.clientId,
    hasAnilistSecret: Boolean(settings?.anilistClientSecret),
    panelOpen: Boolean(settings?.panelOpen),
    panelCorner: CORNERS.has(settings?.panelCorner) ? settings.panelCorner : "bottom-right",
    hideWatched: Boolean(settings?.hideWatched),
    useAi: settings?.useAi !== false,
    favorNamed: settings?.favorNamed !== false,
    episodeDialogs: settings?.episodeDialogs !== false,
    askModelDownload: settings?.askModelDownload !== false,
    muteNotifications: Boolean(settings?.muteNotifications),
    badgeStyle: badgeChoice(settings, "badgeStyle"),
    badgeCorner: badgeChoice(settings, "badgeCorner"),
    badgeSize: badgeChoice(settings, "badgeSize"),
    badgeProgress: settings?.badgeProgress !== false,
    badgeUnwatched: badgeChoice(settings, "badgeUnwatched"),
    badgeMotion: badgeChoice(settings, "badgeMotion"),
    liteMode: Boolean(settings?.liteMode),
    openIn: OPEN_IN.has(settings?.openIn) ? settings.openIn : "tab",
    tabManage: settings?.tabManage !== false,
    tabAuto: Boolean(settings?.tabAuto),
    backButton: settings?.backButton !== false,
    miniPlayer: Boolean(settings?.miniPlayer),
    showTips: settings?.showTips !== false,
    hiddenSites: cleanHiddenSites(settings?.hiddenSites),
    readCatalogs: settings?.readCatalogs !== false,
    hideOffSiteShows: settings?.hideOffSiteShows !== false,
    dailySync: Boolean(settings?.dailySync),
    syncApply: Boolean(settings?.syncApply),
    trackNetflix: Boolean(settings?.trackNetflix),
    trackTubi: Boolean(settings?.trackTubi),
    trackHidive: Boolean(settings?.trackHidive),
    weeklyTrackerPull: settings?.weeklyTrackerPull !== false,
    writeMal: settings?.writeMal !== false,
    whereFilterMode: whereFilterMode(settings),
    lastWhereSite: cleanWhereSite(settings?.lastWhereSite),
    favoriteCharacterId: "",
  };
  published.dailySyncMode = dailySyncMode(published);
  published.openEpisodes = openEpisodes(published);
  published.notificationStyle = notificationStyle(published);
  published.trackWhileWatching = trackWhileWatching(published);
  return published;
}

function cleanHiddenSites(value) {
  const known = new Map(LISTING_SITES.map(({ site }) => [site.toLowerCase(), site]));
  const hidden = Array.isArray(value) ? value : [];
  return [...new Set(hidden.map((site) => known.get(String(site).toLowerCase())).filter(Boolean))];
}

function cleanWhereSite(value) {
  const id = String(value || "").trim().toLowerCase();
  if (!id || id === "all") return "";
  const known = new Set(["crunchyroll", "netflix", "hidive", "tubi", "prime", "hulu", "youtube"]);
  return known.has(id) ? id : "";
}

// Import-layer settings shape used by tracker-pull and Search-absorbed helpers.
export function cleanSettings(value) {
  return {
    hiddenSites: cleanHiddenSites(value?.hiddenSites),
    setupDone: value?.setupDone === true,
    dailySync: value?.dailySync === true,
    syncApply: value?.syncApply === true,
    trackNetflix: value?.trackNetflix === true,
    trackTubi: value?.trackTubi === true,
    trackHidive: value?.trackHidive === true,
    readCatalogs: value?.readCatalogs !== false,
    hideOffSiteShows: value?.hideOffSiteShows !== false,
    weeklyTrackerPull: value?.weeklyTrackerPull !== false,
    writeMal: value?.writeMal !== false,
  };
}

export function applySettingsPatch(settings, patch) {
  const next = withKeys({ ...defaultSettings(), ...settings });
  if (typeof patch.apiKey === "string") patch = { ...patch, providerKey: { id: "openai", key: patch.apiKey } };
  if (patch.providerKey) {
    const provider = providerById(patch.providerKey.id);
    if (!provider) throw new Error("Unknown AI service.");
    const key = String(patch.providerKey.key || "").trim();
    if (key && (key.length > 400 || /\s/.test(key))) throw new Error("That key doesn't look right. Paste it again without spaces.");
    next.apiKeys = { ...next.apiKeys };
    if (key) next.apiKeys[provider.id] = key;
    else delete next.apiKeys[provider.id];
  }
  if (patch.clearKeys === true) next.apiKeys = {};
  if (patch.aiService != null) {
    if (patch.aiService !== "auto" && !providerById(patch.aiService)) throw new Error("Unknown AI service.");
    next.aiService = patch.aiService;
  }
  if (patch.providerModel) {
    const provider = providerById(patch.providerModel.id);
    const model = validateModel(patch.providerModel.model);
    if (!provider || !model) throw new Error("Model name looks invalid.");
    next.models = { ...next.models, [provider.id]: model };
  }
  if (patch.baseUrl != null) {
    const baseUrl = validateBaseUrl(patch.baseUrl);
    if (!baseUrl) throw new Error("API base URL must be https, or http on localhost.");
    next.baseUrl = baseUrl;
  }
  if (patch.model != null) {
    const model = validateModel(patch.model);
    if (!model) throw new Error("Model name looks invalid.");
    next.model = model;
    next.models = { ...next.models, openai: model };
  }
  if (typeof patch.anilistUsername === "string") next.anilistUsername = patch.anilistUsername.trim();
  if (patch.anilistClientId != null) {
    const clientId = validateClientId(patch.anilistClientId);
    if (!clientId) throw new Error("AniList client id should be the number from your AniList app.");
    next.anilistClientId = clientId;
  }
  if (CORNERS.has(patch.panelCorner)) next.panelCorner = patch.panelCorner;
  if (OPEN_IN.has(patch.openIn)) next.openIn = patch.openIn;
  for (const [key, allowed] of Object.entries(BADGE_CHOICES)) if (allowed.has(patch[key])) next[key] = patch[key];
  for (const key of SWITCHES) if (typeof patch[key] === "boolean") next[key] = patch[key];
  for (const key of ON_SWITCHES) if (typeof patch[key] === "boolean") next[key] = patch[key];
  if (Array.isArray(patch.hiddenSites)) next.hiddenSites = cleanHiddenSites(patch.hiddenSites);
  if (typeof patch.listingSite === "string" && typeof patch.listingOn === "boolean") {
    const known = new Map(LISTING_SITES.map(({ site }) => [site.toLowerCase(), site]));
    const site = known.get(patch.listingSite.toLowerCase());
    if (site) {
      const hidden = new Set(cleanHiddenSites(next.hiddenSites));
      if (patch.listingOn) hidden.delete(site);
      else hidden.add(site);
      next.hiddenSites = [...hidden];
    }
  }
  if (DAILY_SYNC_MODES.has(patch.dailySyncMode)) applyDailySyncMode(next, patch.dailySyncMode);
  if (OPEN_EPISODES.has(patch.openEpisodes)) applyOpenEpisodes(next, patch.openEpisodes);
  if (NOTIFICATION_STYLES.has(patch.notificationStyle)) applyNotificationStyle(next, patch.notificationStyle);
  if (WHERE_FILTER_MODES.has(patch.whereFilterMode)) next.whereFilterMode = patch.whereFilterMode;
  if (patch.lastWhereSite != null) next.lastWhereSite = cleanWhereSite(patch.lastWhereSite);
  if (typeof patch.trackWhileWatching === "boolean" && !patch.trackWhileWatching) {
    next.trackNetflix = false;
    next.trackTubi = false;
    next.trackHidive = false;
  }
  if (patch.trackWhileWatching === true && Array.isArray(patch.trackSites)) {
    const wanted = new Set(patch.trackSites.map((id) => String(id).toLowerCase()));
    for (const [site, key] of Object.entries(TRACK_SITE_KEYS)) next[key] = wanted.has(site);
  }
  // Favorite character is stored for a later ship; patches are ignored until then.
  return next;
}
