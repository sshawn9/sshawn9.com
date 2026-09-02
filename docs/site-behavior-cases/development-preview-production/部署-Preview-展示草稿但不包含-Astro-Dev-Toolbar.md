# 案例：部署 Preview 展示草稿但不包含 Astro Dev Toolbar

### 场景

团队通过部署后的 Preview 审阅草稿，但该站点运行的是构建产物而非本地开发服务器。

### 正确行为

- Preview 的正常文章路由、列表和索引按预览规则包含草稿。
- Astro Dev Toolbar 不被构建到 Preview，也不被运行时模拟。
- 如需部署预览工具，应作为独立、明确授权的能力设计，不能冒充原生 Toolbar。

### 禁止状态

- 因看不到 Toolbar 就断言 Preview 无法展示草稿。
- 将本地 Dev Toolbar bundle 注入部署产物。
- 为统一界面而在正式布局挂载 Toolbar 仿制品。

### 验收

1. 运行实际 Worker Preview 或访问部署 Preview。
2. 确认草稿路由和列表可用，同时检查页面源和网络资源无 Dev Toolbar。
3. 与 `npm run dev` 并排比较，明确两者工具边界。
