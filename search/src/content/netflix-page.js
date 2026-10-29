// Runs in the Netflix page itself, only after the user connects Netflix. When the extension's content script asks,
// it reports what Netflix's own pages send with their requests (build, profile, request token). It changes nothing.
(() => {
  if (window.__crunchilistSearchNetflix) return;
  window.__crunchilistSearchNetflix = true;

  addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.source !== "crunchilist-search-ext" || data.kind !== "profile-request") return;
    const netflix = window.netflix || {};
    const models = netflix.reactContext?.models || netflix.appContext?.state?.model?.models || {};
    const user = models.userInfo?.data || {};
    const pick = (value) => (typeof value === "string" ? value : "");
    window.postMessage({
      source: "crunchilist-search-page",
      kind: "profile",
      id: data.id,
      build: pick(models.serverDefs?.data?.BUILD_IDENTIFIER),
      guid: pick(user.guid) || pick(user.userGuid),
      name: pick(user.name),
      authURL: pick(user.authURL),
      esn: pick(models.esnAccessor?.data?.esn),
    }, location.origin);
  });
})();
