import assert from "node:assert/strict";
import test from "node:test";
import { classifyAvailability } from "../lib/availability.js";
import { applyObservations, seasonKey } from "../lib/season.js";
import { defaultState } from "../lib/state.js";

test("a watch record stays after the title leaves the page and is eligible when seen again", () => {
  let state = applyObservations(defaultState(), {
    kind: "browse",
    seasons: [],
    sightings: [{ seriesId: "G1", title: "Alpha", url: "https://www.crunchyroll.com/series/G1/alpha" }],
  }, 1000);
  state = applyObservations(state, {
    kind: "series",
    seasons: [{
      seriesId: "G1",
      seasonSlug: "cour-1",
      seasonNumber: 1,
      seriesTitle: "Alpha",
      seasonTitle: "Season 1",
    }],
    sightings: [{ seriesId: "G1", title: "Alpha", url: "https://www.crunchyroll.com/series/G1/alpha" }],
  }, 1500);

  const gone = {
    kind: "browse",
    seasons: [],
    sightings: [{ seriesId: "G2", title: "Beta", url: "https://www.crunchyroll.com/series/G2/beta" }],
  };
  state = applyObservations(state, gone, 2000);
  const key = seasonKey("G1", "cour-1");
  assert.equal(state.seasons[key].seriesTitle, "Alpha");
  assert.equal(state.seasons[key].lastSeenAt, 1500);
  assert.equal(state.sightings.G1.lastSeenAt, 1500);

  const absent = classifyAvailability(state, gone);
  assert.ok(absent.retained.includes("G1"));
  assert.ok(absent.eligible.includes("G2"));
  assert.ok(!absent.eligible.includes("G1"));

  const back = {
    kind: "browse",
    seasons: [],
    sightings: [{ seriesId: "G1", title: "Alpha", url: "https://www.crunchyroll.com/series/G1/alpha" }],
  };
  state = applyObservations(state, back, 3000);
  assert.equal(state.sightings.G1.lastSeenAt, 3000);
  assert.equal(state.seasons[key].lastSeenAt, 1500);
  const present = classifyAvailability(state, back);
  assert.ok(present.eligible.includes("G1"));
  assert.ok(present.retained.includes("G2"));
});
