import { filterTagSuggestions } from "../lib/taste.js";

const CORNERS = ["bottom-right", "bottom-left", "top-left", "top-right"];

const ROUNDED = '"Crunchilist Rounded", "Trebuchet MS", Candara, sans-serif';

function roundedFontFace() {
  let url = "/fonts/nunito-latin.woff2";
  try {
    if (globalThis.chrome?.runtime?.getURL) url = chrome.runtime.getURL("fonts/nunito-latin.woff2");
  } catch {
    url = "/fonts/nunito-latin.woff2";
  }
  return `@font-face{font-family:"Crunchilist Rounded";src:url("${url}") format("woff2");font-weight:400 700;font-style:normal;font-display:swap;}`;
}

const CSS = `
  :host { color-scheme: dark; pointer-events: none; font: 400 15px/1.4 ${ROUNDED}; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  button, input, select, a, summary, label { font-family: inherit; }
  .launcher {
    width: 56px; height: 56px; border: 0; border-radius: 18px; cursor: pointer;
    background: #ff7a2f; color: #1a0d05;
    font: 700 14px/1 ${ROUNDED};
    box-shadow: 0 10px 28px rgba(0,0,0,.4);
  }
  .launcher:hover { background: #ff8b4a; }
  .launcher, .backdrop, .panel, .drawer { pointer-events: auto; }
  .launcher { position: relative; z-index: 2; }
  .launcher.is-locked { cursor: progress; }
  .launcher.is-locked::after {
    content: "";
    position: absolute; inset: -5px; border-radius: 22px;
    border: 1.5px solid rgba(255, 247, 237, .18);
    border-top-color: #f7f2eb;
    animation: gather-spin .9s linear infinite;
  }
  :host(.fullscreen) .launcher.is-locked::after { display: none; }
  .gather {
    display: flex; align-items: center; gap: 10px; max-width: 240px;
    margin: 0 0 10px; padding: 10px 14px; pointer-events: none;
    background: #161310; color: #f7f2eb;
    border: 1px solid rgba(255, 226, 196, .16); border-radius: 16px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, .45);
    font: 600 13px/1.35 ${ROUNDED};
  }
  .gather[hidden] { display: none !important; }
  .gather-spin {
    width: 16px; height: 16px; flex: none; border-radius: 50%;
    border: 1.5px solid rgba(255, 226, 196, .22);
    border-top-color: #f7f2eb;
    animation: gather-spin .9s linear infinite;
  }
  @keyframes gather-spin { to { transform: rotate(360deg); } }
  .backdrop {
    position: fixed; inset: 0; z-index: 1;
    border: 0; padding: 0; margin: 0;
    background: rgba(8, 6, 4, .55);
    display: none; cursor: pointer;
  }
  .backdrop.is-open { display: block; }
  .launcher:focus-visible, .panel button:focus-visible, .panel a:focus-visible, .panel select:focus-visible, .panel summary:focus-visible, .drawer button:focus-visible, .drawer a:focus-visible, .drawer select:focus-visible, .drawer summary:focus-visible {
    outline: 2px solid #ff8a3d; outline-offset: 2px;
  }
  input:focus, input:focus-visible { outline: none; }
  * {
    scrollbar-width: thin;
    scrollbar-color: #2c2622 transparent;
  }
  *::-webkit-scrollbar { width: 10px; height: 10px; }
  *::-webkit-scrollbar-track { background: transparent; }
  *::-webkit-scrollbar-thumb {
    background: #2c2622;
    border-radius: 999px;
    border: 3px solid transparent;
    background-clip: padding-box;
  }
  *::-webkit-scrollbar-corner { background: transparent; }
  :host(.fullscreen) .launcher {
    width: 14px; height: 64px; border-radius: 8px 0 0 8px; font-size: 0; box-shadow: none;
  }
  :host(.fullscreen) .panel, :host(.fullscreen) .backdrop { display: none; }
  .backdrop.is-open { backdrop-filter: blur(6px); background: rgba(0, 0, 0, .5); }
  .panel {
    position: fixed; z-index: 2;
    left: 50%; top: 12vh; transform: translateX(-50%);
    width: min(560px, calc(100vw - 32px));
    max-height: min(68vh, 640px);
    display: none;
    flex-direction: column;
    overflow: hidden;
    margin: 0;
    border-radius: 28px;
    background: #161310;
    color: #f7f2eb;
    font: 400 15px/1.4 ${ROUNDED};
    border: 1px solid rgba(255, 226, 196, .16);
    box-shadow: 0 30px 80px rgba(0, 0, 0, .55);
  }
  .panel.is-open { display: flex; }
  .chip.is-on { background: #ff7a2f; color: #1a0d05; }
  .ghost, .chip, .quiet, .primary {
    border: 0; background: transparent; color: #cbbfb4; border-radius: 999px;
    min-height: 32px; padding: 4px 12px; cursor: pointer; flex: none;
  }
  .ghost:hover, .quiet:hover, .chip:hover { background: rgba(255,255,255,.06); color: #f6f1ea; }
  .primary { background: #ff7a2f; color: #1a0d05; font-weight: 700; }
  .primary:hover { background: #ff8b4a; }
  .icon-close, .icon-btn {
    width: 36px; height: 36px; min-height: 36px; padding: 0; flex: none;
    border-radius: 12px; background: transparent; color: #cbbfb4;
    display: grid; place-items: center;
  }
  .icon-close:hover, .icon-btn:hover { background: rgba(255, 226, 196, .08); color: #f7f2eb; }
  .icon-btn.is-on {
    color: #f7f2eb;
    background: rgba(255, 226, 196, .08);
    box-shadow: inset 0 0 0 1px rgba(255, 226, 196, .22);
  }
  .icon-btn svg, .icon-close svg { width: 18px; height: 18px; display: block; }
  .account-icon.is-connected {
    color: #f7f2eb;
    box-shadow: inset 0 0 0 1px rgba(255, 226, 196, .28);
  }
  .account-icon.is-connected:hover { background: rgba(255, 226, 196, .08); }
  .account-icon .mark {
    width: auto; height: auto; background: transparent; box-shadow: none;
    font: 700 13px/1 ${ROUNDED}; color: inherit;
  }
  .account-icon svg[hidden], .account-icon .mark[hidden] { display: none !important; }
  .drawer {
    position: fixed; z-index: 2;
    display: none; flex-direction: column; gap: 4px;
    overflow: auto; padding: 16px 16px 18px;
    border-radius: 28px; background: #161310; color: #f7f2eb;
    font: 400 15px/1.4 ${ROUNDED};
    border: 1px solid rgba(255, 226, 196, .16);
    box-shadow: 0 30px 80px rgba(0, 0, 0, .55);
  }
  .drawer.is-open { display: flex; }
  .drawer-title { margin: 2px 2px 8px; font: 700 16px/1.2 ${ROUNDED}; }
  .drawer > .quiet { margin: 8px 8px 0 0; background: #241f1b; border: 1px solid rgba(255, 226, 196, .1); color: #f7f2eb; }
  .topbar {
    display: flex; justify-content: flex-end; align-items: center; gap: 2px;
    flex: none; padding: 8px 10px 0;
  }
  .body { overflow: auto; flex: 1; min-height: 0; padding: 8px 14px; }
  .account {
    display: grid; grid-template-columns: 28px 1fr auto; gap: 10px; align-items: center;
    margin-top: 12px; padding: 10px 12px;
    background: #241f1b; border: 1px solid rgba(255, 226, 196, .1); border-radius: 16px;
  }
  .mark {
    width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center;
    background: transparent; color: #f7f2eb; font: 700 13px/1 ${ROUNDED};
    box-shadow: inset 0 0 0 1px rgba(255, 226, 196, .28);
  }
  .account-name, .account-meta, .context, .forme, .note, .reason { margin: 0; }
  .account-name { font: 700 14px/1.2 ${ROUNDED}; }
  .account-meta, .context, .note, .reason { color: #cbbfb4; }
  .account-meta { font: 600 12px/1.3 ${ROUNDED}; }
  .note, .reason { font-size: 13px; }
  .public { display: flex; gap: 8px; margin-top: 8px; }
  .public[hidden] { display: none; }
  .public input { flex: 1; }
  .context { margin-top: 12px; }
  .forme, .refine { margin-top: 8px; }
  .season { display: flex; flex-direction: column; align-items: stretch; gap: 8px; margin-top: 12px; }
  .season-line { display: flex; align-items: center; gap: 8px; }
  .season-label { color: #a89b90; font-size: 13px; }
  .season select { flex: 1; min-width: 0; }
  .toolbar { display: flex; align-items: center; gap: 8px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; }
  .chip { background: #241f1b; color: #f7f2eb; font-size: 13px; border: 1px solid rgba(255, 226, 196, .16); }
  .check {
    display: flex; flex-direction: row; align-items: center; gap: 6px;
    margin: 0; padding: 6px 10px; color: #f7f2eb; cursor: pointer; font-size: 13px; flex: none;
    background: #241f1b; border: 1px solid rgba(255, 226, 196, .16); border-radius: 999px;
  }
  .body > .note {
    position: relative; overflow: hidden;
    margin-top: 12px; padding: 8px 12px;
    background: #201b17; border-radius: 12px; color: #e6d9cc;
  }
  .note-fill {
    position: absolute; left: 0; top: 0; bottom: 0; width: 0;
    background: rgba(255, 226, 196, .16);
    transition: width .35s ease;
  }
  .note.is-wait .note-fill {
    width: 38%;
    animation: note-slide 1.15s ease-in-out infinite;
  }
  .note.is-under .note-fill {
    top: auto; height: 3px;
    background: rgba(255, 226, 196, .55);
  }
  .note.is-under.is-wait .note-fill { height: 3px; }
  @keyframes note-slide {
    from { transform: translateX(-120%); }
    to { transform: translateX(320%); }
  }
  .note-text { position: relative; z-index: 1; }
  .results { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
  .rail-title { margin: 6px 0 8px; font: 700 15px/1.2 ${ROUNDED}; }
  .rail { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; }
  .poster { width: 112px; flex: none; display: flex; flex-direction: column; gap: 6px; }
  .poster-link { display: flex; flex-direction: column; gap: 6px; color: #f7f2eb; text-decoration: none; }
  .poster img, .poster-fallback {
    width: 112px; height: 158px; object-fit: cover; border-radius: 12px; background: #2a241f; display: block;
  }
  .poster-fallback { display: grid; place-items: center; color: #ff8a3d; font: 700 28px/1 ${ROUNDED}; }
  .poster-title { font: 700 13px/1.25 ${ROUNDED}; }
  .poster select { width: 100%; max-width: none; font-size: 12px; padding: 4px 6px; }
  .card {
    position: relative; overflow: hidden;
    display: flex; gap: 12px; align-items: flex-start;
    padding: 10px 12px;
    background: #241f1b; border: 1px solid rgba(255, 226, 196, .1); border-radius: 16px;
  }
  .card-fill {
    position: absolute; left: 0; top: 0; bottom: 0; width: var(--fill, 0%);
    background: rgba(255, 226, 196, .16);
    pointer-events: none;
  }
  .card > :not(.card-fill) { position: relative; z-index: 1; }
  .card-body { flex: 1; min-width: 0; }
  .rank { flex: none; color: #f7f2eb; font: 700 18px/1 ${ROUNDED}; }
  .fit { flex: none; color: #cbbfb4; font: 700 12px/1 ${ROUNDED}; }
  .mention-title { margin-top: 16px; }
  .thumb, .thumb-fallback {
    width: 48px; height: 68px; flex: none; object-fit: cover; border-radius: 10px; background: #2a241f; display: block;
  }
  .thumb-fallback { display: grid; place-items: center; color: #cbbfb4; font: 700 16px/1 ${ROUNDED}; }
  .card-top { display: flex; align-items: center; gap: 12px; }
  .card a { flex: 1; min-width: 0; color: #f6f1ea; font-weight: 700; font-size: 16px; text-decoration: none; }
  .card a:hover { color: #ff8a3d; }
  .reason { margin-top: 4px; line-height: 1.45; }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
  .tag, .token {
    border-radius: 999px; padding: 3px 8px; background: #3a312a; color: #f7f2eb;
    font: 700 12px/1.3 ${ROUNDED};
  }
  .token { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; border: 0; }
  .token:hover { background: rgba(255,255,255,.1); }
  .token-x { color: #cbbfb4; font-size: 14px; line-height: 1; }
  .field-hint { color: #cbbfb4; font: 600 12px/1.35 ${ROUNDED}; }
  .taste-field { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; }
  .suggest { position: relative; }
  .suggest-list {
    position: absolute; z-index: 3; left: 0; right: 0; top: calc(100% + 4px);
    display: flex; flex-direction: column; gap: 2px;
    margin: 0; padding: 4px; max-height: 180px; overflow: auto;
    background: #241f1b; border: 1px solid rgba(255, 226, 196, .16); border-radius: 12px;
  }
  .suggest-list[hidden] { display: none !important; }
  .suggest-list button {
    width: 100%; text-align: left; border: 0; background: transparent; color: #f7f2eb;
    border-radius: 8px; padding: 6px 8px; cursor: pointer;
  }
  .suggest-list button.is-on, .suggest-list button:hover { background: rgba(255, 226, 196, .08); }
  .card select { width: auto; max-width: 46%; margin: 0; }
  label { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
  input, select {
    background: #100e0c; color: #f7f2eb; border: 1px solid rgba(255, 226, 196, .18);
    border-radius: 12px; padding: 8px 12px;
  }
  .chat {
    position: relative;
    display: flex; align-items: center; gap: 8px; flex: none;
    margin: 0 14px 14px; padding: 4px 16px;
    background: #100e0c; border: 0; border-radius: 18px;
  }
  .ai-switch {
    height: 28px; min-height: 28px; padding: 0 10px; margin-right: -8px;
    border: 0; border-radius: 999px; background: transparent; cursor: pointer;
    color: #8f8278; font: 700 12px/1 ${ROUNDED}; letter-spacing: .04em;
  }
  .ai-switch.is-on {
    color: #f7f2eb;
    background: rgba(255, 226, 196, .06);
    box-shadow: inset 0 0 0 1px rgba(255, 226, 196, .28);
  }
  .ai-switch:hover { color: #f7f2eb; }
  .ai-dot {
    display: inline-block; width: 6px; height: 6px; margin-left: 6px; border-radius: 50%;
    vertical-align: middle; box-shadow: inset 0 0 0 1px #8f8278;
  }
  .ai-dot.is-online { background: #ffe2c4; box-shadow: none; }
  .ai-dot.is-unknown { background: #ff7a2f; box-shadow: none; opacity: .8; }
  .model-state { margin-left: 6px; font-weight: 700; color: #8f8278; }
  .model-state.is-online { color: #f7f2eb; }
  .model-state.is-unknown { color: #ff9a5c; }
  .model-detail { display: block; margin-top: 2px; color: #a8988c; font-size: 12px; }
  .search-drop {
    position: absolute; z-index: 4; left: 0; right: 0; bottom: calc(100% + 8px);
    display: flex; flex-direction: column; gap: 2px;
    margin: 0; padding: 6px; max-height: 320px; overflow: auto;
    background: #241f1b; border: 1px solid rgba(255, 226, 196, .16); border-radius: 16px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, .45);
  }
  .search-drop[hidden] { display: none !important; }
  .search-drop a {
    display: flex; flex-direction: row; align-items: center; gap: 10px;
    padding: 6px 8px; border-radius: 10px;
    color: #f7f2eb; text-decoration: none;
  }
  .search-drop a.is-on, .search-drop a:hover { background: rgba(255, 226, 196, .08); }
  .search-drop .thumb, .search-drop .thumb-fallback { width: 36px; height: 50px; border-radius: 8px; font-size: 14px; }
  .drop-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .drop-title { font: 700 14px/1.25 ${ROUNDED}; }
  .drop-reason { color: #cbbfb4; font: 600 12px/1.3 ${ROUNDED}; }
  .chat input {
    flex: 1; height: 48px; border: 0; background: transparent;
    border-radius: 0; padding: 0; font-size: 18px; font-weight: 700;
  }
  .chat input::placeholder { color: #a8988c; font-weight: 650; }
  details { margin-top: 8px; }
  summary {
    cursor: pointer; list-style: none; padding: 10px 12px;
    color: #f7f2eb; background: #241f1b; border-radius: 12px;
    border: 1px solid rgba(255, 226, 196, .1);
  }
  summary::-webkit-details-marker { display: none; }
  .row, .reveal { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .row { margin-top: 10px; }
  .reveal { flex-wrap: nowrap; }
  .reveal input { flex: 1; min-width: 0; }
  .tokens { display: flex; flex-wrap: wrap; gap: 4px; }
  .empty { padding: 28px 0; text-align: center; }
`;

function icon(parts) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const [tag, attrs] of parts) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

function fillSelect(select, value) {
  const options = [
    ["", "Set status"],
    ["finished", "Finished"],
    ["in_progress", "In progress"],
    ["dropped", "Dropped"],
    ["plan", "Plan to watch"],
    ["clear", "Clear"],
  ];
  select.replaceChildren();
  for (const [optionValue, label] of options) {
    select.append(el("option", { value: optionValue, text: label }));
  }
  select.value = value || "";
}

export function createPanel(doc, handlers) {
  const host = doc.createElement("div");
  host.id = "cr-corner-host";
  host.dataset.corner = "bottom-right";
  const shadow = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = roundedFontFace() + CSS;
  const backdrop = el("button", { class: "backdrop", type: "button", "aria-label": "Close Crunchilist" });
  const launcher = el("button", {
    class: "launcher",
    type: "button",
    "aria-expanded": "false",
    "aria-controls": "cr-corner-panel",
    text: "Find",
  });
  launcher.title = "Open Crunchilist";
  const gatherText = el("span", { class: "gather-text", text: "Gathering the Crunchyroll list" });
  const gather = el("div", { class: "gather", hidden: true }, [
    el("span", { class: "gather-spin", "aria-hidden": "true" }),
    gatherText,
  ]);
  const panel = el("section", { class: "panel", id: "cr-corner-panel", role: "dialog", "aria-label": "Crunchilist" });
  panel.hidden = true;
  const drawer = el("section", { class: "drawer", role: "dialog", "aria-label": "Settings" });
  drawer.hidden = true;
  shadow.append(style, backdrop, launcher, gather, panel, drawer);

  const cornerButton = el("button", { class: "quiet", type: "button", text: "Move button", "aria-label": "Move Crunchilist to the next corner" });
  const refreshCovers = el("button", {
    class: "quiet",
    type: "button",
    text: "Refresh catalog",
    title: "Update Crunchyroll titles, AniList matches, and Chrome's model",
  });
  const closeButton = el("button", { class: "ghost icon-close", type: "button", "aria-label": "Minimize Crunchilist" }, [
    icon([["path", { d: "M7 7l10 10M17 7L7 17" }]]),
  ]);
  const accountMark = el("span", { class: "mark", text: "A", hidden: true });
  const accountIcon = el("button", {
    class: "icon-btn account-icon",
    type: "button",
    "aria-label": "Sign in to AniList",
    "aria-expanded": "false",
    title: "Sign in to AniList",
  }, [
    icon([
      ["circle", { cx: "12", cy: "8", r: "3.25" }],
      ["path", { d: "M5.75 19.25a6.5 6.5 0 0 1 12.5 0" }],
    ]),
    accountMark,
  ]);
  const settingsButton = el("button", {
    class: "icon-btn",
    type: "button",
    "aria-label": "Settings",
    "aria-expanded": "false",
    title: "Settings",
  }, [
    icon([
      ["circle", { cx: "12", cy: "12", r: "3" }],
      ["path", { d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" }],
    ]),
  ]);
  const accountName = el("p", { class: "account-name", text: "Not connected" });
  const accountMeta = el("p", { class: "account-meta", text: "Connect AniList to write marks back." });
  const accountButton = el("button", { class: "primary", type: "button", text: "Set up" });
  const account = el("div", { class: "account" }, [
    accountMark,
    el("div", {}, [accountName, accountMeta]),
    accountButton,
  ]);
  const userInput = el("input", { type: "text", "aria-label": "AniList username", placeholder: "Public AniList username" });
  const importButton = el("button", { class: "quiet", type: "button", text: "Import" });
  const publicRow = el("form", { class: "public" }, [userInput, importButton]);
  const context = el("p", { class: "context", text: "Looking at this page." });
  const forMe = el("p", { class: "forme" });
  forMe.hidden = true;
  const refineButton = el("button", { class: "quiet refine", type: "button", text: "Refine with AI" });
  refineButton.hidden = true;
  const currentLabel = el("span", { class: "season-label", text: "This season" });
  const currentStatus = el("select", { "aria-label": "Status for the open season" });
  fillSelect(currentStatus, "");
  const progressButton = el("button", { class: "quiet", type: "button", text: "Update AniList" });
  progressButton.hidden = true;
  const currentRow = el("div", { class: "season" }, [
    el("div", { class: "season-line" }, [currentLabel, currentStatus]),
    progressButton,
  ]);
  currentRow.hidden = true;
  const chips = el("div", { class: "chips" });
  const hideInput = el("input", { type: "checkbox", id: "cr-hide-watched" });
  const hideLabel = el("label", { class: "check", for: "cr-hide-watched" }, [hideInput, doc.createTextNode("Hide watched")]);
  const noteFill = el("span", { class: "note-fill", "aria-hidden": "true" });
  const noteText = el("span", { class: "note-text" });
  const notice = el("p", { class: "note", "aria-live": "polite", hidden: true }, [noteFill, noteText]);
  const results = el("div", { class: "results" });
  const chatInput = el("input", { type: "text", placeholder: "Search or ask", "aria-label": "Search or ask", autocomplete: "off" });
  const aiDot = el("span", { class: "ai-dot", "aria-hidden": "true" });
  const aiSwitch = el("button", {
    class: "ai-switch is-on",
    type: "button",
    "aria-pressed": "true",
    "aria-label": "Use AI",
    title: "On: Enter asks. Off: Enter shows the full list.",
  }, [doc.createTextNode("AI"), aiDot]);
  let modelStatusText = "";
  const drop = el("div", { class: "search-drop", role: "listbox", hidden: true });
  const topbar = el("div", { class: "topbar" }, [accountIcon, settingsButton, closeButton]);
  const chat = el("form", { class: "chat" }, [chatInput, aiSwitch, drop]);
  const tasteBox = el("div");
  const settingsBox = el("div");
  const body = el("div", { class: "body" }, [
    el("div", { class: "toolbar" }, [chips, hideLabel]),
    notice,
    results,
  ]);
  panel.append(topbar, body, chat);
  drawer.append(
    el("h2", { class: "drawer-title", text: "Settings" }),
    account,
    context,
    forMe,
    refineButton,
    currentRow,
    publicRow,
    el("details", {}, [el("summary", { text: "Tags/Genre preferences" }), tasteBox]),
    el("details", {}, [el("summary", { text: "AI" }), settingsBox]),
    refreshCovers,
    cornerButton,
  );

  const chipDefs = [
    ["in-progress", "In progress", "Shows you have started"],
    ["plan", "Plan to watch", "Shows you plan to watch"],
    ["unwatched", "Not started", "Shows you have not begun"],
    ["new", "New", "Newly added on Crunchyroll"],
    ["one-cour", "Short series", "About 10 to 13 episodes"],
    ["movie", "Movies", "Movies only"],
  ];
  let activeChip = "";
  const chipButtons = new Map();
  for (const [id, label, hint] of chipDefs) {
    const button = el("button", { class: "chip", type: "button", text: label, title: hint });
    chipButtons.set(id, button);
    button.addEventListener("click", () => {
      activeChip = activeChip === id ? "" : id;
      for (const [chipId, node] of chipButtons) node.classList.toggle("is-on", chipId === activeChip);
      if (chatInput.value.trim()) refreshSuggest();
      else {
        closeDrop();
        handlers.onSearch("", activeChip);
      }
    });
    chips.append(button);
  }

  let open = false;
  let drawerOpen = false;
  let fullscreen = false;
  let gathering = false;
  let gatherMessage = "Gathering the Crunchyroll list";
  let corner = "bottom-right";
  let view = null;
  let refined = false;
  let useAi = true;
  let suggestions = [];
  let suggestActive = -1;
  let suggestToken = 0;

  function place() {
    const edge = {
      "bottom-right": "right:16px;bottom:16px;left:auto;top:auto;",
      "bottom-left": "left:16px;bottom:16px;right:auto;top:auto;",
      "top-left": "left:16px;top:16px;right:auto;bottom:auto;",
      "top-right": "right:16px;top:16px;left:auto;bottom:auto;",
    };
    const align = corner.endsWith("left") ? "flex-start" : "flex-end";
    const column = corner.startsWith("bottom") ? "column-reverse" : "column";
    const base = `all:initial;position:fixed;z-index:2147483646;display:flex;flex-direction:${column};align-items:${align};pointer-events:none;`;
    host.dataset.corner = corner;
    host.classList.toggle("fullscreen", fullscreen);
    host.style.cssText = fullscreen
      ? `${base}top:40%;right:0;left:auto;bottom:auto;`
      : `${base}${edge[corner] || edge["bottom-right"]}`;
    placeDrawer();
  }

  function placeDrawer() {
    if (!drawerOpen) return;
    const rect = panel.getBoundingClientRect();
    const gap = 12;
    const width = Math.min(320, Math.max(240, window.innerWidth - 24));
    let left = rect.right + gap;
    if (left + width > window.innerWidth - 8) left = Math.max(8, rect.left - gap - width);
    drawer.style.top = `${Math.max(8, rect.top)}px`;
    drawer.style.left = `${left}px`;
    drawer.style.width = `${width}px`;
    drawer.style.maxHeight = `${Math.max(240, rect.height)}px`;
  }

  function setDrawer(next) {
    drawerOpen = Boolean(next) && open && !fullscreen;
    drawer.hidden = !drawerOpen;
    drawer.classList.toggle("is-open", drawerOpen);
    settingsButton.classList.toggle("is-on", drawerOpen);
    settingsButton.setAttribute("aria-expanded", drawerOpen ? "true" : "false");
    accountIcon.setAttribute("aria-expanded", drawerOpen ? "true" : "false");
    if (drawerOpen) placeDrawer();
  }

  function showPanel() {
    const shown = open && !fullscreen;
    panel.hidden = !shown;
    panel.classList.toggle("is-open", shown);
    backdrop.hidden = !shown;
    backdrop.classList.toggle("is-open", shown);
    launcher.setAttribute("aria-expanded", shown ? "true" : "false");
    launcher.title = shown ? "Minimize Crunchilist" : "Open Crunchilist";
    if (!shown) setDrawer(false);
    paintGather();
  }

  function paintGather() {
    const show = gathering && !fullscreen;
    gather.hidden = !show;
    gather.classList.toggle("is-on", show);
    gatherText.textContent = gatherMessage;
    launcher.classList.toggle("is-locked", gathering);
    launcher.disabled = fullscreen || gathering;
    launcher.setAttribute("aria-busy", gathering ? "true" : "false");
    if (gathering) launcher.title = gatherMessage;
    else if (!open) launcher.title = "Open Crunchilist";
  }

  function setOpen(next, { focus = false, silent = false } = {}) {
    if ((fullscreen || gathering) && next) return;
    open = next;
    if (!open) drawerOpen = false;
    showPanel();
    if (focus && open) chatInput.focus();
    if (!silent) handlers.onOpenChange(open);
    if (open) handlers.onSearch(chatInput.value.trim(), activeChip);
  }

  backdrop.addEventListener("click", () => {
    setOpen(false);
    launcher.focus();
  });
  launcher.addEventListener("click", () => {
    if (fullscreen || gathering) return;
    setOpen(!open, { focus: !open });
  });
  closeButton.addEventListener("click", () => {
    setOpen(false);
    launcher.focus();
  });
  settingsButton.addEventListener("click", () => setDrawer(!drawerOpen));
  accountIcon.addEventListener("click", () => setDrawer(!drawerOpen));
  window.addEventListener("resize", () => placeDrawer());
  refreshCovers.addEventListener("click", () => handlers.onRefreshCovers());
  cornerButton.addEventListener("click", () => {
    corner = CORNERS[(CORNERS.indexOf(corner) + 1) % CORNERS.length];
    place();
    handlers.onCorner(corner);
  });
  hideInput.addEventListener("change", () => handlers.onHideWatched(hideInput.checked));
  currentStatus.addEventListener("change", () => {
    if (!view?.currentId) return;
    const status = currentStatus.value === "clear" ? null : currentStatus.value || null;
    if (currentStatus.value === "") return;
    handlers.onStatus(view.currentId, status);
  });
  progressButton.addEventListener("click", () => {
    if (view?.progressOffer) handlers.onSyncProgress(view.progressOffer);
  });
  refineButton.addEventListener("click", () => handlers.onRefine());
  let searchTimer = 0;

  function paintAi() {
    aiSwitch.classList.toggle("is-on", useAi);
    aiSwitch.setAttribute("aria-pressed", useAi ? "true" : "false");
    aiSwitch.title = (useAi ? "On: Enter asks. Off: Enter shows the full list." : "Off: Enter shows the full list.") + modelStatusText;
    chatInput.placeholder = useAi ? "Search or ask" : "Search Crunchyroll";
    chatInput.setAttribute("aria-label", useAi ? "Search or ask" : "Search the Crunchyroll catalog");
  }

  function closeDrop() {
    suggestions = [];
    suggestActive = -1;
    drop.hidden = true;
    drop.replaceChildren();
  }

  function paintDrop(items) {
    suggestions = items || [];
    drop.replaceChildren();
    if (!suggestions.length) {
      drop.hidden = true;
      return;
    }
    suggestions.forEach((item, index) => {
      const link = el("a", { href: item.url || "#", role: "option" }, [
        artwork(item),
        el("span", { class: "drop-copy" }, [
          el("span", { class: "drop-title", text: item.title }),
          item.reason ? el("span", { class: "drop-reason", text: item.reason }) : null,
        ]),
      ]);
      if (index === suggestActive) link.classList.add("is-on");
      link.addEventListener("mousedown", (event) => event.preventDefault());
      drop.append(link);
    });
    drop.hidden = false;
  }

  function refreshSuggest() {
    const query = chatInput.value.trim();
    window.clearTimeout(searchTimer);
    if (!query) {
      suggestToken += 1;
      closeDrop();
      return;
    }
    const token = ++suggestToken;
    searchTimer = window.setTimeout(async () => {
      const response = await handlers.onSuggest?.(query, activeChip);
      if (token !== suggestToken || chatInput.value.trim() !== query) return;
      suggestActive = -1;
      paintDrop(response?.suggestions || []);
    }, 140);
  }

  aiSwitch.addEventListener("click", () => {
    useAi = !useAi;
    paintAi();
    handlers.onUseAi?.(useAi);
  });
  chatInput.addEventListener("input", () => refreshSuggest());
  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !drop.hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeDrop();
      return;
    }
    if (drop.hidden || !suggestions.length) return;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = suggestActive < 0 ? 0 : suggestActive + step;
    suggestActive = (next + suggestions.length) % suggestions.length;
    paintDrop(suggestions);
  });
  chat.addEventListener("submit", (event) => {
    event.preventDefault();
    window.clearTimeout(searchTimer);
    suggestToken += 1;
    closeDrop();
    const query = chatInput.value.trim();
    if (useAi && query) handlers.onPrompt?.(query, activeChip);
    else handlers.onSearch(query, activeChip);
  });
  accountButton.addEventListener("click", () => {
    if (view?.settings?.anilistConnected) handlers.onRefresh();
    else handlers.onOpenOptions();
  });
  publicRow.addEventListener("submit", (event) => {
    event.preventDefault();
    handlers.onImport(userInput.value.trim());
  });
  importButton.addEventListener("click", () => handlers.onImport(userInput.value.trim()));
  host.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape" && open && !fullscreen) {
      if (!drop.hidden) closeDrop();
      else if (drawerOpen) setDrawer(false);
      else {
        setOpen(false);
        launcher.focus();
      }
    }
  });
  host.addEventListener("click", (event) => event.stopPropagation());
  place();

  function renderTokens(container, values, field) {
    container.replaceChildren();
    for (const value of values || []) {
      const button = el("button", { class: "token", type: "button", "aria-label": `Remove ${value}` }, [
        el("span", { text: value }),
        el("span", { class: "token-x", "aria-hidden": "true", text: "×" }),
      ]);
      button.addEventListener("click", () => {
        const taste = { ...view.taste, [field]: view.taste[field].filter((item) => item !== value) };
        handlers.onTaste(taste);
      });
      container.append(button);
    }
  }

  function tasteField(field, label, hint) {
    const tokens = el("div", { class: "tokens" });
    const input = el("input", { type: "text", "aria-label": label, "aria-autocomplete": "list", placeholder: "Type a tag", autocomplete: "off" });
    const list = el("div", { class: "suggest-list", role: "listbox", hidden: true });
    let matches = [];
    let active = -1;

    function paintList() {
      list.replaceChildren();
      if (!matches.length) {
        list.hidden = true;
        return;
      }
      matches.forEach((name, index) => {
        const option = el("button", { type: "button", role: "option", text: name });
        if (index === active) option.classList.add("is-on");
        option.addEventListener("mousedown", (event) => {
          event.preventDefault();
          addTag(name);
        });
        list.append(option);
      });
      list.hidden = false;
    }

    function closeList() {
      matches = [];
      active = -1;
      list.hidden = true;
      list.replaceChildren();
    }

    function addTag(value) {
      const next = String(value || "").trim();
      if (!next || !view) return;
      const exists = (view.taste[field] || []).some((item) => item.toLowerCase() === next.toLowerCase());
      input.value = "";
      closeList();
      if (exists) return;
      handlers.onTaste({ ...view.taste, [field]: [...view.taste[field], next] });
    }

    input.addEventListener("input", () => {
      matches = filterTagSuggestions(input.value, view?.tagSuggestions || [], view?.taste?.[field] || []);
      active = matches.length ? 0 : -1;
      paintList();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !list.hidden) {
        event.preventDefault();
        event.stopPropagation();
        closeList();
        return;
      }
      if (!list.hidden && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        active = (active + step + matches.length) % matches.length;
        paintList();
        return;
      }
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (!list.hidden && active >= 0) addTag(matches[active]);
      else addTag(input.value);
    });
    input.addEventListener("blur", () => closeList());
    const wrap = el("div", { class: "taste-field" }, [
      el("span", { class: "account-name", text: label }),
      el("span", { class: "field-hint", text: hint }),
      tokens,
      el("div", { class: "suggest" }, [input, list]),
    ]);
    wrap.dataset.field = field;
    return { wrap, tokens };
  }

  const liked = tasteField("liked", "What I like", "Shows with these tags rank higher.");
  const disliked = tasteField("disliked", "What I don't like", "Shows with these tags rank lower.");
  const dropped = tasteField("dropped", "Dropped", "A softer dislike, for tags on shows you stopped watching.");
  const avoids = tasteField("hardAvoids", "Hard avoids", "Shows with these tags are left out.");
  const audio = el("select", { "aria-label": "Audio preference" });
  for (const [value, label] of [["any", "Any audio"], ["sub", "Prefer sub"], ["dub", "Prefer dub"]]) {
    audio.append(el("option", { value, text: label }));
  }
  audio.addEventListener("change", () => {
    if (!view) return;
    handlers.onTaste({ ...view.taste, subDub: audio.value });
  });
  tasteBox.append(liked.wrap, disliked.wrap, dropped.wrap, avoids.wrap, el("label", {}, [el("span", { text: "Sub or dub" }), audio]));

  const keyInput = el("input", { type: "password", autocomplete: "off", "aria-label": "API key", placeholder: "API key" });
  const keyToggle = el("button", { class: "quiet", type: "button", text: "Show", "aria-label": "Show API key", "aria-pressed": "false" });
  keyToggle.addEventListener("click", () => {
    const shown = keyInput.type === "text";
    keyInput.type = shown ? "password" : "text";
    keyToggle.textContent = shown ? "Show" : "Hide";
    keyToggle.setAttribute("aria-label", shown ? "Show API key" : "Hide API key");
    keyToggle.setAttribute("aria-pressed", shown ? "false" : "true");
  });
  const saveSettings = el("button", { class: "primary", type: "button", text: "Save" });
  const clearKey = el("button", { class: "quiet", type: "button", text: "Clear key" });
  const optionsButton = el("button", { class: "quiet", type: "button", text: "Open settings" });
  const modelName = el("span", { text: "Selected model: Chrome" });
  const modelState = el("span", { class: "model-state", text: "Unknown" });
  const modelDetail = el("span", { class: "model-detail" });
  const modelLine = el("p", { class: "note" }, [modelName, modelState, modelDetail]);
  settingsBox.append(
    modelLine,
    el("label", {}, [el("span", { text: "Optional API key" }), el("div", { class: "reveal" }, [keyInput, keyToggle])]),
    el("div", { class: "row" }, [saveSettings, clearKey, optionsButton]),
  );
  saveSettings.addEventListener("click", () => {
    const apiKey = keyInput.value.trim();
    if (!apiKey) return;
    keyInput.value = "";
    handlers.onSaveSettings({ apiKey });
  });
  clearKey.addEventListener("click", () => handlers.onClearKey());
  optionsButton.addEventListener("click", () => handlers.onOpenOptions());

  function writeNote(text, progress, under = false) {
    const value = text || "";
    noteText.textContent = value;
    notice.hidden = !value;
    const hasProgress = typeof progress === "number" && Number.isFinite(progress);
    notice.classList.toggle("is-under", hasProgress && under);
    notice.classList.toggle("is-wait", hasProgress && progress <= 0);
    if (!hasProgress) {
      noteFill.style.width = "0";
      return;
    }
    const width = progress <= 0 ? 0 : Math.min(100, Math.max(6, Math.round(progress * 100)));
    noteFill.style.width = `${width}%`;
  }

  function artwork(item) {
    if (item.poster) return el("img", { class: "thumb", src: item.poster, alt: "", referrerpolicy: "no-referrer" });
    return el("span", { class: "thumb thumb-fallback", text: (item.title || "?").slice(0, 1).toUpperCase() });
  }

  function statusSelect(item) {
    const select = el("select", { "aria-label": `Status for ${item.title}` });
    fillSelect(select, item.status || "");
    select.addEventListener("change", () => {
      if (!select.value) return;
      handlers.onStatus(item.id, select.value === "clear" ? null : select.value);
    });
    return select;
  }

  function renderRail(section) {
    const rail = el("div", { class: "rail" });
    for (const item of section.items || []) {
      const art = item.poster
        ? el("img", { src: item.poster, alt: "", referrerpolicy: "no-referrer" })
        : el("span", { class: "poster-fallback", text: (item.title || "?").slice(0, 1).toUpperCase() });
      rail.append(el("article", { class: "poster" }, [
        el("a", { class: "poster-link", href: item.url }, [
          art,
          el("span", { class: "poster-title", text: item.title }),
        ]),
        statusSelect(item),
      ]));
    }
    return el("section", {}, [el("h2", { class: "rail-title", text: section.title }), rail]);
  }

  function contextText() {
    if (!view) return "Looking at this page.";
    if (view.kind === "series") return view.currentTitle ? `Series · ${view.currentTitle}` : "Series page";
    if (view.kind === "watch") return view.currentTitle ? `Watching · ${view.currentTitle}` : "Watching";
    return "Search the catalog";
  }

  function paintTaste() {
    if (!view?.taste) return;
    const active = shadow.activeElement;
    renderTokens(liked.tokens, view.taste.liked, "liked");
    renderTokens(disliked.tokens, view.taste.disliked, "disliked");
    renderTokens(dropped.tokens, view.taste.dropped, "dropped");
    renderTokens(avoids.tokens, view.taste.hardAvoids, "hardAvoids");
    if (active !== audio) audio.value = view.taste.subDub || "any";
  }

  return {
    host,
    setView(next, { syncOpen = false } = {}) {
      if (next?.url && next.url !== view?.url) refined = false;
      view = next || view;
      if (!view) return;
      context.textContent = contextText();
      context.hidden = context.textContent === "Search the catalog" || context.textContent === "Looking at this page.";
      if (!refined) forMe.textContent = view.forMe || "";
      forMe.hidden = !forMe.textContent;
      refineButton.hidden = !(view.settings?.hasKey && (view.kind === "series" || view.kind === "watch"));
      currentRow.hidden = !view.currentId;
      if (shadow.activeElement !== currentStatus) currentStatus.value = view.currentStatus || "";
      hideInput.checked = Boolean(view.settings?.hideWatched);
      const offer = view.progressOffer;
      progressButton.hidden = !offer;
      progressButton.textContent = offer ? `Update AniList to episode ${offer.to}` : "Update AniList";
      const connected = Boolean(view.settings?.anilistConnected && view.settings?.anilistViewerName);
      const importedAt = view.importMeta?.importedAt
        ? new Date(view.importMeta.importedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
        : "";
      if (connected) {
        accountMark.hidden = false;
        accountIcon.querySelector("svg").hidden = true;
        accountIcon.classList.add("is-connected");
        accountMark.textContent = view.settings.anilistViewerName.slice(0, 1).toUpperCase();
        accountIcon.title = view.settings.anilistViewerName;
        accountIcon.setAttribute("aria-label", `AniList account, ${view.settings.anilistViewerName}`);
        accountName.textContent = view.settings.anilistViewerName;
        accountMeta.textContent = importedAt ? `AniList · ${importedAt}` : "AniList";
        accountButton.textContent = "Refresh";
        accountButton.className = "quiet";
        publicRow.hidden = true;
      } else if (view.importMeta?.username) {
        accountMark.hidden = true;
        accountIcon.querySelector("svg").hidden = false;
        accountIcon.classList.remove("is-connected");
        accountIcon.title = "Sign in to AniList";
        accountIcon.setAttribute("aria-label", "Sign in to AniList");
        accountMark.textContent = view.importMeta.username.slice(0, 1).toUpperCase();
        accountName.textContent = view.importMeta.username;
        accountMeta.textContent = importedAt ? `Public list · ${importedAt}` : "Public list";
        accountButton.textContent = "Set up";
        accountButton.className = "primary";
        publicRow.hidden = false;
      } else {
        accountMark.hidden = true;
        accountIcon.querySelector("svg").hidden = false;
        accountIcon.classList.remove("is-connected");
        accountIcon.title = "Sign in to AniList";
        accountIcon.setAttribute("aria-label", "Sign in to AniList");
        accountName.textContent = "Not connected";
        accountMeta.textContent = "Connect to keep marks in sync.";
        accountButton.textContent = "Set up";
        accountButton.className = "primary";
        publicRow.hidden = false;
      }
      if (typeof view.settings?.useAi === "boolean" && view.settings.useAi !== useAi) {
        useAi = view.settings.useAi;
        paintAi();
      }
      modelName.textContent = `Selected model: ${view.settings?.modelLabel || "Chrome"}`;
      keyInput.placeholder = view.settings?.hasKey ? "Key saved on this device" : "API key";
      if (shadow.activeElement !== userInput && view.settings?.anilistUsername) userInput.value = view.settings.anilistUsername;
      paintTaste();
      if (syncOpen) {
        corner = view.settings?.panelCorner || corner;
        place();
        setOpen(false, { silent: true });
      }
    },
    setResults(payload) {
      const note = [payload?.notice, payload?.note].filter(Boolean).join(" ");
      writeNote(note, payload?.downloading ? (payload.progress ?? 0) : undefined, Boolean(payload?.downloading));
      results.replaceChildren();
      const sections = payload?.sections || [];
      if (sections.length) {
        for (const section of sections) results.append(renderRail(section));
        return;
      }
      const list = payload?.results || [];
      if (!list.length) {
        results.append(el("p", { class: "note empty", text: payload?.note || payload?.notice || "Type a title to search." }));
        return;
      }
      const renderResult = (item) => {
        const select = el("select", { "aria-label": `Status for ${item.title}` });
        fillSelect(select, item.status || "");
        select.addEventListener("change", () => {
          if (!select.value) return;
          handlers.onStatus(item.id, select.value === "clear" ? null : select.value);
        });
        const tags = el("div", { class: "tags" });
        for (const tag of item.tags || []) tags.append(el("span", { class: "tag", text: tag }));
        const confidence = Number.isInteger(item.confidence) ? item.confidence : null;
        const card = el("article", { class: item.mention ? "card is-mention" : "card" }, [
          confidence != null ? el("div", { class: "card-fill" }) : null,
          artwork(item),
          el("div", { class: "card-body" }, [
            el("div", { class: "card-top" }, [
              Number.isInteger(item.rank) ? el("span", { class: "rank", text: String(item.rank) }) : null,
              el("a", { href: item.url, text: item.title }),
              confidence != null ? el("span", { class: "fit", text: `${confidence}%` }) : null,
              select,
            ]),
            el("p", { class: "reason", text: item.reason || "" }),
            tags,
          ]),
        ]);
        if (confidence != null) card.style.setProperty("--fill", `${confidence}%`);
        return card;
      };
      const picks = list.filter((item) => !item.mention);
      const mentions = list.filter((item) => item.mention);
      for (const item of picks) results.append(renderResult(item));
      if (!picks.length) {
        for (const item of list) results.append(renderResult(item));
      } else if (mentions.length) {
        results.append(el("p", { class: "rail-title mention-title", text: "Honorable mentions" }));
        for (const item of mentions) results.append(renderResult(item));
      }
    },
    setForMe(text, note) {
      refined = true;
      forMe.hidden = false;
      forMe.textContent = text || "";
      if (note) writeNote(note);
    },
    setNote(text, { progress, under = false } = {}) {
      writeNote(text, progress, under);
    },
    setModelStatus(status) {
      const state = ["online", "offline", "unknown"].includes(status?.state) ? status.state : "unknown";
      const label = status?.label || "Unknown";
      for (const node of [aiDot, modelState]) {
        node.classList.toggle("is-online", state === "online");
        node.classList.toggle("is-unknown", state === "unknown");
      }
      modelState.textContent = label;
      modelDetail.textContent = status?.detail || "";
      modelStatusText = ` Model: ${label}.${status?.detail ? ` ${status.detail}` : ""}`;
      paintAi();
    },
    setGathering(on, message) {
      gathering = Boolean(on);
      if (message) gatherMessage = message;
      if (gathering && open) setOpen(false, { silent: true });
      paintGather();
    },
    setFullscreen(on) {
      fullscreen = Boolean(on);
      launcher.setAttribute("aria-label", fullscreen ? "Crunchilist is hidden during fullscreen" : "Open Crunchilist");
      place();
      showPanel();
    },
  };
}
