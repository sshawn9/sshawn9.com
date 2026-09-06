import type { Page } from '@playwright/test';
import type { WallpaperPhoto } from '@sshawn9/site-domain/wallpaper';

export const photos = [
  {
    id: 'photo-one',
    createdAt: '2026-08-28T00:00:00.000Z',
    blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    rawUrl: 'https://images.unsplash.com/photo-one?ixid=one',
    photographerName: 'First Photographer',
    photographerUrl: 'https://unsplash.com/@first?utm_source=sshawn9.com',
    photoUrl: 'https://unsplash.com/photos/photo-one?utm_source=sshawn9.com',
  },
  {
    id: 'photo-two',
    createdAt: '2026-08-29T00:00:00.000Z',
    blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    rawUrl: 'https://images.unsplash.com/photo-two?ixid=two',
    photographerName: 'Second Photographer',
    photographerUrl: 'https://unsplash.com/@second?utm_source=sshawn9.com',
    photoUrl: 'https://unsplash.com/photos/photo-two?utm_source=sshawn9.com',
  },
] as const;

export const manifest = {
  version: 2,
  updatedAt: '2026-08-29T00:00:00.000Z',
  photos,
};

export const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVQYlWMISq8iCTGMakgfDKEEALF9rLGZ8m0AAAAAAElFTkSuQmCC',
  'base64',
);

export const dataUrl = `data:image/png;base64,${image.toString('base64')}`;

export function imageUrl(rawUrl: string, width: number): string {
  const url = new URL(rawUrl);
  url.searchParams.set('auto', 'format');
  url.searchParams.set('fit', 'max');
  url.searchParams.set('q', '80');
  url.searchParams.set('w', String(width));
  return url.toString();
}

export function policyKey(width: number): string {
  return `v1-w${width}-q80-auto`;
}

export async function routeWallpaperResources(
  page: Page,
  sourcePhotos: readonly WallpaperPhoto[] = photos,
): Promise<string[]> {
  const requests: string[] = [];
  await page.route('**/api/wallpapers', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ...manifest, photos: sourcePhotos }),
    }),
  );
  await page.route('https://images.unsplash.com/**', (route) => {
    requests.push(route.request().url());
    return route.fulfill({
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: image,
    });
  });
  return requests;
}

export async function seedTwoSlots(
  page: Page,
  width: number,
  { enabled = true, autoRotation = false }: { enabled?: boolean; autoRotation?: boolean } = {},
): Promise<void> {
  await page.addInitScript(
    ({ photos, dataUrl, width, enabled, autoRotation }) => {
      if (sessionStorage.getItem('__wallpaper-test-seeded')) return;
      sessionStorage.setItem('__wallpaper-test-seeded', 'true');
      localStorage.setItem('wallpaper-enabled', String(enabled));
      localStorage.setItem('wallpaper-auto-rotation', String(autoRotation));
      const policyKey = `v1-w${width}-q80-auto`;
      const url = (rawUrl: string) => {
        const value = new URL(rawUrl);
        value.searchParams.set('auto', 'format');
        value.searchParams.set('fit', 'max');
        value.searchParams.set('q', '80');
        value.searchParams.set('w', String(width));
        return value.toString();
      };
      sessionStorage.setItem(
        'wallpaper-tab-state-v3',
        JSON.stringify({ version: 3, currentSlot: 'a', queueIds: [] }),
      );
      for (const [slot, photo] of [
        ['a', photos[0]],
        ['b', photos[1]],
      ] as const) {
        sessionStorage.setItem(
          `wallpaper-slot-${slot}-meta-v3`,
          JSON.stringify({
            version: 1,
            photo,
            policyKey,
            imageUrl: url(photo.rawUrl),
            byteSize: 128,
          }),
        );
        sessionStorage.setItem(`wallpaper-slot-${slot}-data-v3`, dataUrl);
      }
    },
    { photos, dataUrl, width, enabled, autoRotation },
  );
}
