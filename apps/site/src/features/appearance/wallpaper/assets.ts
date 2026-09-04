import {
  isWallpaperManifest,
  type WallpaperManifest,
  type WallpaperPhoto,
} from '@sshawn9/site-domain/wallpaper';
import {
  IMAGE_TIMEOUT_MS,
  MANIFEST_ENDPOINT,
  MAX_IMAGE_BYTES,
  createImageUrl,
  isWallpaperDataUrl,
  type ImagePolicy,
  type WallpaperAsset,
} from './model';

const IMAGE_TYPES = new Set(['image/avif', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';

function blobAsDataUrl(sourceWindow: Window, blob: Blob): Promise<string | undefined> {
  return new Promise((resolve) => {
    const Reader = (sourceWindow as Window & typeof globalThis).FileReader;
    const reader = new Reader();
    reader.addEventListener(
      'load',
      () => resolve(isWallpaperDataUrl(reader.result) ? reader.result : undefined),
      { once: true },
    );
    reader.addEventListener('error', () => resolve(undefined), { once: true });
    reader.addEventListener('abort', () => resolve(undefined), { once: true });
    try {
      reader.readAsDataURL(blob);
    } catch {
      resolve(undefined);
    }
  });
}

/** Confirms that a prepared image can be painted before it replaces the current slot. */
export async function decodeDataUrl(sourceWindow: Window, dataUrl: string): Promise<boolean> {
  const ImageConstructor = (sourceWindow as Window & typeof globalThis).Image;
  const image = new ImageConstructor();
  image.decoding = 'async';
  image.src = dataUrl;
  let timeout: number | undefined;
  const decoded = image
    .decode()
    .then(() => image.naturalWidth > 0)
    .catch(() => image.complete && image.naturalWidth > 0);
  const expired = new Promise<false>((resolve) => {
    timeout = sourceWindow.setTimeout(() => resolve(false), IMAGE_TIMEOUT_MS);
  });
  const result = await Promise.race([decoded, expired]);
  if (timeout !== undefined) sourceWindow.clearTimeout(timeout);
  image.removeAttribute('src');
  return result;
}

/** Downloads one bounded display representation; no client-side image re-encoding occurs. */
export async function fetchWallpaperAsset(
  sourceWindow: Window,
  photo: WallpaperPhoto,
  policy: ImagePolicy,
): Promise<WallpaperAsset | undefined> {
  const imageUrl = createImageUrl(photo.rawUrl, policy);
  const AbortControllerConstructor = (sourceWindow as Window & typeof globalThis).AbortController;
  const controller = new AbortControllerConstructor();
  const timeout = sourceWindow.setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await sourceWindow.fetch(imageUrl, {
      cache: 'default',
      headers: { Accept: IMAGE_ACCEPT },
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const blob = await response.blob();
    if (
      !IMAGE_TYPES.has(blob.type.toLowerCase()) ||
      blob.size === 0 ||
      blob.size > MAX_IMAGE_BYTES
    ) {
      return undefined;
    }
    const dataUrl = await blobAsDataUrl(sourceWindow, blob);
    if (!dataUrl || !(await decodeDataUrl(sourceWindow, dataUrl))) return undefined;
    return {
      version: 1,
      photo,
      policyKey: policy.key,
      imageUrl,
      byteSize: blob.size,
      dataUrl,
    };
  } catch {
    return undefined;
  } finally {
    sourceWindow.clearTimeout(timeout);
  }
}

/** Owns remote metadata caching; it never selects or displays a photo. */
export class WallpaperManifestSource {
  private manifest?: WallpaperManifest;
  private pending?: Promise<WallpaperManifest | undefined>;

  constructor(private readonly sourceWindow: Window) {}

  get current(): WallpaperManifest | undefined {
    return this.manifest;
  }

  async load(revalidate = false): Promise<WallpaperManifest | undefined> {
    if (this.pending) return this.pending;
    if (!revalidate && this.manifest) return this.manifest;

    this.pending = this.sourceWindow
      .fetch(MANIFEST_ENDPOINT, {
        cache: revalidate ? 'no-cache' : 'default',
        headers: { Accept: 'application/json' },
      })
      .then(async (response) => {
        if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) {
          return undefined;
        }
        const value: unknown = await response.json();
        return isWallpaperManifest(value) ? value : undefined;
      })
      .catch(() => undefined)
      .finally(() => {
        this.pending = undefined;
      });
    const manifest = await this.pending;
    if (manifest) this.manifest = manifest;
    return manifest;
  }
}
