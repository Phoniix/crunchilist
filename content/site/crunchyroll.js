(() => {
  // content/sites/crunchyroll.js
  var SOURCE = "crunchilist-search-page";
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.source !== SOURCE || data.kind !== "auth" || typeof data.token !== "string") return;
    chrome.runtime.sendMessage({ type: "crunchyrollAuth", token: data.token }).catch(() => {
    });
  });
})();
