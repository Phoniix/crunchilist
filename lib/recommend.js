import { sanitizeTaste } from "./taste.js";

function norm(value) {
  return String(value || "").trim().toLowerCase();
}

function unique(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const key = norm(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function hitsAvoid(candidate, taste) {
  const blocked = new Set((taste.hardAvoids || []).map(norm));
  if (!blocked.size) return false;
  return [...(candidate.tags || []), ...(candidate.genres || [])].some((label) => blocked.has(norm(label)));
}

function languagePenalty(candidate, taste) {
  if (!taste.subDub || taste.subDub === "any" || candidate.audio === "unknown") return 0;
  if (taste.subDub === "sub" && candidate.audio === "dub") return 1;
  if (taste.subDub === "dub" && candidate.audio === "sub") return 1;
  return 0;
}

function statusPenalty(status) {
  if (status === "in_progress") return 1;
  if (status === "plan") return 0;
  if (status === "dropped") return 3;
  if (status === "finished") return 4;
  return 0;
}

function tasteScore(candidate, weights) {
  if (!weights) return 0;
  let score = 0;
  for (const label of [...(candidate.tags || []), ...(candidate.genres || [])]) {
    const key = norm(label);
    score += weights.liked?.get(key) || 0;
    score -= weights.disliked?.get(key) || 0;
  }
  return score;
}

function episodeCount(candidate) {
  if (candidate.anilistMatched && Number.isFinite(candidate.episodes)) return candidate.episodes;
  if (Number.isFinite(candidate.crEpisodes)) return candidate.crEpisodes;
  return null;
}

function isMovie(candidate) {
  if (candidate.format === "MOVIE") return true;
  if (candidate.movieSignal) return true;
  const title = candidate.title || "";
  if ((candidate.format === "SPECIAL" || candidate.format === "OVA") && candidate.episodes === 1 && /\bmovie\b/i.test(title)) {
    return true;
  }
  return false;
}

function sharedLabels(current, other) {
  const mine = new Map();
  for (const label of [...(current.tags || []), ...(current.genres || [])]) mine.set(norm(label), label);
  const out = [];
  const seen = new Set();
  for (const label of [...(other.tags || []), ...(other.genres || [])]) {
    const key = norm(label);
    if (mine.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(mine.get(key));
    }
  }
  return out;
}

function present(candidate, reason, tags) {
  return {
    id: candidate.id,
    title: candidate.title,
    url: candidate.url,
    reason,
    tags: unique(tags || [...(candidate.tags || []), ...(candidate.genres || [])]).slice(0, 6),
    status: candidate.status,
    audio: candidate.audio || "unknown",
  };
}

function byTitle(a, b) {
  return String(a.title).localeCompare(String(b.title));
}

function skipNotice(count) {
  if (!count) return "";
  return `${count} ${count === 1 ? "title was" : "titles were"} skipped for lack of a confident match.`;
}

export function recommend(options) {
  const chip = options.chip || "unwatched";
  const taste = sanitizeTaste(options.taste);
  const weights = options.weights || null;
  const limit = options.limit ?? 5;
  const current = (options.candidates || []).find((candidate) => candidate.id === options.currentId) || null;
  let skippedUnmatched = 0;
  let pool = (options.candidates || []).filter((candidate) => !hitsAvoid(candidate, taste));

  const sortGeneral = (a, b) => {
    const scoreA = statusPenalty(a.status) + languagePenalty(a, taste) * 2;
    const scoreB = statusPenalty(b.status) + languagePenalty(b, taste) * 2;
    if (scoreA !== scoreB) return scoreA - scoreB;
    const tasteDelta = tasteScore(b, weights) - tasteScore(a, weights);
    if (tasteDelta) return tasteDelta;
    return byTitle(a, b);
  };

  if (chip === "browse") {
    pool.sort(sortGeneral);
    return {
      results: pool.slice(0, limit).map((candidate) => present(
        candidate,
        candidate.status === "finished"
          ? "Already finished, so it is ranked lower."
          : candidate.status === "dropped"
            ? "Dropped, so it is ranked lower."
            : candidate.status === "in_progress"
              ? "In progress, ranked after shows you have not started."
              : "On this page and not finished.",
      )),
      notice: "Watched titles on this page are ranked lower.",
      skippedUnmatched: 0,
    };
  }

  if (chip === "unwatched") {
    pool = pool.filter((candidate) => candidate.status !== "finished" && candidate.status !== "dropped");
    pool.sort(sortGeneral);
    return {
      results: pool.slice(0, limit).map((candidate) => present(
        candidate,
        candidate.status === "in_progress" ? "In progress, not finished." : "Not marked watched.",
      )),
      notice: "",
      skippedUnmatched: 0,
    };
  }

  if (chip === "one-cour") {
    const kept = [];
    for (const candidate of pool) {
      const count = episodeCount(candidate);
      if (count == null) {
        skippedUnmatched += 1;
        continue;
      }
      if (count >= 10 && count <= 13 && candidate.status !== "finished" && candidate.status !== "dropped") {
        kept.push(candidate);
      }
    }
    kept.sort(sortGeneral);
    return {
      results: kept.slice(0, limit).map((candidate) => present(candidate, `${episodeCount(candidate)} episodes.`)),
      notice: skipNotice(skippedUnmatched),
      skippedUnmatched,
    };
  }

  if (chip === "movie") {
    const kept = [];
    for (const candidate of pool) {
      if (isMovie(candidate)) {
        if (candidate.status === "finished" || candidate.status === "dropped") continue;
        kept.push(candidate);
        continue;
      }
      if (!candidate.anilistMatched && !candidate.movieSignal) skippedUnmatched += 1;
    }
    kept.sort(sortGeneral);
    return {
      results: kept.slice(0, limit).map((candidate) => present(
        candidate,
        candidate.format === "MOVIE" ? "Listed as a movie." : "Marked as a movie on this page.",
      )),
      notice: skipNotice(skippedUnmatched),
      skippedUnmatched,
    };
  }

  if (chip === "more-like-this") {
    if (!current) {
      return { results: [], notice: "Open a series to compare similar shows.", skippedUnmatched: 0 };
    }
    const currentLabels = [...(current.tags || []), ...(current.genres || [])];
    if (!currentLabels.length) {
      return {
        results: [],
        notice: "This show has no tags or genres to compare.",
        skippedUnmatched: 0,
      };
    }
    const kept = [];
    for (const candidate of pool) {
      if (candidate.id === current.id) continue;
      if (!candidate.anilistMatched) {
        skippedUnmatched += 1;
        continue;
      }
      if (options.skipSeenSequels && candidate.franchiseKey && candidate.franchiseKey === current.franchiseKey && candidate.status === "finished") {
        continue;
      }
      const shared = sharedLabels(current, candidate);
      if (!shared.length && currentLabels.length) continue;
      kept.push({ candidate, shared });
    }
    kept.sort((a, b) => {
      if (b.shared.length !== a.shared.length) return b.shared.length - a.shared.length;
      const sinkA = a.candidate.franchiseKey === current.franchiseKey && a.candidate.status === "finished" ? 1 : 0;
      const sinkB = b.candidate.franchiseKey === current.franchiseKey && b.candidate.status === "finished" ? 1 : 0;
      if (sinkA !== sinkB) return sinkA - sinkB;
      return sortGeneral(a.candidate, b.candidate);
    });
    return {
      results: kept.slice(0, limit).map(({ candidate, shared }) => present(
        candidate,
        shared.length ? `Shares ${shared.slice(0, 3).join(", ")}.` : "Overlaps this show.",
        shared,
      )),
      notice: skipNotice(skippedUnmatched),
      skippedUnmatched,
    };
  }

  return { results: [], notice: "", skippedUnmatched: 0 };
}
