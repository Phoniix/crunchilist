// Registers site content scripts (history/catalog helpers + panels) after optional host permission is granted.
import { whereFilterMode } from "../lib/settings.js";
import { LISTING_SITES, SERVICES, connectedIds, contentScriptsFor, onService, serviceById } from "../lib/services.js";
import { loadState } from "./store.js";

export const SITE_BRAND = {
  crunchyroll: "#F47521",
  hidive: "#00AEEF",
  tubi: "#7408FF",
  netflix: "#E50914",
  prime: "#00A8E1",
  hulu: "#1CE783",
};

// Bottom insets sit above typical player transport bars so the launcher never covers controls.
export const SITE_LAYOUT = {
  // Bottoms clear player chrome; HIDIVE sits higher so cookie consent bars stay reachable.
  netflix: { edge: "right:24px;bottom:112px;", panel: "right:24px;bottom:176px;", radius: 4, fab: 48, fabText: "#fff", align: "flex-end" },
  hidive: { edge: "right:18px;bottom:148px;", panel: "right:18px;bottom:212px;", radius: 12, fab: 50, fabText: "#041018", align: "flex-end" },
  tubi: { edge: "right:16px;bottom:84px;", panel: "right:16px;bottom:148px;", radius: 20, fab: 52, fabText: "#fff", align: "flex-end" },
  prime: { edge: "right:22px;bottom:108px;", panel: "right:22px;bottom:172px;", radius: 8, fab: 48, fabText: "#041018", align: "flex-end" },
  hulu: { edge: "right:20px;bottom:88px;", panel: "right:20px;bottom:152px;", radius: 14, fab: 50, fabText: "#041018", align: "flex-end" },
};

const PANEL_SERVICES = SERVICES.filter((service) => service.id !== "crunchyroll");

export async function grantedOrigins() {
  return chrome.permissions.getAll().then((all) => all.origins || []).catch(() => []);
}

export async function syncSiteScripts() {
  if (!chrome.scripting?.registerContentScripts) return;
  const connected = new Set(connectedIds(await grantedOrigins()));
  connected.add("crunchyroll");
  // Crunchyroll already has the full panel + token hook in the main content scripts — don't double-register.
  const wanted = SERVICES.filter((service) => connected.has(service.id) && service.id !== "crunchyroll" && !service.untested)
    .flatMap(contentScriptsFor);
  for (const service of PANEL_SERVICES.filter((s) => s.untested && connected.has(s.id))) {
    wanted.push(...contentScriptsFor({ ...service, scripts: [] }));
  }
  const existing = await chrome.scripting.getRegisteredContentScripts().catch(() => []);
  const wantIds = new Set(wanted.map((script) => script.id));
  const stale = existing.filter((script) => script.id?.startsWith("ks-") && !wantIds.has(script.id)).map((script) => script.id);
  if (stale.length) {
    await chrome.scripting.unregisterContentScripts({ ids: stale }).catch((error) => {
      console.warn("Kivori SekAI: unregisterContentScripts failed", stale, error);
    });
  }
  const have = new Map(existing.map((script) => [script.id, script]));
  const fresh = [];
  const changed = [];
  const sameJs = (a = [], b = []) => a.length === b.length && a.every((file, i) => file === b[i]);
  const sameMatches = (a = [], b = []) => a.length === b.length && a.every((entry, i) => entry === b[i]);
  for (const script of wanted) {
    const prior = have.get(script.id);
    if (!prior) fresh.push(script);
    else if (!sameJs(prior.js, script.js) || !sameMatches(prior.matches, script.matches) || prior.world !== script.world) {
      changed.push(script);
    }
  }
  if (changed.length && chrome.scripting.updateContentScripts) {
    await chrome.scripting.updateContentScripts(changed).catch((error) => {
      console.warn("Kivori SekAI: updateContentScripts failed", changed.map((s) => s.id), error);
    });
  }
  if (fresh.length) {
    await chrome.scripting.registerContentScripts(fresh).catch((error) => {
      console.warn("Kivori SekAI: registerContentScripts failed", fresh.map((s) => s.id), error);
    });
  }
}

// Registered scripts only run on the next navigation. Tabs already open need an explicit inject.
export async function injectSiteScripts(serviceId, tabId) {
  const service = serviceById(serviceId);
  if (!service || tabId == null || service.id === "crunchyroll") return false;
  await syncSiteScripts();
  const scripts = contentScriptsFor(service);
  for (const script of scripts) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: script.js,
      world: script.world || "ISOLATED",
    }).catch(() => {});
  }
  return true;
}

export async function findOpenServiceTab(serviceId) {
  const service = serviceById(serviceId);
  if (!service) return null;
  const tabs = await chrome.tabs.query({}).catch(() => []);
  const match = tabs.find((tab) => tab?.id != null && onService(service, tab.url));
  return match?.id ?? null;
}

export async function connectSite(id) {
  const service = serviceById(id);
  if (!service) throw new Error("Unknown site.");
  if (service.id === "crunchyroll") return { service: service.id, name: service.name, required: true };
  if (service.untested) throw new Error(`${service.name} can't be connected yet.`);
  const granted = await chrome.permissions.request({ origins: service.origins });
  if (!granted) throw new Error(`${service.name} permission was not granted.`);
  await syncSiteScripts();
  return { service: service.id, name: service.name };
}

export async function disconnectSite(id) {
  const service = serviceById(id);
  if (!service) throw new Error("Unknown site.");
  if (service.id === "crunchyroll") throw new Error("Crunchyroll stays connected — it's required for Kivori SekAI.");
  await chrome.permissions.remove({ origins: service.origins }).catch(() => {});
  await syncSiteScripts();
  return { service: service.id, name: service.name };
}

export async function panelHello(_message, sender) {
  const service = PANEL_SERVICES.find((item) => onService(item, sender?.url));
  if (!service) return { show: false };
  const connected = connectedIds(await grantedOrigins());
  if (!connected.includes(service.id)) return { show: false };
  const state = await loadState();
  const mode = whereFilterMode(state.settings);
  const last = String(state.settings?.lastWhereSite || "").trim().toLowerCase();
  // remember + empty last → all (no silent host chip). host mode still opens on this site.
  const siteFilter = mode === "host" ? service.id : (last || "all");
  return {
    show: true,
    service: service.id,
    name: service.name,
    color: SITE_BRAND[service.id] || "#ff7a2f",
    layout: SITE_LAYOUT[service.id] || {},
    whereFilterMode: mode,
    lastWhereSite: last,
    siteFilter,
  };
}

export async function siteConnections() {
  const connected = new Set(connectedIds(await grantedOrigins()));
  connected.add("crunchyroll");
  return SERVICES.map((service) => ({
    id: service.id,
    name: service.name,
    connected: connected.has(service.id) || service.id === "crunchyroll",
    required: service.id === "crunchyroll",
    untested: Boolean(service.untested),
    imports: Boolean(service.imports),
    tracks: Boolean(service.tracks),
    color: SITE_BRAND[service.id] || "#ff7a2f",
    why: service.why || "",
    home: service.home || "",
  }));
}

export function listingSites() {
  return LISTING_SITES.map(({ site, service }) => ({ site, service }));
}
