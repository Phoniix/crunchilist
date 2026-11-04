import { serviceById, serviceForSite } from "./services.js";

// Brand colours for site panels and popup chips (same accents used in where-to-watch).
export const SERVICE_BRAND = {
  crunchyroll: "#F47521",
  netflix: "#E50914",
  prime: "#00A8E1",
  hidive: "#00AEEF",
  tubi: "#7408FF",
  hulu: "#1CE783",
};

// Short labels for compact card / search pills.
export const SERVICE_SHORT = {
  crunchyroll: "CR",
  netflix: "Netflix",
  prime: "Prime",
  hidive: "HIDIVE",
  tubi: "Tubi",
  hulu: "Hulu",
};

// Best URL to open for watching a show. Prefers a connected / catalog-confirmed link, then any visible streaming link.
// Netflix title pages already jump to the profile's most recently watched episode when signed in — no episode id needed.
export function pickPlayLink(show, { preferService = "", episode = null } = {}) {
  const links = [...(show?.streaming || [])].filter((link) => serviceForSite(link?.site));
  if (!links.length) return null;
  const prefer = preferService || "";
  const rank = (link) => {
    const id = serviceForSite(link.site)?.id || "";
    let score = 0;
    if (prefer && id === prefer) score += 8;
    if (link.checked) score += 4;
    if (link.seen) score += 2;
    if (isPlayerish(link.url, id)) score += 1;
    return score;
  };
  const best = [...links].sort((a, b) => rank(b) - rank(a) || a.site.localeCompare(b.site))[0];
  if (!best) return null;
  return {
    site: best.site,
    service: serviceForSite(best.site)?.id || "",
    url: withEpisodeHint(best.url, serviceForSite(best.site)?.id, episode),
    color: best.color || SERVICE_BRAND[serviceForSite(best.site)?.id] || "",
    episode: episode || null,
  };
}

// A few sites accept an episode hint in the URL. Netflix title URLs are left alone — they resume mid-show.
export function withEpisodeHint(url, service, episode) {
  if (!url || !episode || !Number.isInteger(episode) || episode < 1) return url;
  if (service === "netflix") return url;
  if (service === "hidive" && /\/series\/\d+/.test(url)) return `${url.replace(/\/$/, "")}#episode=${episode}`;
  if (service === "tubi" && /\/series\//.test(url)) return url;
  return url;
}

/** Deep link for one service badge: catalog/gap URL (or CR series page), with an episode hint when the site supports it. */
export function servicePlayUrl(show, { service = "", url = "", episode = null } = {}) {
  const id = service || serviceForSite(url)?.id || "";
  let href = url;
  if (!href && id === "crunchyroll") {
    href = show?.url || (show?.id ? `https://www.crunchyroll.com/series/${show.id}` : "");
  }
  if (!href) {
    const link = (show?.streaming || []).find((row) => serviceForSite(row?.site)?.id === id);
    href = link?.url || "";
  }
  return href ? withEpisodeHint(href, id, episode) : "";
}

const isPlayerish = (url, service = "") => {
  if (service === "netflix" && /netflix\.com\/title\/\d+/i.test(String(url || ""))) return true;
  return /\/watch\/|\/stream\/|\/video\/|\/play\//i.test(String(url || ""));
};

export function brandForService(id) {
  return SERVICE_BRAND[id] || serviceById(id)?.color || "#ff7a2f";
}
