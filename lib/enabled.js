export const ENABLED_KEY = "crEnabled";
export const PANEL_ENABLED_KEY = "ksPanelEnabled";

export async function isEnabled() {
  const stored = await chrome.storage.local.get(ENABLED_KEY);
  return stored[ENABLED_KEY] !== false;
}

/** Whether the corner panel should run on a site. Default on; Crunchyroll uses crEnabled. */
export function isPanelEnabled(siteId, stored = {}) {
  const id = String(siteId || "").trim().toLowerCase();
  if (!id) return true;
  if (id === "crunchyroll") return stored[ENABLED_KEY] !== false;
  const map = stored[PANEL_ENABLED_KEY];
  if (!map || typeof map !== "object") return true;
  return map[id] !== false;
}

export async function panelEnabledMap() {
  const stored = await chrome.storage.local.get([ENABLED_KEY, PANEL_ENABLED_KEY]);
  return {
    crunchyroll: stored[ENABLED_KEY] !== false,
    ...(stored[PANEL_ENABLED_KEY] && typeof stored[PANEL_ENABLED_KEY] === "object" ? stored[PANEL_ENABLED_KEY] : {}),
  };
}

export async function setPanelEnabled(siteId, on) {
  const id = String(siteId || "").trim().toLowerCase();
  if (!id) throw new Error("Unknown site.");
  if (id === "crunchyroll") {
    await chrome.storage.local.set({ [ENABLED_KEY]: Boolean(on) });
    return { id, enabled: Boolean(on) };
  }
  const stored = await chrome.storage.local.get(PANEL_ENABLED_KEY);
  const map = { ...(stored[PANEL_ENABLED_KEY] && typeof stored[PANEL_ENABLED_KEY] === "object" ? stored[PANEL_ENABLED_KEY] : {}) };
  if (on) delete map[id];
  else map[id] = false;
  await chrome.storage.local.set({ [PANEL_ENABLED_KEY]: map });
  return { id, enabled: Boolean(on) };
}
