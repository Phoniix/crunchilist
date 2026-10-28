import assert from "node:assert/strict";
import test from "node:test";
import { anyPreview, asPreviewMap, blockingPreview, packPreviewMap } from "../lib/import-previews.js";

test("legacy single preview becomes a one-entry map", () => {
  assert.deepEqual(asPreviewMap({ service: "crunchyroll", id: "a" }), { crunchyroll: { service: "crunchyroll", id: "a" } });
});

test("version-2 map round-trips", () => {
  const packed = packPreviewMap({ netflix: { service: "netflix", id: "n" }, crunchyroll: { service: "crunchyroll", id: "c" } });
  assert.equal(packed.version, 2);
  assert.deepEqual(asPreviewMap(packed), { netflix: { service: "netflix", id: "n" }, crunchyroll: { service: "crunchyroll", id: "c" } });
});

test("blockingPreview only locks the same service or Import all", () => {
  const services = {
    crunchyroll: { service: "crunchyroll", id: "c" },
    netflix: { service: "netflix", id: "n" },
  };
  assert.equal(blockingPreview(services, "prime"), null);
  assert.equal(blockingPreview(services, "netflix")?.id, "n");
  assert.equal(blockingPreview({ all: { service: "all", id: "a" } }, "netflix")?.id, "a");
  assert.ok(anyPreview(services));
  assert.equal(anyPreview({}), false);
});
