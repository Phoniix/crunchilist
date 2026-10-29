// Public title-collection + matching contract for Crunchilist Search and (later) the main page.
// Prefer these helpers over reading chrome.storage keys directly so both UIs stay aligned.
import { CATALOG_SERVICES, GAP_SERVICES, catalogSummary } from "./catalogs.js";
import { KEYS } from "./keys.js";

/** Storage keys the title layer owns (never touch main Crunchilist keys). */
export const TITLE_KEYS = {
  catalogs: KEYS.catalogs,
  matches: KEYS.matches,
  whereMap: KEYS.whereMap,
  deadLinks: KEYS.deadLinks,
  feeds: KEYS.feeds,
};

/**
 * Per-service catalog snapshot for UI / main-page integration.
 * matchRate: matched/titles (0–1), null when unread. CR browse is not anime-scoped — rate can look low.
 */
export function catalogRates(summary = {}) {
  return Object.fromEntries(CATALOG_SERVICES.map((id) => {
    const row = summary[id];
    if (!row?.at) return [id, null];
    const titles = Number(row.titles) || 0;
    const matched = Number(row.matched) || 0;
    return [id, {
      at: row.at,
      titles,
      matched,
      shows: Number(row.shows) || 0,
      matchRate: titles > 0 ? matched / titles : null,
      error: row.error || "",
      tried: row.tried || 0,
    }];
  }));
}

export function formatMatchRate(rate) {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return `${Math.round(rate * 1000) / 10}%`;
}

/**
 * Readiness flags the main page should wait on before matching / where-to-watch.
 * idMapReady: master list loaded. catalogs: any connected service with a successful read.
 * whereMap: gap feed present (partial by design — popular AniList harvest, not full catalogs).
 * When a connected service has a successful local catalog read, availability() ignores where-map chips for that service.
 */
export function titleReadiness({ idMap = {}, catalogs = {}, whereMap = {}, connected = [] } = {}) {
  const summary = catalogSummary(catalogs);
  const rates = catalogRates(summary);
  const catalogServices = CATALOG_SERVICES.filter((id) => connected.includes(id));
  const readOk = catalogServices.filter((id) => rates[id]?.at && !rates[id].error);
  const readFailed = catalogServices.filter((id) => rates[id]?.error && !rates[id]?.at);
  return {
    idMapReady: Boolean(idMap.count > 0),
    idMap: { count: idMap.count || 0, updated: idMap.updated || "", error: idMap.error || "" },
    whereMap: {
      count: whereMap.count || 0,
      updated: whereMap.updated || "",
      source: whereMap.source || "",
      error: whereMap.error || "",
      // Honest: this is a popular-title gap fill, not a full Netflix/Prime/Hulu catalog.
      partial: true,
      gapServices: [...GAP_SERVICES],
    },
    catalogs: rates,
    connectedCatalogs: catalogServices,
    catalogsRead: readOk,
    catalogsFailed: readFailed,
    // Safe to run local title search / match when the master list is present.
    canMatch: Boolean(idMap.count > 0),
    // Safe to paint "on my services" from catalogs+gaps when at least one catalog or the gap map exists.
    canShowAvailability: Boolean(idMap.count > 0 && (readOk.length > 0 || (whereMap.count || 0) > 0)),
  };
}

/** One-line notes for diagnostics / main-page docs. */
export const TITLE_CONTRACT = {
  version: 1,
  masterList: "AniList anime rows in IDB from id-map feed; matcher() throws if empty.",
  catalogs: "Connected CR/HIDIVE/Tubi/Netflix tab (or CR token) → matched AniList links in KEYS.catalogs.",
  gaps: "Packaged/remote where-map for Netflix/Prime/Hulu popular titles; tab Netflix catalog wins when read.",
  remembered: "KEYS.matches: service:seriesId[/seasonId] → { anilistId, by, names }; user picks beat matcher.",
  availability: "availability(catalogs, connected, { matches, hidden, gaps, dead }) → anilistId → [{ service, url, checked, seen }]. Gap chips skipped for services with a successful local catalog.",
  links: "withCatalogLinks(show, found, { dead }) merges into show.streaming for UI.",
};
