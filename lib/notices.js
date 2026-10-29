import { entryForSeries } from "./library.js";

export const NOTICE_LIMIT = 30;
export const EPISODE_KINDS = new Set(["ask", "done"]);
export const SYSTEM_KINDS = new Set([
  "sync_preview", "sync_applied", "import_preview", "update", "tracker_preview", "sync_skipped",
]);
const KINDS = new Set([...EPISODE_KINDS, ...SYSTEM_KINDS]);

/** Drawer sections — order is render order; empty sections are omitted. */
export const NOTICE_SECTIONS = [
  { id: "import", label: "Import & sync" },
  { id: "episodes", label: "Episodes" },
  { id: "seasons", label: "New seasons" },
  { id: "app", label: "App" },
];

const SECTION_BY_KIND = {
  import_preview: "import",
  sync_preview: "import",
  tracker_preview: "import",
  sync_applied: "import",
  sync_skipped: "import",
  ask: "episodes",
  done: "episodes",
  update: "app",
};

export function noticeSection(kindOrNote) {
  if (kindOrNote && typeof kindOrNote === "object") {
    if (kindOrNote.section) return kindOrNote.section;
    if (String(kindOrNote.id || "").startsWith("season:")) return "seasons";
    return noticeSection(kindOrNote.kind);
  }
  return SECTION_BY_KIND[kindOrNote] || "app";
}

function whole(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function cleanShow(show) {
  if (!show?.crSeriesId) return null;
  return {
    crSeriesId: String(show.crSeriesId),
    anilistId: Number(show.anilistId) > 0 ? Number(show.anilistId) : null,
    title: String(show.title || "").slice(0, 180),
    cover: typeof show.cover === "string" && show.cover.startsWith("https://") ? show.cover : "",
    episodes: whole(show.episodes) || null,
  };
}

function cleanSystemNotice(raw) {
  const title = String(raw.title || "").trim().slice(0, 180);
  const message = String(raw.message || "").trim().slice(0, 400);
  if (!title || !message || !raw.id) return null;
  return {
    id: String(raw.id).slice(0, 120),
    kind: raw.kind,
    title,
    message,
    href: typeof raw.href === "string" ? raw.href.slice(0, 200) : "",
    count: whole(raw.count),
    service: String(raw.service || "").slice(0, 40),
    createdAt: Number(raw.createdAt) || 0,
  };
}

function cleanEpisodeNotice(raw) {
  const show = cleanShow(raw.show);
  const episode = whole(raw.episode);
  if (!show || !episode || !raw.id) return null;
  return {
    id: String(raw.id),
    kind: raw.kind,
    show,
    episode,
    from: whole(raw.from) ?? 0,
    last: Boolean(raw.last),
    createdAt: Number(raw.createdAt) || 0,
  };
}

export function cleanNotice(raw) {
  if (!raw || typeof raw !== "object" || !KINDS.has(raw.kind)) return null;
  return SYSTEM_KINDS.has(raw.kind) ? cleanSystemNotice(raw) : cleanEpisodeNotice(raw);
}

export function normalizeNotices(raw) {
  return (Array.isArray(raw) ? raw : []).map(cleanNotice).filter(Boolean).slice(0, NOTICE_LIMIT);
}

export function addNotice(notices, notice, now = Date.now()) {
  const stamp = Number(now) || Date.now();
  const withMeta = {
    ...notice,
    createdAt: stamp,
    id: notice.id || (SYSTEM_KINDS.has(notice.kind)
      ? `${notice.kind}`
      : `${notice.kind}:${notice.show?.crSeriesId}:${notice.episode}:${stamp}`),
  };
  const clean = cleanNotice(withMeta);
  if (!clean) return notices || [];
  if (SYSTEM_KINDS.has(clean.kind)) {
    const rest = (notices || []).filter((row) => row.kind !== clean.kind);
    return [clean, ...rest].slice(0, NOTICE_LIMIT);
  }
  const rest = (notices || []).filter((row) => !(row.show?.crSeriesId === clean.show.crSeriesId && (row.kind === "ask" || clean.kind === "ask")));
  return [clean, ...rest].slice(0, NOTICE_LIMIT);
}

export function removeNotices(notices, ids) {
  const drop = new Set(ids);
  return (notices || []).filter((row) => !drop.has(row.id));
}

export function liveNotices(notices, library) {
  return (notices || []).filter((row) => {
    if (SYSTEM_KINDS.has(row.kind)) return true;
    if (row.kind !== "ask") return true;
    const entry = entryForSeries(library, row.show.crSeriesId, row.show.anilistId);
    if (entry?.status === "finished" || entry?.status === "dropped") return false;
    return !(entry?.progress != null && entry.progress >= row.episode);
  });
}

export function describeNotice(row) {
  if (SYSTEM_KINDS.has(row.kind)) {
    const actions = {
      sync_preview: "Review import",
      import_preview: "Review import",
      tracker_preview: "Review import",
      sync_applied: "Open imports",
      update: "Open settings",
      sync_skipped: "Open import",
    };
    return { title: row.title, message: row.message, action: actions[row.kind] || "", href: row.href || "" };
  }
  const title = row.show?.title || "This show";
  if (row.kind === "ask") {
    return {
      title,
      message: row.last ? "You finished the last episode. Mark it completed?" : `You finished episode ${row.episode}. Set it to Watching?`,
      action: row.last ? "Mark completed" : "Set to Watching",
      href: "",
    };
  }
  return { title, message: row.last ? "Marked completed after the last episode." : `Marked episode ${row.episode} watched.`, action: "", href: "" };
}
