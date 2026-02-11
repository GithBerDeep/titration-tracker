// db.js - minimal IndexedDB wrapper (no dependencies)
const DB_NAME = "titration-tracker";
const DB_VERSION = 1;
const STORE = "entries";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("takenAt", "takenAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(storeName, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const res = fn(store);
    t.oncomplete = () => resolve(res);
    t.onerror = () => reject(t.error);
  }));
}

export function putEntry(entry) {
  return tx(STORE, "readwrite", store => store.put(entry));
}

export function deleteEntry(id) {
  return tx(STORE, "readwrite", store => store.delete(id));
}

export function getEntry(id) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readonly");
    const store = t.objectStore(STORE);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }));
}

export function getAllEntries() {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readonly");
    const store = t.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const arr = req.result || [];
      // sort by takenAt desc (ISO with offset sorts lexicographically for same offset; good enough)
      arr.sort((a,b) => (b.takenAt || "").localeCompare(a.takenAt || ""));
      resolve(arr);
    };
    req.onerror = () => reject(req.error);
  }));
}

export function bulkUpsert(entries) {
  return tx(STORE, "readwrite", store => {
    for (const e of entries) store.put(e);
    return true;
  });
}
