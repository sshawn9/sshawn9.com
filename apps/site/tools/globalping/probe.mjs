import { randomUUID } from 'node:crypto';
import { cliPath, runProcess } from './runner.mjs';
import { emptyRow } from './schema.mjs';
import { MeasurementStore } from './store.mjs';
import { parseMeasurement } from './parse.mjs';

/** @param {string|null} [invocationId] */
export function failure(stage, code, error, invocationId = null) {
  return {
    saved: false,
    collectionStatus: null,
    exitCode: 1,
    invocationId,
    measurementId: null,
    recordIds: [],
    records: [],
    cliStderr: '',
    errors: [{ stage, code, message: error.message }],
  };
}

/** Execute one measurement using the configuration returned by parseArguments.
 * @param {{request: object, args: string[], database: string}} config
 * @param {{signal?: AbortSignal, executable?: string}} [dependencies]
 * executable is an explicit test dependency, never an automatic PATH fallback.
 */
export async function recordMeasurement(config, { signal, executable = cliPath } = {}) {
  const invocationId = randomUUID(),
    started = new Date().toISOString();
  const start = {
    ...config.request,
    id: randomUUID(),
    invocation_id: invocationId,
    collection_status: 'running',
    local_started_at: started,
    cli_argv_json: JSON.stringify(config.args),
  };
  const errors = [];
  let store,
    rows = [],
    saved = false,
    collectionStatus = 'cli_error',
    exitCode = 1;
  const fail = (stage, code, message) => errors.push({ stage, code, message });
  try {
    store = new MeasurementStore(config.database);
    store.begin(start);
  } catch (error) {
    store?.close();
    return failure('store', 'STORE_OPEN_FAILED', error, invocationId);
  }
  try {
    const processOptions = { signal, timeoutSeconds: config.request.process_timeout_s };
    const execution = await runProcess(executable, config.args, processOptions);
    let parsed;
    if (execution.stdout.length) {
      try {
        parsed = parseMeasurement(execution.stdout);
      } catch (error) {
        fail('parse', 'INVALID_JSON', error.message);
      }
    }
    if (execution.error)
      fail(
        'spawn',
        execution.error.code ?? 'SPAWN_FAILED',
        `${execution.error.message}；请检查 npm run globalping:install。`,
      );
    if (execution.reason === 'timeout')
      fail('process', 'PROCESS_TIMEOUT', '本地 CLI 子进程超过指定时限，已终止；未重试远端测量。');
    else if (execution.reason) fail('process', execution.reason, '本次调用已中断。');
    else if (!execution.error && execution.code !== 0)
      fail(
        'process',
        'CLI_EXIT',
        `CLI 退出码 ${execution.code}，信号 ${execution.signal ?? '无'}。`,
      );
    if (parsed?.issues.length)
      fail(
        'parse',
        'FIELD_MAPPING',
        `${parsed.issues.length} 个字段解析问题，详情见 parse_issues_json。`,
      );
    if (!parsed && errors.length === 0) fail('parse', 'EMPTY_OUTPUT', 'CLI 没有返回测量 JSON。');
    if (['SIGINT', 'SIGTERM'].includes(execution.reason)) {
      collectionStatus = 'interrupted';
      exitCode = execution.reason === 'SIGINT' ? 130 : 143;
    } else if (errors.some((e) => e.stage !== 'parse')) collectionStatus = 'cli_error';
    else if (errors.length) collectionStatus = 'parse_error';
    else {
      collectionStatus = 'stored';
      exitCode = 0;
    }
    const firstError = errors[0];
    const local = {
      ...start,
      collection_status: collectionStatus,
      cli_stderr: execution.stderr.toString('utf8'),
      call_error_code: firstError?.code ?? null,
      call_error_message: firstError?.message ?? null,
    };
    const hasProbes = Boolean(parsed?.rows.length);
    rows = (hasProbes ? parsed.rows : [parsed?.common ?? emptyRow()]).map((parsedRow, index) => ({
      ...parsedRow,
      ...local,
      id: index === 0 ? start.id : randomUUID(),
      probe_index: hasProbes ? index : null,
      unparsed_stdout: hasProbes ? null : execution.stdout,
      unparsed_stderr: hasProbes ? null : execution.stderr,
    }));
    store.finish(start, rows);
    saved = true;
  } catch (error) {
    fail('store', 'STORE_WRITE_FAILED', error.message);
    saved = false;
    exitCode = 1;
    collectionStatus = 'running';
  } finally {
    try {
      store.close();
    } catch (error) {
      fail('store', 'STORE_CLOSE_FAILED', error.message);
      saved = false;
      exitCode = 1;
    }
  }
  return {
    invocationId,
    measurementId: rows[0]?.measurement_id ?? null,
    database: config.database,
    saved,
    collectionStatus,
    exitCode,
    recordIds: saved ? rows.map((r) => r.id) : [],
    records: rows,
    errors,
    cliStderr: rows[0]?.cli_stderr ?? '',
  };
}
