import assert from "node:assert/strict";
import test from "node:test";
import { ENABLED_KEY, PANEL_ENABLED_KEY, isPanelEnabled } from "../lib/enabled.js";

test("Crunchyroll panel follows crEnabled and defaults on", () => {
  assert.equal(isPanelEnabled("crunchyroll", {}), true);
  assert.equal(isPanelEnabled("crunchyroll", { [ENABLED_KEY]: true }), true);
  assert.equal(isPanelEnabled("crunchyroll", { [ENABLED_KEY]: false }), false);
});

test("other site panels default on and honor ksPanelEnabled", () => {
  assert.equal(isPanelEnabled("netflix", {}), true);
  assert.equal(isPanelEnabled("hidive", { [PANEL_ENABLED_KEY]: {} }), true);
  assert.equal(isPanelEnabled("netflix", { [PANEL_ENABLED_KEY]: { netflix: false } }), false);
  assert.equal(isPanelEnabled("tubi", { [PANEL_ENABLED_KEY]: { netflix: false } }), true);
  assert.equal(isPanelEnabled("NETFLIX", { [PANEL_ENABLED_KEY]: { netflix: false } }), false);
});
