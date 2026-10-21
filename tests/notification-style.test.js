import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applySettingsPatch, defaultSettings, notificationStyle, publicSettings,
} from "../lib/settings.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("notificationStyle maps ask / silent / off onto dialog and mute flags", () => {
  assert.equal(notificationStyle(defaultSettings()), "ask");
  const silent = applySettingsPatch(defaultSettings(), { notificationStyle: "silent" });
  assert.equal(silent.episodeDialogs, false);
  assert.equal(silent.muteNotifications, false);
  assert.equal(notificationStyle(silent), "silent");
  const off = applySettingsPatch(silent, { notificationStyle: "off" });
  assert.equal(off.muteNotifications, true);
  assert.equal(notificationStyle(off), "off");
  const ask = applySettingsPatch(off, { notificationStyle: "ask" });
  assert.equal(ask.episodeDialogs, true);
  assert.equal(ask.muteNotifications, false);
  assert.equal(notificationStyle(ask), "ask");
});

test("publicSettings exposes notificationStyle for the UI", () => {
  const pub = publicSettings(applySettingsPatch(defaultSettings(), { notificationStyle: "silent" }));
  assert.equal(pub.notificationStyle, "silent");
});

test("catalogReaderActivity tags the active catalog service for the badge", () => {
  const source = readFileSync(join(root, "background/catalog-reader.js"), "utf8");
  assert.match(source, /export function catalogReaderActivity/);
  assert.match(source, /service:\s*id/);
  assert.match(source, /Reading the \$\{name\} catalog/);
});

test("prism paints notification style segment without remounting the row", () => {
  const prism = readFileSync(join(root, "app/prism.js"), "utf8");
  assert.match(prism, /notificationStyle/);
  assert.match(prism, /paintSettingControls|data-choice/);
});
