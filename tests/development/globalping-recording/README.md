# Globalping 单 URL / 57 列 SQLite 验收

使用临时目录中的模拟 CLI 与真实 SQLite；命令行展示测试在临时项目中运行真实入口。结束后清理测试数据，不访问 Globalping 或生产站。

- 参数数组、单 URL、编码路径、重复查询、IPv6 和端口覆盖；每次只有一个 HTTP 测量子进程。
- 恰好 57 列、保留字段的类型/NULL/0/false、失败与离线；完整源对象及数值字面量不变。已删除字段没有专用解析，原值仍归档。
- 六个 Cache-Control 字段、Last-Modified、媒体类型、Vary、缓存状态、Age 与机房；覆盖多行、引用字符串、重复冲突及非法值。
- 默认节点摘要、显式完整 JSON、错误与入库失败展示；正文与证书通过源 JSON 保留，两种展示不改变测量参数。
- 实际 SQL 筛选、N 节点 N 行、历史追加、独立进程并发、事务回滚、拒绝不匹配的数据库。
- 限流文本、网站 429、非法 UTF-8/JSON、启动失败、超时和 SIGINT/SIGTERM；强制终止保留已提交记录，不自动重测。

`fixture.mjs` 保留丰富的合成 API 源对象，用于验证未列化的数据仍完整归档。没有旧数据库兼容或迁移测试。

运行：`devenv shell -- npm exec -- vitest run tests/development/globalping-recording/unit.test.ts`。
