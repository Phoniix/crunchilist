import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedByTaste,
  audioTasteScore,
  collectTagSuggestions,
  filterTagSuggestions,
  sanitizeTaste,
  scoreLabels,
} from "../lib/taste.js";

test("tag suggestions prefer the start of a saved genre and skip tags already chosen", () => {
  const options = collectTagSuggestions({
    anilistCache: {
      a: { kind: "hit", genres: ["Romance"], tags: ["Love Triangle"] },
      b: { kind: "miss" },
    },
    imports: {
      1: { media: { genres: ["Drama"], tags: [{ name: "Tragic" }] } },
    },
  });
  assert.ok(options.includes("Romance"));
  assert.ok(options.includes("Love Triangle"));
  assert.ok(options.includes("Action"));
  assert.ok(options.includes("Subbed"));
  assert.ok(options.includes("English Dub"));
  assert.ok(options.includes("Spanish Dub"));
  assert.equal(filterTagSuggestions("ro", options, [])[0], "Romance");
  assert.equal(filterTagSuggestions("ro", options, ["Romance"]).includes("Romance"), false);
  assert.deepEqual(filterTagSuggestions("lov", options, []), ["Love Triangle"]);
  assert.deepEqual(filterTagSuggestions("eng", options, []).slice(0, 1), ["English Dub"]);
  assert.deepEqual(filterTagSuggestions("act", ["Acting", "Action", "Outdoor Activities"], []), ["Action", "Acting", "Outdoor Activities"]);
});

test("hard avoids drop a matched show and likes outrank dislikes", () => {
  assert.equal(allowedByTaste(["Horror", "Action"], { hardAvoids: ["Horror"] }), false);
  assert.equal(allowedByTaste(["Action"], { hardAvoids: ["Horror"] }), true);
  const weights = { liked: new Map([["romance", 5]]), disliked: new Map([["horror", 5]]) };
  assert.ok(scoreLabels(["Romance"], weights) > scoreLabels(["Horror"], weights));
});

test("sanitizeTaste keeps preferred dub languages and clears them for sub", () => {
  const kept = sanitizeTaste({ subDub: "dub", dubLangs: ["en", "ES", "xx", "en"] });
  assert.deepEqual(kept.dubLangs, ["en", "es"]);
  const cleared = sanitizeTaste({ subDub: "sub", dubLangs: ["en", "es"] });
  assert.deepEqual(cleared.dubLangs, []);
});

test("audioTasteScore boosts preferred dub languages", () => {
  const both = { audioMode: "both", audioLocales: ["ja-JP", "en-US"] };
  const spanish = { audioMode: "both", audioLocales: ["ja-JP", "es-419"] };
  const subOnly = { audioMode: "sub", audioLocales: ["ja-JP"] };
  assert.ok(audioTasteScore(both, { subDub: "dub", dubLangs: ["en"] }) > audioTasteScore(spanish, { subDub: "dub", dubLangs: ["en"] }));
  assert.ok(audioTasteScore(subOnly, { subDub: "sub" }) > audioTasteScore(both, { subDub: "sub" }) - 1);
  assert.equal(audioTasteScore(both, { subDub: "any", dubLangs: ["en"] }), 2);
});
