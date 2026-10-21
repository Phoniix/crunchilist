// Gap where-to-watch feed for services without a full catalog we can page (Netflix, Prime Video, Hulu).
// Built offline by search/scripts/where-map.mjs from AniList external links + optional TMDB watch providers.
// Only https title URLs are kept; search pages are allowed as a last resort when no title URL exists.
import { FEED_BRANCH } from "./id-map.js";
import { GAP_SERVICES } from "./catalogs.js";
import { isSearchUrl } from "./link-check.js";

export const WHERE_MAP_VERSION = 1;
const FEED_BASE = `https://raw.githubusercontent.com/Phoniix/crunchilist/${FEED_BRANCH}/search/feeds`;
export const WHERE_MAP_URL = `${FEED_BASE}/where-map.json`;
export const WHERE_MAP_META_URL = `${FEED_BASE}/where-map-meta.json`;

const SERVICE_HOST = {
  netflix: /^https:\/\/www\.netflix\.com\//i,
  prime: /^https:\/\/www\.(?:primevideo|amazon)\.com\//i,
  hulu: /^https:\/\/www\.hulu\.com\//i,
};

export function gapUrlOk(service, url) {
  if (!GAP_SERVICES.includes(service) || typeof url !== "string" || url.length > 400 || /[\s"'<>]/.test(url)) return false;
  return SERVICE_HOST[service]?.test(url) === true;
}

// Prefer a real title page over a search URL when both exist.
export function preferGapUrl(current, next) {
  if (!next) return current || "";
  if (!current) return next;
  if (isSearchUrl(current) && !isSearchUrl(next)) return next;
  return current;
}

export function cleanWhereMap(feed) {
  if (!feed || feed.version !== WHERE_MAP_VERSION || !feed.links || typeof feed.links !== "object") return null;
  const links = {};
  for (const [key, row] of Object.entries(feed.links)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id < 1 || !row || typeof row !== "object") continue;
    const entry = {};
    for (const service of GAP_SERVICES) {
      const url = typeof row[service] === "string" ? row[service].trim() : "";
      if (gapUrlOk(service, url)) entry[service] = url;
    }
    if (Object.keys(entry).length) links[id] = entry;
  }
  return { version: WHERE_MAP_VERSION, updated: String(feed.updated || ""), links, source: feed.source || "" };
}

export function validWhereMap(feed) {
  return Boolean(cleanWhereMap(feed));
}

// AniList site labels -> our gap service ids.
export const ANILIST_GAP_SITE = {
  Netflix: "netflix",
  "Amazon Prime Video": "prime",
  "Prime Video": "prime",
  Hulu: "hulu",
};

export function gapsFromExternalLinks(externalLinks = []) {
  const entry = {};
  for (const link of externalLinks || []) {
    if (link?.type !== "STREAMING") continue;
    const service = ANILIST_GAP_SITE[link.site];
    if (!service || !gapUrlOk(service, link.url)) continue;
    entry[service] = preferGapUrl(entry[service], link.url);
  }
  return entry;
}
