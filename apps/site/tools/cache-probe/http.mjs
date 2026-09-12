import diagnosticsChannel from 'node:diagnostics_channel';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { Agent, EnvHttpProxyAgent, interceptors } from 'undici';

const require = createRequire(import.meta.url);
const { version } = require('undici/package.json');
const userAgent = 'ShawnCacheProbe (+https://sshawn9.com)';
const supportedProxyProtocols = new Set(['http:', 'https:', 'socks:', 'socks5:']);

const channels = {
  create: diagnosticsChannel.channel('undici:request:create'),
  headers: diagnosticsChannel.channel('undici:request:headers'),
  bodyChunk: diagnosticsChannel.channel('undici:request:bodyChunkReceived'),
  sendHeaders: diagnosticsChannel.channel('undici:client:sendHeaders'),
};

function envValue(environment, lower, upper) {
  return environment?.[lower] ?? environment?.[upper] ?? '';
}

function proxyOptions(environment) {
  const allProxy = envValue(environment, 'all_proxy', 'ALL_PROXY');
  const explicitHttpProxy = envValue(environment, 'http_proxy', 'HTTP_PROXY');
  const explicitHttpsProxy = envValue(environment, 'https_proxy', 'HTTPS_PROXY');
  const options = {
    // EnvHttpProxyAgent does not read ALL_PROXY itself. Map it only as the
    // conventional fallback; the official agent still selects and opens it.
    httpProxy: explicitHttpProxy || allProxy,
    httpsProxy: explicitHttpsProxy || allProxy,
    noProxy: envValue(environment, 'no_proxy', 'NO_PROXY'),
  };
  const secrets = [];
  const seen = new Set();
  for (const [name, value] of [
    [explicitHttpProxy ? 'HTTP_PROXY' : 'ALL_PROXY', options.httpProxy],
    [explicitHttpsProxy ? 'HTTPS_PROXY' : 'ALL_PROXY', options.httpsProxy],
  ]) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`${name} is not a valid proxy URL.`);
    }
    if (!supportedProxyProtocols.has(parsed.protocol)) {
      throw new Error(`${name} uses unsupported proxy protocol ${parsed.protocol || '(missing)'}.`);
    }
    secrets.push(value, parsed.href);
    if (parsed.username) secrets.push(parsed.username);
    if (parsed.password) secrets.push(parsed.password);
  }
  return { options, secrets };
}

function normalizedHeaders(rawHeaders) {
  /** @type {Record<string, string[]>} */
  const result = {};
  const append = (rawName, rawValue) => {
    const name = Buffer.isBuffer(rawName)
      ? rawName.toString('latin1').toLowerCase()
      : String(rawName).toLowerCase();
    const value = Buffer.isBuffer(rawValue) ? rawValue.toString('latin1') : String(rawValue);
    if (!Object.hasOwn(result, name)) {
      Object.defineProperty(result, name, {
        value: [],
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    result[name].push(value);
  };

  if (Array.isArray(rawHeaders)) {
    for (let index = 0; index + 1 < rawHeaders.length; index += 2)
      append(rawHeaders[index], rawHeaders[index + 1]);
  } else if (rawHeaders && typeof rawHeaders === 'object') {
    for (const [name, rawValue] of Object.entries(rawHeaders)) {
      if (Array.isArray(rawValue)) {
        for (const value of rawValue) append(name, value);
      } else if (rawValue !== undefined) {
        append(name, rawValue);
      }
    }
  }
  return result;
}

function socketProtocol(socket) {
  if (socket?.alpnProtocol === 'h2') return '2';
  if (socket?.alpnProtocol === 'http/1.1' || socket?.alpnProtocol === false) return '1.1';
  // Cleartext connections made by the regular Agent are HTTP/1.1; h2c is not enabled.
  if (socket && !socket.encrypted) return '1.1';
  return null;
}

function errorCode(error) {
  if (typeof error?.code === 'string') return error.code;
  if (typeof error?.name === 'string' && error.name) return error.name;
  return null;
}

function errorMessage(error, secrets) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (secret) message = message.replaceAll(secret, '[redacted proxy]');
  }
  return message || 'Request failed.';
}

/**
 * @typedef {{
 *   url: string, httpStatus: number, headers: Record<string, string[]>,
 *   complete: boolean, error: string | null, errorCode: string | null,
 *   remoteIp: string | null, localIp: string | null, httpVersion: string | null,
 *   connectionId: number | null, reusedConnection: boolean | null,
 *   bytes: number, decodedBytes: number, text?: string,
 *   timings: {firstByteMs: number | null, totalMs: number | null}
 * }} ProbeResponse
 */

/** @returns {ProbeResponse} */
function baseRecord(url) {
  return {
    url,
    httpStatus: 0,
    headers: {},
    complete: false,
    error: null,
    errorCode: null,
    remoteIp: null,
    localIp: null,
    httpVersion: null,
    connectionId: null,
    reusedConnection: null,
    bytes: 0,
    decodedBytes: 0,
    timings: {
      firstByteMs: null,
      totalMs: null,
    },
  };
}

function timeoutError(milliseconds) {
  const error = new Error(`Request exceeded its ${milliseconds} ms total timeout.`);
  error.code = 'PROBE_TIMEOUT';
  return error;
}

function abortError(reason) {
  if (reason instanceof Error) return reason;
  const error = new Error('Probe request was aborted.');
  error.code = 'ABORT_ERR';
  return error;
}

/**
 * Create one pooled transport for an entire cache-probe run.
 * `requestTimeout` is expressed in seconds, matching the cache-probe CLI.
 * @param {{concurrency: number, requestTimeout?: number, proxyEnv?: Record<string, string | undefined>}} options
 */
export function createProbeClient({ concurrency, requestTimeout = 20, proxyEnv = process.env }) {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new TypeError('concurrency must be a positive integer.');
  if (!Number.isFinite(requestTimeout) || requestTimeout <= 0)
    throw new TypeError('requestTimeout must be a positive number of seconds.');

  const requestTimeoutMs = requestTimeout * 1_000;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs > 2_147_483_647)
    throw new TypeError('requestTimeout is outside the supported timer range.');

  const { options: environmentOptions, secrets } = proxyOptions(proxyEnv);
  const agentOptions = {
    ...environmentOptions,
    connections: concurrency,
    pipelining: 1,
    // Undici 8 may replay GETs after HTTP/2 GOAWAY or REFUSED_STREAM even when
    // idempotent is false. HTTP/1.1 is required for strict one-dispatch/one-GET
    // probe accounting; keep-alive reuse remains enabled.
    allowH2: false,
    connectTimeout: requestTimeoutMs,
    headersTimeout: requestTimeoutMs,
    bodyTimeout: requestTimeoutMs,
  };
  const usesProxyConfiguration = Boolean(agentOptions.httpProxy || agentOptions.httpsProxy);
  const baseDispatcher = usesProxyConfiguration
    ? new EnvHttpProxyAgent(agentOptions)
    : new Agent(agentOptions);
  const dispatcher = baseDispatcher.compose(
    interceptors.decompress({
      skipErrorResponses: false,
      maxSize: Number.MAX_SAFE_INTEGER,
    }),
  );

  const info = Object.freeze({
    name: 'Undici',
    version,
    userAgent,
    connectionReuse: true,
    timingBasis: Object.freeze({
      firstByteMs: 'request submission to the complete final response headers',
      totalMs: 'request submission through complete decoded response-body validation',
      detail:
        'Per-request DNS, connect, TLS and dispatcher-queue timings are not reported because Undici does not expose reliable timestamps for them.',
    }),
  });

  let activeDispatch = null;
  let closed = false;
  let closePromise;
  let nextConnectionId = 0;
  const requests = new WeakMap();
  const connections = new WeakMap();

  const listeners = {
    create({ request }) {
      const active = activeDispatch;
      if (
        active &&
        request.method === 'GET' &&
        ((String(request.origin) === active.origin && request.path === active.path) ||
          request.path === active.absolutePath)
      ) {
        requests.set(request, active);
        active.request = request;
      }
    },
    sendHeaders({ request, socket }) {
      const state = requests.get(request);
      if (!state || !socket) return;
      let connection = connections.get(socket);
      if (!connection) {
        connection = { id: nextConnectionId++, requests: 0 };
        connections.set(socket, connection);
      }
      state.record.connectionId = connection.id;
      state.record.reusedConnection = connection.requests > 0;
      connection.requests++;
      state.record.remoteIp = socket.remoteAddress || null;
      state.record.localIp = socket.localAddress || null;
      state.record.httpVersion = socketProtocol(socket);
    },
    headers({ request, response }) {
      const state = requests.get(request);
      if (!state || response.statusCode < 200 || state.receivedHeaders) return;
      state.receivedHeaders = true;
      state.record.httpStatus = response.statusCode;
      state.record.headers = normalizedHeaders(response.headers);
      state.record.timings.firstByteMs = performance.now() - state.startedAt;
      if (state.onHeaders) {
        try {
          state.onHeaders({
            httpStatus: state.record.httpStatus,
            headers: state.record.headers,
          });
        } catch (error) {
          state.callbackError = error;
          state.controller.abort(abortError(error));
        }
      }
    },
    bodyChunk({ request, chunk }) {
      const state = requests.get(request);
      if (state) state.record.bytes += chunk.byteLength;
    },
  };

  for (const [name, channel] of Object.entries(channels)) channel.subscribe(listeners[name]);

  /**
   * @param {string | URL} url
   * @param {{signal?: AbortSignal, captureLimit?: number,
   *   onHeaders?: (response: {httpStatus: number, headers: Record<string, string[]>}) => void}} options
   * @returns {Promise<ProbeResponse>}
   */
  async function request(url, { signal, onHeaders, captureLimit } = {}) {
    const requestedUrl = String(url);
    const record = baseRecord(requestedUrl);
    const startedAt = performance.now();
    let parsed;
    try {
      parsed = new URL(requestedUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
        throw new Error(`Unsupported request protocol ${parsed.protocol || '(missing)'}.`);
      if (onHeaders !== undefined && typeof onHeaders !== 'function')
        throw new TypeError('onHeaders must be a function.');
      if (captureLimit !== undefined && (!Number.isSafeInteger(captureLimit) || captureLimit < 0))
        throw new TypeError('captureLimit must be a non-negative safe integer.');
      if (closed) {
        const error = new Error('Probe client is closed.');
        error.code = 'PROBE_CLIENT_CLOSED';
        throw error;
      }
    } catch (error) {
      record.timings.totalMs = performance.now() - startedAt;
      record.error = errorMessage(error, secrets);
      record.errorCode = errorCode(error);
      return record;
    }

    const controller = new AbortController();
    const state = {
      startedAt,
      origin: parsed.origin,
      path: `${parsed.pathname}${parsed.search}`,
      absolutePath: `${parsed.origin}${parsed.pathname}${parsed.search}`,
      record,
      onHeaders,
      controller,
      receivedHeaders: false,
      callbackError: null,
      request: null,
    };
    const timer = setTimeout(
      () => controller.abort(timeoutError(requestTimeoutMs)),
      requestTimeoutMs,
    );
    timer.unref();
    const onAbort = () => controller.abort(abortError(signal.reason));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();

    const captured = [];
    let capturedBytes = 0;
    let captureExceeded = false;
    try {
      activeDispatch = state;
      const responsePromise = dispatcher.request({
        origin: parsed.origin,
        path: state.path,
        method: 'GET',
        headers: { 'user-agent': userAgent, 'accept-encoding': 'gzip, deflate, br, zstd' },
        idempotent: false,
        maxRedirections: 0,
        headersTimeout: requestTimeoutMs,
        bodyTimeout: requestTimeoutMs,
        signal: controller.signal,
      });
      activeDispatch = null;

      const response = await responsePromise;
      if (!state.receivedHeaders) {
        // Diagnostics are part of Undici's documented API, but retain a safe
        // fallback if a future implementation stops publishing this event.
        record.httpStatus = response.statusCode;
        record.headers = normalizedHeaders(response.headers);
        record.timings.firstByteMs = performance.now() - startedAt;
        state.receivedHeaders = true;
        if (onHeaders) onHeaders({ httpStatus: record.httpStatus, headers: record.headers });
      }
      if (state.callbackError) {
        response.body.destroy(abortError(state.callbackError));
        throw state.callbackError;
      }

      for await (const chunk of response.body) {
        record.decodedBytes += chunk.byteLength;
        if (captureLimit !== undefined && !captureExceeded) {
          if (capturedBytes + chunk.byteLength <= captureLimit) {
            captured.push(Buffer.from(chunk));
            capturedBytes += chunk.byteLength;
          } else {
            captureExceeded = true;
            captured.length = 0;
          }
        }
      }

      record.timings.totalMs = performance.now() - startedAt;
      if (captureExceeded) {
        record.error = `Decoded response exceeded captureLimit (${captureLimit} bytes).`;
        record.errorCode = 'PROBE_CAPTURE_LIMIT';
      } else {
        record.complete = true;
        if (captureLimit !== undefined) record.text = Buffer.concat(captured).toString('utf8');
      }
      return record;
    } catch (error) {
      activeDispatch = null;
      if (state.callbackError) throw state.callbackError;
      record.timings.totalMs = performance.now() - startedAt;
      record.error = errorMessage(error, secrets);
      record.errorCode = errorCode(error);
      return record;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async function close() {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = baseDispatcher.close().finally(() => {
      for (const [name, channel] of Object.entries(channels)) channel.unsubscribe(listeners[name]);
    });
    return closePromise;
  }

  return { info, request, close };
}
