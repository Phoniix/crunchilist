// Reading and writing the signed-in user's AniList list.
import { anilist } from "./anilist-api.js";

const DATE = "{ year month day }";
const ENTRY = `id mediaId status progress startedAt ${DATE} completedAt ${DATE}`;

export const LIST_QUERY = `query ($userId: Int, $ids: [Int]) {
  list: Page(perPage: 50) { mediaList(userId: $userId, mediaId_in: $ids, type: ANIME) { ${ENTRY} } }
  media: Page(perPage: 50) { media(id_in: $ids, type: ANIME) { id episodes status title { userPreferred english romaji } } }
}`;

export const SAVE_MUTATION = `mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
  SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, startedAt: $startedAt, completedAt: $completedAt) { ${ENTRY} }
}`;

export const DELETE_MUTATION = "mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }";
export const ENTRY_QUERY = `query ($userId: Int, $mediaId: Int) { MediaList(userId: $userId, mediaId: $mediaId, type: ANIME) { ${ENTRY} } }`;

const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, index * size + size));
const blankDate = { year: null, month: null, day: null };

// Current list entries and media facts for the given AniList ids, 50 at a time.
export async function readList(ids, { token, userId, request = anilist, onProgress = () => {} } = {}) {
  const entries = new Map();
  const media = new Map();
  const batches = chunks([...new Set(ids)], 50);
  for (const [index, batch] of batches.entries()) {
    const data = await request(LIST_QUERY, { userId, ids: batch }, { token });
    for (const entry of data?.list?.mediaList || []) entries.set(entry.mediaId, entry);
    for (const item of data?.media?.media || []) media.set(item.id, { episodes: item.episodes, status: item.status, title: item.title?.english || item.title?.userPreferred || item.title?.romaji || "" });
    onProgress(index + 1, batches.length);
  }
  return { entries, media };
}

export async function saveEntry(anilistId, after, { token, request = anilist } = {}) {
  const data = await request(SAVE_MUTATION, {
    mediaId: anilistId,
    status: after.status,
    progress: after.progress,
    startedAt: after.startedAt || blankDate,
    completedAt: after.completedAt || blankDate,
  }, { token });
  return data?.SaveMediaListEntry || null;
}

export async function deleteEntry(entryId, { token, request = anilist } = {}) {
  const data = await request(DELETE_MUTATION, { id: entryId }, { token });
  return Boolean(data?.DeleteMediaListEntry?.deleted);
}

export async function readEntry(anilistId, { token, userId, request = anilist } = {}) {
  try {
    const data = await request(ENTRY_QUERY, { userId, mediaId: anilistId }, { token });
    return data?.MediaList || null;
  } catch (error) {
    if (/not found/i.test(String(error?.message))) return null;
    throw error;
  }
}
