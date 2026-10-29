// Push system notices into Prism state and rows into the activity log.
import { appendActivity, formatActivityExport, normalizeActivityLog } from "../lib/activity-log.js";
import { KEYS } from "../lib/keys.js";
import { addNotice, SYSTEM_KINDS } from "../lib/notices.js";
import { currentView } from "./page.js";
import { loadState, saveState } from "./store.js";

async function loadActivity() {
  try {
    return normalizeActivityLog((await chrome.storage.local.get(KEYS.activityLog))[KEYS.activityLog]);
  } catch {
    return [];
  }
}

async function saveActivity(rows) {
  await chrome.storage.local.set({ [KEYS.activityLog]: normalizeActivityLog(rows) }).catch(() => {});
}

export async function noteActivity(row) {
  const next = appendActivity(await loadActivity(), row);
  await saveActivity(next);
  return next;
}

export async function clearActivityLog() {
  await chrome.storage.local.remove(KEYS.activityLog).catch(() => {});
  return [];
}

export async function exportActivityText() {
  return formatActivityExport(await loadActivity());
}

export async function listActivity({ kind = "" } = {}) {
  const rows = await loadActivity();
  if (!kind || kind === "all") return rows;
  return rows.filter((row) => row.kind === kind);
}

/** Add or replace a system notice and optionally log activity. Broadcasts enriched view. */
export async function pushSystemNotice(notice, activity = null) {
  if (!SYSTEM_KINDS.has(notice?.kind)) return null;
  const state = await loadState();
  state.notices = addNotice(state.notices, notice, Date.now());
  await saveState(state);
  if (activity) await noteActivity(activity).catch(() => {});
  const view = await currentView(state);
  chrome.runtime.sendMessage({ type: "enriched", view }).catch(() => {});
  return view;
}

export async function dismissSystemNotice(kindOrId) {
  const state = await loadState();
  const before = state.notices.length;
  state.notices = (state.notices || []).filter((row) => row.id !== kindOrId && row.kind !== kindOrId);
  if (state.notices.length === before) return null;
  await saveState(state);
  return currentView(state);
}
