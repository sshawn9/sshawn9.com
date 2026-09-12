import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isQualified,
  normalizeIp,
  openEgressHistory,
} from '../../../apps/site/tools/cache-probe/history.mjs';

const roots: string[] = [];
const pageUrl = 'https://site.test/';
const resourceUrl = 'https://site.test/app.js';

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot() {
  const parent = fileURLToPath(new URL('../../.results/', import.meta.url));
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'cache-probe-history-'));
  roots.push(root);
  return root;
}

function runFixture(id: string, startedAt: string, hitStreak = 2, title = 'Fixture page') {
  return {
    id,
    startedAt,
    finishedAt: null,
    stopReason: null,
    failure: null,
    input: { site: 'https://site.test', buildId: `build-${id}`, mode: 'production' },
    options: { hitStreak, maxAttempts: 3, concurrency: 2 },
    transport: { name: 'undici', version: 'fixture', connectionReuse: true },
    targets: [{ url: resourceUrl }],
    pages: [{ url: pageUrl, kind: 'page', title }],
    pageResources: { [pageUrl]: [pageUrl, resourceUrl] },
    skipped: [],
  };
}

function roundFixture(runId: string, number: number, startedAt: string, urls = [resourceUrl]) {
  return {
    id: `${runId}-round-${number}`,
    runId,
    number,
    startedAt,
    finishedAt: null,
    complete: false,
    egress: {
      ip: '203.0.113.9',
      country: 'US',
      colo: 'SJC',
      sampledAt: startedAt,
    },
    results: urls.map((url) => ({ url, state: 'pending', observedAt: null })),
    pauses: [],
  };
}

function resultFixture(state: string, observedAt: string, overrides: Record<string, unknown> = {}) {
  return {
    url: resourceUrl,
    state,
    complete: state !== 'transfer-error',
    observedAt,
    attempt: 1,
    httpStatus: state === 'transfer-error' ? null : 200,
    cacheStatus: state === 'hit' ? 'HIT' : state === 'miss' ? 'MISS' : null,
    colo: state === 'hit' ? 'SJC' : null,
    bytes: 128,
    client: 'undici',
    timings: { firstByteMs: 10, totalMs: 20 },
    error: state === 'transfer-error' ? 'socket closed' : null,
    ...overrides,
  };
}

async function recordRound(
  history: Awaited<ReturnType<typeof openEgressHistory>>,
  runId: string,
  number: number,
  at: string,
  result: ReturnType<typeof resultFixture>,
  hitStreak = 2,
) {
  const run = runFixture(runId, at, hitStreak);
  const round = roundFixture(runId, number, at);
  const finishedAt = result.observedAt ?? at;
  await history.record({ type: 'run-start', at, run });
  await history.record({ type: 'round-start', at, round });
  await history.record({ type: 'resource', at: finishedAt, roundId: round.id, result });
  await history.record({
    type: 'round-end',
    at: finishedAt,
    roundId: round.id,
    complete: true,
  });
  await history.record({
    type: 'run-end',
    at: finishedAt,
    runId,
    stopReason: 'rounds-completed',
    failure: null,
  });
}

describe('egress history event journal and projections', () => {
  it('journals request starts without snapshot writes, recovers pending requests and publishes results immediately', async () => {
    const root = await temporaryRoot();
    let history = await openEgressHistory(root, '203.0.113.9');
    const run = runFixture('run-events', '2026-09-12T00:00:00.000Z');
    run.targets.unshift({ url: pageUrl });
    const round = roundFixture(run.id, 1, run.startedAt, [pageUrl, resourceUrl]);
    const request = {
      url: resourceUrl,
      state: 'pending',
      observedAt: null,
      attempt: 1,
      startedAt: '2026-09-12T00:00:01.000Z',
    };
    const result = resultFixture('hit', '2026-09-12T00:00:02.000Z');

    await history.record({ type: 'run-start', at: run.startedAt, run });
    await history.record({ type: 'round-start', at: round.startedAt, round });
    const snapshots = [
      'report.json',
      'report.md',
      `round-${round.id}.json`,
      `round-${round.id}.md`,
    ];
    const readSnapshots = () =>
      Promise.all(snapshots.map((file) => readFile(join(history.directory, file), 'utf8')));
    const beforeRequest = await readSnapshots();
    await history.record({
      type: 'request-start',
      at: request.startedAt,
      roundId: round.id,
      request,
    });
    expect(await readSnapshots()).toEqual(beforeRequest);
    expect(await readFile(join(history.directory, 'events.jsonl'), 'utf8')).toContain(
      '"type":"request-start"',
    );
    await history.close();
    history = await openEgressHistory(root, '203.0.113.9');
    const recovered = JSON.parse(
      await readFile(join(history.directory, `round-${round.id}.json`), 'utf8'),
    );
    expect(recovered.results[1]).toEqual(request);
    await history.record({ type: 'resource', at: result.observedAt, roundId: round.id, result });

    const liveRound = JSON.parse(
      await readFile(join(history.directory, `round-${round.id}.json`), 'utf8'),
    );
    expect(liveRound.results).toEqual([
      expect.objectContaining({ url: pageUrl, state: 'pending' }),
      expect.objectContaining({ url: resourceUrl, state: 'hit' }),
    ]);
    expect(await readFile(join(history.directory, `round-${round.id}.md`), 'utf8')).toContain(
      '| [/app.js](<https://site.test/app.js>) | hit |',
    );
    const liveSummary = JSON.parse(await readFile(join(history.directory, 'report.json'), 'utf8'));
    expect(liveSummary.resources[resourceUrl].streak).toEqual({ count: 1, colo: 'SJC' });

    await history.record({
      type: 'pause',
      at: '2026-09-12T00:00:03.000Z',
      roundId: round.id,
      origin: 'https://site.test',
      until: Date.parse('2026-09-12T00:01:03.000Z'),
      url: resourceUrl,
      retryAfter: '60',
    });
    await history.record({
      type: 'round-end',
      at: '2026-09-12T00:00:04.000Z',
      roundId: round.id,
      complete: false,
    });
    await history.record({
      type: 'run-end',
      at: '2026-09-12T00:00:05.000Z',
      runId: run.id,
      stopReason: 'interrupted',
      failure: null,
    });
    await history.close();

    const events = (await readFile(join(history.directory, 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events.map((event) => event.type)).toEqual([
      'run-start',
      'round-start',
      'request-start',
      'resource',
      'pause',
      'round-end',
      'run-end',
    ]);
    const summary = JSON.parse(await readFile(join(history.directory, 'report.json'), 'utf8'));
    expect(summary.cooldowns['https://site.test']).toBe(Date.parse('2026-09-12T00:01:03.000Z'));
    expect(summary.rounds[0]).toEqual(
      expect.objectContaining({ complete: false, hits: 1, measured: 1 }),
    );
    expect(
      JSON.parse(await readFile(join(history.directory, `run-${run.id}.json`), 'utf8')),
    ).toEqual(
      expect.objectContaining({
        finishedAt: '2026-09-12T00:00:05.000Z',
        stopReason: 'interrupted',
      }),
    );
  });

  it('carries streaks across runs, reevaluates a changed threshold, and breaks streaks correctly', async () => {
    const root = await temporaryRoot();
    let history = await openEgressHistory(root, '203.0.113.9');
    await recordRound(
      history,
      'run-one',
      1,
      '2026-09-12T01:00:00.000Z',
      resultFixture('hit', '2026-09-12T01:00:01.000Z'),
    );
    await history.close();

    history = await openEgressHistory(root, '203.0.113.9');
    await recordRound(
      history,
      'run-two',
      1,
      '2026-09-12T02:00:00.000Z',
      resultFixture('hit', '2026-09-12T02:00:01.000Z'),
      3,
    );
    expect(history.state.resources[resourceUrl].streak).toEqual({ count: 2, colo: 'SJC' });
    expect(isQualified(history.state.resources[resourceUrl], 2)).toBe(true);
    expect(isQualified(history.state.resources[resourceUrl], 3)).toBe(false);
    expect(await readFile(join(history.directory, 'report.md'), 'utf8')).toContain(
      'Current inventory: 0/1 resources qualify for skipping.',
    );

    await recordRound(
      history,
      'run-miss',
      1,
      '2026-09-12T03:00:00.000Z',
      resultFixture('miss', '2026-09-12T03:00:01.000Z'),
    );
    expect(history.state.resources[resourceUrl].streak).toEqual({ count: 0, colo: null });
    await recordRound(
      history,
      'run-recover',
      1,
      '2026-09-12T04:00:00.000Z',
      resultFixture('hit', '2026-09-12T04:00:01.000Z'),
    );
    await recordRound(
      history,
      'run-failure',
      1,
      '2026-09-12T05:00:00.000Z',
      resultFixture('transfer-error', '2026-09-12T05:00:01.000Z'),
    );
    expect(history.state.resources[resourceUrl].streak.count).toBe(0);
    await recordRound(
      history,
      'run-recover-again',
      1,
      '2026-09-12T06:00:00.000Z',
      resultFixture('hit', '2026-09-12T06:00:01.000Z'),
    );
    await recordRound(
      history,
      'run-colo-change',
      1,
      '2026-09-12T07:00:00.000Z',
      resultFixture('hit', '2026-09-12T07:00:01.000Z', { colo: 'LAX' }),
    );
    expect(history.state.resources[resourceUrl].streak).toEqual({ count: 1, colo: 'LAX' });
    await recordRound(
      history,
      'run-unknown',
      1,
      '2026-09-12T08:00:00.000Z',
      resultFixture('unknown', '2026-09-12T08:00:01.000Z'),
    );
    expect(history.state.resources[resourceUrl].streak).toEqual({ count: 0, colo: null });

    const latest = structuredClone(history.state.resources[resourceUrl]);
    await recordRound(
      history,
      'run-skip',
      1,
      '2026-09-12T09:00:00.000Z',
      resultFixture('skipped', '2026-09-12T09:00:01.000Z', {
        complete: false,
        observedAt: null,
        note: 'Qualified from history',
      }),
    );
    expect(history.state.resources[resourceUrl]).toEqual(latest);
    await history.close();
  });

  it('isolates IP histories and maps a normalized IPv6 address to a safe directory', async () => {
    const root = await temporaryRoot();
    const ipv4 = await openEgressHistory(root, '203.0.113.9');
    await recordRound(
      ipv4,
      'run-ipv4',
      1,
      '2026-09-12T00:00:00.000Z',
      resultFixture('hit', '2026-09-12T00:00:01.000Z'),
    );
    await ipv4.close();

    const ipv6 = await openEgressHistory(root, '2001:0db8:0:0:0:0:0:1');
    await recordRound(
      ipv6,
      'run-ipv6',
      1,
      '2026-09-12T00:00:00.000Z',
      resultFixture('miss', '2026-09-12T00:00:01.000Z'),
    );
    expect(ipv6.state.ip).toBe('2001:db8::1');
    expect(basename(ipv6.directory)).toBe('2001_db8__1');
    expect(basename(ipv6.directory)).not.toContain(':');
    expect(ipv6.state.resources[resourceUrl].streak.count).toBe(0);
    await ipv6.close();

    const reopenedIpv4 = await openEgressHistory(root, '203.0.113.9');
    expect(reopenedIpv4.state.resources[resourceUrl].streak.count).toBe(1);
    await reopenedIpv4.close();
    expect(normalizeIp('2001:0db8:0:0:0:0:0:1')).toBe('2001:db8::1');
    expect(() => normalizeIp('../unsafe')).toThrow('valid egress IP');
  });

  it('leaves intact reports untouched on reopen and repairs only missing or stale snapshots', async () => {
    const root = await temporaryRoot();
    let history = await openEgressHistory(root, '203.0.113.9');
    await recordRound(
      history,
      'run-a',
      1,
      '2026-09-12T00:00:00.000Z',
      resultFixture('hit', '2026-09-12T00:00:01.000Z'),
    );
    await recordRound(
      history,
      'run-b',
      1,
      '2026-09-12T00:01:00.000Z',
      resultFixture('hit', '2026-09-12T00:01:01.000Z'),
    );
    const directory = history.directory;
    await history.close();

    const snapshots = (await readdir(directory)).filter((file) => /\.(json|md)$/.test(file));
    const oldTime = new Date('2000-01-01T00:00:00.000Z');
    for (const file of snapshots) await utimes(join(directory, file), oldTime, oldTime);
    history = await openEgressHistory(root, '203.0.113.9');
    await history.close();
    for (const file of snapshots)
      expect((await stat(join(directory, file))).mtimeMs, file).toBe(oldTime.getTime());

    expect((await readdir(directory)).filter((file) => /^round-.*\.json$/.test(file))).toHaveLength(
      2,
    );
    expect((await readdir(directory)).filter((file) => /^round-.*\.md$/.test(file))).toHaveLength(
      2,
    );
    await writeFile(join(directory, 'report.json'), '{"stale":true}\n');
    await writeFile(join(directory, 'report.md'), 'stale\n');
    await writeFile(join(directory, 'round-run-b-round-1.json'), '{"stale":true}\n');
    await rm(join(directory, 'round-run-b-round-1.md'));

    history = await openEgressHistory(root, '203.0.113.9');
    expect(history.state.resources[resourceUrl].streak.count).toBe(2);
    expect(JSON.parse(await readFile(join(directory, 'report.json'), 'utf8')).rounds).toHaveLength(
      2,
    );
    expect(JSON.parse(await readFile(join(directory, 'round-run-b-round-1.json'), 'utf8'))).toEqual(
      expect.objectContaining({ id: 'run-b-round-1', complete: true }),
    );
    expect(await readFile(join(directory, 'report.md'), 'utf8')).toContain(
      '# Cache probe — cumulative egress summary',
    );
    expect(await readFile(join(directory, 'round-run-b-round-1.md'), 'utf8')).toContain(
      '# Cache probe round',
    );
    expect((await stat(join(directory, 'round-run-a-round-1.json'))).mtimeMs).toBe(
      oldTime.getTime(),
    );
    expect((await stat(join(directory, 'run-run-a.json'))).mtimeMs).toBe(oldTime.getTime());
    await history.close();
  });

  it('surfaces snapshot write failures while preserving the journaled event for recovery', async () => {
    const root = await temporaryRoot();
    let history = await openEgressHistory(root, '203.0.113.9');
    const run = runFixture('run-write-error', '2026-09-12T00:00:00.000Z');
    const round = roundFixture(run.id, 1, run.startedAt);
    await history.record({ type: 'run-start', at: run.startedAt, run });
    await history.record({ type: 'round-start', at: round.startedAt, round });
    const obstruction = join(history.directory, `round-${round.id}.json.tmp`);
    await mkdir(obstruction);
    const result = resultFixture('hit', '2026-09-12T00:00:01.000Z');
    await expect(
      history.record({ type: 'resource', at: result.observedAt, roundId: round.id, result }),
    ).rejects.toThrow();
    await expect(history.close()).rejects.toThrow();
    const journal = await readFile(join(history.directory, 'events.jsonl'), 'utf8');
    expect(journal).toContain('"type":"resource"');

    await rm(obstruction, { recursive: true });
    history = await openEgressHistory(root, '203.0.113.9');
    expect(history.state.resources[resourceUrl].streak).toEqual({ count: 1, colo: 'SJC' });
    await history.close();
  });

  it('reports a malformed journal with its line and releases the lock without rewriting it', async () => {
    const root = await temporaryRoot();
    const directory = join(root, '203.0.113.9');
    await mkdir(directory);
    const first = {
      type: 'run-start',
      at: '2026-09-12T00:00:00.000Z',
      run: runFixture('run-before-corruption', '2026-09-12T00:00:00.000Z'),
    };
    const contents = `${JSON.stringify(first)}\nnot-json\n`;
    await writeFile(join(directory, 'events.jsonl'), contents);

    await expect(openEgressHistory(root, '203.0.113.9')).rejects.toThrow(
      /Invalid history at .*events\.jsonl:2/,
    );
    expect(await readFile(join(directory, 'events.jsonl'), 'utf8')).toBe(contents);
    await expect(stat(join(directory, '.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('prevents simultaneous writers and permits reopening after the owner closes', async () => {
    const root = await temporaryRoot();
    const first = await openEgressHistory(root, '203.0.113.9');
    await expect(openEgressHistory(root, '203.0.113.9')).rejects.toThrow('history is locked');
    await first.close();
    const reopened = await openEgressHistory(root, '203.0.113.9');
    await reopened.close();
  });
});

describe('report Markdown', () => {
  it('escapes a malicious page title in summary Markdown', async () => {
    const root = await temporaryRoot();
    const history = await openEgressHistory(root, '203.0.113.9');
    const title = 'Bad](https://evil.test)\n<script>alert(1)</script> | *boom*';
    const run = runFixture('run-markdown', '2026-09-12T00:00:00.000Z', 2, title);
    await history.record({ type: 'run-start', at: run.startedAt, run });
    const markdown = await readFile(join(history.directory, 'report.md'), 'utf8');
    await history.close();
    expect(markdown).not.toContain('<script>');
    expect(markdown).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(markdown).toContain('Bad\\](https://evil.test)');
  });
});
