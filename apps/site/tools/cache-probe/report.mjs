function text(value) {
  return String(value ?? 'Unknown')
    .replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character])
    .replace(/[\\`*_[\]|]/g, '\\$&')
    .replace(/[\r\n]+/g, ' ');
}

function link(label, url) {
  return `[${text(label)}](<${url.replace(/[<>|\s]/g, (character) => encodeURIComponent(character))}>)`;
}

const shortUrl = (url) => new URL(url).pathname + new URL(url).search;
const timing = (result, key) =>
  result?.timings?.[key] == null ? '—' : Number(result.timings[key]).toFixed(1);

export function summarizeRound(round) {
  const counts = {};
  for (const result of round.results) counts[result.state] = (counts[result.state] ?? 0) + 1;
  return {
    targets: round.results.length,
    measured: round.results.filter((result) => result.observedAt).length,
    hits: counts.hit ?? 0,
    skipped: counts.skipped ?? 0,
    exhausted: counts.exhausted ?? 0,
    counts,
    bytes: round.results.reduce((sum, result) => sum + (result.bytes ?? 0), 0),
  };
}

function resultsTable(results) {
  return [
    '| Resource | Result | Attempt | HTTP | Cache | Colo | Observed at | Headers¹ ms | Total¹ ms | Error / note |',
    '| --- | --- | ---: | ---: | --- | --- | --- | ---: | ---: | --- |',
    ...results.map(
      (result) =>
        `| ${link(shortUrl(result.url), result.url)} | ${text(result.state)} | ${result.attempt ?? '—'} | ${result.httpStatus ?? '—'} | ${text(result.cacheStatus)} | ${text(result.colo)} | ${text(result.observedAt ?? 'Not measured in this round')} | ${timing(result, 'firstByteMs')} | ${timing(result, 'totalMs')} | ${text(result.error ?? result.note ?? '')} |`,
    ),
  ].join('\n');
}

const measurementNote =
  '¹ Undici timings measure request start to response headers / complete decoded body. They include connection establishment when needed, but not the refill delay. They are not pure server processing time. Connections are reused across resources and rounds when the server permits. No browser HTTP cache is used.';

export function renderRoundMarkdown(round, run) {
  const summary = summarizeRound(round);
  return (
    [
      '# Cache probe round',
      `Run: ${text(round.runId)} · Round: ${round.number} · ${round.complete ? 'Complete' : 'INCOMPLETE'}\n\nStarted: ${text(round.startedAt)} · Finished: ${text(round.finishedAt ?? 'Not finished')}`,
      `Egress IP: ${text(round.egress?.ip)} · Country: ${text(round.egress?.country)} · Trace colo: ${text(round.egress?.colo)} · Sampled: ${text(round.egress?.sampledAt)}`,
      `Client: ${text(run?.transport?.name)} ${text(run?.transport?.version ?? '')} · Inventory build: ${text(run?.input?.buildId)}`,
      `Targets: ${summary.targets} · Measured: ${summary.measured} · HIT: ${summary.hits} · Skipped: ${summary.skipped} · Attempts exhausted: ${summary.exhausted} · Body bytes: ${summary.bytes}`,
      'Skipped entries are decisions based on history, not new HIT measurements. Pending or not-requested entries were not completed. The egress IP is sampled once at the start of the run, not verified per request.',
      resultsTable(round.results),
      ...(round.pauses?.length
        ? [
            '## Rate-limit pauses',
            ...round.pauses.map(
              (pause) =>
                `- ${text(pause.at)}: wait until ${text(new Date(pause.until).toISOString())}; ${link(shortUrl(pause.url), pause.url)}; Retry-After: ${text(pause.retryAfter ?? 'Missing / invalid; 60 second fallback')}`,
            ),
          ]
        : []),
      measurementNote,
    ].join('\n\n') + '\n'
  );
}

export function renderSummaryMarkdown(state, run) {
  const required = run?.options?.hitStreak ?? 2;
  const entries = Object.entries(state.resources).sort(([a], [b]) => a.localeCompare(b));
  const qualified = (url) => {
    const streak = state.resources[url]?.streak;
    return Boolean(streak?.colo && streak.count >= required);
  };
  const targets = run?.targets ?? [];
  return (
    [
      '# Cache probe — cumulative egress summary',
      `Egress IP: ${text(state.ip)} · Updated: ${text(state.updatedAt ?? 'No measurements')}`,
      run
        ? `Latest run: ${link(run.id, `run-${run.id}.json`)} · Site: ${link(run.input.site, run.input.site)} · Inventory build: ${text(run.input.buildId)}\n\nStatus: ${text(run.stopReason ?? 'Running / not finalized')} · Required consecutive HITs: ${required} · Per-resource attempts: ${run.options.maxAttempts} · Concurrency: ${run.options.concurrency}`
        : 'No run has been recorded.',
      `Current inventory: ${targets.filter((item) => qualified(item.url)).length}/${targets.length} resources qualify for skipping. Historical resources: ${entries.length}.`,
      'This is an incremental view of the latest actual measurement for each resource, not the results of a fresh full-site round. Qualification uses the latest consecutive complete HITs in one known colo. History has no automatic expiry. A historical HIT does not prove the current cache state or deployed content. The inventory build ID identifies the input, not a verified remote deployment.',
      '## Resources',
      [
        '| Resource | Latest result | HTTP | Cache | Colo | Consecutive HITs | Last measured | Client | Headers¹ ms | Total¹ ms |',
        '| --- | --- | ---: | --- | --- | ---: | --- | --- | ---: | ---: |',
        ...entries.map(([url, entry]) => {
          const result = entry.latest;
          return `| ${link(url, url)} | ${text(result.state)} | ${result.httpStatus ?? '—'} | ${text(result.cacheStatus)} | ${text(result.colo)} | ${entry.streak.count} | ${text(result.observedAt)} | ${text(result.client)} | ${timing(result, 'firstByteMs')} | ${timing(result, 'totalMs')} |`;
        }),
      ].join('\n'),
      '## Pages — cumulative qualification for the current inventory',
      [
        '| Page | Qualified / associated resources | Outstanding resources |',
        '| --- | ---: | --- |',
        ...(run?.pages ?? []).map((page) => {
          const urls = run.pageResources[page.url];
          const missing = urls.filter((url) => !qualified(url));
          return `| ${link(page.title || shortUrl(page.url), page.url)} | ${urls.length - missing.length}/${urls.length} | ${missing.map((url) => link(shortUrl(url), url)).join(', ') || 'None'} |`;
        }),
      ].join('\n'),
      '## All rounds',
      [
        '| Run / round | Started | Complete | Measured | HIT | Skipped | Exhausted | Reports |',
        '| --- | --- | --- | ---: | ---: | ---: | ---: | --- |',
        ...state.rounds.map(
          (round) =>
            `| ${text(round.runId)} / ${round.number} | ${text(round.startedAt)} | ${round.complete ? 'Yes' : 'No'} | ${round.measured} | ${round.hits} | ${round.skipped} | ${round.exhausted} | ${link('Markdown', `round-${round.id}.md`)} · ${link('JSON', round.file)} |`,
        ),
      ].join('\n'),
      ...(run?.skipped?.length
        ? [
            '## External resources not probed',
            ...run.skipped.map((item) => `- ${link(item.url, item.url)}`),
          ]
        : []),
      measurementNote,
      'events.jsonl retains every recorded event. Round JSON/Markdown files retain each run and round; report.json/report.md are replaceable incremental summaries. A hard interruption can leave snapshots behind the journal; reopening this IP archive reconstructs them. The .lock file prevents concurrent writers; after a hard kill, verify the old process is gone before removing its stale lock.',
    ].join('\n\n') + '\n'
  );
}
