(() => {
  // lib/match-engine.js
  var LANGUAGES = "English|Japanese|Korean|Chinese|Mandarin|Cantonese|Spanish|Castilian|Latin American Spanish|Latin American|European Spanish|Portuguese|Brazilian Portuguese|European Portuguese|French|German|Italian|Russian|Arabic|Hindi|Tamil|Telugu|Thai|Indonesian|Malay|Vietnamese|Turkish|Polish|Dutch|Swedish";
  var LANGUAGE_TAG = new RegExp(`\\s*\\((?:(?:${LANGUAGES})(?:\\s+(?:Dub|Dubbed|Sub|Subbed|Subtitled|Audio))?|(?:[\\w-]+\\s+)?(?:Dub|Dubbed|Sub|Subbed|Subtitled)|Uncut|Uncensored|Simulcast)\\)`, "gi");

  // lib/prime-history.js
  var HISTORY_PATHS = { "www.amazon.com": "/gp/video/settings/watch-history", "www.primevideo.com": "/settings/watch-history" };
  var MAX_DAYS = 400;
  var MAX_TITLES = 500;
  function historyUrl(origin, token = "") {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      return "";
    }
    const path = HISTORY_PATHS[host];
    return path ? `https://${host}${path}${token ? `?nextToken=${encodeURIComponent(token)}` : ""}` : "";
  }
  var ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  function decodeEntities(value) {
    return String(value || "").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
      if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? whole;
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return n > 0 && n < 1114112 ? String.fromCodePoint(n) : whole;
    });
  }
  var text = (value, max = 300) => typeof value === "string" ? decodeEntities(value).replace(/\s+/g, " ").trim().slice(0, max) : "";
  var time = (value) => Number.isFinite(value) && value > 0 ? value : 0;
  var gti = (value) => typeof value === "string" && /^amzn1\.dv\.gti\.[\w-]{8,80}$/.test(value) ? value : "";
  var list = (value, max) => Array.isArray(value) ? value.slice(0, max) : [];
  function walk(node, found, depth = 0) {
    if (!node || typeof node !== "object" || depth > 14 || found.items && found.profile) return;
    if (!found.items && node.__type === "atv.wps#ActivityHistoryItems" && Array.isArray(node.titles)) found.items = node;
    if (!found.profile && typeof node.currentProfileID === "string") found.profile = node.currentProfileID.slice(0, 120);
    for (const value of Object.values(node)) walk(value, found, depth + 1);
  }
  var entry = (title) => ({ gti: gti(title?.gti), type: text(title?.titleType, 20), time: time(title?.time), title: text(title?.title?.text) });
  function extractPrimeHistory(html) {
    const found = { items: null, profile: "" };
    for (const match of String(html || "").matchAll(/<script\b[^>]*type="text\/template"[^>]*>([\s\S]*?)<\/script>/g)) {
      let data;
      try {
        data = JSON.parse(match[1]);
      } catch {
        continue;
      }
      walk(data, found);
      if (found.items && found.profile) break;
    }
    if (!found.items) return null;
    const days = list(found.items.titles, MAX_DAYS).map((day) => ({
      date: text(day?.date, 40),
      titles: list(day?.titles, MAX_TITLES).map((title) => ({ ...entry(title), children: list(title?.children, MAX_TITLES).map(entry) }))
    }));
    const token = found.items.nextToken;
    return { days, nextToken: typeof token === "string" && token.length < 4e3 ? token : "", profile: found.profile };
  }

  // content/sites/prime.js
  if (window.top === window) chrome.runtime.sendMessage({ type: "primeHello" }).catch(() => {
  });
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
    if (/\/ap\/signin/.test(response.url)) throw new Error("Prime Video asked you to sign in. Sign in on the Prime Video tab, then continue the import.");
    if (!response.ok) throw new Error(`Prime Video didn't answer (${response.status}). Reload the Prime Video tab and try again.`);
    const found = extractPrimeHistory(await response.text());
    if (!found) throw new Error("Prime Video's Watch History page didn't load as expected. Sign in on the Prime Video tab, pick your profile, then try again.");
    return { days: found.days, nextToken: found.nextToken, profile: await digest(found.profile) };
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.tab || message?.type !== "primeHistory") return false;
    history(message.token).then((payload) => ({ ok: true, payload }), (error) => ({ ok: false, error: error?.message || "Prime Video didn't answer." })).then(sendResponse);
    return true;
  });
})();
