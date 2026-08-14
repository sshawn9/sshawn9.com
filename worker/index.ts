import {
  WALLPAPER_ENDPOINT,
  isWallpaperManifest,
  type WallpaperManifest,
  type WallpaperPhoto,
} from '../src/lib/wallpaper';

const MANIFEST_KEY = 'wallpaper-manifest-v1';
const MAX_PHOTOS = 10;
const MIN_PHOTOS = 4;
const MAX_MANIFEST_AGE_MS = 36 * 60 * 60 * 1000;
const UNSPLASH_SEARCH_URL = 'https://api.unsplash.com/search/photos';
const UNSPLASH_QUERY = 'scenic natural landscape';
const UTM_SOURCE = 'sshawn9.com';

type KvNamespace = {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
};

type AssetsBinding = {
  fetch(request: Request): Promise<Response>;
};

type WorkerEnvironment = {
  ASSETS: AssetsBinding;
  WALLPAPER_MANIFEST: KvNamespace;
  UNSPLASH_ACCESS_KEY: string;
};

type WorkerContext = {
  waitUntil(promise: Promise<unknown>): void;
};

type UnsplashPhoto = {
  id: string;
  width: number;
  height: number;
  urls: { raw: string };
  links: { html: string; download_location: string };
  user: { name: string; links: { html: string } };
};

type UnsplashSearchResponse = {
  results: UnsplashPhoto[];
};

let refreshInFlight: Promise<WallpaperManifest> | undefined;

function unsplashHeaders(accessKey: string) {
  return {
    Accept: 'application/json',
    'Accept-Version': 'v1',
    Authorization: `Client-ID ${accessKey}`,
  };
}

function addAttributionParameters(value: string, content: string) {
  const url = new URL(value);
  url.searchParams.set('utm_source', UTM_SOURCE);
  url.searchParams.set('utm_medium', 'referral');
  url.searchParams.set('utm_content', content);
  return url.toString();
}

function isSupportedPhoto(photo: UnsplashPhoto) {
  try {
    return (
      photo.width >= 2400 &&
      photo.height >= 1350 &&
      photo.width / photo.height >= 1.4 &&
      new URL(photo.urls.raw).hostname === 'images.unsplash.com' &&
      new URL(photo.links.html).hostname.endsWith('unsplash.com') &&
      new URL(photo.user.links.html).hostname.endsWith('unsplash.com') &&
      new URL(photo.links.download_location).hostname === 'api.unsplash.com'
    );
  } catch {
    return false;
  }
}

function toWallpaperPhoto(photo: UnsplashPhoto): WallpaperPhoto {
  return {
    id: photo.id,
    width: photo.width,
    height: photo.height,
    rawUrl: photo.urls.raw,
    photographerName: photo.user.name,
    photographerUrl: addAttributionParameters(photo.user.links.html, 'credit-photographer'),
    photoUrl: addAttributionParameters(photo.links.html, 'credit-photo'),
  };
}

async function trackDownload(photo: UnsplashPhoto, accessKey: string) {
  const response = await fetch(photo.links.download_location, {
    headers: unsplashHeaders(accessKey),
  });
  if (!response.ok) {
    throw new Error(`Unsplash download tracking failed with status ${response.status}.`);
  }
}

export async function refreshWallpaperManifest(
  env: Pick<WorkerEnvironment, 'WALLPAPER_MANIFEST' | 'UNSPLASH_ACCESS_KEY'>,
) {
  const searchUrl = new URL(UNSPLASH_SEARCH_URL);
  searchUrl.searchParams.set('query', UNSPLASH_QUERY);
  searchUrl.searchParams.set('orientation', 'landscape');
  searchUrl.searchParams.set('order_by', 'latest');
  searchUrl.searchParams.set('content_filter', 'high');
  searchUrl.searchParams.set('per_page', '30');

  const response = await fetch(searchUrl, {
    headers: unsplashHeaders(env.UNSPLASH_ACCESS_KEY),
  });
  if (!response.ok) {
    throw new Error(`Unsplash search failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as UnsplashSearchResponse;
  const candidates = Array.isArray(payload.results)
    ? payload.results.filter(isSupportedPhoto).slice(0, MAX_PHOTOS)
    : [];

  const trackedPhotos = await Promise.allSettled(
    candidates.map(async (photo) => {
      await trackDownload(photo, env.UNSPLASH_ACCESS_KEY);
      return toWallpaperPhoto(photo);
    }),
  );
  const photos = trackedPhotos.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );

  if (photos.length < MIN_PHOTOS) {
    throw new Error(`Unsplash returned only ${photos.length} usable wallpaper photos.`);
  }

  const manifest: WallpaperManifest = {
    version: 1,
    updatedAt: new Date().toISOString(),
    photos,
  };
  await env.WALLPAPER_MANIFEST.put(MANIFEST_KEY, JSON.stringify(manifest));
  return manifest;
}

function refreshOnce(env: WorkerEnvironment) {
  if (!refreshInFlight) {
    refreshInFlight = refreshWallpaperManifest(env).finally(() => {
      refreshInFlight = undefined;
    });
  }
  return refreshInFlight;
}

async function readManifest(env: WorkerEnvironment) {
  const value = await env.WALLPAPER_MANIFEST.get(MANIFEST_KEY, 'json');
  return isWallpaperManifest(value) ? value : undefined;
}

function isStale(manifest: WallpaperManifest) {
  const updatedAt = Date.parse(manifest.updatedAt);
  return !Number.isFinite(updatedAt) || Date.now() - updatedAt > MAX_MANIFEST_AGE_MS;
}

function manifestResponse(manifest?: WallpaperManifest, request?: Request) {
  const body = JSON.stringify(
    manifest ?? { version: 1, updatedAt: new Date(0).toISOString(), photos: [] },
  );
  const etag = manifest ? `W/\"wallpapers-${manifest.updatedAt}\"` : undefined;
  const headers = new Headers({
    'Cache-Control': manifest ? 'public, max-age=900, stale-while-revalidate=86400' : 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  });
  if (etag) headers.set('ETag', etag);

  if (etag && request?.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request?.method === 'HEAD' ? null : body, { headers });
}

export async function handleWallpaperRequest(
  request: Request,
  env: WorkerEnvironment,
  context: WorkerContext,
) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    });
  }

  let manifest = await readManifest(env);
  if (!manifest) {
    try {
      manifest = await refreshOnce(env);
    } catch (error) {
      console.error('Unable to initialize the wallpaper manifest.', error);
      return manifestResponse(undefined, request);
    }
  } else if (isStale(manifest)) {
    context.waitUntil(
      refreshOnce(env).catch((error) => {
        console.error('Unable to refresh the stale wallpaper manifest.', error);
      }),
    );
  }

  return manifestResponse(manifest, request);
}

export default {
  async fetch(request: Request, env: WorkerEnvironment, context: WorkerContext) {
    const url = new URL(request.url);
    if (url.pathname === WALLPAPER_ENDPOINT) {
      return handleWallpaperRequest(request, env, context);
    }
    return env.ASSETS.fetch(request);
  },

  scheduled(_controller: unknown, env: WorkerEnvironment, context: WorkerContext) {
    context.waitUntil(
      refreshOnce(env).catch((error) => {
        console.error('Scheduled wallpaper refresh failed.', error);
        throw error;
      }),
    );
  },
};
