import assert from "node:assert/strict";
import test from "node:test";
import {
  IMPORT_HISTORY_FIX_GEN,
  IMPORT_HISTORY_FIX_KEY,
  IMPORT_HISTORY_RESET_NOTE_KEY,
  applyImportHistoryFix,
  importHistoryFixPlan,
} from "../lib/import-migrate.js";
import { KEYS } from "../lib/keys.js";

const STORED = {
  [IMPORT_HISTORY_FIX_KEY]: 0,
  [KEYS.checkpoints]: {
    "netflix:Me": { newestAt: 5, end: true },
    "hidive:You": { newestAt: 8, end: true },
    "crunchyroll:abc": { newestAt: 6, end: true },
  },
  [KEYS.importDraft]: { service: "hidive", rows: [1] },
};

test("import history fix drops Netflix and HIDIVE tips, keeps Crunchyroll", () => {
  const plan = importHistoryFixPlan(STORED);
  assert.equal(plan.skipped, false);
  assert.deepEqual(Object.keys(plan.set[KEYS.checkpoints]).sort(), ["crunchyroll:abc"]);
  assert.deepEqual(plan.cleared.sort(), ["hidive:You", "netflix:Me"]);
  assert.deepEqual(plan.remove, [KEYS.importDraft]);
  assert.equal(plan.set[IMPORT_HISTORY_FIX_KEY], IMPORT_HISTORY_FIX_GEN);
  assert.match(plan.set[IMPORT_HISTORY_RESET_NOTE_KEY], /Netflix and HIDIVE/);
});

test("already-applied gen skips and changes nothing", () => {
  const plan = importHistoryFixPlan({ ...STORED, [IMPORT_HISTORY_FIX_KEY]: IMPORT_HISTORY_FIX_GEN });
  assert.deepEqual(plan, { skipped: true, set: {}, remove: [], cleared: [] });
});

test("no Netflix/HIDIVE data still marks gen done without a user note", () => {
  const plan = importHistoryFixPlan({
    [KEYS.checkpoints]: { "crunchyroll:abc": { newestAt: 1 } },
    [KEYS.importDraft]: { service: "crunchyroll", rows: [] },
  });
  assert.equal(plan.skipped, false);
  assert.equal(plan.set[IMPORT_HISTORY_FIX_KEY], IMPORT_HISTORY_FIX_GEN);
  assert.equal(plan.set[IMPORT_HISTORY_RESET_NOTE_KEY], undefined);
  assert.equal(plan.set[KEYS.checkpoints], undefined);
  assert.deepEqual(plan.remove, []);
});

test("applyImportHistoryFix writes once then no-ops", async () => {
  const bag = {
    [KEYS.checkpoints]: { "netflix:A": { newestAt: 1 }, "crunchyroll:B": { newestAt: 2 } },
  };
  const storage = {
    get: async (keys) => Object.fromEntries(keys.map((key) => [key, bag[key]]).filter(([, v]) => v !== undefined)),
    set: async (patch) => { Object.assign(bag, patch); },
    remove: async (keys) => { for (const key of keys) delete bag[key]; },
  };
  const first = await applyImportHistoryFix(storage);
  assert.equal(first.skipped, false);
  assert.deepEqual(Object.keys(bag[KEYS.checkpoints]), ["crunchyroll:B"]);
  assert.equal(bag[IMPORT_HISTORY_FIX_KEY], IMPORT_HISTORY_FIX_GEN);
  assert.ok(bag[IMPORT_HISTORY_RESET_NOTE_KEY]);

  const second = await applyImportHistoryFix(storage);
  assert.equal(second.skipped, true);
  assert.deepEqual(Object.keys(bag[KEYS.checkpoints]), ["crunchyroll:B"]);
});
