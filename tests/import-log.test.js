import assert from "node:assert/strict";
import test from "node:test";
import { LOG_ALL, LOG_PER_SOURCE, keepLogs } from "../lib/import-log.js";

test("past imports are kept per source, so a busy site never pushes another's out", () => {
  const netflix = Array.from({ length: 30 }, (_, index) => ({ id: `n${index}`, service: "netflix" }));
  const all = Array.from({ length: 30 }, (_, index) => ({ id: `a${index}`, service: "all" }));
  const kept = keepLogs([...netflix, { id: "mal", service: "mal" }, ...all, null]);
  assert.equal(kept.filter((item) => item.service === "netflix").length, LOG_PER_SOURCE);
  assert.equal(kept.filter((item) => item.service === "all").length, LOG_ALL);
  assert.ok(kept.some((item) => item.id === "mal"));
  assert.equal(kept[0].id, "n0");
  assert.deepEqual(keepLogs("nope"), []);
});
