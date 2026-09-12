import { afterEach, describe, expect, it } from 'vitest';
import { X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  createServer as createHttpsServer,
  type Server as HttpsServer,
  type ServerOptions as HttpsServerOptions,
} from 'node:https';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { brotliCompressSync, deflateSync, gzipSync, zstdCompressSync } from 'node:zlib';
import { createProbeClient } from '../../../apps/site/tools/cache-probe/http.mjs';

const servers: Array<Server | HttpsServer> = [];
const clients: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
});

async function serve(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  tls?: HttpsServerOptions,
): Promise<string> {
  const instance = tls ? createHttpsServer(tls, handler) : createServer(handler);
  servers.push(instance);
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  const address = instance.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address.');
  return `${tls ? 'https' : 'http'}://127.0.0.1:${address.port}`;
}

function client(options: Record<string, unknown> = {}) {
  const instance = createProbeClient({
    concurrency: 2,
    requestTimeout: 1,
    proxyEnv: {},
    ...options,
  });
  clients.push(instance);
  return instance;
}

describe('cache-probe Undici transport', () => {
  it('sends a consistent probe identity for both trace and resource requests', async () => {
    const userAgents: Array<string | undefined> = [];
    const origin = await serve((request, response) => {
      userAgents.push(request.headers['user-agent']);
      response.end('ok');
    });
    const probe = client();

    for (const path of ['/cdn-cgi/trace', '/zh/blog/', '/asset.js']) {
      const result = await probe.request(`${origin}${path}`);
      expect(result.complete).toBe(true);
    }

    const expected = 'ShawnCacheProbe (+https://sshawn9.com)';
    expect(userAgents).toEqual([expected, expected, expected]);
    expect(probe.info.userAgent).toBe(expected);
  });

  it('downloads and validates encoded bodies while reusing a real connection', async () => {
    const plain = Buffer.from('hello from a compressed response');
    const encoded = gzipSync(plain);
    const sockets = new Set();
    const origin = await serve((request, response) => {
      sockets.add(request.socket);
      response.setHeader('content-encoding', 'gzip');
      response.setHeader('content-length', encoded.byteLength);
      response.setHeader('set-cookie', ['first=1', 'second=2']);
      response.end(encoded);
    });
    const probe = client();

    const first = await probe.request(`${origin}/asset.js`, { captureLimit: 65_536 });
    const second = await probe.request(`${origin}/asset.js`);

    expect(first).toMatchObject({
      httpStatus: 200,
      complete: true,
      error: null,
      remoteIp: '127.0.0.1',
      localIp: '127.0.0.1',
      httpVersion: '1.1',
      reusedConnection: false,
      bytes: encoded.byteLength,
      decodedBytes: plain.byteLength,
      text: plain.toString(),
    });
    expect(first.headers['content-encoding']).toEqual(['gzip']);
    expect(first.headers['set-cookie']).toEqual(['first=1', 'second=2']);
    expect(second.complete).toBe(true);
    expect(second.connectionId).toBe(first.connectionId);
    expect(second.reusedConnection).toBe(true);
    expect(sockets.size).toBe(1);
    expect(first.timings.firstByteMs).toBeTypeOf('number');
    expect(first.timings.totalMs).toBeGreaterThanOrEqual(first.timings.firstByteMs!);
    expect(Object.keys(first.timings).sort()).toEqual(['firstByteMs', 'totalMs']);
    expect(probe.info).toMatchObject({
      name: 'Undici',
      connectionReuse: true,
    });
    expect(probe.info.version).toMatch(/^8\./);
  });

  it('validates TLS and reuses one HTTPS connection across gzip, deflate, Brotli and Zstd', async () => {
    const pem = await readFile(new URL('./localhost.pem', import.meta.url), 'utf8');
    const cert = new X509Certificate(pem).toString();
    const plain = Buffer.from('local HTTPS compression fixture '.repeat(2048));
    const bodies = new Map([
      ['gzip', gzipSync(plain)],
      ['deflate', deflateSync(plain)],
      ['br', brotliCompressSync(plain)],
      ['zstd', zstdCompressSync(plain)],
    ]);
    const sockets = new Set();
    const origin = await serve(
      (request, response) => {
        sockets.add(request.socket);
        const encoding = (request.url ?? '').slice(1);
        const encoded = bodies.get(encoding);
        if (!encoded) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, {
          'content-encoding': encoding,
          'content-length': encoded.byteLength,
        });
        response.end(encoded);
      },
      { key: pem, cert, ALPNProtocols: ['http/1.1'] },
    );

    // The fixture must fail verification before it is trusted in this test.
    const untrusted = client({ concurrency: 1 });
    const rejected = await untrusted.request(`${origin}/gzip`);
    expect(rejected).toMatchObject({
      complete: false,
      errorCode: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    });
    expect(sockets.size).toBe(0);
    await untrusted.close();

    const previousCertificates = getCACertificates();
    try {
      setDefaultCACertificates([...previousCertificates, cert]);
      const probe = client({ concurrency: 1 });
      let connectionId: number | null = null;
      for (const [encoding, encoded] of bodies) {
        const result = await probe.request(`${origin}/${encoding}`, { captureLimit: plain.length });
        expect(result).toMatchObject({
          httpStatus: 200,
          complete: true,
          error: null,
          httpVersion: '1.1',
          bytes: encoded.byteLength,
          decodedBytes: plain.byteLength,
          text: plain.toString(),
          reusedConnection: connectionId !== null,
        });
        expect(result.headers['content-encoding']).toEqual([encoding]);
        expect(result.connectionId).toBeTypeOf('number');
        connectionId ??= result.connectionId;
        expect(result.connectionId).toBe(connectionId);
      }
      expect(sockets.size).toBe(1);
    } finally {
      setDefaultCACertificates(previousCertificates);
    }
  });

  it('delivers 429 headers before a hanging body finishes', async () => {
    let acknowledge!: () => void;
    const headersSeen = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const origin = await serve((_request, response) => {
      response.writeHead(429, { 'retry-after': '3' });
      response.flushHeaders();
    });
    const probe = client();
    const controller = new AbortController();
    let settled = false;
    const pending = probe
      .request(origin, {
        signal: controller.signal,
        onHeaders({ httpStatus, headers }) {
          expect(httpStatus).toBe(429);
          expect(headers['retry-after']).toEqual(['3']);
          acknowledge();
        },
      })
      .finally(() => {
        settled = true;
      });

    await headersSeen;
    expect(settled).toBe(false);
    controller.abort();
    const record = await pending;
    expect(record).toMatchObject({ httpStatus: 429, complete: false, errorCode: 'AbortError' });
  });

  it('treats truncated compression as an incomplete transfer', async () => {
    const encoded = gzipSync(Buffer.from('must be fully validated'));
    const truncated = encoded.subarray(0, encoded.byteLength - 6);
    const origin = await serve((_request, response) => {
      response.writeHead(200, {
        'content-encoding': 'gzip',
        'content-length': truncated.byteLength,
      });
      response.end(truncated);
    });
    const record = await client().request(origin);

    expect(record.httpStatus).toBe(200);
    expect(record.bytes).toBe(truncated.byteLength);
    expect(record.complete).toBe(false);
    expect(record.error).toMatch(/unexpected end|unexpected end of file/i);
  });

  it('returns redirects without following Location', async () => {
    let redirectedRequests = 0;
    const origin = await serve((request, response) => {
      if (request.url === '/final') redirectedRequests++;
      response.writeHead(request.url === '/start' ? 302 : 200, {
        location: `${origin}/final`,
      });
      response.end('redirect');
    });
    const record = await client().request(`${origin}/start`);

    expect(record).toMatchObject({ httpStatus: 302, complete: true });
    expect(record.headers.location).toEqual([`${origin}/final`]);
    expect(redirectedRequests).toBe(0);
  });

  it('applies a wall-clock timeout and settles external cancellation', async () => {
    const origin = await serve((_request, response) => response.flushHeaders());
    const timed = await client({ requestTimeout: 0.05 }).request(origin);
    expect(timed).toMatchObject({ httpStatus: 200, complete: false, errorCode: 'PROBE_TIMEOUT' });

    const probe = client();
    const controller = new AbortController();
    const pending = probe.request(origin, { signal: controller.signal });
    controller.abort(new Error('test cancellation'));
    const cancelled = await pending;
    expect(cancelled.complete).toBe(false);
    expect(cancelled.error).toBe('test cancellation');
  });

  it('propagates an onHeaders exception after aborting the body', async () => {
    const origin = await serve((_request, response) => {
      response.flushHeaders();
    });
    const failure = new Error('pause handler failed');
    await expect(
      client().request(origin, {
        onHeaders() {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
  });

  it('uses ALL_PROXY as an HTTP fallback and honors NO_PROXY', async () => {
    let direct = 0;
    let proxied = 0;
    const target = await serve((_request, response) => {
      direct++;
      response.end('direct');
    });
    const proxy = await serve((request, response) => {
      proxied++;
      expect(request.url).toBe(`${target}/through-proxy`);
      response.end('proxy');
    });

    const viaProxy = client({
      proxyEnv: { ALL_PROXY: proxy, NO_PROXY: '' },
    });
    const proxiedRecord = await viaProxy.request(`${target}/through-proxy`, { captureLimit: 20 });
    expect(proxiedRecord).toMatchObject({
      complete: true,
      text: 'proxy',
      bytes: 5,
      decodedBytes: 5,
      remoteIp: '127.0.0.1',
      httpVersion: '1.1',
      reusedConnection: false,
    });
    expect(proxied).toBe(1);
    expect(direct).toBe(0);

    const bypass = client({
      proxyEnv: { ALL_PROXY: proxy, NO_PROXY: '127.0.0.1' },
    });
    const directRecord = await bypass.request(`${target}/bypass`, { captureLimit: 20 });
    expect(directRecord).toMatchObject({ complete: true, text: 'direct' });
    expect(proxied).toBe(1);
    expect(direct).toBe(1);
  });

  it('prefers explicit HTTP_PROXY and HTTPS_PROXY over ALL_PROXY', async () => {
    let allHttp = 0;
    let explicitHttp = 0;
    let allConnects = 0;
    let explicitConnects = 0;
    const target = await serve((_request, response) => response.end('target'));
    const allProxy = await serve((_request, response) => {
      allHttp++;
      response.end('all');
    });
    servers.at(-1)?.on('connect', (_request, socket) => {
      allConnects++;
      socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
    });
    const explicitHttpProxy = await serve((_request, response) => {
      explicitHttp++;
      response.end('explicit-http');
    });
    const explicitHttpsProxy = await serve((_request, response) => response.end('not-connect'));
    servers.at(-1)?.on('connect', (_request, socket) => {
      explicitConnects++;
      socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
    });
    const probe = client({
      proxyEnv: {
        ALL_PROXY: allProxy,
        HTTP_PROXY: explicitHttpProxy,
        HTTPS_PROXY: explicitHttpsProxy,
        NO_PROXY: '',
      },
    });

    const http = await probe.request(`${target}/explicit`, { captureLimit: 20 });
    const https = await probe.request('https://unused.invalid/resource');

    expect(http).toMatchObject({ complete: true, text: 'explicit-http' });
    expect(https.complete).toBe(false);
    expect(explicitHttp).toBe(1);
    expect(allHttp).toBe(0);
    expect(explicitConnects).toBe(1);
    expect(allConnects).toBe(0);

    const httpsFallback = client({ proxyEnv: { ALL_PROXY: allProxy, NO_PROXY: '' } });
    const fallbackResult = await httpsFallback.request('https://unused.invalid/fallback');
    expect(fallbackResult.complete).toBe(false);
    expect(allConnects).toBe(1);
  });

  it('rejects unsupported proxy settings without exposing credentials', async () => {
    const credential = 'very-secret-password';
    let message = '';
    try {
      createProbeClient({
        concurrency: 1,
        requestTimeout: 1,
        proxyEnv: { ALL_PROXY: `socks4://user:${credential}@127.0.0.1:1080` },
      });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain('ALL_PROXY');
    expect(message).toContain('unsupported proxy protocol socks4:');
    expect(message).not.toContain(credential);
    expect(() =>
      createProbeClient({
        concurrency: 1,
        requestTimeout: 1,
        proxyEnv: { HTTP_PROXY: `socks4://user:${credential}@127.0.0.1:1080` },
      }),
    ).toThrow(/unsupported proxy protocol socks4:/);

    const supported = createProbeClient({
      concurrency: 1,
      requestTimeout: 1,
      proxyEnv: { ALL_PROXY: 'socks5://127.0.0.1:1080' },
    });
    await supported.close();
  });
});
