import type { WallpaperCache, WallpaperSnapshot } from './wallpaper-types.js';
import { abortError } from './abort.js';

export function createIndexedDbWallpaperCache(options: { databaseName: string; indexedDB?: IDBFactory }): WallpaperCache {
  if (!options.databaseName.trim()) throw new Error('A dedicated cache database name is required');
  function open(signal: AbortSignal): Promise<IDBDatabase> {
    signal.throwIfAborted();
    const factory = options.indexedDB ?? globalThis.indexedDB;
    if (!factory) return Promise.reject(new Error('IndexedDB unavailable'));
    return new Promise((resolve, reject) => {
      let failed = false;
      const request = factory.open(options.databaseName, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('wallpapers'); };
      request.onerror = () => { failed = true; reject(request.error); };
      request.onblocked = () => { failed = true; reject(new Error('Wallpaper cache is blocked by another connection')); };
      request.onsuccess = () => {
        if (failed || signal.aborted) { request.result.close(); reject(signal.reason ?? abortError()); }
        else resolve(request.result);
      };
    });
  }
  async function transact(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest, signal: AbortSignal): Promise<unknown> {
    const database = await open(signal);
    if (signal.aborted) { database.close(); throw signal.reason ?? abortError(); }
    return new Promise((resolve, reject) => {
      let transaction: IDBTransaction;
      try { transaction = database.transaction('wallpapers', mode); }
      catch (error) { database.close(); reject(error); return; }
      const abort = () => { try { transaction.abort(); } catch { /* Already completed. */ } };
      signal.addEventListener('abort', abort, { once: true });
      let result: unknown;
      const finish = () => { signal.removeEventListener('abort', abort); database.close(); };
      transaction.oncomplete = () => { finish(); resolve(result); };
      transaction.onerror = () => { finish(); reject(transaction.error); };
      transaction.onabort = () => { finish(); reject(signal.aborted ? (signal.reason ?? abortError()) : transaction.error); };
      try {
        const request = action(transaction.objectStore('wallpapers'));
        request.onsuccess = () => { result = request.result; };
      } catch (error) { abort(); finish(); reject(error); }
    });
  }
  return {
    read: signal => transact('readonly', store => store.get('snapshot'), signal),
    async write(snapshot: WallpaperSnapshot, signal: AbortSignal) { await transact('readwrite', store => store.put(snapshot, 'snapshot'), signal); },
    async clear(signal) { await transact('readwrite', store => store.delete('snapshot'), signal); },
  };
}
