import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { defaultInventoryUrl, loadInventory } from './inventory-input.mjs';
import { defaults, runProbe, summarizeRound, validateOptions } from './probe.mjs';

const reportsDirectory = fileURLToPath(new URL('../../.reports/', import.meta.url));
const help = `Usage: npm run cache:probe -- [options]

  --inventory PATH|URL   Production resource inventory JSON (default: ${defaultInventoryUrl})
  --output PATH          Parent directory for persistent egress-IP archives
  --hit-streak N         Historical consecutive HITs in one colo required to skip (default: 2)
  --max-attempts N       Maximum attempts per resource in this run (default: ${defaults.maxAttempts})
  --concurrency N        Maximum active requests (default: 2)
  --interval-min SEC     Minimum randomized refill delay (default: 1)
  --interval-max SEC     Maximum randomized refill delay (default: 3)
  --request-timeout SEC  Complete request deadline (default: 20)
  --help                 Show this help without making requests

Reads existing URLs; never builds, crawls, clears caches or changes deployment.
Connections are reused; every refill waits its own randomly sampled delay.
There is no total deadline or fixed-round mode. Each round attempts every eligible
resource once. Egress IP is queried once per run; all rounds use that IP archive. Summaries
update after every resource. Historical qualification does not expire automatically.
429 pauses new resource requests: Retry-After when valid, otherwise 60 seconds.
403 or a Cloudflare challenge stops the run. No protection bypass is attempted.
Exit codes: 0 = all resources qualify; 2 = attempts exhausted; 3 = access blocked;
1 = execution error; 130/143 = interrupted by SIGINT/SIGTERM.
`;

const controller = new AbortController();
const sigint = () => controller.abort('SIGINT');
const sigterm = () => controller.abort('SIGTERM');
try {
  const { values } = parseArgs({
    options: {
      inventory: { type: 'string', default: defaultInventoryUrl },
      output: { type: 'string', default: join(reportsDirectory, 'cache-probe') },
      'hit-streak': { type: 'string', default: String(defaults.hitStreak) },
      'max-attempts': { type: 'string', default: String(defaults.maxAttempts) },
      concurrency: { type: 'string', default: String(defaults.concurrency) },
      'interval-min': { type: 'string', default: String(defaults.minInterval) },
      'interval-max': { type: 'string', default: String(defaults.maxInterval) },
      'request-timeout': { type: 'string', default: String(defaults.requestTimeout) },
      help: { type: 'boolean' },
    },
  });
  if (values.help) console.log(help);
  else {
    const options = {
      hitStreak: Number(values['hit-streak']),
      maxAttempts: Number(values['max-attempts']),
      concurrency: Number(values.concurrency),
      minInterval: Number(values['interval-min']),
      maxInterval: Number(values['interval-max']),
      requestTimeout: Number(values['request-timeout']),
    };
    validateOptions(options);
    process.on('SIGINT', sigint);
    process.on('SIGTERM', sigterm);
    const { inventory, input } = await loadInventory(values.inventory, {
      signal: controller.signal,
      requestTimeout: options.requestTimeout,
    });
    const report = await runProbe(inventory, options, {
      directory: resolve(values.output),
      signal: controller.signal,
      input,
      onEvent(event, current) {
        if (event.type === 'archive') console.log(`Egress ${event.ip}: ${event.directory}`);
        if (event.type === 'round-start') console.log(`Round ${event.round.number} started.`);
        if (event.type === 'pause')
          console.log(`Rate limited: refill paused until ${new Date(event.until).toISOString()}.`);
        if (event.type === 'resource' || event.type === 'round-end') {
          const round = current.rounds.at(-1);
          const summary = summarizeRound(round);
          if (event.type === 'round-end' || summary.measured % 25 === 0)
            console.log(
              `Round ${round.number}: ${summary.measured} measured, ${summary.hits} HIT, ${summary.skipped} skipped, ${summary.exhausted} exhausted.`,
            );
        }
      },
    });
    console.log(`Stopped: ${report.stopReason}.`);
    if (report.failure) console.error(report.failure);
    for (const directory of report.directories) console.log(join(directory, 'report.md'));
    process.exitCode =
      report.stopReason === 'warm'
        ? 0
        : report.stopReason === 'attempts-exhausted'
          ? 2
          : report.stopReason === 'blocked'
            ? 3
            : report.stopReason === 'interrupted'
              ? controller.signal.reason === 'SIGTERM'
                ? 143
                : 130
              : 1;
  }
} catch (error) {
  if (controller.signal.aborted) {
    console.error(`Cache probe interrupted: ${controller.signal.reason}.`);
    process.exitCode = controller.signal.reason === 'SIGTERM' ? 143 : 130;
  } else {
    console.error(`Cache probe failed: ${error.message}`);
    process.exitCode = 1;
  }
} finally {
  process.off('SIGINT', sigint);
  process.off('SIGTERM', sigterm);
}
