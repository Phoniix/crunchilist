// Runs in the Crunchyroll page itself, only after the user connects Crunchyroll.
// It notices the sign-in token the site already sends with its own requests and hands it to the
// extension's content script, so history can be read with the user's session. It never changes a request.
(() => {
  if (window.__crunchilistSearchHook) return;
  window.__crunchilistSearchHook = true;
  const SOURCE = "crunchilist-search-page";
  let last = "";

  function share(token) {
    if (!token || token === last || token.length < 20 || token.length > 4000 || /\s/.test(token)) return;
    last = token;
    window.postMessage({ source: SOURCE, kind: "auth", token }, location.origin);
  }

  function bearer(headers) {
    try {
      const match = /^Bearer\s+(\S+)/i.exec(new Headers(headers || undefined).get("authorization") || "");
      return match ? match[1] : "";
    } catch {
      return "";
    }
  }

  const originalFetch = window.fetch;
  window.fetch = function fetch(...args) {
    try {
      const [input, init] = args;
      const url = typeof input === "string" ? input : input?.url || "";
      if (/^https:\/\/(?:www|beta-api)\.crunchyroll\.com\//.test(String(url))) share(bearer(init?.headers) || bearer(input?.headers));
    } catch {
      // The page's request always goes out unchanged.
    }
    return originalFetch.apply(this, args);
  };

  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function setRequestHeader(name, value) {
    try {
      if (/^authorization$/i.test(String(name))) {
        const match = /^Bearer\s+(\S+)/i.exec(String(value || ""));
        if (match) share(match[1]);
      }
    } catch {
      // Keep the page's header call intact.
    }
    return originalSetHeader.apply(this, arguments);
  };
})();
