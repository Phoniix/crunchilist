export function interpretLocalRequest(text) {
  const value = String(text || "").toLowerCase();
  if (!value.trim()) return null;
  const skipSequels = /sequel/.test(value);
  if (/more like|similar|like this/.test(value)) return { chip: "more-like-this", skipSequels };
  if (/\bmovie\b|\bfilm\b/.test(value)) return { chip: "movie" };
  if (/one cour|single cour|12 episode|10-13|short season|about 12/.test(value)) return { chip: "one-cour" };
  if (/unwatched|not watched|haven'?t (seen|watched)|new to me|something new/.test(value)) return { chip: "unwatched" };
  if (skipSequels) return { chip: "more-like-this", skipSequels: true };
  return null;
}
