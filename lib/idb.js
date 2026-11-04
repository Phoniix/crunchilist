// A small IndexedDB wrapper; the master list is far too big for chrome.storage.
const DB_NAME = "kivori-sekai";
const DB_VERSION = 1;
let opening = null;

export function openDb(indexedDBImpl = globalThis.indexedDB) {
  opening ||= new Promise((resolve, reject) => {
    const request = indexedDBImpl.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("shows")) db.createObjectStore("shows", { keyPath: "a" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = null; reject(request.error); };
  });
  return opening;
}

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error("IndexedDB write was aborted"));
});

const result = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

// Swaps in a whole new master list in one transaction, so readers never see half of one.
export async function replaceShows(rows, header) {
  const db = await openDb();
  const tx = db.transaction(["shows", "meta"], "readwrite");
  const shows = tx.objectStore("shows");
  shows.clear();
  for (const row of rows) shows.put(row);
  tx.objectStore("meta").put(header, "idMap");
  await done(tx);
}

export async function readShow(anilistId) {
  const db = await openDb();
  const tx = db.transaction(["shows", "meta"], "readonly");
  const [row, header] = await Promise.all([result(tx.objectStore("shows").get(anilistId)), result(tx.objectStore("meta").get("idMap"))]);
  return row && header ? { row, header } : null;
}

export async function readAllShows() {
  const db = await openDb();
  const tx = db.transaction(["shows", "meta"], "readonly");
  const [rows, header] = await Promise.all([result(tx.objectStore("shows").getAll()), result(tx.objectStore("meta").get("idMap"))]);
  return { rows, header: header || null };
}

export async function countShows() {
  const db = await openDb();
  return result(db.transaction("shows", "readonly").objectStore("shows").count());
}
