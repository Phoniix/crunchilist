import assert from "node:assert/strict";
import test from "node:test";
import { BACKUP_KEYS } from "../lib/backup.js";
import { KEYS } from "../lib/keys.js";
import {
  ANILIST_TO_MAL, MAL_TO_ANILIST, malNodeToRow,
} from "../lib/mal-api.js";
import {
  MAL_CLIENT_ID, makePkce, malAuthUrl, parseMalRedirect, publicMalSession,
} from "../lib/mal-auth.js";
import { applySettingsPatch, defaultSettings } from "../lib/settings.js";
import { TRACKERS, cleanKitsuLink, publicKitsuLink, trackerById } from "../lib/trackers.js";

test("top three trackers are AniList (write), MAL (write), Kitsu (pull-only)", () => {
  assert.deepEqual(TRACKERS.map((t) => [t.id, t.write, t.pull]), [
    ["anilist", true, true],
    ["mal", true, true],
    ["kitsu", false, true],
  ]);
  assert.equal(trackerById("mal").name, "MyAnimeList");
});

test("settings default weekly pull and MAL write on", () => {
  const defaults = defaultSettings();
  assert.equal(defaults.weeklyTrackerPull, true);
  assert.equal(defaults.writeMal, true);
  assert.equal(applySettingsPatch(defaults, { weeklyTrackerPull: false }).weeklyTrackerPull, false);
});

test("MAL and Kitsu sessions stay out of backups; client id and Kitsu link may be kept", () => {
  assert.ok(!BACKUP_KEYS.includes(KEYS.malSession));
  assert.ok(!BACKUP_KEYS.includes(KEYS.session));
  assert.ok(BACKUP_KEYS.includes(KEYS.kitsuLink));
  assert.ok(BACKUP_KEYS.includes(KEYS.malClientId));
});

test("Kitsu link cleans username from profile URL", () => {
  const link = cleanKitsuLink({ username: "https://kitsu.app/users/Alice/", userId: 9, lastPull: 5 });
  assert.equal(link.username, "Alice");
  assert.equal(link.userId, 9);
  assert.equal(cleanKitsuLink({ username: "x" }), null);
  assert.deepEqual(publicKitsuLink(link), { connected: true, username: "Alice", lastPull: 5 });
  assert.deepEqual(publicKitsuLink(null), { connected: false, username: "", lastPull: 0 });
});

test("MAL PKCE is plain and auth URL carries challenge", () => {
  const { verifier, challenge } = makePkce();
  assert.equal(verifier, challenge);
  assert.ok(verifier.length >= 43);
  const url = malAuthUrl("cid", { challenge, state: "s", redirectUri: "https://ext.chromiumapp.org/" });
  assert.match(url, /code_challenge_method=plain/);
  assert.match(url, /client_id=cid/);
});

test("MAL redirect parse and public session hide tokens", () => {
  assert.equal(parseMalRedirect("https://x/?error=access_denied").error, "MyAnimeList sign-in was cancelled.");
  assert.equal(parseMalRedirect("https://x/?code=abc&state=s", "s").code, "abc");
  assert.equal(parseMalRedirect("https://x/?code=abc&state=bad", "s").error.includes("state"), true);
  assert.deepEqual(publicMalSession(null), { connected: false, expired: false, name: "", renewSoon: false, configured: Boolean(MAL_CLIENT_ID) });
  assert.equal(JSON.stringify(publicMalSession({ accessToken: "secret", expiresAt: Date.now() + 86_400_000, user: { name: "A" } })).includes("secret"), false);
});

test("MAL status maps and list node shape", () => {
  assert.equal(MAL_TO_ANILIST.watching, "CURRENT");
  assert.equal(ANILIST_TO_MAL.PLANNING, "plan_to_watch");
  const row = malNodeToRow({
    node: { id: 21, title: "One Piece", num_episodes: 1000 },
    list_status: { status: "watching", num_episodes_watched: 12, start_date: "2020-01-02" },
  });
  assert.equal(row.malId, 21);
  assert.equal(row.status, "CURRENT");
  assert.equal(row.progress, 12);
  assert.equal(malNodeToRow({ node: { id: 1 }, list_status: { status: "nope" } }), null);
});
