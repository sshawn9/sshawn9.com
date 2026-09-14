# 构建后的 CSS 兼容前缀

- 目的：防止 CSS 压缩目标过新，把旧 iOS/WebKit 仍需要的 `-webkit-backdrop-filter` 删除。
- 触发：正常测试流程构建后，读取 `apps/site/dist` 内实际生成的全部 CSS 文件，用现有 css-tree 解析声明块。
- 预期：每条 `backdrop-filter` 在同一声明块内都有值及 `!important` 状态一致的 `-webkit-backdrop-filter`。必须实际找到滤镜声明，并明确包含页头、搜索面板和图形聚焦背景，避免空集假通过。
- 自动化覆盖：检查压缩后的真实产物，不检查源文件是否手写前缀，不固定资源 hash 或保存大体积快照。不同 CSS 文件、分组选择器及嵌套条件中的声明均逐块检查；失败列出文件、选择器和值。
- 边界：这是构建兼容性回归，虽然纳入 browser.spec.ts 流程，但不把 Chromium 当成旧 iOS 模拟器。前缀存在不代表所有 CSS/JS 已兼容 Safari 16.3；真实 iPad Safari/Chrome 上的模糊视觉、滚动与合成性能仍须实机验收。
- 运行模式：本轮仅配置 `build.cssTarget`，影响 build／preview／部署产物；`dev` 仍走原有 PostCSS 路径，不因这项配置自动补前缀，不能用它验收本项修复。
