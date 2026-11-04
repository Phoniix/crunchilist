// Weekly pull of connected tracker libraries (AniList is already home; MAL + Kitsu feed into the list-import preview).
import { KEYS } from "../lib/keys.js";
import { cleanSettings } from "../lib/settings.js";
import { cleanKitsuLink } from "../lib/trackers.js";
import { importBusy, importKitsuFromLink, importMalApi, importStatus } from "./importer.js";
import { ensureMalToken } from "./mal-store.js";
import { loadState } from "./store.js";

export const TRACKER_PULL_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

async function loadSettings() {
  // Prefer main extension settings; fall back to a leftover Search-style key.
  try {
    return cleanSettings((await loadState()).settings);
  } catch {
    return cleanSettings((await chrome.storage.local.get(KEYS.settings))[KEYS.settings]);
  }
}

async function pullState() {
  return (await chrome.storage.local.get(KEYS.syncState))[KEYS.syncState] || {};
}

export async function trackerPullDue(now = Date.now()) {
  const settings = await loadSettings();
  if (!settings.weeklyTrackerPull) return false;
  const state = await pullState();
  return now - (state.lastTrackerPull || 0) >= TRACKER_PULL_EVERY_MS;
}

// Pull MAL (OAuth) and Kitsu (saved username) into the normal list-import pipeline, one after another.
// AniList is the write target via apply; MAL write happens when applying if writeMal is on.
export async function runTrackerPull({ force = false } = {}) {
  if (importBusy()) return { ran: false, why: "busy" };
  const settings = await loadSettings();
  if (!force && !settings.weeklyTrackerPull) return { ran: false, why: "off" };
  if (!force && !(await trackerPullDue())) return { ran: false, why: "soon" };

  const tried = [];
  const mal = await ensureMalToken();
  if (mal?.accessToken) {
    tried.push("mal");
    await importMalApi().catch((error) => ({ error: error.message }));
  }

  const link = cleanKitsuLink((await chrome.storage.local.get(KEYS.kitsuLink))[KEYS.kitsuLink]);
  if (link?.username) {
    // Wait if MAL left a preview — weekly pull queues one source at a time.
    if (!importBusy()) {
      tried.push("kitsu");
      await importKitsuFromLink(link.username).catch(() => {});
    }
  }

  const state = await pullState();
  await chrome.storage.local.set({
    [KEYS.syncState]: {
      ...state,
      lastTrackerPull: Date.now(),
      trackerPullResult: tried.length
        ? `Pulled ${tried.join(" + ")}. Review the Import preview if one is waiting.`
        : "No MAL or Kitsu connection to pull.",
    },
  });
  return { ran: true, tried, ...(await importStatus()) };
}
