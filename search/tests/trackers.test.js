import assert from "node:assert/strict";
import test from "node:test";
import { BACKUP_KEYS } from "../src/lib/backup.js";
import { KEYS } from "../src/lib/keys.js";
import {
  ANILIST_TO_MAL, MAL_TO_ANILIST, fetchMalAnimeList, malNodeToRow, writeMalStatus,
} from "../src/lib/mal-api.js";
import {
  MAL_CLIENT_ID, exchangeMalCode, makePkce, malAuthUrl, parseMalRedirect, publicMalSession,
} from "../src/lib/mal-auth.js";
import { DEFAULT_SETTINGS, cleanSettings } from "../src/lib/settings.js";
import { TRACKERS, cleanKitsuLink, publicKitsuLink, trackerById } from "../src/lib/trackers.js";

test("top three trackers are AniList (write), MAL (write), Kitsu (pull-only)", () => {
  assert.deepEqual(TRACKERS.map((t) => [t.id, t.write, t.pull]), [
    ["anilist", true, true],
    ["mal", true, true],
    ["kitsu", false, true],
  ]);
  assert.equal(trackerById("mal").name, "MyAnimeList");
});

test("settings default weekly pull and MAL write on", () => {
  assert.equal(DEFAULT_SETTINGS.weeklyTrackerPull, true);
  assert.equal(DEFAULT_SETTINGS.writeMal, true);
  assert.equal(cleanSettings({ weeklyTrackerPull: false, writeMal: false }).weeklyTrackerPull, false);
  assert.equal(cleanSettings({}).writeMal, true);
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
  assert.equal(link.lastPull, 5);
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
  assert.match(url, /state=s/);
});

test("MAL redirect parse and public session hide tokens", () => {
  assert.equal(parseMalRedirect("https://x/?error=access_denied").error, "MyAnimeList sign-in was cancelled.");
  assert.equal(parseMalRedirect("https://x/?code=abc&state=s", "s").code, "abc");
  assert.equal(parseMalRedirect("https://x/?code=abc&state=bad", "s").error.includes("state"), true);
  assert.deepEqual(publicMalSession(null), { connected: false, expired: false, name: "", renewSoon: false, configured: Boolean(MAL_CLIENT_ID) });
  assert.equal(publicMalSession({ accessToken: "t", expiresAt: Date.now() + 86_400_000, user: { name: "A" } }).connected, true);
  assert.equal(JSON.stringify(publicMalSession({ accessToken: "secret", user: { name: "A" } })).includes("secret"), false);
});

test("MAL status maps and list node shape", () => {
  assert.equal(MAL_TO_ANILIST.watching, "CURRENT");
  assert.equal(ANILIST_TO_MAL.PLANNING, "plan_to_watch");
  const row = malNodeToRow({
    node: { id: 21, title: "One Piece", num_episodes: 1000 },
    list_status: { status: "watching", num_episodes_watched: 12, start_date: "2020-01-02" },
  });
  assert.deepEqual(row, {
    title: "One Piece", malId: 21, kitsuId: null, anilistId: null, status: "CURRENT",
    progress: 12, episodes: 1000, startedAt: { year: 2020, month: 1, day: 2 }, completedAt: null,
  });
  assert.equal(malNodeToRow({ node: { id: 1 }, list_status: { status: "nope" } }), null);
});

test("MAL list fetch pages and write status", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (String(url).includes("offset=0")) {
      return {
        ok: true, status: 200,
        json: async () => ({
          data: [{ node: { id: 1, title: "A", num_episodes: 12 }, list_status: { status: "completed", num_episodes_watched: 12 } }],
          paging: { next: "more" },
        }),
      };
    }
    if (String(url).includes("offset=100")) {
      return { ok: true, status: 200, json: async () => ({ data: [], paging: {} }) };
    }
    if (init?.method === "PUT") return { ok: true, status: 200, json: async () => ({ status: "watching" }) };
    throw new Error(`unexpected ${url}`);
  };
  const rows = await fetchMalAnimeList("tok", { fetchImpl });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].malId, 1);
  assert.equal(await writeMalStatus("tok", 21, { status: "CURRENT", progress: 3 }, { fetchImpl }).then((r) => r.ok), true);
  assert.equal(calls.at(-1).init.method, "PUT");
  assert.match(calls.at(-1).url, /\/anime\/21\/my_list_status/);
});

test("MAL token exchange posts verifier", async () => {
  let body = "";
  const fetchImpl = async (_url, init) => {
    body = String(init.body);
    return { ok: true, json: async () => ({ access_token: "a", refresh_token: "r", expires_in: 3600 }) };
  };
  const tokens = await exchangeMalCode({ clientId: "c", code: "code", verifier: "ver", redirectUri: "https://r/", fetchImpl });
  assert.equal(tokens.accessToken, "a");
  assert.match(body, /code_verifier=ver/);
  assert.match(body, /grant_type=authorization_code/);
});
