// Merge catalog / gap-map availability into a Prism show's streaming list.
import { GAP_SERVICES } from "./where-map.js";

const BRAND = {
  crunchyroll: "#F47521",
  hidive: "#00AEEF",
  tubi: "#7408FF",
  netflix: "#E50914",
  prime: "#00A8E1",
  hulu: "#1CE783",
};

const SERVICE_NAME = {
  crunchyroll: "Crunchyroll",
  hidive: "HIDIVE",
  tubi: "Tubi",
  netflix: "Netflix",
  prime: "Prime Video",
  hulu: "Hulu",
};

const SITE_TO_SERVICE = Object.fromEntries(Object.entries(SERVICE_NAME).map(([id, name]) => [name.toLowerCase(), id]));

export function serviceById(id) {
  const name = SERVICE_NAME[id];
  return name ? { id, name, color: BRAND[id] || "" } : null;
}

export function serviceForSite(site) {
  const id = SITE_TO_SERVICE[String(site || "").toLowerCase()];
  return id ? serviceById(id) : null;
}

// gaps: anilistId -> { netflix?, prime?, hulu? }
// catalogs: serviceId -> { links: { anilistId: url } }
export function availability(catalogs = {}, connected = [], { gaps = {}, dead = {} } = {}) {
  const live = (url) => typeof url === "string" && url.startsWith("https://") && !dead[url];
  const found = {};
  const add = (anilistId, service, url, flag) => {
    if (!live(url)) return;
    const list = (found[anilistId] ||= []);
    const known = list.find((item) => item.service === service);
    if (known) {
      known[flag] = true;
      if (flag === "checked" && url && (!known.url || /\/search/i.test(known.url))) known.url = url;
    } else list.push({ service, url, checked: flag === "checked", seen: flag === "seen" });
  };
  for (const id of connected) {
    if (!catalogs[id]?.links) continue;
    for (const [anilistId, url] of Object.entries(catalogs[id].links)) add(Number(anilistId) || anilistId, id, url, "checked");
  }
  for (const [anilistId, row] of Object.entries(gaps || {})) {
    const id = Number(anilistId);
    if (!Number.isInteger(id)) continue;
    for (const service of GAP_SERVICES) {
      const url = row?.[service];
      if (url) add(id, service, url, "checked");
    }
  }
  return found;
}

export function withCatalogLinks(show, found, { dead = {} } = {}) {
  const here = found?.[show?.anilistId];
  const streaming = (show.streaming || [])
    .filter((link) => link?.url && !dead[link.url] && serviceForSite(link.site))
    .map((link) => ({ ...link }));
  if (!here?.length) return streaming.length === (show.streaming || []).length ? show : { ...show, streaming };
  for (const { service, url, checked, seen } of here) {
    if (dead[url]) continue;
    const listed = streaming.find((link) => serviceForSite(link.site)?.id === service);
    if (listed) {
      Object.assign(listed, checked ? { checked } : {}, seen ? { seen } : {});
      if (checked && url) listed.url = url;
    } else {
      const brand = serviceById(service);
      if (!brand) continue;
      streaming.push({
        site: brand.name,
        url,
        color: brand.color,
        icon: "",
        ...(checked ? { checked } : {}),
        ...(seen ? { seen } : {}),
      });
    }
  }
  return { ...show, streaming, onServices: here.map((item) => item.service) };
}
