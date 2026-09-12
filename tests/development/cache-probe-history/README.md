# 缓存探测出口历史

验证出口 IP 历史以追加 journal 为事实来源，并实时生成可替换的 JSON/Markdown 快照。测试只使用 `tests/.results` 下的临时目录，不启动网络服务、不访问线上网站；结束后清理创建的数据。

- 完整记录 run、round、request、resource、pause 与结束事件；请求开始只追加日志、不重写快照，重开可恢复 pending；每条资源结果写入后即可从单轮和汇总快照读取。
- 同一 IP 的连续完整 HIT 跨运行累计；阈值按当前运行重新判断，MISS、传输失败、colo 改变和未知结果会打断 streak，skipped 不作为新测量。
- IPv4/IPv6 历史相互隔离，IPv6 目录名不包含路径分隔风险；锁文件拒绝同目录并发写入，正常关闭后可重新打开。
- 重开时完整回放 journal，但不重写内容一致的报表；只修复缺失或落后的快照。写入失败会报错，已追加事件可在故障解除后恢复；损坏 journal 会报告文件和行号且不被悄悄改写。
- 汇总 Markdown 转义页面标题中的链接、表格与 HTML 注入字符。

运行：`devenv shell npm exec -- vitest run tests/development/cache-probe-history/unit.test.ts`。
