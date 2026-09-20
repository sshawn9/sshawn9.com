import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import {
  createMeasurementConfig,
  measurementValues,
  measurementSwitches,
  parseOptions,
  positiveInteger,
} from './runner.mjs';
import { recordMeasurement } from './probe.mjs';
import { MeasurementStore } from './store.mjs';

export const defaultResources = fileURLToPath(
  new URL('../../.reports/resource-inventory.json', import.meta.url),
);

export function prepareBatch(argv) {
  const options = parseOptions(
    argv,
    ['rounds', 'resources', 'cities', 'history-days', 'skip-hit-count', ...measurementValues],
    ['help', ...measurementSwitches],
  );
  if (options.help) return { help: true };
  if (!options.cities?.trim()) throw new Error('必须提供 --cities 城市列表。');
  const historyMs = Number(options['history-days']) * 86400000;
  if (
    !Number.isFinite(historyMs) ||
    historyMs <= 0 ||
    !Number.isFinite(new Date(Date.now() - historyMs).getTime())
  )
    throw new Error('--history-days 必须是有效的正天数，允许小数。');
  const rounds = positiveInteger(options.rounds ?? 1, 'rounds');
  const skipHitCount = positiveInteger(options['skip-hit-count'] ?? 1, 'skip-hit-count');

  const inputCities = JSON.parse(readFileSync(resolve(options.cities), 'utf8'));
  if (!Array.isArray(inputCities) || !inputCities.length)
    throw new Error('城市列表必须是非空数组。');
  const cities = new Map();
  for (const entry of inputCities) {
    const country = typeof entry?.country === 'string' ? entry.country.trim().toUpperCase() : '';
    const city = typeof entry?.city === 'string' ? entry.city.trim() : '';
    if (!/^[A-Z]{2}$/.test(country) || !city || /[+,\r\n\0]/.test(city))
      throw new Error('城市必须包含两位国家代码和非空城市名，城市名不能含地区筛选分隔符。');
    const from = `${country}+${city}`;
    if (!cities.has(from)) cities.set(from, { country, city, from });
  }
  const locations = [...cities.values()];
  const inventory = JSON.parse(
    readFileSync(resolve(options.resources ?? defaultResources), 'utf8'),
  );
  if (
    !Array.isArray(inventory?.resources) ||
    !inventory.resources.length ||
    !inventory.resourcePages ||
    typeof inventory.resourcePages !== 'object' ||
    Array.isArray(inventory.resourcePages)
  )
    throw new Error('资源清单必须包含非空 resources 数组和 resourcePages 对象。');
  const resources = new Map();
  for (const resource of inventory.resources) {
    const url = resource?.url;
    const pages = inventory.resourcePages[url];
    if (
      typeof url !== 'string' ||
      !Array.isArray(pages) ||
      pages.some((page) => typeof page !== 'string')
    )
      throw new Error('每个资源必须包含 URL 和对应的引用页面数组。');
    if (!resources.has(url))
      resources.set(url, {
        url,
        references: pages.length,
        config: createMeasurementConfig({ ...options, url, from: locations[0].from }),
      });
  }
  const ordered = [...resources.values()].sort(
    (a, b) => b.references - a.references || a.url.localeCompare(b.url),
  );
  return {
    help: false,
    rounds,
    historyMs,
    skipHitCount,
    cities: locations,
    resources: ordered,
    database: ordered[0].config.database,
  };
}

const countSQL = `SELECT COUNT(*) AS hits FROM measurements
  WHERE probe_index IS NOT NULL AND url = ? AND probe_country = ? AND probe_city = ?
    AND measurement_created_at >= ? AND measurement_created_at <= ?
    AND result_status = 'finished' AND http_status_code = 200 AND cache_status = 'HIT'`;

/** @param {object} batch
 * @param {{signal?: AbortSignal, measure?: typeof recordMeasurement, now?: () => number, onProgress?: (event: any) => void}} [dependencies]
 */
export async function runBatch(
  batch,
  { signal, measure = recordMeasurement, now = Date.now, onProgress = () => {} } = {},
) {
  const summary = {
    roundsCompleted: 0,
    executed: 0,
    skipped: 0,
    savedRecords: 0,
    failedNodes: 0,
    exitCode: 0,
    error: null,
  };
  const interrupted = () => {
    if (!signal?.aborted) return false;
    summary.exitCode = signal.reason === 'SIGINT' ? 130 : 143;
    summary.error = `收到 ${signal.reason === 'SIGINT' ? 'SIGINT' : 'SIGTERM'}，已停止调度。`;
    return true;
  };
  if (interrupted()) return summary;
  let store;
  try {
    store = new MeasurementStore(batch.database);
    const query = store.db.prepare(countSQL);
    rounds: for (let round = 1; round <= batch.rounds; round++) {
      const start = { ...summary };
      for (const [index, resource] of batch.resources.entries()) {
        for (const city of batch.cities) {
          // Allow signal handlers to run even when every task is skipped.
          await setImmediate();
          if (interrupted()) break rounds;
          const time = now();
          const hits = Number(
            query.get(
              resource.url,
              city.country,
              city.city,
              new Date(time - batch.historyMs).toISOString(),
              new Date(time).toISOString(),
            ).hits,
          );
          if (hits >= batch.skipHitCount) {
            summary.skipped++;
            continue;
          }
          // Reuse the validated URL configuration; only this iteration's city changes.
          const config = {
            ...resource.config,
            request: { ...resource.config.request, request_from: city.from },
            args: [...resource.config.args],
          };
          config.args[config.args.indexOf('--from') + 1] = city.from;
          summary.executed++;
          const result = await measure(config, { signal });
          const nodes = result.records.filter((row) => row.probe_index !== null);
          const hitNodes = nodes.filter(
            (row) =>
              row.result_status === 'finished' &&
              row.http_status_code === 200 &&
              row.cache_status === 'HIT',
          ).length;
          summary.savedRecords += result.saved ? result.recordIds.length : 0;
          summary.failedNodes += nodes.filter(
            (row) => row.result_status !== 'finished' || row.http_status_code !== 200,
          ).length;
          onProgress({
            type: 'measurement',
            round,
            resourceIndex: index + 1,
            url: resource.url,
            city,
            nodes: nodes.length,
            hits: hitNodes,
            saved: result.saved,
            records: result.recordIds.length,
          });
          if (result.exitCode !== 0 || !result.saved) {
            summary.exitCode = result.exitCode || 1;
            summary.error =
              [...result.errors.map((error) => error.message), result.cliStderr]
                .filter(Boolean)
                .join('\n') || '测量未完成入库。';
            break rounds;
          }
          if (interrupted()) break rounds;
        }
      }
      summary.roundsCompleted++;
      onProgress({
        type: 'round',
        round,
        executed: summary.executed - start.executed,
        skipped: summary.skipped - start.skipped,
        savedRecords: summary.savedRecords - start.savedRecords,
        failedNodes: summary.failedNodes - start.failedNodes,
      });
    }
  } catch (error) {
    summary.exitCode = 1;
    summary.error = error.message;
  } finally {
    try {
      store?.close();
    } catch (error) {
      summary.exitCode = 1;
      summary.error = [summary.error, error.message].filter(Boolean).join('\n');
    }
  }
  return summary;
}
