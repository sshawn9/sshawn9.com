import { prepareBatch, runBatch } from './batch.mjs';

const help = `Globalping 资源与城市批量探测

用法：npm run globalping:batch -- --cities FILE --history-days N [选项]

--cities FILE          城市 JSON 数组，包含 country、city，忽略 count
--resources FILE       默认 apps/site/.reports/resource-inventory.json
--history-days N       查询最近 N 天，必填正数，允许小数
--skip-hit-count M     有效 HIT 达到 M 次即跳过，默认 1
--rounds N             轮数，默认 1
--limit N              每次测量节点数量，默认 1
--database FILE        默认 apps/site/.reports/globalping/measurements.sqlite
--header VALUE         请求头，可重复；--ipv4 / --ipv6 二选一
--timeout SEC          节点探测期限
--process-timeout SEC  本地 CLI 进程总时限
--help                 显示帮助，不读取清单、不创建数据库

顺序：轮次 → 引用页数降序的资源 → 城市文件顺序。
每次查询最新 SQLite，只累计 finished + HTTP 200 + HIT 的节点记录。
固定 GET；CLI、解析或数据库异常时停止，不自动等待重试。
`;
const controller = new AbortController();
const interrupt = () => controller.abort('SIGINT');
const terminate = () => controller.abort('SIGTERM');
const line = (value) => String(value).replace(/\s+/g, ' ').trim();
process.on('SIGINT', interrupt);
process.on('SIGTERM', terminate);
try {
  const batch = prepareBatch(process.argv.slice(2));
  if (batch.help) process.stdout.write(help);
  else {
    const result = await runBatch(batch, {
      signal: controller.signal,
      onProgress(event) {
        if (event.type === 'round')
          console.log(
            `第 ${event.round} 轮完成：调用 ${event.executed}，跳过 ${event.skipped}，已保存 ${event.savedRecords} 条，异常节点 ${event.failedNodes}`,
          );
        else
          console.log(
            `[轮 ${event.round}/${batch.rounds} 资源 ${event.resourceIndex}/${batch.resources.length}] ${line(event.city.from)} ${line(event.url)} | HIT ${event.hits}/${event.nodes} | ${event.saved ? `已保存 ${event.records} 条` : '未完成入库'}`,
          );
      },
    });
    console.log(
      `批次${result.exitCode ? '停止' : '完成'}：${result.roundsCompleted}/${batch.rounds} 轮，调用 ${result.executed}，跳过 ${result.skipped}，已保存 ${result.savedRecords} 条，异常节点 ${result.failedNodes}`,
    );
    if (result.error) console.error(line(result.error).slice(0, 600));
    process.exitCode = result.exitCode;
  }
} catch (error) {
  console.error(line(error.message).slice(0, 600));
  process.exitCode = 1;
} finally {
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', terminate);
}
