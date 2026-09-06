# 搜索输入法组合

- 目的：避免 IME 组合中的中间文本触发查询，组合确认后才提交。
- 触发：合成 compositionstart/fill，等待超过 debounce，再触发 compositionend。
- 预期：组合期间 URL/结果保留旧 query；结束后提交新 query 并清除 busy。
- 自动化覆盖：覆盖一次合成事件序列。
- 盲区：使用程序化事件，不等同于各平台真实 IME 的完整事件顺序。
