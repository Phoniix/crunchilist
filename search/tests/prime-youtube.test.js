import assert from "node:assert/strict";
import test from "node:test";
import { groupEpisodes, splitSeasonTitle } from "../src/lib/episode-groups.js";
import { decodeEntities, episodeNumber, extractPrimeHistory, historyUrl, parsePrimePage, primeRows } from "../src/lib/prime-history.js";
import { SERVICES, contentScriptsFor, serviceById } from "../src/lib/services.js";

const GTI = (n) => `amzn1.dv.gti.0000000${n}-aaaa-bbbb-cccc-dddddddddddd`;
const episode = (n, title, time) => ({ gti: GTI(n), titleType: "episode", time, title: { text: title }, children: [] });

// The shape of the JSON the Watch History page carries, with made-up titles and ids.
const PRIME_PAGE = {
  props: {
    profile: { currentProfileID: "amzn1.actor.person.oid.TEST" },
    widgets: [{ content: { content: {
      __type: "atv.wps#ActivityHistoryItems",
      nextToken: "abc==",
      titles: [
        { date: "May 2, 2024", titles: [
          { gti: GTI(1), titleType: "season", time: 1714650000000, title: { text: "Frieren: Beyond Journey&#39;s End: Season 1" }, children: [episode(2, "Episode 3: Killing Magic", 1714650000000), episode(3, "Episode 2: It Didn't Have to Be Magic", 1714640000000)] },
          { gti: GTI(4), titleType: "movie", time: 1714600000000, title: { text: "Your Name." }, children: [] },
        ] },
        { date: "May 1, 2024", titles: [
          { gti: GTI(1), titleType: "season", time: 1714560000000, title: { text: "Frieren: Beyond Journey&#39;s End: Season 1" }, children: [episode(5, "Episode 1: The Journey's End", 1714560000000), episode(3, "Episode 2: It Didn't Have to Be Magic", 1714550000000)] },
          { gti: GTI(6), titleType: "season", time: 1714500000000, title: { text: "Some Show Season 2" }, children: [episode(7, "The Pilot", 1714500000000), episode(8, "The Second One", 1714400000000)] },
          { gti: GTI(9), titleType: "live_event", time: 1714300000000, title: { text: "A Match" }, children: [] },
        ] },
      ],
    } } }],
  },
};
const PRIME_HTML = `<html><script id="dv-web-store-template" type="text/template">{&quot;x&quot;:1}</script>
<script type="text/template">${JSON.stringify(PRIME_PAGE)}</script></html>`;

test("Prime: history page address for each site, with the token for older pages", () => {
  assert.equal(historyUrl("https://www.amazon.com"), "https://www.amazon.com/gp/video/settings/watch-history");
  assert.equal(historyUrl("https://www.primevideo.com", "a+b=="), "https://www.primevideo.com/settings/watch-history?nextToken=a%2Bb%3D%3D");
  assert.equal(historyUrl("https://evil.example"), "");
});

test("Prime: the page's JSON is found, cleaned and paged", () => {
  const found = extractPrimeHistory(PRIME_HTML);
  assert.equal(found.days.length, 2);
  assert.equal(found.nextToken, "abc==");
  assert.equal(found.profile, "amzn1.actor.person.oid.TEST");
  assert.equal(found.days[0].titles[0].title, "Frieren: Beyond Journey's End: Season 1");
  assert.equal(extractPrimeHistory("<html>Sign in</html>"), null);
  const page = parsePrimePage(found);
  assert.equal(page.more, true);
  assert.equal(parsePrimePage({ ...found, nextToken: "" }).more, false);
  assert.deepEqual(page.rows.map((row) => row.playedAt), [...page.rows.map((row) => row.playedAt)].sort((a, b) => b - a));
});

test("Prime: seasons keep real episode numbers; unnumbered seasons count in play order; live events are left out", () => {
  const rows = primeRows(extractPrimeHistory(PRIME_HTML).days);
  assert.ok(!rows.some((row) => row.series === "A Match"));
  const groups = groupEpisodes(rows);
  const frieren = groups.find((group) => group.series === "Frieren: Beyond Journey's End");
  assert.equal(frieren.season, "Season 1");
  assert.equal(frieren.seasonNumber, 1);
  assert.deepEqual(frieren.episodes, [1, 2, 3]);
  assert.equal(frieren.played[2], 1714550000000);
  const other = groups.find((group) => group.series === "Some Show");
  assert.deepEqual(other.episodes, [1, 2]);
  assert.equal(other.played[1], 1714400000000);
  const movie = groups.find((group) => group.kind === "movie");
  assert.equal(movie.series, "Your Name.");
  assert.deepEqual(movie.episodes, [1]);
});

test("Prime: season and episode names", () => {
  assert.deepEqual(splitSeasonTitle("Vikings: Season 5"), { series: "Vikings", season: "Season 5", seasonNumber: 5 });
  assert.deepEqual(splitSeasonTitle("Vikings Season 4"), { series: "Vikings", season: "Season 4", seasonNumber: 4 });
  assert.deepEqual(splitSeasonTitle("Season 1"), { series: "Season 1", season: "", seasonNumber: null });
  assert.equal(episodeNumber("Episode 8: The Joke"), 8);
  assert.equal(episodeNumber("Ep. 12"), 12);
  assert.equal(episodeNumber("4. Something"), 4);
  assert.equal(episodeNumber("The Joke"), null);
  assert.equal(decodeEntities("Tom &amp; Jerry&#39;s &#x2014; &bogus;"), "Tom & Jerry's — &bogus;");
});

test("Prime: connecting registers its content script with the return card", () => {
  const prime = serviceById("prime");
  assert.equal(prime.imports, true);
  assert.deepEqual(contentScriptsFor(prime).map((script) => script.js[0]), ["content/prime.js", "content/return.js", "content/site-panel.js"]);
});

test("Hulu and Tubi track as you watch; YouTube and RetroCrush are not services", () => {
  assert.deepEqual(SERVICES.filter((service) => service.tracks).map((service) => service.id), ["hulu", "tubi"]);
  assert.equal(serviceById("youtube"), null);
  assert.equal(serviceById("retrocrush"), null);
  assert.equal(serviceById("hulu")?.untested, true);
});
