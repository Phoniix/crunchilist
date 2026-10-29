import { KEYS } from "../lib/keys.js";
import { addUnrecommended, removeUnrecommended, sanitizeUnrecommended } from "../lib/unrecommended.js";

export async function loadUnrecommended() {
  try {
    const saved = (await chrome.storage.local.get(KEYS.unrecommended))[KEYS.unrecommended];
    return sanitizeUnrecommended(saved);
  } catch {
    return [];
  }
}

async function saveUnrecommended(list) {
  const clean = sanitizeUnrecommended(list);
  await chrome.storage.local.set({ [KEYS.unrecommended]: clean });
  return clean;
}

export async function muteTitle(show) {
  const next = addUnrecommended(await loadUnrecommended(), show);
  return saveUnrecommended(next);
}

export async function unmuteTitle(id) {
  const next = removeUnrecommended(await loadUnrecommended(), id);
  return saveUnrecommended(next);
}

export async function setUnrecommended(list) {
  return saveUnrecommended(list);
}
