import { ENABLED_KEY, PANEL_ENABLED_KEY, isPanelEnabled, setPanelEnabled } from "../lib/enabled.js";
import { ROUNDED, el, icon, roundedFontFace } from "../ui/dom.js";
import { THEME_CSS } from "../ui/theme.js";

const POPUP_CSS = `
  .pp { display: flex; flex-direction: column; gap: 12px; padding: 14px; }
  .pp-brand { display: flex; align-items: center; gap: 10px; color: var(--text); font: 800 15px/1 ${ROUNDED}; }
  .pp-brand img { width: 24px; height: 24px; }
  .pp-open { width: 100%; min-height: 38px; justify-content: flex-start; gap: 10px; padding: 8px 12px; font-size: 13.5px; }
  .pp-open span { flex: 1; text-align: left; }
  .pp-section { display: flex; flex-direction: column; gap: 8px; }
  .pp-section-title { margin: 0; color: var(--muted); font: 800 11px/1.2 ${ROUNDED}; letter-spacing: .06em; text-transform: uppercase; }
  .pp-sites { display: flex; flex-direction: column; gap: 8px; }
  .pp-row { padding: 12px; border-radius: 14px; background: var(--pane); border: 1px solid var(--line); }
  .pp-row.is-off .switch-label { color: var(--muted); }
  .pp-row .switch-label { display: inline-flex; align-items: center; gap: 8px; }
  .pp-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .pp-empty { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.4; }
  .pp-update { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 14px; background: var(--pane); border: 1px solid var(--line); color: var(--text); font-size: 13px; text-decoration: none; }
  .pp-update b { color: var(--accent); }
`;

const style = document.createElement("style");
style.textContent = roundedFontFace() + THEME_CSS + POPUP_CSS;
document.head.append(style);

const open = el("button", { class: "btn primary pp-open", type: "button" }, [icon("home", 17), el("span", { text: "Open Kivori SekAI" }), icon("external", 15)]);
const sitesRoot = el("div", { class: "pp-sites" });
const section = el("div", { class: "pp-section" }, [
  el("p", { class: "pp-section-title", text: "Site panels" }),
  sitesRoot,
]);
const root = el("div", { class: "pp" }, [
  el("div", { class: "pp-brand" }, [el("img", { src: "../icons/icon48.png", alt: "" }), el("span", { text: "Kivori SekAI" })]),
  open,
  section,
]);

open.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "openApp" }).catch(() => chrome.tabs.create({ url: chrome.runtime.getURL("app/app.html") }));
  window.close();
});

function siteRow(site, enabled) {
  const toggle = el("input", { type: "checkbox", role: "switch", "aria-label": `${site.name} panel on or off` });
  toggle.checked = enabled;
  const hint = el("span", { class: "switch-hint", text: enabled
    ? "Find button and corner panel are on."
    : "Off on this site. The full page app still works." });
  const label = el("span", { class: "switch-label" }, [
    el("i", { class: "pp-dot", style: `background:${site.color || "var(--accent)"}` }),
    document.createTextNode(site.name),
  ]);
  const row = el("label", { class: `switch pp-row${enabled ? "" : " is-off"}` }, [
    toggle,
    el("span", { class: "switch-copy" }, [label, hint]),
  ]);
  toggle.addEventListener("change", async () => {
    const on = toggle.checked;
    row.classList.toggle("is-off", !on);
    hint.textContent = on
      ? "Find button and corner panel are on."
      : "Off on this site. The full page app still works.";
    try {
      await setPanelEnabled(site.id, on);
    } catch {
      toggle.checked = !on;
      row.classList.toggle("is-off", !toggle.checked);
    }
  });
  return row;
}

async function paintSites() {
  sitesRoot.replaceChildren(el("p", { class: "pp-empty", text: "Loading connected sites…" }));
  const [reply, stored] = await Promise.all([
    chrome.runtime.sendMessage({ type: "siteConnections" }).catch(() => null),
    chrome.storage.local.get([ENABLED_KEY, PANEL_ENABLED_KEY]),
  ]);
  const list = Array.isArray(reply?.sites) ? reply.sites : [];
  const connected = list.filter((site) => site.connected && !site.untested);
  if (!connected.length) {
    sitesRoot.replaceChildren(
      el("p", { class: "pp-empty", text: "Connect sites in Settings → Where to watch to control their panels here." }),
      siteRow({ id: "crunchyroll", name: "Crunchyroll", color: "#F47521" }, isPanelEnabled("crunchyroll", stored)),
    );
    return;
  }
  sitesRoot.replaceChildren(...connected.map((site) => siteRow(site, isPanelEnabled(site.id, stored))));
}

document.body.append(root);
paintSites().catch(() => {
  sitesRoot.replaceChildren(siteRow({ id: "crunchyroll", name: "Crunchyroll", color: "#F47521" }, true));
});

chrome.runtime.sendMessage({ type: "updateStatus" }).then((reply) => {
  const latest = reply?.ok && reply.update?.available ? reply.update.latest : null;
  if (!latest) return;
  root.append(el("a", { class: "pp-update", href: chrome.runtime.getURL("app/app.html#settings"), target: "_blank" }, [
    el("b", { text: `Version ${latest.version} is out` }),
    el("span", { text: "Update in Settings" }),
  ]));
}).catch(() => {});
