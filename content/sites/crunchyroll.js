// Runs on crunchyroll.com only after the user connects Crunchyroll. Passes the page's sign-in token to the
// background (kept in session storage, gone when the browser closes). Playback tracking comes later.
const SOURCE = "crunchilist-search-page";

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.source !== SOURCE || data.kind !== "auth" || typeof data.token !== "string") return;
  chrome.runtime.sendMessage({ type: "crunchyrollAuth", token: data.token }).catch(() => {});
});
