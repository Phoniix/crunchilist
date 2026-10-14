// Streaming services the extension can connect to. Each one is an optional host permission,
// asked for only when the user clicks Connect, so installing never warns about sites they don't use.
export const SERVICES = [
  {
    id: "crunchyroll",
    name: "Crunchyroll",
    origins: ["https://www.crunchyroll.com/*"],
    home: "https://www.crunchyroll.com/",
    why: "Reads your Crunchyroll watch history and notices what you play, using your own sign-in. Nothing is changed on Crunchyroll.",
  },
  {
    id: "netflix",
    name: "Netflix",
    origins: ["https://www.netflix.com/*"],
    home: "https://www.netflix.com/",
    why: "Reads your Netflix viewing activity and notices what you play, using your own sign-in. Nothing is changed on Netflix.",
  },
];

export const serviceById = (id) => SERVICES.find((service) => service.id === id) || null;

// The content script for a service, registered only once the user has granted its site.
export function contentScriptFor(service) {
  return {
    id: `cs-${service.id}`,
    matches: service.origins,
    js: [`content/${service.id}.js`],
    runAt: "document_idle",
    persistAcrossSessions: true,
  };
}

// Which services are connected, from the origins Chrome reports as granted.
export function connectedIds(grantedOrigins) {
  const granted = new Set(grantedOrigins || []);
  return SERVICES.filter((service) => service.origins.every((origin) => granted.has(origin))).map((service) => service.id);
}
