// Matches a streaming service's show and season names to AniList entries using the master list, offline.
// Steps run most certain first and stop at the first confident answer:
//   the season's own name -> show + season name -> the season's name without its marker -> "Show N"-style
//   season names -> the sequel chain -> the show's name -> a movie's subtitle.
// Episode numbers are then placed on the right entries: arcs and ranges count from the show's start,
// seasons that keep counting from the last one restart at 1, and long seasons spill into the next entry.
// Anything still unsure comes back unmatched with a reason and its candidates; a wrong match is worse than none.

const SERIES_FORMATS = ["TV", "ONA", "TV_SHORT", "OVA", "SPECIAL", "MOVIE", "MUSIC"];
const SEQUEL_FORMATS = new Set(["TV", "ONA", "TV_SHORT"]);
const SEASON_ORDER = { WINTER: 0, SPRING: 1, SUMMER: 2, FALL: 3 };
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
const ROMAN_OF = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const ABSOLUTE_FROM = 14;
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;

const LANGUAGES = "English|Japanese|Korean|Chinese|Mandarin|Cantonese|Spanish|Castilian|Latin American Spanish|Latin American|European Spanish|Portuguese|Brazilian Portuguese|European Portuguese|French|German|Italian|Russian|Arabic|Hindi|Tamil|Telugu|Thai|Indonesian|Malay|Vietnamese|Turkish|Polish|Dutch|Swedish";
const LANGUAGE_TAG = new RegExp(`\\s*\\((?:(?:${LANGUAGES})(?:\\s+(?:Dub|Dubbed|Sub|Subbed|Subtitled|Audio))?|(?:[\\w-]+\\s+)?(?:Dub|Dubbed|Sub|Subbed|Subtitled)|Uncut|Uncensored|Simulcast)\\)`, "gi");
const DUB_WORD = /,?\s*\b(?:subtitled|dubbed)\b/gi;
const RANGE = /\s*\((\d+)\s*[-–]\s*(\d+|current)\)/i;
const PAREN_SEASON = /\s*\((?:season|part|cour)\s*\d+\)/gi;
const ARC = /\b(?:series\s*\d+\s*,\s*)?arc\b(?:\s*\d+)?/i;
const SEASON_WORDS = /\b(?:season|series)\s*0*(\d+(?:\.\d+)?)\b|\b(\d+)(?:st|nd|rd|th)\s+season\b|\bs0*(\d+)\b|\bseason\s+(i{1,3}|iv|v|vi{0,3}|ix|x)\b/i;
const PART_WORDS = /\b(?:part|cour)\s*0*(\d+|i{1,3}|iv|v)\b/i;
const ROMAN_TAIL = /\s+(ii|iii|iv|v|vi|vii|viii|ix|x)(?=\s*(?::|$))/i;

// Loose key: case, accents, quotes and punctuation don't matter.
export function looseKey(text) {
  return String(text || "").normalize("NFKC").toLowerCase().replace(/[’‘`]/g, "'")
    .normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// Plural-blind key, for "OADs"/"OAD" and "Albums"/"Album".
export function pluralKey(text) {
  return looseKey(text).split(" ").map((word) => (word.length > 3 && /[^s]s$/.test(word) ? word.slice(0, -1) : word)).join(" ");
}

// The punctuation a name carries, ignoring spacing: "Cells at Work!!" and "Cells at Work!" differ here.
function punctuation(text) {
  return String(text || "").normalize("NFKC").replace(/[’‘`]/g, "'").replace(/[\p{L}\p{N}\s]+/gu, "");
}

export function cleanLabel(text) {
  return String(text || "").replace(LANGUAGE_TAG, "").replace(RANGE, "").replace(PAREN_SEASON, "").replace(DUB_WORD, "")
    .replace(/\s+/g, " ").replace(/[\s:,–-]+$/, "").trim();
}

export function episodeRange(text) {
  const match = String(text || "").match(RANGE);
  if (!match) return null;
  const from = Number(match[1]);
  const to = /current/i.test(match[2]) ? null : Number(match[2]);
  return from > 0 && (to == null || to >= from) ? { from, to } : null;
}

const numberOf = (text) => (/^\d/.test(text) ? Number(text) : ROMAN[String(text).toLowerCase()] ?? null);

// What a season label says: its number and part, whether it's an arc, and the name left once markers are gone.
export function seasonInfo(label) {
  const clean = cleanLabel(label);
  const found = clean.match(SEASON_WORDS);
  let number = found ? numberOf(found[1] || found[2] || found[3] || found[4]) : null;
  const roman = !found && clean.match(ROMAN_TAIL);
  if (roman) number = ROMAN[roman[1].toLowerCase()];
  const partMatch = clean.match(PART_WORDS);
  const part = partMatch ? numberOf(partMatch[1]) : null;
  const special = number != null && !Number.isInteger(number);
  const rest = clean
    .replace(new RegExp(SEASON_WORDS.source, "gi"), " ")
    .replace(new RegExp(PART_WORDS.source, "gi"), " ")
    .replace(ARC, " ")
    .replace(/\s*[:,]\s*(?=[:,]|$)/g, "")
    .replace(/^\s*[:,–-]\s*/, "")
    .replace(/\s+/g, " ").replace(/[\s:,–-]+$/g, "").trim();
  return { clean, number: special ? null : number, special, part, arc: ARC.test(clean), rest, range: episodeRange(label) };
}

function seasonNames(base, number, part) {
  const names = [];
  if (part) names.push(`${base} Season ${number} Part ${part}`, `${base} ${ordinal(number)} Season Part ${part}`, `${base} ${number} Part ${part}`, `${base} Season ${number} Cour ${part}`, `${base} ${ROMAN_OF[number] || number} Part ${part}`);
  names.push(`${base} Season ${number}`, `${base} ${number}`, `${base} ${ordinal(number)} Season`, `${base} S${number}`, `${base} ${ROMAN_OF[number] || number}`);
  return names;
}

const formatRank = (format) => { const index = SERIES_FORMATS.indexOf(format); return index < 0 ? SERIES_FORMATS.length : index; };
const airedOrder = (row) => (row.year || 9999) * 4 + (SEASON_ORDER[row.season] ?? 3);
const nameHead = (row) => looseKey(row.title).split(" ").slice(0, 2).join(" ");

export function buildIndex(rows) {
  const byId = new Map();
  const loose = new Map();
  const plural = new Map();
  const subtitle = new Map();
  const add = (map, key, id) => {
    if (!key) return;
    let ids = map.get(key);
    if (!ids) map.set(key, (ids = new Set()));
    ids.add(id);
  };
  for (const row of rows) {
    byId.set(row.a, row);
    for (const name of [row.title, ...(row.synonyms || [])]) {
      add(loose, looseKey(name), row.a);
      add(plural, pluralKey(name), row.a);
      const parts = String(name).split(/:\s+|\s+-\s+/);
      if (parts.length > 1) add(subtitle, looseKey(parts.slice(1).join(" ")).replace(/^the /, ""), row.a);
    }
  }
  return { byId, loose, plural, subtitle };
}

export function createMatcher(rows) {
  const index = buildIndex(rows);
  const row = (id) => index.byId.get(id);

  function lookup(name) {
    if (!name || !seasonInfo(name).rest) return [];
    const hits = index.loose.get(looseKey(name));
    if (hits?.size) return [...hits];
    const plural = index.plural.get(pluralKey(name));
    return plural?.size ? [...plural] : [];
  }

  // Narrows candidates with what the service told us; no id when it stays unclear.
  function pick(ids, { kind, arc, top = 0, year, name = "" } = {}) {
    let pool = [...new Set(ids)].map(row).filter(Boolean);
    if (!pool.length) return { id: null, candidates: [] };
    const narrow = (keep) => { const kept = pool.filter(keep); if (kept.length) pool = kept; };
    // "Love is War" over "Love is War?": the entry whose name matches with its punctuation wins.
    if (pool.length > 1 && name) {
      const key = looseKey(name);
      const marks = punctuation(name);
      narrow((item) => [item.title, ...(item.synonyms || [])].some((title) => looseKey(title) === key && punctuation(title) === marks));
    }
    if (kind === "movie") narrow((item) => item.format === "MOVIE");
    else if (pool.length > 1) {
      const best = Math.min(...pool.map((item) => formatRank(item.format)));
      narrow((item) => formatRank(item.format) === best);
    }
    if (pool.length > 1 && top) narrow((item) => !item.episodes || item.episodes >= top);
    if (pool.length > 1 && year) {
      const closest = Math.min(...pool.map((item) => Math.abs((item.year || 0) - year)));
      narrow((item) => Math.abs((item.year || 0) - year) === closest);
    }
    if (pool.length > 1 && (arc || top)) {
      const earliest = Math.min(...pool.map(airedOrder));
      const related = pool.every((item) => item.a === pool.find((first) => airedOrder(first) === earliest).a || (item.related || []).some((id) => pool.some((other) => other.a === id)));
      if (arc) {
        const most = Math.max(...pool.map((item) => item.episodes || 0));
        narrow((item) => (item.episodes || 0) === most);
      } else if (related) narrow((item) => airedOrder(item) === earliest);
    }
    return pool.length === 1 ? { id: pool[0].a, candidates: [] } : { id: null, candidates: pool.map((item) => item.a) };
  }

  // The next TV/ONA entry after `current` in the same franchise, in airing order.
  function nextInChain(current, start) {
    const head = nameHead(start);
    const pool = new Set([...(current.related || []), ...(start.related || [])]);
    return [...pool].map(row).filter((item) => item && SEQUEL_FORMATS.has(item.format) && item.year && airedOrder(item) > airedOrder(current) && nameHead(item) === head)
      .sort((a, b) => airedOrder(a) - airedOrder(b))[0] || null;
  }

  // Every entry reachable through relations that shares the show's name prefix.
  function franchise(baseId, limit = 200) {
    const head = nameHead(row(baseId));
    const seen = new Set([baseId]);
    const queue = [baseId];
    while (queue.length && seen.size < limit) {
      for (const id of row(queue.shift())?.related || []) {
        const item = row(id);
        if (!item || seen.has(id) || nameHead(item) !== head) continue;
        seen.add(id);
        queue.push(id);
      }
    }
    return seen;
  }

  function firstInChain(start) {
    const head = nameHead(start);
    let current = start;
    for (let hops = 0; hops < 12; hops += 1) {
      const previous = (current.related || []).map(row)
        .filter((item) => item && SEQUEL_FORMATS.has(item.format) && item.year && airedOrder(item) < airedOrder(current) && nameHead(item) === head)
        .sort((a, b) => airedOrder(b) - airedOrder(a))[0];
      if (!previous) break;
      current = previous;
    }
    return current;
  }

  // Season N of `baseId`: a related entry named as season N, else the Nth TV/ONA entry in airing order.
  function seasonOf(baseId, number, part, names) {
    const base = row(baseId);
    if (!base) return null;
    if (number <= 1 && !part) return { id: baseId, how: "title" };
    const family = new Set([baseId, ...(base.related || [])]);
    for (const name of [base.title, ...names]) {
      const found = pick(seasonNames(name, number, part).flatMap(lookup).filter((id) => family.has(id)));
      if (found.id) return { id: found.id, how: "season" };
    }
    if (part) return null;
    let current = base;
    for (let step = 1; step < number && current; step += 1) current = nextInChain(current, base);
    return current ? { id: current.a, how: "chain", unsure: true } : null;
  }

  // Puts episode numbers on the entries that hold them.
  function placeEpisodes(startId, numbers, { range, absolute }) {
    if (!numbers?.length) return [];
    let list = [...new Set(numbers)].sort((a, b) => a - b);
    if (range && list[list.length - 1] < range.from) list = list.map((n) => n + range.from - 1);
    let start = row(startId);
    // A movie cut into episodes is still one film: any of its parts counts as watching it.
    if (start?.format === "MOVIE" && (start.episodes || 1) === 1) return [{ anilistId: start.a, episodes: [1], progress: 1 }];
    // Absolute numbers past what this entry holds count from the franchise's first season ("Final Season (278-328)").
    if (absolute && start?.episodes && list[list.length - 1] > start.episodes) start = firstInChain(start);
    const total = start?.episodes;
    if (!absolute && total && list[list.length - 1] > total && list[0] !== 1 && (list[0] > total || list[list.length - 1] - list[0] + 1 <= total)) {
      list = list.map((n) => n - list[0] + 1);
    }
    const parts = [];
    let current = start;
    let offset = 0;
    let remaining = list;
    while (remaining.length && current) {
      const size = current.episodes;
      const here = size ? remaining.filter((n) => n - offset <= size) : remaining;
      if (here.length) parts.push({ anilistId: current.a, episodes: here.map((n) => n - offset), progress: here[here.length - 1] - offset });
      remaining = remaining.filter((n) => !here.includes(n));
      if (!remaining.length || !size) break;
      const next = nextInChain(current, start);
      if (!next) {
        parts.push({ anilistId: current.a, episodes: remaining.map((n) => n - offset), progress: remaining[remaining.length - 1] - offset, overflow: true });
        break;
      }
      offset += size;
      current = next;
    }
    return parts;
  }

  function result(id, how, info, extra = {}) {
    const found = row(id);
    const absolute = how === "arc" || how === "absolute" || Boolean(info.range);
    const parts = placeEpisodes(id, info.episodes, { range: info.range, absolute });
    const own = parts.find((part) => part.anilistId === id);
    return {
      anilistId: id,
      title: found?.title || "",
      how,
      confidence: extra.unsure ? "low" : "high",
      parts,
      progress: own ? own.progress : null,
      reason: extra.reason || "",
      candidates: extra.candidates || [],
    };
  }

  function match({ series = "", season = "", episodes = [], kind = "", year = null, seasonNumber = null } = {}) {
    const show = cleanLabel(series);
    const info = { ...seasonInfo(season), episodes };
    const sorted = [...episodes].sort((a, b) => a - b);
    const absoluteTop = info.range && sorted.length && sorted[sorted.length - 1] < info.range.from ? sorted[sorted.length - 1] + info.range.from - 1 : sorted[sorted.length - 1] || 0;
    const hints = { kind, arc: info.arc, year, top: info.range || info.arc ? absoluteTop : 0 };
    let unclear = [];
    const attempt = (name, how, extraHints = {}, ids = lookup(name)) => {
      const found = pick(ids, { ...hints, name, ...extraHints });
      if (!found.id && found.candidates.length > 1) unclear = found.candidates;
      return found.id ? { id: found.id, how } : null;
    };

    // Same name as the show but extra punctuation is the sequel: "Cells at Work!!" after "Cells at Work!".
    const sameAsShow = info.clean && looseKey(info.clean) === looseKey(show);
    const punctuatedSequel = sameAsShow && punctuation(info.clean).length > punctuation(show).length;
    const generic = !info.rest || looseKey(info.rest) === looseKey(show);
    const named = info.clean && !generic;

    // 0. The show's full name as the service wrote it, season or part included: "Natsume Yujin-cho (Season 2)".
    const fullShow = String(series || "").replace(LANGUAGE_TAG, "").replace(/\s+/g, " ").trim();
    if (fullShow && !named && (!info.clean || looseKey(fullShow) !== looseKey(show))) {
      const found = attempt(fullShow, "title", { top: absoluteTop });
      if (found) return result(found.id, found.how, info);
    }
    const showNumber = !named ? Number(fullShow.match(/\bseason\s*0*(\d+)\b|\b(\d+)(?:st|nd|rd|th)\s+season\b/i)?.slice(1).find(Boolean)) || null : null;
    const number = info.number ?? (punctuatedSequel ? 2 : null) ?? (Number.isInteger(seasonNumber) && !info.special ? seasonNumber : null) ?? showNumber;

    // 1. The season's own name, with and without the show's name in front.
    if (named || info.special) {
      const names = [info.clean, `${show} ${info.clean}`, `${show}: ${info.clean}`];
      const head = info.clean.split(/:\s/).slice(0, -1).join(": ");
      if (head && looseKey(head).startsWith(`${looseKey(show)} `)) names.push(head);
      for (const name of names) {
        const found = attempt(name, "season-title");
        if (found) return result(found.id, found.how, info);
      }
    }
    // 2. The season's name without its marker: "Persona 5: Season 1" -> "Persona 5", "Season 4: Golden Wind" -> "Show: Golden Wind".
    if (named) {
      const restNames = [info.rest, `${show}: ${info.rest}`, `${show} ${info.rest}`];
      const dashHead = info.rest.split(/\s+-\s+/)[0];
      if (dashHead !== info.rest) restNames.push(dashHead, `${show}: ${dashHead}`);
      for (const name of restNames) {
        const found = attempt(name, "season-title");
        if (!found) continue;
        // The name found is the show itself ("Persona 5: Season 2"), so the season still has to be found.
        if (number > 1 && lookup(show).includes(found.id)) {
          const seasonal = seasonOf(found.id, number, info.part, [info.rest, show]);
          if (seasonal) return result(seasonal.id, seasonal.how, info, seasonal);
          continue;
        }
        return result(found.id, found.how, info);
      }
    }
    // 2b. A named season the franchise holds under a longer name ("The First Kiss" -> "The First Kiss That Never Ends").
    //     Close but not exact, so it's offered for a one-time confirmation rather than applied silently.
    if (named) {
      const core = looseKey(info.rest.split(/\s+-\s+/)[0]).replace(new RegExp(`^${looseKey(show).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`), "");
      const bases = core.split(" ").length >= 2 ? lookup(show) : [];
      if (bases.length) {
        const family = new Set(bases.flatMap((id) => [...franchise(id)]));
        const phrase = new RegExp(`(^| )${core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`);
        const holders = [...family].filter((id) => !bases.includes(id) && row(id) && [row(id).title, ...(row(id).synonyms || [])].some((name) => phrase.test(looseKey(name))));
        if (holders.length === 1) return result(holders[0], "franchise", info, { unsure: true, reason: "Close match inside the same franchise; confirm once." });
        if (holders.length > 1) unclear = holders;
      }
    }
    // 3. "Show N"-style names, then a long show counted from its start, then the sequel chain.
    if (show && (number > 1 || info.part > 1) && !info.arc) {
      const seasonal = (() => {
        for (const name of seasonNames(show, number || 1, info.part > 1 ? info.part : null)) {
          const found = attempt(name, "season");
          if (found) return found;
        }
        return null;
      })();
      if (seasonal) return result(seasonal.id, seasonal.how, info);
      const base = attempt(show, "title", { top: 0 });
      if (base) {
        const top = sorted[sorted.length - 1] || 0;
        const total = row(base.id)?.episodes;
        if (sorted[0] >= ABSOLUTE_FROM && (!total || total >= top)) return result(base.id, "absolute", info);
        if (number > 1) {
          const found = seasonOf(base.id, number, info.part > 1 ? info.part : null, [show]);
          if (found) return result(found.id, found.how, info, found);
        } else return result(base.id, "title", info);
      }
    }
    // 4. The show's own name: for season 1, plain season labels, arcs and episode ranges, never for a named season it couldn't find.
    if (show && (!named || number === 1 || info.arc || info.range) && (!number || number <= 1 || info.arc || info.range)) {
      const found = attempt(show, info.arc || info.range ? "arc" : "title", { top: absoluteTop });
      if (found) return result(found.id, found.how, info);
    }
    // 5. A subtitle, for a movie or a show with no season label: "King of Eden" is "Eden of the East Movie I: The King of Eden".
    if (!info.clean || kind === "movie") {
      const ids = index.subtitle.get(looseKey(show).replace(/^the /, ""));
      if (ids?.size) {
        const found = attempt("", "subtitle", {}, [...ids]);
        if (found) return result(found.id, found.how, info);
      }
    }
    return {
      anilistId: null,
      title: "",
      how: "",
      confidence: "none",
      parts: [],
      progress: null,
      reason: unclear.length ? "More than one AniList entry fits; pick the right one once." : named ? "AniList has no entry with this season's name." : "No AniList entry has this name.",
      candidates: unclear,
    };
  }

  // Places a service's episodes on an entry already decided (remembered or picked by the user).
  function placeOn(anilistId, { season = "", episodes = [] } = {}, how = "remembered") {
    if (!row(anilistId)) return null;
    return result(anilistId, how, { ...seasonInfo(season), episodes });
  }

  // Entries with a name that begins with this one, for titles a service cut short or left without a subtitle.
  function startingWith(name, limit = 6) {
    const key = looseKey(String(name || "").replace(/(?:\.\.\.|…)\s*$/, ""));
    if (key.length < 3) return [];
    const found = new Set();
    for (const [other, ids] of index.loose) {
      if (other !== key && !other.startsWith(`${key} `)) continue;
      for (const id of ids) found.add(id);
      if (found.size >= limit * 4) break;
    }
    return [...found];
  }

  return { match, placeOn, index, row, startingWith, franchise };
}
