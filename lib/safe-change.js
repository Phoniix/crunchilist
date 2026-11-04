// The one place that decides what an import or live tracking may change on an AniList entry.
// Never lowers progress, never overrides a status the user chose (paused, dropped, completed, rewatching),
// only fills dates that are empty, and never touches score, notes, rewatch count or privacy.

export const toFuzzy = (time) => {
  if (!time) return null;
  const date = new Date(time);
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
};
const emptyDate = (date) => !date || !date.year;
export const sameDate = (a, b) => (emptyDate(a) && emptyDate(b)) || (a?.year === b?.year && (a?.month || null) === (b?.month || null) && (a?.day || null) === (b?.day || null));

// entry: current AniList list entry or null. media: { episodes, status }. watched: { progress, firstPlayed, lastPlayed }.
// Returns null when nothing would change, else { status, progress, startedAt, completedAt, notes[] }.
export function safeChange(entry, media, watched) {
  const before = {
    status: entry?.status || null,
    progress: entry?.progress || 0,
    startedAt: entry?.startedAt || null,
    completedAt: entry?.completedAt || null,
  };
  const notes = [];
  const total = media?.episodes || null;
  let progress = Math.max(before.progress, watched.progress || 0);
  if (total && progress > total) progress = total;
  const finishedAiring = media?.status === "FINISHED";
  const complete = Boolean(total && progress >= total && finishedAiring);

  let status = before.status;
  if (!status || status === "PLANNING") status = complete ? "COMPLETED" : progress > 0 ? "CURRENT" : status;
  else if (status === "CURRENT" && complete) status = "COMPLETED";
  else if ((status === "PAUSED" || status === "DROPPED") && progress > before.progress) notes.push(`kept ${status === "PAUSED" ? "Paused" : "Dropped"}; change it on AniList if you're watching again`);
  if (status === "COMPLETED" || status === "REPEATING") progress = before.status === status ? before.progress : progress;

  const startedAt = emptyDate(before.startedAt) && progress > before.progress ? toFuzzy(watched.firstPlayed) : before.startedAt;
  const completedAt = emptyDate(before.completedAt) && status === "COMPLETED" && before.status !== "COMPLETED" ? toFuzzy(watched.lastPlayed) : before.completedAt;

  const after = { status, progress, startedAt: startedAt || null, completedAt: completedAt || null };
  const changed = after.status !== before.status || after.progress !== before.progress || !sameDate(after.startedAt, before.startedAt) || !sameDate(after.completedAt, before.completedAt);
  return changed ? { before, after, notes } : null;
}

// A list from another tracker (MyAnimeList, Kitsu): theirs is { status, progress, startedAt, completedAt } with fuzzy dates.
// Shows missing from AniList are added as listed there. Shows already on AniList follow the rules above, except that
// Paused or Dropped elsewhere replaces Planning here, and empty dates are filled from the other list.
export function listChange(entry, media, theirs) {
  const total = media?.episodes || null;
  const finishedAiring = media?.status === "FINISHED";
  let progress = theirs.progress || 0;
  if (theirs.status === "COMPLETED" && total && finishedAiring) progress = total;
  if (total && progress > total) progress = total;
  if (!entry?.status) {
    let status = theirs.status;
    if (status === "COMPLETED" && !finishedAiring) status = "CURRENT";
    if (status === "PLANNING") progress = 0;
    return {
      before: { status: null, progress: 0, startedAt: null, completedAt: null },
      after: { status, progress, startedAt: progress > 0 ? theirs.startedAt || null : null, completedAt: status === "COMPLETED" ? theirs.completedAt || null : null },
      notes: theirs.status === "COMPLETED" && status === "CURRENT" ? ["still airing, so added as Watching"] : [],
    };
  }
  const base = safeChange(entry, media, { progress, firstPlayed: 0, lastPlayed: 0 });
  const before = base?.before || { status: entry.status, progress: entry.progress || 0, startedAt: entry.startedAt || null, completedAt: entry.completedAt || null };
  const after = { ...(base?.after || before) };
  const notes = base?.notes ? [...base.notes] : [];
  if (before.status === "PLANNING" && (theirs.status === "PAUSED" || theirs.status === "DROPPED")) after.status = theirs.status;
  if (emptyDate(after.startedAt) && after.progress > 0 && theirs.startedAt) after.startedAt = theirs.startedAt;
  if (emptyDate(after.completedAt) && after.status === "COMPLETED" && theirs.completedAt) after.completedAt = theirs.completedAt;
  const changed = after.status !== before.status || after.progress !== before.progress || !sameDate(after.startedAt, before.startedAt) || !sameDate(after.completedAt, before.completedAt);
  return changed ? { before, after, notes } : null;
}
