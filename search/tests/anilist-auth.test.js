import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { anilist } from "../src/lib/anilist-api.js";
import { ANILIST_CLIENT_ID, RENEW_BEFORE_MS, authUrl, parseTokenRedirect, publicSession } from "../src/lib/anilist-auth.js";

const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.payload.signature";
const REDIRECT = "https://mdiljnemdmcagcldlnjfalddcnfpkein.chromiumapp.org/";

test("sign-in uses AniList's secret-free token grant with the public client id", () => {
  const url = new URL(authUrl());
  assert.equal(url.origin + url.pathname, "https://anilist.co/api/v2/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), String(ANILIST_CLIENT_ID));
  assert.equal(url.searchParams.get("response_type"), "token");
  assert.equal(ANILIST_CLIENT_ID, 53755);
});

test("the token and its expiry come from the redirect fragment", () => {
  const now = 1_000_000;
  const result = parseTokenRedirect(`${REDIRECT}#access_token=${TOKEN}&token_type=Bearer&expires_in=31536000`, now);
  assert.deepEqual(result, { token: TOKEN, expiresAt: now + 31536000 * 1000 });
});

test("a missing expiry falls back to a year", () => {
  const result = parseTokenRedirect(`${REDIRECT}#access_token=${TOKEN}`, 0);
  assert.equal(result.expiresAt, 365 * 24 * 60 * 60 * 1000);
});

test("cancelled, broken or empty redirects give a readable error and no token", () => {
  assert.match(parseTokenRedirect(`${REDIRECT}#error=access_denied`).error, /cancelled/);
  assert.match(parseTokenRedirect(`${REDIRECT}?error=server_error&error_description=Try%20later`).error, /Try later/);
  assert.match(parseTokenRedirect(`${REDIRECT}#access_token=`).error, /token/);
  assert.match(parseTokenRedirect(`${REDIRECT}#access_token=bad token`).error, /token/);
  assert.match(parseTokenRedirect("not a url").error, /back/);
  for (const url of [`${REDIRECT}#error=access_denied`, "not a url"]) assert.equal(parseTokenRedirect(url).token, undefined);
});

test("the app page only ever sees public account info, never the token", () => {
  const now = 1_000_000;
  const session = { token: TOKEN, expiresAt: now + RENEW_BEFORE_MS * 4, viewer: { id: 1, name: "Phoniix", avatar: "https://s4.anilist.co/a.png" } };
  const shown = publicSession(session, now);
  assert.deepEqual(shown, { connected: true, expired: false, name: "Phoniix", avatar: "https://s4.anilist.co/a.png", renewSoon: false });
  assert.ok(!JSON.stringify(shown).includes(TOKEN));
  assert.equal(publicSession({ ...session, expiresAt: now + 1000 }, now).renewSoon, true);
  assert.deepEqual(publicSession({ ...session, expiresAt: now - 1 }, now), { connected: false, expired: true, name: "Phoniix", avatar: "https://s4.anilist.co/a.png", renewSoon: false });
  assert.equal(publicSession(null).connected, false);
});

test("only the extension's own pages can sign in or out; streaming sites can't", () => {
  const source = readFileSync(new URL("../src/background/service-worker.js", import.meta.url), "utf8");
  assert.match(source, /fromExtensionPage\(sender\) \? handlers\[message\?\.type\] : fromContent\[message\?\.type\]/);
  const contentBlock = source.match(/const fromContent = \{([^}]*)\}/)[1];
  assert.doesNotMatch(contentBlock, /Anilist|status|syncServices/);
});

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const { status = 200, body = {}, headers = {} } = responses.shift();
    return { status, ok: status >= 200 && status < 300, headers: { get: (name) => headers[name.toLowerCase()] ?? null }, json: async () => body };
  };
  return { impl, calls };
}

test("AniList requests send the token as a bearer header and return data", async () => {
  const { impl, calls } = fakeFetch([{ body: { data: { Viewer: { id: 7 } } }, headers: { "x-ratelimit-remaining": "80" } }]);
  const data = await anilist("query { Viewer { id } }", {}, { token: TOKEN, fetchImpl: impl });
  assert.deepEqual(data, { Viewer: { id: 7 } });
  assert.equal(calls[0].url, "https://graphql.anilist.co");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${TOKEN}`);
});

test("an expired AniList token is reported as a sign-in problem", async () => {
  const { impl } = fakeFetch([{ status: 401, body: { errors: [{ message: "Invalid token" }] } }]);
  await assert.rejects(anilist("query { Viewer { id } }", {}, { token: TOKEN, fetchImpl: impl }), (error) => error.code === "auth");
});

test("AniList errors surface their message", async () => {
  const { impl } = fakeFetch([{ status: 404, body: { errors: [{ message: "Not Found." }] } }]);
  await assert.rejects(anilist("query { Media(id: 0) { id } }", {}, { fetchImpl: impl }), /Not Found/);
});
