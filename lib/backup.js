// Backup files: everything Crunchilist Search remembers, minus sign-ins. Restoring only writes known keys.
import { normalizeActivityLog } from "./activity-log.js";
import { keepLogs } from "./import-log.js";
import { KEYS } from "./keys.js";
import { cleanSettings } from "./settings.js";
import { sanitizeUnrecommended } from "./unrecommended.js";

export const BACKUP_APP = "kivori-sekai";
export const BACKUP_APPS = new Set(["kivori-sekai", "crunchilist-search"]);
export const BACKUP_VERSION = 1;

// Sign-ins and per-tab state never go in a file; the master list and service catalogs are read again by themselves.
const NEVER = new Set([
  KEYS.session, KEYS.malSession, KEYS.crunchyrollAuth,
  KEYS.netflixTab, KEYS.primeTab, KEYS.hidiveTab, KEYS.tubiTab,
  KEYS.openedTabs, KEYS.openPurpose, KEYS.pendingCatalog, KEYS.catalogKick,
  KEYS.feeds, KEYS.cacheIndex, KEYS.importDraft, KEYS.syncState, KEYS.catalogs, KEYS.whereMap,
]);
export const BACKUP_KEYS = Object.values(KEYS).filter((key) => !NEVER.has(key));

const isPlain = (value) => value != null && typeof value === "object";

export function makeBackup(stored, { version = "", theme = null, now = Date.now() } = {}) {
  const data = {};
  for (const key of BACKUP_KEYS) {
    if (stored[key] === undefined) continue;
    if (key === KEYS.settings) {
      const settings = cleanSettings(stored[key]);
      data[key] = { ...settings, apiKeys: {} };
    } else {
      data[key] = stored[key];
    }
  }
  return { app: BACKUP_APP, backup: BACKUP_VERSION, version, savedAt: new Date(now).toISOString(), theme, data };
}

// Returns { data, theme } ready to write, or throws a message the user can act on.
export function readBackup(text) {
  let file;
  try {
    file = typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    throw new Error("That file isn't a Kivori Sekai backup.");
  }
  if (!isPlain(file) || !BACKUP_APPS.has(file.app) || !isPlain(file.data)) throw new Error("That file isn't a Kivori Sekai backup.");
  if (file.backup > BACKUP_VERSION) throw new Error("That backup is from a newer version of Kivori Sekai. Update first.");
  const data = {};
  for (const key of BACKUP_KEYS) {
    if (!(key in file.data)) continue;
    const value = file.data[key];
    if (key === KEYS.settings) data[key] = cleanSettings(value);
    else if (key === KEYS.importLog) { if (Array.isArray(value)) data[key] = keepLogs(value); }
    else if (key === KEYS.activityLog) { if (Array.isArray(value)) data[key] = normalizeActivityLog(value); }
    else if (key === KEYS.unrecommended) { if (Array.isArray(value)) data[key] = sanitizeUnrecommended(value); }
    else if (isPlain(value)) data[key] = value;
  }
  if (!Object.keys(data).length) throw new Error("That backup has nothing in it to restore.");
  return { data, theme: isPlain(file.theme) ? file.theme : null };
}

// A plain-text report for bug reports: versions, connections and recent outcomes, never tokens or account ids.
export function diagnostics({ version, userAgent, connected, anilist, mal, kitsu, idMap, whereMap, settings, job, log, checkpoints, pendingCount, granted, catalogs = {}, title } = {}) {
  const malNote = mal?.connected ? "on" : mal?.configured ? "ready" : "off";
  const kitsuNote = kitsu?.connected ? kitsu.username : "off";
  const catalogLine = settings?.readCatalogs === false ? "off" : Object.entries(catalogs).map(([service, item]) => {
    const rate = item.matchRate != null ? ` ${Math.round(item.matchRate * 1000) / 10}%` : "";
    return `${service} ${item.titles} titles, ${item.matched} matched${rate}${item.at ? ` (${new Date(item.at).toISOString().slice(0, 10)})` : ""}${item.error ? ` [${item.error}]` : ""}`;
  }).join("; ") || "none read";
  const lines = [
    `Kivori Sekai ${version}`,
    `Browser: ${userAgent}`,
    `AniList: ${anilist?.connected ? "connected" : anilist?.expired ? "expired" : "not connected"}`,
    `Services connected: ${connected.length ? connected.join(", ") : "none"}`,
    `Sites allowed: ${granted.length ? granted.map((origin) => origin.replace(/^https:\/\//, "").replace(/\/\*$/, "")).join(", ") : "none"}`,
    `Master list: ${idMap?.count ? `${idMap.count} anime, updated ${idMap.updated}` : "not downloaded"}${idMap?.error ? ` (last check: ${idMap.error})` : ""}`,
    `Where-map: ${whereMap?.count ? `${whereMap.count} shows (${whereMap.source || "unknown"}, partial gap fill), updated ${whereMap.updated}` : "not loaded"}${whereMap?.error ? ` (last check: ${whereMap.error})` : ""}`,
    `Title ready: match=${title?.canMatch ? "yes" : "no"}; availability=${title?.canShowAvailability ? "yes" : "no"}; catalogs read=${(title?.catalogsRead || []).join(",") || "none"}`,
    `Hidden sites: ${settings?.hiddenSites?.length ? settings.hiddenSites.join(", ") : "none"}`,
    `Setup finished: ${settings?.setupDone ? "yes" : "no"}`,
    `Daily sync: ${settings?.dailySync ? (settings.syncApply ? "on, applies changes" : "on, leaves a preview") : "off"}; Tracking: ${[["Netflix", "trackNetflix"], ["Tubi", "trackTubi"], ["HIDIVE", "trackHidive"]].filter(([, key]) => settings?.[key]).map(([name]) => name).join(", ") || "off"}`,
    `Trackers: AniList ${anilist?.connected ? "on" : "off"}; MAL ${malNote}; Kitsu ${kitsuNote}; weekly pull ${settings?.weeklyTrackerPull === false ? "off" : "on"}; write MAL ${settings?.writeMal === false ? "off" : "on"}`,
    `Catalogs: ${catalogLine}`,
    `Import job: ${job?.phase || "idle"}${job?.error ? ` (error: ${job.error})` : ""}`,
    `Shows waiting for a pick: ${pendingCount || 0}`,
    "Checkpoints:",
    ...Object.entries(checkpoints || {}).map(([service, points]) => `  ${service}: ${points.length} profile${points.length === 1 ? "" : "s"}, ${points.filter((point) => point.end).length} fully read`),
    "Recent imports:",
    ...(log || []).slice(0, 5).map((item) => `  ${new Date(item.at).toISOString()} ${item.service} ${item.outcome}: ${item.count} sent${item.undoneAt ? ", undone" : ""}${item.stats ? `, ${item.stats.matched} matched, ${item.stats.dropped || 0} skipped` : ""}`),
  ];
  return lines.join("\n");
}
