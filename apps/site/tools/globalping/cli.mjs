import { parseArguments } from './runner.mjs';
import { failure, recordMeasurement } from './probe.mjs';

const help = `Globalping 单 URL 探测与 SQLite 记录

安装/更新：npm run globalping:install
用法：npm run globalping:record -- --url URL --from LOCATION [选项]

--url URL              必填，一个 HTTP(S) 资源
--from LOCATION        必填，地区表达式或明确的测量 ID
--limit N              节点数量，默认 1
--database PATH        默认 apps/site/.reports/globalping/measurements.sqlite
--process-timeout SEC  本地子进程总时限，默认不额外限制
--timeout SEC          节点探测期限，单位为秒
--header VALUE         可重复；--ipv4 / --ipv6 二选一
--json                 输出完整结果 JSON；默认显示节点摘要和入库状态
--help                 本帮助；不创建数据库、不发起测量

固定使用 GET，内部调用官方 CLI 使用 --json --ci；每次只执行一条测量命令。
历史默认全部保留。外层程序负责资源循环、历史策略和限流重试。
`;

const argv = process.argv.slice(2);
let options, result;
try {
  options = parseArguments(argv);
} catch (error) {
  result = failure('input', 'INVALID_ARGUMENT', error);
}
if (options?.help) process.stdout.write(help);
else {
  const controller = new AbortController();
  const interrupt = () => controller.abort('SIGINT');
  const terminate = () => controller.abort('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    result ??= await recordMeasurement(options, { signal: controller.signal });
    // Preserve machine-readable input errors too, before valid options exist.
    if (options?.json ?? argv.includes('--json'))
      process.stdout.write(`${JSON.stringify(result)}\n`);
    else {
      const line = (value) =>
        String(value ?? '-')
          .replace(/\s+/g, ' ')
          .trim();
      const lines = [];
      if (result.records[0]?.url) lines.push(`URL: ${line(result.records[0].url)}`);
      for (const row of result.records.filter((row) => row.probe_index !== null)) {
        lines.push(
          [
            `[${row.probe_index + 1}] ${line(row.probe_city)}, ${line(row.probe_country)} AS${row.probe_asn ?? '?'}`,
            line(row.result_status),
            `HTTP ${row.http_status_code ?? '-'}`,
            `缓存 ${line(row.cache_status)}`,
            `CF ${line(row.cf_colo)}`,
            row.total_ms === null ? '-' : `${row.total_ms} ms`,
          ].join(' | '),
        );
      }
      lines.push(
        result.saved
          ? `已保存 ${result.recordIds.length} 条记录 → ${line(result.database)}`
          : '未完成入库',
      );
      if (result.collectionStatus && result.collectionStatus !== 'stored')
        lines.push(`采集状态: ${result.collectionStatus}`);
      process.stdout.write(`${lines.join('\n')}\n`);
      const brief = (value) => {
        const text = line(value);
        return text.length > 600 ? `${text.slice(0, 600)}…（完整信息见数据库或 --json）` : text;
      };
      for (const error of result.errors)
        process.stderr.write(`[${error.stage}/${error.code}] ${brief(error.message)}\n`);
      if (result.cliStderr) process.stderr.write(`CLI: ${brief(result.cliStderr)}\n`);
    }
    process.exitCode = result.exitCode;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
}
