// Lists from other trackers: MyAnimeList's export file and a public Kitsu library.
// Each becomes rows of { title, malId, kitsuId, anilistId, status, progress, startedAt, completedAt },
// with AniList statuses and fuzzy dates, ready for listChange.

export const LIST_SOURCES = {
  mal: { name: "MyAnimeList", home: "https://myanimelist.net/", exportUrl: "https://myanimelist.net/panel.php?go=export" },
  kitsu: { name: "Kitsu", home: "https://kitsu.app/", origin: "https://kitsu.app/*" },
};
export const KITSU_API = "https://kitsu.app/api/edge";
export const KITSU_PAGE = 500;

const MAL_STATUS = {
  watching: "CURRENT", "1": "CURRENT",
  completed: "COMPLETED", "2": "COMPLETED",
  "on-hold": "PAUSED", "3": "PAUSED",
  dropped: "DROPPED", "4": "DROPPED",
  "plan to watch": "PLANNING", "6": "PLANNING",
};
const KITSU_STATUS = { current: "CURRENT", completed: "COMPLETED", on_hold: "PAUSED", dropped: "DROPPED", planned: "PLANNING" };

const unescapeXml = (text) => text
  .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&amp;/g, "&");

// "2021-04-09" (MAL uses 0000-00-00 for unknown parts) or an ISO time -> { year, month, day } or null.
export function fuzzyFrom(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(text || ""));
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (!year) return null;
  return { year, month: month || null, day: (month && day) || null };
}

const count = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, 5000) : 0;
};
const id = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
};

// MyAnimeList's "Export my list" file (animelist_*.xml, after unzipping the .gz).
export function parseMalXml(text) {
  const rows = [];
  if (!/<myanimelist>/i.test(text)) return rows;
  for (const [, block] of text.matchAll(/<anime>([\s\S]*?)<\/anime>/g)) {
    const field = (name) => {
      const found = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
      return found ? unescapeXml(found[1].trim()) : "";
    };
    const malId = id(field("series_animedb_id"));
    const status = MAL_STATUS[field("my_status").toLowerCase()];
    if (!malId || !status) continue;
    rows.push({
      title: field("series_title") || `MyAnimeList ${malId}`,
      malId,
      kitsuId: null,
      anilistId: null,
      status,
      progress: count(field("my_watched_episodes")),
      episodes: count(field("series_episodes")) || null,
      startedAt: fuzzyFrom(field("my_start_date")),
      completedAt: fuzzyFrom(field("my_finish_date")),
    });
  }
  return rows;
}

export function kitsuLibraryUrl(userId, offset = 0) {
  const params = new URLSearchParams({
    "filter[userId]": String(userId),
    "filter[kind]": "anime",
    include: "anime.mappings",
    "fields[libraryEntries]": "status,progress,startedAt,finishedAt,anime",
    "fields[anime]": "canonicalTitle,episodeCount,mappings",
    "fields[mappings]": "externalSite,externalId",
    "page[limit]": String(KITSU_PAGE),
    "page[offset]": String(offset),
  });
  return `${KITSU_API}/library-entries?${params}`;
}

export const kitsuUserUrl = (name) => `${KITSU_API}/users?${new URLSearchParams({ "filter[slug]": name, "fields[users]": "name,slug" })}`;

// One page of Kitsu library entries (JSON:API) -> rows, plus whether there's another page.
export function parseKitsuPage(payload) {
  const included = new Map((payload?.included || []).map((item) => [`${item.type}:${item.id}`, item]));
  const rows = [];
  for (const entry of payload?.data || []) {
    const attrs = entry.attributes || {};
    const status = KITSU_STATUS[attrs.status];
    const ref = entry.relationships?.anime?.data;
    const anime = ref && included.get(`${ref.type}:${ref.id}`);
    if (!status || !anime) continue;
    const ids = {};
    for (const link of anime.relationships?.mappings?.data || []) {
      const mapping = included.get(`${link.type}:${link.id}`)?.attributes;
      if (mapping?.externalSite === "myanimelist/anime") ids.mal = id(mapping.externalId);
      if (mapping?.externalSite === "anilist/anime") ids.anilist = id(mapping.externalId);
    }
    rows.push({
      title: anime.attributes?.canonicalTitle || `Kitsu ${anime.id}`,
      malId: ids.mal || null,
      kitsuId: id(anime.id) || null,
      anilistId: ids.anilist || null,
      status,
      progress: count(attrs.progress),
      episodes: count(anime.attributes?.episodeCount) || null,
      startedAt: fuzzyFrom(attrs.startedAt),
      completedAt: fuzzyFrom(attrs.finishedAt),
    });
  }
  return { rows, more: Boolean(payload?.links?.next) };
}

// Fills in anilistId: the master list's Kitsu link first, then the AniList id Kitsu itself mapped, then the MAL id.
// Rows still missing one are returned separately.
export function resolveIds(rows, masterRows) {
  const byMal = new Map();
  const byKitsu = new Map();
  for (const row of masterRows) {
    if (row.mal && !byMal.has(row.mal)) byMal.set(row.mal, row.a);
    if (row.kitsu && !byKitsu.has(row.kitsu)) byKitsu.set(row.kitsu, row.a);
  }
  const resolved = [];
  const missing = [];
  for (const row of rows) {
    const anilistId = byKitsu.get(row.kitsuId) || row.anilistId || byMal.get(row.malId) || null;
    (anilistId ? resolved : missing).push({ ...row, anilistId });
  }
  return { resolved, missing };
}

// The same show listed twice (a rewatch, or two MAL ids on one AniList entry): keep the furthest along.
const RANK = { PLANNING: 0, DROPPED: 1, PAUSED: 2, CURRENT: 3, COMPLETED: 4 };
export function mergeRows(rows) {
  const byId = new Map();
  for (const row of rows) {
    const current = byId.get(row.anilistId);
    if (!current || RANK[row.status] > RANK[current.status] || (row.status === current.status && row.progress > current.progress)) byId.set(row.anilistId, row);
  }
  return [...byId.values()];
}
