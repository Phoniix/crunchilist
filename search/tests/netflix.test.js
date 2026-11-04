import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { checkGeneral, matchGroups } from "../src/lib/import-plan.js";
import { createMatcher } from "../src/lib/match-engine.js";
import { LIVE_ACTION_NAMES, activityRow, csvDate, groupNetflix, parseActivity, parseCsv, parseNetflixCsv, splitTitle, splitYear } from "../src/lib/netflix-history.js";
import { matchKey } from "../src/lib/remembered.js";

const feed = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "feeds", "id-map.json"), "utf8"));
const matcher = createMatcher(feed.rows);

const item = (fields) => ({ movieID: 1, date: 1_700_000_000_000, bookmark: 1400, duration: 1440, ...fields });

test("without season fields the title still gives season and episode; a cleared bookmark counts as finished", () => {
  const row = activityRow({ movieID: 9, date: 5, series: 7, seriesTitle: "Attack on Titan", title: "Attack on Titan: Season 2: Beast Titan" });
  assert.equal(row.season, "Season 2");
  assert.equal(row.episodeKey, "beast titan");
  assert.equal(activityRow({ movieID: 9, date: 5, series: 7, seriesTitle: "Pluto", title: "Episode 1" }).season, "");
  assert.equal(activityRow(item({ title: "Done", bookmark: 0 })).watched, true);
  assert.equal(activityRow(item({ title: "Done", bookmark: -1 })).watched, true);
});

test("an activity item becomes an episode of a season, or a film", () => {
  const episode = activityRow(item({ series: 80, seriesTitle: "Hunter X Hunter (2011)", seasonDescriptor: "Season 2", episodeTitle: "Hunter x Exam" }));
  assert.equal(episode.kind, "episode");
  assert.equal(episode.series, "Hunter X Hunter");
  assert.equal(episode.year, 2011);
  assert.equal(episode.season, "Season 2");
  assert.equal(episode.seasonNumber, 2);
  assert.equal(episode.watched, true);
  assert.equal(activityRow(item({ series: 80, seriesTitle: "Devilman Crybaby", seasonDescriptor: "Limited Series", episodeTitle: "I Need You" })).season, "", "generic descriptors are no season");
  const film = activityRow(item({ title: "Your Name.", videoTitle: "Your Name." }));
  assert.equal(film.kind, "movie");
  assert.equal(film.series, "Your Name.");
  assert.equal(activityRow(item({ title: "Short", bookmark: 100, duration: 1440 })).watched, false, "a few minutes isn't watched");
  assert.equal(activityRow(item({ title: "No bookmark", bookmark: undefined })).watched, true);
  assert.equal(activityRow(null), null);
});

test("activity paging follows the history size Netflix reports", () => {
  const page = { viewedItems: [item({ title: "A" }), item({ title: "B" })], vhSize: 5 };
  assert.equal(parseActivity(page, 0).more, true);
  assert.equal(parseActivity(page, 3).more, false);
  assert.equal(parseActivity({ viewedItems: [], vhSize: 5 }, 0).more, false);
  assert.equal(parseActivity({ viewedItems: [item({ title: "A" })] }, 0).more, true, "unknown size keeps going until a page is empty");
  assert.equal(parseActivity(null).count, 0);
});

test("CSV cells handle quotes, commas, doubled quotes and Windows line ends", () => {
  assert.deepEqual(parseCsv('\uFEFFTitle,Date\r\n"Show: Season 1: ""Hi"", there",1/2/24\r\n\r\nFilm,3/4/24'), [["Title", "Date"], ['Show: Season 1: "Hi", there', "1/2/24"], ["Film", "3/4/24"]]);
});

test("CSV dates read month first, switch when the first number can't be a month, and accept year first", () => {
  assert.equal(new Date(csvDate("1/2/24")).getMonth(), 0);
  assert.equal(new Date(csvDate("1/2/24")).getDate(), 2);
  assert.equal(new Date(csvDate("25/12/2023")).getMonth(), 11);
  assert.equal(new Date(csvDate("2023-12-25")).getDate(), 25);
  assert.equal(csvDate("31/31/23"), 0);
  assert.equal(csvDate("yesterday"), 0);
});

test("CSV titles split into show, season and episode; a lone colon only means a show when it repeats", () => {
  assert.deepEqual(splitTitle("Attack on Titan: Season 2: Beast Titan"), { series: "Attack on Titan", season: "Season 2", episode: "Beast Titan" });
  assert.deepEqual(splitTitle("Re:ZERO: Season 1: Ep"), { series: "Re:ZERO", season: "Season 1", episode: "Ep" });
  assert.deepEqual(splitTitle("Cyberpunk: Edgerunners: Limited Series: Let You Down"), { series: "Cyberpunk: Edgerunners", season: "Limited Series", episode: "Let You Down" });
  assert.deepEqual(splitTitle("Violet Evergarden: The Movie"), { movie: "Violet Evergarden: The Movie" });
  assert.deepEqual(splitTitle("Pluto: Episode 1", new Map([["Pluto", new Set(["Episode 1", "Episode 2"])]])), { series: "Pluto", season: "", episode: "Episode 1" });
  assert.deepEqual(splitYear("Hunter X Hunter (2011)"), { name: "Hunter X Hunter", year: 2011 });
  assert.deepEqual(splitYear("Monster"), { name: "Monster", year: null });
});

test("seasons count each distinct episode once, numbered in the order first played", () => {
  const rows = [
    activityRow(item({ movieID: 3, date: 300, series: 1, seriesTitle: "Show", seasonDescriptor: "Season 1", episodeTitle: "Three" })),
    activityRow(item({ movieID: 1, date: 100, series: 1, seriesTitle: "Show", seasonDescriptor: "Season 1", episodeTitle: "One" })),
    activityRow(item({ movieID: 1, date: 500, series: 1, seriesTitle: "Show", seasonDescriptor: "Season 1", episodeTitle: "One" })),
    activityRow(item({ movieID: 2, date: 200, series: 1, seriesTitle: "Show", seasonDescriptor: "Season 1", episodeTitle: "Two", bookmark: 10 })),
  ];
  const [group] = groupNetflix(rows);
  assert.deepEqual(group.episodes, [1, 2]);
  assert.deepEqual(group.played, { 1: 100, 2: 300 });
  assert.equal(group.lastPlayed, 300);
});

// From a real Netflix history: what Netflix says about each show decides.
function runActivity(items) {
  const groups = groupNetflix(items.map(activityRow).filter(Boolean)).map((group) => ({ ...group, service: "netflix", key: matchKey("netflix", group.seriesId, group.seasonId) }));
  return matchGroups(groups, (group) => checkGeneral(matcher, group, matcher.match(group), LIVE_ACTION_NAMES), { dropUnmatched: true });
}
const show = (seriesTitle, season, count, info) => Array.from({ length: count }, (_, index) => ({ movieID: 1000 + index, date: 1_700_000_000_000 + index, series: 1, seriesTitle, seasonDescriptor: season, episodeTitle: `Ep ${index + 1}`, ...info }));
const film = (title, info) => [{ movieID: 5, date: 1_700_000_000_000, title, videoTitle: title, ...info }];

test("Netflix's genres and years keep western titles with anime names out", () => {
  const notAnime = (year) => ({ showYear: year, genres: ["Sci-Fi Movies", "Action & Adventure"] });
  const { watched, pending } = runActivity([
    ...film("Dune", notAnime(2021)), ...film("Annie", notAnime(2014)), ...film("Blade", notAnime(1998)),
    ...film("RoboCop", notAnime(2014)), ...film("Elysium", notAnime(2013)),
    ...show("Supernatural", "Season 7", 23, notAnime(2005)), ...show("Friends", "Season 9", 22, notAnime(1994)),
  ]);
  assert.deepEqual(watched, []);
  assert.deepEqual(pending, []);
});

test("live-action-shared names still need a pick when Netflix files them without an Anime genre", () => {
  const liveActionGenres = (year) => ({ showYear: year, genres: ["TV Dramas", "Action & Adventure"] });
  const { watched, pending, dropped, droppedNames } = runActivity([
    ...show("ONE PIECE", "Season 1", 2, liveActionGenres(2023)),
    ...show("The Flash", "Season 1", 2, liveActionGenres(2014)),
  ]);
  assert.deepEqual(watched, []);
  assert.ok(pending.find((item) => /one piece/i.test(item.input.series)), "One Piece waits for a pick even without Anime genre");
  assert.ok(!droppedNames.includes("ONE PIECE") && !droppedNames.includes("One Piece"));
  assert.ok(dropped >= 1 && droppedNames.some((name) => /flash/i.test(name)), "The Flash stays skipped");
});

test("without genres, the year still has to line up", () => {
  const yearOnly = (year) => ({ showYear: year });
  const { watched } = runActivity([...film("Dune", yearOnly(2021)), ...film("Annie", yearOnly(2014)), ...show("Blade", "", 1, yearOnly(2006))]);
  assert.deepEqual(watched, []);
});

test("anime Netflix files under anime, or with a matching year, goes through", () => {
  const anime = (year) => ({ showYear: year, genres: ["Anime Series", "Japanese TV Shows"] });
  const { watched } = runActivity([
    ...show("VINLAND SAGA", "Season 1", 3, anime(2019)),
    ...show("Ouran High School Host Club", "", 26, { showYear: 2006 }),
    ...show("Puella Magi Madoka Magica", "", 2, anime(2011)),
    ...film("Redline", { showYear: 2009 }),
  ]);
  const ids = new Set(watched.map((part) => part.anilistId));
  for (const id of [101348, 853, 9756, 6675]) assert.ok(ids.has(id), `missing ${id}`);
});

test("shows Netflix calls anime are never dropped: offered by name, or kept for a pasted link", () => {
  const anime = (year) => ({ showYear: year, genres: ["Anime Series"] });
  const { watched, pending, dropped } = runActivity([
    ...show("A.I.C.O.", "A.I.C.O.", 12, anime(2018)),
    ...film("Little Witch Academia: The Enchanted...", { showYear: 2015, genres: ["Anime Features"] }),
    ...show("My Daemon", "My Daemon", 13, anime(2023)),
    ...show("Transformers: War for Cybertron: Siege", "Siege", 6, anime(2020)),
  ]);
  assert.equal(watched.length, 0);
  assert.equal(dropped, 0);
  const by = Object.fromEntries(pending.map((item) => [item.input.series, item]));
  assert.ok(by["A.I.C.O."].candidates.includes(99725));
  assert.ok(by["Little Witch Academia: The Enchanted..."].candidates.includes(19489));
  assert.deepEqual(by["My Daemon"].candidates, []);
  assert.match(by["My Daemon"].reason, /Paste its AniList link/);
  assert.ok(by["Transformers: War for Cybertron: Siege"]);
});

// End to end with the real master list: a mixed Netflix file.
const CSV = [
  "Title,Date",
  "Attack on Titan: Season 2: Beast Titan,3/1/24",
  "Attack on Titan: Season 2: I'm Home,3/2/24",
  "Breaking Bad: Season 1: Pilot,2/1/24",
  "One Piece: Season 1: Romance Dawn,1/5/24",
  "Hunter X Hunter (2011): Season 2: Wish x And x Promise,1/1/24",
  "Your Name.,12/24/23",
  "Cyberpunk: Edgerunners: Limited Series: Let You Down,12/1/23",
].join("\n");

function run(csv) {
  const groups = groupNetflix(parseNetflixCsv(csv)).map((group) => ({ ...group, service: "netflix", key: matchKey("netflix", group.seriesId, group.seasonId) }));
  return matchGroups(groups, (group) => checkGeneral(matcher, group, matcher.match(group), LIVE_ACTION_NAMES), { dropUnmatched: true });
}

test("a Netflix file: anime is matched, live-action names wait, mis-split seasons are offered, the rest is dropped", () => {
  const { watched, pending, dropped } = run(CSV);
  const byId = Object.fromEntries(watched.map((part) => [part.anilistId, part.progress]));
  assert.equal(byId[20958], 2, "Attack on Titan Season 2");
  assert.equal(byId[21519], 1, "Your Name.");
  assert.equal(byId[120377], 1, "Cyberpunk: Edgerunners");
  const onePiece = pending.find((item) => item.input.series === "One Piece");
  assert.ok(onePiece, "One Piece waits for a pick");
  assert.equal(onePiece.suggested, 21);
  assert.match(onePiece.reason, /live-action/);
  const hunter = pending.find((item) => item.input.series === "Hunter X Hunter");
  assert.ok(hunter, "Hunter x Hunter is offered by name");
  assert.equal(hunter.candidates[0], 11061);
  assert.equal(dropped, 1, "Breaking Bad");
});
