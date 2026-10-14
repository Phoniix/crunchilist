import { VIEWER_QUERY, anilist } from "../lib/anilist-api.js";
import { authUrl, parseTokenRedirect, publicSession } from "../lib/anilist-auth.js";
import { KEYS } from "../lib/keys.js";
import { SERVICES, connectedIds, contentScriptFor } from "../lib/services.js";
import { CHECK_EVERY_MS, getShow, idMapStatus, refreshIdMap } from "./id-map-store.js";

const APP = "app/app.html";
const FEEDS_ALARM = "cs-feeds";

async function openApp(hash = "") {
  const url = chrome.runtime.getURL(APP);
  const [existing] = await chrome.tabs.query({ url: `${url}*` }).catch(() => []);
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true, ...(hash ? { url: url + hash } : {}) });
    if (existing.windowId != null) await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
    return;
  }
  await chrome.tabs.create({ url: url + hash });
}

async function grantedOrigins() {
  return (await chrome.permissions.getAll()).origins || [];
}

// Content scripts follow the permissions: registered for connected services, removed for the rest.
// Runs on install, on startup and whenever the user grants or removes a site.
async function syncContentScripts() {
  const connected = new Set(connectedIds(await grantedOrigins()));
  const registered = new Set((await chrome.scripting.getRegisteredContentScripts()).map((script) => script.id));
  for (const service of SERVICES) {
    const script = contentScriptFor(service);
    if (connected.has(service.id) && !registered.has(script.id)) await chrome.scripting.registerContentScripts([script]).catch(() => {});
    if (!connected.has(service.id) && registered.has(script.id)) await chrome.scripting.unregisterContentScripts({ ids: [script.id] }).catch(() => {});
  }
}

async function loadSession() {
  return (await chrome.storage.local.get(KEYS.session))[KEYS.session] || null;
}

async function status() {
  return {
    version: chrome.runtime.getManifest().version,
    connected: connectedIds(await grantedOrigins()),
    anilist: publicSession(await loadSession()),
    idMap: await idMapStatus(),
  };
}

// Opens AniList's own sign-in window; the token comes back in the redirect and stays in the background.
async function connectAnilist() {
  let redirect;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({ url: authUrl(), interactive: true });
  } catch (error) {
    throw new Error(/did not approve|cancel|closed/i.test(String(error?.message)) ? "AniList sign-in was cancelled." : "AniList sign-in didn't finish. Try again.");
  }
  const result = parseTokenRedirect(redirect || "");
  if (result.error) throw new Error(result.error);
  const data = await anilist(VIEWER_QUERY, {}, { token: result.token });
  const viewer = { id: data?.Viewer?.id || null, name: data?.Viewer?.name || "", avatar: data?.Viewer?.avatar?.medium || "" };
  await chrome.storage.local.set({ [KEYS.session]: { token: result.token, expiresAt: result.expiresAt, viewer, connectedAt: Date.now() } });
  return status();
}

async function disconnectAnilist() {
  await chrome.storage.local.remove(KEYS.session);
  return status();
}

const handlers = {
  status,
  connectAnilist,
  disconnectAnilist,
  syncServices: async () => { await syncContentScripts(); return status(); },
  refreshFeeds: async () => { await refreshIdMap({ force: true }); return status(); },
  show: async ({ anilistId }) => ({ show: await getShow(anilistId) }),
};

// Content scripts on streaming sites get their own small set of messages, never account actions.
const fromContent = {};
const fromExtensionPage = (sender) => sender?.id === chrome.runtime.id && String(sender.url || "").startsWith(chrome.runtime.getURL(""));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = fromExtensionPage(sender) ? handlers[message?.type] : fromContent[message?.type];
  if (!handler) return false;
  handler(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || "Something went wrong" }));
  return true;
});

chrome.action.onClicked.addListener(() => { openApp().catch(() => {}); });
function scheduleFeeds() {
  chrome.alarms.create(FEEDS_ALARM, { delayInMinutes: 1, periodInMinutes: CHECK_EVERY_MS / 60000 });
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  syncContentScripts().catch(() => {});
  scheduleFeeds();
  refreshIdMap({ force: true }).catch(() => {});
  if (reason === "install") openApp("#welcome").catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  syncContentScripts().catch(() => {});
  refreshIdMap().catch(() => {});
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FEEDS_ALARM) refreshIdMap().catch(() => {});
});
chrome.permissions.onAdded.addListener(() => { syncContentScripts().catch(() => {}); });
chrome.permissions.onRemoved.addListener(() => { syncContentScripts().catch(() => {}); });
