import type { WallpaperPhoto } from '@sshawn9/site-domain/wallpaper';
import { DOWNLOAD_ENDPOINT, DOWNLOAD_TIMEOUT_MS } from './model';

const DOWNLOAD_WIDTH = 2400;

function downloadUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.searchParams.delete('auto');
  url.searchParams.set('fit', 'max');
  url.searchParams.set('fm', 'jpg');
  url.searchParams.set('q', '90');
  url.searchParams.set('w', String(DOWNLOAD_WIDTH));
  return url.toString();
}

/** Performs only the visitor's explicit file download and its Unsplash report. */
export async function downloadWallpaper(
  target: Document,
  sourceWindow: Window,
  photo: WallpaperPhoto,
): Promise<void> {
  const AbortControllerConstructor = (sourceWindow as Window & typeof globalThis).AbortController;
  const controller = new AbortControllerConstructor();
  const timeout = sourceWindow.setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let blob: Blob;
  try {
    const response = await sourceWindow.fetch(downloadUrl(photo.rawUrl), {
      signal: controller.signal,
    });
    if (!response.ok) {
      controller.abort();
      return;
    }
    blob = await response.blob();
  } finally {
    sourceWindow.clearTimeout(timeout);
  }

  const URLConstructor = (sourceWindow as Window & typeof globalThis).URL;
  const objectUrl = URLConstructor.createObjectURL(blob);
  const link = target.createElement('a');
  link.href = objectUrl;
  link.download = `unsplash-${photo.id.replace(/[^a-zA-Z0-9_-]/g, '-')}.jpg`;
  link.hidden = true;
  target.body.append(link);
  link.click();
  link.remove();
  sourceWindow.setTimeout(() => URLConstructor.revokeObjectURL(objectUrl), 1000);

  void sourceWindow
    .fetch(DOWNLOAD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoId: photo.id }),
      keepalive: true,
    })
    .catch(() => undefined);
}
