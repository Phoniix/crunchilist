import assert from "node:assert/strict";
import test from "node:test";
import {
  appendActivity,
  formatActivityExport,
  normalizeActivityLog,
} from "../lib/activity-log.js";

test("activity rows are cleaned, newest first, and capped", () => {
  let list = [];
  for (let i = 0; i < 5; i += 1) {
    list = appendActivity(list, { id: `run-${i}`, kind: "sync", title: `Run ${i}`, at: i + 1 }, { limit: 3 });
  }
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((row) => row.title), ["Run 4", "Run 3", "Run 2"]);
  assert.equal(appendActivity([], { kind: "nope", title: "x" }).length, 0);
  assert.equal(appendActivity([], { kind: "import", title: "" }).length, 0);
});

test("export is plain text without inventing secrets", () => {
  const list = normalizeActivityLog([
    { kind: "sync", title: "Daily sync", detail: "2 changes", at: Date.parse("2026-10-01T12:00:00Z"), ok: true },
    { kind: "error", title: "Failed", at: Date.parse("2026-10-01T13:00:00Z"), ok: false },
  ]);
  const text = formatActivityExport(list);
  assert.match(text, /Activity log/);
  assert.match(text, /Daily sync/);
  assert.match(text, /FAIL/);
  assert.equal(text.includes("token"), false);
  assert.equal(formatActivityExport([]), "Activity log: (empty)");
});
