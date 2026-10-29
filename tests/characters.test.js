import assert from "node:assert/strict";
import test from "node:test";
import {
  CHARACTERS, DEFAULT_CHARACTER_ID, LINE_KINDS, characterById, cleanFavorite, composeLine, composeLineAi, publicFavorite, linePreview,
} from "../lib/characters.js";

test("roster has 5–10 text lines per character and known kinds", () => {
  assert.ok(CHARACTERS.length >= 6);
  for (const pack of CHARACTERS) {
    assert.ok(pack.lines.length >= 5 && pack.lines.length <= 12, pack.id);
    assert.ok(pack.name && pack.show && pack.tone);
  }
  assert.deepEqual(LINE_KINDS, ["welcome", "look_here", "tip"]);
});

test("first fave is original brand guide Kivi", () => {
  assert.equal(DEFAULT_CHARACTER_ID, "kivi");
  assert.equal(CHARACTERS[0].id, DEFAULT_CHARACTER_ID);
  assert.equal(CHARACTERS[0].original, true);
  assert.equal(CHARACTERS[0].show, "Kivori SekAI");
  assert.equal(characterById("kivi").name, "Kivi");
  assert.ok(!CHARACTERS[0].anilistCharId);
});

test("favorite cleans to a known id", () => {
  assert.equal(cleanFavorite("nope"), null);
  assert.equal(cleanFavorite({ id: "gojo" }).id, "gojo");
  assert.equal(cleanFavorite({ id: "kivi" }).id, "kivi");
  assert.deepEqual(publicFavorite({ id: "rem" }), { id: "rem", name: "Rem", show: "Re:Zero" });
  assert.deepEqual(publicFavorite({ id: "kivi" }), { id: "kivi", name: "Kivi", show: "Kivori SekAI" });
  assert.deepEqual(publicFavorite(null), { id: "", name: "", show: "" });
});

test("composeLine is local text, stable for a seed, and fills look_here / tip", () => {
  const a = composeLine({ characterId: "spike", kind: "welcome", seed: "x" });
  const b = composeLine({ characterId: "spike", kind: "welcome", seed: "x" });
  assert.equal(a.source, "local");
  assert.equal(a.text, b.text);
  assert.ok(a.text.length > 8);
  const look = composeLine({ characterId: "levi", kind: "look_here", seed: "1", hint: "HIDIVE catalog ready" });
  assert.match(look.text, /HIDIVE catalog ready/);
  const tip = composeLine({ characterId: "violet", kind: "tip", seed: "2", tip: "Read now while signed in." });
  assert.match(tip.text, /Read now/);
  assert.equal(composeLine({ characterId: "nope", kind: "welcome" }).text, "");
});

test("AI text composer is a stub until a provider is wired", async () => {
  assert.equal(await composeLineAi({ characterId: "gojo", kind: "welcome" }), null);
  const preview = linePreview("luffy");
  assert.ok(preview.welcome.text);
  assert.ok(preview.look_here.text.includes("·"));
  assert.equal(characterById("asuka").show.includes("Evangelion"), true);
});
