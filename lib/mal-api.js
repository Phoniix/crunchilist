// MyAnimeList v2 API: read @me animelist, write list status. Statuses map to AniList's.
import { MAL_API } from "./mal-auth.js";

export const MAL_TO_ANILIST = {
  watching: "CURRENT",
  completed: "COMPLETED",
  on_hold: "PAUSED",
  dropped: "DROPPED",
  plan_to_watch: "PLANNING",
};
export const ANILIST_TO_MAL = {
  CURRENT: "watching",
  COMPLETED: "completed",
  PAUSED: "on_hold",
  DROPPED: "dropped",
  PLANNING: "plan_to_watch",
  REPEATING: "watching",
};

const PAGE = 100;

async function malFetch(path, { token, method = "GET", body, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${MAL_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: body || undefined,
  });
  if (response.status === 401) throw new Error("MyAnimeList asked you to sign in again.");
  if (!response.ok) throw new Error(`MyAnimeList didn't answer (${response.status}).`);
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

export async function malMe(token, fetchImpl = fetch) {
  const json = await malFetch("/users/@me?fields=name", { token, fetchImpl });
  return { id: json?.id || null, name: json?.name || "" };
}

// One MAL list node -> list-import row shape.
export function malNodeToRow(node) {
  const malId = Number(node?.node?.id);
  const status = MAL_TO_ANILIST[node?.list_status?.status];
  if (!Number.isInteger(malId) || malId < 1 || !status) return null;
  const progress = Number(node?.list_status?.num_episodes_watched) || 0;
  const start = node?.list_status?.start_date || "";
  const finish = node?.list_status?.finish_date || "";
  const fuzzy = (text) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(text || ""));
    if (!match) return null;
    const [year, month, day] = match.slice(1).map(Number);
    return year ? { year, month: month || null, day: (month && day) || null } : null;
  };
  return {
    title: node?.node?.title || `MyAnimeList ${malId}`,
    malId,
    kitsuId: null,
    anilistId: null,
    status,
    progress: Math.min(Math.max(0, progress), 5000),
    episodes: Number(node?.node?.num_episodes) || null,
    startedAt: fuzzy(start),
    completedAt: fuzzy(finish),
  };
}

export async function fetchMalAnimeList(token, { fetchImpl = fetch, onPage } = {}) {
  const rows = [];
  let offset = 0;
  for (let page = 0; page < 200; page += 1) {
    const path = `/users/@me/animelist?fields=list_status,num_episodes&nsfw=true&limit=${PAGE}&offset=${offset}`;
    const json = await malFetch(path, { token, fetchImpl });
    const chunk = Array.isArray(json?.data) ? json.data : [];
    for (const node of chunk) {
      const row = malNodeToRow(node);
      if (row) rows.push(row);
    }
    onPage?.(rows.length);
    if (!json?.paging?.next || chunk.length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

// Never-downgrade helper for writes: only send fields that should update.
export async function writeMalStatus(token, malId, after, { fetchImpl = fetch } = {}) {
  const id = Number(malId);
  if (!Number.isInteger(id) || id < 1) return { ok: false, skipped: true };
  const status = ANILIST_TO_MAL[after?.status];
  if (!status) return { ok: false, skipped: true };
  const body = new URLSearchParams({ status });
  if (Number.isInteger(after.progress) && after.progress >= 0) body.set("num_watched_episodes", String(after.progress));
  const fmt = (date) => (date?.year ? `${date.year}-${String(date.month || 1).padStart(2, "0")}-${String(date.day || 1).padStart(2, "0")}` : "");
  if (after.startedAt?.year) body.set("start_date", fmt(after.startedAt));
  if (after.completedAt?.year) body.set("finish_date", fmt(after.completedAt));
  await malFetch(`/anime/${id}/my_list_status`, { token, method: "PUT", body, fetchImpl });
  return { ok: true };
}
