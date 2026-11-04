(() => {
  // lib/match-engine.js
  var LANGUAGES = "English|Japanese|Korean|Chinese|Mandarin|Cantonese|Spanish|Castilian|Latin American Spanish|Latin American|European Spanish|Portuguese|Brazilian Portuguese|European Portuguese|French|German|Italian|Russian|Arabic|Hindi|Tamil|Telugu|Thai|Indonesian|Malay|Vietnamese|Turkish|Polish|Dutch|Swedish";
  var LANGUAGE_TAG = new RegExp(`\\s*\\((?:(?:${LANGUAGES})(?:\\s+(?:Dub|Dubbed|Sub|Subbed|Subtitled|Audio))?|(?:[\\w-]+\\s+)?(?:Dub|Dubbed|Sub|Subbed|Subtitled)|Uncut|Uncensored|Simulcast)\\)`, "gi");

  // lib/prime-history.js
  var HISTORY_PATHS = {
    "www.amazon.com": "/gp/video/settings/watch-history",
    "www.amazon.co.uk": "/gp/video/settings/watch-history",
    "www.amazon.ca": "/gp/video/settings/watch-history",
    "www.amazon.de": "/gp/video/settings/watch-history",
    "www.amazon.co.jp": "/gp/video/settings/watch-history",
    "www.primevideo.com": "/settings/watch-history"
  };
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
  function isHistoryItems(node) {
    if (!node || typeof node !== "object" || !Array.isArray(node.titles)) return false;
    const type = String(node.__type || node.type || "");
    return /ActivityHistoryItems/i.test(type) || node.titles.length > 0 && node.titles.some((day) => day && typeof day === "object" && ("date" in day || Array.isArray(day.titles)));
  }
  function walk(node, found, depth = 0) {
    if (!node || typeof node !== "object" || depth > 16 || found.items && found.profile) return;
    if (!found.items && isHistoryItems(node)) found.items = node;
    if (!found.profile && typeof node.currentProfileID === "string") found.profile = node.currentProfileID.slice(0, 120);
    for (const value of Object.values(node)) walk(value, found, depth + 1);
  }
  function parseScriptBodies(html) {
    const bodies = [];
    for (const match of String(html || "").matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attrs = match[1] || "";
      const body = (match[2] || "").trim();
      if (!body || body.startsWith("//")) continue;
      if (/type\s*=\s*["'](?!text\/template|application\/json|application\/ld\+json)[^"']*["']/i.test(attrs) && !/text\/template|application\/json/i.test(attrs)) continue;
      bodies.push(body);
    }
    return bodies;
  }
  var entry = (title) => ({ gti: gti(title?.gti), type: text(title?.titleType, 20), time: time(title?.time), title: text(title?.title?.text) });
  function packHistory(found) {
    const days = list(found.items.titles, MAX_DAYS).map((day) => ({
      date: text(day?.date, 40),
      titles: list(day?.titles, MAX_TITLES).map((title) => ({ ...entry(title), children: list(title?.children, MAX_TITLES).map(entry) }))
    }));
    const token = found.items.nextToken;
    return { days, nextToken: typeof token === "string" && token.length < 4e3 ? token : "", profile: found.profile || "" };
  }
  function inspectPrimeHistory(html) {
    const page = String(html || "");
    if (!page.trim()) return { ok: false, reason: "empty-html", detail: "Prime returned an empty Watch History page." };
    if (/\/ap\/signin|name=["']email["']|Sign in to your account/i.test(page.slice(0, 8e3))) {
      return { ok: false, reason: "signed-out", detail: "Prime Video showed a sign-in page. Sign in on that tab, pick your profile, then try again." };
    }
    if (/choose.?profile|Who'?s watching|Select a profile/i.test(page.slice(0, 12e3))) {
      return { ok: false, reason: "pick-profile", detail: "Pick your Prime Video profile on that tab, then try the import again." };
    }
    const found = { items: null, profile: "" };
    for (const body of parseScriptBodies(page)) {
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        continue;
      }
      walk(data, found);
      if (found.items && found.profile) break;
    }
    if (!found.items) {
      const anchor = page.search(/ActivityHistoryItems/i);
      if (anchor >= 0) {
        const start = page.lastIndexOf("{", anchor);
        const end = page.indexOf("<\/script>", anchor);
        if (start >= 0 && end > start) {
          try {
            walk(JSON.parse(page.slice(start, end)), found);
          } catch {
          }
        }
      }
    }
    if (!found.items) {
      return {
        ok: false,
        reason: "no-history-json",
        detail: "Could not find Prime Video's watch-history list in the page HTML (Amazon may have changed the page). Reload the Watch History tab and try again."
      };
    }
    return { ok: true, data: packHistory(found) };
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
    if (/\/ap\/signin/.test(response.url)) throw new Error("Prime Video showed a sign-in page. Sign in on the Prime Video tab, pick your profile, then try again.");
    if (!response.ok) throw new Error(`Prime Video didn't answer (${response.status}). Reload the Watch History tab and try again.`);
    const inspected = inspectPrimeHistory(await response.text());
    if (!inspected.ok) throw new Error(inspected.detail || "Could not read Prime Video watch history. Reload the Watch History tab and try again.");
    return { days: inspected.data.days, nextToken: inspected.data.nextToken, profile: await digest(inspected.data.profile) };
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.type !== "primeHistory") return false;
    if (sender.tab) return false;
    history(message.token).then((payload) => ({ ok: true, payload }), (error) => ({ ok: false, error: error?.message || "Prime Video didn't answer." })).then(sendResponse);
    return true;
  });
})();
