// Crunchyroll audio-locale helpers: turn browse `audio_locales` into card labels and search tokens.

const LOCALE_NAMES = {
  "ja-jp": "Japanese",
  "en-us": "English",
  "en-gb": "English",
  "es-419": "Spanish",
  "es-es": "Spanish",
  "es-la": "Spanish",
  "pt-br": "Portuguese",
  "pt-pt": "Portuguese",
  "fr-fr": "French",
  "de-de": "German",
  "it-it": "Italian",
  "ru-ru": "Russian",
  "ar-sa": "Arabic",
  "ar-me": "Arabic",
  "hi-in": "Hindi",
  "ta-in": "Tamil",
  "te-in": "Telugu",
  "th-th": "Thai",
  "id-id": "Indonesian",
  "ms-my": "Malay",
  "vi-vn": "Vietnamese",
  "ko-kr": "Korean",
  "zh-cn": "Chinese",
  "zh-hans": "Chinese",
  "zh-hant": "Chinese",
  "zh-hk": "Chinese",
  "zh-tw": "Chinese",
  "pl-pl": "Polish",
  "tr-tr": "Turkish",
  "ca-es": "Catalan",
};

const LANG_ALIASES = {
  japanese: "ja", japan: "ja", nihongo: "ja",
  english: "en", eng: "en",
  spanish: "es", espanol: "es", español: "es", castilian: "es",
  portuguese: "pt", portugues: "pt", brazilian: "pt",
  french: "fr", francais: "fr", français: "fr",
  german: "de", deutsch: "de",
  italian: "it",
  russian: "ru",
  arabic: "ar",
  hindi: "hi",
  korean: "ko",
  chinese: "zh", mandarin: "zh",
  thai: "th",
  indonesian: "id",
  malay: "ms",
  vietnamese: "vi",
  polish: "pl",
  turkish: "tr",
};

export function normalizeAudioLocales(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const value of list) {
    const match = /^([a-z]{2})(?:[_-]([a-z0-9]+))?$/i.exec(String(value || "").trim());
    if (!match) continue;
    const lang = match[1].toLowerCase();
    const region = match[2] ? match[2].toUpperCase() : "";
    const locale = region ? `${lang}-${region}` : lang;
    const key = locale.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(locale);
  }
  return out;
}

export function localeLanguageName(locale) {
  const key = String(locale || "").toLowerCase();
  if (LOCALE_NAMES[key]) return LOCALE_NAMES[key];
  const lang = key.slice(0, 2);
  for (const [code, name] of Object.entries(LOCALE_NAMES)) {
    if (code.startsWith(`${lang}-`) || code === lang) return name;
  }
  return lang ? lang.toUpperCase() : "";
}

export function languageCodeOf(locale) {
  return String(locale || "").toLowerCase().slice(0, 2);
}

function uniqueNames(locales) {
  const names = [];
  const seen = new Set();
  for (const locale of locales || []) {
    const name = localeLanguageName(locale);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * Classify CR audio: sub = Japanese-only, dub = non-Japanese-only, both = Japanese + at least one dub.
 * Falls back to isDubbed / isSubbed flags when locales are missing.
 */
export function audioAvailability({ locales = [], isDubbed = null, isSubbed = null } = {}) {
  const list = normalizeAudioLocales(locales);
  const hasJa = list.some((locale) => languageCodeOf(locale) === "ja");
  const dubs = list.filter((locale) => languageCodeOf(locale) !== "ja");
  let mode = null;
  if (list.length) {
    if (hasJa && dubs.length) mode = "both";
    else if (hasJa) mode = "sub";
    else if (dubs.length) mode = "dub";
  } else if (isDubbed === true && isSubbed === true) mode = "both";
  else if (isDubbed === true && isSubbed === false) mode = "dub";
  else if (isSubbed === true && isDubbed === false) mode = "sub";
  const languages = uniqueNames(list.length ? list : (mode === "sub" ? ["ja-JP"] : []));
  return { mode, locales: list, languages, hasJa, dubLocales: dubs };
}

/** Card / search descriptor, e.g. "Sub|Dub · Japanese, English". */
export function audioDescriptor(info) {
  const avail = info?.mode != null ? info : audioAvailability(info || {});
  if (!avail.mode) return "";
  const langs = (avail.languages || []).join(", ");
  if (avail.mode === "sub") return langs ? `Subbed only · ${langs}` : "Subbed only";
  if (avail.mode === "dub") return langs ? `Dubbed only · ${langs}` : "Dubbed only";
  return langs ? `Sub|Dub · ${langs}` : "Sub|Dub";
}

/** Preferred-dub chips in taste settings: [{ code: "en", label: "English" }, …]. */
export function dubLanguageOptions() {
  const byCode = new Map();
  for (const [locale, name] of Object.entries(LOCALE_NAMES)) {
    const code = locale.slice(0, 2);
    if (!name || code === "ja" || byCode.has(code)) continue;
    byCode.set(code, name);
  }
  return [...byCode.entries()]
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Visible Include/Exclude suggestions: "Subbed", "English Dub", … */
export function audioTagSuggestions() {
  return ["Subbed", ...dubLanguageOptions().map((row) => `${row.label} Dub`)];
}

/** Tokens indexed for search ("english dub", "subbed only", locale codes, …). */
export function audioSearchTags(info) {
  const avail = info?.mode != null ? info : audioAvailability(info || {});
  if (!avail.mode) return [];
  const tags = new Set();
  if (avail.mode === "sub") {
    tags.add("subbed only");
    tags.add("sub only");
    tags.add("sub");
    tags.add("subbed");
  } else if (avail.mode === "dub") {
    tags.add("dubbed only");
    tags.add("dub only");
    tags.add("dub");
    tags.add("dubbed");
  } else {
    tags.add("sub|dub");
    tags.add("sub and dub");
    tags.add("sub dub");
    tags.add("sub");
    tags.add("subbed");
    tags.add("dub");
    tags.add("dubbed");
  }
  for (const locale of avail.locales || []) {
    const lang = languageCodeOf(locale);
    const name = localeLanguageName(locale).toLowerCase();
    if (name) {
      tags.add(name);
      if (lang !== "ja") {
        tags.add(`${name} dub`);
        tags.add(`dubbed in ${name}`);
      } else {
        tags.add("japanese audio");
        tags.add("japanese sub");
      }
    }
    if (lang) tags.add(lang);
    tags.add(String(locale).toLowerCase());
  }
  return [...tags];
}

export function languageAliasCode(word) {
  return LANG_ALIASES[String(word || "").toLowerCase()] || null;
}
