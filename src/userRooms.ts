import type { SplatRoomConfig } from "./rooms";

// Splat files the user drops onto the page are kept in the browser's own
// database (IndexedDB), so they are still there after a reload. They never
// leave this computer.

const DB_NAME = "window-room";
const STORE = "rooms";
export const SPLAT_EXTENSIONS = ["ply", "spz", "splat", "ksplat", "sog"];

interface StoredRoom {
  id: string;
  name: string;
  fileName: string;
  blob: Blob;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = work(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

function toConfig(r: StoredRoom): SplatRoomConfig {
  return {
    type: "splat",
    id: r.id,
    name: r.name,
    url: URL.createObjectURL(r.blob),
    fileName: r.fileName,
    user: true,
    // Placeholder; replaced by an automatic fit once the file has loaded.
    windowWidth: 2,
    position: [0, 0, 0],
    rotationDeg: [180, 0, 0],
  };
}

export function isSplatFile(name: string): boolean {
  return SPLAT_EXTENSIONS.includes(name.split(".").pop()?.toLowerCase() ?? "");
}

export async function listUserRooms(): Promise<SplatRoomConfig[]> {
  try {
    const all = await run<StoredRoom[]>("readonly", (s) => s.getAll());
    return all.map(toConfig);
  } catch {
    return [];
  }
}

export async function addUserRoom(file: File): Promise<SplatRoomConfig> {
  const stored: StoredRoom = {
    id: `user-${Date.now().toString(36)}`,
    name: file.name.replace(/\.[^.]+$/, ""),
    fileName: file.name,
    blob: file,
  };
  try {
    await run("readwrite", (s) => s.put(stored));
  } catch {
    // Could not be stored (private window, or out of space): the room still
    // works for this visit, it just won't be there after a reload.
  }
  return toConfig(stored);
}

export async function deleteUserRoom(config: SplatRoomConfig): Promise<void> {
  URL.revokeObjectURL(config.url);
  try {
    await run("readwrite", (s) => s.delete(config.id));
  } catch {
    // Nothing stored, nothing to remove.
  }
}
