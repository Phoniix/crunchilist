import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { cleanLabel, createMatcher, looseKey, pluralKey, seasonInfo } from "../src/lib/match-engine.js";

const fixture = (name) => JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8"));
const cases = fixture("matching-cases.json");
const seasons = fixture("crunchyroll-seasons.json");
const feed = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "feeds", "id-map.json"), "utf8"));
const matcher = createMatcher(feed.rows);
const span = ([from, to]) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

test("labels lose dub and language tags, ranges and repeated season tags", () => {
  assert.equal(cleanLabel("Season 1 (Korean)"), "Season 1");
  assert.equal(cleanLabel("Persona 5: Season 1 (English Dub)"), "Persona 5: Season 1");
  assert.equal(cleanLabel("East Blue Special Edition HD, Subtitled (1-61)"), "East Blue Special Edition HD");
  assert.equal(cleanLabel("Date A Live V (Season 5)"), "Date A Live V");
  assert.equal(cleanLabel("Shows (Castilian)"), "Shows");
});

test("season labels give their number, part, arc and the name that's left", () => {
  assert.deepEqual(seasonInfo("Season 3 Part 2"), { clean: "Season 3 Part 2", number: 3, special: false, part: 2, arc: false, rest: "", range: null });
  assert.equal(seasonInfo("Season IV").number, 4);
  assert.equal(seasonInfo("4th Season: Second Year, First Semester").rest, "Second Year, First Semester");
  assert.equal(seasonInfo("The Misfit of Demon King Academy II: History's Strongest Demon King").number, 2);
  assert.equal(seasonInfo("Fairies Albums S2").number, 2);
  const special = seasonInfo("Kaguya-sama: Love is War: Season 3.5: The First Kiss");
  assert.equal(special.number, null);
  assert.equal(special.special, true);
  const arc = seasonInfo("Series 1, Arc 1");
  assert.equal(arc.arc, true);
  assert.equal(arc.rest, "");
  assert.deepEqual(seasonInfo("Chimera Ant Arc (76-136)").range, { from: 76, to: 136 });
});

test("keys ignore case, accents, quotes and punctuation; the plural key ignores a trailing s", () => {
  assert.equal(looseKey("Bungō Stray Dogs"), "bungo stray dogs");
  assert.equal(looseKey("Akebi’s Sailor Uniform"), looseKey("Akebi's Sailor Uniform"));
  assert.equal(looseKey("Cells at Work!!"), looseKey("Cells at Work!"));
  assert.equal(pluralKey("Attack on Titan OADs"), pluralKey("Attack on Titan OAD"));
  assert.equal(pluralKey("Fairies Albums"), pluralKey("Fairies Album"));
  assert.equal(pluralKey("Boss"), "boss");
});

test("every reported show has a series, a correct AniList entry and a cause", () => {
  for (const item of cases) {
    assert.ok(item.series, JSON.stringify(item));
    assert.ok(Number.isInteger(item.expect) && item.expect > 0, item.series);
    assert.ok(item.cause, item.series);
  }
});

// Real shows Crunchilist's matcher missed, checked against the published master list.
for (const item of cases) {
  test(`matches ${item.series}${item.season ? ` — ${item.season}` : ""} to AniList ${item.expect} (${item.cause})`, () => {
    const found = matcher.match(item);
    assert.equal(found.anilistId, item.expect, `${found.reason} ${found.candidates.join(",")}`);
    assert.equal(found.confidence, "high");
    if (item.progressAtLeast) assert.ok(found.progress >= item.progressAtLeast, `progress ${found.progress}`);
  });
}

// Crunchyroll season names and episode numbers, placed on the AniList entries that hold them.
for (const item of seasons) {
  test(`places ${item.series} — ${item.season} (${item.cause})`, () => {
    const found = matcher.match({ ...item, episodes: span(item.episodes) });
    const parts = found.parts.map((part) => [part.anilistId, part.episodes[0], part.progress]);
    assert.deepEqual(parts, item.parts, `${found.how} ${found.reason}`);
    assert.equal(found.confidence, item.confidence || "high");
    assert.ok(!found.parts.some((part) => part.overflow), "no episodes left without an entry");
  });
}

test("a named season AniList doesn't have stays unmatched instead of falling back to season 1", () => {
  const found = matcher.match({ series: "Bungo Stray Dogs", season: "A Season Name Nobody Uses" });
  assert.equal(found.anilistId, null);
  assert.match(found.reason, /season's name/);
});

test("names shared by several entries are narrowed by format, punctuation and episode counts, or left unclear", () => {
  assert.equal(matcher.match({ series: "Attack on Titan", season: "Season 1" }).anilistId, 16498, "the TV series over the movie");
  assert.equal(matcher.match({ series: "Kaguya-sama: Love is War", season: "Season 1" }).anilistId, 101921, "'Love is War' over 'Love is War?'");
  assert.equal(matcher.match({ series: "Hunter x Hunter", season: "Season 1", episodes: [100] }).anilistId, 11061, "only the remake holds episode 100");
  const unclear = matcher.match({ series: "Hunter x Hunter", season: "Season 1" });
  assert.equal(unclear.anilistId, null);
  assert.deepEqual(unclear.candidates.sort((a, b) => a - b), [136, 11061]);
});

test("a name that belongs to one entry always matches that entry", () => {
  let checked = 0;
  for (const row of feed.rows.filter((_, index) => index % 7 === 0)) {
    for (const name of [row.title, ...(row.synonyms || [])].filter((item) => /^[\x20-\x7e’]+$/.test(item))) {
      if (matcher.index.loose.get(looseKey(name))?.size !== 1 || !seasonInfo(name).rest) continue;
      checked += 1;
      const found = matcher.match({ series: name });
      assert.ok(found.anilistId === row.a || found.anilistId === null, `"${name}" matched ${found.anilistId} instead of ${row.a}`);
    }
  }
  assert.ok(checked > 10000, `checked ${checked}`);
});
