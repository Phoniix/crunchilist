// Runs on Prime Video only after the user connects it. Tells the background this tab can read watch history,
// then loads the Watch History page on request with the user's own sign-in, the same page the site shows.
// Only the list of what was watched leaves this tab; the profile id is hashed first. Nothing is changed on Prime Video.
import { historyUrl, inspectPrimeHistory } from "../../lib/prime-history.js";

if (window.top === window) chrome.runtime.sendMessage({ type: "primeHello" }).catch(() => {});

async function digest(value) {
  if (!value) return "";
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function history(token) {
  const url = historyUrl(location.origin, typeof token === "string" ? token : "");
  if (!url) throw new Error("Open primevideo.com or amazon.com/gp/video in that tab, then try again.");
  const response = await fetch(url, { credentials: "include", headers: { accept: "text/html" } }).catch(() => null);
  if (!response) throw new Error("Prime Video didn't answer. Check your connection.");
  if (/\/ap\/signin/.test(response.url)) throw new Error("Prime Video showed a sign-in page. Sign in on the Prime Video tab, pick your profile, then try again.");
  if (!response.ok) throw new Error(`Prime Video didn't answer (${response.status}). Reload the Watch History tab and try again.`);
  const inspected = inspectPrimeHistory(await response.text());
  if (!inspected.ok) throw new Error(inspected.detail || "Could not read Prime Video watch history. Reload the Watch History tab and try again.");
  return { days: inspected.data.days, nextToken: inspected.data.nextToken, profile: await digest(inspected.data.profile) };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ignore messages that did not come from this extension's background (other frames may have a tab sender).
  if (sender.id !== chrome.runtime.id || message?.type !== "primeHistory") return false;
  if (sender.tab) return false;
  history(message.token)
    .then((payload) => ({ ok: true, payload }), (error) => ({ ok: false, error: error?.message || "Prime Video didn't answer." }))
    .then(sendResponse);
  return true;
});
