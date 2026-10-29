// AniList sign-in without a client secret: the implicit grant returns the token in the redirect's fragment.
// The client id is public and ships with the extension; AniList sends users back to the redirect registered for it,
// https://<extension id>.chromiumapp.org/, which chrome.identity catches.
export const ANILIST_CLIENT_ID = 53755;
export const RENEW_BEFORE_MS = 14 * 24 * 60 * 60 * 1000;

export function authUrl(clientId = ANILIST_CLIENT_ID) {
  return `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=token`;
}

export function parseTokenRedirect(url, now = Date.now()) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "AniList didn't send you back to Kivori SekAI." };
  }
  const params = new URLSearchParams(parsed.hash.replace(/^#/, "") || parsed.search.replace(/^\?/, ""));
  const error = params.get("error");
  if (error) return { error: error === "access_denied" ? "AniList sign-in was cancelled." : params.get("error_description") || "AniList didn't allow the sign-in." };
  const token = params.get("access_token") || "";
  if (!/^[\w.-]{20,}$/.test(token)) return { error: "AniList didn't return a sign-in token." };
  const seconds = Number(params.get("expires_in"));
  // Missing expires_in → assume a year; Viewer query still validates the token on connect.
  const expiresAt = now + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 365 * 24 * 60 * 60 * 1000);
  return { token, expiresAt };
}

// What the app page may see: never the token.
export function publicSession(session, now = Date.now()) {
  if (!session?.token) return { connected: false, expired: false, name: "", avatar: "", renewSoon: false };
  const expired = Boolean(session.expiresAt && session.expiresAt <= now);
  return {
    connected: !expired,
    expired,
    name: session.viewer?.name || "",
    avatar: session.viewer?.avatar || "",
    renewSoon: !expired && Boolean(session.expiresAt && session.expiresAt - now < RENEW_BEFORE_MS),
  };
}
