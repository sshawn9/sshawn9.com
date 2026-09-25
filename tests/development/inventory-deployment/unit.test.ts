import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type RequestListener, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareProductionInventories } from '../../../apps/site/tools/resource-inventory/deployment.mjs';

const prepareCli = fileURLToPath(
  new URL('../../../apps/site/tools/resource-inventory/deployment-cli.mjs', import.meta.url),
);
const diffCli = fileURLToPath(
  new URL('../../../apps/site/tools/resource-inventory/diff-cli.mjs', import.meta.url),
);
const directories: string[] = [];
const servers: Server[] = [];

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function inventory(buildId: string) {
  return {
    site: 'https://site.test',
    buildId,
    mode: 'production',
    pages: [{ url: 'https://site.test/', title: 'Home' }],
    resources: [
      { url: 'https://site.test/', type: 'html', external: false },
      { url: `https://site.test/${buildId}.js`, type: 'js', external: false },
    ],
  };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'inventory-deployment-'));
  directories.push(directory);
  const assetsDirectory = join(directory, 'site assets');
  const reportDirectory = join(directory, 'deployment report');
  const inventoryPath = join(directory, 'generated inventory.json');
  await mkdir(assetsDirectory);
  await writeFile(inventoryPath, JSON.stringify(inventory('new')));
  return { directory, inventoryPath, assetsDirectory, reportDirectory };
}

async function serve(listener: RequestListener) {
  const server = createServer(listener);
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local server address.');
  return `http://127.0.0.1:${address.port}/resource-inventory.json`;
}

describe('production inventory preparation', () => {
  it('packages the generated inventory and saves exact snapshots before reporting offline', async () => {
    const files = await fixture();
    const before = JSON.stringify(inventory('old'), null, 2) + '\n';
    let requests = 0;
    const inventoryUrl = await serve((_request, response) => {
      requests++;
      response.end(before);
    });

    await prepareProductionInventories({ ...files, inventoryUrl });

    const after = await readFile(files.inventoryPath, 'utf8');
    expect(await readFile(join(files.assetsDirectory, 'resource-inventory.json'), 'utf8')).toBe(
      after,
    );
    expect(await readFile(join(files.reportDirectory, 'after.json'), 'utf8')).toBe(after);
    expect(await readFile(join(files.reportDirectory, 'before.json'), 'utf8')).toBe(before);
    expect((await readdir(files.reportDirectory)).sort()).toEqual(['after.json', 'before.json']);

    const summary = join(files.directory, 'deployment summary.md');
    await writeFile(summary, 'Existing deployment URL\n');
    const result = spawnSync(
      process.execPath,
      [
        diffCli,
        join(files.reportDirectory, 'before.json'),
        join(files.reportDirectory, 'after.json'),
        '--output',
        files.reportDirectory,
        '--summary',
        summary,
      ],
      { encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(await readFile(join(files.reportDirectory, 'diff.json'), 'utf8'));
    expect(report.before.buildId).toBe('old');
    expect(report.after.buildId).toBe('new');
    expect(report.resources.added.map((resource: { url: string }) => resource.url)).toEqual([
      'https://site.test/new.js',
    ]);
    expect(await readFile(summary, 'utf8')).toMatch(
      /^Existing deployment URL\n### Production inventory changes/,
    );
    expect(requests).toBe(1);
  });

  it('retries a failed download and invalid JSON before accepting a valid snapshot', async () => {
    const files = await fixture();
    let requests = 0;
    const inventoryUrl = await serve((_request, response) => {
      requests++;
      response.statusCode = requests === 1 ? 503 : 200;
      response.end(requests < 3 ? 'Unavailable' : JSON.stringify(inventory('old')));
    });
    const waits: number[] = [];

    await prepareProductionInventories(
      { ...files, inventoryUrl },
      { wait: async (milliseconds) => void waits.push(milliseconds) },
    );

    expect(requests).toBe(3);
    expect(waits).toEqual([2_000, 2_000]);
    expect(JSON.parse(await readFile(join(files.reportDirectory, 'before.json'), 'utf8'))).toEqual(
      inventory('old'),
    );
  });

  it.each([
    ['HTTP 404', 404, 'Not found'],
    ['invalid JSON', 200, '<html>Unavailable</html>'],
    ['invalid shape', 200, '{}'],
    ['another site', 200, JSON.stringify({ ...inventory('old'), site: 'https://other.test' })],
    ['preview mode', 200, JSON.stringify({ ...inventory('old'), mode: 'preview' })],
  ])(
    'rejects %s after three attempts without producing a deployment report',
    async (_, status, body) => {
      const files = await fixture();
      let requests = 0;
      const inventoryUrl = await serve((_request, response) => {
        requests++;
        response.statusCode = Number(status);
        response.end(body);
      });

      await expect(
        prepareProductionInventories({ ...files, inventoryUrl }, { wait: async () => undefined }),
      ).rejects.toThrow('failed after three attempts');

      expect(requests).toBe(3);
      expect(JSON.parse(await readFile(join(files.reportDirectory, 'after.json'), 'utf8'))).toEqual(
        inventory('new'),
      );
      const reports = await readdir(files.reportDirectory);
      expect(reports).not.toContain('diff.json');
      expect(reports).not.toContain('diff.md');
      if (status === 404) expect(reports).not.toContain('before.json');
    },
  );

  it('rejects a local preview inventory before packaging or contacting production', async () => {
    const files = await fixture();
    await writeFile(files.inventoryPath, JSON.stringify({ ...inventory('new'), mode: 'preview' }));
    let requests = 0;
    const inventoryUrl = await serve((_request, response) => {
      requests++;
      response.end(JSON.stringify(inventory('old')));
    });

    await expect(prepareProductionInventories({ ...files, inventoryUrl })).rejects.toThrow(
      'must have mode production',
    );
    expect(requests).toBe(0);
    expect(await readdir(files.assetsDirectory)).toEqual([]);
  });
});

describe('deployment inventory command failures', () => {
  it('rejects unexpected arguments before generating or downloading inventories', () => {
    const result = spawnSync(process.execPath, [prepareCli, '--unknown'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Production deployment stopped: inventory preparation failed.');
  });
});
