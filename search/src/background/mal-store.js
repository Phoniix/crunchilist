// MyAnimeList session: OAuth tokens + profile. Client id from code constant or csMalClientId override.
import { KEYS } from "../lib/keys.js";
import {
  MAL_CLIENT_ID, exchangeMalCode, makePkce, malAuthUrl, parseMalRedirect, publicMalSession, refreshMalToken,
} from "../lib/mal-auth.js";
import { fetchMalAnimeList, malMe, writeMalStatus } from "../lib/mal-api.js";
import { cleanSettings } from "../lib/settings.js";
import { getShow } from "./id-map-store.js";

export async function malClientId() {
  const stored = (await chrome.storage.local.get(KEYS.malClientId))[KEYS.malClientId];
  const id = String(stored || MAL_CLIENT_ID || "").trim();
  return id || "";
}

export async function loadMalSession() {
  return (await chrome.storage.local.get(KEYS.malSession))[KEYS.malSession] || null;
}

async function saveMalSession(session) {
  await chrome.storage.local.set({ [KEYS.malSession]: session });
  return session;
}

export async function malStatus() {
  const clientId = await malClientId();
  const session = (await ensureMalToken().catch(() => null)) || (await loadMalSession());
  return { ...publicMalSession(session, Date.now()), configured: Boolean(clientId) };
}

// Refresh if needed; returns a usable session or null.
export async function ensureMalToken() {
  const session = await loadMalSession();
  if (!session?.accessToken) return null;
  if (session.expiresAt && session.expiresAt > Date.now() + 60_000) return session;
  if (!session.refreshToken) return session.expiresAt && session.expiresAt > Date.now() ? session : null;
  const clientId = await malClientId();
  if (!clientId) return null;
  try {
    const tokens = await refreshMalToken({ clientId, refreshToken: session.refreshToken });
    return saveMalSession({ ...session, ...tokens });
  } catch {
    return null;
  }
}

export async function connectMal() {
  const clientId = await malClientId();
  if (!clientId) {
    throw new Error("Add a MyAnimeList API client id first (Settings → Accounts, or set MAL_CLIENT_ID). Create one at myanimelist.net/apiconfig with redirect https://<extension-id>.chromiumapp.org/");
  }
  const redirectUri = chrome.identity.getRedirectURL();
  const { verifier, challenge } = makePkce();
  const state = crypto.randomUUID();
  await chrome.storage.session.set({ csMalPkce: { verifier, state } });
  let redirect;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({
      url: malAuthUrl(clientId, { challenge, state, redirectUri }),
      interactive: true,
    });
  } catch (error) {
    throw new Error(/did not approve|cancel|closed/i.test(String(error?.message)) ? "MyAnimeList sign-in was cancelled." : "MyAnimeList sign-in didn't finish. Try again.");
  }
  const pkce = (await chrome.storage.session.get("csMalPkce")).csMalPkce || {};
  await chrome.storage.session.remove("csMalPkce");
  const parsed = parseMalRedirect(redirect || "", pkce.state || state);
  if (parsed.error) throw new Error(parsed.error);
  const tokens = await exchangeMalCode({
    clientId,
    code: parsed.code,
    verifier: pkce.verifier || verifier,
    redirectUri,
  });
  const user = await malMe(tokens.accessToken);
  await saveMalSession({ ...tokens, user, connectedAt: Date.now() });
  return malStatus();
}

export async function disconnectMal() {
  await chrome.storage.local.remove(KEYS.malSession);
  return malStatus();
}

export async function setMalClientId(value) {
  const id = String(value || "").trim();
  if (id) await chrome.storage.local.set({ [KEYS.malClientId]: id });
  else await chrome.storage.local.remove(KEYS.malClientId);
  return { configured: Boolean(id || MAL_CLIENT_ID) };
}

export async function pullMalRows() {
  const session = await ensureMalToken();
  if (!session?.accessToken) throw new Error("Connect MyAnimeList first.");
  return fetchMalAnimeList(session.accessToken);
}

export async function pushMalChange(anilistId, after, malId) {
  const settings = cleanSettings((await chrome.storage.local.get(KEYS.settings))[KEYS.settings]);
  if (!settings.writeMal) return { ok: false, skipped: true };
  const session = await ensureMalToken();
  if (!session?.accessToken) return { ok: false, skipped: true };
  let id = Number(malId);
  if (!Number.isInteger(id) || id < 1) {
    const show = await getShow(anilistId);
    id = Number(show?.ids?.mal) || 0;
  }
  if (!id) return { ok: false, skipped: true, why: "no mal id" };
  try {
    return await writeMalStatus(session.accessToken, id, after);
  } catch (error) {
    return { ok: false, error: error?.message || "MAL write failed" };
  }
}
