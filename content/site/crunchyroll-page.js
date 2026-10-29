(() => {
  // content/sites/crunchyroll-page.js
  (() => {
    if (window.__crunchilistSearchHook) return;
    window.__crunchilistSearchHook = true;
    const SOURCE = "crunchilist-search-page";
    let last = "";
    function share(token) {
      if (!token || token === last || token.length < 20 || token.length > 4e3 || /\s/.test(token)) return;
      last = token;
      window.postMessage({ source: SOURCE, kind: "auth", token }, location.origin);
    }
    function bearer(headers) {
      try {
        const match = /^Bearer\s+(\S+)/i.exec(new Headers(headers || void 0).get("authorization") || "");
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
      }
      return originalSetHeader.apply(this, arguments);
    };
  })();
})();
