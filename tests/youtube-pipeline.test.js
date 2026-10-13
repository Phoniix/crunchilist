import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildFeed, playlistQuery, verify, writeFeed } from "../scripts/youtube-catalog.mjs";
import { apiSource, isoSeconds, playlistFromHtml, videoFromHtml } from "../scripts/youtube-sources.mjs";

const vid = (n, prefix = "v") => `${prefix}${String(n).padStart(10, "0")}`.slice(0, 11);

function media(id, extra = {}) {
  return {
    id,
    title: { english: `Show ${id}`, romaji: `Show ${id}` },
    format: "TV",
    status: "FINISHED",
    episodes: 3,
    duration: 24,
    popularity: 100000 - id,
    genres: ["Action"],
    tags: [{ name: "Mecha", rank: 80 }],
    description: "A story.",
    coverImage: { large: "https://s4.anilist.co/c.jpg", color: "#aabbcc" },
    relations: { edges: [] },
    externalLinks: [],
    ...extra,
  };
}

// A YouTube Data API double: playlists map to video ids, videos carry their own details.
function fakeYoutube({ playlists = {}, videos = {}, quota = false, channels = {} }) {
  const calls = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const path = parsed.pathname.split("/").pop();
    calls.push(path);
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (quota) return reply({ error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } }, 403);
    if (path === "playlistItems") {
      const list = playlists[parsed.searchParams.get("playlistId")];
      if (!list) return reply({ error: { errors: [{ reason: "playlistNotFound" }] } }, 404);
      const start = Number(parsed.searchParams.get("pageToken") || 0);
      const page = list.slice(start, start + 50);
      return reply({
        items: page.map((id) => ({ snippet: { title: videos[id]?.title || "Deleted video" }, contentDetails: { videoId: id } })),
        ...(start + 50 < list.length ? { nextPageToken: String(start + 50) } : {}),
      });
    }
    if (path === "videos") {
      const ids = parsed.searchParams.get("id").split(",");
      return reply({
        items: ids.filter((id) => videos[id]).map((id) => {
          const video = videos[id];
          return {
            id,
            snippet: { title: video.title, channelTitle: "Official Channel", liveBroadcastContent: video.live ? "upcoming" : "none" },
            contentDetails: { duration: video.duration || "PT23M40S", ...(video.region ? { regionRestriction: video.region } : {}) },
            status: { privacyStatus: video.privacy || "public", embeddable: video.embeddable !== false, uploadStatus: "processed" },
          };
        }),
      });
    }
    if (path === "channels") {
      const handle = parsed.searchParams.get("forHandle");
      return reply({ items: channels[handle] ? [{ id: `UC${handle}`, snippet: { title: handle } }] : [] });
    }
    if (path === "playlists") {
      const handle = parsed.searchParams.get("channelId").slice(2);
      return reply({ items: (channels[handle] || []).map((list) => ({ id: list.id, snippet: { title: list.title }, contentDetails: { itemCount: list.count } })) });
    }
    return reply({}, 404);
  };
  return { source: apiSource("test-key", { fetchImpl, spacing: 0 }), calls };
}

const episodes = (count, prefix = "a", extra = {}) => Object.fromEntries(Array.from({ length: count }, (_, i) => [vid(i + 1, prefix), { title: `Episode ${i + 1}`, ...extra }]));

function fakeAnilist({ discovered = [], search = {}, details = [] }) {
  const queries = [];
  return {
    queries,
    anilist: async (text, variables) => {
      queries.push(text);
      if (text.includes("licensedById_in")) return { data: { Page: { pageInfo: { hasNextPage: false }, media: variables.page === 1 ? discovered : [] } } };
      if (text.includes("id_in")) return { data: { Page: { media: details.filter((row) => variables.ids.includes(row.id)) } } };
      const data = {};
      for (const [name, value] of Object.entries(variables)) data[name.replace("s", "p")] = { media: search[value] || [] };
      return { data };
    },
  };
}

const playlistLink = (id) => [{ site: "YouTube", type: "STREAMING", url: `https://www.youtube.com/playlist?list=${id}` }];

test("a complete official playlist is accepted with its AniList facts", async () => {
  const videos = episodes(3);
  const { source } = fakeYoutube({ playlists: { PLcomplete01: Object.keys(videos) }, videos });
  const result = await verify({ media: media(1), link: { kind: "playlist", id: "PLcomplete01" } }, source);
  assert.equal(result.ok, true);
  assert.equal(result.show.videos.length, 3);
  assert.equal(result.show.facts.episodes, 3);
  assert.deepEqual(result.show.facts.tags, ["Mecha"]);
  assert.equal(result.show.channel, "Official Channel");
  assert.equal(result.show.videos[0].seconds, 1420);
});

test("a playlist missing an episode is rejected and says which one", async () => {
  const videos = episodes(3);
  delete videos[vid(2, "a")];
  const { source } = fakeYoutube({ playlists: { PLgap000001: [vid(1, "a"), vid(2, "a"), vid(3, "a")] }, videos });
  const result = await verify({ media: media(2), link: { kind: "playlist", id: "PLgap000001" } }, source);
  assert.equal(result.ok, false);
  assert.match(result.reason, /missing episode 2 of 3/);
  assert.match(result.reason, /1 private or deleted/);
  assert.deepEqual(result.missing, [2]);
});

test("first-episode-only promos, short clips, trailers and embed-blocked uploads don't pass", async () => {
  const promo = episodes(1);
  const clips = episodes(3, "c", { duration: "PT3M10S" });
  const blocked = episodes(3, "b", { embeddable: false });
  const trailer = { [vid(1, "t")]: { title: "Official Trailer" } };
  const { source } = fakeYoutube({
    playlists: { PLpromo0001: Object.keys(promo), PLclips0001: Object.keys(clips), PLblock0001: Object.keys(blocked), PLtrail0001: Object.keys(trailer) },
    videos: { ...promo, ...clips, ...blocked, ...trailer },
  });
  const check = (id, list) => verify({ media: media(id), link: { kind: "playlist", id: list } }, source);
  assert.match((await check(3, "PLpromo0001")).reason, /missing episodes 2-3 of 3/);
  assert.match((await check(4, "PLclips0001")).reason, /no usable uploads \(3 too short\)/);
  assert.match((await check(5, "PLblock0001")).reason, /3 embedding off/);
  assert.match((await check(6, "PLtrail0001")).reason, /1 extra/);
});

test("an airing show passes with every aired episode", async () => {
  const videos = episodes(5);
  const { source } = fakeYoutube({ playlists: { PLairing001: Object.keys(videos) }, videos });
  const airing = media(7, { status: "RELEASING", episodes: 12, nextAiringEpisode: { episode: 6 } });
  const result = await verify({ media: airing, link: { kind: "playlist", id: "PLairing001" } }, source);
  assert.equal(result.ok, true);
  assert.equal(result.show.facts.aired, 5);
});

test("region-locked uploads pass if complete somewhere, and keep their regions", async () => {
  const videos = episodes(3, "r", { region: { allowed: ["PH", "SG", "MY"] } });
  const { source } = fakeYoutube({ playlists: { PLregion001: Object.keys(videos) }, videos });
  const result = await verify({ media: media(8), link: { kind: "playlist", id: "PLregion001" } }, source);
  assert.equal(result.ok, true);
  assert.equal(result.check.region, "PH");
  assert.deepEqual(result.show.videos[0].allow, ["PH", "SG", "MY"]);
  const nowhere = episodes(3, "n", { region: { allowed: ["JP"] } });
  const other = fakeYoutube({ playlists: { PLjapan0001: Object.keys(nowhere) }, videos: nowhere });
  assert.equal((await verify({ media: media(9), link: { kind: "playlist", id: "PLjapan0001" } }, other.source)).ok, false);
});

test("long playlists are read past the first page", async () => {
  const videos = episodes(120);
  const { source, calls } = fakeYoutube({ playlists: { PLlong00001: Object.keys(videos) }, videos });
  const result = await verify({ media: media(10, { episodes: 120 }), link: { kind: "playlist", id: "PLlong00001" } }, source);
  assert.equal(result.ok, true);
  assert.equal(result.show.videos.length, 120);
  assert.equal(calls.filter((call) => call === "playlistItems").length, 3);
});

test("buildFeed: AniList links and channel playlists, shared playlists held back, failures reported", async () => {
  const good = episodes(3, "g");
  const shared = episodes(3, "s");
  const channelVideos = episodes(3, "h");
  const { source } = fakeYoutube({
    playlists: { PLgood00001: Object.keys(good), PLshared001: Object.keys(shared), PLchannel01: Object.keys(channelVideos) },
    videos: { ...good, ...shared, ...channelVideos },
    channels: { "@Official": [{ id: "PLchannel01", title: "Show 40 | Full Episodes", count: 3 }, { id: "PLmystery01", title: "Weekly Highlights", count: 9 }] },
  });
  const { anilist } = fakeAnilist({
    discovered: [
      media(11, { externalLinks: playlistLink("PLgood00001") }),
      media(12, { externalLinks: playlistLink("PLshared001") }),
      media(13, { externalLinks: playlistLink("PLshared001") }),
      media(14, { externalLinks: [{ site: "YouTube", type: "STREAMING", url: "https://www.youtube.com/@SomeChannel" }] }),
      media(15, { externalLinks: playlistLink("PLmissing01") }),
    ],
    search: { "Show 40": [media(40)], "Weekly Highlights": [] },
    details: [media(40)],
  });
  const result = await buildFeed({ anilist, source, channels: ["@Official"] });
  assert.deepEqual(result.shows.map((show) => show.anilistId), [11, 40]);
  const reasons = Object.fromEntries(result.rejected.map((row) => [row.anilistId, row.reason]));
  assert.match(reasons[12], /shared by 2/);
  assert.match(reasons[13], /shared by 2/);
  assert.match(reasons[14], /channel page/);
  assert.match(reasons[15], /empty or gone/);
  assert.equal(result.unmatched.length, 1);
  assert.match(result.unmatched[0].reason, /no sure AniList match/);
});

test("a used-up API quota stops the run instead of writing a half feed", async () => {
  const { source } = fakeYoutube({ quota: true });
  const { anilist } = fakeAnilist({ discovered: [media(16, { externalLinks: playlistLink("PLgood00001") })] });
  await assert.rejects(buildFeed({ anilist, source }), /quota/);
});

test("writeFeed keeps the date when nothing changed and refuses a feed that shrank badly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cl-yt-"));
  try {
    const show = (id) => ({ anilistId: id, title: `Show ${id}`, facts: {}, videos: [{ id: vid(id), title: "Episode 1", seconds: 1400 }] });
    const result = { shows: [show(1), show(2), show(3)], rejected: [{ anilistId: 9, url: "x", reason: "incomplete: missing episodes 2-3 of 3" }], unmatched: [], links: 4 };
    const first = await writeFeed(result, { out: dir, now: new Date("2026-10-01T00:00:00Z") });
    assert.equal(first.changed, true);
    const second = await writeFeed(result, { out: dir, now: new Date("2026-10-08T00:00:00Z") });
    assert.equal(second.changed, false);
    assert.equal(JSON.parse(await readFile(join(dir, "youtube.json"), "utf8")).builtAt, "2026-10-01T00:00:00.000Z");
    assert.deepEqual(second.review.reasons, { "incomplete: missing episodes N of N": 1 });
    await assert.rejects(writeFeed({ ...result, shows: [show(1)] }, { out: dir }), /wasn't saved/);
    await writeFile(join(dir, "youtube.json"), "not json");
    assert.equal((await writeFeed(result, { out: dir })).changed, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("playlist names are cleaned before matching to AniList", () => {
  assert.equal(playlistQuery("Mobile Suit Gundam: The Witch from Mercury | Full Episodes"), "Mobile Suit Gundam: The Witch from Mercury");
  assert.equal(playlistQuery("[English Sub] Spy x Family Season 2"), "Spy x Family Season 2");
  assert.equal(playlistQuery("Full Episodes | Moomin"), "Moomin");
  assert.equal(playlistQuery("Lupin III Part 5 - Episodes 1-24"), "Lupin III Part 5");
  assert.equal(playlistQuery("Full Episodes"), "");
});

test("YouTube durations and page data are read the same way the API reports them", () => {
  assert.equal(isoSeconds("PT23M40S"), 1420);
  assert.equal(isoSeconds("PT1H2M3S"), 3723);
  assert.equal(isoSeconds("P1DT1S"), 86401);
  assert.equal(isoSeconds("garbage"), 0);
  const listHtml = `<script>var ytInitialData = ${JSON.stringify({ contents: [
    { lockupViewModel: { contentId: vid(1), contentType: "LOCKUP_CONTENT_TYPE_VIDEO", metadata: { lockupMetadataViewModel: { title: { content: "Episode 1" } } }, contentImage: { thumbnailBadgeViewModel: { text: "23:40" } } } },
    { playlistVideoRenderer: { videoId: vid(2), title: { runs: [{ text: "Episode 2" }] }, lengthSeconds: "1400" } },
    { playlistVideoRenderer: { videoId: vid(3), title: { simpleText: "[Private video]" } } },
  ] })};</script>`;
  assert.deepEqual(playlistFromHtml(listHtml), [{ id: vid(1), title: "Episode 1", seconds: 1420 }, { id: vid(2), title: "Episode 2", seconds: 1400 }]);
  const watchHtml = `var ytInitialPlayerResponse = ${JSON.stringify({ playabilityStatus: { status: "OK", playableInEmbed: true }, videoDetails: { title: "Episode 1", author: "Ch", lengthSeconds: "1420" }, microformat: { playerMicroformatRenderer: { availableCountries: ["US"] } } })};`;
  assert.deepEqual(videoFromHtml(vid(1), watchHtml), { id: vid(1), title: "Episode 1", channel: "Ch", seconds: 1420, embeddable: true, public: true, live: false, allow: ["US"] });
});
