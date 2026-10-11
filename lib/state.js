import { defaultSettings } from "./settings.js";
import { defaultTaste, sanitizeTaste } from "./taste.js";

export const STORAGE_KEY = "crCornerState";

export function defaultState() {
  return {
    version: 1,
    seasons: {},
    sightings: {},
    anilistCache: {},
    imports: {},
    importMeta: { username: "", importedAt: 0, source: "" },
    taste: defaultTaste(),
    settings: defaultSettings(),
    lastObservation: null,
  };
}

export function cloneState(state) {
  return structuredClone(state);
}

export function normalizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== "object") return base;
  return {
    version: 1,
    seasons: raw.seasons && typeof raw.seasons === "object" ? raw.seasons : {},
    sightings: raw.sightings && typeof raw.sightings === "object" ? raw.sightings : {},
    anilistCache: raw.anilistCache && typeof raw.anilistCache === "object" ? raw.anilistCache : {},
    imports: raw.imports && typeof raw.imports === "object" ? raw.imports : {},
    importMeta: {
      username: raw.importMeta?.username || "",
      importedAt: raw.importMeta?.importedAt || 0,
      source: raw.importMeta?.source === "account" || raw.importMeta?.source === "public" ? raw.importMeta.source : "",
    },
    taste: sanitizeTaste(raw.taste),
    settings: { ...defaultSettings(), ...(raw.settings || {}) },
    lastObservation: raw.lastObservation || null,
  };
}
