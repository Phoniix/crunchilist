import assert from "node:assert/strict";
import test from "node:test";
import { BACKUP_KEYS, diagnostics, makeBackup, readBackup } from "../src/lib/backup.js";
import { KEYS } from "../src/lib/keys.js";
import { fuzzyFrom, kitsuLibraryUrl, mergeRows, parseKitsuPage, parseMalXml, resolveIds } from "../src/lib/list-import.js";
import { listChange } from "../src/lib/safe-change.js";
import { LISTING_SITES, SERVICES, contentScriptsFor, onService, returnNote, serviceById, serviceForSite, visibleLink } from "../src/lib/services.js";
import { cleanSettings, mergeSettings } from "../src/lib/settings.js";

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
  assert.deepEqual(rows[0], { title: "Cowboy Bebop", malId: 1, kitsuId: null, anilistId: null, status: "COMPLETED", progress: 26, episodes: 26, startedAt: { year: 2020, month: 3, day: null }, completedAt: { year: 2020, month: 4, day: 12 } });
  assert.equal(rows[1].title, "Fullmetal Alchemist: Brotherhood & more");
  assert.equal(rows[1].status, "PAUSED");
  assert.equal(rows[1].startedAt, null);
  assert.equal(rows[2].status, "PLANNING");
  assert.deepEqual(parseMalXml("<html>not a list</html>"), []);
});

test("dates: MAL's zeros mean unknown", () => {
  assert.equal(fuzzyFrom("0000-00-00"), null);
  assert.deepEqual(fuzzyFrom("2019-00-00"), { year: 2019, month: null, day: null });
  assert.deepEqual(fuzzyFrom("2021-06-01T12:00:00.000Z"), { year: 2021, month: 6, day: 1 });
});

test("a Kitsu library page reads statuses and the AniList and MAL ids Kitsu maps", () => {
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
  assert.deepEqual(rows[0], { title: "Attack on Titan", malId: 16498, kitsuId: 7442, anilistId: 16498, status: "CURRENT", progress: 5, episodes: 25, startedAt: { year: 2024, month: 1, day: 2 }, completedAt: null });
  assert.equal(rows[1].status, "PLANNING");
  assert.match(kitsuLibraryUrl(42, 500), /filter%5BuserId%5D=42.*page%5Boffset%5D=500/);
});

test("ids: the master list's Kitsu link, then Kitsu's own AniList id, then the MAL id; the rest wait for an AniList lookup", () => {
  const master = [{ a: 100, mal: 1, kitsu: 1 }, { a: 200, mal: 5114, kitsu: 3936 }, { a: 300, mal: 99, kitsu: 1 }];
  const { resolved, missing } = resolveIds([
    { title: "A", malId: 1, kitsuId: null },
    { title: "B", malId: 5114, kitsuId: null },
    { title: "C", malId: 777, kitsuId: null },
    { title: "D", malId: null, kitsuId: 3936, anilistId: 999 },
    { title: "E", malId: 777, kitsuId: 5, anilistId: 555 },
  ], master);
  assert.deepEqual(resolved.map((row) => row.anilistId), [100, 200, 200, 555]);
  assert.deepEqual(missing.map((row) => row.title), ["C"]);
});

test("the same show listed twice keeps the furthest along", () => {
  const merged = mergeRows([
    { anilistId: 1, status: "PLANNING", progress: 0 },
    { anilistId: 1, status: "CURRENT", progress: 3 },
    { anilistId: 1, status: "CURRENT", progress: 7 },
    { anilistId: 2, status: "DROPPED", progress: 2 },
  ]);
  assert.deepEqual(merged.map((row) => [row.anilistId, row.status, row.progress]), [[1, "CURRENT", 7], [2, "DROPPED", 2]]);
});

const FINISHED = { episodes: 12, status: "FINISHED" };
const AIRING = { episodes: 24, status: "RELEASING" };
const theirs = (status, progress, extra = {}) => ({ status, progress, startedAt: null, completedAt: null, ...extra });

test("list import: shows missing from AniList are added as listed", () => {
  const done = listChange(null, FINISHED, theirs("COMPLETED", 0, { startedAt: { year: 2020, month: 1, day: 1 }, completedAt: { year: 2020, month: 2, day: 1 } }));
  assert.deepEqual(done.after, { status: "COMPLETED", progress: 12, startedAt: { year: 2020, month: 1, day: 1 }, completedAt: { year: 2020, month: 2, day: 1 } });
  assert.deepEqual(listChange(null, FINISHED, theirs("PLANNING", 4)).after, { status: "PLANNING", progress: 0, startedAt: null, completedAt: null });
  assert.equal(listChange(null, FINISHED, theirs("DROPPED", 3)).after.status, "DROPPED");
  const airing = listChange(null, AIRING, theirs("COMPLETED", 10));
  assert.equal(airing.after.status, "CURRENT");
  assert.equal(airing.after.progress, 10);
  assert.ok(airing.notes.length);
});

test("list import never lowers progress or overrides a status chosen on AniList", () => {
  assert.equal(listChange({ status: "CURRENT", progress: 8 }, FINISHED, theirs("CURRENT", 3)), null);
  assert.equal(listChange({ status: "COMPLETED", progress: 12 }, FINISHED, theirs("DROPPED", 2)), null);
  assert.equal(listChange({ status: "PAUSED", progress: 5 }, FINISHED, theirs("PLANNING", 0)), null);
  const kept = listChange({ status: "DROPPED", progress: 2 }, FINISHED, theirs("CURRENT", 6));
  assert.equal(kept.after.status, "DROPPED");
  assert.equal(kept.after.progress, 6);
  assert.equal(listChange({ status: "CURRENT", progress: 4 }, FINISHED, theirs("COMPLETED", 12)).after.status, "COMPLETED");
});

test("list import: Paused or Dropped elsewhere replaces Planning, and empty dates are filled", () => {
  const change = listChange({ status: "PLANNING", progress: 0 }, FINISHED, theirs("DROPPED", 3, { startedAt: { year: 2022, month: 5, day: 9 } }));
  assert.deepEqual(change.after, { status: "DROPPED", progress: 3, startedAt: { year: 2022, month: 5, day: 9 }, completedAt: null });
  const dated = listChange({ status: "COMPLETED", progress: 12, startedAt: { year: 2019 } }, FINISHED, theirs("COMPLETED", 12, { startedAt: { year: 2018, month: 1, day: 1 }, completedAt: { year: 2019, month: 3, day: 3 } }));
  assert.deepEqual(dated.after.startedAt, { year: 2019 });
  assert.deepEqual(dated.after.completedAt, { year: 2019, month: 3, day: 3 });
});

test("every connectable site has a switch, AniList site names map to services, and unbuilt sites only get the return card", () => {
  for (const service of SERVICES) assert.ok(LISTING_SITES.some((item) => item.service === service.id), service.id);
  assert.equal(serviceForSite("Amazon Prime Video")?.id, "prime");
  assert.equal(serviceForSite("tubi tv")?.id, "tubi");
  assert.equal(serviceForSite("HIDIVE")?.id, "hidive");
  assert.equal(serviceForSite("Disney Plus"), null);
  assert.equal(serviceById("retrocrush"), null);
  for (const service of SERVICES.filter((item) => item.untested)) assert.deepEqual(contentScriptsFor(service).map((script) => script.js[0]), ["content/return.js", "content/site-panel.js"]);
  assert.deepEqual(contentScriptsFor(SERVICES.find((item) => item.id === "hidive")).map((script) => script.js[0]), ["content/hidive-page.js", "content/hidive.js", "content/return.js", "content/site-panel.js"]);
  assert.deepEqual(contentScriptsFor(SERVICES.find((item) => item.id === "tubi")).map((script) => script.js[0]), ["content/tubi-page.js", "content/tubi.js", "content/return.js", "content/site-panel.js"]);
  for (const service of SERVICES) {
    assert.equal(contentScriptsFor(service).filter((script) => script.js[0] === "content/return.js").length, 1);
    assert.equal(contentScriptsFor(service).filter((script) => script.js[0] === "content/site-panel.js").length, 1);
  }
});

test("the return card belongs to the service's own pages and says what to do there", () => {
  const prime = SERVICES.find((service) => service.id === "prime");
  assert.equal(onService(prime, "https://www.amazon.com/gp/video/storefront"), true);
  assert.equal(onService(prime, "https://www.amazon.com/dp/123"), false);
  assert.equal(onService(prime, "https://www.primevideo.com.evil.example/"), false);
  assert.match(returnNote(SERVICES.find((service) => service.id === "netflix")), /profile/);
  assert.match(returnNote(prime), /profile/);
  assert.match(returnNote(SERVICES.find((service) => service.id === "hulu")), /loaded/);
  assert.match(returnNote(SERVICES.find((service) => service.id === "netflix"), "catalog"), /catalog/);
});

test("a switched-off site is hidden unless it's connected", () => {
  assert.equal(visibleLink("Netflix", []), true);
  assert.equal(visibleLink("Netflix", ["Netflix"]), false);
  assert.equal(visibleLink("Netflix", ["Netflix"], ["netflix"]), false, "connected services can be hidden too");
  assert.equal(visibleLink("Amazon Prime Video", ["Prime Video"]), false);
  assert.equal(visibleLink("HIDIVE", ["hidive"]), false);
  assert.equal(visibleLink("Some New Site", ["Netflix"]), true);
});

test("settings keep only known sites and a real true for setup", () => {
  const off = { dailySync: false, syncApply: false, trackNetflix: false, trackTubi: false, trackHidive: false, readCatalogs: true, hideOffSiteShows: true, weeklyTrackerPull: true, writeMal: true };
  assert.deepEqual(cleanSettings({ hiddenSites: ["netflix", "Netflix", "Nope", 3], setupDone: "yes" }), { hiddenSites: ["Netflix"], setupDone: false, ...off });
  assert.deepEqual(mergeSettings({ hiddenSites: ["HIDIVE"] }, { setupDone: true }), { hiddenSites: ["HIDIVE"], setupDone: true, ...off });
  assert.deepEqual(cleanSettings(null), { hiddenSites: [], setupDone: false, ...off });
});

test("backups never carry sign-ins, and restores only write known, well-formed keys", () => {
  assert.ok(!BACKUP_KEYS.includes(KEYS.session));
  assert.ok(!BACKUP_KEYS.includes(KEYS.crunchyrollAuth));
  const file = makeBackup({ [KEYS.session]: { token: "secret" }, [KEYS.matches]: { a: 1 }, [KEYS.settings]: { hiddenSites: ["Hulu"], setupDone: true } }, { version: "0.1.0", now: 0 });
  assert.equal(JSON.stringify(file).includes("secret"), false);
  assert.equal(file.savedAt, "1970-01-01T00:00:00.000Z");
  const back = readBackup(JSON.stringify({ ...file, data: { ...file.data, [KEYS.session]: { token: "x" }, junk: 1, [KEYS.importLog]: "nope" } }));
  assert.deepEqual(Object.keys(back.data).sort(), [KEYS.matches, KEYS.settings].sort());
  assert.throws(() => readBackup("{}"), /isn't a Crunchilist Search backup/);
  assert.throws(() => readBackup("not json"), /isn't a Crunchilist Search backup/);
  assert.throws(() => readBackup(JSON.stringify({ ...file, backup: 99 })), /newer version/);
});

test("diagnostics list connections and outcomes without account names", () => {
  const text = diagnostics({
    version: "0.1.0", userAgent: "UA", connected: ["netflix"], anilist: { connected: true, name: "PrivateName" },
    idMap: { count: 10, updated: "2026-10-01" }, settings: { hiddenSites: [], setupDone: true }, job: { phase: "idle" },
    log: [{ at: 0, service: "mal", outcome: "applied", count: 3, stats: { matched: 3, dropped: 1 } }],
    checkpoints: { netflix: [{ end: true }] }, pendingCount: 2, granted: ["https://www.netflix.com/*"],
  });
  assert.match(text, /AniList: connected/);
  assert.match(text, /Sites allowed: www\.netflix\.com/);
  assert.match(text, /mal applied: 3 sent/);
  assert.equal(text.includes("PrivateName"), false);
});
