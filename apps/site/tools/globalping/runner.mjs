import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const cliPath = fileURLToPath(
  new URL('../../../../.tools/bin/globalping-cli', import.meta.url),
);
export const defaultDatabase = fileURLToPath(
  new URL('../../.reports/globalping/measurements.sqlite', import.meta.url),
);
const values = new Set([
  'url',
  'from',
  'limit',
  'database',
  'process-timeout',
  'header',
  'timeout',
]);
const switches = new Set(['help', 'json', 'ipv4', 'ipv6']);

export function parseArguments(argv) {
  if (
    !Array.isArray(argv) ||
    argv.some((value) => typeof value !== 'string' || value.includes('\0'))
  )
    throw new Error('参数必须是字符串数组，且不能包含 NUL 字符。');
  const options = { header: [] };
  for (let i = 0; i < argv.length; i++) {
    const match = /^--([a-z0-9-]+)(?:=(.*))?$/s.exec(argv[i]);
    if (!match || (!values.has(match[1]) && !switches.has(match[1])))
      throw new Error(`不支持的参数：${argv[i]}`);
    const [, name, inline] = match;
    if (name !== 'header' && Object.hasOwn(options, name))
      throw new Error(`参数不能重复：--${name}`);
    if (switches.has(name)) {
      if (inline !== undefined) throw new Error(`--${name} 不接收值。`);
      options[name] = true;
    } else {
      const value = inline ?? argv[++i];
      if (value === undefined || (inline === undefined && value.startsWith('--')))
        throw new Error(`--${name} 缺少值。`);
      if (name === 'header') options.header.push(value);
      else options[name] = value;
    }
  }
  if (options.help) return { help: true };
  if (!options.url || !options.from?.trim())
    throw new Error('必须提供一个 --url 和明确的 --from。');
  if (options.ipv4 && options.ipv6) throw new Error('--ipv4 与 --ipv6 不能同时使用。');
  if (options.from.split(',').some((part) => /^(?:last|previous|first|@-?\d+)$/i.test(part.trim())))
    throw new Error('--from 不接受隐式会话选择器；请提供地区表达式或测量 ID。');
  const url = new URL(options.url);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    options.url.includes('#')
  )
    throw new Error('URL 必须使用 HTTP(S)，且不包含用户名、密码或片段。');
  if (url.hostname.includes(',') || url.hostname.startsWith('-'))
    throw new Error('URL 主机名不能包含逗号或以连字符开头。');
  const integer = (name, fallback) => {
    const value = options[name] ?? fallback;
    if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1)
      throw new Error(`--${name} 必须是正的安全整数。`);
    return Number(value);
  };
  let processTimeout = null;
  if (options['process-timeout'] !== undefined) {
    processTimeout = Number(options['process-timeout']);
    if (
      !Number.isFinite(processTimeout) ||
      processTimeout <= 0 ||
      processTimeout * 1000 > 2147483647
    )
      throw new Error('--process-timeout 必须是有效的正秒数（最多 2147483.647 秒）。');
  }
  const http = {
    protocol: url.protocol.slice(0, -1).toUpperCase(),
    port: Number(url.port || (url.protocol === 'http:' ? 80 : 443)),
    path: url.pathname,
    query: url.search ? url.search.slice(1) : null,
    method: 'GET',
    from: options.from,
    limit: integer('limit', 1),
    timeout: options.timeout === undefined ? null : integer('timeout', null),
  };
  const args = ['http', url.hostname];
  for (const [name, value] of Object.entries(http)) {
    if (value !== null) args.push(`--${name}`, String(value));
  }
  if (options.ipv4) args.push('--ipv4');
  if (options.ipv6) args.push('--ipv6');
  for (const header of options.header) args.push('--header', header);
  args.push('--json', '--ci');
  return {
    help: false,
    json: Boolean(options.json),
    request: {
      url: options.url,
      request_method: http.method,
      request_from: http.from,
      request_limit: http.limit,
      request_headers_json: JSON.stringify(options.header),
      process_timeout_s: processTimeout,
    },
    args,
    database: resolve(options.database ?? defaultDatabase),
  };
}

/** @param {string} executable @param {string[]} args
 * @param {{signal?: AbortSignal, timeoutSeconds?: number|null}} [options] */
export function runProcess(executable, args, { signal, timeoutSeconds } = {}) {
  return new Promise((resolveResult) => {
    const stdout = [],
      stderr = [];
    const result = { code: null, signal: null, reason: null, error: null };
    const finish = () =>
      resolveResult({ ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    const abortReason = () => (signal.reason === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
    if (signal?.aborted) {
      result.reason = abortReason();
      finish();
      return;
    }
    let child, timeout, killTimer;
    try {
      child = spawn(executable, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      result.error = error;
      finish();
      return;
    }
    const stop = (why) => {
      if (result.reason) return;
      result.reason = why;
      child.kill(why === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
    };
    const abort = () => stop(abortReason());
    child.stdout.on('data', (bytes) => stdout.push(bytes));
    child.stderr.on('data', (bytes) => stderr.push(bytes));
    child.on('error', (error) => {
      result.error = error;
    });
    child.on('close', (code, exitSignal) => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);
      result.code = code;
      result.signal = exitSignal;
      finish();
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (timeoutSeconds != null) timeout = setTimeout(() => stop('timeout'), timeoutSeconds * 1000);
  });
}
