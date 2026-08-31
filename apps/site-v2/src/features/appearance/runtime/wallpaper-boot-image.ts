const WALLPAPER_BOOT_IMAGE_TYPES = new Set([
  'image/avif',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);
const RESPONSIVE_IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
const WALLPAPER_BOOT_CAPTURE_TIMEOUT_MS = 8_000;

export const MAX_WALLPAPER_BOOT_IMAGE_BYTES = 2_500_000;
export const MAX_WALLPAPER_BOOT_DATA_URL_LENGTH =
  Math.ceil((MAX_WALLPAPER_BOOT_IMAGE_BYTES * 4) / 3) + 128;
export const WALLPAPER_BOOT_DATA_URL_PATTERN =
  /^data:image\/(?:avif|jpe?g|png|webp);base64,[a-zA-Z0-9+/]+={0,2}$/;

export function isWallpaperBootDataUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_WALLPAPER_BOOT_DATA_URL_LENGTH &&
    WALLPAPER_BOOT_DATA_URL_PATTERN.test(value)
  );
}

function blobAsDataUrl(
  sourceWindow: Window,
  blob: Blob,
  signal: AbortSignal,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const FileReaderConstructor = (sourceWindow as Window & typeof globalThis).FileReader;
    const reader = new FileReaderConstructor();
    let settled = false;
    const finish = (value: string | undefined): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      resolve(value);
    };
    const abort = (): void => {
      try {
        reader.abort();
      } catch {}
      finish(undefined);
    };
    reader.addEventListener(
      'load',
      () => finish(isWallpaperBootDataUrl(reader.result) ? reader.result : undefined),
      { once: true },
    );
    reader.addEventListener('error', () => finish(undefined), { once: true });
    reader.addEventListener('abort', () => finish(undefined), { once: true });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    try {
      reader.readAsDataURL(blob);
    } catch {
      finish(undefined);
    }
  });
}

async function fetchBootBlob(
  sourceWindow: Window,
  imageUrl: string,
  signal: AbortSignal,
): Promise<Blob | undefined> {
  try {
    const response = await sourceWindow.fetch(imageUrl, {
      cache: 'force-cache',
      headers: { Accept: RESPONSIVE_IMAGE_ACCEPT },
      signal,
    });
    if (!response.ok) return undefined;
    const blob = await response.blob();
    if (
      !WALLPAPER_BOOT_IMAGE_TYPES.has(blob.type.toLowerCase()) ||
      blob.size === 0 ||
      blob.size > MAX_WALLPAPER_BOOT_IMAGE_BYTES
    ) {
      return undefined;
    }
    return blob;
  } catch {
    return undefined;
  }
}

/**
 * Captures the exact responsive image selected by the browser whenever it fits
 * the bounded synchronous restore budget. Only an oversized or unreadable
 * selected asset falls back to the smaller recovery URL.
 */
export async function captureWallpaperBootImage(
  sourceWindow: Window,
  selectedImageUrl: string,
  fallbackImageUrl: string,
): Promise<string | undefined> {
  const AbortControllerConstructor = (sourceWindow as Window & typeof globalThis).AbortController;
  const controller = new AbortControllerConstructor();
  const timeout = sourceWindow.setTimeout(
    () => controller.abort(),
    WALLPAPER_BOOT_CAPTURE_TIMEOUT_MS,
  );
  try {
    const selected = await fetchBootBlob(sourceWindow, selectedImageUrl, controller.signal);
    if (selected) return await blobAsDataUrl(sourceWindow, selected, controller.signal);
    if (selectedImageUrl === fallbackImageUrl || controller.signal.aborted) return undefined;
    const fallback = await fetchBootBlob(sourceWindow, fallbackImageUrl, controller.signal);
    return fallback ? await blobAsDataUrl(sourceWindow, fallback, controller.signal) : undefined;
  } catch {
    return undefined;
  } finally {
    sourceWindow.clearTimeout(timeout);
  }
}
