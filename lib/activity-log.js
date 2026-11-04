// On-device activity log for Help → export and bug reports. Never store tokens or account ids.

export const ACTIVITY_LOG_KEY = "ksActivityLog";
export const ACTIVITY_LOG_MAX = 200;

export const ACTIVITY_KINDS = new Set([
  "import", "sync", "update", "tracking", "continue", "error", "system",
]);

export function cleanActivityRow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kind = String(raw.kind || "");
  if (!ACTIVITY_KINDS.has(kind)) return null;
  const title = String(raw.title || "").trim().slice(0, 180);
  if (!title) return null;
  return {
    id: String(raw.id || `${kind}:${Number(raw.at) || Date.now()}`).slice(0, 120),
    at: Number(raw.at) || 0,
    kind,
    title,
    detail: String(raw.detail || "").slice(0, 400),
    service: String(raw.service || "").slice(0, 40),
    ok: raw.ok !== false,
  };
}

export function normalizeActivityLog(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.rows) ? raw.rows : [];
  return list.map(cleanActivityRow).filter(Boolean)
    .sort((a, b) => b.at - a.at || a.title.localeCompare(b.title))
    .slice(0, ACTIVITY_LOG_MAX);
}

export function appendActivity(list, row, { now = Date.now(), limit = ACTIVITY_LOG_MAX } = {}) {
  const next = cleanActivityRow({ ...row, at: Number(row?.at) || now, id: row?.id || `${row?.kind || "system"}:${now}` });
  if (!next) return normalizeActivityLog(list);
  const rest = (Array.isArray(list) ? list : []).filter((item) => item?.id !== next.id);
  return normalizeActivityLog([next, ...rest]).slice(0, limit);
}

export function formatActivityExport(list, { limit = 80 } = {}) {
  const rows = normalizeActivityLog(list).slice(0, limit);
  if (!rows.length) return "Activity log: (empty)";
  return [
    "Activity log (newest first)",
    ...rows.map((row) => {
      const when = row.at ? new Date(row.at).toISOString() : "?";
      const svc = row.service ? ` [${row.service}]` : "";
      const fail = row.ok ? "" : " FAIL";
      const detail = row.detail ? ` — ${row.detail}` : "";
      return `${when} ${row.kind}${fail}${svc}: ${row.title}${detail}`;
    }),
  ].join("\n");
}
