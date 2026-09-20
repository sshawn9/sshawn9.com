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
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import {
  prepareBatch,
  runBatch,
  defaultResources,
} from '../../../../apps/site/tools/globalping/batch.mjs';
import { defaultDatabase } from '../../../../apps/site/tools/globalping/runner.mjs';
import { recordMeasurement } from '../../../../apps/site/tools/globalping/probe.mjs';
import { MeasurementStore } from '../../../../apps/site/tools/globalping/store.mjs';
import { emptyRow } from '../../../../apps/site/tools/globalping/schema.mjs';
import { measurement } from '../fixture.mjs';

const currentTime = Date.parse('2026-09-20T12:00:00.000Z');
const urlA = 'https://example.com/a.css?x=1&x=2',
  urlB = 'https://example.com/b.css';
let directory: string, database: string, inventory: string, citiesFile: string, clock: number;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'globalping-batch-'));
  database = join(directory, 'measurements.sqlite');
  inventory = join(directory, 'resources.json');
  citiesFile = join(directory, 'cities.json');
  clock = currentTime;
  lists();
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function lists(
  resources = [{ url: urlA, refs: 1 }],
  cities: object[] = [{ country: 'CN', city: 'Shanghai' }],
) {
  writeFileSync(
    inventory,
    JSON.stringify({
      resources: resources.map(({ url }) => ({ url })),
      resourcePages: Object.fromEntries(
        resources.map(({ url, refs }) => [
          url,
          Array.from({ length: refs }, (_, i) => `https://example.com/page/${i}`),
        ]),
      ),
    }),
  );
  writeFileSync(citiesFile, JSON.stringify(cities));
}
function args(...extra: string[]) {
  return [
    '--resources',
    inventory,
    '--cities',
    citiesFile,
    '--database',
    database,
    '--history-days',
    '1',
    ...extra,
  ];
}
function rows() {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    return db.prepare('SELECT * FROM measurements ORDER BY rowid').all();
  } finally {
    db.close();
  }
}
function seed(entries: object[]) {
  const store = new MeasurementStore(database);
  try {
    for (const entry of entries)
      store.begin({
        ...emptyRow(),
        id: randomUUID(),
        invocation_id: randomUUID(),
        collection_status: 'stored',
        local_started_at: new Date(currentTime).toISOString(),
        url: urlA,
        probe_country: 'CN',
        probe_city: 'Shanghai',
        probe_index: 0,
        measurement_created_at: new Date(currentTime - 1000).toISOString(),
        result_status: 'finished',
        http_status_code: 200,
        cache_status: 'HIT',
        ...entry,
      });
  } finally {
    store.close();
  }
}
function fake(body = '') {
  const data = measurement();
  data.results = data.results.slice(0, 1);
  const executable = join(directory, 'globalping-cli');
  writeFileSync(
    executable,
    `#!${process.execPath}
import {appendFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const argv = process.argv.slice(2), get = name => argv[argv.indexOf(name) + 1];
appendFileSync(${JSON.stringify(join(directory, 'calls.jsonl'))}, JSON.stringify(argv) + '\\n');
const data = ${JSON.stringify(data)};
data.id = randomUUID();
data.createdAt = ${JSON.stringify(new Date(clock).toISOString())};
data.target = argv[1];
const [country, city] = get('--from').split('+');
const first = data.results[0];
data.results = Array.from({length: Number(get('--limit'))}, () => structuredClone(first));
data.probesCount = data.results.length;
for (const observation of data.results) Object.assign(observation.probe, {country, city});
${body}
process.stdout.write(JSON.stringify(data));
`,
  );
  chmodSync(executable, 0o755);
  return executable;
}
function calls() {
  const path = join(directory, 'calls.jsonl');
  return existsSync(path)
    ? readFileSync(path, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as string[])
    : [];
}
function run(extra: string[] = [], body = '', options: object = {}) {
  const executable = fake(body);
  return runBatch(prepareBatch(args(...extra)), {
    now: () => clock,
    measure: (config, { signal } = {}) => recordMeasurement(config, { signal, executable }),
    ...options,
  });
}

describe('batch input and traversal', () => {
  it('defines the defaults and handles help before touching missing lists', () => {
    expect(prepareBatch(['--help', '--cities', '/missing'])).toEqual({ help: true });
    const config = prepareBatch(args());
    expect(config).toMatchObject({ rounds: 1, skipHitCount: 1, historyMs: 86400000, database });
    expect(config.resources![0].config.request.request_limit).toBe(1);
    expect(defaultResources).toBe(resolve('apps/site/.reports/resource-inventory.json'));
    expect(defaultDatabase).toBe(resolve('apps/site/.reports/globalping/measurements.sqlite'));
    expect(existsSync(database)).toBe(false);
  });
  it.each(
    [
      [],
      ['--cities', 'x'],
      ['--cities', 'x', '--history-days', '0'],
      ['--cities', 'x', '--history-days', 'Infinity'],
      ['--cities', 'x', '--history-days', '1e300'],
      ...[
        '--url',
        '--from',
        '--method',
        '--resolver',
        '--host',
        '--path',
        '--query',
        '--protocol',
        '--port',
        '--limits',
        '--json',
      ].map((flag) => [flag, 'x']),
    ].map((argv) => [argv]),
  )('rejects invalid options before any database is created: %j', (argv) => {
    expect(() => prepareBatch(argv)).toThrow();
    expect(existsSync(database)).toBe(false);
  });
  it.each([
    ['--rounds', '0'],
    ['--rounds', '1.5'],
    ['--skip-hit-count', '0'],
    ['--limit', '0'],
    ['--timeout', '0'],
    ['--ipv4', '--ipv6'],
  ])('validates shared and batch options %j', (flag, value) => {
    expect(() => prepareBatch(args(flag, value))).toThrow();
    expect(existsSync(database)).toBe(false);
  });
  it.each(
    [
      [],
      [{ country: 'CN' }],
      [{ country: 'C', city: 'Shanghai' }],
      [{ country: 'CN', city: 'Shanghai,Beijing' }],
    ].map((cities) => [cities]),
  )('rejects malformed city lists %j', (cities) => {
    writeFileSync(citiesFile, JSON.stringify(cities));
    expect(() => prepareBatch(args())).toThrow();
    expect(existsSync(database)).toBe(false);
  });
  it.each([
    { resources: [], resourcePages: {} },
    { resources: [{ url: urlA }], resourcePages: {} },
    { resources: [{ url: urlA }], resourcePages: { [urlA]: [123] } },
    { resources: [{ url: urlA }, { url: 'invalid' }], resourcePages: { [urlA]: [], invalid: [] } },
  ])('validates the entire inventory before starting %j', (report) => {
    writeFileSync(inventory, JSON.stringify(report));
    expect(() => prepareBatch(args())).toThrow();
    expect(existsSync(database)).toBe(false);
  });
  it('traverses rounds, reference counts and cities; ignores count and includes zero references', async () => {
    const zero = 'https://example.com/zero.png';
    lists(
      [
        { url: zero, refs: 0 },
        { url: urlB, refs: 3 },
        { url: urlA, refs: 3 },
        { url: urlA, refs: 3 },
      ],
      [
        { country: 'cn', city: ' Shanghai ', count: 99 },
        { country: 'CN', city: 'Shanghai' },
        { country: 'JP', city: 'Tokyo' },
      ],
    );
    const result = await run(
      ['--rounds', '2', '--header', 'X-Test: one'],
      `data.results[0].result.headers['CF-Cache-Status'] = 'MISS';`,
    );
    const round = [
      [urlA, 'CN+Shanghai'],
      [urlA, 'JP+Tokyo'],
      [urlB, 'CN+Shanghai'],
      [urlB, 'JP+Tokyo'],
      [zero, 'CN+Shanghai'],
      [zero, 'JP+Tokyo'],
    ];
    expect(rows().map((row) => [row.url, row.request_from])).toEqual([...round, ...round]);
    expect(calls()).toHaveLength(12);
    for (const argv of calls()) {
      expect(argv[argv.indexOf('--limit') + 1]).toBe('1');
      expect(argv[argv.indexOf('--method') + 1]).toBe('GET');
      expect(argv[argv.indexOf('--header') + 1]).toBe('X-Test: one');
      expect(argv.filter((arg) => arg === '--from')).toHaveLength(1);
    }
    expect(result).toMatchObject({
      roundsCompleted: 2,
      executed: 12,
      skipped: 0,
      savedRecords: 12,
      exitCode: 0,
    });
  });
});

describe('live SQLite skip decisions', () => {
  it('isolates URLs including queries, countries and cities, without recording skips', async () => {
    lists(
      [
        { url: urlA, refs: 2 },
        { url: urlA + '&v=2', refs: 1 },
      ],
      [
        { country: 'CN', city: 'Shanghai' },
        { country: 'US', city: 'Shanghai' },
        { country: 'CN', city: 'Beijing' },
      ],
    );
    seed([{}]);
    const result = await run();
    expect(result).toMatchObject({ executed: 5, skipped: 1, savedRecords: 5, exitCode: 0 });
    expect(rows()).toHaveLength(6);
    expect(
      rows().filter(
        (row) => row.url === urlA && row.probe_country === 'CN' && row.probe_city === 'Shanghai',
      ),
    ).toHaveLength(1);
  });
  it('uses both inclusive time bounds and only finished HTTP 200 HIT records, regardless of collection status', async () => {
    seed([
      { measurement_created_at: new Date(clock - 86400000).toISOString() },
      { measurement_created_at: new Date(clock).toISOString(), collection_status: 'parse_error' },
      { measurement_created_at: new Date(clock - 86400001).toISOString() },
      { measurement_created_at: new Date(clock + 1).toISOString() },
      { measurement_created_at: null },
      { probe_index: null },
      { http_status_code: 404 },
      { http_status_code: 206 },
      { http_status_code: 204 },
      { result_status: 'failed' },
      { cache_status: 'MISS' },
      { cache_status: null },
    ]);
    const skipped = await run(['--skip-hit-count', '2']);
    expect(skipped).toMatchObject({ executed: 0, skipped: 1, exitCode: 0 });
    expect(calls()).toHaveLength(0);
    const measured = await run(['--skip-hit-count', '3']);
    expect(measured).toMatchObject({ executed: 1, skipped: 0, savedRecords: 1 });
    expect(rows()).toHaveLength(13);
  });
  it('accumulates independent node records from one measurement and observes them in later rounds', async () => {
    const result = await run(
      ['--rounds', '3', '--limit', '3', '--skip-hit-count', '2'],
      `data.results[2].result.headers['CF-Cache-Status'] = 'MISS';`,
    );
    expect(result).toMatchObject({
      roundsCompleted: 3,
      executed: 1,
      skipped: 2,
      savedRecords: 3,
      exitCode: 0,
    });
    expect(rows()).toHaveLength(3);
    expect(new Set(rows().map((row) => row.measurement_id)).size).toBe(1);
  });
  it('does not retry inside a round when the threshold remains unmet', async () => {
    const result = await run(['--rounds', '2', '--skip-hit-count', '3']);
    expect(result).toMatchObject({
      roundsCompleted: 2,
      executed: 2,
      skipped: 0,
      savedRecords: 2,
      exitCode: 0,
    });
  });
  it('does not reset earlier HIT counts after a later MISS', async () => {
    seed([{}, { cache_status: 'MISS', measurement_created_at: new Date(clock).toISOString() }]);
    expect(await run()).toMatchObject({ executed: 0, skipped: 1 });
  });
  it('reads writes committed by another connection before the next city', async () => {
    lists(undefined, [
      { country: 'CN', city: 'Shanghai' },
      { country: 'CN', city: 'Beijing' },
    ]);
    const result = await run([], '', {
      onProgress(event: any) {
        if (event.type === 'measurement') seed([{ probe_city: 'Beijing' }]);
      },
    });
    expect(result).toMatchObject({ executed: 1, skipped: 1, savedRecords: 1 });
    expect(rows()).toHaveLength(2);
  });
  it('moves the fractional-day window at each decision', async () => {
    lists(undefined, [
      { country: 'CN', city: 'Shanghai' },
      { country: 'CN', city: 'Beijing' },
    ]);
    seed([
      { probe_city: 'Beijing', measurement_created_at: new Date(clock - 43200000).toISOString() },
    ]);
    const batchArgs = args();
    batchArgs[batchArgs.indexOf('--history-days') + 1] = '0.5';
    const executable = fake();
    const result = await runBatch(prepareBatch(batchArgs), {
      now: () => clock,
      measure: (config, { signal } = {}) => recordMeasurement(config, { signal, executable }),
      onProgress(event) {
        if (event.type === 'measurement') clock++;
      },
    });
    expect(result).toMatchObject({ executed: 2, skipped: 0 });
  });
  it('uses the returned city, not the requested selector, for history ownership', async () => {
    const result = await run(['--rounds', '2'], `data.results[0].probe.city = 'Hangzhou';`);
    expect(result).toMatchObject({ executed: 2, skipped: 0 });
    expect(rows().map((row) => row.probe_city)).toEqual(['Hangzhou', 'Hangzhou']);
  });
});

describe('failure and CLI boundaries', () => {
  it.each([
    [`process.stderr.write('rate limit exceeded'); process.exit(1);`, 'cli_error'],
    [`process.stdout.write('invalid json'); process.exit(0);`, 'parse_error'],
    [`data.results[0].result.headers.Age = 'invalid';`, 'parse_error'],
  ])('stops after saving a failed call: %s', async (body, status) => {
    lists([
      { url: urlA, refs: 2 },
      { url: urlB, refs: 1 },
    ]);
    const result = await run(['--rounds', '2'], body);
    expect(result).toMatchObject({ executed: 1, roundsCompleted: 0, exitCode: 1, savedRecords: 1 });
    expect(calls()).toHaveLength(1);
    expect(rows()[0].collection_status).toBe(status);
  });
  it('continues for target HTTP 429 and failed probes, without treating them as API rate limits', async () => {
    const result = await run(
      ['--rounds', '2', '--limit', '2'],
      `data.results[0].result.statusCode=429; data.results[1].result.status='failed';`,
    );
    expect(result).toMatchObject({ executed: 2, failedNodes: 4, savedRecords: 4, exitCode: 0 });
  });
  it('stops on database failure without making a measurement or changing unrelated data', async () => {
    const db = new DatabaseSync(database);
    db.exec('CREATE TABLE unrelated(value TEXT)');
    db.close();
    expect(await run()).toMatchObject({ executed: 0, exitCode: 1 });
    expect(calls()).toHaveLength(0);
    const check = new DatabaseSync(database);
    expect(check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([
      { name: 'unrelated' },
    ]);
    check.close();
  });
  it('stops on a write failure and retains the already committed running row', async () => {
    const store = new MeasurementStore(database);
    store.db.exec(
      "CREATE TRIGGER fail_finish BEFORE UPDATE ON measurements BEGIN SELECT RAISE(ABORT,'write failed'); END;",
    );
    store.close();
    expect(await run(['--rounds', '2'])).toMatchObject({
      executed: 1,
      savedRecords: 0,
      exitCode: 1,
    });
    expect(rows()[0].collection_status).toBe('running');
  });
  it('does not initialize a database for a pre-aborted batch', async () => {
    const controller = new AbortController();
    controller.abort('SIGINT');
    expect(await run([], '', { signal: controller.signal })).toMatchObject({
      executed: 0,
      exitCode: 130,
    });
    expect(existsSync(database)).toBe(false);
  });
  it('can be interrupted while all pending tasks would be skipped', async () => {
    seed([{}]);
    const controller = new AbortController();
    setImmediate(() => controller.abort('SIGINT'));
    const result = await run(['--rounds', '3'], '', { signal: controller.signal });
    expect(result).toMatchObject({ executed: 0, roundsCompleted: 0, exitCode: 130 });
    expect(calls()).toHaveLength(0);
    expect(rows()).toHaveLength(1);
  });
  it('passes cancellation to the current call and starts no later task', async () => {
    const controller = new AbortController(),
      executable = fake();
    const result = await runBatch(prepareBatch(args('--rounds', '3')), {
      signal: controller.signal,
      now: () => clock,
      async measure(config, { signal } = {}) {
        expect(signal).toBe(controller.signal);
        controller.abort('SIGTERM');
        return recordMeasurement(config, { signal, executable });
      },
    });
    expect(result).toMatchObject({ executed: 1, savedRecords: 1, exitCode: 143 });
    expect(rows()[0].collection_status).toBe('interrupted');
    expect(calls()).toHaveLength(0);
  });
  it('exposes the real CLI with concise output and a successful second invocation that only skips', () => {
    const project = join(directory, 'project'),
      bin = join(project, '.tools/bin');
    const toolDir = join(project, 'apps/site/tools/globalping');
    cpSync(resolve('apps/site/tools/globalping'), toolDir, { recursive: true });
    mkdirSync(bin, { recursive: true });
    clock = Date.now();
    copyFileSync(
      fake(`data.results[0].result.rawBody = 'BODY_MARKER'.repeat(5000);`),
      join(bin, 'globalping-cli'),
    );
    const invoke = () =>
      spawnSync(process.execPath, [join(toolDir, 'batch-cli.mjs'), ...args('--rounds', '2')], {
        encoding: 'utf8',
      });
    const first = invoke();
    expect(first.status).toBe(0);
    expect(first.stderr).toBe('');
    expect(first.stdout).toContain('调用 1，跳过 1');
    expect(first.stdout).not.toMatch(/BODY_MARKER|source_json|publicKey/);
    expect(first.stdout.length).toBeLessThan(1200);
    expect(rows().some((row) => String(row.source_json).includes('BODY_MARKER'))).toBe(true);
    const previous = rows().length;
    const second = invoke();
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('批次完成');
    expect(rows()).toHaveLength(previous);
  });
});
