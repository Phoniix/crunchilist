// Active guide character + line helpers. Call sites use this instead of hard-coding "kivi".
import {
  DEFAULT_CHARACTER_ID,
  characterById,
  cleanFavorite,
  composeLine,
} from "./characters.js";

const FALLBACK_PORTRAIT = "icons/kivi.png";

/** Resolve which pack speaks — storage fave, then settings id, then Kivi. */
export function activeCharacterId(favorite = null, settingsFavoriteId = "") {
  const fromStorage = cleanFavorite(favorite)?.id;
  if (fromStorage) return fromStorage;
  const fromSettings = cleanFavorite(settingsFavoriteId)?.id;
  if (fromSettings) return fromSettings;
  return DEFAULT_CHARACTER_ID;
}

export function characterPortraitPath(id = "") {
  const pack = characterById(id) || characterById(DEFAULT_CHARACTER_ID);
  const path = typeof pack?.portrait === "string" ? pack.portrait.trim() : "";
  return path || FALLBACK_PORTRAIT;
}

export function characterPortraitUrl(id, getURL = (path) => path) {
  try {
    return getURL(characterPortraitPath(id));
  } catch {
    return characterPortraitPath(id);
  }
}

/**
 * Compose a line for the active (or given) character.
 * @param {{ kind?: string, seed?: string|number, hint?: string, tip?: string, characterId?: string, favorite?: object|string|null, settingsFavoriteId?: string }} opts
 */
export function guideLine({
  kind = "look_here",
  seed = "",
  hint = "",
  tip = "",
  characterId = "",
  favorite = null,
  settingsFavoriteId = "",
} = {}) {
  const id = characterId || activeCharacterId(favorite, settingsFavoriteId);
  const composed = composeLine({ characterId: id, kind, seed, hint, tip });
  return {
    ...composed,
    characterId: id,
    name: composed.character?.name || "Kivi",
    portraitPath: characterPortraitPath(id),
  };
}
