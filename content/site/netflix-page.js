(() => {
  // content/sites/netflix-page.js
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
      const pick = (value) => typeof value === "string" ? value : "";
      window.postMessage({
        source: "crunchilist-search-page",
        kind: "profile",
        id: data.id,
        build: pick(models.serverDefs?.data?.BUILD_IDENTIFIER),
        guid: pick(user.guid) || pick(user.userGuid),
        name: pick(user.name),
        authURL: pick(user.authURL),
        esn: pick(models.esnAccessor?.data?.esn)
      }, location.origin);
    });
  })();
})();
