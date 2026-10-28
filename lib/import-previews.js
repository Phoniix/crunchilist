// Per-service import preview map. Legacy installs stored a single preview object at KEYS.importPreview;
// new writes use { version: 2, services: { crunchyroll: preview, ... } }.

export function asPreviewMap(raw) {
  if (!raw) return {};
  if (raw.version === 2 && raw.services && typeof raw.services === "object") {
    return { ...raw.services };
  }
  if (raw.service) return { [raw.service]: raw };
  // Older tests / incomplete objects still count as an open preview.
  if (raw.id || Array.isArray(raw.changes)) {
    const service = raw.service || "pending";
    return { [service]: { ...raw, service } };
  }
  return {};
}

export function packPreviewMap(services) {
  const cleaned = Object.fromEntries(
    Object.entries(services || {}).filter(([, preview]) => preview && preview.service),
  );
  return { version: 2, services: cleaned };
}

/** Preview that blocks starting `serviceId` (same service or Import-all). */
export function blockingPreview(services, serviceId) {
  const map = services || {};
  if (map.all) return map.all;
  if (serviceId === "all") return Object.values(map).find(Boolean) || null;
  return map[serviceId] || null;
}

export function anyPreview(services) {
  return Object.values(services || {}).some(Boolean);
}
