import { CREDITS } from "../lib/id-map.js";
import { SERVICES, serviceById } from "../lib/services.js";

const main = document.getElementById("main");
const toastBox = document.querySelector(".toast");
let state = { version: "", connected: [], anilist: { connected: false }, idMap: {} };
let connecting = false;
let checkingFeeds = false;
let toastTimer = 0;

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function toast(text) {
  toastBox.textContent = text;
  toastBox.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastBox.hidden = true; }, 4000);
}

async function send(type, extra = {}) {
  try {
    return await chrome.runtime.sendMessage({ type, ...extra });
  } catch (error) {
    return { ok: false, error: error?.message || "The extension didn't answer" };
  }
}

function anilistRow() {
  const { connected, expired, name, avatar, renewSoon } = state.anilist || {};
  const note = connected
    ? `Signed in as ${name || "your AniList account"}.${renewSoon ? " AniList asks you to sign in again soon." : ""} Your list stays in sync from here.`
    : expired ? "Your AniList sign-in expired. Connect again to keep your list in sync." : "Sign in with AniList so imports and what you watch update your list.";
  return `<div class="card row">
    ${connected && avatar ? `<img class="avatar" src="${esc(avatar)}" alt="" referrerpolicy="no-referrer">` : ""}
    <div class="grow"><b>AniList</b><small>${esc(note)}</small></div>
    <span class="pill${connected ? " on" : ""}">${connected ? "Connected" : expired ? "Expired" : "Not connected"}</span>
    <button class="btn${connected ? "" : " accent"}" data-act="${connected ? "anilist-disconnect" : "anilist-connect"}" ${connecting ? "disabled" : ""}>${connected ? "Disconnect" : connecting ? "Opening AniList…" : "Connect"}</button>
  </div>`;
}

function serviceRows() {
  return SERVICES.map((service) => {
    const on = state.connected.includes(service.id);
    return `<div class="card row">
      <div class="grow"><b>${esc(service.name)}</b><small>${esc(service.why)}</small></div>
      <span class="pill${on ? " on" : ""}">${on ? "Connected" : "Not connected"}</span>
      <button class="btn${on ? "" : " accent"}" data-service="${esc(service.id)}" data-act="${on ? "disconnect" : "connect"}">${on ? "Disconnect" : "Connect"}</button>
    </div>`;
  }).join("");
}

function dataRow() {
  const { count = 0, updated = "", error = "" } = state.idMap || {};
  const note = count
    ? `${count.toLocaleString()} anime, updated ${updated}.${error ? ` Last check: ${error}` : ""}`
    : error ? `Not downloaded yet: ${error}` : "Downloading the list of anime used for search and matching…";
  return `<div class="card row">
    <div class="grow"><b>Master list</b><small>${esc(note)}</small></div>
    <button class="btn" data-act="refresh-feeds" ${checkingFeeds ? "disabled" : ""}>${checkingFeeds ? "Checking…" : "Check now"}</button>
  </div>`;
}

const credits = () => CREDITS.map((credit) => `<a href="${esc(credit.url)}" target="_blank" rel="noopener">${esc(credit.name)}</a> by ${esc(credit.by)} (${esc(credit.license)})`).join("; ");

const pages = {
  welcome: () => `<h1>Welcome to Crunchilist Search</h1>
    <p class="sub">Find anime across your streaming services and keep your AniList in sync with what you watch. Connect the services you use; you can change this any time in Settings.</p>
    <div class="stack">${anilistRow()}${serviceRows()}</div>
    <p class="foot">Chrome asks before each site. Crunchilist Search only reads what you've watched, using your own sign-in, and keeps it in this browser.</p>`,
  search: () => `<h1>Search</h1><p class="sub">Search across every service is on the way.</p>`,
  import: () => `<h1>Import history</h1><p class="sub">Bring in your watch history from each connected service. Imports pick up where the last one stopped.</p>
    ${state.connected.length ? "" : `<div class="card"><p class="muted">Connect a service in <a href="#settings">Settings</a> first.</p></div>`}`,
  settings: () => `<h1>Settings</h1><p class="sub">Your accounts</p>
    <div class="stack">${anilistRow()}${serviceRows()}</div>
    <p class="sub section">Data</p>
    <div class="stack">${dataRow()}</div>
    <p class="foot">Crunchilist Search ${esc(state.version)}. Anime data: ${credits()}.</p>`,
};

function route() {
  const page = location.hash.replace(/^#/, "").split("/")[0] || "search";
  const render = pages[page] || pages.search;
  main.innerHTML = render();
  for (const link of document.querySelectorAll(".nav a")) link.classList.toggle("on", link.dataset.page === page);
}

async function refresh() {
  const reply = await send("status");
  if (reply?.ok) state = { ...state, version: reply.version, connected: reply.connected, anilist: reply.anilist, idMap: reply.idMap };
  route();
}

async function anilistAction(act) {
  if (act === "anilist-connect") {
    connecting = true;
    route();
    const reply = await send("connectAnilist");
    connecting = false;
    toast(reply?.ok ? `Connected to AniList as ${reply.anilist?.name || "you"}` : reply?.error || "AniList sign-in didn't finish");
  } else {
    await send("disconnectAnilist");
    toast("Disconnected from AniList");
  }
  await refresh();
}

// Chrome only shows its permission prompt from inside the click, so the request happens here, not in the background.
main.addEventListener("click", async (event) => {
  const account = event.target.closest('[data-act^="anilist-"]');
  if (account) return anilistAction(account.dataset.act);
  if (event.target.closest('[data-act="refresh-feeds"]')) {
    checkingFeeds = true;
    route();
    const reply = await send("refreshFeeds");
    checkingFeeds = false;
    toast(reply?.idMap?.error ? reply.idMap.error : "Master list is up to date");
    return refresh();
  }
  const button = event.target.closest("[data-service]");
  if (!button) return;
  const service = serviceById(button.dataset.service);
  if (!service) return;
  if (button.dataset.act === "connect") {
    const granted = await chrome.permissions.request({ origins: service.origins }).catch(() => false);
    if (!granted) return toast(`${service.name} wasn't connected`);
    toast(`${service.name} connected`);
  } else {
    await chrome.permissions.remove({ origins: service.origins }).catch(() => false);
    toast(`${service.name} disconnected`);
  }
  await send("syncServices");
  await refresh();
});

addEventListener("hashchange", route);
refresh();
