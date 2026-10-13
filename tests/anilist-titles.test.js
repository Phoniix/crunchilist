import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { refreshTitles, titleIndex, titleRow } from "../scripts/anilist-titles.mjs";
import { channelCandidates } from "../scripts/youtube-catalog.mjs";

const media = (id, english, extra = {}) => ({
  id,
  title: { english, romaji: extra.romaji || english, native: extra.native || null },
  synonyms: extra.synonyms || [],
  format: extra.format || "TV",
  startDate: { year: extra.year || 2020 },
  episodes: extra.episodes || 12,
  popularity: extra.popularity || 50000,
  isAdult: Boolean(extra.isAdult),
});

const ROWS = [
  titleRow(media(1, "Mobile Suit Gundam: The Witch from Mercury", { romaji: "Kidou Senshi Gundam: Suisei no Majo", popularity: 180000 })),
  titleRow(media(2, "SPY x FAMILY", { popularity: 700000 })),
  titleRow(media(3, "SPY x FAMILY Season 2", { popularity: 300000 })),
  titleRow(media(4, "Moomin", { synonyms: ["Tanoshii Moomin Ikka"], popularity: 9000 })),
  titleRow(media(5, "Black Jack", { native: "ブラック・ジャック", popularity: 20000 })),
  titleRow(media(6, "Black Jack", { year: 2004, popularity: 18000 })),
];

test("the title index matches English, romaji, native and synonym titles", () => {
  const index = titleIndex(ROWS);
  assert.equal(index.match("Mobile Suit Gundam: The Witch from Mercury").media.id, 1);
  assert.equal(index.match("Kidou Senshi Gundam: Suisei no Majo").media.id, 1);
  assert.equal(index.match("Tanoshii Moomin Ikka").media.id, 4);
  assert.equal(index.match("ブラック・ジャック").media.id, 5);
});

test("season markers pick the right season", () => {
  const index = titleIndex(ROWS);
  assert.equal(index.match("SPY x FAMILY").media.id, 2);
  assert.equal(index.match("Spy x Family Season 2").media.id, 3);
});

test("two shows with the same name and close popularity stay unsure", () => {
  const match = titleIndex(ROWS).match("Black Jack");
  assert.equal(match.confidence, "none");
  assert.equal(match.candidates, 2);
});

test("a title the index doesn't know reports no candidates", () => {
  assert.deepEqual(titleIndex(ROWS).match("A Show From Next Week"), { confidence: "none", reason: "unknown", candidates: 0 });
});

test("rows round popularity and drop long synonyms so the file stays small and steady", () => {
  const row = titleRow(media(7, "Show", { popularity: 123456, synonyms: ["x".repeat(130), "Short"] }));
  assert.equal(row.p, 120000);
  assert.deepEqual(row.s, ["Short"]);
});

function fakeAnilist(byYear) {
  const calls = [];
  return {
    calls,
    anilist: async (text, variables) => {
      calls.push(variables);
      const year = variables.from === 0 ? "old" : Math.floor(variables.from / 10000) + 1;
      const rows = byYear[year] || [];
      const page = rows.slice((variables.page - 1) * 50, variables.page * 50);
      return { data: { Page: { pageInfo: { hasNextPage: variables.page * 50 < rows.length }, media: page } } };
    },
  };
}

test("refreshTitles builds in full, then only refreshes recent years, then rebuilds after a month", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cl-titles-"));
  const path = join(dir, "anilist-titles.json");
  try {
    const many = Array.from({ length: 60 }, (_, i) => media(1000 + i, `Show ${i}`, { year: 2025 }));
    const first = fakeAnilist({ old: [media(10, "Astro Boy", { year: 1952 })], 2025: many, 2026: [media(20, "Fresh Show", { year: 2026 }), media(21, "Adult", { isAdult: true })] });
    const built = await refreshTitles(first.anilist, { path, now: new Date("2026-10-01T00:00:00Z") });
    assert.equal(built.changed, true);
    assert.equal(built.titles.length, 62);
    assert.ok(first.calls.some((call) => call.page === 2), "pages past the first are read");
    const saved = JSON.parse(await readFile(path, "utf8"));
    assert.equal(saved.titles[0].id, 10);

    const nothing = fakeAnilist({});
    const soon = await refreshTitles(nothing.anilist, { path, now: new Date("2026-10-03T00:00:00Z") });
    assert.equal(soon.changed, false);
    assert.equal(nothing.calls.length, 0);

    const weekly = fakeAnilist({ 2026: [media(20, "Fresh Show Renamed", { year: 2026 }), media(22, "Newer Show", { year: 2026 })] });
    const refreshed = await refreshTitles(weekly.anilist, { path, now: new Date("2026-10-09T00:00:00Z") });
    assert.equal(refreshed.changed, true);
    assert.equal(refreshed.titles.length, 63);
    assert.equal(refreshed.titles.find((row) => row.id === 20).e, "Fresh Show Renamed");
    assert.ok(weekly.calls.every((call) => call.from === 0 || call.from >= 20240000), "only recent years are walked");

    const monthly = fakeAnilist({ 2026: [media(30, "Only Show", { year: 2026 })] });
    const rebuilt = await refreshTitles(monthly.anilist, { path, now: new Date("2026-11-02T00:00:00Z") });
    assert.deepEqual(rebuilt.titles.map((row) => row.id), [30]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("channel playlists are matched locally first; only unknown names reach AniList's search", async () => {
  const source = {
    channelPlaylists: async () => [
      { id: "PLgundam001", title: "Mobile Suit Gundam: The Witch from Mercury | Full Episodes", count: 24, channel: "GUNDAM" },
      { id: "PLblackjack", title: "Black Jack", count: 12, channel: "Tezuka" },
      { id: "PLbrandnew1", title: "A Show From Next Week", count: 3, channel: "GUNDAM" },
    ],
  };
  const searched = [];
  const anilist = async (text, variables) => {
    if (text.includes("id_in")) return { data: { Page: { media: variables.ids.map((id) => ({ ...media(id, id === 1 ? "Mobile Suit Gundam: The Witch from Mercury" : "A Show From Next Week"), relations: { edges: [] } })) } } };
    searched.push(...Object.values(variables));
    return { data: { p0: { media: [media(99, "A Show From Next Week")] } } };
  };
  const result = await channelCandidates(anilist, source, ["@Gundam"], { titles: titleIndex(ROWS) });
  assert.deepEqual(searched, ["A Show From Next Week"]);
  assert.deepEqual(result.candidates.map((row) => row.media.id).sort((a, b) => a - b), [1, 99]);
  assert.equal(result.unmatched.length, 1);
  assert.match(result.unmatched[0].reason, /Black Jack/);
});
