import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { close, createIndex } from 'pagefind';

test('a warm browser cache cannot substitute the previous deployment search entry', async ({
  page,
}) => {
  const directory = fileURLToPath(new URL('../../../apps/site/dist/', import.meta.url));
  const html = await readFile(resolve(directory, 'en/search/index.html'), 'utf8');
  const identity = html.match(/<meta name="site-build-id" content="([^"]+)"/)?.[1];
  expect(identity).toBeTruthy();
  const indexes: Map<string, Uint8Array>[] = [];
  try {
    for (const title of ['Previous deployment', 'Current deployment']) {
      const created = await createIndex();
      expect(created.errors).toEqual([]);
      const added = await created.index!.addCustomRecord({
        url: '/en/blog/cache-probe/',
        language: 'en',
        content: `deploymentprobe ${title}`,
        meta: { title },
      });
      expect(added.errors).toEqual([]);
      const result = await created.index!.getFiles();
      expect(result.errors).toEqual([]);
      indexes.push(new Map(result.files.map((file) => [`/pagefind/${file.path}`, file.content])));
    }
  } finally {
    await close();
  }

  let deployment = 0;
  const entries: string[] = [];
  const mime: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    try {
      if (url.pathname === '/en/search/') {
        response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        response.end(html.replaceAll(identity!, `${identity}-${deployment}`));
        return;
      }
      const indexed = indexes[deployment].get(url.pathname);
      if (url.pathname === '/pagefind/pagefind-entry.json') entries.push(url.search);
      const path = resolve(directory, `.${decodeURIComponent(url.pathname)}`);
      if (!path.startsWith(directory.endsWith(sep) ? directory : `${directory}${sep}`)) {
        response.writeHead(404).end();
        return;
      }
      const content = indexed ?? (await readFile(path));
      response.writeHead(200, {
        'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      response.end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
  const url = `http://127.0.0.1:${address.port}/en/search/?q=deploymentprobe`;
  try {
    await page.goto(url);
    const titles = page.locator('.site-search-result__link');
    await expect(titles).toHaveText(['Previous deployment']);
    expect(entries).toEqual([`?ts=${identity}-0`]);
    // A fresh document in the same context retains the real HTTP cache.
    await page.goto('about:blank');
    await page.goto(url);
    await expect(titles).toHaveText(['Previous deployment']);
    expect(entries).toHaveLength(1);
    deployment = 1;
    await page.goto('about:blank');
    await page.goto(url);
    await expect(titles).toHaveText(['Current deployment']);
    expect(entries).toEqual([`?ts=${identity}-0`, `?ts=${identity}-1`]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
