// One-shot upgrades that reset import tips so a buggy prior build's checkpoints don't block a full re-read.
import { KEYS } from "./keys.js";

/** Bump when another fix wave needs Netflix/HIDIVE tips cleared again. */
export const IMPORT_HISTORY_FIX_GEN = 1;
export const IMPORT_HISTORY_FIX_KEY = "ksImportHistoryFix";
export const IMPORT_HISTORY_RESET_NOTE_KEY = "ksImportHistoryResetNote";

/** Services whose sealed tips from pre-fix builds should be dropped on upgrade. */
export const IMPORT_HISTORY_FIX_SERVICES = ["netflix", "hidive"];

const NOTE =
  "Netflix and HIDIVE imports were reset so history can be re-read with the latest fixes — run Import history on each.";

const ofFixService = (key) => IMPORT_HISTORY_FIX_SERVICES.some((id) => String(key).startsWith(`${id}:`));

/**
 * Pure plan: drop netflix:/hidive: checkpoints and a matching draft once per gen.
 * stored: chrome.storage.local snapshot for the keys this cares about.
 * Returns { skipped, set, remove, cleared }.
 */
export function importHistoryFixPlan(stored = {}, { gen = IMPORT_HISTORY_FIX_GEN } = {}) {
  const done = Number(stored[IMPORT_HISTORY_FIX_KEY]) || 0;
  if (done >= gen) return { skipped: true, set: {}, remove: [], cleared: [] };

  const set = { [IMPORT_HISTORY_FIX_KEY]: gen };
  const remove = [];
  const cleared = [];

  const points = stored[KEYS.checkpoints];
  if (points && typeof points === "object") {
    const kept = {};
    for (const [key, value] of Object.entries(points)) {
      if (ofFixService(key)) cleared.push(key);
      else kept[key] = value;
    }
    if (cleared.length) set[KEYS.checkpoints] = kept;
  }

  const draft = stored[KEYS.importDraft];
  if (draft && IMPORT_HISTORY_FIX_SERVICES.includes(draft.service)) remove.push(KEYS.importDraft);

  if (cleared.length || remove.length) set[IMPORT_HISTORY_RESET_NOTE_KEY] = NOTE;

  return { skipped: false, set, remove, cleared };
}

/** Apply the plan to chrome.storage.local (or a test double with get/set/remove). */
export async function applyImportHistoryFix(storage = chrome.storage.local) {
  const stored = await storage.get([IMPORT_HISTORY_FIX_KEY, KEYS.checkpoints, KEYS.importDraft]);
  const plan = importHistoryFixPlan(stored);
  if (plan.skipped) return plan;
  if (Object.keys(plan.set).length) await storage.set(plan.set);
  if (plan.remove.length) await storage.remove(plan.remove);
  return plan;
}
