import assert from "node:assert/strict";
import test from "node:test";
import { ANILIST_CLIENT_ID, authUrl, parseTokenRedirect } from "../lib/anilist-auth.js";
import { defaultSettings, applySettingsPatch, publicSettings } from "../lib/settings.js";

const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.payload.signature";
const REDIRECT = "https://mdiljnemdmcagcldlnjfalddcnfpkein.chromiumapp.org/";

test("one-click AniList uses the shipped client and token grant", () => {
  const url = new URL(authUrl());
  assert.equal(url.searchParams.get("client_id"), String(ANILIST_CLIENT_ID));
  assert.equal(url.searchParams.get("response_type"), "token");
  assert.equal(ANILIST_CLIENT_ID, 53755);
});

test("token redirect parses expiry and falls back to a year", () => {
  const now = 1_000_000;
  const withExpiry = parseTokenRedirect(`${REDIRECT}#access_token=${TOKEN}&expires_in=3600`, now);
  assert.equal(withExpiry.token, TOKEN);
  assert.equal(withExpiry.expiresAt, now + 3600 * 1000);
  const missing = parseTokenRedirect(`${REDIRECT}#access_token=${TOKEN}`, now);
  assert.equal(missing.expiresAt, now + 365 * 24 * 60 * 60 * 1000);
});

test("setupDone defaults false and patches through settings", () => {
  assert.equal(defaultSettings().setupDone, false);
  assert.equal(publicSettings({}).setupDone, false);
  assert.equal(applySettingsPatch(defaultSettings(), { setupDone: true }).setupDone, true);
  assert.equal(publicSettings({ setupDone: true }).setupDone, true);
});
