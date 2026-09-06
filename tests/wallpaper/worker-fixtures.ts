export class MemoryKv {
  values = new Map<string, string>();
  putCalls = 0;

  async get(key: string, type: 'json') {
    const value = this.values.get(key);
    if (type === 'json' && value) return JSON.parse(value) as unknown;
    return undefined;
  }

  async put(key: string, value: string) {
    this.putCalls += 1;
    this.values.set(key, value);
  }
}

export function unsplashPhoto(index: number) {
  return {
    id: `photo-${index}`,
    created_at: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
    blur_hash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    width: 3600,
    height: 2400,
    urls: { raw: `https://images.unsplash.com/photo-${index}` },
    links: {
      html: `https://unsplash.com/photos/photo-${index}`,
      download_location: `https://api.unsplash.com/photos/photo-${index}/download`,
    },
    user: {
      name: `Photographer ${index}`,
      links: { html: `https://unsplash.com/@photographer-${index}` },
    },
  };
}

export function storedWallpaperPhoto(index: number) {
  const photographerUrl = new URL(`https://unsplash.com/@photographer-${index}`);
  photographerUrl.searchParams.set('utm_source', 'sshawn9.com');
  photographerUrl.searchParams.set('utm_medium', 'referral');
  photographerUrl.searchParams.set('utm_content', 'credit-photographer');
  const photoUrl = new URL(`https://unsplash.com/photos/photo-${index}`);
  photoUrl.searchParams.set('utm_source', 'sshawn9.com');
  photoUrl.searchParams.set('utm_medium', 'referral');
  photoUrl.searchParams.set('utm_content', 'credit-photo');

  return {
    id: `photo-${index}`,
    createdAt: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
    blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    rawUrl: `https://images.unsplash.com/photo-${index}`,
    photographerName: `Photographer ${index}`,
    photographerUrl: photographerUrl.toString(),
    photoUrl: photoUrl.toString(),
    downloadLocation: `https://api.unsplash.com/photos/photo-${index}/download`,
  };
}

export function storedManifest(updatedAt = new Date().toISOString()) {
  return {
    version: 2 as const,
    updatedAt,
    photos: [
      {
        id: 'cached',
        createdAt: '2026-01-01T00:00:00.000Z',
        blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        rawUrl: 'https://images.unsplash.com/cached',
        photographerName: 'Cached Photographer',
        photographerUrl: 'https://unsplash.com/@cached',
        photoUrl: 'https://unsplash.com/photos/cached',
        downloadLocation: 'https://api.unsplash.com/photos/cached/download?ixid=cached',
      },
    ],
  };
}
