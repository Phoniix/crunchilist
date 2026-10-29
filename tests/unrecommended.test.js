import assert from "node:assert/strict";
import test from "node:test";
import {
  addUnrecommended,
  filterRecommended,
  isUnrecommended,
  removeUnrecommended,
  sanitizeUnrecommended,
} from "../lib/unrecommended.js";

test("sanitize keeps unique newest titles", () => {
  const list = sanitizeUnrecommended([
    { id: "a", title: "A", at: 2 },
    { id: "a", title: "A again", at: 1 },
    { id: "b", title: "B", at: 3 },
    { id: "", title: "Nope" },
  ]);
  assert.deepEqual(list.map((row) => row.id), ["b", "a"]);
  assert.equal(list[1].title, "A");
});

test("add and remove update the mute list", () => {
  let list = addUnrecommended([], { id: "x", title: "X", cover: "c" }, 10);
  assert.equal(isUnrecommended(list, "x"), true);
  list = addUnrecommended(list, { id: "y", title: "Y" }, 11);
  assert.deepEqual(list.map((row) => row.id), ["y", "x"]);
  list = removeUnrecommended(list, "x");
  assert.equal(isUnrecommended(list, "x"), false);
  assert.deepEqual(list.map((row) => row.id), ["y"]);
});

test("filterRecommended drops muted ids from Home lists", () => {
  const list = addUnrecommended([], { id: "hide", title: "Hide" }, 1);
  const shows = [{ id: "keep" }, { id: "hide" }, { id: "also" }];
  assert.deepEqual(filterRecommended(shows, list).map((show) => show.id), ["keep", "also"]);
});
