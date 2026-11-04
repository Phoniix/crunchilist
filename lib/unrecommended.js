// Titles the viewer asked Home never to recommend again. Search and show pages still find them.

const MAX = 200;
const text = (value, max = 200) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

export function sanitizeUnrecommended(list) {
  const seen = new Set();
  const out = [];
  for (const row of Array.isArray(list) ? list : []) {
    const id = String(row?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title: text(row.title, 120) || id,
      cover: text(row.cover, 500),
      at: Number(row.at) || 0,
    });
    if (out.length >= MAX) break;
  }
  return out.sort((a, b) => (b.at || 0) - (a.at || 0) || a.title.localeCompare(b.title));
}

export function isUnrecommended(list, id) {
  const key = String(id || "").trim();
  if (!key) return false;
  return sanitizeUnrecommended(list).some((row) => row.id === key);
}

export function unrecommendedIds(list) {
  return new Set(sanitizeUnrecommended(list).map((row) => row.id));
}

export function addUnrecommended(list, show, now = Date.now()) {
  const id = String(show?.id || "").trim();
  if (!id) return sanitizeUnrecommended(list);
  const next = sanitizeUnrecommended(list).filter((row) => row.id !== id);
  next.unshift({
    id,
    title: text(show.title, 120) || id,
    cover: text(show.cover || show.banner, 500),
    at: now,
  });
  return sanitizeUnrecommended(next);
}

export function removeUnrecommended(list, id) {
  const key = String(id || "").trim();
  return sanitizeUnrecommended(list).filter((row) => row.id !== key);
}

export function filterRecommended(items, list, idOf = (item) => item?.id) {
  const blocked = unrecommendedIds(list);
  if (!blocked.size) return items || [];
  return (items || []).filter((item) => !blocked.has(String(idOf(item) || "")));
}
