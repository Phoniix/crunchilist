import assert from "node:assert/strict";
import test from "node:test";
import {
  audioAvailability,
  audioDescriptor,
  audioSearchTags,
  audioTagSuggestions,
  dubLanguageOptions,
  languageAliasCode,
  normalizeAudioLocales,
} from "../lib/audio-locales.js";
import { normalizeTitle, parseBrowsePayload } from "../lib/catalog.js";
import { parseQuery, hasIntent } from "../lib/query.js";
import { buildIndex, docFromShow, searchIndex } from "../lib/search-index.js";

test("normalizeAudioLocales keeps unique language-region codes", () => {
  assert.deepEqual(normalizeAudioLocales(["ja-JP", "en_US", "JA-JP", "bad", "es-419"]), ["ja-JP", "en-US", "es-419"]);
});

test("audioDescriptor covers subbed only, dubbed only, and Sub|Dub", () => {
  assert.equal(audioDescriptor({ locales: ["ja-JP"] }), "Subbed only · Japanese");
  assert.equal(audioDescriptor({ locales: ["en-US"] }), "Dubbed only · English");
  assert.equal(audioDescriptor({ locales: ["ja-JP", "en-US", "es-419"] }), "Sub|Dub · Japanese, English, Spanish");
  assert.equal(audioAvailability({ isDubbed: true, isSubbed: true }).mode, "both");
  assert.equal(audioAvailability({ isDubbed: false, isSubbed: true }).mode, "sub");
});

test("audioSearchTags expose dub/sub phrases for indexing", () => {
  const tags = audioSearchTags({ locales: ["ja-JP", "en-US"] });
  assert.ok(tags.includes("sub|dub"));
  assert.ok(tags.includes("english dub"));
  assert.ok(tags.includes("dub"));
  assert.ok(tags.includes("sub"));
  assert.ok(tags.includes("subbed"));
});

test("audioTagSuggestions list Subbed and Language Dub chips", () => {
  const tags = audioTagSuggestions();
  assert.ok(tags.includes("Subbed"));
  assert.ok(tags.includes("English Dub"));
  assert.ok(tags.includes("Spanish Dub"));
  assert.ok(tags.includes("Portuguese Dub"));
  assert.ok(!tags.includes("Japanese Dub"));
  const dubs = dubLanguageOptions();
  assert.ok(dubs.some((row) => row.code === "en" && row.label === "English"));
  assert.ok(!dubs.some((row) => row.code === "ja"));
});

test("browse titles keep Crunchyroll audio_locales", () => {
  const { items } = parseBrowsePayload({
    data: [{
      id: "G6NQ5DWZ6",
      title: "Frieren",
      slug_title: "frieren",
      type: "series",
      series_metadata: {
        episode_count: 28,
        audio_locales: ["ja-JP", "en-US"],
        is_dubbed: true,
        is_subbed: true,
      },
    }],
  });
  assert.deepEqual(items[0].audioLocales, ["ja-JP", "en-US"]);
  assert.equal(items[0].isDubbed, true);
  assert.equal(items[0].isSubbed, true);
  const kept = normalizeTitle({
    id: "G6NQ5DWZ6",
    title: "Frieren",
    audioLocales: ["ja-JP"],
    isDubbed: false,
    isSubbed: true,
  });
  assert.deepEqual(kept.audioLocales, ["ja-JP"]);
});

test("parseQuery understands dub/sub audio filters", () => {
  assert.equal(languageAliasCode("english"), "en");
  assert.deepEqual(parseQuery("english dub romance").filters.audioLang, "en");
  assert.equal(parseQuery("english dub romance").filters.audio, "dub");
  assert.equal(parseQuery("subbed only fantasy").filters.audio, "sub_only");
  assert.equal(parseQuery("dub only action").filters.audio, "dub_only");
  assert.equal(parseQuery("sub|dub comedy").filters.audio, "both");
  assert.equal(parseQuery("something dubbed").filters.audio, "dub");
  assert.equal(hasIntent(parseQuery("english dub")), true);
});

test("searchIndex filters by audio mode and language", () => {
  const docs = [
    docFromShow({
      id: "sub",
      title: "Sub Show",
      genres: ["Fantasy"],
      audioMode: "sub",
      audioLocales: ["ja-JP"],
      hiddenTags: audioSearchTags({ locales: ["ja-JP"] }),
    }),
    docFromShow({
      id: "both",
      title: "Both Show",
      genres: ["Fantasy"],
      audioMode: "both",
      audioLocales: ["ja-JP", "en-US"],
      hiddenTags: audioSearchTags({ locales: ["ja-JP", "en-US"] }),
    }),
    docFromShow({
      id: "dub",
      title: "Dub Show",
      genres: ["Fantasy"],
      audioMode: "dub",
      audioLocales: ["en-US"],
      hiddenTags: audioSearchTags({ locales: ["en-US"] }),
    }),
  ];
  const index = buildIndex(docs);
  const ids = (query) => searchIndex(index, parseQuery(query)).results.map((row) => row.doc.id);
  assert.deepEqual(ids("subbed only fantasy"), ["sub"]);
  assert.deepEqual(ids("dub only fantasy"), ["dub"]);
  assert.ok(ids("english dub fantasy").includes("both"));
  assert.ok(ids("english dub fantasy").includes("dub"));
  assert.ok(!ids("english dub fantasy").includes("sub"));
  assert.deepEqual(ids("sub|dub fantasy"), ["both"]);
});
