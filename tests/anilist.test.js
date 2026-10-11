import assert from "node:assert/strict";
import test from "node:test";
import {
  MISS_TTL_MS,
  anilistAuthUrl,
  anilistTokenBody,
  applyCachedIdentity,
  franchiseKeyFromMedia,
  mapListStatus,
  catalogMatchQuery,
  mediaDetailQuery,
  titlesNeedingDetail,
  applyMediaDetails,
  mediaToCacheHit,
  plainAbout,
  clearSeriesMisses,
  dropUnusedSeriesCache,
  coverFromMedia,
  localCoverStamps,
  matchesFromBatch,
  missEntry,
  parseCodeRedirect,
  readCache,
  titlesNeedingAnilist,
  saveEntryInput,
  toAnilistStatus,
} from "../lib/anilist.js";
import { messageText, parseRecommendationJson } from "../lib/llm.js";
import { applyObservations, progressOfferFor, seasonKey } from "../lib/season.js";
import { publicSettings } from "../lib/settings.js";
import { defaultState } from "../lib/state.js";

test("maps public anilist list statuses onto season statuses", () => {
  assert.equal(mapListStatus("COMPLETED"), "finished");
  assert.equal(mapListStatus("CURRENT"), "in_progress");
  assert.equal(mapListStatus("DROPPED"), "dropped");
  assert.equal(mapListStatus("PAUSED"), "in_progress");
  assert.equal(mapListStatus("PLANNING"), "plan");
  assert.equal(mapListStatus("REPEATING"), "in_progress");
});

test("a miss expires and a franchise key uses related ids without merging seasons", () => {
  const miss = missEntry(1_000);
  assert.equal(readCache({ a: miss }, "a", 1_000 + MISS_TTL_MS - 1).kind, "miss");
  assert.equal(readCache({ a: miss }, "a", 1_000 + MISS_TTL_MS), null);
  assert.equal(franchiseKeyFromMedia({
    id: 10,
    relations: {
      edges: [
        { relationType: "PREQUEL", node: { id: 4 } },
        { relationType: "SEQUEL", node: { id: 12 } },
        { relationType: "CHARACTER", node: { id: 1 } },
      ],
    },
  }), "al:4");
});

test("authorization code redirect keeps the code and reports anilist errors", () => {
  const ok = parseCodeRedirect("https://abc.chromiumapp.org/?code=abc123");
  assert.equal(ok.code, "abc123");
  assert.equal(parseCodeRedirect("https://abc.chromiumapp.org/?error=access_denied&error_description=nope").error, "nope");
  assert.match(anilistAuthUrl("123", "https://abc.chromiumapp.org/"), /response_type=code/);
  assert.equal(anilistTokenBody("123", "secret", "https://abc.chromiumapp.org/", "abc123").grant_type, "authorization_code");
  assert.equal(toAnilistStatus("finished"), "COMPLETED");
  assert.equal(toAnilistStatus("in_progress"), "CURRENT");
  assert.deepEqual(saveEntryInput({ anilistId: 9, episodeCount: 12 }, "finished"), {
    mediaId: 9,
    status: "COMPLETED",
    progress: 12,
  });
  assert.equal(saveEntryInput({ anilistId: 9 }, "dropped").progress, undefined);
});

test("public settings omit the anilist token", () => {
  const view = publicSettings({
    anilistToken: "secret",
    anilistExpiresAt: Date.now() + 60_000,
    anilistViewerName: "me",
    anilistClientId: "42",
    anilistClientSecret: "supersecret",
    apiKey: "sk-test",
  });
  assert.equal(view.anilistConnected, true);
  assert.equal(view.anilistViewerName, "me");
  assert.equal(view.hasAnilistSecret, true);
  assert.equal("anilistToken" in view, false);
  assert.equal("anilistClientSecret" in view, false);
  assert.equal("apiKey" in view, false);
  assert.equal(view.useAi, true);
  assert.equal(view.modelLabel, "gpt-4o-mini");
  assert.equal(publicSettings({}).modelLabel, "Chrome");
  assert.equal(publicSettings({ useAi: false }).useAi, false);
});

test("a connected list keeps its status when crunchyroll is further ahead", () => {
  let state = defaultState();
  state.importMeta = { username: "me", importedAt: 1, source: "account" };
  state.imports = {
    9: { anilistId: 9, listId: 3, status: "plan", progress: 0, media: { id: 9 } },
  };
  state.anilistCache = {
    "season:S|s1": { kind: "hit", anilistId: 9, franchiseKey: "al:9", cachedAt: 1 },
  };
  state = applyObservations(state, {
    kind: "watch",
    seasons: [{
      seriesId: "S",
      seasonSlug: "s1",
      seasonNumber: 1,
      seriesTitle: "Show",
      seasonTitle: "Season 1",
      episodeCount: 12,
      watchingEpisode: 4,
    }],
  }, 2);
  state = applyCachedIdentity(state, 2);
  const record = state.seasons[seasonKey("S", "s1")];
  assert.equal(record.status, "plan");
  assert.equal(record.statusSource, "anilist");
  assert.equal(record.crEpisode, 4);
  const offer = progressOfferFor(record);
  assert.equal(offer.to, 4);
  assert.equal(offer.from, 0);
  assert.equal(offer.status, "in_progress");

  state.imports[9].status = "dropped";
  state.seasons[seasonKey("S", "s1")].statusSource = null;
  state = applyCachedIdentity(state, 3);
  assert.equal(state.seasons[seasonKey("S", "s1")].status, "dropped");
  assert.equal(progressOfferFor(state.seasons[seasonKey("S", "s1")]), null);
});

test("an unsynced local mark is left in place until a forced refresh", () => {
  const state = defaultState();
  state.importMeta = { username: "me", importedAt: 1, source: "account" };
  state.imports = { 9: { anilistId: 9, listId: 3, status: "finished", progress: 12, media: { id: 9 } } };
  const key = seasonKey("S", "s1");
  state.seasons[key] = {
    key,
    seriesId: "S",
    seasonSlug: "s1",
    seriesLevel: false,
    anilistId: 9,
    status: "dropped",
    statusSource: "user",
    statusSetByUser: true,
  };
  applyCachedIdentity(state, 1);
  assert.equal(state.seasons[key].status, "dropped");
  applyCachedIdentity(state, 1, { force: true });
  assert.equal(state.seasons[key].status, "finished");
  assert.equal(state.seasons[key].statusSource, "anilist");
});

test("llm results reject ids that were not candidates", () => {
  const parsed = parseRecommendationJson(
    "```json\n{\"results\":[{\"id\":\"keep\",\"reason\":\"Short.\"},{\"id\":\"invented\",\"reason\":\"No.\"}]}\n```",
    new Set(["keep"]),
  );
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.results, [{ id: "keep", reason: "Short." }]);
  assert.equal(parseRecommendationJson("{}", ["keep"]).ok, false);
  assert.equal(messageText({ choices: [{ message: { content: "hi" } }] }), "hi");
});

test("catalog matching reuses saved covers and only asks anilist for the rest", () => {
  const frieren = {
    id: "G6NQ5DWZ6",
    title: "Frieren",
    cover: "",
  };
  const cached = {
    id: "GAAAAAAAA",
    title: "Cached Show",
    cover: "",
  };
  const missed = { id: "GBBBBBBBB", title: "Missed Show", cover: "" };
  const covered = { id: "GCCCCCCCC", title: "Covered", cover: "https://s4.anilist.co/file/have.jpg" };
  const cache = {
    [ `series:${cached.id}` ]: { kind: "hit", anilistId: 4, cover: "https://s4.anilist.co/file/cached.jpg", cachedAt: 1 },
    [ `series:${missed.id}` ]: missEntry(Date.now()),
  };
  const pending = titlesNeedingAnilist([frieren, cached, missed, covered], cache, Date.now());
  assert.deepEqual(pending.map((item) => item.id), [frieren.id]);
  const local = localCoverStamps([cached, frieren], {
    anilistCache: cache,
    imports: {
      9: { media: { id: 9, title: { english: "Frieren" }, coverImage: { large: "https://s4.anilist.co/file/frieren.jpg" } } },
    },
  }, Date.now());
  assert.equal(local.stamps[cached.id].cover, "https://s4.anilist.co/file/cached.jpg");
  assert.equal(local.stamps[frieren.id].anilistId, 9);
  assert.equal(coverFromMedia({ coverImage: { large: "http://insecure.example/a.jpg" } }), "");
  const query = catalogMatchQuery(2);
  assert.match(query, /\$s0: String/);
  assert.match(query, /\$s1: String/);
  assert.match(query, /coverImage \{ large \}/);
  const batch = matchesFromBatch([frieren, { id: "GDDDDDDDD", title: "Nope" }], {
    data: {
      p0: { media: [{ id: 9, title: { english: "Frieren" }, coverImage: { large: "https://s4.anilist.co/file/frieren.jpg" } }] },
      p1: { media: [{ id: 3, title: { english: "Something Else" } }] },
    },
  }, 50);
  assert.equal(batch.stamps[frieren.id].cover, "https://s4.anilist.co/file/frieren.jpg");
  assert.equal(batch.cacheUpdates[`series:GDDDDDDDD`].kind, "miss");
  const skipped = matchesFromBatch([{ id: "GEEEEEEEE", title: "Dropped" }], { data: {} }, 50);
  assert.equal(skipped.cacheUpdates["series:GEEEEEEEE"], undefined);
  const cleared = clearSeriesMisses({
    "series:G1": { kind: "miss" },
    "series:G2": { kind: "hit", cover: "https://s4.anilist.co/file/a.jpg" },
    "season:S|s1": { kind: "miss" },
  });
  assert.equal(cleared["series:G1"], undefined);
  assert.equal(cleared["series:G2"].kind, "hit");
  assert.equal(cleared["season:S|s1"].kind, "miss");
  const recycled = dropUnusedSeriesCache(cleared, ["G2"]);
  assert.equal(recycled["series:G2"].kind, "hit");
  assert.equal(recycled["season:S|s1"].kind, "miss");
});

test("show details keep the synopsis and cover, and leave out people and streams", () => {
  const query = mediaDetailQuery(1);
  assert.match(query, /description\(asHtml: false\)/);
  assert.match(query, /bannerImage/);
  assert.match(query, /coverImage \{ extraLarge large medium color \}/);
  for (const excluded of ["trailer", "characters", "staff", "studios", "streamingEpisodes", "airingSchedule", "externalLinks", "reviews", "recommendations"]) {
    assert.equal(query.includes(excluded), false, excluded);
  }
  const about = plainAbout("A girl finds a door. <br>~!The door eats her.!~ &amp; more.");
  assert.equal(about, "A girl finds a door. & more.");
  const hit = mediaToCacheHit({
    id: 9,
    description: "A quiet elf walks through a long life.",
    startDate: { year: 2023, month: 9, day: 29 },
    season: "FALL",
    seasonYear: 2023,
    episodes: 28,
    duration: 24,
    source: "MANGA",
    averageScore: 91,
    coverImage: { large: "https://s4.anilist.co/file/frieren.jpg" },
    bannerImage: "https://s4.anilist.co/file/banner.jpg",
    status: "FINISHED",
    relations: { edges: [{ relationType: "PREQUEL", node: { id: 3, title: { english: "Earlier" } } }] },
  }, 50);
  assert.equal(hit.detailed, true);
  assert.equal(hit.about, "A quiet elf walks through a long life.");
  assert.equal(hit.year, 2023);
  assert.equal(hit.score, 91);
  assert.equal(hit.cover, "https://s4.anilist.co/file/frieren.jpg");
  assert.equal(hit.banner, "https://s4.anilist.co/file/banner.jpg");
  assert.equal(hit.continues, undefined);
  assert.equal(hit.relations[0].title, "Earlier");
  assert.equal(mediaToCacheHit({ id: 4, title: { english: "Thin" } }, 50).detailed, false);
  const cache = { "series:G1": { kind: "hit", anilistId: 9, detailed: false } };
  assert.deepEqual(titlesNeedingDetail([{ id: "G1" }, { id: "G2" }], cache, 50), [{ id: "G1", anilistId: 9 }]);
  const updates = applyMediaDetails([{ id: "G1", anilistId: 9 }], {
    data: { m0: { id: 9, description: "Filled in.", episodes: 12 } },
  }, 60, cache);
  assert.equal(updates["series:G1"].detailed, true);
  assert.equal(updates["series:G1"].about, "Filled in.");
  assert.equal(updates["series:G1"].anilistId, 9);
});
