// Gap where-to-watch feed for services without a full catalog we can page (Netflix, Prime Video, Hulu).
// Built offline by search/scripts/where-map.mjs. Packaged under feeds/; remote refresh still reads the search branch until feeds move to master.
export const WHERE_MAP_VERSION = 1;
export const WHERE_MAP_KEY = "ksWhereMap";
export const WHERE_MAP_META_KEY = "ksWhereMapMeta";
export const GAP_SERVICES = ["netflix", "prime", "hulu"];

// Temporary: feed still published under search/feeds on the search branch.
const FEED_BASE = "https://raw.githubusercontent.com/Phoniix/crunchilist/search/search/feeds";
export const WHERE_MAP_URL = `${FEED_BASE}/where-map.json`;
export const WHERE_MAP_META_URL = `${FEED_BASE}/where-map-meta.json`;

const SERVICE_HOST = {
  netflix: /^https:\/\/www\.netflix\.com\//i,
  prime: /^https:\/\/www\.(?:primevideo|amazon)\.com\//i,
  hulu: /^https:\/\/www\.hulu\.com\//i,
};

export function isSearchUrl(url) {
  try {
    return new URL(url).pathname.toLowerCase().includes("/search");
  } catch {
    return false;
  }
}

export function gapUrlOk(service, url) {
  if (!GAP_SERVICES.includes(service) || typeof url !== "string" || url.length > 400 || /[\s"'<>]/.test(url)) return false;
  return SERVICE_HOST[service]?.test(url) === true;
}

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
