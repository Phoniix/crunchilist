import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "app/import-pane.js"), "utf8");

test("Needs your pick section has clear instructions and actions", () => {
  assert.match(source, /Needs your pick/);
  assert.match(source, /id="needs-pick"/);
  assert.match(source, /imp-howto/);
  assert.match(source, /data-act="pending-pick"/);
  assert.match(source, /data-act="pending-manual"/);
  assert.match(source, /data-act="pending-skip"/);
  assert.match(source, /Confirm link/);
  assert.match(source, /Skip for now/);
  assert.match(source, /Use this show/);
});

test("import preview expose apply and dismiss", () => {
  assert.match(source, /data-act="import-apply"/);
  assert.match(source, /data-act="import-dismiss"/);
  assert.match(source, /data-act="import-undo"/);
});

test("prism routes pending and import acts through import-pane", () => {
  const prism = readFileSync(join(root, "app/prism.js"), "utf8");
  assert.match(prism, /handleImportAct/);
  assert.match(prism, /renderImportPane/);
  assert.match(prism, /pending-/);
});

test("Import pane stays browsable without AniList and gates apply actions", () => {
  assert.match(source, /needsAnilist/);
  assert.match(source, /Connect AniList under Account to import or apply changes/);
  assert.doesNotMatch(source, /Connect AniList under Account first\. That pulls/);
});
