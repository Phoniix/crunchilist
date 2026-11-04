import assert from "node:assert/strict";
import test from "node:test";
import { BANNER_HISTORY_MS, FOR_YOU_HISTORY_MS, FOR_YOU_MIDWEEK_MS, FOR_YOU_PICKS_TTL_MS, galleryBanner, noveltyOf, orderForYou, pickExclusiveBanner, rankBanner, tasteMatches } from "../lib/banner.js";

const shows = "abcdefghijklmnop".split("").map((id) => ({ id }));
const trending = shows.map((show) => show.id);

test("taste scores map onto the 45-85 match scale, best first", () => {
  const scores = { a: 10, b: 5, c: 0, d: -3 };
  const matches = tasteMatches([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], (item) => scores[item.id]);
  assert.deepEqual([...matches.values()], [85, 67, 48, 45]);
  assert.equal(tasteMatches([{ id: "x" }], () => 0).get("x"), 55);
});

test("equal taste scores still step down the row", () => {
  const values = [...tasteMatches([{ id: "a" }, { id: "b" }, { id: "c" }], () => 4).values()];
  assert.deepEqual(values, [85, 80, 75]);
});

test("For you puts AI picks first in rank order, then mentions, then the taste order", () => {
  const rows = orderForYou({
    tasteIds: ["a", "b", "c", "d", "e"],
    picks: [
      { id: "d", rank: 2, confidence: 80, reason: "two" },
      { id: "c", rank: 1, confidence: 91, reason: "one" },
      { id: "e", mention: true, reason: "also" },
    ],
    tasteMatch: new Map([["a", 85], ["b", 70], ["e", 50]]),
  });
  assert.deepEqual(rows.map((row) => row.id), ["c", "d", "e", "a", "b"]);
  assert.deepEqual(rows.map((row) => row.match), [91, 80, 50, 49, 48], "matches only step down the numbered row");
  assert.deepEqual(rows.map((row) => row.ai), [true, true, true, false, false]);
  assert.equal(rows[0].reason, "one");
});

test("For you without AI keeps the taste order and taste matches", () => {
  const rows = orderForYou({ tasteIds: ["b", "a"], picks: null, tasteMatch: new Map([["a", 60]]) });
  assert.deepEqual(rows.map((row) => [row.id, row.match, row.ai]), [["b", null, false], ["a", 60, false]]);
});

test("For you prefers titles that have not shown recently", () => {
  const now = 1_000_000;
  const recentShown = new Map([["c", now - 1000], ["a", now - FOR_YOU_HISTORY_MS / 2]]);
  const rows = orderForYou({
    tasteIds: ["a", "b", "c"],
    picks: [
      { id: "c", rank: 1, confidence: 90 },
      { id: "b", rank: 2, confidence: 80 },
      { id: "a", rank: 3, confidence: 70 },
    ],
    recentShown,
    now,
  });
  assert.deepEqual(rows.map((row) => row.id), ["b", "a", "c"], "fresher titles lead even if AI ranked them lower");
});

test("Picked for you cache lasts a week, with a mid-week shuffle window", () => {
  assert.equal(FOR_YOU_PICKS_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(FOR_YOU_MIDWEEK_MS, 3 * 24 * 60 * 60 * 1000);
});

test("For you midweek and exclude skip muted or leading titles", () => {
  const now = 1_000_000;
  const recentShown = new Map([["a", now - 1000], ["b", now - FOR_YOU_HISTORY_MS + 1000]]);
  const rows = orderForYou({
    tasteIds: ["a", "b", "c"],
    picks: [
      { id: "a", rank: 1, confidence: 90 },
      { id: "b", rank: 2, confidence: 80 },
      { id: "c", rank: 3, confidence: 70 },
    ],
    recentShown,
    now,
    midweek: true,
    exclude: new Set(["c"]),
  });
  assert.ok(!rows.some((row) => row.id === "c"));
  assert.equal(rows[0].id, "b");
});

test("banner skips finished, dropped and art-less shows", () => {
  const status = { a: "finished", b: "dropped" };
  const rows = rankBanner({ shows, trending, statusOf: (show) => status[show.id] || "", hasArt: (show) => show.id !== "c" });
  const ids = rows.map((row) => row.id);
  assert.equal(rows.length, 6);
  for (const id of ["a", "b", "c"]) assert.equal(ids.includes(id), false);
  assert.equal(ids[0], "d");
});

test("banner lifts AI picks and never-started taste matches over plain popularity", () => {
  const rows = rankBanner({
    shows,
    trending,
    tasteIds: ["m", "n", "o"],
    picks: [{ id: "p", rank: 1, confidence: 92, reason: "Fits your love of slow fantasy." }],
    tasteMatch: new Map([["m", 85]]),
    statusOf: (show) => (show.id === "a" ? "watching" : ""),
  });
  const ids = rows.map((row) => row.id);
  assert.equal(ids[0], "p");
  assert.equal(rows[0].match, 92);
  assert.equal(rows[0].ai, true);
  assert.ok(ids.includes("m"), "a strong taste match makes the cut");
  assert.ok(ids.indexOf("b") < ids.indexOf("a") || !ids.includes("a"), "in-progress shows get no lift for being unstarted");
});

test("banner keeps at least one top-10 trending show", () => {
  const status = Object.fromEntries(trending.slice(0, 10).map((id) => [id, "plan"]));
  const rows = rankBanner({
    shows,
    trending,
    tasteIds: ["k", "l", "m", "n", "o", "p"],
    picks: ["k", "l", "m", "n", "o", "p"].map((id, index) => ({ id, rank: index + 1, confidence: 90 - index })),
    statusOf: (show) => status[show.id] || "",
  });
  assert.equal(rows.length, 6);
  assert.ok(rows.some((row) => row.trend >= 0 && row.trend < 10));
});

test("a banner reroll leaves out the shows it already showed", () => {
  const first = rankBanner({ shows, trending });
  const exclude = new Set(first.map((row) => row.id));
  const next = rankBanner({ shows, trending, exclude });
  assert.equal(next.length, 6);
  assert.ok(next.every((row) => !exclude.has(row.id)));
  assert.ok(next.some((row) => row.trend >= 0 && row.trend < 10), "a top-10 show still keeps a slot when one is left");
  const picks = [{ id: first[0].id, rank: 1, confidence: 95 }, { id: "o", rank: 2, confidence: 70 }];
  const rolled = rankBanner({ shows, trending, picks, exclude });
  assert.equal(rolled.some((row) => row.id === first[0].id), false, "excluded AI picks stay out too");
  assert.equal(rolled.find((row) => row.id === "o")?.ai, true);
});

test("banner without AI blends trending, taste and unstarted shows", () => {
  const rows = rankBanner({ shows, trending, tasteIds: ["j"], picks: null, tasteMatch: new Map([["j", 85]]) });
  assert.ok(rows.every((row) => !row.ai));
  assert.ok(rows.map((row) => row.id).includes("j"));
  assert.equal(rows.find((row) => row.id === "j").match, 85);
});

const many = Array.from({ length: 40 }, (_, n) => ({ id: `s${n}` }));
const manyTrending = many.map((show) => show.id);

test("the paged banner fills three pages of six, mostly AI picks, one blended slide per page", () => {
  const picks = ["s30", "s31", "s32", "s33", "s34"].map((id, index) => ({ id, rank: index + 1, confidence: 90 - index, reason: `why ${id}` }));
  picks.push({ id: "s35", mention: true, reason: "also" });
  const extraPicks = ["s20", "s21", "s22", "s23", "s24", "s25", "s26", "s27", "s28", "s29"].map((id) => ({ id, reason: `row ${id}` }));
  const rows = galleryBanner({ shows: many, trending: manyTrending, picks, extraPicks, count: 18 });
  assert.equal(rows.length, 18);
  assert.deepEqual(rows.slice(0, 5).map((row) => row.id), ["s30", "s31", "s32", "s33", "s34"], "ranked picks lead in rank order");
  assert.equal(rows[6].id, "s35", "mentions follow the ranked picks");
  for (const index of [5, 11, 17]) assert.equal(rows[index].ai, false, `slide ${index + 1} closes its page with a blended pick`);
  assert.equal(rows.filter((row) => row.ai).length, 15);
  assert.ok(rows.some((row) => row.trend >= 0 && row.trend < 10), "a top-10 show keeps a slot");
  assert.equal(new Set(rows.map((row) => row.id)).size, 18);
  assert.equal(rows.find((row) => row.id === "s20").reason, "row s20");
});

test("the paged banner tops up with the blend when AI picks run short, and skips unusable ones", () => {
  const status = { s31: "finished" };
  const picks = [{ id: "s30", rank: 1, confidence: 88 }, { id: "s31", rank: 2, confidence: 80 }];
  const rows = galleryBanner({ shows: many, trending: manyTrending, picks, extraPicks: [{ id: "missing" }, { id: "s30" }], statusOf: (show) => status[show.id] || "", count: 18 });
  assert.equal(rows.length, 18);
  assert.equal(rows[0].id, "s30");
  assert.equal(rows.filter((row) => row.ai).length, 1);
  assert.equal(rows.some((row) => row.id === "s31"), false);
});

test("without AI the paged banner is the plain blend", () => {
  const rows = galleryBanner({ shows: many, trending: manyTrending, extraPicks: [{ id: "s39" }], count: 18 });
  assert.equal(rows.length, 18);
  assert.ok(rows.every((row) => !row.ai));
});

test("novelty fades over a few days", () => {
  const now = 1_000_000_000_000;
  const recent = new Map([["a", now], ["b", now - BANNER_HISTORY_MS / 2], ["c", now - BANNER_HISTORY_MS]]);
  assert.equal(noveltyOf("a", recent, now), 0);
  assert.ok(Math.abs(noveltyOf("b", recent, now) - 0.5) < 1e-9);
  assert.equal(noveltyOf("c", recent, now), 1);
  assert.equal(noveltyOf("d", recent, now), 1);
});

test("recently featured banner titles yield the lead for fresher AI picks", () => {
  const now = Date.now();
  const picks = ["s30", "s31", "s32"].map((id, index) => ({ id, rank: index + 1, confidence: 90 - index }));
  const extraPicks = ["s20", "s21", "s22"].map((id) => ({ id, reason: `fresh ${id}` }));
  const recentShown = new Map([["s30", now], ["s31", now], ["s32", now]]);
  const rows = galleryBanner({
    shows: many,
    trending: manyTrending,
    picks,
    extraPicks,
    recentShown,
    count: 18,
  });
  const lead = rows.filter((row) => row.ai).slice(0, 3).map((row) => row.id);
  assert.deepEqual(lead, ["s20", "s21", "s22"], "stale ranked picks step aside for fresher extras");
  assert.ok(rows.some((row) => row.id === "s30"), "stale picks can still appear later");
});

test("blend scoring also prefers titles that have not led the banner lately", () => {
  const now = Date.now();
  const recentShown = new Map(manyTrending.slice(0, 12).map((id) => [id, now]));
  const rows = rankBanner({ shows: many, trending: manyTrending, recentShown, count: 6 });
  const fresh = rows.filter((row) => !recentShown.has(row.id));
  assert.ok(fresh.length >= 4, "most slots go to titles that have not featured lately");
});

test("exclusive banner picks are single-service titles and rotate by novelty", () => {
  const exclusives = many.map((show, i) => ({
    ...show,
    onCrunchyroll: false,
    streaming: i % 5 === 0 ? [{ service: "netflix" }] : i % 5 === 1 ? [{ service: "hidive" }] : [{ service: "netflix" }, { service: "hidive" }],
    banner: "x",
  }));
  const picks = pickExclusiveBanner(exclusives, { hasArt: () => true, limit: 3 });
  assert.equal(picks.length, 3);
  assert.ok(picks.every((pick) => pick.exclusive && pick.service));
  const now = Date.now();
  const recentShown = new Map(picks.slice(0, 2).map((pick) => [pick.id, now]));
  const next = pickExclusiveBanner(exclusives, { recentShown, hasArt: () => true, limit: 3 });
  assert.ok(next[0].id !== picks[0].id || next.some((pick) => !recentShown.has(pick.id)));
});

test("gallery reserves exclusive slots without dropping AI leads", () => {
  const picks = ["s30", "s31", "s32", "s33", "s34"].map((id, index) => ({ id, rank: index + 1, confidence: 90 - index }));
  const exclusivePicks = [
    { id: "s10", service: "netflix", reason: "Only on Netflix", exclusive: true },
    { id: "s11", service: "hidive", reason: "Only on HIDIVE", exclusive: true },
    { id: "s12", service: "tubi", reason: "Only on Tubi", exclusive: true },
  ];
  const rows = galleryBanner({
    shows: many,
    trending: manyTrending,
    picks,
    exclusivePicks,
    count: 18,
  });
  assert.equal(rows.length, 18);
  assert.equal(rows[0].id, "s30");
  const exclusives = rows.filter((row) => row.exclusive);
  assert.ok(exclusives.length >= 2 && exclusives.length <= 3);
  assert.ok(exclusives.every((row) => row.reason.startsWith("Only on")));
});
