import assert from "node:assert/strict";
import test from "node:test";
import {
  activityRow, episodeNumberOf, fillEpisodeGaps, groupNetflix, mergeNetflixReplay, netflixHistoryStalled,
  splitPlayerTitle, splitTitle, unnumberedCatchUpCount, usablePlayerSeries,
} from "../lib/netflix-history.js";

test("splitPlayerTitle treats Show: Episode as a series (unlike CSV splitTitle)", () => {
  assert.deepEqual(splitPlayerTitle("Death Note: Rebirth"), {
    series: "Death Note",
    season: "",
    seasonNumber: null,
    episode: "Rebirth",
  });
  assert.equal(splitTitle("Death Note: Rebirth").movie, "Death Note: Rebirth");
});

test("splitPlayerTitle keeps season lines and strips Watch", () => {
  assert.deepEqual(splitPlayerTitle("Death Note: Season 1: Rebirth"), {
    series: "Death Note",
    season: "Season 1",
    seasonNumber: 1,
    episode: "Rebirth",
  });
  assert.equal(splitPlayerTitle("Watch One Piece").series, "One Piece");
});

test("junk tab titles like Netflix are never treated as a show", () => {
  assert.equal(splitPlayerTitle("Netflix"), null);
  assert.equal(splitPlayerTitle("Watch Netflix"), null);
  assert.equal(usablePlayerSeries("Netflix"), "");
  assert.equal(usablePlayerSeries("Death Note"), "Death Note");
});

test("a first activity page with a known total but no rows is still loading, not an empty account", () => {
  assert.equal(netflixHistoryStalled({ viewedItems: [], vhSize: 40 }, 0), true);
  assert.equal(netflixHistoryStalled({ viewedItems: [], vhSize: 0 }, 0), false);
  assert.equal(netflixHistoryStalled({ viewedItems: [{ movieID: 1 }], vhSize: 40 }, 0), false);
  assert.equal(netflixHistoryStalled({ viewedItems: [], vhSize: 40 }, 1), false);
});

test("Show: Episode keeps the series head, not the episode name", () => {
  const split = splitPlayerTitle("Love Through a Prism: Feeling Blue");
  assert.equal(split.series, "Love Through a Prism");
  assert.equal(split.episode, "Feeling Blue");
});

test("episodeNumberOf reads Episode N / E14 / S1:E12 style labels", () => {
  assert.equal(episodeNumberOf("Episode 14"), 14);
  assert.equal(episodeNumberOf("E3 - Title"), 3);
  assert.equal(episodeNumberOf("Rebirth"), null);
  assert.equal(episodeNumberOf("12: The Start"), 12);
  assert.equal(episodeNumberOf("S1:E14 Rebirth"), 14);
  assert.equal(episodeNumberOf("S01E5 Title"), 5);
  assert.equal(episodeNumberOf("1x12 The Start"), 12);
  assert.equal(episodeNumberOf("Season 1"), null);
});

test("groupNetflix keeps absolute episode numbers and fills gaps", () => {
  const rows = [
    activityRow({ seriesTitle: "Show", series: 1, seasonDescriptor: "Season 1", episodeTitle: "Episode 2", date: 100, movieID: 2, duration: 100, bookmark: 0 }),
    activityRow({ seriesTitle: "Show", series: 1, seasonDescriptor: "Season 1", episodeTitle: "Episode 4", date: 200, movieID: 4, duration: 100, bookmark: 0 }),
  ].filter(Boolean);
  const [group] = groupNetflix(rows);
  assert.equal(group.absolute, true);
  assert.equal(group.seasonId, "s1");
  assert.deepEqual(group.episodes, [1, 2, 3, 4]);
  assert.equal(Math.max(...group.episodes), 4);
  assert.deepEqual(fillEpisodeGaps([2, 4]), [1, 2, 3, 4]);
});

test("mergeNetflixReplay upgrades an in-progress row once that same play finishes", () => {
  const key = "99:100";
  const merged = mergeNetflixReplay(
    [{ key, watched: false, playedAt: 100 }],
    [{ key, watched: true, playedAt: 100 }],
  );
  assert.equal(merged.added, 1);
  assert.equal(merged.rows[0].watched, true);
  assert.equal(merged.rows.length, 1);
  const extra = mergeNetflixReplay(merged.rows, [{ key: "100:200", watched: true, playedAt: 200 }]);
  assert.equal(extra.added, 1);
  assert.equal(extra.rows.length, 2);
});

test("groupNetflix falls back to 1..n when episode titles have no numbers", () => {
  const rows = [
    activityRow({ seriesTitle: "Show", series: 1, seasonDescriptor: "Season 1", episodeTitle: "Alpha", date: 100, movieID: 10, duration: 100, bookmark: 0 }),
    activityRow({ seriesTitle: "Show", series: 1, seasonDescriptor: "Season 1", episodeTitle: "Beta", date: 200, movieID: 11, duration: 100, bookmark: 0 }),
  ].filter(Boolean);
  const [group] = groupNetflix(rows);
  assert.equal(group.absolute, false);
  assert.deepEqual(group.episodes, [1, 2]);
  assert.equal(group.catchUpCount, 2);
});

test("unnumberedCatchUpCount counts recent titles and ignores gap-fill zeros and old backlog", () => {
  const now = 1_700_000_000_000;
  assert.equal(unnumberedCatchUpCount({ 1: now - 1000, 2: now - 2000, 3: now - 3000 }, { now }), 3);
  assert.equal(unnumberedCatchUpCount({ 1: 0, 2: now - 1000, 3: now - 8 * 24 * 60 * 60 * 1000 }, { now }), 1);
});
