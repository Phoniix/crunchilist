// Build and deliver over-player guide notices to the watching tab.
import { characterPortraitUrl, guideLine } from "../lib/guide.js";
import { KEYS } from "../lib/keys.js";
import { notificationStyle } from "../lib/settings.js";
import { loadState } from "./store.js";

function hintFor(kind, { title = "", episode = null } = {}) {
  const name = String(title || "this show").slice(0, 80);
  if (kind === "watched") {
    const ep = Number(episode);
    if (Number.isInteger(ep) && ep > 0) return `Marked “${name}” episode ${ep} watched`;
    return `Marked “${name}” watched`;
  }
  return `Added “${name}” to Continue watching`;
}

export async function buildWatchGuidePayload({ kind, title = "", episode = null, service = "" } = {}) {
  const state = await loadState();
  const settings = state.settings || {};
  if (notificationStyle(settings) === "off") return null;
  const favorite = (await chrome.storage.local.get(KEYS.favoriteCharacter))[KEYS.favoriteCharacter] || null;
  const safeKind = kind === "watched" ? "watched" : "tracked";
  const line = guideLine({
    kind: "look_here",
    seed: `watch-${safeKind}-${service || "site"}`,
    hint: hintFor(safeKind, { title, episode }),
    favorite,
    settingsFavoriteId: settings.favoriteCharacterId || "",
  });
  return {
    type: "watchGuide",
    kind: safeKind,
    title: String(title || "").slice(0, 180),
    episode: Number.isInteger(Number(episode)) ? Number(episode) : null,
    service: String(service || "").slice(0, 40),
    text: line.text,
    name: line.name,
    portraitUrl: characterPortraitUrl(line.characterId, (...args) => chrome.runtime.getURL(...args)),
  };
}

/** Send a 3–4s guide popup to the watching tab. No-op when Off toasts or no tab. */
export async function sendWatchGuide(tabId, opts = {}) {
  const id = Number(tabId);
  if (!(id > 0)) return null;
  const payload = await buildWatchGuidePayload(opts);
  if (!payload) return null;
  try {
    await chrome.tabs.sendMessage(id, payload);
  } catch {
    // Tab closed or content script not ready.
  }
  return payload;
}
