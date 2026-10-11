import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTitle, pickMatch, tagsFromConfidentMatch, titlesOf } from "../lib/title-match.js";

function media(names, id, extra = {}) {
  const [english, romaji, native, ...synonyms] = names;
  return {
    id,
    title: { english: english || null, romaji: romaji || null, native: native || null },
    synonyms,
    tags: extra.tags || [],
    ...extra,
  };
}

test("normalizes case, punctuation, and season suffixes", () => {
  assert.equal(normalizeTitle("Dr. Stone!"), normalizeTitle("dr stone"));
  assert.equal(normalizeTitle("Attack on Titan Season 2"), "attack on titan");
  assert.equal(normalizeTitle("Attack on Titan 2nd Season"), "attack on titan");
  assert.equal(normalizeTitle("Demo Cour 1"), "demo");
});

test("matches english, romaji, native, and synonyms", () => {
  const show = media(["Demon Slayer", "Kimetsu no Yaiba", "鬼滅の刃", "KnY"], 10);
  assert.equal(pickMatch("Demon Slayer", [show]).media.id, 10);
  assert.equal(pickMatch("Kimetsu no Yaiba", [show]).media.id, 10);
  assert.equal(pickMatch("鬼滅の刃", [show]).media.id, 10);
  assert.equal(pickMatch("KnY", [show]).confidence, "high");
  assert.ok(titlesOf(show).includes("鬼滅の刃"));
});

test("punctuation-only differences are confident and partial titles are not", () => {
  const stone = media(["Dr. Stone"], 3);
  assert.equal(pickMatch("Dr Stone", [stone]).confidence, "high");
  const shippuden = media(["Naruto Shippuden"], 8);
  const naruto = media(["Naruto"], 7);
  assert.equal(pickMatch("Naruto", [naruto, shippuden]).media.id, 7);
  assert.equal(pickMatch("Boruto", [naruto]).confidence, "none");
});

test("several equal hits stay unmatched unless a season number breaks the tie", () => {
  const first = media(["Attack on Titan"], 1);
  const second = media(["Attack on Titan Season 2"], 2);
  const tied = pickMatch("Same Show", [media(["Same Show"], 4), media(["Same Show"], 5)]);
  assert.equal(tied.confidence, "none");
  assert.equal(tied.reason, "ambiguous");
  assert.equal(tagsFromConfidentMatch(tied).length, 0);

  const season2 = pickMatch("Attack on Titan Season 2", [first, second]);
  assert.equal(season2.confidence, "high");
  assert.equal(season2.media.id, 2);
  assert.equal(pickMatch("Attack on Titan", [first, second]).media.id, 1);
});

test("low-confidence matches do not contribute tags", () => {
  const noisy = media(["Other"], 9, { tags: [{ name: "Mecha" }] });
  const match = pickMatch("Missing", [noisy]);
  assert.deepEqual(tagsFromConfidentMatch(match), []);
});
