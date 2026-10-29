// Streaming services the extension can connect to. Each one is an optional host permission,
// asked for only when the user clicks Connect, so installing never warns about sites they don't use.
// sites: the names AniList uses for the service in its streaming links. imports: whether history is read from the site.
// file: an export file can be uploaded instead. tracks: no history exists, so episodes are noted as they finish.
// untested: shown, but every option is off until it can be tested. beta: works, but couldn't be checked against a real account.
export const SERVICES = [
  {
    id: "crunchyroll",
    name: "Crunchyroll",
    origins: ["https://www.crunchyroll.com/*"],
    home: "https://www.crunchyroll.com/",
    sites: ["Crunchyroll"],
    imports: true,
    why: "Reads your Crunchyroll watch history and notices what you play, using your own sign-in. Nothing is changed on Crunchyroll.",
    // The page script only notices the sign-in token the site already uses; the content script passes it on.
    scripts: [
      { file: "crunchyroll-page", world: "MAIN", runAt: "document_start" },
      { file: "crunchyroll", world: "ISOLATED", runAt: "document_start" },
    ],
  },
  {
    id: "netflix",
    name: "Netflix",
    origins: ["https://www.netflix.com/*"],
    home: "https://www.netflix.com/",
    sites: ["Netflix"],
    imports: true,
    why: "Reads your Netflix viewing activity and notices what you play, using your own sign-in. Nothing is changed on Netflix.",
    // The page script only reports the site's build id and open profile; the content script reads activity pages.
    scripts: [
      { file: "netflix-page", world: "MAIN", runAt: "document_idle" },
      { file: "netflix", world: "ISOLATED", runAt: "document_idle" },
    ],
  },
  {
    id: "prime",
    name: "Prime Video",
    origins: ["https://www.primevideo.com/*", "https://www.amazon.com/gp/video/*"],
    home: "https://www.primevideo.com/",
    sites: ["Amazon Prime Video", "Prime Video", "Amazon"],
    imports: true,
    why: "Reads your Prime Video watch history, using your own sign-in. Nothing is changed on Prime Video.",
    // Loads the Watch History page in the user's tab and passes on the list of what was watched.
    scripts: [{ file: "prime", world: "ISOLATED", runAt: "document_idle" }],
  },
  {
    id: "hulu",
    name: "Hulu",
    origins: ["https://www.hulu.com/*"],
    home: "https://www.hulu.com/",
    sites: ["Hulu"],
    imports: false,
    // No history to read, so episodes are noted as they're played.
    tracks: true,
    // Not connectable until it can be tested against a real account.
    untested: true,
    why: "Coming later — Hulu connection and tracking aren't ready yet.",
    scripts: [],
  },
  {
    id: "tubi",
    name: "Tubi",
    origins: ["https://tubitv.com/*"],
    home: "https://tubitv.com/",
    sites: ["Tubi TV", "Tubi"],
    imports: false,
    tracks: true,
    why: "Notices the anime episodes and films you finish on Tubi, and reads Tubi's Anime category. Nothing is changed on Tubi.",
    // The page script only notices the guest token Tubi's app signs catalog requests with, and loads Anime pages with it.
    scripts: [
      { file: "tubi-page", world: "MAIN", runAt: "document_start" },
      { file: "tubi", world: "ISOLATED", runAt: "document_idle" },
    ],
  },
  {
    id: "hidive",
    name: "HIDIVE",
    origins: ["https://www.hidive.com/*"],
    home: "https://www.hidive.com/login",
    sites: ["HIDIVE"],
    imports: true,
    why: "Reads your HIDIVE watch history and notices what you play, using your own sign-in. Nothing is changed on HIDIVE.",
    // The page script only notices the headers HIDIVE's app already sends, and loads history pages with them.
    scripts: [
      { file: "hidive-page", world: "MAIN", runAt: "document_start" },
      { file: "hidive", world: "ISOLATED", runAt: "document_idle" },
    ],
  },
];

// Every site with a show/hide switch: only services this extension supports (including Hulu's stub).
export const LISTING_SITES = SERVICES.map((service) => ({ site: service.name, service: service.id }));

const lower = (text) => String(text || "").toLowerCase();
export const serviceForSite = (site) => SERVICES.find((service) => service.sites.some((name) => lower(name) === lower(site))) || null;

// YouTube (and other AniList-only hosts) are never listed as watch sites in the app.
export function isAppStreamingSite(site) {
  return Boolean(serviceForSite(site));
}

// A where-to-watch link stays unless its site is switched off, connected or not.
// hidden: switch names (LISTING_SITES[].site) the user turned off.
// Unknown AniList hosts (YouTube, Disney+, …) are never shown.
export function visibleLink(site, hidden = []) {
  const service = serviceForSite(site);
  if (!service) return false;
  return !hidden.some((off) => lower(off) === lower(service.name));
}

export const serviceById = (id) => SERVICES.find((service) => service.id === id) || null;

// The content scripts for a service, registered only once the user has granted its site.
// Every service also gets the small "Back to Kivori SekAI" card, which only shows in tabs the app opened.
export function contentScriptsFor(service) {
  const scripts = service.scripts || [{ file: service.id, world: "ISOLATED", runAt: "document_idle" }];
  const out = scripts.map((script) => ({
    id: `ks-${script.file}`,
    matches: service.origins,
    js: [`content/site/${script.file}.js`],
    runAt: script.runAt,
    world: script.world,
    persistAcrossSessions: true,
  }));
  out.push({
    id: `ks-return-${service.id}`,
    matches: service.origins,
    js: ["content/site/return.js"],
    runAt: "document_idle",
    world: "ISOLATED",
    persistAcrossSessions: true,
  });
  // Crunchyroll already has the full panel; other connected sites get the corner panel.
  // Key-guard runs in MAIN at document_start so player shortcuts ignore our Shadow DOM panel.
  if (service.id !== "crunchyroll") {
    out.unshift({
      id: `ks-keys-${service.id}`,
      matches: service.origins,
      js: ["content/site/key-guard.js"],
      runAt: "document_start",
      world: "MAIN",
      persistAcrossSessions: true,
    });
    out.push({
      id: `ks-panel-${service.id}`,
      matches: service.origins,
      js: ["content/site-panel.js"],
      runAt: "document_idle",
      world: "ISOLATED",
      persistAcrossSessions: true,
    });
  }
  return out;
}

// What the card on the site says before sending the user back.
export const RETURN_NOTES = {
  crunchyroll: "Sign in if you need to. Keep this tab open while importing.",
  netflix: "Pick your profile first. Keep this tab open while importing.",
  prime: "Sign in and pick your profile first. Keep this tab open while importing.",
  hidive: "Sign in and pick your profile first. Keep this tab open while importing.",
};
export const CATALOG_RETURN_NOTES = {
  crunchyroll: "Sign in if you need to. Keep this tab open, then go back so we can read the catalog.",
  netflix: "Pick your profile first. Keep this tab open, then go back so we can read the anime catalog.",
  hidive: "Sign in if you need to. Keep this tab open, then go back so we can read the catalog.",
  tubi: "Keep this tab open, then go back so we can read Tubi's anime catalog.",
};
export const READY_RETURN_NOTES = {
  catalog: "You're signed in. Keep this tab open, then go back so we can read the catalog.",
  import: "You're signed in. Keep this tab open, then head back to finish the import.",
};
export const returnNote = (service, purpose = "", { ready = false } = {}) => {
  if (ready) return purpose === "catalog" ? READY_RETURN_NOTES.catalog : READY_RETURN_NOTES.import;
  if (purpose === "catalog") return CATALOG_RETURN_NOTES[service.id] || "Keep this tab open, then go back so we can read the catalog.";
  return RETURN_NOTES[service.id] || "Once the page has loaded, head back.";
};

// Whether a page address belongs to a service ("https://www.amazon.com/gp/video/*" style patterns).
export function onService(service, url) {
  return service.origins.some((pattern) => String(url || "").startsWith(pattern.replace(/\*$/, "")));
}

// Chrome grants sites whole and reports "https://www.amazon.com/gp/video/*" back as "https://www.amazon.com/*".
const siteOf = (pattern) => /^[a-z*]+:\/\/[^/]+/i.exec(String(pattern || ""))?.[0].toLowerCase() || "";

// Which services are connected, from the origins Chrome reports as granted.
export function connectedIds(grantedOrigins) {
  const granted = new Set((grantedOrigins || []).map(siteOf));
  return SERVICES.filter((service) => service.origins.every((origin) => granted.has(siteOf(origin)))).map((service) => service.id);
}
