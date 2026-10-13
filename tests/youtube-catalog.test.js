import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyLink,
  completeness,
  countryOf,
  coveredIds,
  expectedEpisodes,
  feedDue,
  inOrder,
  normalizeFeed,
  playableIn,
  videoFlags,
  watchUrl,
  youtubeItems,
} from "../lib/youtube-catalog.js";

const ids = (count, start = 1, seconds = 1420, title = (n) => `Episode ${n}`) => Array.from({ length: count }, (_, i) => ({
  id: `vid${String(start + i).padStart(8, "0")}`,
  title: title(start + i),
  seconds,
}));

const facts = (extra = {}) => ({ format: "TV", releaseStatus: "FINISHED", episodes: 12, duration: 24, ...extra });

test("a finished season is complete only with every episode", () => {
  assert.equal(completeness(ids(12), facts()).complete, true);
  const short = completeness(ids(11), facts());
  assert.equal(short.complete, false);
  assert.deepEqual(short.missing, [12]);
  assert.match(short.reason, /missing episode 12 of 12/);
});

test("gaps in episode numbers are caught even when the count looks right", () => {
  const videos = [...ids(5), ...ids(6, 7), { id: "zzzzzzzzzzz", title: "Special", seconds: 1400 }];
  const result = completeness(videos, facts());
  assert.equal(result.complete, false);
  assert.deepEqual(result.missing, [6]);
});

test("a playlist that packs two seasons for one AniList entry is rejected", () => {
  assert.match(completeness(ids(22), facts({ episodes: 15 })).reason, /22 uploads for 15/);
});

test("a second season that keeps counting (13 to 24) is complete", () => {
  assert.equal(completeness(ids(12, 13), facts()).complete, true);
});

test("an airing show needs every aired episode, with one episode of upload lag", () => {
  const airing = facts({ releaseStatus: "RELEASING", episodes: null, aired: 8 });
  assert.equal(expectedEpisodes(airing), 8);
  assert.equal(completeness(ids(8), airing).complete, true);
  assert.equal(completeness(ids(7), airing).complete, true);
  const gap = completeness([...ids(3), ...ids(4, 5)], airing);
  assert.equal(gap.complete, false);
  assert.deepEqual(gap.missing, [4]);
  assert.equal(completeness([...ids(3), ...ids(3, 5)], airing).complete, false);
});

test("uploads with no episode numbers are judged on the count", () => {
  const plain = ids(12, 1, 1420, (n) => `The adventure continues part ${String.fromCharCode(64 + n)}`);
  assert.equal(completeness(plain, facts()).complete, true);
  assert.match(completeness(plain.slice(0, 10), facts()).reason, /10 of 12/);
  assert.match(completeness([...plain, ...ids(4, 30, 1420, () => "Bonus clip")], facts()).reason, /mixed seasons or extras/);
});

test("digests and clips shorter than AniList's episode length are not complete", () => {
  const result = completeness(ids(12, 1, 300), facts());
  assert.equal(result.complete, false);
  assert.match(result.reason, /5 min against 24 min/);
  assert.equal(completeness([{ id: "movie000001", title: "The Movie", seconds: 3600 }], facts({ format: "MOVIE", duration: 110 })).complete, false);
  assert.equal(completeness([{ id: "movie000001", title: "The Movie", seconds: 6500 }], facts({ format: "MOVIE", duration: 110 })).complete, true);
});

test("without an AniList count a show needs a few uploads", () => {
  assert.equal(completeness(ids(2), facts({ episodes: null })).complete, false);
  assert.equal(completeness(ids(3), facts({ episodes: null })).complete, true);
});

test("region rules follow YouTube's allowed and blocked lists", () => {
  assert.equal(playableIn({ allow: ["PH", "SG"] }, "US"), false);
  assert.equal(playableIn({ allow: ["PH", "US"] }, "US"), true);
  assert.equal(playableIn({ block: ["US"] }, "US"), false);
  assert.equal(playableIn({}, "US"), true);
  assert.equal(countryOf("en-GB"), "GB");
  assert.equal(countryOf(""), "US");
});

test("links are told apart: playlists, videos, channels and others", () => {
  assert.deepEqual(classifyLink("https://www.youtube.com/playlist?list=PLabcdefghijk"), { kind: "playlist", id: "PLabcdefghijk" });
  assert.deepEqual(classifyLink("https://youtu.be/dQw4w9WgXcQ"), { kind: "video", id: "dQw4w9WgXcQ" });
  assert.deepEqual(classifyLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghijk"), { kind: "playlist", id: "PLabcdefghijk" });
  assert.equal(classifyLink("https://www.youtube.com/@MuseAsia").kind, "channel");
  assert.equal(classifyLink("https://example.com/watch?v=dQw4w9WgXcQ").kind, "broken");
  assert.equal(classifyLink("not a url").kind, "broken");
});

test("upload titles flag extras, other languages and limited-time uploads", () => {
  assert.deepEqual(videoFlags("Official Trailer"), ["extra"]);
  assert.deepEqual(videoFlags("Episodio 3 | Capítulo"), ["not English"]);
  assert.deepEqual(videoFlags("第1話「始まり」"), ["Japanese or Chinese only"]);
  assert.deepEqual(videoFlags("第1話 (English Sub)"), []);
  assert.deepEqual(videoFlags("Episode 1 [limited time]"), ["limited time"]);
});

test("playlists listed newest first are flipped", () => {
  assert.deepEqual(inOrder(ids(3).reverse()).map((video) => video.title), ["Episode 1", "Episode 2", "Episode 3"]);
});

const feedShow = (anilistId, extra = {}) => ({
  anilistId,
  title: `Show ${anilistId}`,
  channel: "Official",
  playlist: "PLabcdefghijk",
  url: "https://www.youtube.com/playlist?list=PLabcdefghijk",
  facts: { titles: { english: `Show ${anilistId}` }, genres: ["Action"], tags: ["Mecha"], format: "TV", releaseStatus: "FINISHED", episodes: 3, duration: 24, popularity: 50000, cover: "https://s4.anilist.co/c.jpg", relations: [] },
  videos: ids(3),
  ...extra,
});

test("the feed is cleaned: bad ids, unsafe urls and duplicates are dropped", () => {
  const feed = normalizeFeed({
    version: 1,
    builtAt: "2026-10-12T00:00:00.000Z",
    shows: [
      feedShow(1),
      feedShow(1),
      { ...feedShow(2), facts: { ...feedShow(2).facts, cover: "javascript:alert(1)" }, url: "https://evil.example/x" },
      { ...feedShow(3), videos: [{ id: "<script>", title: "x" }] },
      { anilistId: "4" },
    ],
  });
  assert.deepEqual(feed.shows.map((show) => show.anilistId), [1, 2]);
  assert.equal(feed.shows[1].facts.cover, "");
  assert.equal(feed.shows[1].url, `https://www.youtube.com/watch?v=${ids(1)[0].id}`);
  assert.deepEqual(normalizeFeed(null).shows, []);
});

test("Crunchyroll wins: covered shows and their linked seasons stay out", () => {
  const feed = normalizeFeed({
    shows: [
      feedShow(10),
      feedShow(20),
      feedShow(30, { facts: { ...feedShow(30).facts, relations: [{ type: "PREQUEL", anilistId: 5 }] } }),
      feedShow(40),
    ],
  });
  const covered = coveredIds([5, 20], (id) => (id === 5 ? [6] : []));
  assert.deepEqual([...covered].sort((a, b) => a - b), [5, 6, 20]);
  const items = youtubeItems(feed, { country: "US", covered });
  assert.deepEqual(items.map((item) => item.id), ["yt-10", "yt-40"]);
  const [first] = items;
  assert.equal(first.source, "youtube");
  assert.equal(first.hit.kind, "hit");
  assert.equal(first.hit.anilistId, 10);
  assert.deepEqual(first.hit.tags, ["Mecha"]);
  assert.equal(first.youtube.expected, 3);
});

test("a show incomplete in the viewer's country is left out there", () => {
  const blocked = feedShow(50, { videos: ids(3).map((video, i) => (i === 2 ? { ...video, allow: ["PH"] } : video)) });
  const feed = normalizeFeed({ shows: [blocked] });
  assert.equal(youtubeItems(feed, { country: "US" }).length, 0);
  assert.equal(youtubeItems(feed, { country: "PH" }).length, 1);
});

test("the feed is fetched twice a day, and retried hourly after a failure", () => {
  const hour = 60 * 60 * 1000;
  assert.equal(feedDue({}, 0), true);
  assert.equal(feedDue({ fetchedAt: 1, checkedAt: 1 }, 11 * hour), false);
  assert.equal(feedDue({ fetchedAt: 1, checkedAt: 1 }, 13 * hour), true);
  assert.equal(feedDue({ fetchedAt: 1, checkedAt: 13 * hour }, 13.5 * hour), false);
  assert.equal(feedDue({ checkedAt: 1 }, 0.5 * hour), false);
  assert.equal(feedDue({ checkedAt: 1 }, 1.5 * hour), true);
  assert.equal(feedDue({ fetchedAt: 1, checkedAt: 1 }, 2, true), true);
});

test("watch links only take real video and playlist ids", () => {
  assert.equal(watchUrl("dQw4w9WgXcQ", "PLabcdefghijk"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghijk");
  assert.equal(watchUrl("dQw4w9WgXcQ", "bad list!"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(watchUrl("nope"), "");
});
