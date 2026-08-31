import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export async function resolveStaticFile(root, pathname) {
  const relativePath = decodeURIComponent(pathname).replace(/^\/+/, '');
  let candidate = resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    return undefined;
  }

  try {
    const info = await stat(candidate);
    if (info.isDirectory()) {
      candidate = resolve(candidate, 'index.html');
      await stat(candidate);
    }
    return candidate;
  } catch {
    return undefined;
  }
}

export function contentTypeFor(file) {
  return contentTypes[extname(file)] ?? 'application/octet-stream';
}

export function streamStaticFile(file, response, extraHeaders = {}) {
  response.writeHead(200, {
    'Content-Type': contentTypeFor(file),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  createReadStream(file).pipe(response);
}

export function sendNotFound(response) {
  response.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end('Not found');
}
