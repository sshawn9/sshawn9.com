# Globalping 单 URL 探测与 SQLite 记录

输入一个 URL，执行一次官方 Globalping CLI HTTP GET 测量，将每个节点的结果追加到 SQLite。只有一张 `measurements` 表、57 列。外层负责读取资源清单、批量循环、历史策略及清理；本工具不自动重试或按历史跳过。

## 安装和使用

在项目 direnv/devenv 环境中运行：

```sh
npm run globalping:install
npm run globalping:record -- --url 'https://sshawn9.com/zh/' --from 'China+Shanghai' --limit 1
```

非交互任务使用 `devenv shell -- ...`。安装通过 Go 的 `@latest` 将官方程序放到项目 `.tools/bin/globalping-cli`，显示安装路径和版本；测量时直接执行一次 `http ... --method GET --json --ci`，不再额外查询版本，不使用 PATH 中的其他安装。

认证沿用 `.tools/bin/globalping-cli auth login` 或环境变量 `GLOBALPING_TOKEN`。本工具不读取认证文件、不记录整个环境；显式目标请求头和测量结果照常保存。

| 参数                    | 行为                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `--url URL`             | 必填，一个 HTTP(S) URL，不带凭据或 fragment                                                |
| `--from LOCATION`       | 必填，位置表达式或明确的测量 ID                                                            |
| `--limit N`             | 默认 1，正整数；实际取得数量以返回为准                                                     |
| `--database PATH`       | 默认项目 `apps/site/.reports/globalping/measurements.sqlite`；相对自定义路径基于调用者 cwd |
| `--process-timeout SEC` | 可选本地 CLI 进程总时限，默认不额外限制                                                    |
| `--timeout SEC`         | 节点期限，官方 CLI 校验，单位为秒                                                          |
| `--header 'Key: Value'` | 可重复，保留顺序，交给官方 CLI 处理                                                        |
| `--ipv4` / `--ipv6`     | 二选一                                                                                     |
| `--json`                | 输出完整结果 JSON，默认只显示节点摘要和入库状态                                            |
| `--help`                | 帮助，不创建数据库、不测量                                                                 |

请求固定 GET，DNS 沿用探测节点默认设置。协议、连接端口、路径和查询参数从完整 `--url` 提取，内部以独立参数传给官方 CLI，保留编码路径、重复查询参数和 IPv6 方括号。不提供 `--host`、`--path`、`--query`、`--protocol`、`--port`、`--method`、`--resolver` 选项。不添加绕缓存参数。不支持请求 JSON/清单输入、多个 URL、重复单值参数，以及 `last` / `previous` / `first` / `@序号`。`--from ID` 创建新测量并复用节点，不补取旧结果。

## 记录与查询

57 列的名称、类型与来源见 [方案第 3 节](../../../../docs/globalping-redesign-plan.md#3-固定的-57-列) 和 [schema.mjs](schema.mjs)。核心查询字段包括资源 URL、时间、请求条件、地区/ASN/标签、HTTP/缓存状态、Cloudflare 机房、六项耗时、缓存声明、TLS 验证及错误。

每节点一行，共用本次 `invocation_id` / `measurement_id`，`probe_index` 是结果数组中的位置。未取得节点时保留一条调用记录，`probe_index=NULL`。城市、ASN、标签不能直接当作唯一稳定节点 ID。

`source_json` 保存完整测量公共信息和当前节点结果，保留未知字段与数值字面量；正文、完整响应头、证书、Server-Timing 等不再重复拆列。只对保留列执行专用解析，不为已删除字段保留备用解析器。完整请求参数在 `cli_argv_json`，常用请求条件另有查询列。

```sql
SELECT url, measurement_created_at, probe_city, probe_asn,
       http_status_code, cache_status, cf_colo, total_ms, cc_max_age_seconds
FROM measurements
WHERE probe_index IS NOT NULL AND url = 'https://sshawn9.com/zh/'
ORDER BY measurement_created_at DESC;
```

SQLite 使用 Node 内置驱动、STRICT 表、WAL、`synchronous=FULL`、5 秒锁等待。先提交 running 记录，取得结果后用短事务转为首节点并插入其他节点。等待网络不持有写事务，完成事务失败整组回滚。历史默认全部追加，不去重、不清理。

新库使用当前结构；不匹配的库会拒绝写入，没有兼容或迁移入口。首次使用当前结构可用 `--database` 指定一个尚不存在的路径。

## 输出和错误

默认显示每节点一行摘要及入库状态；缺失值显示 `-`，不当成 MISS 或零耗时。节点离线/失败会明确显示。失败信息写到 stderr，每条正文最多展示 600 字符，完整内容仍用于入库与 JSON 返回。

需要机器读取完整 JSON 时：

```sh
npm run --silent globalping:record -- --url 'https://sshawn9.com/zh/' --from 'China+Shanghai' --json
```

`--silent` 去掉 npm 横幅，也可以直接运行 Node 入口。`--json` 只控制终端展示，内部始终使用官方 CLI 的 JSON 输出。

核心函数始终返回完整对象：`invocationId`、`measurementId`、`database`、`saved`、`collectionStatus`、`exitCode`、`recordIds`、`records`、`errors`、`cliStderr`。`records` 每行恰好 57 列，JSON 列仍为 JSON 文本。失败原始字节在输出 JSON 中采用 Node Buffer 的 `{type:"Buffer",data:[...]}` 形式。

```js
import { parseArguments } from './apps/site/tools/globalping/runner.mjs';
import { recordMeasurement } from './apps/site/tools/globalping/probe.mjs';
const config = parseArguments([
  '--url',
  'https://sshawn9.com/zh/',
  '--from',
  'China+Shanghai',
  '--limit',
  '1',
]);
const result = await recordMeasurement(config);
// 外层根据 saved、exitCode 和 errors 决定下一步。
```

参数在调用入口解析一次，解析失败直接报错；`recordMeasurement()` 只接收解析后的测量配置，不接受原始参数数组。第二个参数可传 `{signal: controller.signal}` 取消。核心函数不安装全局信号处理器。

| 情况                                                    | 行为                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| 正常记录，包括目标 403/404/429/5xx、节点 failed/offline | stored，退出 0                                                      |
| 保留字段解析失败                                        | 保留来源及问题，parse_error，退出 1                                 |
| CLI 失败、本地超时                                      | 保留输出与错误，cli_error，退出 1；若有合法节点 JSON 仍解析保存     |
| 无效 JSON 或没有节点结果                                | 保留调用记录及原始 stdout/stderr，退出 1                            |
| 存储失败                                                | saved=false，退出 1，不返回入库成功；开始记录可能仍为 running       |
| SIGINT / SIGTERM                                        | 转发给自己的子进程，最多等 5 秒后强制结束，尽力收尾，退出 130 / 143 |
| SIGKILL / 断电                                          | 仅保证已提交数据，可能留下 running，不自动恢复或重测                |

CLI exit 1 不能单独证明 API 限流；目标 HTTP 429 与 Globalping API 限流分开。没有额度查询、自动等待或重试。CLI 内部的创建回执、轮询、连接和未输出结果不在保存范围内。

缓存指令只记录响应声明，不推算实际 TTL、缓存键或跳过策略。保留 `truncated`，不将截断正文当作完整资源；一次 HIT 不证明此前为冷缓存。

测试说明见 [验收用例](../../../../tests/development/globalping-recording/README.md)。
