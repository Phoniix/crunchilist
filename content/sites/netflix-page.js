// Runs in the Netflix page itself, only after the user connects Netflix. Reports profile tokens and
// performs viewing-activity / member API calls in the page world (same cookies and context Netflix uses).
// Nothing is changed on Netflix; results only go back to this tab's content script via postMessage.
(() => {
  // Bump when the page protocol changes so inject after an extension update replaces a stale hook.
  const HOOK_VERSION = 2;
  if (window.__crunchilistSearchNetflix === HOOK_VERSION) return;
  const prior = window.__ksNetflixPageOnMessage;
  if (typeof prior === "function") removeEventListener("message", prior);
  window.__crunchilistSearchNetflix = HOOK_VERSION;

  const SOURCE_EXT = "crunchilist-search-ext";
  const SOURCE_PAGE = "crunchilist-search-page";
  const pick = (value) => (typeof value === "string" ? value : "");

  function modelsOf() {
    const netflix = window.netflix || {};
    return netflix.reactContext?.models
      || netflix.appContext?.state?.model?.models
      || netflix.context?.models
      || {};
  }

  function profilePayload(id) {
    const models = modelsOf();
    const user = models.userInfo?.data || {};
    return {
      source: SOURCE_PAGE,
      kind: "profile",
      id,
      build: pick(models.serverDefs?.data?.BUILD_IDENTIFIER),
      guid: pick(user.guid) || pick(user.userGuid),
      name: pick(user.name),
      authURL: pick(user.authURL),
      esn: pick(models.esnAccessor?.data?.esn),
    };
  }

  async function pageFetch({ url, headers, body }) {
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: headers && typeof headers === "object" ? headers : {},
      body: typeof body === "string" ? body : "",
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { ok: response.ok, status: response.status, json };
  }

  function onMessage(event) {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.source !== SOURCE_EXT || !data.id) return;

    if (data.kind === "profile-request") {
      window.postMessage(profilePayload(data.id), location.origin);
      return;
    }

    if (data.kind === "fetch-request") {
      pageFetch(data)
        .then((result) => {
          window.postMessage({
            source: SOURCE_PAGE,
            kind: "fetch-reply",
            id: data.id,
            ok: result.ok,
            status: result.status,
            json: result.json,
          }, location.origin);
        })
        .catch((error) => {
          window.postMessage({
            source: SOURCE_PAGE,
            kind: "fetch-reply",
            id: data.id,
            ok: false,
            status: 0,
            error: String(error?.message || error || "fetch failed").slice(0, 200),
          }, location.origin);
        });
    }
  }

  window.__ksNetflixPageOnMessage = onMessage;
  addEventListener("message", onMessage);
})();
