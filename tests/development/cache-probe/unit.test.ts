import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  classifyResult,
  defaults,
  prepareInventory,
  retryDeadline,
  runProbe,
  summarizeRound,
  validateOptions,
} from '../../../apps/site/tools/cache-probe/probe.mjs';
import { createProbeClient } from '../../../apps/site/tools/cache-probe/http.mjs';
import { openEgressHistory } from '../../../apps/site/tools/cache-probe/history.mjs';
import {
  defaultInventoryUrl,
  loadInventory,
} from '../../../apps/site/tools/cache-probe/inventory-input.mjs';

const servers: Server[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function directory() {
  const parent = fileURLToPath(new URL('../../.results/', import.meta.url));
  await mkdir(parent, { recursive: true });
  const path = await mkdtemp(join(parent, 'cache-probe-'));
  directories.push(path);
  return path;
}

async function server(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const instance = createServer(handler);
  servers.push(instance);
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  const address = instance.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address.');
  return `http://127.0.0.1:${address.port}`;
}

function inventory(site: string, paths = ['/', '/asset.js']) {
  const urls = paths.map((path) => new URL(path, site).href);
  return {
    site,
    buildId: 'fixture-build',
    mode: 'production',
    diagnostics: [],
    pages: [{ url: urls[0], kind: 'page', title: 'Fixture page' }],
    resources: urls.map((url, i) => ({
      url,
      file: `${i}.html`,
      type: i === 0 ? 'html' : 'js',
      external: false,
    })),
    pageResources: { [urls[0]]: urls },
  };
}

function trace(response: ServerResponse, ip = '198.51.100.7') {
  response.end(`ip=${ip}\nloc=US\ncolo=SJC\nhttp=http/1.1\ntls=TLSv1.3\nwarp=off\n`);
}

function hit(response: ServerResponse, colo = 'SJC') {
  response.writeHead(200, { 'CF-Cache-Status': 'HIT', 'CF-Ray': `abc-${colo}` });
  response.end('Complete response body');
}

const fast = { ...defaults, minInterval: 0, maxInterval: 0, requestTimeout: 2 };
const clientFactory = (options: Parameters<typeof createProbeClient>[0]) =>
  createProbeClient({ ...options, proxyEnv: {} });
const run = async (
  input: ReturnType<typeof inventory>,
  options = fast,
  output?: string,
  extra = {},
) =>
  runProbe(input, options, { directory: output ?? (await directory()), clientFactory, ...extra });
const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const cli = fileURLToPath(new URL('../../../apps/site/tools/cache-probe/cli.mjs', import.meta.url));
const withoutProxyEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/_proxy$/i.test(key)),
);

describe('cache probe inventory input', () => {
  it('defaults to the deployed inventory URL and records decoded bytes and SHA-256', async () => {
    expect(defaultInventoryUrl).toBe('https://sshawn9.com/resource-inventory.json');
    const value = inventory('https://site.test');
    const contents = Buffer.from(JSON.stringify(value));
    const encoded = gzipSync(contents);
    let requests = 0;
    const origin = await server((_request, response) => {
      requests++;
      response.writeHead(200, {
        'content-encoding': 'gzip',
        'content-length': encoded.byteLength,
      });
      response.end(encoded);
    });

    const remote = await loadInventory(`${origin}/inventory.json`, {
      requestTimeout: 2,
      clientFactory,
    });
    expect(remote.inventory).toEqual(value);
    expect(remote.input).toEqual({
      url: `${origin}/inventory.json`,
      bytes: contents.byteLength,
      sha256: createHash('sha256').update(contents).digest('hex'),
    });
    expect(requests).toBe(1);

    const root = await directory();
    const file = join(root, 'inventory with spaces.json');
    await writeFile(file, contents);
    const local = await loadInventory(file, { requestTimeout: 2, clientFactory });
    expect(local.inventory).toEqual(value);
    expect(local.input).toEqual({
      file,
      bytes: contents.byteLength,
      sha256: createHash('sha256').update(contents).digest('hex'),
    });
  });

  it('rejects HTTP errors and invalid JSON without a fallback', async () => {
    let requests = 0;
    const origin = await server((request, response) => {
      requests++;
      if (request.url === '/missing.json') {
        response.writeHead(503);
        response.end('unavailable');
      } else {
        response.end('{not json');
      }
    });
    await expect(
      loadInventory(`${origin}/missing.json`, { requestTimeout: 2, clientFactory }),
    ).rejects.toThrow('HTTP 503');
    await expect(
      loadInventory(`${origin}/invalid.json`, { requestTimeout: 2, clientFactory }),
    ).rejects.toThrow('not valid JSON');
    const credential = 'secret-password';
    const authenticated = `${origin.replace('http://', `http://user:${credential}@`)}/input.json`;
    let message = '';
    try {
      await loadInventory(authenticated, { requestTimeout: 2, clientFactory });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain('must not contain credentials');
    expect(message).not.toContain(credential);
    expect(requests).toBe(2);
  });

  it('runs the CLI from one downloaded inventory through the listed resources', async () => {
    let inventoryDownloads = 0;
    let traces = 0;
    const resources: string[] = [];
    const origin = await server((request, response) => {
      if (request.url === '/resource-inventory.json') {
        inventoryDownloads++;
        response.end(JSON.stringify(inventory(origin)));
      } else if (request.url === '/cdn-cgi/trace') {
        traces++;
        trace(response);
      } else {
        resources.push(request.url!);
        hit(response);
      }
    });
    const source = `${origin}/resource-inventory.json`;
    const contents = Buffer.from(JSON.stringify(inventory(origin)));
    const output = await directory();
    const child = spawn(
      process.execPath,
      [
        cli,
        '--inventory',
        source,
        '--output',
        output,
        '--hit-streak',
        '1',
        '--interval-min',
        '0',
        '--interval-max',
        '0',
        '--request-timeout',
        '2',
      ],
      { env: withoutProxyEnv, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let log = '';
    child.stdout.on('data', (chunk) => {
      log += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      log += chunk.toString();
    });
    const closed = once(child, 'close');
    const guard = setTimeout(() => child.kill('SIGKILL'), 5_000);
    let code;
    try {
      [code] = await closed;
    } finally {
      clearTimeout(guard);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await closed;
      }
    }

    expect(code, log).toBe(0);
    expect(inventoryDownloads).toBe(1);
    expect(traces).toBe(1);
    expect(resources.sort()).toEqual(['/', '/asset.js']);
    const report = await readJson(join(output, '198.51.100.7', 'report.json'));
    expect(report.runs[0].input).toMatchObject({
      url: source,
      bytes: contents.byteLength,
      sha256: createHash('sha256').update(contents).digest('hex'),
    });
  });

  it('shows help and rejects invalid controls without fetching the default URL', async () => {
    let proxyRequests = 0;
    const proxy = await server((_request, response) => {
      proxyRequests++;
      response.writeHead(502);
      response.end();
    });
    servers.at(-1)?.on('connect', (_request, socket) => {
      proxyRequests++;
      socket.destroy();
    });
    const child = spawn(process.execPath, [cli, '--help'], {
      env: { ...withoutProxyEnv, HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.resume();
    const [code] = await once(child, 'close');
    expect(code).toBe(0);
    expect(output).toContain('Usage: npm run cache:probe');
    expect(proxyRequests).toBe(0);

    const invalid = spawn(process.execPath, [cli, '--concurrency', '0'], {
      env: { ...withoutProxyEnv, HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let error = '';
    invalid.stdout.resume();
    invalid.stderr.on('data', (chunk) => {
      error += chunk.toString();
    });
    const [invalidCode] = await once(invalid, 'close');
    expect(invalidCode).toBe(1);
    expect(error).toContain('concurrency must be a positive integer');
    expect(proxyRequests).toBe(0);
  });

  it('cancels an inventory download on SIGTERM with exit code 143', async () => {
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const origin = await server((_request, _response) => started());
    const output = await directory();
    const child = spawn(
      process.execPath,
      [cli, '--inventory', `${origin}/inventory.json`, '--output', output],
      { env: withoutProxyEnv, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stdout.resume();
    child.stderr.resume();
    const closed = once(child, 'close');
    const guard = setTimeout(() => child.kill('SIGKILL'), 5_000);
    let code;
    try {
      await Promise.race([
        requestStarted,
        closed.then(([earlyCode]) => {
          throw new Error(`CLI exited before downloading inventory (code ${earlyCode}).`);
        }),
      ]);
      child.kill('SIGTERM');
      [code] = await closed;
    } finally {
      clearTimeout(guard);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await closed;
      }
    }
    expect(code).toBe(143);
  });
});

describe('cache probe input and response rules', () => {
  it('deduplicates full URLs, retains query variants and unreferenced files, and excludes external resources', () => {
    const input = inventory('https://site.test', ['/', '/asset.js?v=1', '/asset.js?v=2']);
    input.resources.push({ ...input.resources[1] });
    input.resources.push({
      url: 'https://cdn.test/font.woff2',
      file: '',
      type: 'font',
      external: true,
    });
    input.resources.push({
      url: 'https://site.test/unused.js',
      file: 'unused.js',
      type: 'js',
      external: false,
    });
    expect(prepareInventory(input).targets.map((target) => target.url)).toEqual([
      'https://site.test/',
      'https://site.test/asset.js?v=1',
      'https://site.test/asset.js?v=2',
      'https://site.test/unused.js',
    ]);
    expect(prepareInventory(input).skipped).toEqual([
      { url: 'https://cdn.test/font.woff2', reason: 'External resource' },
    ]);
    expect(() => prepareInventory({ ...input, mode: 'preview' })).toThrow('production');
    expect(() => prepareInventory({ ...input, resources: [] })).toThrow('no local resources');
    expect(() => prepareInventory({ ...input, pageResources: {} })).toThrow('relationships');
    expect(() => prepareInventory({ ...input, diagnostics: [{ level: 'error' }] })).toThrow(
      'contains errors',
    );
  });

  it.each([
    [200, 'HIT', true, 'hit'],
    [200, 'MISS', true, 'miss'],
    [200, 'REVALIDATED', true, 'other'],
    [200, 'DYNAMIC', true, 'other'],
    [200, null, true, 'unknown'],
    [404, 'HIT', true, 'http-error'],
    [301, 'HIT', true, 'redirect'],
    [200, 'HIT', false, 'transfer-error'],
    [429, 'HIT', true, 'rate-limited'],
    [429, null, false, 'rate-limited'],
    [403, 'HIT', true, 'blocked'],
  ])('classifies HTTP %s / %s / complete %s as %s', (httpStatus, cache, complete, state) => {
    const value = classifyResult(
      { url: 'https://site.test/a', expectedStatuses: [200] },
      {
        httpStatus,
        complete,
        headers: cache ? { 'cf-cache-status': [cache], 'cf-ray': ['abc-SJC'] } : {},
      },
    );
    expect(value.state).toBe(state);
  });

  it('allows explicit not-found pages without accepting missing ordinary assets', () => {
    const input = inventory('https://site.test', ['/404']);
    input.pages[0].kind = 'not-found';
    expect(
      classifyResult(prepareInventory(input).targets[0], {
        httpStatus: 404,
        complete: true,
        headers: { 'cf-cache-status': ['HIT'] },
      }).state,
    ).toBe('hit');
  });

  it('rejects invalid controls before starting a request', () => {
    for (const options of [
      { hitStreak: 0 },
      { maxAttempts: 0 },
      { concurrency: 0.5 },
      { requestTimeout: NaN },
      { requestTimeout: 0 },
      { minInterval: -1 },
      { minInterval: 3, maxInterval: 2 },
      { maxInterval: Infinity },
    ])
      expect(() => validateOptions({ ...defaults, ...options })).toThrow();
  });

  it('parses Retry-After seconds and dates, with a 60 second fallback for missing or invalid values', () => {
    const now = Date.parse('2026-09-12T01:00:00Z');
    expect(retryDeadline('120', now)).toBe(now + 120000);
    expect(retryDeadline('Sat, 12 Sep 2026 01:01:00 GMT', now)).toBe(now + 60000);
    expect(retryDeadline('Sat, 12 Sep 2026 00:00:00 GMT', now)).toBe(now);
    expect(retryDeadline('0', now)).toBe(now);
    for (const value of [null, '', 'invalid', '-1', '1.5', 'Infinity'])
      expect(retryDeadline(value, now)).toBe(now + 60000);
  });
});

describe('resource probing with persistent per-IP history', () => {
  it('does not open the network for an already-interrupted run', async () => {
    const controller = new AbortController();
    controller.abort('SIGINT');
    const result = await run(inventory('https://site.test'), fast, undefined, {
      signal: controller.signal,
    });
    expect(result.stopReason).toBe('interrupted');
    expect(result.rounds).toHaveLength(0);
    expect(result.directories).toHaveLength(0);
  });

  it('runs MISS → HIT → HIT with one trace sample, reuses connections and preserves every round', async () => {
    let traces = 0;
    const requested: string[] = [];
    const site = await server((request, response) => {
      if (request.url === '/cdn-cgi/trace') {
        traces++;
        trace(response);
        return;
      }
      requested.push(request.url!);
      expect(request.method).toBe('GET');
      expect(request.headers.cookie).toBeUndefined();
      expect(request.headers['if-none-match']).toBeUndefined();
      expect(request.headers['cache-control']).toBeUndefined();
      response.writeHead(200, {
        'CF-Cache-Status': requested.length <= 2 ? 'MISS' : 'HIT',
        'CF-Ray': 'abc-SJC',
      });
      response.end('Complete response body');
    });
    const parent = await directory();
    const result = await run(inventory(site, ['/', '/asset.js?v=1']), fast, parent);
    expect(result.stopReason).toBe('warm');
    expect(traces).toBe(1);
    expect(result.rounds.map((value) => summarizeRound(value).hits)).toEqual([0, 2, 2]);
    expect(requested).toHaveLength(6);
    expect(result.rounds[2].results[0]).toMatchObject({
      remoteIp: '127.0.0.1',
      reusedConnection: true,
    });
    expect(result.rounds[2].results[0].timings.totalMs).toBeTypeOf('number');
    const archive = join(parent, '198.51.100.7');
    const stored = await readJson(join(archive, 'report.json'));
    expect(stored.rounds).toHaveLength(3);
    expect(stored.runs[0].stopReason).toBe('warm');
    const events = (await readFile(join(archive, 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events.filter((event) => event.type === 'resource')).toHaveLength(6);
    for (const value of stored.rounds) {
      expect((await readJson(join(archive, value.file))).results).toHaveLength(2);
      expect(await readFile(join(archive, value.file.replace('.json', '.md')), 'utf8')).toContain(
        'Complete',
      );
    }
    expect(await readFile(join(archive, 'report.md'), 'utf8')).toContain('2/2 resources qualify');
  });

  it('skips qualified resources while retrying other resources once per round up to their own limit', async () => {
    const requested: Record<string, number> = {};
    const site = await server((request, response) => {
      if (request.url === '/cdn-cgi/trace') {
        trace(response);
        return;
      }
      requested[request.url!] = (requested[request.url!] ?? 0) + 1;
      response.writeHead(200, {
        'CF-Cache-Status': request.url === '/' ? 'HIT' : 'MISS',
        'CF-Ray': 'abc-SJC',
      });
      response.end('body');
    });
    const result = await run(inventory(site));
    expect(result.stopReason).toBe('attempts-exhausted');
    expect(requested).toEqual({ '/': 2, '/asset.js': 3 });
    expect(result.rounds).toHaveLength(3);
    expect(result.rounds[2].results[0]).toMatchObject({ state: 'skipped', attempt: 2 });
    expect(result.rounds[2].results[0].observedAt).toBeUndefined();
    expect(result.rounds[2].results[1].attempt).toBe(3);
  });

  it('reuses the same archive across runs, does not invent new HITs when skipping, and applies the new N', async () => {
    let traces = 0;
    let requests = 0;
    const site = await server((request, response) => {
      if (request.url === '/cdn-cgi/trace') {
        traces++;
        trace(response);
        return;
      }
      requests++;
      hit(response);
    });
    const parent = await directory();
    const input = inventory(site, ['/']);
    await run(input, fast, parent);
    expect(traces).toBe(1);
    const file = join(parent, '198.51.100.7', 'report.json');
    const before = await readJson(file);
    const skipped = await run(input, fast, parent);
    expect(requests).toBe(2);
    expect(traces).toBe(2);
    expect(skipped.rounds).toHaveLength(1);
    expect(skipped.rounds[0].results[0].state).toBe('skipped');
    expect((await readJson(file)).resources).toEqual(before.resources);
    const higherN = await run(input, { ...fast, hitStreak: 3 }, parent);
    expect(higherN.stopReason).toBe('warm');
    expect(requests).toBe(3);
    expect(traces).toBe(3);
    const state = await readJson(file);
    expect(state.rounds).toHaveLength(4);
    expect(state.runs).toHaveLength(3);
    expect(state.resources[input.resources[0].url].streak).toEqual({ count: 3, colo: 'SJC' });
    expect(await readdir(parent)).toEqual(['198.51.100.7']);
  });

  it('resets attempt counts on each run and keeps different run IPs in separate archives', async () => {
    let samples = 0;
    let requests = 0;
    const site = await server((request, response) => {
      if (request.url === '/cdn-cgi/trace') {
        trace(response, ++samples % 2 ? '198.51.100.7' : '198.51.100.8');
        return;
      }
      requests++;
      response.writeHead(200, { 'CF-Cache-Status': 'MISS', 'CF-Ray': 'abc-SJC' });
      response.end('body');
    });
    const parent = await directory();
    for (let i = 0; i < 2; i++) {
      const result = await run(inventory(site, ['/']), { ...fast, maxAttempts: 2 }, parent);
      expect(result.stopReason).toBe('attempts-exhausted');
      expect(result.rounds.map((round) => round.results[0].attempt)).toEqual([1, 2]);
    }
    expect(samples).toBe(2);
    expect(requests).toBe(4);
    for (const ip of ['198.51.100.7', '198.51.100.8'])
      expect((await readJson(join(parent, ip, 'report.json'))).rounds).toHaveLength(2);
  });

  it('requires the consecutive HITs to be in the same known colo', async () => {
    let requests = 0;
    const site = await server((request, response) => {
      if (request.url === '/cdn-cgi/trace') {
        trace(response);
        return;
      }
      hit(response, requests++ === 0 ? 'LHR' : 'SJC');
    });
    const result = await run(inventory(site, ['/']));
    expect(result.stopReason).toBe('warm');
    expect(requests).toBe(3);
    expect(result.rounds.map((round) => round.results[0].colo)).toEqual(['LHR', 'SJC', 'SJC']);
  });

  it('stops before resource requests if the egress IP cannot be identified', async () => {
    let requests = 0;
    const site = await server((request, response) => {
      if (request.url === '/cdn-cgi/trace') {
        response.writeHead(404);
        response.end('not found');
        return;
      }
      requests++;
      hit(response);
    });
    const result = await run(inventory(site));
    expect(result.stopReason).toBe('failed');
    expect(result.failure).toContain('Cannot determine egress IP');
    expect(result.rounds).toHaveLength(0);
    expect(requests).toBe(0);
  });
});

describe('backpressure, failures and interruption', () => {
  it('samples the IP immediately after restart but delays resources for its persisted 429 pause', async () => {
    const traceTimes: number[] = [];
    const resourceTimes: number[] = [];
    let attempts = 0;
    const site = await server((request, response) => {
      if (request.url === '/cdn-cgi/trace') {
        traceTimes.push(Date.now());
        trace(response);
      } else {
        resourceTimes.push(Date.now());
        if (attempts++ === 0) {
          response.writeHead(429, { 'Retry-After': '1' });
          response.end('wait');
        } else hit(response);
      }
    });
    const parent = await directory();
    const options = { ...fast, maxAttempts: 1, hitStreak: 1 };
    const first = await run(inventory(site, ['/']), options, parent);
    expect(first.stopReason).toBe('attempts-exhausted');
    const second = await run(inventory(site, ['/']), options, parent);
    expect(second.stopReason).toBe('warm');
    expect(traceTimes).toHaveLength(2);
    expect(resourceTimes).toHaveLength(2);
    expect(traceTimes[1]).toBeLessThan(resourceTimes[1]);
    expect(resourceTimes[1]).toBeGreaterThanOrEqual(first.rounds[0].pauses[0].until);
  });

  it('pauses on 429 headers before the body completes, then waits a full refill interval', async () => {
    let limitedAt = 0;
    let secondAt = 0;
    const site = await server((request, response) => {
      if (request.url === '/cdn-cgi/trace') {
        trace(response);
        return;
      }
      if (request.url === '/') {
        limitedAt = Date.now();
        response.writeHead(429, { 'Retry-After': '1' });
        response.flushHeaders();
        setTimeout(() => response.end('wait'), 100);
      } else {
        secondAt = Date.now();
        hit(response);
      }
    });
    const result = await run(inventory(site), {
      ...fast,
      maxAttempts: 1,
      minInterval: 0.05,
      maxInterval: 0.05,
    });
    expect(result.stopReason).toBe('attempts-exhausted');
    expect(secondAt - limitedAt).toBeGreaterThanOrEqual(1040);
    expect(result.rounds[0].pauses).toHaveLength(1);
    expect(result.rounds[0].results.map((value) => value.state)).toEqual(['rate-limited', 'hit']);
    expect(result.rounds[0].results[0].attempt).toBe(1);
  });

  it.each([403, 200])('stops new requests for a protection response (HTTP %s)', async (status) => {
    const requests: string[] = [];
    const site = await server((request, response) => {
      if (request.url === '/cdn-cgi/trace') {
        trace(response);
        return;
      }
      requests.push(request.url!);
      response.writeHead(status, { 'cf-mitigated': 'challenge' });
      response.end('blocked');
    });
    const result = await run(inventory(site), { ...fast, concurrency: 1 });
    expect(result.stopReason).toBe('blocked');
    expect(requests).toEqual(['/']);
    expect(result.rounds[0].results.map((value) => value.state)).toEqual([
      'blocked',
      'not-requested',
    ]);
    expect(result.rounds[0].complete).toBe(false);
  });

  it('does not follow redirects or count a truncated HIT as successful', async () => {
    let followed = false;
    const site = await server((request, response) => {
      if (request.url === '/cdn-cgi/trace') {
        trace(response);
        return;
      }
      if (request.url === '/') {
        response.writeHead(200, {
          'CF-Cache-Status': 'HIT',
          'Content-Length': '1000',
          Connection: 'close',
        });
        response.end('short');
      } else if (request.url === '/asset.js') {
        response.writeHead(302, { Location: '/destination' });
        response.end();
      } else {
        followed = true;
        response.end('destination');
      }
    });
    const result = await run(inventory(site), { ...fast, maxAttempts: 1 });
    expect(result.stopReason).toBe('attempts-exhausted');
    expect(result.rounds[0].results.map((value) => value.state)).toEqual([
      'transfer-error',
      'redirect',
    ]);
    expect(followed).toBe(false);
  });

  it.each(['request-start', 'pause'])(
    'aborts active requests when %s notification fails and releases the archive lock',
    async (type) => {
      const site = await server((request, response) => {
        if (request.url === '/cdn-cgi/trace') {
          trace(response);
          return;
        }
        if (type === 'pause') response.writeHead(429, { 'Retry-After': '60' });
        response.flushHeaders();
      });
      const parent = await directory();
      const result = await run(inventory(site), fast, parent, {
        onEvent(event: any) {
          if (event.type === type) throw new Error(`${type} notification failed.`);
        },
      });
      expect(result.stopReason).toBe('failed');
      expect(result.failure).toBe(`${type} notification failed.`);
      expect(await readdir(join(parent, '198.51.100.7'))).not.toContain('.lock');
    },
  );

  it.each(['notification', 'report-write'])(
    'cancels an in-flight body on resource %s failure and preserves recorded history',
    async (failurePoint) => {
      const requests: string[] = [];
      const completedResponse = Promise.withResolvers<ServerResponse>();
      const slowStarted = Promise.withResolvers<void>();
      const slowRecorded = Promise.withResolvers<void>();
      let slowAborted = false;
      let slowResult: Awaited<ReturnType<ReturnType<typeof createProbeClient>['request']>>;
      let closed = false;
      const parent = await directory();
      const archive = join(parent, '198.51.100.7');
      const site = await server((request, response) => {
        if (request.url === '/cdn-cgi/trace') return trace(response);
        requests.push(request.url!);
        if (request.url === '/completed.js') {
          completedResponse.resolve(response);
        } else if (request.url === '/slow.js') {
          // A HIT header is not enough: keep this body in flight until cancellation.
          response.writeHead(200, { 'CF-Cache-Status': 'HIT', 'CF-Ray': 'abc-SJC' });
          response.write('Incomplete body');
          slowStarted.resolve();
        } else {
          hit(response);
        }
      });
      const pending = run(
        inventory(site, ['/', '/completed.js', '/slow.js', '/not-started.js']),
        fast,
        parent,
        {
          onEvent(event: any) {
            if (event.type === 'request-start' && event.request.url === `${site}/slow.js`)
              slowRecorded.resolve();
            if (
              failurePoint === 'notification' &&
              event.type === 'resource' &&
              event.result.url === `${site}/completed.js`
            )
              throw new Error('Resource notification failed.');
          },
          clientFactory(options: Parameters<typeof createProbeClient>[0]) {
            const client = clientFactory(options);
            return {
              ...client,
              async request(...args: Parameters<typeof client.request>) {
                const result = await client.request(...args);
                if (String(args[0]) === `${site}/slow.js`) {
                  slowAborted = args[1]?.signal?.aborted ?? false;
                  slowResult = result;
                }
                return result;
              },
              async close() {
                await client.close();
                closed = true;
                throw new Error('Secondary transport cleanup failure.');
              },
            };
          },
        },
      );
      const response = await completedResponse.promise;
      await Promise.all([slowStarted.promise, slowRecorded.promise]);
      // The first resource is already durably recorded before this pool slot opens.
      expect(
        (await readJson(join(archive, 'report.json'))).resources[`${site}/`].streak.count,
      ).toBe(1);
      if (failurePoint === 'report-write') {
        // Fail the real snapshot write with EISDIR, not a callback named "disk full".
        await mkdir(join(archive, 'report.json.tmp'));
      }
      hit(response);
      const result = await pending;

      expect(result.stopReason).toBe('failed');
      expect(result.failure).toContain(
        failurePoint === 'notification' ? 'Resource notification failed.' : 'EISDIR',
      );
      expect(slowAborted).toBe(true);
      expect(slowResult!).toMatchObject({ complete: false });
      expect(slowResult!.errorCode).not.toBe('PROBE_TIMEOUT');
      expect(closed).toBe(true);
      expect(requests).toEqual(['/', '/completed.js', '/slow.js']);
      expect(result.rounds).toHaveLength(1);
      expect(result.rounds[0].complete).toBe(false);
      expect(result.rounds[0].results[3].state).toBe('not-requested');
      expect(await readdir(archive)).not.toContain('.lock');

      const journal = await readFile(join(archive, 'events.jsonl'), 'utf8');
      const observations = journal
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .filter((event) => event.type === 'resource');
      expect(observations.map((event) => event.result.url)).toEqual([
        `${site}/`,
        `${site}/completed.js`,
      ]);
      if (failurePoint === 'report-write') {
        await rm(join(archive, 'report.json.tmp'), { recursive: true });
      } else {
        expect((await readJson(join(archive, 'report.json'))).runs[0]).toMatchObject({
          stopReason: 'failed',
          failure: 'Resource notification failed.',
        });
      }
      const history = await openEgressHistory(parent, '198.51.100.7');
      try {
        expect(history.state.resources[`${site}/completed.js`].streak.count).toBe(1);
        expect(history.state.resources[`${site}/slow.js`]).toBeUndefined();
        expect(history.state.resources[`${site}/not-started.js`]).toBeUndefined();
        expect(await readFile(join(archive, 'events.jsonl'), 'utf8')).toBe(journal);
      } finally {
        await history.close();
      }
    },
  );

  it('retains the original failure when the final notification also fails', async () => {
    const site = await server((request, response) => {
      if (request.url === '/cdn-cgi/trace') trace(response);
      else hit(response);
    });
    const parent = await directory();
    const result = await run(inventory(site, ['/']), fast, parent, {
      onEvent(event: any) {
        if (event.type === 'resource') throw new Error('Resource notification failed.');
        if (event.type === 'end') throw new Error('Secondary end notification failure.');
      },
    });
    expect(result.stopReason).toBe('failed');
    expect(result.failure).toBe('Resource notification failed.');
    expect((await readJson(join(parent, '198.51.100.7', 'report.json'))).runs[0]).toMatchObject({
      stopReason: 'failed',
      failure: 'Resource notification failed.',
    });
  });

  it('still rejects when only the final notification fails', async () => {
    const site = await server((request, response) => {
      if (request.url === '/cdn-cgi/trace') trace(response);
      else hit(response);
    });
    const parent = await directory();
    await expect(
      run(inventory(site, ['/']), { ...fast, hitStreak: 1 }, parent, {
        onEvent(event: any) {
          if (event.type === 'end') throw new Error('End notification failed.');
        },
      }),
    ).rejects.toThrow('End notification failed.');
    const archive = join(parent, '198.51.100.7');
    expect((await readJson(join(archive, 'report.json'))).runs[0].stopReason).toBe('warm');
    expect(await readdir(archive)).not.toContain('.lock');
  });

  it('records a transport cleanup failure before finalizing the archive', async () => {
    const site = await server((request, response) => {
      if (request.url === '/cdn-cgi/trace') trace(response);
      else hit(response);
    });
    const parent = await directory();
    const result = await run(inventory(site, ['/']), { ...fast, hitStreak: 1 }, parent, {
      clientFactory(options: Parameters<typeof createProbeClient>[0]) {
        const client = clientFactory(options);
        return {
          ...client,
          async close() {
            await client.close();
            throw new Error('client cleanup failed');
          },
        };
      },
    });
    expect(result.stopReason).toBe('failed');
    expect(result.failure).toBe('client cleanup failed');
    const stored = await readJson(join(parent, '198.51.100.7', 'report.json'));
    expect(stored.runs[0]).toMatchObject({
      stopReason: 'failed',
      failure: 'client cleanup failed',
    });
  });

  it('preserves the incomplete round on real CLI SIGTERM and accepts paths with spaces', async () => {
    let resourceRequests = 0;
    let secondRoundRequests = 0;
    const allSecondRoundRequests = Promise.withResolvers<void>();
    const site = await server((request, response) => {
      if (request.url === '/cdn-cgi/trace') {
        trace(response);
        return;
      }
      if (resourceRequests++ >= 2) {
        response.writeHead(200, { 'CF-Cache-Status': 'HIT', 'CF-Ray': 'abc-SJC' });
        response.write('Partial response body');
        secondRoundRequests++;
        if (secondRoundRequests === 2) allSecondRoundRequests.resolve();
        return;
      }
      hit(response);
    });
    const parent = await directory();
    const file = join(parent, 'inventory with spaces.json');
    const output = join(parent, 'reports with spaces');
    await writeFile(file, JSON.stringify(inventory(site)));
    const child = spawn(
      process.execPath,
      [cli, '--inventory', file, '--output', output, '--interval-min', '0', '--interval-max', '0'],
      { env: withoutProxyEnv, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    allSecondRoundRequests.promise.then(() => child.kill('SIGTERM'));
    const closed = once(child, 'close');
    let log = '';
    child.stderr.on('data', (chunk) => {
      log += chunk.toString();
    });
    child.stdout.on('data', (chunk) => {
      log += chunk.toString();
    });
    const guard = setTimeout(() => child.kill('SIGKILL'), 5000);
    const [code] = await closed;
    clearTimeout(guard);
    expect(code, log).toBe(143);
    const archive = join(output, '198.51.100.7');
    const stored = await readJson(join(archive, 'report.json'));
    expect(stored.runs[0].stopReason).toBe('interrupted');
    expect(stored.rounds).toHaveLength(2);
    const last = await readJson(join(archive, stored.rounds[1].file));
    expect(last.complete).toBe(false);
    expect(last.results.every((value: any) => value.complete === false)).toBe(true);
    expect(last.results.every((value: any) => value.state !== 'hit')).toBe(true);
    expect(await readdir(archive)).not.toContain('.lock');
  });
});
