import assert from "node:assert/strict";
import test from "node:test";
import { BACKUP_APP, BACKUP_KEYS, diagnostics, makeBackup, readBackup } from "../lib/backup.js";
import { KEYS } from "../lib/keys.js";
import { fuzzyFrom, kitsuLibraryUrl, mergeRows, parseKitsuPage, parseMalXml, resolveIds } from "../lib/list-import.js";

const MAL = `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
  <myinfo><user_name>someone</user_name></myinfo>
  <anime>
    <series_animedb_id>1</series_animedb_id>
    <series_title><![CDATA[Cowboy Bebop]]></series_title>
    <series_episodes>26</series_episodes>
    <my_watched_episodes>26</my_watched_episodes>
    <my_start_date>2020-03-00</my_start_date>
    <my_finish_date>2020-04-12</my_finish_date>
    <my_status>Completed</my_status>
  </anime>
  <anime>
    <series_animedb_id>5114</series_animedb_id>
    <series_title><![CDATA[Fullmetal Alchemist: Brotherhood &amp; more]]></series_title>
    <series_episodes>64</series_episodes>
    <my_watched_episodes>10</my_watched_episodes>
    <my_start_date>0000-00-00</my_start_date>
    <my_finish_date>0000-00-00</my_finish_date>
    <my_status>On-Hold</my_status>
  </anime>
  <anime>
    <series_animedb_id>9</series_animedb_id>
    <series_title>Weird</series_title>
    <my_status>Something else</my_status>
  </anime>
  <anime>
    <series_animedb_id>21</series_animedb_id>
    <series_title>One Piece</series_title>
    <my_watched_episodes>0</my_watched_episodes>
    <my_status>6</my_status>
  </anime>
</myanimelist>`;

test("a MyAnimeList export becomes AniList statuses and dates; unknown statuses are skipped", () => {
  const rows = parseMalXml(MAL);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    title: "Cowboy Bebop", malId: 1, kitsuId: null, anilistId: null, status: "COMPLETED", progress: 26, episodes: 26,
    startedAt: { year: 2020, month: 3, day: null }, completedAt: { year: 2020, month: 4, day: 12 },
  });
  assert.equal(rows[1].title, "Fullmetal Alchemist: Brotherhood & more");
  assert.equal(rows[1].status, "PAUSED");
  assert.equal(rows[2].status, "PLANNING");
  assert.deepEqual(parseMalXml("<html>not a list</html>"), []);
});

test("dates: MAL's zeros mean unknown", () => {
  assert.equal(fuzzyFrom("0000-00-00"), null);
  assert.deepEqual(fuzzyFrom("2019-00-00"), { year: 2019, month: null, day: null });
  assert.deepEqual(fuzzyFrom("2021-06-01T12:00:00.000Z"), { year: 2021, month: 6, day: 1 });
});

test("a Kitsu library page reads statuses and mapped ids", () => {
  const page = {
    data: [
      { id: "10", type: "libraryEntries", attributes: { status: "current", progress: 5, startedAt: "2024-01-02T00:00:00.000Z", finishedAt: null }, relationships: { anime: { data: { type: "anime", id: "7442" } } } },
      { id: "11", type: "libraryEntries", attributes: { status: "planned", progress: 0 }, relationships: { anime: { data: { type: "anime", id: "1" } } } },
      { id: "12", type: "libraryEntries", attributes: { status: "weird" }, relationships: { anime: { data: { type: "anime", id: "1" } } } },
    ],
    included: [
      { id: "7442", type: "anime", attributes: { canonicalTitle: "Attack on Titan", episodeCount: 25 }, relationships: { mappings: { data: [{ type: "mappings", id: "m1" }, { type: "mappings", id: "m2" }] } } },
      { id: "1", type: "anime", attributes: { canonicalTitle: "Cowboy Bebop", episodeCount: 26 }, relationships: { mappings: { data: [] } } },
      { id: "m1", type: "mappings", attributes: { externalSite: "myanimelist/anime", externalId: "16498" } },
      { id: "m2", type: "mappings", attributes: { externalSite: "anilist/anime", externalId: "16498" } },
    ],
    links: { next: "https://kitsu.app/api/edge/library-entries?page[offset]=500" },
  };
  const { rows, more } = parseKitsuPage(page);
  assert.equal(more, true);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].anilistId, 16498);
  assert.equal(rows[1].status, "PLANNING");
  assert.match(kitsuLibraryUrl(42, 500), /filter%5BuserId%5D=42.*page%5Boffset%5D=500/);
});

test("ids: master list Kitsu link, then AniList id, then MAL; unresolved wait", () => {
  const master = [{ a: 100, mal: 1, kitsu: 1 }, { a: 200, mal: 5114, kitsu: 3936 }];
  const { resolved, missing } = resolveIds([
    { title: "A", malId: 1, kitsuId: null },
    { title: "B", malId: 5114, kitsuId: null },
    { title: "C", malId: 777, kitsuId: null },
    { title: "D", malId: null, kitsuId: 3936, anilistId: 999 },
  ], master);
  assert.deepEqual(resolved.map((row) => row.anilistId), [100, 200, 200]);
  assert.deepEqual(missing.map((row) => row.title), ["C"]);
});

test("the same show listed twice keeps the furthest along", () => {
  const merged = mergeRows([
    { anilistId: 1, status: "PLANNING", progress: 0 },
    { anilistId: 1, status: "CURRENT", progress: 3 },
    { anilistId: 1, status: "COMPLETED", progress: 12 },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "COMPLETED");
  assert.equal(merged[0].progress, 12);
});

test("backups never carry sign-ins, and restores only write known keys", () => {
  assert.equal(BACKUP_APP, "kivori-sekai");
  assert.ok(!BACKUP_KEYS.includes(KEYS.session));
  assert.ok(!BACKUP_KEYS.includes(KEYS.crunchyrollAuth));
  const file = makeBackup({
    [KEYS.session]: { token: "secret" },
    [KEYS.matches]: { a: 1 },
    [KEYS.settings]: { hiddenSites: ["Hulu"], setupDone: true },
  }, { version: "1.0.0", now: 0 });
  assert.equal(JSON.stringify(file).includes("secret"), false);
  assert.equal(file.app, "kivori-sekai");
  const back = readBackup(JSON.stringify({
    ...file,
    data: { ...file.data, [KEYS.session]: { token: "x" }, junk: 1, [KEYS.importLog]: "nope" },
  }));
  assert.deepEqual(Object.keys(back.data).sort(), [KEYS.matches, KEYS.settings].sort());
  assert.throws(() => readBackup("{}"), /isn't a Kivori Sekai backup/);
  assert.throws(() => readBackup("not json"), /isn't a Kivori Sekai backup/);
  assert.throws(() => readBackup(JSON.stringify({ ...file, backup: 99 })), /newer version/);
  const legacy = readBackup(JSON.stringify({ ...file, app: "crunchilist-search" }));
  assert.ok(legacy.data[KEYS.matches]);
});

test("diagnostics list connections without account names", () => {
  const text = diagnostics({
    version: "1.0.0", userAgent: "UA", connected: ["netflix"], anilist: { connected: true, name: "PrivateName" },
    idMap: { count: 10, updated: "2026-10-01" }, settings: { hiddenSites: [], setupDone: true }, job: { phase: "idle" },
    log: [{ at: 0, service: "mal", outcome: "applied", count: 3, stats: { matched: 3, dropped: 1 } }],
    checkpoints: { netflix: [{ end: true }] }, pendingCount: 2, granted: ["https://www.netflix.com/*"],
  });
  assert.match(text, /AniList: connected/);
  assert.match(text, /Sites allowed: www\.netflix\.com/);
  assert.match(text, /mal applied: 3 sent/);
  assert.equal(text.includes("PrivateName"), false);
});
