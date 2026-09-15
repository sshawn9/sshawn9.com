import {
  WALLPAPER_DOWNLOAD_ENDPOINT,
  WALLPAPER_ENDPOINT,
  isWallpaperManifest,
  isWallpaperPhoto,
  type WallpaperManifest,
  type WallpaperPhoto,
} from '@sshawn9/site-domain/wallpaper';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnsplashApiUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'api.unsplash.com';
  } catch {
    return false;
  }
}

function isStoredWallpaperPhoto(value: unknown): value is StoredWallpaperPhoto {
  return (
    isWallpaperPhoto(value) &&
    'downloadLocation' in value &&
    isUnsplashApiUrl(value.downloadLocation)
  );
}

/** The same storage contract guards both sides of the KV boundary. */
function isStoredWallpaperManifest(value: unknown): value is StoredWallpaperManifest {
  return isWallpaperManifest(value) && value.photos.every(isStoredWallpaperPhoto);
}

function parseWallpaperCandidate(value: unknown): StoredWallpaperPhoto | undefined {
  if (
    !isRecord(value) ||
    typeof value.width !== 'number' ||
    !Number.isFinite(value.width) ||
    typeof value.height !== 'number' ||
    !Number.isFinite(value.height) ||
    value.width < 2400 ||
    value.height < 1350 ||
    value.width / value.height < 1.4
  )
    return undefined;

  const { urls, links, user } = value;
  if (!isRecord(urls) || !isRecord(links) || !isRecord(user) || !isRecord(user.links)) {
    return undefined;
  }
  const photo = {
    id: value.id,
    createdAt: value.created_at,
    blurHash: value.blur_hash,
    rawUrl: urls.raw,
    photographerName: user.name,
    photographerUrl: user.links.html,
    photoUrl: links.html,
    downloadLocation: links.download_location,
  };
  if (!isStoredWallpaperPhoto(photo)) return undefined;

  return {
    ...photo,
    photographerUrl: addAttributionParameters(photo.photographerUrl, 'credit-photographer'),
    photoUrl: addAttributionParameters(photo.photoUrl, 'credit-photo'),
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

  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw new Error('Unsplash search returned an invalid response.');
  }
  const candidates = payload.results
    .map(parseWallpaperCandidate)
    .filter((photo): photo is StoredWallpaperPhoto => photo !== undefined);
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
  if (!isStoredWallpaperManifest(manifest)) {
    throw new Error('Refusing to store an invalid wallpaper manifest.');
  }
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
  return isStoredWallpaperManifest(value) ? value : undefined;
}

// Only visitor requests tolerate read failures; refreshes must still reject.
async function readManifestForRequest(env: Pick<WorkerEnvironment, 'WALLPAPER_MANIFEST'>) {
  try {
    return await readManifest(env);
  } catch (error) {
    console.error('Unable to read the wallpaper manifest.', error);
    return undefined;
  }
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

  const manifest = await readManifestForRequest(env);
  return manifest ? manifestResponse(manifest, request) : unavailableResponse(request);
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

  const manifest = await readManifestForRequest(env);
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
