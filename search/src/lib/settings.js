// User settings kept in chrome.storage.local: which where-to-watch sites are hidden, whether setup was finished,
// and the opt-in background updates (daily sync, applying it without a preview, tracking as you watch).
import { LISTING_SITES } from "./services.js";

// readCatalogs is on unless switched off: it only reads what a connected service lists, in a tab already open.
// hideOffSiteShows: shows that only stream on switched-off sites are left out of Home, Browse, search and airing.
export const DEFAULT_SETTINGS = {
  hiddenSites: [], setupDone: false, dailySync: false, syncApply: false,
  trackNetflix: false, trackTubi: false, trackHidive: false,
  readCatalogs: true, hideOffSiteShows: true,
  // Pull AniList/MAL/Kitsu libraries about once a week when connected.
  weeklyTrackerPull: true,
  // When applying imports / tracking, also write progress to MAL if connected.
  writeMal: true,
};
const SWITCHES = ["setupDone", "dailySync", "syncApply", "trackNetflix", "trackTubi", "trackHidive"];
const ON_SWITCHES = ["readCatalogs", "hideOffSiteShows", "weeklyTrackerPull", "writeMal"];

// Anything unknown or malformed is dropped, so a bad restore or an old version can't break the page.
export function cleanSettings(value) {
  const known = new Map(LISTING_SITES.map(({ site }) => [site.toLowerCase(), site]));
  const hidden = Array.isArray(value?.hiddenSites) ? value.hiddenSites : [];
  return {
    hiddenSites: [...new Set(hidden.map((site) => known.get(String(site).toLowerCase())).filter(Boolean))],
    ...Object.fromEntries(SWITCHES.map((key) => [key, value?.[key] === true])),
    ...Object.fromEntries(ON_SWITCHES.map((key) => [key, value?.[key] !== false])),
  };
}

export const mergeSettings = (current, patch) => cleanSettings({ ...cleanSettings(current), ...(patch && typeof patch === "object" ? patch : {}) });
