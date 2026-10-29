// Full CR-equivalent corner panel on connected non-Crunchyroll streaming sites.
// Bundled to content/site-panel.js — no page badges / player bar / CMS scan.
import { createPanel } from "./panel.js";
import { SEARCH_PLATFORMS } from "../ui/search-view.js";
import { ENABLED_KEY, PANEL_ENABLED_KEY, isPanelEnabled } from "../lib/enabled.js";
import { bootWatchGuide } from "./watch-guide.js";

if (!globalThis.__ksSitePanelBooted) {
  globalThis.__ksSitePanelBooted = true;
  bootWatchGuide();
  boot();
}

let activeService = "";
let started = false;

function boot() {
  const begin = async () => {
    if (window.top !== window) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (!(PANEL_ENABLED_KEY in changes) && !(ENABLED_KEY in changes)) return;
      chrome.storage.local.get([ENABLED_KEY, PANEL_ENABLED_KEY]).then((stored) => {
        if (activeService && !isPanelEnabled(activeService, stored)) stopPanel();
        else if (!document.getElementById("ks-site-panel")) startPanel().catch(() => {});
      });
    });
    await startPanel();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", begin, { once: true });
  else begin();
}

function stopPanel() {
  started = false;
  document.getElementById("ks-site-panel")?.remove();
}

async function startPanel() {
  if (window.top !== window) return;
  if (document.getElementById("ks-site-panel")) {
    started = true;
    return;
  }
  const hello = await chrome.runtime.sendMessage({ type: "panelHello" }).catch(() => null);
  if (!hello?.ok || !hello.show) {
    activeService = hello?.service || activeService;
    return;
  }

  activeService = hello.service;
  const name = hello.name || "this site";
  const color = hello.color || "#ff7a2f";
  const layout = hello.layout || {};

  const send = (type, payload = {}) => chrome.runtime.sendMessage({ type, ...payload }).catch((error) => ({
    ok: false,
    error: /context invalidated/i.test(error?.message || "")
      ? "Kivori SekAI was updated. Reload this tab to keep using it."
      : error?.message || "Extension unavailable",
  }));

  const panel = createPanel(document, {
    send,
    site: hello.siteFilter || activeService,
    platforms: SEARCH_PLATFORMS,
    accent: color,
    gatherLabel: `Gathering the ${name} list`,
    layout,
    hostId: "ks-site-panel",
    onOpenChange: (panelOpen) => send("setUi", { panelOpen }),
    onCorner: (panelCorner) => send("setUi", { panelCorner }),
    onView: (view) => panel.setView(view),
  });

  document.documentElement.append(panel.host);
  started = true;

  function syncFullscreen() {
    const video = document.querySelector("video");
    const element = document.fullscreenElement || document.webkitFullscreenElement;
    const videoFullscreen = Boolean(video && (element === video || video.webkitDisplayingFullscreen));
    panel.setFullscreen(Boolean(element || videoFullscreen));
  }

  document.addEventListener("fullscreenchange", syncFullscreen);
  document.addEventListener("webkitfullscreenchange", syncFullscreen);
  window.addEventListener("resize", syncFullscreen);

  chrome.runtime.onMessage.addListener((message) => {
    if (!started || !document.getElementById("ks-site-panel")) return;
    if (message?.type === "enriched" && message.view) panel.setView(message.view, { syncOpen: true });
    if (message?.type === "activity") {
      const list = Array.isArray(message.tasks) ? message.tasks : [];
      panel.setActivity(list);
      const gathering = list.find((task) => task.gathering);
      panel.setGathering(Boolean(gathering), gathering?.label);
    }
  });

  send("getState").then((response) => {
    if (response?.ok && response.view) panel.setView(response.view, { syncOpen: true });
  });
  send("getActivity").then((response) => {
    if (!response?.ok) return;
    const list = Array.isArray(response.tasks) ? response.tasks : [];
    panel.setActivity(list);
    const gathering = list.find((task) => task.gathering);
    panel.setGathering(Boolean(gathering), gathering?.label);
  });
  syncFullscreen();
}
