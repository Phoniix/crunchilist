import { isEnabled } from "../lib/enabled.js";
import { KEYS } from "../lib/keys.js";
import { badgeForTasks } from "../lib/activity-badge.js";
import { SERVICES } from "../lib/services.js";
import { syncActivity } from "./anilist-sync.js";
import { catalogActivity } from "./catalog-sync.js";
import { catalogReaderActivity } from "./catalog-reader.js";
import { historyActivity } from "./history-import.js";
import { importActivity } from "./importer.js";
import { currentView } from "./page.js";

const TICK_MS = 1000;
const BADGE_DEBOUNCE_MS = 400;
const IDLE_COLOR = "#5a4f47";
const PREVIEW_COLOR = "#c45c26";

let ticker = 0;
let lastSent = "";
let badgeTimer = 0;
let pendingBadge = null;

export function currentActivity() {
  const tasks = [
    ...catalogActivity(),
    ...catalogReaderActivity(),
    ...importActivity(),
    historyActivity(),
    syncActivity(),
  ].filter(Boolean);
  return tasks.map((task) => {
    const progress = Math.max(0, Math.min(1, Number(task.progress) || 0));
    return { ...task, progress, percent: Math.floor(progress * 100) };
  });
}

async function importPreviewPending() {
  const row = await chrome.storage.local.get(KEYS.importPreview).catch(() => ({}));
  return Boolean(row?.[KEYS.importPreview]);
}

async function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
  try {
    const urls = SERVICES.flatMap((service) => service.origins || []);
    if (!urls.length) return;
    const tabs = await chrome.tabs.query({ url: urls });
    for (const tab of tabs) if (tab.id != null) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  } catch {
    // Tabs can close while the update is sent.
  }
}

async function paintToolbarIdle() {
  if (await importPreviewPending()) {
    await chrome.action.setBadgeBackgroundColor({ color: PREVIEW_COLOR }).catch(() => {});
    await chrome.action.setBadgeText({ text: "!" }).catch(() => {});
    await chrome.action.setTitle({ title: "Import preview waiting — open Kivori SekAI → Import" }).catch(() => {});
    return;
  }
  const enabled = await isEnabled().catch(() => true);
  await chrome.action.setBadgeBackgroundColor({ color: IDLE_COLOR }).catch(() => {});
  await chrome.action.setBadgeText({ text: enabled ? "" : "OFF" }).catch(() => {});
  await chrome.action.setTitle({ title: enabled ? "Kivori SekAI" : "Kivori SekAI (off on Crunchyroll)" }).catch(() => {});
}

async function applyBadge(tasks) {
  const badge = badgeForTasks(tasks);
  if (!badge) {
    await paintToolbarIdle();
    return;
  }
  await chrome.action.setBadgeBackgroundColor({ color: badge.color }).catch(() => {});
  await chrome.action.setBadgeText({ text: badge.text }).catch(() => {});
  await chrome.action.setTitle({ title: badge.title }).catch(() => {});
}

function paintToolbar(tasks) {
  pendingBadge = tasks;
  if (badgeTimer) return;
  badgeTimer = setTimeout(() => {
    badgeTimer = 0;
    const next = pendingBadge;
    pendingBadge = null;
    applyBadge(next).catch(() => {});
  }, BADGE_DEBOUNCE_MS);
}

async function tick() {
  const tasks = currentActivity();
  const signature = JSON.stringify(tasks.map((task) => [task.id, task.percent, task.label, task.service]));
  if (signature !== lastSent) {
    const finished = !tasks.length && lastSent !== "" && lastSent !== "[]";
    lastSent = signature;
    await Promise.all([broadcast({ type: "activity", tasks }), Promise.resolve(paintToolbar(tasks))]);
    if (finished) await broadcast({ type: "enriched", view: await currentView() });
  }
  if (!tasks.length && ticker) {
    clearInterval(ticker);
    ticker = 0;
  }
}

export function watchActivity() {
  if (ticker) return;
  if (!currentActivity().length && lastSent === "[]") return;
  ticker = setInterval(() => tick().catch(() => {}), TICK_MS);
  tick().catch(() => {});
}
