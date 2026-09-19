# Globalping 单 URL 探测与 SQLite 存储方案

当前方案：只保留已确认的 **57 列**，每节点一行，完整测量源数据保存在 `source_json`。不保留已删除列的专用解析器，不维护旧结构兼容或迁移逻辑。

## 1. 范围与执行

输入一个 `--url` 和本次地区、节点数量、HTTP 参数，运行一次官方 Globalping CLI 的 `http ... --json --ci`，解析结果并追加到单表 SQLite。程序不读取资源清单，不计算历史命中率、连续 HIT 或跳过策略，不调度多个 URL，不自动重试、清理或补采结果。这些工作由外层程序决定。

```text
单 URL 与本次参数 → 官方 CLI → 解析 57 列中的结果字段 → SQLite 事务提交 → 返回结果
```

`npm run globalping:install` 使用 `GOBIN="$PWD/.tools/bin" go install github.com/jsdelivr/globalping-cli@latest`，显示安装路径、实际版本并核对 JSON/CI 参数。devenv 提供 Go 工具链，项目不维护 Go 应用或 Globalping Nix 包。

测量固定调用项目 `.tools/bin/globalping-cli` 的绝对路径，使用 `spawn` 参数数组、`shell:false`。测量时不安装、升级或另外执行版本查询。认证沿用官方 CLI 登录状态或 `GLOBALPING_TOKEN`；程序不读取认证文件、不归档整个环境。用户显式提供的目标请求头仍作为输入保存。

```sh
npm run globalping:record -- --url 'https://sshawn9.com/zh/' --from 'China+Shanghai' --limit 1
```

`--url` 与 `--from` 必填，默认 GET、limit 1。默认数据库是 `apps/site/.reports/globalping/measurements.sqlite`。`--database` 可指定新路径；`--process-timeout` 是可选的本地进程总时限，`--timeout` 是节点期限，单位均为秒。

支持 `--protocol`、`--port`、`--host`、`--path`、`--query`、`--resolver`、可重复的 `--header`，以及互斥的 `--ipv4` / `--ipv6`。URL 拆成主机与独立参数，保留编码路径、查询顺序及重复查询参数，IPv6 主机带方括号。显式 HTTP 参数覆盖相应 URL 值，不添加绕缓存参数。

拒绝 URL 内嵌凭据、片段、多 URL、重复单值选项和隐式会话选择器 `last` / `previous` / `first` / `@序号`。允许 `--from` 显式测量 ID，为新测量复用节点；不将它当成补取旧结果。没有 `--request`、清单输入、`--table`、`--latency` 或 `--full` 入口。

官方依据：[CLI](https://github.com/jsdelivr/globalping-cli)、[HTTP 参数处理](https://github.com/jsdelivr/globalping-cli/blob/v1.6.0/cmd/http.go)、[JSON 输出](https://github.com/jsdelivr/globalping-cli/blob/v1.6.0/view/json.go)、[结果结构](https://github.com/jsdelivr/globalping/blob/master/public/v1/components/schemas.yaml)。

## 2. 记录粒度

一次调用获得 N 个节点结果，最终保存 N 行，共用 `invocation_id`、`measurement_id`。`probe_index` 是节点在结果数组中的零基序号。

没有取得节点结果时保留一条调用记录，`probe_index=NULL`。不再需要 `record_kind`。失败、离线节点仍有节点序号，不能与调用失败混淆。

节点标签、城市和 ASN 不保证唯一、稳定。`measurement_id` 与 `probe_index` 可引用一次测量中的节点，跨次节点识别仍由外层决定。探针所在地区与响应中的 Cloudflare 机房分别保存。

## 3. 固定的 57 列

TEXT 保存文本，INTEGER 保存整数和 0/1 布尔值，REAL 保存本地期限。未知值为 NULL，不用 0、空字符串或 MISS 代替。集合以合法 JSON TEXT 保存；异常原始输出使用 BLOB。

| 列                         | 类型    | 来源及用途                                                             |
| -------------------------- | ------- | ---------------------------------------------------------------------- |
| `id`                       | TEXT    | 本地行 UUID，定位、引用和删除记录                                      |
| `invocation_id`            | TEXT    | 本次调用 UUID，关联多节点及无远端 ID 的失败调用                        |
| `probe_index`              | INTEGER | 节点在本次结果数组中的位置；NULL 表示调用记录                          |
| `collection_status`        | TEXT    | 本地采集状态：running / stored / cli_error / parse_error / interrupted |
| `local_started_at`         | TEXT    | 所有调用的本地开始 UTC 时间，覆盖未创建测量的失败                      |
| `measurement_id`           | TEXT    | 返回的 id，关联远端测量及外层复用节点                                  |
| `measurement_created_at`   | TEXT    | 返回的 createdAt，转 UTC ISO 时间，查询历史时间窗口                    |
| `url`                      | TEXT    | 输入 URL 原文，按资源查历史                                            |
| `request_method`           | TEXT    | 实际传给 CLI 的方法，区分 GET / HEAD 等请求                            |
| `request_from`             | TEXT    | 请求的位置表达式或测量 ID，包含未取得节点的调用                        |
| `request_limit`            | INTEGER | 本次希望使用的节点数量                                                 |
| `measurement_probes_count` | INTEGER | 返回的 probesCount，记录实际数量，不从保留行数反推                     |
| `request_headers_json`     | TEXT    | 实际请求头参数列表，区分请求条件                                       |
| `cli_argv_json`            | TEXT    | 完整 CLI 参数数组，保存不再单列的协议、端口、路径覆盖等输入            |
| `process_timeout_s`        | REAL    | 本地进程期限；不属于官方 CLI 参数，未指定为 NULL                       |
| `probe_country`            | TEXT    | probe.country，按实际国家查询                                          |
| `probe_state`              | TEXT    | probe.state，区分同国同名城市                                          |
| `probe_city`               | TEXT    | probe.city，按实际城市查询                                             |
| `probe_asn`                | INTEGER | probe.asn，区分网络                                                    |
| `probe_network`            | TEXT    | probe.network，按网络名称查找                                          |
| `probe_tags_json`          | TEXT    | probe.tags，保留标签列表供外层识别来源                                 |
| `result_status`            | TEXT    | result.status，区分 finished / failed / offline 等                     |
| `http_status_code`         | INTEGER | result.statusCode，区分正常资源和 HTTP 错误                            |
| `cache_status`             | TEXT    | CF-Cache-Status，本次缓存观察                                          |
| `cf_colo`                  | TEXT    | 可识别的 CF-Ray 机房后缀，不等同于探针城市                             |
| `resolved_address`         | TEXT    | result.resolvedAddress，比较实际解析目标                               |
| `age_seconds`              | INTEGER | 合法 Age，响应报告的缓存年龄                                           |
| `content_media_type`       | TEXT    | Content-Type 的小写 type/subtype，识别响应资源类型                     |
| `content_encoding`         | TEXT    | Content-Encoding，区分编码                                             |
| `etag`                     | TEXT    | ETag，比较资源验证标识                                                 |
| `last_modified_utc`        | TEXT    | 合法 Last-Modified 转 UTC ISO 时间，提供版本变化线索                   |
| `truncated`                | INTEGER | result.truncated，头或正文是否截断                                     |
| `cc_max_age_seconds`       | INTEGER | Cache-Control 的合法 max-age                                           |
| `cc_s_maxage_seconds`      | INTEGER | Cache-Control 的合法 s-maxage                                          |
| `cc_no_store`              | INTEGER | 是否声明 no-store                                                      |
| `cc_no_cache`              | INTEGER | 是否声明 no-cache                                                      |
| `cc_private`               | INTEGER | 是否声明 private                                                       |
| `cc_must_revalidate`       | INTEGER | 是否声明 must-revalidate                                               |
| `vary_fields_json`         | TEXT    | Vary 的小写字段名列表                                                  |
| `vary_star`                | INTEGER | Vary 是否包含星号，区别空列表                                          |
| `dns_ms`                   | INTEGER | timings.dns，DNS 阶段耗时                                              |
| `tcp_ms`                   | INTEGER | timings.tcp，连接阶段耗时                                              |
| `tls_ms`                   | INTEGER | timings.tls，TLS 阶段耗时                                              |
| `first_byte_ms`            | INTEGER | timings.firstByte，首字节等待                                          |
| `download_ms`              | INTEGER | timings.download，服务报告的正文接收阶段耗时                           |
| `total_ms`                 | INTEGER | timings.total，总耗时                                                  |
| `failure_source`           | TEXT    | result.failureSource，服务报告的故障来源                               |
| `raw_output`               | TEXT    | result.rawOutput，直接搜索节点失败等说明                               |
| `tls_authorized`           | INTEGER | tls.authorized，证书验证结果                                           |
| `tls_error`                | TEXT    | tls.error，证书验证失败说明                                            |
| `call_error_code`          | TEXT    | 本地错误类别，例如 PROCESS_TIMEOUT，不伪称 API 原始错误码              |
| `call_error_message`       | TEXT    | 本地错误说明，CLI 非正常退出时包含实际退出信息                         |
| `cli_stderr`               | TEXT    | 官方 CLI 的完整错误文本，包括可能的限流说明                            |
| `parse_issues_json`        | TEXT    | 无法映射的保留字段及原因，区别未返回与解析失败                         |
| `source_json`              | TEXT    | 测量公共对象与当前完整节点结果，保留全部来源字段                       |
| `unparsed_stdout`          | BLOB    | 未得到正常节点结果时的原始 stdout                                      |
| `unparsed_stderr`          | BLOB    | 未得到正常节点结果时的原始 stderr                                      |

只对表中需要的结果字段进行映射。输入列仅保存常用查询条件，完整实际参数在 `cli_argv_json`；服务回显的全部选项仍在源对象中，不再逐项展开。

## 4. 解析和完整性

`source_json` 包含 `measurement`（根对象去掉 results）和 `observation`（当前完整 results[i]）。每行不复制其他节点，删除某行不会破坏其他行的来源数据。JSON 结构异常且 results 不是数组时保留完整根对象及原始输出。

来源 JSON 保留未知字段、正文、完整响应头、多值数组、证书等内容，使用 Node 原生 JSON source context 与 `JSON.rawJSON` 保留数值字面量，不承诺终端空白排版。UTF-8 或 JSON 解析失败时保留原始输出字节。

固定字段按类型校验；不能安全转换时保留源数据，将列置 NULL 并记录问题。failed/offline 缺少 HTTP/TLS 数据属于正常结果。耗时直接采用 API 的毫秒值，不用本地运行时长替换。测量创建时间不冒充单个节点完成时间。

响应头名不区分大小写。单值头重复且相同可提取，冲突时置 NULL 并报告。Cache-Control 支持多行、引用字符串、转义、相同数值重复和 max-age=0；冲突或非法数值不强制转换。四个指令标记仅表示声明是否出现；缺失为 NULL，合法声明中未出现为 0，出现为 1。private/no-cache 的字段限定保留于原始响应头，标记不代表完整限制范围。

只解析普通 Cache-Control 的上述六列；不解析两套 CDN 专用指令、Server-Timing、证书 SAN/详情、charset/媒体参数、Date/Expires 等被删除字段。它们在原始结果中照常保留，不为其增加固定列或专用校验。

Last-Modified 校验 HTTP-date 的语法和日历值后转 UTC，不能用宽松日期推断非法字符串。Content-Type 只提取媒体类型。Vary 按字段名语法解析，多行合并，星号单独记录。

这些是本次响应声明，不计算实际缓存寿命、剩余寿命或跳过条件。一次 HIT 不能证明这次请求之前是冷缓存，Globalping 的 HTTP 请求也不会自动请求页面依赖资源。

## 5. SQLite 与写入生命周期

使用 Node 内置 `node:sqlite`，一张 STRICT 表，WAL、`synchronous=FULL`、5 秒 busy timeout。运行代码只定义当前结构，不提供旧库兼容、迁移或动态加列。

1. 验证参数并打开当前结构的库；空库创建表和索引。
2. 提交一条 `running` 开始记录。
3. 执行一次 CLI，等待期间不持有数据库写事务。
4. 将开始记录更新为第一个节点，并在同一短事务插入其他节点；没有节点时只完成调用记录。
5. 提交成功才返回 `saved:true` 与记录 ID；事务失败整组回滚，开始记录可能仍为 running。

主键是 `id`；`(invocation_id, probe_index)` 唯一约束仅防止本次重复写入，不跨调用去重。普通索引为 `(url, measurement_created_at)`、`(url, cache_status, measurement_created_at)` 和 `(measurement_id)`。独立进程可通过 SQLite 串行提交，不建立调度队列。

```sql
SELECT url, measurement_created_at, probe_city, probe_asn,
       http_status_code, cache_status, cf_colo, total_ms, cc_max_age_seconds
FROM measurements
WHERE probe_index IS NOT NULL
  AND url = :url
  AND measurement_created_at >= :since
ORDER BY measurement_created_at DESC;
```

外层自行删除过时结果，本工具不自动清理、不覆盖已结束记录。

## 6. 输出、失败与中断

默认终端显示 URL、每节点一行摘要和入库状态。`--json` 显式输出完整返回对象，包含 `invocationId`、`measurementId`、`database`、`saved`、`collectionStatus`、`exitCode`、`recordIds`、57 列的 `records`、`errors` 和 `cliStderr`。Node 核心函数始终返回这个对象，展示选项不改变测量和入库。

默认错误输出到 stderr，折叠换行，每条正文最多展示 600 字符；JSON 和入库文本不截短。使用 `npm run --silent globalping:record -- ... --json` 可避免 npm 横幅混入 JSON。

| 情况                                              | 行为                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| 正常采集，包括目标 HTTP 错误和节点 failed/offline | 忠实保存，退出 0                                                              |
| 保留字段映射失败                                  | 保存来源、可映射字段与问题，parse_error，退出 1                               |
| CLI 启动失败、非零退出、本地超时                  | 保存已有输出和错误，cli_error，退出 1；仍解析已交付的合法节点结果             |
| JSON 无效或无节点结果                             | 保存调用记录与原始输出，不猜展示文本                                          |
| 数据库失败                                        | saved=false，退出 1，不伪称已保存                                             |
| SIGINT / SIGTERM                                  | 转发给自己的子进程，最多等 5 秒再强制终止，尽力保存已取得结果，退出 130 / 143 |
| SIGKILL / 断电                                    | 已提交历史保留，可能留下 running；不自动恢复或重测                            |

CLI 错误不能仅凭 exit 1 判断为 API 429。保存实际 stderr，不捏造 API 限流响应头，不自动等待、重试或减少节点数。目标 HTTP 429 与 Globalping API 限流分开。

本工具不取得 CLI 内部创建回执、每次轮询、连接或尚未输出的中间结果，不宣称保存了 API 已截断的数据。终止本地 CLI 不等于取消远端测量。

## 7. 实现与验证

`cli.mjs` 负责终端输出和信号，`runner.mjs` 负责参数与子进程，`probe.mjs` 串联一次调用，`parse.mjs` / `headers.mjs` 只映射保留字段，`schema.mjs` 定义 57 列，`store.mjs` 负责单表事务，`install.mjs` 安装官方 CLI。

针对性测试使用模拟 CLI 与临时 SQLite，不消耗真实额度。验证参数编码与覆盖、恰好 57 列、源结果完整保留、保留字段类型与头语法、实际 SQL 查询、历史追加、并发、回滚、默认摘要/完整 JSON、限流与取消。删除字段不再要求专用解析测试，也不保留版本查询阶段的测试。

```sh
devenv shell -- npm exec -- vitest run tests/development/globalping-recording/unit.test.ts
devenv shell -- npm run check
devenv shell -- npm run format:check
```

旧数据库不在本次实施范围内。使用新路径创建当前结构；程序不自动改写不匹配的库。不为本次独立工具改动运行站点构建或部署。
