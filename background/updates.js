import { isStoreChannel } from "../lib/build-channel.js";
import { LATEST_RELEASE_API, dueForCheck, fromRelease, updateStatus } from "../lib/update-check.js";
import { pushSystemNotice } from "./app-notices.js";

const UPDATE_KEY = "crUpdate";

// Store installs get an update_url and update themselves, so only copies loaded by hand check GitHub.
export const selfUpdating = () => Boolean(chrome.runtime.getManifest().update_url);
// Packaged store zips also must not phone home to GitHub (CWS policy).
export const storePackaged = () => isStoreChannel();

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/vnd.github+json" }, cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return response.json();
}

async function newest() {
  const release = fromRelease(await getJson(LATEST_RELEASE_API));
  if (release) return release;
  throw new Error("No GitHub release zip yet. Check again after the next release.");
}

let running = null;

export async function checkForUpdate({ force = false } = {}) {
  const current = chrome.runtime.getManifest().version;
  if (selfUpdating() || storePackaged()) return { ...updateStatus(null, current), managed: true };
  const stored = (await chrome.storage.local.get(UPDATE_KEY))[UPDATE_KEY] || {};
  if (!dueForCheck(stored.checkedAt, Date.now(), force)) return updateStatus(stored, current);
  running ||= (async () => {
    const next = { ...stored, checkedAt: Date.now() };
    try {
      next.latest = await newest();
      next.error = "";
    } catch (error) {
      next.error = error?.message || "Couldn't reach GitHub";
    }
    await chrome.storage.local.set({ [UPDATE_KEY]: next });
    return next;
  })().finally(() => { running = null; });
  const status = updateStatus(await running, current);
  if (status.announce && status.latest?.version) {
    pushSystemNotice({
      kind: "update",
      title: `Kivori SekAI ${status.latest.version} is out`,
      message: "Open Settings → About to update. Your list and settings stay.",
      href: "#settings/about",
    }, {
      kind: "update",
      title: `Update available: ${status.latest.version}`,
      ok: true,
    }).catch(() => {});
  }
  return status;
}

// The app announces each new version once; after that it only shows in Settings.
export async function markUpdateAnnounced(version) {
  const stored = (await chrome.storage.local.get(UPDATE_KEY))[UPDATE_KEY] || {};
  await chrome.storage.local.set({ [UPDATE_KEY]: { ...stored, announced: String(version || "") } });
  return {};
}
