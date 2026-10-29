import assert from "node:assert/strict";
import test from "node:test";
import { netflixHistoryStalled, splitPlayerTitle, splitTitle, usablePlayerSeries } from "../lib/netflix-history.js";

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
