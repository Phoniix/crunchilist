// Runs in the Tubi page itself, only after the user connects Tubi. Tubi's app signs its catalog requests with a
// guest token; this notices it and, when the content script asks, loads one page of Tubi's Anime category with it,
// the same request tubitv.com/category/anime makes. It never changes a request, and the token never leaves the page.
(() => {
  if (window.__crunchilistSearchHook) return;
  window.__crunchilistSearchHook = true;
  const SOURCE = "crunchilist-search-page";
  const API = "https://tensor-cdn.production-public.tubi.io/";
  const CATEGORY = `${API}api/v7/containers/anime?`;
  let headers = null;

  function notice(url, name, value) {
    if (!String(url || "").startsWith(API) || String(name).toLowerCase() !== "authorization" || !/^Bearer\s+\S+/i.test(String(value || ""))) return;
    headers = { authorization: String(value) };
  }

  const open = XMLHttpRequest.prototype.open;
  const setRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (...args) {
    try { this.__csUrl = String(args[1] || ""); } catch { /* the page's request goes out unchanged */ }
    return open.apply(this, args);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try { notice(this.__csUrl, name, value); } catch { /* unchanged */ }
    return setRequestHeader.call(this, name, value);
  };
  const originalFetch = window.fetch;
  window.fetch = function fetch(...args) {
    try {
      const url = String(typeof args[0] === "string" ? args[0] : args[0]?.url || "");
      const sent = new Headers(args[1]?.headers || args[0]?.headers || undefined);
      notice(url, "authorization", sent.get("authorization"));
    } catch { /* unchanged */ }
    return originalFetch.apply(this, args);
  };

  async function categoryPage(url) {
    if (!headers) return { ok: false, error: "Tubi hasn't finished loading in that tab. Open any Tubi page, then try again." };
    if (typeof url !== "string" || !url.startsWith(CATEGORY)) return { ok: false, error: "Not a Tubi catalog page." };
    const response = await originalFetch(url, { headers }).catch(() => null);
    if (!response?.ok) return { ok: false, error: `Tubi didn't answer (${response?.status || "offline"}).` };
    return { ok: true, body: await response.json().catch(() => null) };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.source !== "crunchilist-search-ext" || data.kind !== "tubi-catalog" || typeof data.id !== "string") return;
    categoryPage(data.url).then((reply) => window.postMessage({ source: SOURCE, kind: data.kind, id: data.id, ...reply }, location.origin));
  });
})();
