// MyAnimeList OAuth2 authorization-code + PKCE (plain). Register a client at
// https://myanimelist.net/apiconfig with redirect URI:
//   https://<extension-id>.chromiumapp.org/
// Public clients ship only the client id (no secret).
// Set MAL_CLIENT_ID below after you create the app, or override via chrome.storage.local csMalClientId.

export const MAL_CLIENT_ID = ""; // e.g. "your_client_id"
export const MAL_AUTHORIZE = "https://myanimelist.net/v1/oauth2/authorize";
export const MAL_TOKEN = "https://myanimelist.net/v1/oauth2/token";
export const MAL_API = "https://api.myanimelist.net/v2";
export const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;

const VERIFIER_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

export function makePkce() {
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  let verifier = "";
  for (const byte of bytes) verifier += VERIFIER_CHARS[byte % VERIFIER_CHARS.length];
  // MAL only supports plain: challenge === verifier.
  return { verifier, challenge: verifier };
}

export function malAuthUrl(clientId, { challenge, state, redirectUri } = {}) {
  const url = new URL(MAL_AUTHORIZE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "plain");
  if (state) url.searchParams.set("state", state);
  if (redirectUri) url.searchParams.set("redirect_uri", redirectUri);
  return url.toString();
}

export function parseMalRedirect(url, expectedState = "") {
  let parsed;
  try { parsed = new URL(url); } catch { return { error: "MyAnimeList didn't send you back to Kivori SekAI." }; }
  const params = new URLSearchParams(parsed.search.replace(/^\?/, ""));
  if (params.get("error")) {
    return { error: params.get("error") === "access_denied" ? "MyAnimeList sign-in was cancelled." : params.get("error_description") || "MyAnimeList didn't allow the sign-in." };
  }
  const code = params.get("code") || "";
  if (!code) return { error: "MyAnimeList didn't return an authorization code." };
  const state = params.get("state") || "";
  if (expectedState && state !== expectedState) return { error: "MyAnimeList sign-in looked wrong (state mismatch). Try again." };
  return { code, state };
}

export async function exchangeMalCode({ clientId, code, verifier, redirectUri, fetchImpl = fetch } = {}) {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
  });
  if (redirectUri) body.set("redirect_uri", redirectUri);
  const response = await fetchImpl(MAL_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`MyAnimeList token exchange failed (${response.status}).`);
  const json = await response.json();
  if (!json.access_token) throw new Error("MyAnimeList didn't return an access token.");
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || "",
    expiresAt: Date.now() + (Number(json.expires_in) > 0 ? Number(json.expires_in) * 1000 : 28 * 24 * 60 * 60 * 1000),
  };
}

export async function refreshMalToken({ clientId, refreshToken, fetchImpl = fetch } = {}) {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const response = await fetchImpl(MAL_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`MyAnimeList token refresh failed (${response.status}).`);
  const json = await response.json();
  if (!json.access_token) throw new Error("MyAnimeList didn't return a refreshed token.");
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || refreshToken,
    expiresAt: Date.now() + (Number(json.expires_in) > 0 ? Number(json.expires_in) * 1000 : 28 * 24 * 60 * 60 * 1000),
  };
}

// What the app may see: never tokens.
export function publicMalSession(session, now = Date.now()) {
  if (!session?.accessToken) return { connected: false, expired: false, name: "", renewSoon: false, configured: Boolean(MAL_CLIENT_ID) };
  const expired = Boolean(session.expiresAt && session.expiresAt <= now);
  return {
    connected: !expired,
    expired,
    name: session.user?.name || "",
    renewSoon: !expired && Boolean(session.expiresAt && session.expiresAt - now < RENEW_BEFORE_MS),
    configured: true,
  };
}
