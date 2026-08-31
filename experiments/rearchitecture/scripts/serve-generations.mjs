import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import {
  contentTypeFor,
  resolveStaticFile,
  sendNotFound,
  streamStaticFile,
} from './static-files.mjs';

const [directory, rawPort] = process.argv.slice(2);
if (!directory || !rawPort) {
  throw new Error('Usage: node scripts/serve-generations.mjs <directory> <port>');
}

const buildRoot = resolve(directory);
const roots = {
  a: resolve(buildRoot, 'generation-a'),
  b: resolve(buildRoot, 'generation-b'),
};
const port = Number(rawPort);
const generationCookie = 'poc-generation=b';

function hasGenerationBCookie(request) {
  return (request.headers.cookie ?? '')
    .split(';')
    .some((entry) => entry.trim() === generationCookie);
}

function requestedAssetGeneration(pathname) {
  if (pathname.startsWith('/_astro-generation-a/')) {
    return 'a';
  }
  if (pathname.startsWith('/_astro-generation-b/')) {
    return 'b';
  }
  return undefined;
}

function documentGeneration(request, pathname) {
  return hasGenerationBCookie(request) || pathname === '/zh/blog/frenet-poc/' ? 'b' : 'a';
}

async function sendDocument(file, generation, url, response) {
  let html = await readFile(file, 'utf8');
  if (url.searchParams.get('generation-meta') === 'missing') {
    html = html.replace(/\s*<meta name="poc-build-id"[^>]*>/, '');
  }

  response.writeHead(200, {
    'Content-Type': contentTypeFor(file),
    'Cache-Control': 'no-store',
    ...(generation === 'b' ? { 'Set-Cookie': generationCookie + '; Path=/; SameSite=Lax' } : {}),
    'X-Poc-Document-Generation': generation,
  });
  response.end(html);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const assetGeneration = requestedAssetGeneration(url.pathname);
  if (assetGeneration) {
    const file = await resolveStaticFile(roots[assetGeneration], url.pathname);
    if (!file) {
      sendNotFound(response);
      return;
    }
    streamStaticFile(file, response, {
      'X-Poc-Asset-Generation': assetGeneration,
    });
    return;
  }

  const generation = documentGeneration(request, url.pathname);
  const file = await resolveStaticFile(roots[generation], url.pathname);
  if (!file) {
    sendNotFound(response);
    return;
  }

  if (extname(file) === '.html') {
    await sendDocument(file, generation, url, response);
    return;
  }
  streamStaticFile(file, response);
});

server.listen(port, '127.0.0.1', () => {
  console.log('Serving cross-generation fixtures at http://127.0.0.1:' + String(port));
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
