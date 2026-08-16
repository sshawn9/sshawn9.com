import {
  WALLPAPER_DOWNLOAD_ENDPOINT,
  WALLPAPER_ENDPOINT,
  isWallpaperManifest,
  type WallpaperManifest,
  type WallpaperPhoto,
} from '../src/lib/wallpaper';

const MANIFEST_KEY = 'wallpaper-manifest-v1';
const MAX_POOL_PHOTOS = 250;
const MIN_PHOTOS = 4;
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
  created_at: string;
  blur_hash: string | null;
  width: number;
  height: number;
  urls: { raw: string };
  links: { html: string; download_location: string };
  user: { name: string; links: { html: string } };
};

type UnsplashSearchResponse = {
  results: UnsplashPhoto[];
};

type SupportedUnsplashPhoto = UnsplashPhoto & { blur_hash: string };

type StoredWallpaperPhoto = WallpaperPhoto & {
  downloadLocation: string;
};

type StoredWallpaperManifest = Omit<WallpaperManifest, 'photos'> & {
  photos: StoredWallpaperPhoto[];
};

let refreshInFlight: Promise<StoredWallpaperManifest> | undefined;

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

function isUnsplashApiUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'api.unsplash.com';
  } catch {
    return false;
  }
}

function isSupportedPhoto(photo: UnsplashPhoto): photo is SupportedUnsplashPhoto {
  try {
    return (
      typeof photo.id === 'string' &&
      photo.id.length > 0 &&
      typeof photo.created_at === 'string' &&
      Number.isFinite(Date.parse(photo.created_at)) &&
      typeof photo.blur_hash === 'string' &&
      photo.blur_hash.length > 0 &&
      typeof photo.user.name === 'string' &&
      photo.user.name.length > 0 &&
      photo.width >= 2400 &&
      photo.height >= 1350 &&
      photo.width / photo.height >= 1.4 &&
      new URL(photo.urls.raw).hostname === 'images.unsplash.com' &&
      new URL(photo.links.html).hostname.endsWith('unsplash.com') &&
      new URL(photo.user.links.html).hostname.endsWith('unsplash.com') &&
      isUnsplashApiUrl(photo.links.download_location)
    );
  } catch {
    return false;
  }
}

function toStoredWallpaperPhoto(photo: SupportedUnsplashPhoto): StoredWallpaperPhoto {
  return {
    id: photo.id,
    createdAt: photo.created_at,
    blurHash: photo.blur_hash,
    rawUrl: photo.urls.raw,
    photographerName: photo.user.name,
    photographerUrl: addAttributionParameters(photo.user.links.html, 'credit-photographer'),
    photoUrl: addAttributionParameters(photo.links.html, 'credit-photo'),
    downloadLocation: photo.links.download_location,
  };
}

function mergeWallpaperPhotos(
  existingPhotos: StoredWallpaperPhoto[],
  candidates: StoredWallpaperPhoto[],
) {
  const photosById = new Map(existingPhotos.map((photo) => [photo.id, photo]));
  candidates.forEach((photo) => photosById.set(photo.id, photo));

  return [...photosById.values()]
    .sort((left, right) => {
      const timeDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt);
      if (timeDifference !== 0) return timeDifference;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    })
    .slice(-MAX_POOL_PHOTOS);
}

async function trackDownload(downloadLocation: string, accessKey: string) {
  const response = await fetch(downloadLocation, {
    headers: unsplashHeaders(accessKey),
  });
  if (!response.ok) {
    throw new Error(`Unsplash download tracking failed with status ${response.status}.`);
  }
}

export async function refreshWallpaperManifest(
  env: Pick<WorkerEnvironment, 'WALLPAPER_MANIFEST' | 'UNSPLASH_ACCESS_KEY'>,
) {
  const existingManifest = await readManifest(env);
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
    ? payload.results.filter(isSupportedPhoto).map(toStoredWallpaperPhoto)
    : [];
  const existingPhotos = existingManifest?.photos ?? [];
  const photos = mergeWallpaperPhotos(existingPhotos, candidates);

  if (photos.length < MIN_PHOTOS) {
    throw new Error(`Unsplash returned only ${photos.length} usable wallpaper photos.`);
  }

  if (existingManifest && JSON.stringify(existingPhotos) === JSON.stringify(photos)) {
    return existingManifest;
  }

  const manifest: StoredWallpaperManifest = {
    version: 2,
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

async function readManifest(env: Pick<WorkerEnvironment, 'WALLPAPER_MANIFEST'>) {
  const value = await env.WALLPAPER_MANIFEST.get(MANIFEST_KEY, 'json');
  if (!isWallpaperManifest(value)) return undefined;

  const photos = value.photos.filter(
    (photo): photo is StoredWallpaperPhoto =>
      'downloadLocation' in photo &&
      typeof photo.downloadLocation === 'string' &&
      isUnsplashApiUrl(photo.downloadLocation),
  );
  return photos.length === value.photos.length ? { ...value, photos } : undefined;
}

function publicManifest(manifest: StoredWallpaperManifest): WallpaperManifest {
  return {
    version: manifest.version,
    updatedAt: manifest.updatedAt,
    photos: manifest.photos.map((photo) => ({
      id: photo.id,
      createdAt: photo.createdAt,
      blurHash: photo.blurHash,
      rawUrl: photo.rawUrl,
      photographerName: photo.photographerName,
      photographerUrl: photo.photographerUrl,
      photoUrl: photo.photoUrl,
    })),
  };
}

function manifestResponse(manifest: StoredWallpaperManifest, request: Request) {
  const body = JSON.stringify(publicManifest(manifest));
  const etag = `W/\"wallpapers-${manifest.updatedAt}\"`;
  const headers = new Headers({
    'Cache-Control': 'public, max-age=900',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  });
  headers.set('ETag', etag);

  if (request.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === 'HEAD' ? null : body, { headers });
}

function unavailableResponse(request: Request) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Retry-After': '60',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  });
  const body = JSON.stringify({ error: 'Wallpaper manifest unavailable.' });
  return new Response(request.method === 'HEAD' ? null : body, { status: 503, headers });
}

export async function handleWallpaperRequest(
  request: Request,
  env: WorkerEnvironment,
  _context: WorkerContext,
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
      return unavailableResponse(request);
    }
  }

  return manifestResponse(manifest, request);
}

export async function handleWallpaperDownloadRequest(
  request: Request,
  env: WorkerEnvironment,
  context: WorkerContext,
) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'POST' },
    });
  }

  if (request.headers.get('Origin') !== new URL(request.url).origin) {
    return new Response('Forbidden', { status: 403 });
  }
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) {
    return new Response('Unsupported Media Type', { status: 415 });
  }

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  const photoId =
    typeof value === 'object' && value !== null && 'photoId' in value ? value.photoId : undefined;
  if (typeof photoId !== 'string' || photoId.length === 0 || photoId.length > 128) {
    return new Response('Bad Request', { status: 400 });
  }

  const manifest = await readManifest(env);
  if (!manifest) return unavailableResponse(request);

  const photo = manifest.photos.find((candidate) => candidate.id === photoId);
  if (!photo) return new Response('Not Found', { status: 404 });

  context.waitUntil(
    trackDownload(photo.downloadLocation, env.UNSPLASH_ACCESS_KEY).catch((error) => {
      console.error(`Unable to report the wallpaper download for ${photo.id}.`, error);
    }),
  );
  return new Response(null, {
    status: 202,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request: Request, env: WorkerEnvironment, context: WorkerContext) {
    const url = new URL(request.url);
    if (url.pathname === WALLPAPER_DOWNLOAD_ENDPOINT) {
      return handleWallpaperDownloadRequest(request, env, context);
    }
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
