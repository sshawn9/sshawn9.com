# Globalping 单 URL 探测与 SQLite 存储方案

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
| `request_method`           | TEXT    | 实际传给 CLI 的方法，固定 GET                                          |
| `request_from`             | TEXT    | 请求的位置表达式或测量 ID，包含未取得节点的调用                        |
| `request_limit`            | INTEGER | 本次希望使用的节点数量                                                 |
| `measurement_probes_count` | INTEGER | 返回的 probesCount，记录实际数量，不从保留行数反推                     |
| `request_headers_json`     | TEXT    | 实际请求头参数列表，区分请求条件                                       |
| `cli_argv_json`            | TEXT    | 完整 CLI 参数数组，保存从 URL 提取的目标信息及其他测量选项             |
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
