import assert from "node:assert/strict";
import test from "node:test";
import { mainSeasons, resolveEpisode, seasonForAbsolute, watchUrl } from "../lib/episode-link.js";

const ep = (id, number, slug = `ep-${number}`) => ({ id, episode_number: number, sequence_number: number, slug_title: slug });

function fakeApi(seasons, episodes) {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    if (/\/series\/[^/]+\/seasons/.test(url)) return { data: seasons };
    const id = /\/seasons\/([^/]+)\/episodes/.exec(url)?.[1];
    return { data: episodes[id] || [] };
  };
  return { fetchJson, calls };
}

test("dub seasons collapse to the original-language season for each season number", () => {
  const picked = mainSeasons({ data: [
    { id: "S1-EN", season_sequence_number: 1, title: "Show (English Dub)", audio_locale: "en-US" },
    { id: "S1", season_sequence_number: 1, title: "Show", audio_locale: "ja-JP", is_subbed: true },
    { id: "S2", season_sequence_number: 2, title: "Show Season 2", audio_locale: "ja-JP" },
  ] });
  assert.deepEqual(picked.map((season) => season.id), ["S1", "S2"]);
});

test("watch links use the episode id and a cleaned slug", () => {
  assert.equal(watchUrl({ id: "GABC123", slug_title: "the-journeys-end" }), "https://www.crunchyroll.com/watch/GABC123/the-journeys-end");
  assert.equal(watchUrl({ id: "GABC123", slug_title: "<bad>" }), "https://www.crunchyroll.com/watch/GABC123/bad");
  assert.equal(watchUrl(null), null);
});

test("season 2 episode 4 opens that exact episode", async () => {
  const api = fakeApi(
    [{ id: "S1", season_sequence_number: 1, number_of_episodes: 28 }, { id: "S2", season_sequence_number: 2, number_of_episodes: 10 }],
    { S1: [ep("A1", 1)], S2: [ep("B3", 3), ep("B4", 4, "season-two-four")] },
  );
  const result = await resolveEpisode(api.fetchJson, { seriesId: "GG5H5XQX4", season: 1, episode: 4 });
  assert.deepEqual(result, { url: "https://www.crunchyroll.com/watch/B4/season-two-four", exact: true });
  assert.equal(api.calls.length, 2);
});

test("absolute numbering across Crunchyroll seasons finds the right arc", async () => {
  const seasons = [
    { id: "EB", season_sequence_number: 1, number_of_episodes: 61 },
    { id: "AL", season_sequence_number: 2, number_of_episodes: 74 },
    { id: "SK", season_sequence_number: 3, number_of_episodes: 60 },
  ];
  assert.deepEqual(seasonForAbsolute(seasons, 140), { index: 2, offset: 5 });
  const api = fakeApi(seasons, { EB: [ep("E1", 1)], SK: [ep("K140", 140)] });
  const result = await resolveEpisode(api.fetchJson, { seriesId: "OP", season: 0, episode: 140 });
  assert.equal(result.url, "https://www.crunchyroll.com/watch/K140/ep-140");
});

test("episodes without numbers fall back to their position in the season", async () => {
  const api = fakeApi([{ id: "S1", season_sequence_number: 1, number_of_episodes: 3 }], { S1: [{ id: "X1", slug_title: "a" }, { id: "X2", slug_title: "b" }, { id: "X3", slug_title: "c" }] });
  assert.equal((await resolveEpisode(api.fetchJson, { seriesId: "S", episode: 2 })).url, "https://www.crunchyroll.com/watch/X2/b");
});

test("an unknown episode opens the series page instead", async () => {
  const api = fakeApi([{ id: "S1", season_sequence_number: 1, number_of_episodes: 12 }], { S1: [ep("A1", 1)] });
  assert.deepEqual(await resolveEpisode(api.fetchJson, { seriesId: "SER", episode: 40 }), { url: "https://www.crunchyroll.com/series/SER", exact: false });
});
