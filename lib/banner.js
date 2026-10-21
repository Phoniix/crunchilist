// Ordering for Home's banner and the Picked for you row, with and without AI.

// Turns taste scores into a 45-85 "match", inside the 40-95 range the AI uses for confidence.
// items arrive in the row's order; position breaks ties so equal scores don't all read the same.
export function tasteMatches(items, scoreFor) {
  const scores = items.map((item) => Math.max(0, Number(scoreFor(item)) || 0));
  const best = Math.max(1e-9, ...scores);
  const span = Math.max(1, items.length - 1);
  return new Map(items.map((item, index) => [item.id, Math.round(45 + 40 * (0.75 * (scores[index] / best) + 0.25 * (1 - index / span)))]));
}

const AI_RANK_DECAY = 0.08;

// How long a For you title stays “recent” so weekly refreshes show it less often.
export const FOR_YOU_HISTORY_MS = 21 * 24 * 60 * 60 * 1000;
// Cached AI ranking for Picked for you — refreshed about once a week.
export const FOR_YOU_PICKS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// AI picks first (novelty-biased), then mentions, then taste order (also novelty-biased).
export function orderForYou({ tasteIds = [], picks = null, tasteMatch = new Map(), recentShown = null, now = Date.now() }) {
  const out = [];
  const seen = new Set();
  const add = (id, extra) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ id, match: tasteMatch.get(id) ?? null, reason: "", ai: false, ...extra });
  };
  const novelThen = (a, b, tie) => {
    const na = noveltyOf(a.id, recentShown, now, FOR_YOU_HISTORY_MS);
    const nb = noveltyOf(b.id, recentShown, now, FOR_YOU_HISTORY_MS);
    if (Math.abs(na - nb) > 0.04) return nb - na;
    return tie(a, b);
  };
  const ranked = (picks || []).filter((pick) => !pick.mention)
    .sort((a, b) => novelThen(a, b, (x, y) => (x.rank ?? 99) - (y.rank ?? 99)));
  for (const pick of ranked) add(pick.id, { match: pick.confidence ?? tasteMatch.get(pick.id) ?? null, reason: pick.reason || "", ai: true });
  for (const pick of picks || []) if (pick.mention) add(pick.id, { reason: pick.reason || "", ai: true });
  const taste = [...tasteIds].sort((a, b) => novelThen({ id: a }, { id: b }, () => tasteIds.indexOf(a) - tasteIds.indexOf(b)));
  for (const id of taste) add(id);
  // The row is numbered, so a later card never shows a higher match than the one before it.
  let ceiling = Infinity;
  for (const row of out) {
    if (row.match == null) continue;
    row.match = Math.max(40, Math.min(row.match, ceiling));
    ceiling = row.match - 1;
  }
  return out;
}

const WEIGHTS = {
  ai: { ai: 0.36, trend: 0.22, taste: 0.18, fresh: 0.12, novelty: 0.12 },
  plain: { ai: 0, trend: 0.34, taste: 0.3, fresh: 0.2, novelty: 0.16 },
};
const TREND_POOL = 40;
// Titles featured on the banner this recently get pushed back so repeats feel less sticky.
export const BANNER_HISTORY_MS = 3 * 24 * 60 * 60 * 1000;

const positionScore = (index, length) => (index < 0 || !length ? 0 : 1 - index / length);

// 1 = never / long ago; 0 = just shown. recentShown: Map id → lastShownAt ms (or plain Set of ids).
export function noveltyOf(id, recentShown, now = Date.now(), windowMs = BANNER_HISTORY_MS) {
  if (!recentShown) return 1;
  let at = null;
  if (recentShown instanceof Map) at = recentShown.get(id);
  else if (recentShown instanceof Set) at = recentShown.has(id) ? now : null;
  else if (Array.isArray(recentShown)) at = recentShown.includes(id) ? now : null;
  if (at == null) return 1;
  const age = Math.max(0, now - Number(at) || 0);
  const window = Math.max(1, Number(windowMs) || BANNER_HISTORY_MS);
  if (age >= window) return 1;
  return age / window;
}

function byNoveltyThen(a, b, recentShown, tie) {
  const na = noveltyOf(a.id, recentShown);
  const nb = noveltyOf(b.id, recentShown);
  if (Math.abs(na - nb) > 0.04) return nb - na;
  return tie(a, b);
}

// One blended score per show: AI rank and confidence, Crunchyroll popularity, taste, unstarted lift, and
// a novelty lift so recently featured banner titles rotate out for a few days.
// Finished and dropped shows never appear, and at least one of the ten most popular always keeps a slot.
// exclude: ids a reroll has already shown.
export function rankBanner(options) {
  const { rows } = blendRows(options);
  return withTopTen(rows.slice(0, options.count ?? 6), rows);
}

const isTop = (row) => row.trend >= 0 && row.trend < 10;

function withTopTen(chosen, rows) {
  if (chosen.length && !chosen.some(isTop)) {
    const top = rows.find((row) => isTop(row) && !chosen.includes(row));
    if (top) chosen[chosen.length - 1] = top;
  }
  return chosen;
}

export const EXCLUSIVE_BANNER_SLOTS = 3;

// Pick up to `limit` single-service exclusives, novelty-sorted so they rotate across visits.
export function pickExclusiveBanner(shows, { recentShown = null, hasArt = () => true, statusOf = () => "", exclude = new Set(), limit = EXCLUSIVE_BANNER_SLOTS } = {}) {
  const pool = (shows || []).filter((show) => {
    if (!show?.id || exclude.has(show.id) || !hasArt(show)) return false;
    const status = statusOf(show);
    if (status === "finished" || status === "dropped") return false;
    const services = exclusiveServices(show);
    return services.length === 1;
  }).map((show) => {
    const service = exclusiveServices(show)[0];
    return {
      id: show.id,
      service,
      reason: `Only on ${serviceLabel(service)}`,
      exclusive: true,
    };
  });
  pool.sort((a, b) => byNoveltyThen(a, b, recentShown, (x, y) => String(x.id).localeCompare(String(y.id))));
  return pool.slice(0, limit);
}

const SERVICE_IDS = {
  crunchyroll: "crunchyroll",
  netflix: "netflix",
  hidive: "hidive",
  tubi: "tubi",
  prime: "prime",
  "prime video": "prime",
  hulu: "hulu",
};

function exclusiveServices(show) {
  if (show.onServices?.length) return [...new Set(show.onServices.map((id) => String(id).toLowerCase()))];
  const fromStreaming = (show.streaming || [])
    .map((link) => link.service || SERVICE_IDS[String(link.site || "").toLowerCase()] || "")
    .filter(Boolean);
  if (fromStreaming.length) return [...new Set(fromStreaming.map((id) => String(id).toLowerCase()))];
  if (show.onCrunchyroll === false && show.sources?.length) return [...new Set(show.sources.map((id) => String(id).toLowerCase()))];
  return [];
}

function serviceLabel(id) {
  const names = { crunchyroll: "Crunchyroll", netflix: "Netflix", hidive: "HIDIVE", tubi: "Tubi", prime: "Prime Video", hulu: "Hulu" };
  return names[id] || String(id || "").replace(/^\w/, (c) => c.toUpperCase());
}

// The paged banner: count slides in pages of pageSize, mostly AI picks. AI's ranked picks lead, then its
// "also consider" mentions, then extraPicks (a second AI roll, AI-named Home rows). Within each group,
// recently featured titles are demoted so the same heroes don't keep leading. The last slide of each
// page goes to the blended order instead, and one of those is always a top-10 show. Without AI it is the blend.
// exclusivePicks: 2–3 "Only on {service}" titles injected one per page (slot pageSize-2) so they rotate in.
export function galleryBanner(options) {
  const { count = 18, pageSize = 6, picks = null, extraPicks = [], exclusivePicks = [], recentShown = null } = options;
  const { rows, usable, trendIds, tasteMatch } = blendRows(options);
  const aiRows = [];
  const taken = new Set();
  const addAi = (pick) => {
    if (!pick?.id || taken.has(pick.id) || !usable(pick.id)) return;
    taken.add(pick.id);
    aiRows.push({
      id: pick.id,
      score: 0,
      match: pick.confidence ?? tasteMatch.get(pick.id) ?? null,
      reason: pick.reason || "",
      ai: Boolean(pick.ai !== false && !pick.exclusive),
      exclusive: Boolean(pick.exclusive),
      service: pick.service || "",
      trend: trendIds.indexOf(pick.id),
    });
  };
  const ranked = (picks || []).filter((pick) => !pick.mention).sort((a, b) => byNoveltyThen(a, b, recentShown, (x, y) => (x.rank ?? 99) - (y.rank ?? 99)));
  const mentions = (picks || []).filter((pick) => pick.mention).sort((a, b) => byNoveltyThen(a, b, recentShown, () => 0));
  const extras = ranked.length
    ? [...extraPicks].sort((a, b) => byNoveltyThen(a, b, recentShown, () => 0))
    : [];
  // Prefer fresher AI material overall: ranked → mentions → extras, each novelty-sorted, then a final
  // novelty pass so a stale #1 yields the lead to a fresher mention/extra when gaps are clear.
  const ordered = [...ranked, ...mentions, ...extras].sort((a, b) => {
    const na = noveltyOf(a.id, recentShown);
    const nb = noveltyOf(b.id, recentShown);
    if (Math.abs(na - nb) > 0.2) return nb - na;
    const group = (pick) => (pick.mention ? 1 : ranked.some((row) => row.id === pick.id) ? 0 : 2);
    return group(a) - group(b) || (a.rank ?? 99) - (b.rank ?? 99);
  });
  ordered.forEach(addAi);
  const exclusives = [...exclusivePicks]
    .filter((pick) => pick?.id && usable(pick.id) && !taken.has(pick.id))
    .sort((a, b) => byNoveltyThen(a, b, recentShown, () => 0))
    .slice(0, EXCLUSIVE_BANNER_SLOTS)
    .map((pick) => {
      taken.add(pick.id);
      return {
        id: pick.id,
        score: 0,
        match: null,
        reason: pick.reason || `Only on ${serviceLabel(pick.service)}`,
        ai: false,
        exclusive: true,
        service: pick.service || "",
        trend: trendIds.indexOf(pick.id),
      };
    });
  if (!aiRows.length && !exclusives.length) return withTopTen(rows.slice(0, count), rows);
  const others = rows.filter((row) => !taken.has(row.id));
  const top = others.findIndex(isTop);
  if (top > 0) others.unshift(...others.splice(top, 1));
  const out = [];
  let exclusiveAt = 0;
  for (let index = 0; index < count; index += 1) {
    const wantExclusive = exclusives.length && index % pageSize === Math.max(0, pageSize - 2) && exclusiveAt < exclusives.length;
    const wantOther = index % pageSize === pageSize - 1;
    const next = (wantExclusive ? exclusives[exclusiveAt++] : null)
      || (wantOther ? others.shift() : aiRows.shift())
      || aiRows.shift()
      || others.shift()
      || exclusives[exclusiveAt++];
    if (!next) break;
    out.push(next);
  }
  return out;
}

function blendRows({ shows, trending = [], tasteIds = [], picks = null, tasteMatch = new Map(), statusOf = () => "", hasArt = () => true, exclude = new Set(), recentShown = null }) {
  const byId = new Map(shows.map((show) => [show.id, show]));
  const usable = (id) => {
    const show = byId.get(id);
    if (!show || exclude.has(id) || !hasArt(show)) return false;
    const status = statusOf(show);
    return status !== "finished" && status !== "dropped";
  };
  const trendIds = trending.filter(usable).slice(0, TREND_POOL);
  const tasteList = tasteIds.filter(usable);
  const aiPicks = (picks || []).filter((pick) => !pick.mention && usable(pick.id));
  const weights = aiPicks.length ? WEIGHTS.ai : WEIGHTS.plain;
  const aiById = new Map(aiPicks.map((pick) => [pick.id, pick]));
  const pool = [...new Set([...aiPicks.map((pick) => pick.id), ...tasteList, ...trendIds])];
  const rows = pool.map((id) => {
    const pick = aiById.get(id);
    const ai = pick ? ((pick.confidence ?? 60) / 100) * Math.max(0.4, 1 - ((pick.rank ?? aiPicks.length) - 1) * AI_RANK_DECAY) : 0;
    const trend = positionScore(trendIds.indexOf(id), trendIds.length);
    const taste = positionScore(tasteList.indexOf(id), tasteList.length);
    const fresh = statusOf(byId.get(id)) ? 0 : 1;
    const novelty = noveltyOf(id, recentShown);
    const score = weights.ai * ai + weights.trend * trend + weights.taste * taste + weights.fresh * fresh + weights.novelty * novelty;
    return {
      id,
      score,
      match: pick?.confidence ?? tasteMatch.get(id) ?? null,
      reason: pick?.reason || "",
      ai: Boolean(pick),
      trend: trendIds.indexOf(id),
    };
  });
  rows.sort((a, b) => b.score - a.score || (a.trend < 0 ? 1e9 : a.trend) - (b.trend < 0 ? 1e9 : b.trend));
  return { rows, usable, trendIds, tasteMatch };
}
