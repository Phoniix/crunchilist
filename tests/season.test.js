import assert from "node:assert/strict";
import test from "node:test";
import { buildCandidates } from "../lib/candidates.js";
import { recommend } from "../lib/recommend.js";
import {
  applyObservations,
  seasonKey,
  seriesCardDecision,
  setRecordStatus,
} from "../lib/season.js";
import { defaultState } from "../lib/state.js";

function season(slug, number) {
  return {
    seriesId: "S",
    seasonSlug: slug,
    seasonNumber: number,
    seriesTitle: "Show",
    seasonTitle: `Season ${number}`,
    episodeCount: 12,
    url: `https://www.crunchyroll.com/series/S/${slug}`,
  };
}

test("season 1 finishing does not hide season 2", () => {
  let state = applyObservations(defaultState(), {
    kind: "series",
    seasons: [season("s1", 1), season("s2", 2)],
    sightings: [],
  }, 1000);
  const first = seasonKey("S", "s1");
  const second = seasonKey("S", "s2");
  assert.notEqual(first, second);
  state = setRecordStatus(state, first, "finished", 1500);

  const decision = seriesCardDecision("S", state.seasons);
  assert.equal(decision.hide, false);
  assert.equal(decision.mark, "in_progress");
  assert.equal(state.seasons[second].status, null);

  const ranked = recommend({
    chip: "unwatched",
    candidates: [
      { id: first, title: "Show (Season 1)", status: "finished", anilistMatched: true, episodes: 12, crEpisodes: 12, format: "TV", tags: ["Action"], genres: ["Action"], franchiseKey: "cr:S", seriesId: "S", audio: "sub", url: "https://www.crunchyroll.com/series/S/s1", movieSignal: false },
      { id: second, title: "Show (Season 2)", status: null, anilistMatched: true, episodes: 12, crEpisodes: 12, format: "TV", tags: ["Action"], genres: ["Action"], franchiseKey: "cr:S", seriesId: "S", audio: "sub", url: "https://www.crunchyroll.com/series/S/s2", movieSignal: false },
    ],
  });
  assert.deepEqual(ranked.results.map((result) => result.id), [second]);

  const browse = buildCandidates(state, {
    kind: "browse",
    seasons: [],
    sightings: [{ seriesId: "S", title: "Show", url: "https://www.crunchyroll.com/series/S/show" }],
  }, 2000);
  assert.equal(browse.length, 1);
  assert.equal(browse[0].id, second);
  assert.notEqual(browse[0].status, "finished");
});

test("a finished series-level mark hides the card, and every finished season does too", () => {
  let state = defaultState();
  state = setRecordStatus(state, "sight:ONLY", "finished", 1);
  assert.equal(seriesCardDecision("ONLY", state.seasons).hide, true);

  state = applyObservations(defaultState(), {
    seasons: [season("s1", 1), season("s2", 2)],
  }, 1);
  state = setRecordStatus(state, seasonKey("S", "s1"), "finished", 2);
  state = setRecordStatus(state, seasonKey("S", "s2"), "finished", 3);
  assert.equal(seriesCardDecision("S", state.seasons).hide, true);
});

test("new episodes update the same season instead of creating another show", () => {
  let state = applyObservations(defaultState(), {
    kind: "series",
    seasons: [season("cour-1", 1)],
  }, 1);
  const key = seasonKey("S", "cour-1");
  state = setRecordStatus(state, key, "finished", 2);
  state = applyObservations(state, {
    kind: "series",
    seasons: [{ ...season("cour-1", 1), episodeCount: 13 }],
  }, 3);
  assert.deepEqual(Object.keys(state.seasons), [key]);
  assert.equal(state.seasons[key].status, "in_progress");
  assert.equal(state.seasons[key].episodeCount, 13);

  state = setRecordStatus(state, key, "dropped", 4);
  state = applyObservations(state, {
    kind: "watch",
    seasons: [{ ...season("cour-1", 1), episodeCount: 13, watchingEpisode: 4 }],
  }, 5);
  assert.equal(state.seasons[key].status, "dropped");
  assert.equal(Object.keys(state.seasons).length, 1);
});

test("watching an episode marks that season in progress", () => {
  let state = applyObservations(defaultState(), {
    kind: "watch",
    seasons: [{ ...season("cour-1", 1), watchingEpisode: 3 }],
  }, 10);
  const record = state.seasons[seasonKey("S", "cour-1")];
  assert.equal(record.status, "in_progress");
  assert.equal(record.episodesWatched, 3);
});
