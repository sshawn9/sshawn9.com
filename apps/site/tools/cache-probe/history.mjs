import { isIP } from 'node:net';
import { hostname } from 'node:os';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderRoundMarkdown, renderSummaryMarkdown, summarizeRound } from './report.mjs';

export function normalizeIp(ip) {
  if (!isIP(ip ?? '')) throw new Error('Cannot archive a probe without a valid egress IP.');
  return isIP(ip) === 6 ? new URL(`http://[${ip}]/`).hostname.slice(1, -1) : ip;
}

export function isQualified(entry, requiredHits) {
  return Boolean(entry?.streak?.colo && entry.streak.count >= requiredHits);
}

async function atomicWrite(file, contents, compareExisting = false) {
  if (compareExisting) {
    try {
      if ((await readFile(file, 'utf8')) === contents) return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  await writeFile(`${file}.tmp`, contents);
  await rename(`${file}.tmp`, file);
}

const json = (value) => JSON.stringify(value, null, 2) + '\n';
const measured = (result) =>
  !['not-requested', 'pending', 'skipped', 'exhausted'].includes(result.state);

/** A journal is authoritative; reports are replaceable projections of it. */
export async function openEgressHistory(root, address) {
  const ip = normalizeIp(address);
  const directory = join(root, ip.replaceAll(':', '_'));
  await mkdir(directory, { recursive: true });
  const lockFile = join(directory, '.lock');
  let lock;
  try {
    lock = await open(lockFile, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(
        `Egress history is locked: ${lockFile}. Check for another probe before removing a stale lock.`,
      );
    throw error;
  }
  let journal;
  let writes = Promise.resolve();
  const contexts = new Map();
  const rounds = new Map();
  const state = {
    schemaVersion: 2,
    ip,
    updatedAt: null,
    /** @type {Record<string, {
     * latest: ReturnType<typeof import('./probe.mjs').classifyResult> & {runId: string, round: number},
     * streak: {count: number, colo: string | null}
     * }>} */
    resources: {},
    runs: [],
    /** @type {Array<Omit<import('./probe.mjs').ProbeRound, 'results' | 'pauses'> & ReturnType<typeof summarizeRound> & {file: string}>} */
    rounds: [],
    /** @type {Record<string, number>} */
    cooldowns: {},
  };

  function observe(result, round) {
    if (!measured(result)) return;
    const previous = state.resources[result.url];
    const hit = result.complete && result.state === 'hit' && /^[A-Z]{3}$/.test(result.colo ?? '');
    state.resources[result.url] = {
      latest: { ...result, runId: round.runId, round: round.number },
      streak: {
        count: hit ? (previous?.streak.colo === result.colo ? previous.streak.count + 1 : 1) : 0,
        colo: hit ? result.colo : null,
      },
    };
  }

  function apply(event) {
    state.updatedAt = event.at;
    if (event.type === 'run-start') {
      const run = event.run;
      if (contexts.has(run.id)) throw new Error(`Duplicate run: ${run.id}`);
      contexts.set(run.id, structuredClone(run));
      const { targets, pages, pageResources, skipped, ...metadata } = run;
      state.runs.push({ ...metadata, file: `run-${run.id}.json` });
      return;
    }
    if (event.type === 'run-end') {
      const run = contexts.get(event.runId);
      if (!run) throw new Error(`Unknown run in history: ${event.runId}`);
      const finish = {
        finishedAt: event.at,
        stopReason: event.stopReason,
        failure: event.failure ?? null,
      };
      Object.assign(run, finish);
      Object.assign(
        state.runs.find((item) => item.id === event.runId),
        finish,
      );
      return;
    }
    if (event.type === 'round-start') {
      if (rounds.has(event.round.id)) throw new Error(`Duplicate round: ${event.round.id}`);
      rounds.set(event.round.id, structuredClone(event.round));
    } else {
      const round = rounds.get(event.roundId);
      if (!round) throw new Error(`Unknown round in history: ${event.roundId}`);
      if (event.type === 'request-start' || event.type === 'resource') {
        const result = event.type === 'resource' ? event.result : event.request;
        const index = round.results.findIndex((item) => item.url === result.url);
        if (index < 0) throw new Error(`Unknown resource in round: ${result.url}`);
        round.results[index] = structuredClone(result);
        if (event.type === 'resource') observe(result, round);
      } else if (event.type === 'pause') {
        round.pauses.push({
          at: event.at,
          until: event.until,
          url: event.url,
          retryAfter: event.retryAfter,
        });
        state.cooldowns[event.origin] = Math.max(state.cooldowns[event.origin] ?? 0, event.until);
      } else if (event.type === 'round-end') {
        round.finishedAt = event.at;
        round.complete = event.complete;
      } else throw new Error(`Unknown history event: ${event.type}`);
    }
    const round = rounds.get(event.roundId ?? event.round.id);
    const { results, pauses, ...metadata } = round;
    const entry = { ...metadata, ...summarizeRound(round), file: `round-${round.id}.json` };
    const index = state.rounds.findIndex((item) => item.id === round.id);
    if (index < 0) state.rounds.push(entry);
    else state.rounds[index] = entry;
  }

  async function saveRound(round, compareExisting = false) {
    await atomicWrite(join(directory, `round-${round.id}.json`), json(round), compareExisting);
    await atomicWrite(
      join(directory, `round-${round.id}.md`),
      renderRoundMarkdown(round, contexts.get(round.runId)),
      compareExisting,
    );
  }

  async function save(event, compareExisting = false) {
    if (event?.roundId || event?.round)
      await saveRound(rounds.get(event.roundId ?? event.round.id), compareExisting);
    if (event?.type === 'run-start' || event?.type === 'run-end') {
      const run = contexts.get(event.runId ?? event.run.id);
      await atomicWrite(join(directory, `run-${run.id}.json`), json(run), compareExisting);
    }
    await atomicWrite(join(directory, 'report.json'), json(state), compareExisting);
    await atomicWrite(
      join(directory, 'report.md'),
      renderSummaryMarkdown(state, contexts.get(state.runs.at(-1)?.id)),
      compareExisting,
    );
  }

  async function release() {
    try {
      await journal?.close();
    } finally {
      try {
        await lock.close();
      } finally {
        await unlink(lockFile);
      }
    }
  }

  try {
    await lock.writeFile(json({ pid: process.pid, hostname: hostname() }));
    const file = join(directory, 'events.jsonl');
    let contents = '';
    try {
      contents = await readFile(file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const [index, line] of contents.split('\n').entries()) {
      if (!line.trim()) continue;
      try {
        apply(JSON.parse(line));
      } catch (error) {
        throw new Error(`Invalid history at ${file}:${index + 1}: ${error.message}`);
      }
    }
    journal = await open(file, 'a');
    if (contents && !contents.endsWith('\n')) await journal.appendFile('\n');
    // Replay remains authoritative, but intact reports do not need another write.
    for (const round of rounds.values()) await saveRound(round, true);
    for (const run of contexts.values())
      await atomicWrite(join(directory, `run-${run.id}.json`), json(run), true);
    await save(undefined, true);
    return {
      directory,
      state,
      rounds,
      record(event) {
        writes = writes.then(async () => {
          await journal.appendFile(JSON.stringify(event) + '\n');
          apply(event);
          // Starting a request is not a measurement. The next result, pause or
          // end event includes this pending state in its report snapshots.
          if (event.type !== 'request-start') await save(event);
        });
        return writes;
      },
      async close() {
        try {
          await writes;
        } finally {
          await release();
        }
      },
    };
  } catch (error) {
    await release();
    throw error;
  }
}
