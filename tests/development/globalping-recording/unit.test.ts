import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { parseArguments, runProcess } from '../../../apps/site/tools/globalping/runner.mjs';
import { parseMeasurement } from '../../../apps/site/tools/globalping/parse.mjs';
import { parseHeaders, httpDate } from '../../../apps/site/tools/globalping/headers.mjs';
import { recordMeasurement } from '../../../apps/site/tools/globalping/probe.mjs';
import { MeasurementStore } from '../../../apps/site/tools/globalping/store.mjs';
import { columns } from '../../../apps/site/tools/globalping/schema.mjs';
import { measurement } from './fixture.mjs';

let directory: string, database: string;
const input = ['--url', 'https://sshawn9.com/zh/', '--from', 'China+Shanghai'];
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'globalping-record-'));
  database = join(directory, 'measurements.sqlite');
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function fake(body: string) {
  const executable = join(directory, 'globalping-cli');
  writeFileSync(
    executable,
    `#!${process.execPath}\nimport {appendFileSync,writeFileSync} from 'node:fs';\nconst args=process.argv.slice(2);\nappendFileSync(${JSON.stringify(join(directory, 'calls.jsonl'))},JSON.stringify(args)+'\\n');\n${body}\n`,
  );
  chmodSync(executable, 0o755);
  return executable;
}
function successful(data = measurement()) {
  return fake(`process.stdout.write(${JSON.stringify(JSON.stringify(data))});`);
}
function args(...extra: string[]) {
  return [...input, '--database', database, ...extra];
}
function requestConfig(...extra: string[]) {
  const { request, args: cliArgs, database } = parseArguments(args(...extra));
  if (!request || !cliArgs || !database) throw new Error('Expected measurement configuration');
  return { request, args: cliArgs, database };
}
// Run the real entry point with an isolated installation of the fake executable.
function runCLI(executable: string, ...extra: string[]) {
  const project = join(directory, 'cli-project');
  const tools = join(project, 'apps/site/tools/globalping');
  const bin = join(project, '.tools/bin');
  cpSync(resolve('apps/site/tools/globalping'), tools, { recursive: true });
  mkdirSync(bin, { recursive: true });
  copyFileSync(executable, join(bin, 'globalping-cli'));
  return spawnSync(process.execPath, [join(tools, 'cli.mjs'), ...args(...extra)], {
    encoding: 'utf8',
  });
}
function select(sql = 'SELECT * FROM measurements ORDER BY rowid') {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}
function headers(value: unknown) {
  const issues: { path: string; reason: string }[] = [];
  return { row: parseHeaders(value, issues) as Record<string, any>, issues };
}
const parsed = (data = measurement()) => parseMeasurement(Buffer.from(JSON.stringify(data)));

describe('single URL CLI contract', () => {
  it('keeps URL encoding, commas, repeated query parameters, and headers in distinct argv entries', () => {
    const config = parseArguments([
      '--url',
      'https://example.com/a%2Fb,c?x=1&x=2&x=%2F,3',
      '--from',
      'Shanghai',
      '--header',
      'X-A: $(touch nope)',
      '--header',
      'X-B: 2',
    ]);
    expect(config.request).toMatchObject({ request_method: 'GET', request_limit: 1 });
    expect(config.args).toEqual([
      'http',
      'example.com',
      '--protocol',
      'HTTPS',
      '--port',
      '443',
      '--path',
      '/a%2Fb,c',
      '--query',
      'x=1&x=2&x=%2F,3',
      '--method',
      'GET',
      '--from',
      'Shanghai',
      '--limit',
      '1',
      '--header',
      'X-A: $(touch nope)',
      '--header',
      'X-B: 2',
      '--json',
      '--ci',
    ]);
    expect(config.args).toContain('X-A: $(touch nope)');
    expect(config.args?.slice(-2)).toEqual(['--json', '--ci']);
  });
  it('takes the protocol, port, encoded path and query from the URL with an IPv6 host', () => {
    const config = parseArguments([
      '--url',
      'http://[2001:db8::1]:8080/a%2Fb?x=1&x=2',
      '--from',
      'id12345678901234',
      '--ipv6',
    ]);
    expect(config.args).toEqual([
      'http',
      '[2001:db8::1]',
      '--protocol',
      'HTTP',
      '--port',
      '8080',
      '--path',
      '/a%2Fb',
      '--query',
      'x=1&x=2',
      '--method',
      'GET',
      '--from',
      'id12345678901234',
      '--limit',
      '1',
      '--ipv6',
      '--json',
      '--ci',
    ]);
  });
  it.each([
    ['http://example.com/a', 'HTTP', '80'],
    ['https://example.com/a', 'HTTPS', '443'],
    ['http://example.com:443/a', 'HTTP', '443'],
    ['https://example.com:80/a', 'HTTPS', '80'],
  ])('uses the scheme and port in %s', (url, protocol, port) => {
    const { args } = parseArguments(['--url', url, '--from', 'CN+Shanghai']);
    if (!args) throw new Error('Expected measurement arguments');
    expect(args[args.indexOf('--protocol') + 1]).toBe(protocol);
    expect(args[args.indexOf('--port') + 1]).toBe(port);
  });
  it.each([
    ['--host', 'example.com'],
    ['--path', '/another.css'],
    ['--query', 'v=2'],
    ['--protocol', 'HTTP'],
    ['--port', '8443'],
    ['--method', 'HEAD'],
    ['--resolver', '1.1.1.1'],
  ])('rejects removed option %s before creating a database or running the CLI', (flag, value) => {
    const result = runCLI(successful(), flag, value);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('INVALID_ARGUMENT');
    expect(result.stderr).toContain(flag);
    expect(existsSync(database)).toBe(false);
    expect(existsSync(join(directory, 'calls.jsonl'))).toBe(false);
  });
  it.each([
    ['--request', 'request.json'],
    ['--inventory', 'inventory.json'],
    ['--measurement', 'old'],
    [...input, 'another-url'],
    [...input, '--url', 'https://example.com'],
    [...input, '--limit', '0'],
    [...input, '--ipv4', '--ipv6'],
    [...input, '--full'],
    ['--url', 'https://user:pass@example.com', '--from', 'Shanghai'],
    ['--url', 'https://example.com/#', '--from', 'Shanghai'],
    ['--url', 'ftp://example.com', '--from', 'Shanghai'],
    ...['last', 'first', 'previous', '@1', '@-2', 'Shanghai,last'].map((from) => [
      '--url',
      'https://example.com',
      '--from',
      from,
    ]),
  ])('rejects non-self-contained or invalid input %j', (...argv) => {
    expect(() => parseArguments(argv)).toThrow();
  });
  it('help creates no database or measurement', () => {
    const output = spawnSync(
      process.execPath,
      ['apps/site/tools/globalping/cli.mjs', '--help', '--database', database],
      { encoding: 'utf8' },
    );
    expect(output.status).toBe(0);
    expect(output.stdout).toContain('--url');
    expect(existsSync(database)).toBe(false);
  });
});

describe('terminal output', () => {
  it('defaults to one line per node and keeps the full response in SQLite', () => {
    const data = measurement();
    const body = '<html>BODY_ONLY_IN_ARCHIVE</html>'.repeat(2000);
    data.results[0].result.rawBody = body;
    data.results[0].result.timings!.total = 0;
    const output = runCLI(successful(data));
    expect(output.status).toBe(0);
    expect(output.stderr).toBe('');
    expect(output.stdout.split('\n').filter((line) => /^\[\d+\]/.test(line))).toHaveLength(3);
    expect(output.stdout).toContain(
      'Shanghai, CN AS45090 | finished | HTTP 200 | 缓存 HIT | CF NRT | 0 ms',
    );
    expect(output.stdout).toContain('Beijing, CN AS45090 | failed | HTTP - | 缓存 - | CF - | -');
    expect(output.stdout).toContain('Tokyo, JP AS45090 | offline');
    expect(output.stdout).toContain('已保存 3 条记录');
    expect(output.stdout).toContain(database);
    expect(output.stdout.length).toBeLessThan(1000);
    expect(output.stdout).not.toMatch(/BODY_ONLY_IN_ARCHIVE|raw_headers|source_json|fixture-key/);
    const row = select()[0];
    expect(JSON.parse(row.source_json as string).observation.result.rawBody).toBe(body);
    expect(JSON.parse(row.source_json as string).observation.result.tls.publicKey).toBe(
      'fixture-key',
    );
    expect(Object.keys(row)).toHaveLength(57);
  });
  it('emits the complete result only with --json, without changing measurement arguments', () => {
    const output = runCLI(successful(), '--json');
    expect(output.status).toBe(0);
    expect(output.stderr).toBe('');
    const result = JSON.parse(output.stdout);
    expect(result).toMatchObject({ saved: true, collectionStatus: 'stored' });
    expect(result.records).toEqual(select());
    expect(JSON.parse(result.records[0].source_json).observation).toEqual(measurement().results[0]);
    expect(JSON.parse(result.records[0].cli_argv_json)).toEqual(parseArguments(args()).args);
  });
  it('prints bounded CLI errors while archiving their complete text', () => {
    const error = `rate limit exceeded\n${'diagnostic '.repeat(500)}`;
    const output = runCLI(
      fake(`process.stderr.write(${JSON.stringify(error)});process.exitCode=1;`),
    );
    expect(output.status).toBe(1);
    expect(output.stdout).toContain('已保存 1 条记录');
    expect(output.stdout).toContain('采集状态: cli_error');
    expect(output.stderr).toContain('rate limit exceeded');
    expect(output.stderr).toContain('完整信息见数据库或 --json');
    expect(output.stderr.length).toBeLessThan(1000);
    expect(select()[0].cli_stderr).toBe(error);
  });
  it('never claims the node results were saved after a transaction failure', () => {
    const store = new MeasurementStore(database);
    store.db.exec(
      "CREATE TRIGGER fail_second BEFORE INSERT ON measurements WHEN NEW.probe_index=1 BEGIN SELECT RAISE(ABORT,'injected failure'); END;",
    );
    store.close();
    const output = runCLI(successful());
    expect(output.status).toBe(1);
    expect(output.stdout).toContain('未完成入库');
    expect(output.stdout).not.toContain('已保存');
    expect(output.stderr).toContain('injected failure');
    expect(select()).toHaveLength(1);
    expect(select()[0].collection_status).toBe('running');
  });
  it.each([false, true])(
    'reports input errors in the requested output format (json=%s)',
    (json) => {
      const output = spawnSync(
        process.execPath,
        [
          'apps/site/tools/globalping/cli.mjs',
          '--url',
          'invalid',
          '--from',
          'Shanghai',
          ...(json ? ['--json'] : []),
        ],
        { encoding: 'utf8' },
      );
      expect(output.status).toBe(1);
      if (json) {
        expect(JSON.parse(output.stdout)).toMatchObject({
          saved: false,
          errors: [{ stage: 'input', code: 'INVALID_ARGUMENT' }],
        });
        expect(output.stderr).toBe('');
      } else {
        expect(output.stdout).toContain('未完成入库');
        expect(output.stderr).toContain('INVALID_ARGUMENT');
      }
    },
  );
});

describe('queryable facts and lossless source', () => {
  it('projects exactly the agreed columns while retaining the complete source', () => {
    const result = parsed();
    expect(result.issues).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      probe_city: 'Shanghai',
      probe_asn: 45090,
      http_status_code: 200,
      cache_status: 'HIT',
      cf_colo: 'NRT',
      truncated: 1,
      dns_ms: null,
      download_ms: 0,
      tls_authorized: 0,
      tls_error: 'fixture verification error',
      cc_max_age_seconds: 400,
      cc_no_store: 0,
      cc_must_revalidate: 1,
      content_media_type: 'text/html',
      vary_star: 0,
    });
    expect(Object.keys(columns)).toHaveLength(57);
    for (const row of result.rows)
      expect(Object.keys(row).sort()).toEqual(Object.keys(columns).sort());
    expect(JSON.parse(result.rows[0].probe_tags_json)).toEqual(['u-example', 'datacenter-network']);
    expect(result.rows[1]).toMatchObject({
      result_status: 'failed',
      failure_source: 'target',
      raw_output: 'connection refused',
      http_status_code: null,
    });
    expect(result.rows[2]).toMatchObject({ result_status: 'offline', tls_authorized: null });
    const source = JSON.parse(result.rows[0].source_json);
    expect(source.measurement.results).toBeUndefined();
    expect(source.observation).toEqual(measurement().results[0]);
    expect(source.measurement.measurementOptions).toEqual(measurement().measurementOptions);
  });
  it('archives removed fields without running their former dedicated parsers', () => {
    const data: any = measurement();
    data.measurementOptions.ipVersion = 6;
    data.results[0].result.headers['Server-Timing'] = 'unparseable metric';
    data.results[0].result.headers['CDN-Cache-Control'] = 'max-age=invalid';
    data.results[0].result.headers['Cloudflare-CDN-Cache-Control'] = 'no-store=invalid';
    data.results[0].result.headers['Content-Type'] = 'text/html; charset="unterminated';
    data.results[0].result.tls.subject.alt = 'unparseable SAN';
    data.results[0].result.tls.createdAt = 'invalid certificate date';
    const result = parsed(data);
    expect(result.issues).toEqual([]);
    expect(result.rows[0].content_media_type).toBe('text/html');
    expect(JSON.parse(result.rows[0].source_json).observation).toEqual(data.results[0]);
  });
  it('preserves unknown large numbers and precise decimals without Number roundtripping', () => {
    const source = JSON.stringify(measurement()).replace(
      '"id":',
      '"future":9007199254740993,"precision":0.10000000000000001,"id":',
    );
    const row = parseMeasurement(Buffer.from(source)).rows[0];
    expect(row.source_json).toContain('9007199254740993');
    expect(row.source_json).toContain('0.10000000000000001');
  });
  it('reports malformed fixed fields while preserving every source and other node', () => {
    const data: any = measurement();
    data.results[0].result.timings.tcp = '10';
    data.results[0].probe.asn = 9007199254740992;
    data.createdAt = '2026-02-30T00:00:00Z';
    data.results[0].probe.tags = [{}];
    data.results[1].probe.city = 123;
    const result = parsed(data);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({
      tcp_ms: null,
      probe_asn: null,
      measurement_created_at: null,
      probe_tags_json: null,
    });
    expect(result.issues.map(({ path, probeIndex }) => [path, probeIndex])).toEqual([
      ['createdAt', 0],
      ['probe.asn', 0],
      ['probe.tags', 0],
      ['result.timings.tcp', 0],
      ['createdAt', 1],
      ['probe.city', 1],
      ['createdAt', 2],
    ]);
    expect(result.rows[0].source_json).toContain('"tcp":"10"');
  });
});

describe('retained HTTP fields', () => {
  it('parses the six retained cache fields across lines, quoted lists and extensions', () => {
    const { row, issues } = headers({
      'Cache-Control': [
        'max-age="0", private="Set-Cookie, X-User"',
        's-maxage=30, max-age=0, no-cache="ETag", x-ext="a,b"',
      ],
    });
    expect(issues).toEqual([]);
    expect(row).toMatchObject({
      cc_max_age_seconds: 0,
      cc_s_maxage_seconds: 30,
      cc_private: 1,
      cc_no_cache: 1,
      cc_no_store: 0,
      cc_must_revalidate: 0,
    });
  });
  it('distinguishes absent directives, conflicts and malformed values', () => {
    expect(headers({}).row.cc_no_store).toBeUndefined();
    const { row, issues } = headers({
      'Cache-Control': 'max-age=1, max-age=2, s-maxage=-1, private',
    });
    expect(row).toMatchObject({ cc_max_age_seconds: null, cc_private: 1, cc_no_store: null });
    expect(issues).toHaveLength(2);
    for (const value of [
      'max-age=1.5',
      'max-age=9007199254740993',
      'no-cache="unterminated',
      'no-store=foo',
      'private="bad field"',
    ])
      expect(headers({ 'Cache-Control': value }).issues.length).toBeGreaterThan(0);
  });
  it('handles case-insensitive headers and rejects conflicting scalars', () => {
    const { row, issues } = headers({
      'CF-Cache-Status': ['HIT', 'MISS'],
      Age: ['0', '0'],
      'CF-Ray': 'unknown',
      'cOnTeNt-TyPe': 'image/PNG',
    });
    expect(row).toMatchObject({
      cache_status: null,
      age_seconds: 0,
      cf_colo: null,
      content_media_type: 'image/png',
    });
    expect(issues).toHaveLength(2);
    expect(headers({ Age: '-1' }).issues).toHaveLength(1);
  });
  it('validates Last-Modified HTTP dates without guessing or calendar rollover', () => {
    for (const value of [
      'Sun, 06 Nov 1994 08:49:37 GMT',
      'Sunday, 06-Nov-94 08:49:37 GMT',
      'Sun Nov  6 08:49:37 1994',
    ]) {
      expect(headers({ 'Last-Modified': value }).row.last_modified_utc).toBe(
        '1994-11-06T08:49:37.000Z',
      );
    }
    expect(httpDate('Sat, 31 Dec 2016 23:59:60 GMT')).toBe('2017-01-01T00:00:00.000Z');
    for (const value of [
      '0',
      '2026-09-18',
      'Mon, 30 Feb 2026 00:00:00 GMT',
      'Fri, 18 Sep 2026 25:00:00 GMT',
    ]) {
      const result = headers({ 'Last-Modified': value });
      expect(result.row.last_modified_utc).toBeNull();
      expect(result.issues).toHaveLength(1);
    }
    expect(
      headers({
        'Last-Modified': ['Fri, 18 Sep 2026 15:23:18 GMT', 'Sat, 19 Sep 2026 15:23:18 GMT'],
      }).row.last_modified_utc,
    ).toBeNull();
  });
  it('extracts media type and Vary fields without parsing removed parameters', () => {
    const { row, issues } = headers({
      'Content-Type': 'TEXT/HTML; charset=UTF-8; other="a;b"',
      Vary: ['Accept-Encoding', '*, Origin'],
    });
    expect(issues).toEqual([]);
    expect(row).toMatchObject({ content_media_type: 'text/html', vary_star: 1 });
    expect(JSON.parse(row.vary_fields_json)).toEqual(['accept-encoding', 'origin']);
    expect(headers({ 'Content-Type': 'not-a-media-type', Vary: 'bad field' }).issues).toHaveLength(
      2,
    );
  });
});

describe('single-table recording and failure boundaries', () => {
  it('writes exactly N independent node rows, supports SQL filtering, and always appends repeated calls', async () => {
    const executable = successful();
    const first = await recordMeasurement(requestConfig('--limit', '3'), { executable });
    expect(first.errors).toEqual([]);
    expect(first).toMatchObject({ saved: true, collectionStatus: 'stored', exitCode: 0 });
    expect(first.recordIds).toHaveLength(3);
    expect(first.records).toEqual(select());
    expect(first.records[0]).toMatchObject({
      request_limit: 3,
      process_timeout_s: null,
      request_method: 'GET',
    });
    expect(Object.keys(first.records[0])).toHaveLength(57);
    const matches = select(
      "SELECT url,probe_city,probe_asn,http_status_code,cache_status,total_ms,cc_max_age_seconds FROM measurements WHERE url='https://sshawn9.com/zh/' AND measurement_created_at >= '2026-09-18' AND probe_city='Shanghai' AND probe_asn=45090 AND http_status_code=200 AND cache_status='HIT'",
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ total_ms: 703, cc_max_age_seconds: 400 });
    const second = await recordMeasurement(requestConfig(), { executable });
    expect(second.saved).toBe(true);
    expect(second.invocationId).not.toBe(first.invocationId);
    expect(select()).toHaveLength(6);
    const calls = readFileSync(join(directory, 'calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((s) => JSON.parse(s));
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c[0] === 'http')).toBe(true);
    const store = new MeasurementStore(database);
    expect(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([
      { name: 'measurements' },
    ]);
    store.close();
  });
  it('stores CLI rate-limit evidence once, without inventing API headers or retrying', async () => {
    const executable = fake(
      'process.stderr.write("Error: rate limit exceeded; wait 60 seconds"); process.exitCode=1;',
    );
    const result = await recordMeasurement(requestConfig(), { executable });
    expect(result).toMatchObject({ saved: true, collectionStatus: 'cli_error', exitCode: 1 });
    expect(result.cliStderr).toContain('rate limit');
    expect(select()[0]).toMatchObject({
      probe_index: null,
      http_status_code: null,
    });
    expect(readFileSync(join(directory, 'calls.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
  });
  it('treats target HTTP 429 and failed/offline nodes as recorded observations', async () => {
    const data = measurement();
    data.results[0].result.statusCode = 429;
    expect(
      await recordMeasurement(requestConfig(), { executable: successful(data) }),
    ).toMatchObject({
      saved: true,
      exitCode: 0,
      collectionStatus: 'stored',
    });
    expect(select()[0].http_status_code).toBe(429);
  });
  it('preserves invalid UTF-8 and malformed JSON bytes', async () => {
    const executable = fake(
      'process.stdout.write(Buffer.from([0xff,0x7b])); process.stderr.write("partial");',
    );
    expect(await recordMeasurement(requestConfig(), { executable })).toMatchObject({
      saved: true,
      exitCode: 1,
      collectionStatus: 'parse_error',
    });
    expect(Buffer.from(select()[0].unparsed_stdout as Uint8Array)).toEqual(
      Buffer.from([0xff, 0x7b]),
    );
  });
  it('keeps parsed nodes even on nonzero CLI exit or mapping errors', async () => {
    const data: any = measurement();
    data.results[0].result.timings.tcp = 'bad';
    const executable = fake(
      `process.stdout.write(${JSON.stringify(JSON.stringify(data))}); process.stderr.write('post-output error'); process.exitCode=1;`,
    );
    const result = await recordMeasurement(requestConfig(), { executable });
    expect(result).toMatchObject({ saved: true, exitCode: 1, collectionStatus: 'cli_error' });
    expect(select()).toHaveLength(3);
    expect(select()[0].tcp_ms).toBeNull();
  });
  it.each([{ results: [] }, { results: null }])(
    'keeps invocation metadata and raw bytes when results is $results',
    async ({ results }) => {
      const data = { ...measurement(), results };
      const raw = JSON.stringify(data);
      const result = await recordMeasurement(requestConfig(), {
        executable: fake(`process.stdout.write(${JSON.stringify(raw)});`),
      });
      expect(result).toMatchObject({ saved: true, collectionStatus: 'parse_error', exitCode: 1 });
      expect(select()).toHaveLength(1);
      expect(select()[0]).toMatchObject({
        probe_index: null,
        measurement_id: data.id,
        request_method: 'GET',
      });
      expect(Buffer.from(select()[0].unparsed_stdout as Uint8Array).toString()).toBe(raw);
      expect(result.records[0].source_json).toBe(select()[0].source_json);
    },
  );
  it('records missing binary before any measurement and points to installation', async () => {
    const result = await recordMeasurement(requestConfig(), {
      executable: join(directory, 'missing'),
    });
    expect(result).toMatchObject({ saved: true, exitCode: 1, collectionStatus: 'cli_error' });
    expect(result.errors.some((e) => e.code === 'ENOENT')).toBe(true);
  });
  it('saves all observations but returns parse_error when a successful CLI delivers invalid fixed fields', async () => {
    const data: any = measurement();
    data.results[0].result.headers.Age = 'invalid';
    const result = await recordMeasurement(requestConfig(), { executable: successful(data) });
    expect(result).toMatchObject({ saved: true, exitCode: 1, collectionStatus: 'parse_error' });
    expect(select()).toHaveLength(3);
    expect(JSON.parse(select()[0].parse_issues_json as string)[0].path).toBe('headers.age');
  });
  it('does not spawn a CLI for a pre-aborted call', async () => {
    const controller = new AbortController();
    controller.abort('SIGTERM');
    const result = await recordMeasurement(requestConfig(), {
      executable: successful(),
      signal: controller.signal,
    });
    expect(result).toMatchObject({ saved: true, collectionStatus: 'interrupted', exitCode: 143 });
    expect(existsSync(join(directory, 'calls.jsonl'))).toBe(false);
  });
  it.each(['SIGINT', 'SIGTERM'])(
    'checks %s before attempting to spawn even a missing executable',
    async (signal) => {
      const controller = new AbortController();
      controller.abort(signal);
      const result = await runProcess(join(directory, 'missing'), ['version'], {
        signal: controller.signal,
      });
      expect(result).toEqual({
        code: null,
        signal: null,
        reason: signal,
        error: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
      });
    },
  );
  it('force-kills its own unresponsive child after the cancellation grace period', async () => {
    const executable = fake(
      "process.on('SIGTERM',()=>{}); process.stdout.write('ready'); setInterval(()=>{},1000);",
    );
    const result: any = await runProcess(executable, ['http'], { timeoutSeconds: 0.2 });
    expect(result.reason).toBe('timeout');
    expect(result.signal).toBe('SIGKILL');
    expect(result.stdout.toString()).toBe('ready');
  }, 10000);
  it('terminates on local timeout and saves partial output', async () => {
    const executable = fake('process.stdout.write("{partial"); setInterval(()=>{},1000);');
    const result = await recordMeasurement(requestConfig('--process-timeout', '0.3'), {
      executable,
    });
    expect(result).toMatchObject({ saved: true, exitCode: 1, collectionStatus: 'cli_error' });
    expect(result.errors.some((e) => e.code === 'PROCESS_TIMEOUT')).toBe(true);
    expect(Buffer.from(select()[0].unparsed_stdout as Uint8Array).toString()).toBe('{partial');
  });
  it.each(['SIGINT', 'SIGTERM'])('forwards %s and saves an interrupted record', async (signal) => {
    const marker = join(directory, 'ready');
    const waitForSignal = `process.on('SIGINT',()=>{process.stderr.write('got SIGINT');process.exit(0)});process.on('SIGTERM',()=>{process.stderr.write('got SIGTERM');process.exit(0)});writeFileSync(${JSON.stringify(marker)},'ready');setInterval(()=>{},1000);`;
    const executable = fake(waitForSignal);
    const controller = new AbortController();
    const pending = recordMeasurement(requestConfig(), { executable, signal: controller.signal });
    for (let i = 0; i < 100 && !existsSync(marker); i++)
      await new Promise((r) => setTimeout(r, 10));
    controller.abort(signal);
    const result = await pending;
    expect(result).toMatchObject({
      saved: true,
      collectionStatus: 'interrupted',
      exitCode: signal === 'SIGINT' ? 130 : 143,
    });
    expect(result.cliStderr).toContain(`got ${signal}`);
    expect(result.errors.map((error) => error.code)).toEqual([signal]);
    expect(readFileSync(join(directory, 'calls.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
  });
  it('rolls back the entire node group on a database write failure', async () => {
    const executable = successful();
    await recordMeasurement(requestConfig(), { executable });
    const store = new MeasurementStore(database);
    store.db.exec(
      "CREATE TRIGGER fail_second BEFORE INSERT ON measurements WHEN NEW.probe_index=1 BEGIN SELECT RAISE(ABORT,'injected failure'); END;",
    );
    store.close();
    const result = await recordMeasurement(requestConfig(), { executable });
    expect(result).toMatchObject({ saved: false, exitCode: 1 });
    expect(result.recordIds).toEqual([]);
    expect(select()).toHaveLength(4);
    expect(select().filter((r) => r.collection_status === 'stored')).toHaveLength(3);
    expect(select()[3].collection_status).toBe('running');
  });
  it.each([
    "CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES ('keep')",
    "CREATE VIEW unrelated AS SELECT 'keep' AS value",
  ])('refuses unrelated databases without changing their data: %s', async (sql) => {
    const db = new DatabaseSync(database);
    db.exec(sql);
    db.close();
    const result = await recordMeasurement(requestConfig(), { executable: successful() });
    expect(result.saved).toBe(false);
    expect(result.cliStderr).toBe('');
    expect(select('SELECT * FROM unrelated')).toEqual([{ value: 'keep' }]);
    expect(existsSync(join(directory, 'calls.jsonl'))).toBe(false);
  });
  it('allows independent processes to append concurrently without mixed invocations', async () => {
    const executable = successful();
    const module = resolve('apps/site/tools/globalping/probe.mjs');
    const script = `import {recordMeasurement} from ${JSON.stringify(module)};const r=await recordMeasurement(${JSON.stringify(requestConfig())},{executable:${JSON.stringify(executable)}});process.stdout.write(JSON.stringify(r));process.exitCode=r.exitCode;`;
    const output = await Promise.all([
      runProcess(process.execPath, ['--input-type=module', '-e', script]),
      runProcess(process.execPath, ['--input-type=module', '-e', script]),
    ]);
    expect(output.map((o: any) => o.code)).toEqual([0, 0]);
    expect(
      select(
        'SELECT invocation_id, count(*) AS count FROM measurements GROUP BY invocation_id',
      ).map((r) => r.count),
    ).toEqual([3, 3]);
  });
  it('leaves a committed running row after uncatchable termination, without automatic replay', async () => {
    const executable = successful();
    // Kill the local writer before any measurement starts; no orphan child.
    const script = `import {MeasurementStore} from ${JSON.stringify(resolve('apps/site/tools/globalping/store.mjs'))};import {emptyRow} from ${JSON.stringify(resolve('apps/site/tools/globalping/schema.mjs'))};const s=new MeasurementStore(${JSON.stringify(database)});s.begin({...emptyRow(),id:'hard-kill',invocation_id:'hard-kill',collection_status:'running',local_started_at:new Date().toISOString(),url:'https://sshawn9.com/zh/'});console.log('ready');setInterval(()=>{},1000);`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await once(child.stdout, 'data');
    const closed = once(child, 'close');
    child.kill('SIGKILL');
    await closed;
    await recordMeasurement(requestConfig(), { executable });
    expect(select()).toHaveLength(4);
    expect(select()[0].collection_status).toBe('running');
  });
});
