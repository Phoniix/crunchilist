// Dead where-to-watch links: Netflix / Prime / Hulu (and AniList) title URLs go 404 while the site name stays.
// Catalog URLs from CR / HIDIVE / Tubi are trusted until the next catalog read; gap and AniList links are probed.

const DEAD_STATUS = new Set([404, 410, 451]);
// Soft-dead landing pages after a redirect (title removed, still HTTP 200).
const SOFT_DEAD = [
  { host: /(?:^|\.)netflix\.com$/i, path: /^\/(?:browse\/?$|title\/0)/i },
  { host: /(?:^|\.)hulu\.com$/i, path: /^\/(?:welcome|404|content-not-found)/i },
  { host: /(?:^|\.)primevideo\.com$/i, path: /^\/(?:region\/oops|gp\/video\/signup)/i },
  { host: /(?:^|\.)amazon\.com$/i, path: /^\/(?:gp\/video\/signup|ap\/signin)/i },
];

export function isSearchUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.includes("/search");
  } catch {
    return false;
  }
}

// True when the response means the title page is gone. Login walls (401/403) stay — the link can still be right.
export function isDeadResponse(status, finalUrl = "", originalUrl = "") {
  if (DEAD_STATUS.has(Number(status))) return true;
  if (!(Number(status) >= 200 && Number(status) < 400)) return false;
  let parsed;
  try { parsed = new URL(finalUrl || originalUrl); } catch { return false; }
  return SOFT_DEAD.some((rule) => rule.host.test(parsed.hostname) && rule.path.test(parsed.pathname));
}

export function cleanDeadStore(store = {}, { max = 2000, maxAge = 30 * 24 * 60 * 60 * 1000, now = Date.now() } = {}) {
  const entries = Object.entries(store || {})
    .filter(([, row]) => row && typeof row === "object" && typeof row.url === "string" && row.url.startsWith("https://"))
    .map(([url, row]) => ({ url: row.url || url, dead: row.dead === true, at: Number(row.at) || 0 }))
    .filter((row) => row.at && now - row.at < maxAge)
    .sort((a, b) => b.at - a.at)
    .slice(0, max);
  return Object.fromEntries(entries.map((row) => [row.url, { url: row.url, dead: row.dead, at: row.at }]));
}

export function deadUrlSet(store = {}) {
  return Object.fromEntries(Object.entries(cleanDeadStore(store)).filter(([, row]) => row.dead).map(([url]) => [url, true]));
}

// Probe one URL. Search pages are never marked dead (they're fallbacks, not title pages).
export async function probeLink(url, { fetchImpl = fetch, timeout = 10000 } = {}) {
  const href = String(url || "");
  if (!href.startsWith("https://") || isSearchUrl(href)) return { url: href, dead: false, skipped: true };
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
  try {
    let response = await fetchImpl(href, { method: "HEAD", redirect: "follow", credentials: "omit", signal: ctrl?.signal });
    if (response.status === 405 || response.status === 501 || response.status === 403) {
      response = await fetchImpl(href, { method: "GET", redirect: "follow", credentials: "omit", signal: ctrl?.signal, headers: { Range: "bytes=0-0" } });
    }
    return { url: href, dead: isDeadResponse(response.status, response.url, href), status: response.status, final: response.url || href };
  } catch {
    // Network / CORS / abort: don't brand the link dead — try again later.
    return { url: href, dead: false, error: true };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function probeLinks(urls, options = {}) {
  const list = [...new Set((urls || []).filter((url) => typeof url === "string" && url.startsWith("https://")))];
  const out = [];
  for (const url of list) out.push(await probeLink(url, options));
  return out;
}

// Drop streaming rows whose URL is known dead. Search URLs and unchecked unknowns stay.
export function dropDeadLinks(links = [], dead = {}) {
  return (links || []).filter((link) => link?.url && !dead[link.url]);
}
