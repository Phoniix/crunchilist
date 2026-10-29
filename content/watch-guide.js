// Fullscreen-safe guide bubble over the player (Continue watching / marked watched).

const HOST_ID = "ks-watch-guide";
const SHOW_MS = 3500;

const CSS = `
:host {
  all: initial;
  position: fixed;
  left: 50%;
  bottom: max(24px, env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  z-index: 2147483646;
  pointer-events: none;
  font-family: "Nunito", system-ui, sans-serif;
}
.card {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  max-width: min(420px, calc(100vw - 32px));
  padding: 0;
  opacity: 0;
  transform: translateY(12px);
  transition: opacity .22s ease, transform .22s ease;
  pointer-events: auto;
}
.card.show {
  opacity: 1;
  transform: translateY(0);
}
.portrait {
  flex: none;
  width: 64px;
  height: 72px;
  border-radius: 12px;
  border: 3px solid #1a1210;
  background: #fffaf4;
  box-shadow: 3px 3px 0 rgba(26,18,16,.22);
  overflow: hidden;
}
.portrait img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
}
.bubble {
  position: relative;
  flex: 1;
  min-width: 0;
  margin: 0 0 10px;
  padding: 12px 14px 10px;
  border-radius: 14px;
  background: #fffaf4;
  color: #1a1210;
  border: 3px solid #1a1210;
  box-shadow: 3px 3px 0 rgba(26,18,16,.22);
}
.bubble::before,
.bubble::after {
  content: "";
  position: absolute;
  left: -14px;
  bottom: 16px;
  width: 0;
  height: 0;
  border-style: solid;
}
.bubble::before {
  left: -17px;
  bottom: 14px;
  border-width: 8px 16px 8px 0;
  border-color: transparent #1a1210 transparent transparent;
}
.bubble::after {
  border-width: 6px 12px 6px 0;
  border-color: transparent #fffaf4 transparent transparent;
}
.name {
  display: inline-block;
  margin: 0 0 6px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 2px solid #1a1210;
  background: #ff9a4a;
  color: #1a0d05;
  font: 800 10px/1.2 system-ui, sans-serif;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.text {
  margin: 0;
  font: 750 15px/1.35 system-ui, sans-serif;
  letter-spacing: -.01em;
  overflow-wrap: anywhere;
}
`;

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ensureHost(doc = document) {
  let host = doc.getElementById(HOST_ID);
  if (host) return host;
  host = doc.createElement("div");
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${CSS}</style><div class="card" part="card"></div>`;
  (doc.documentElement || doc.body).append(host);
  return host;
}

function adopt(host, doc = document) {
  const element = doc.fullscreenElement || doc.webkitFullscreenElement;
  const parent = element || doc.documentElement || doc.body;
  if (host.parentNode !== parent) parent.append(host);
}

/**
 * Show a short guide popup over the player. Replaces any existing notice.
 * @returns {{ show: Function, destroy: Function }}
 */
export function createWatchGuide(doc = document) {
  let hideTimer = 0;
  let hideAt = 0;
  let remaining = SHOW_MS;
  let paused = false;
  const host = ensureHost(doc);
  const card = host.shadowRoot.querySelector(".card");

  function onFs() {
    adopt(host, doc);
  }

  function clearHide() {
    clearTimeout(hideTimer);
    hideTimer = 0;
  }

  function hide() {
    clearHide();
    paused = false;
    remaining = 0;
    card.classList.remove("show");
  }

  function scheduleHide(ms) {
    clearHide();
    remaining = Math.max(0, ms);
    hideAt = Date.now() + remaining;
    paused = false;
    if (remaining <= 0) {
      hide();
      return;
    }
    hideTimer = setTimeout(hide, remaining);
  }

  function pauseHide() {
    if (!hideTimer || paused) return;
    remaining = Math.max(0, hideAt - Date.now());
    clearHide();
    paused = true;
  }

  function resumeHide() {
    if (!paused) return;
    scheduleHide(remaining);
  }

  doc.addEventListener("fullscreenchange", onFs);
  doc.addEventListener("webkitfullscreenchange", onFs);
  card.addEventListener("pointerenter", pauseHide);
  card.addEventListener("pointerleave", resumeHide);

  function show(payload = {}) {
    const text = String(payload.text || "").trim();
    if (!text) return;
    adopt(host, doc);
    const name = String(payload.name || "Kivi").trim() || "Kivi";
    const portrait = String(payload.portraitUrl || "").trim();
    card.innerHTML = `${portrait ? `<div class="portrait"><img src="${esc(portrait)}" alt=""></div>` : ""}
      <figure class="bubble">
        <figcaption class="name">${esc(name)}</figcaption>
        <blockquote class="text">${esc(text)}</blockquote>
      </figure>`;
    card.classList.remove("show");
    void card.offsetWidth;
    card.classList.add("show");
    scheduleHide(SHOW_MS);
  }

  function destroy() {
    clearHide();
    card.removeEventListener("pointerenter", pauseHide);
    card.removeEventListener("pointerleave", resumeHide);
    doc.removeEventListener("fullscreenchange", onFs);
    doc.removeEventListener("webkitfullscreenchange", onFs);
    host.remove();
  }

  return { show, destroy };
}

/** Boot a singleton listener for `{ type: "watchGuide" }` messages. */
export function bootWatchGuide(doc = document) {
  if (globalThis.__ksWatchGuideBooted) return globalThis.__ksWatchGuide;
  globalThis.__ksWatchGuideBooted = true;
  const guide = createWatchGuide(doc);
  globalThis.__ksWatchGuide = guide;
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "watchGuide") guide.show(message);
  });
  return guide;
}
