export type WallpaperItem = { id: string; url: string; credit: string; creditUrl?: string; filename?: string };
export type CachedWallpaper = { item: WallpaperItem; blob: Blob };
export type WallpaperSnapshot = { version: 1; current: CachedWallpaper | null; next: CachedWallpaper | null };
export interface WallpaperCache {
  read(signal: AbortSignal): Promise<unknown>;
  write(snapshot: WallpaperSnapshot, signal: AbortSignal): Promise<void>;
  clear(signal: AbortSignal): Promise<void>;
}
export interface PreparedWallpaper extends CachedWallpaper { image: HTMLImageElement | null; release(): void }
export interface WallpaperView {
  /** Synchronous atomic commit. Takes ownership of release(), including on clear(). */
  commit(value: PreparedWallpaper, options: { animate: boolean }): void;
  setEnabled(enabled: boolean): void;
  clear(): void;
}
export interface WallpaperOptions {
  source: (context: { currentId: string | null; signal: AbortSignal }) => Promise<WallpaperItem | null>;
  fontsReady: (item: WallpaperItem, signal: AbortSignal) => Promise<void>;
  view: WallpaperView;
  cache?: WallpaperCache;
  prepareImage?: (item: WallpaperItem, signal: AbortSignal, cachedBlob?: Blob) => Promise<PreparedWallpaper>;
  download?: (current: CachedWallpaper) => void | Promise<void>;
  timeoutMs?: number;
  rotationMs?: number;
}
export type WallpaperState = { initialized: boolean; enabled: boolean; busy: boolean; autoRotate: boolean; currentId: string | null; error: string | null };
export interface WallpaperController {
  init(options?: { enabled?: boolean; autoRotate?: boolean }): Promise<void>;
  next(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
  setAutoRotate(enabled: boolean): void;
  cancel(): void;
  destroy(): void;
  download(): Promise<void>;
  getState(): WallpaperState;
  subscribe(callback: (state: WallpaperState) => void): () => void;
}
export const isItem = (v: unknown): v is WallpaperItem => {
  if (!v || typeof v !== 'object') return false;
  const x = v as Record<string, unknown>;
  return typeof x.id === 'string' && x.id.length > 0 && typeof x.url === 'string' && x.url.length > 0 && typeof x.credit === 'string' && x.credit.length > 0 &&
    (x.creditUrl === undefined || typeof x.creditUrl === 'string') && (x.filename === undefined || typeof x.filename === 'string');
};
export const isCached = (v: unknown): v is CachedWallpaper => {
  if (!v || typeof v !== 'object') return false;
  const x = v as CachedWallpaper;
  return isItem(x.item) && x.blob instanceof Blob && x.blob.size > 0 && x.blob.type.startsWith('image/');
};
export const isSnapshot = (v: unknown): v is WallpaperSnapshot => {
  if (!v || typeof v !== 'object') return false;
  const x = v as WallpaperSnapshot;
  return x.version === 1 && (x.current === null || isCached(x.current)) && (x.next === null || isCached(x.next));
};
