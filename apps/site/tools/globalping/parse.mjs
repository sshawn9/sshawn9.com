import { emptyRow } from './schema.mjs';
import { parseHeaders } from './headers.mjs';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const issue = (issues, path, reason) => issues.push({ path, reason });

function timestamp(value) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maxDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > maxDays[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    !Number.isFinite(Date.parse(value))
  )
    return null;
  return new Date(value).toISOString();
}

function project(row, source, mapping, type, issues, prefix = '') {
  for (const [column, path] of Object.entries(mapping)) {
    const value = path.split('.').reduce((item, key) => item?.[key], source);
    if (value == null) continue;
    let mapped = null;
    if (type === 'string' && typeof value === 'string') mapped = value;
    if (type === 'integer' && Number.isSafeInteger(value) && value >= 0) mapped = value;
    if (type === 'boolean' && typeof value === 'boolean') mapped = value ? 1 : 0;
    if (type === 'timestamp' && typeof value === 'string') mapped = timestamp(value);
    row[column] = mapped;
    if (mapped === null) issue(issues, prefix + path, `expected ${type}`);
  }
}

export function parseMeasurement(stdout) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(stdout);
  const data = JSON.parse(text);
  if (!object(data)) throw new Error('CLI JSON 顶层必须是测量对象。');
  // Keep exact numeric literals in the source, independently of SQL projection.
  const lossless = JSON.parse(text, (_key, value, context) =>
    typeof value === 'number' ? JSON.rawJSON(context.source) : value,
  );
  const { results: _results, ...measurement } = lossless;
  const common = emptyRow(),
    sharedIssues = [];
  for (const key of ['id', 'type', 'status', 'target'])
    if (typeof data[key] !== 'string' || !data[key])
      issue(sharedIssues, key, 'missing or invalid required measurement field');
  if (data.type !== 'http') issue(sharedIssues, 'type', 'expected http measurement');
  if (data.status !== 'finished')
    issue(sharedIssues, 'status', 'CLI did not deliver a finished measurement');
  project(common, data, { measurement_id: 'id' }, 'string', sharedIssues);
  project(common, data, { measurement_created_at: 'createdAt' }, 'timestamp', sharedIssues);
  project(common, data, { measurement_probes_count: 'probesCount' }, 'integer', sharedIssues);
  if (!Array.isArray(data.results)) {
    issue(sharedIssues, 'results', 'expected result array');
    common.source_json = JSON.stringify({ measurement: lossless, observation: null });
    common.parse_issues_json = JSON.stringify(sharedIssues);
    return { rows: [], common, issues: sharedIssues };
  }
  if (!data.results.length) issue(sharedIssues, 'results', 'measurement returned no node results');
  const allIssues = [];
  const rows = data.results.map((observation, index) => {
    const row = { ...common, probe_index: index },
      issues = [...sharedIssues];
    row.source_json = JSON.stringify({ measurement, observation: lossless.results[index] });
    if (!object(observation)) {
      issue(issues, `results[${index}]`, 'expected observation object');
      observation = {};
    }
    for (const key of ['probe', 'result'])
      if (!object(observation[key])) issue(issues, key, 'missing or invalid object');
    const probe = object(observation.probe) ? observation.probe : {};
    const result = object(observation.result) ? observation.result : {};
    project(
      row,
      probe,
      {
        probe_country: 'country',
        probe_state: 'state',
        probe_city: 'city',
        probe_network: 'network',
      },
      'string',
      issues,
      'probe.',
    );
    project(row, probe, { probe_asn: 'asn' }, 'integer', issues, 'probe.');
    if (probe.tags != null) {
      if (Array.isArray(probe.tags) && probe.tags.every((tag) => typeof tag === 'string'))
        row.probe_tags_json = JSON.stringify(probe.tags);
      else issue(issues, 'probe.tags', 'expected string array');
    }
    if (typeof result.status !== 'string' || !result.status)
      issue(issues, 'result.status', 'missing result status');
    for (const key of ['timings', 'tls'])
      if (result[key] != null && !object(result[key]))
        issue(issues, `result.${key}`, 'expected object');
    project(
      row,
      result,
      {
        result_status: 'status',
        failure_source: 'failureSource',
        resolved_address: 'resolvedAddress',
        raw_output: 'rawOutput',
        tls_error: 'tls.error',
      },
      'string',
      issues,
      'result.',
    );
    project(
      row,
      result,
      {
        http_status_code: 'statusCode',
        dns_ms: 'timings.dns',
        tcp_ms: 'timings.tcp',
        tls_ms: 'timings.tls',
        first_byte_ms: 'timings.firstByte',
        download_ms: 'timings.download',
        total_ms: 'timings.total',
      },
      'integer',
      issues,
      'result.',
    );
    project(
      row,
      result,
      { truncated: 'truncated', tls_authorized: 'tls.authorized' },
      'boolean',
      issues,
      'result.',
    );
    Object.assign(row, parseHeaders(result.headers, issues));
    row.parse_issues_json = JSON.stringify(issues);
    allIssues.push(...issues.map((item) => ({ ...item, probeIndex: index })));
    return row;
  });
  common.source_json = JSON.stringify({ measurement, observation: null });
  common.parse_issues_json = JSON.stringify(sharedIssues);
  return { rows, common, issues: rows.length ? allIssues : sharedIssues };
}
