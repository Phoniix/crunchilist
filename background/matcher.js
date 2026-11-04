// Offline title matcher backed by the master list in IndexedDB.
import { readAllShows } from "../lib/idb.js";
import { createMatcher } from "../lib/match-engine.js";

let cache = { updated: "", matcher: null };

export async function matcher() {
  const { rows, header } = await readAllShows();
  if (!rows.length) throw new Error("The master list hasn't downloaded yet. Open Settings and refresh title feeds.");
  if (cache.updated !== header?.updated || !cache.matcher) {
    cache = { updated: header?.updated || "", matcher: createMatcher(rows) };
  }
  return cache.matcher;
}
