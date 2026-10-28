(() => {
  // content/sites/hidive-page.js
  (() => {
    if (window.__crunchilistSearchHook) return;
    window.__crunchilistSearchHook = true;
    const SOURCE = "crunchilist-search-page";
    const API = "https://dce-frontoffice.imggaming.com/";
    const KEEP = ["authorization", "x-api-key", "realm", "x-app-var", "app", "accept-language"];
    let headers = null;
    function notice(input, init) {
      const url = String(typeof input === "string" ? input : input?.url || "");
      if (!url.startsWith(API)) return;
      const sent = new Headers(init?.headers || input?.headers || void 0);
      if (!/^Bearer\s+\S+/i.test(sent.get("authorization") || "")) return;
      headers = Object.fromEntries(KEEP.filter((name) => sent.has(name)).map((name) => [name, sent.get(name)]));
    }
    const originalFetch = window.fetch;
    window.fetch = function fetch(...args) {
      try {
        notice(args[0], args[1]);
      } catch {
      }
      return originalFetch.apply(this, args);
    };
    function profile() {
      try {
        const token = /^Bearer\s+(\S+)/i.exec(headers?.authorization || "")?.[1] || "";
        const claims = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        return typeof claims?.pro?.id === "string" ? claims.pro.id.slice(0, 120) : "";
      } catch {
        return "";
      }
    }
    async function historyPage(page) {
      if (!headers) return { ok: false, error: "HIDIVE hasn't finished loading in that tab. Wait a moment, or reload it, then try again." };
      const response = await originalFetch(`${API}api/v2/customer/history/vod?p=${page}&rpp=25`, { headers }).catch(() => null);
      if (!response) return { ok: false, error: "HIDIVE didn't answer. Check your connection." };
      if (response.status === 401 || response.status === 403) return { ok: false, error: "Reload the HIDIVE tab and try again (the page may need a fresh session)." };
      if (!response.ok) return { ok: false, error: `HIDIVE didn't answer (${response.status}). Reload the HIDIVE tab and try again.` };
      return { ok: true, body: await response.json().catch(() => null), profile: profile() };
    }
    async function gridPage(url) {
      if (!headers) return { ok: false, error: "HIDIVE hasn't finished loading in that tab." };
      if (typeof url !== "string" || !url.startsWith(`${API}api/v1/view/content-grid?`)) return { ok: false, error: "Not a HIDIVE catalog page." };
      const response = await originalFetch(url, { headers }).catch(() => null);
      if (!response?.ok) return { ok: false, error: `HIDIVE didn't answer (${response?.status || "offline"}).` };
      return { ok: true, body: await response.json().catch(() => null) };
    }
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data;
      if (data?.source !== "crunchilist-search-ext" || typeof data.id !== "string") return;
      const reply = (result) => window.postMessage({ source: SOURCE, kind: data.kind, id: data.id, ...result }, location.origin);
      if (data.kind === "hidive-history") historyPage(Number.isInteger(data.page) && data.page > 0 && data.page < 1e4 ? data.page : 1).then(reply);
      if (data.kind === "hidive-grid") gridPage(data.url).then(reply);
    });
  })();
})();
