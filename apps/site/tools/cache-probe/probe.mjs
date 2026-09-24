import { randomUUID } from 'node:crypto';
import { hostname, platform } from 'node:os';
import { createProbeClient } from './http.mjs';
import { isQualified, normalizeIp, openEgressHistory } from './history.mjs';
import { createRequestScheduler } from './scheduler.mjs';
export { summarizeRound } from './report.mjs';

export const defaults = {
  hitStreak: 2,
  maxAttempts: 3,
  concurrency: 2,
  minInterval: 1,
  maxInterval: 3,
  requestTimeout: 20,
};

export function validateOptions(options) {
  for (const key of ['hitStreak', 'maxAttempts', 'concurrency']) {
    if (!Number.isSafeInteger(options[key]) || options[key] < 1)
      throw new Error(`${key} must be a positive integer.`);
  }
  for (const key of ['minInterval', 'maxInterval', 'requestTimeout']) {
    if (!Number.isFinite(options[key]) || options[key] < 0 || options[key] * 1000 > 2 ** 31 - 1)
      throw new Error(`${key} must be a finite duration below 24.8 days.`);
  }
  if (options.requestTimeout === 0) throw new Error('requestTimeout must be positive.');
  if (options.maxInterval < options.minInterval)
    throw new Error('maxInterval must be at least minInterval.');
}

/** The inventory is the input contract; probing does not require dist or a build. */
export function prepareInventory(inventory) {
  if (!inventory?.buildId || !Array.isArray(inventory.resources) || !Array.isArray(inventory.pages))
    throw new Error('Expected a resource inventory with buildId, resources and pages.');
  if (inventory.mode !== 'production')
    throw new Error('Cache probing requires a production inventory.');
  if (inventory.diagnostics?.some((item) => item.level === 'error'))
    throw new Error('The resource inventory contains errors.');
  const site = new URL(inventory.site);
  if (!['http:', 'https:'].includes(site.protocol) || site.username || site.password)
    throw new Error('The inventory site must be an HTTP(S) URL without credentials.');
  const notFound = new Set(
    inventory.pages.filter((page) => page.kind === 'not-found').map((page) => page.url),
  );
  const targets = new Map();
  const skipped = [];
  for (const resource of inventory.resources) {
    const url = new URL(resource.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
      throw new Error(`Invalid resource URL: ${resource.url}`);
    if (url.origin !== site.origin) {
      skipped.push({ url: url.href, reason: 'External resource' });
      continue;
    }
    if (!resource.file || resource.external)
      throw new Error(`Resource has no recorded local file: ${url.href}`);
    targets.set(url.href, {
      url: url.href,
      type: resource.type,
      expectedStatuses: notFound.has(url.href) ? [200, 404] : [200],
    });
  }
  if (!targets.size) throw new Error('The inventory has no local resources to probe.');
  for (const page of inventory.pages) {
    const references = inventory.pageResources?.[page.url];
    if (!Array.isArray(references) || !references.includes(page.url))
      throw new Error(`Missing page resource relationships: ${page.url}`);
    for (const url of references) {
      if (!targets.has(url) && !skipped.some((item) => item.url === url))
        throw new Error(`Page references a resource absent from the inventory: ${url}`);
    }
  }
  return { targets: [...targets.values()], skipped };
}

const header = (headers, name) => headers[name]?.join(', ') ?? null;
const nowIso = () => new Date().toISOString();

export function retryDeadline(value, now = Date.now()) {
  const raw = value?.trim();
  const seconds = /^\d+$/.test(raw ?? '') ? Number(raw) : null;
  // Date.parse also accepts values such as "1.5"; Retry-After does not.
  const parsed =
    seconds === null
      ? /^[A-Za-z]{3}(?:,|[a-z]+,| )/.test(raw ?? '')
        ? Date.parse(raw)
        : NaN
      : now + seconds * 1000;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 8640000000000000
    ? Math.max(now, parsed)
    : now + 60000;
}

export function classifyResult(target, record) {
  const { headers, httpStatus, complete } = record;
  const cacheStatus = header(headers, 'cf-cache-status');
  const ray = header(headers, 'cf-ray');
  const challenge = header(headers, 'cf-mitigated') === 'challenge';
  const expected = target.expectedStatuses.includes(httpStatus);
  const state =
    challenge || httpStatus === 403
      ? 'blocked'
      : httpStatus === 429
        ? 'rate-limited'
        : !complete
          ? 'transfer-error'
          : !expected
            ? httpStatus >= 300 && httpStatus < 400
              ? 'redirect'
              : 'http-error'
            : cacheStatus === 'HIT'
              ? 'hit'
              : cacheStatus === 'MISS'
                ? 'miss'
                : cacheStatus === null
                  ? 'unknown'
                  : 'other';
  return {
    url: target.url,
    observedAt: nowIso(),
    state,
    httpStatus,
    complete,
    cacheStatus,
    ray,
    challenge,
    colo: ray?.match(/-([A-Z]{3})$/)?.[1] ?? null,
    remoteIp: record.remoteIp,
    localIp: record.localIp,
    httpVersion: record.httpVersion,
    connectionId: record.connectionId,
    reusedConnection: record.reusedConnection,
    bytes: record.bytes,
    decodedBytes: record.decodedBytes,
    timings: record.timings,
    client: 'undici',
    contentType: header(headers, 'content-type'),
    contentEncoding: header(headers, 'content-encoding'),
    cacheControl: header(headers, 'cache-control'),
    age: header(headers, 'age'),
    etag: header(headers, 'etag'),
    location: header(headers, 'location'),
    retryAfter: header(headers, 'retry-after'),
    errorCode: record.errorCode,
    error:
      record.error ||
      (challenge
        ? 'Cloudflare challenge received.'
        : !expected
          ? `Unexpected HTTP status ${httpStatus}.`
          : null),
  };
}

async function sampleEgress(client, site, signal) {
  const result = await client.request(new URL('/cdn-cgi/trace', site).href, {
    signal,
    captureLimit: 65536,
  });
  if (!result.complete || result.httpStatus !== 200)
    throw new Error(
      `Cannot determine egress IP (HTTP ${result.httpStatus}): ${result.error ?? 'Trace request failed.'}`,
    );
  const fields = Object.fromEntries(
    (result.text ?? '')
      .split(/\r?\n/)
      .filter((line) => line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
  return {
    sampledAt: nowIso(),
    ip: normalizeIp(fields.ip),
    country: fields.loc ?? null,
    colo: fields.colo ?? null,
    http: fields.http ?? null,
    tls: fields.tls ?? null,
    warp: fields.warp ?? null,
  };
}

/**
 * @typedef {Partial<ReturnType<typeof classifyResult>> & {
 *   url: string, state: string, attempt: number, startedAt?: string, note?: string
 * }} RoundResult
 * @typedef {{
 *   id: string, runId: string, number: number, startedAt: string,
 *   finishedAt: string | null, complete: boolean,
 *   egress: Awaited<ReturnType<typeof sampleEgress>>,
 *   pauses: Array<{at: string, until: number, url: string, retryAfter: string | null}>,
 *   results: RoundResult[]
 * }} ProbeRound
 */

/**
 * Resource attempts belong to this run; observations and streaks belong to the egress archive.
 * @param {any} inventory Validated by prepareInventory before any network activity.
 * @param {typeof defaults} options
 * @param {{directory: string, signal?: AbortSignal, input?: Record<string, unknown>,
 *   onEvent?: (event: any, report: any) => unknown | Promise<unknown>,
 *   clientFactory?: typeof createProbeClient}} context
 */
export async function runProbe(
  inventory,
  options,
  {
    directory,
    signal,
    input = {},
    onEvent = async () => {},
    clientFactory = createProbeClient,
  } = {},
) {
  validateOptions(options);
  if (!directory) throw new Error('An output directory is required for persistent egress history.');
  const { targets, skipped } = prepareInventory(inventory);
  const controller = new AbortController();
  const interrupt = () => controller.abort(signal.reason ?? 'interrupted');
  signal?.addEventListener('abort', interrupt, { once: true });
  if (signal?.aborted) interrupt();
  const attempts = new Map(targets.map((target) => [target.url, 0]));
  const scheduler = createRequestScheduler({ ...options, signal: controller.signal });
  const report = {
    id: randomUUID(),
    startedAt: nowIso(),
    finishedAt: null,
    stopReason: null,
    failure: null,
    input: { ...input, site: inventory.site, buildId: inventory.buildId, mode: inventory.mode },
    options,
    environment: {
      hostname: hostname(),
      platform: platform(),
      node: process.version,
      githubRunId: process.env.GITHUB_RUN_ID ?? null,
    },
    transport: null,
    targets,
    skipped,
    pages: inventory.pages,
    pageResources: inventory.pageResources,
    /** @type {ProbeRound[]} */
    rounds: [],
    directories: [],
  };
  let client;
  let history;
  let fatal;
  let blocked = false;
  const record = async (history, event) => {
    const value = { ...event, at: event.at ?? nowIso() };
    try {
      await history.record(value);
      await onEvent(value, report);
    } catch (error) {
      // Cancel here: the scheduler cannot reject until every active task settles.
      fatal ??= error;
      controller.abort(fatal);
      throw fatal;
    }
  };
  const qualifies = (target) => isQualified(history.state.resources[target.url], options.hitStreak);
  try {
    await onEvent({ type: 'start', at: report.startedAt }, report);
    if (controller.signal.aborted) return report;
    client = clientFactory(options);
    report.transport = client.info;
    const origin = new URL(inventory.site).origin;
    const egress = await sampleEgress(client, inventory.site, controller.signal);
    if (controller.signal.aborted) return report;
    history = await openEgressHistory(directory, egress.ip);
    report.directories.push(history.directory);
    const { rounds, directories, ...context } = report;
    await record(history, { type: 'run-start', run: context });
    await onEvent({ type: 'archive', ip: egress.ip, directory: history.directory }, report);
    scheduler.pauseUntil(history.state.cooldowns[origin] ?? 0);
    while (!controller.signal.aborted && !blocked) {
      const number = report.rounds.length + 1;
      const round = {
        id: `${report.id}-${number}`,
        runId: report.id,
        number,
        startedAt: nowIso(),
        finishedAt: null,
        complete: false,
        egress,
        pauses: [],
        results: targets.map((target) => {
          const previous = history.state.resources[target.url];
          const attempt = attempts.get(target.url);
          return qualifies(target)
            ? {
                url: target.url,
                state: 'skipped',
                attempt,
                note: `${previous.streak.count} historical HITs in ${previous.streak.colo}; last measured ${previous.latest.observedAt}.`,
              }
            : attempt >= options.maxAttempts
              ? {
                  url: target.url,
                  state: 'exhausted',
                  attempt,
                  note: 'Attempt limit reached in this run.',
                }
              : { url: target.url, state: 'not-requested', attempt };
        }),
      };
      report.rounds.push(round);
      await record(history, { type: 'round-start', round });
      const pending = targets.filter(
        (target, index) => round.results[index].state === 'not-requested',
      );
      await scheduler.run(pending, async (target) => {
        if (controller.signal.aborted || blocked) return;
        const index = targets.indexOf(target);
        const attempt = attempts.get(target.url) + 1;
        attempts.set(target.url, attempt);
        const request = { url: target.url, attempt, state: 'pending', startedAt: nowIso() };
        round.results[index] = request;
        // record owns cancellation; join these notifications and rethrow fatal below.
        const persist = (event) => record(history, event).catch(() => {});
        // Dispatch without awaiting disk I/O: a reserved slot must not issue a
        // delayed request after another response has already paused the pool.
        const notifications = [persist({ type: 'request-start', roundId: round.id, request })];
        const result = await client.request(target.url, {
          signal: controller.signal,
          onHeaders({ httpStatus, headers }) {
            if (httpStatus === 429) {
              const at = nowIso();
              const retryAfter = header(headers, 'retry-after');
              const until = retryDeadline(retryAfter);
              scheduler.pauseUntil(until);
              round.pauses.push({ at, until, url: target.url, retryAfter });
              // Stop dispatch synchronously; serialize durable recording separately.
              notifications.push(
                persist({
                  type: 'pause',
                  roundId: round.id,
                  at,
                  origin,
                  until,
                  url: target.url,
                  retryAfter,
                }),
              );
            }
            if (httpStatus === 403 || header(headers, 'cf-mitigated') === 'challenge') {
              blocked = true;
              scheduler.stop();
            }
          },
        });
        await Promise.all(notifications);
        if (fatal) throw fatal;
        round.results[index] = {
          ...classifyResult(target, result),
          attempt,
          startedAt: request.startedAt,
        };
        await record(history, {
          type: 'resource',
          roundId: round.id,
          result: round.results[index],
        });
      });
      round.finishedAt = nowIso();
      round.complete = round.results.every(
        (item) => !['not-requested', 'pending'].includes(item.state) && item.complete !== false,
      );
      await record(history, {
        type: 'round-end',
        at: round.finishedAt,
        roundId: round.id,
        complete: round.complete,
      });
      if (blocked) {
        report.stopReason = 'blocked';
        break;
      }
      if (controller.signal.aborted) break;
      if (targets.every((target) => qualifies(target))) {
        report.stopReason = 'warm';
        break;
      }
      if (
        !targets.some(
          (target) => !qualifies(target) && attempts.get(target.url) < options.maxAttempts,
        )
      ) {
        report.stopReason = 'attempts-exhausted';
        break;
      }
    }
  } catch (error) {
    if (!controller.signal.aborted || fatal) {
      report.stopReason = 'failed';
      report.failure = (fatal ?? error).message;
    }
  } finally {
    scheduler.stop();
    signal?.removeEventListener('abort', interrupt);
    report.stopReason ??= blocked ? 'blocked' : 'interrupted';
    try {
      await client?.close();
    } catch (error) {
      report.failure ??= error.message;
      report.stopReason = 'failed';
    }
    report.finishedAt = nowIso();
    const last = report.rounds.at(-1);
    if (last && !last.finishedAt) {
      last.finishedAt = report.finishedAt;
      try {
        await record(history, {
          type: 'round-end',
          roundId: last.id,
          at: last.finishedAt,
          complete: false,
        });
      } catch (error) {
        report.failure ??= error.message;
        report.stopReason = 'failed';
      }
    }
    if (history) {
      try {
        await record(history, {
          type: 'run-end',
          runId: report.id,
          at: report.finishedAt,
          stopReason: report.stopReason,
          failure: report.failure,
        });
      } catch (error) {
        report.failure ??= error.message;
        report.stopReason = 'failed';
      } finally {
        try {
          await history.close();
        } catch (error) {
          report.failure ??= error.message;
          report.stopReason = 'failed';
        }
      }
    }
    try {
      await onEvent({ type: 'end', at: report.finishedAt }, report);
    } catch (error) {
      // Do not mask an earlier failure; an end-only notification error still rejects.
      if (report.failure === null) throw error;
    }
  }
  return report;
}
