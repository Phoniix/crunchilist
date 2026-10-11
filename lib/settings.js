export function defaultSettings() {
  return {
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
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
  };
}

const CORNERS = new Set(["bottom-right", "bottom-left", "top-right", "top-left"]);

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

export function publicSettings(settings, now = Date.now()) {
  const session = anilistSession(settings, now);
  return {
    hasKey: Boolean(settings?.apiKey),
    baseUrl: settings?.baseUrl || defaultSettings().baseUrl,
    model: settings?.model || defaultSettings().model,
    modelLabel: settings?.apiKey ? (settings?.model || defaultSettings().model) : "Chrome",
    anilistUsername: settings?.anilistUsername || "",
    anilistConnected: session.connected,
    anilistViewerName: session.viewerName,
    anilistClientId: session.clientId,
    hasAnilistSecret: Boolean(settings?.anilistClientSecret),
    panelOpen: Boolean(settings?.panelOpen),
    panelCorner: CORNERS.has(settings?.panelCorner) ? settings.panelCorner : "bottom-right",
    hideWatched: Boolean(settings?.hideWatched),
    useAi: settings?.useAi !== false,
  };
}

export function applySettingsPatch(settings, patch) {
  const next = { ...defaultSettings(), ...settings };
  if (typeof patch.apiKey === "string") next.apiKey = patch.apiKey.trim();
  if (patch.baseUrl != null) {
    const baseUrl = validateBaseUrl(patch.baseUrl);
    if (!baseUrl) throw new Error("API base URL must be https, or http on localhost.");
    next.baseUrl = baseUrl;
  }
  if (patch.model != null) {
    const model = validateModel(patch.model);
    if (!model) throw new Error("Model name looks invalid.");
    next.model = model;
  }
  if (typeof patch.anilistUsername === "string") next.anilistUsername = patch.anilistUsername.trim();
  if (patch.anilistClientId != null) {
    const clientId = validateClientId(patch.anilistClientId);
    if (!clientId) throw new Error("AniList client id should be the number from your AniList app.");
    next.anilistClientId = clientId;
  }
  if (typeof patch.panelOpen === "boolean") next.panelOpen = patch.panelOpen;
  if (CORNERS.has(patch.panelCorner)) next.panelCorner = patch.panelCorner;
  if (typeof patch.hideWatched === "boolean") next.hideWatched = patch.hideWatched;
  if (typeof patch.useAi === "boolean") next.useAi = patch.useAi;
  return next;
}
