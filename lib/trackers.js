// Anime list trackers (not streaming sites). AniList is the home list; MAL gets full write tracking;
// Kitsu is weekly pull only for now.
export const TRACKERS = [
  {
    id: "anilist",
    name: "AniList",
    home: "https://anilist.co/",
    write: true,
    pull: true,
    why: "Your home list. Imports and what you watch update AniList.",
  },
  {
    id: "mal",
    name: "MyAnimeList",
    home: "https://myanimelist.net/",
    write: true,
    pull: true,
    why: "Weekly library pull and full tracking when connected (OAuth).",
  },
  {
    id: "kitsu",
    name: "Kitsu",
    home: "https://kitsu.app/",
    write: false,
    pull: true,
    why: "Weekly library pull into AniList. Progress is not written back to Kitsu yet.",
  },
];

export const trackerById = (id) => TRACKERS.find((item) => item.id === id) || null;

export function cleanKitsuLink(value) {
  const username = String(value?.username || "").trim().replace(/^https?:\/\/kitsu\.(app|io)\/users\//i, "").replace(/\/.*$/, "");
  if (!/^[\w.-]{2,40}$/.test(username)) return null;
  return {
    username,
    userId: Number.isInteger(Number(value?.userId)) && Number(value.userId) > 0 ? Number(value.userId) : null,
    at: Number(value?.at) || Date.now(),
    lastPull: Number(value?.lastPull) || 0,
  };
}

export function publicKitsuLink(link) {
  if (!link?.username) return { connected: false, username: "", lastPull: 0 };
  return { connected: true, username: link.username, lastPull: link.lastPull || 0 };
}
