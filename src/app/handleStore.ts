import type { DirectoryHandleLike } from '../workspace/types';

const DB_NAME = 'browser-record';
const DB_VERSION = 1;
const STORE = 'handles';
const KEY = 'workspace-root';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
  });
}

/**
 * Remember the workspace folder across sessions. Browsers keep the permission
 * grant; if it was revoked the handle still loads and we ask again on use.
 */
export async function saveWorkspaceHandle(handle: DirectoryHandleLike): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not store the workspace handle'));
    });
    db.close();
  } catch (error) {
    // Not fatal: the user can pick the folder again.
    console.warn('Workspace handle could not be saved:', error);
  }
}

export async function loadWorkspaceHandle(): Promise<DirectoryHandleLike | null> {
  try {
    const db = await openDb();
    const handle = await new Promise<DirectoryHandleLike | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve((request.result as DirectoryHandleLike | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('Could not read the workspace handle'));
    });
    db.close();
    return handle;
  } catch {
    return null;
  }
}

export async function clearWorkspaceHandle(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    /* nothing to clear */
  }
}

export async function ensurePermission(handle: DirectoryHandleLike & {
  queryPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
}): Promise<boolean> {
  try {
    const query = handle.queryPermission
      ? await handle.queryPermission({ mode: 'readwrite' })
      : 'granted';
    if (query === 'granted') return true;
    if (!handle.requestPermission) return false;
    const result = await handle.requestPermission({ mode: 'readwrite' });
    return result === 'granted';
  } catch {
    return false;
  }
}
