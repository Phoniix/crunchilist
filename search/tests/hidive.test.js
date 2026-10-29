import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { groupEpisodes } from "../src/lib/episode-groups.js";
import { PAGE_SIZE, hidiveEntries, hidiveRows, historyUrl, parseHidivePage } from "../src/lib/hidive-history.js";

const SEARCH = path.resolve(import.meta.dirname, "..");

const vod = (id, episode, watchedAt, watchProgress, extra = {}) => ({
  id, type: "VOD", title: `E${episode} - Title ${episode}`, description: "long text", thumbnailUrl: "https://example.invalid/x.jpg",
  duration: 1465, watchProgress, watchedAt,
  episodeInformation: { seasonNumber: 2, episodeNumber: episode, season: 19999, seasonTitle: "Season 2", seriesInformation: { id: 1271, title: "MADE IN ABYSS" } },
  ...extra,
});

// The shape hidive.com/history receives (checked against a real account), trimmed.
const PAGE = { vods: [vod(3, 3, 3_000, 1460), vod(2, 2, 2_000, 1300), vod(1, 1, 1_000, 7)], page: 1, totalResults: 30, resultsPerPage: 25, totalPages: 2 };

test("HIDIVE history: pages of 25, the most HIDIVE allows", () => {
  assert.equal(PAGE_SIZE, 25);
  assert.equal(historyUrl(3), "https://dce-frontoffice.imggaming.com/api/v2/customer/history/vod?p=3&rpp=25");
});

test("HIDIVE history: entries keep only what matching needs", () => {
  const [first] = hidiveEntries(PAGE);
  assert.deepEqual(first, { id: "3", title: "E3 - Title 3", series: "MADE IN ABYSS", seriesId: "1271", seasonId: "19999", seasonTitle: "Season 2", season: 2, episode: 3, at: 3_000, duration: 1465, position: 1460, episodic: true });
  assert.ok(!("description" in first) && !("thumbnailUrl" in first));
  assert.deepEqual(hidiveEntries({ vods: [null, { id: "x" }, { title: "no id" }] }), []);
  assert.deepEqual(hidiveEntries(null), []);
});

test("HIDIVE history: only mostly watched episodes count, grouped by season", () => {
  const rows = hidiveRows(hidiveEntries(PAGE));
  assert.deepEqual(rows.map((row) => [row.episode, row.watched]), [[3, true], [2, true], [1, false]]);
  assert.equal(rows[0].series, "MADE IN ABYSS");
  assert.equal(rows[0].season, "Season 2");
  assert.equal(rows[0].seasonNumber, 2);
  assert.equal(rows[0].anime, true);
  const [group] = groupEpisodes(rows);
  assert.deepEqual(group.episodes, [2, 3]);
});

test("HIDIVE history: a finished episode comes back without watchProgress and counts; a half-watched one doesn't", () => {
  const finished = vod(10, 1, 9_000, undefined);
  delete finished.watchProgress;
  const rows = hidiveRows(hidiveEntries({ vods: [vod(11, 2, 9_500, 713), finished] }));
  assert.deepEqual(rows.map((row) => [row.episode, row.watched]), [[2, false], [1, true]]);
});

test("HIDIVE history: a film has no episode details and counts as one", () => {
  const film = { id: 9, type: "VOD", title: "Some Film (Dubbed)", duration: 6000, watchProgress: 5900, watchedAt: 5_000 };
  const [row] = hidiveRows(hidiveEntries({ vods: [film] }));
  assert.equal(row.kind, "movie");
  assert.equal(row.series, "Some Film");
  assert.equal(row.watched, true);
});

test("HIDIVE history: more pages until the last one, and an empty page ends it", () => {
  const payload = { entries: hidiveEntries(PAGE), page: 1, totalPages: 2, totalResults: 30 };
  assert.equal(parseHidivePage(payload).more, true);
  assert.equal(parseHidivePage(payload).total, 30);
  assert.equal(parseHidivePage({ ...payload, page: 2 }).more, false);
  assert.equal(parseHidivePage({ entries: [], page: 1, totalPages: 5 }).more, false);
});

test("HIDIVE history: without totalPages, a full page keeps going and a short page ends", () => {
  const full = Array.from({ length: PAGE_SIZE }, (_, i) => vod(100 + i, i + 1, 10_000 - i, 1400));
  assert.equal(parseHidivePage({ entries: hidiveEntries({ vods: full }), page: 1 }).more, true);
  assert.equal(parseHidivePage({ entries: hidiveEntries(PAGE), page: 1 }).more, false);
});

test("the HIDIVE page script never alters a request and keeps the sign-in in the page", () => {
  const text = readFileSync(path.join(SEARCH, "src", "content", "hidive-page.js"), "utf8");
  assert.match(text, /originalFetch\.apply\(this, args\)/);
  assert.match(text, /postMessage\([^)]*location\.origin\)/);
  assert.ok(!/chrome\./.test(text), "page script has no extension access");
  assert.ok(!/postMessage\([^)]*headers/.test(text), "headers are never posted");
  assert.match(text, /event\.source !== window/);
  const bridge = readFileSync(path.join(SEARCH, "src", "content", "hidive.js"), "utf8");
  assert.match(bridge, /event\.source !== window/);
  assert.match(bridge, /event\.origin !== location\.origin/);
});
