import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CHARACTER_ID } from "../lib/characters.js";
import {
  activeCharacterId,
  characterPortraitPath,
  guideLine,
} from "../lib/guide.js";
import { NOTICE_SECTIONS, noticeSection } from "../lib/notices.js";

test("activeCharacterId falls back to Kivi, then honors fave", () => {
  assert.equal(activeCharacterId(), DEFAULT_CHARACTER_ID);
  assert.equal(activeCharacterId(null, ""), DEFAULT_CHARACTER_ID);
  assert.equal(activeCharacterId({ id: "spike" }), "spike");
  assert.equal(activeCharacterId(null, "levi"), "levi");
  assert.equal(activeCharacterId({ id: "nope" }, "gojo"), "gojo");
});

test("guideLine uses active pack and portrait path", () => {
  const line = guideLine({ kind: "look_here", seed: "t", hint: "Added to Continue watching", favorite: { id: "kivi" } });
  assert.equal(line.characterId, "kivi");
  assert.equal(line.name, "Kivi");
  assert.match(line.text, /Continue watching/);
  assert.equal(characterPortraitPath("kivi"), "icons/kivi.png");
  assert.equal(characterPortraitPath("spike"), "icons/kivi.png");
});

test("noticeSection maps kinds into drawer sections", () => {
  assert.equal(noticeSection("import_preview"), "import");
  assert.equal(noticeSection("sync_preview"), "import");
  assert.equal(noticeSection("ask"), "episodes");
  assert.equal(noticeSection("done"), "episodes");
  assert.equal(noticeSection("update"), "app");
  assert.equal(noticeSection({ id: "season:x:1" }), "seasons");
  assert.deepEqual(NOTICE_SECTIONS.map((s) => s.id), ["import", "episodes", "seasons", "app"]);
});
