# 案例：Preview 同时使用 HTML 与 HTTP noindex，并且不生成可索引站点地图

### 场景

部署 Preview 包含未正式发布内容，需要降低被搜索引擎收录的风险。

### 正确行为

- Preview 页面 HTML 提供 noindex 语义，HTTP 响应也提供对应机器人控制头。
- Preview 不发布可供搜索引擎发现内容路由的站点地图。
- Production 不继承 Preview 的 noindex，公开页面保持正确索引能力。

### 禁止状态

- 只在客户端水合后添加 noindex。
- Preview 仍生成包含草稿路径的 sitemap。
- 环境判断错误让 Production 全站 noindex。

### 验收

1. 对 Preview 的 HTML、文章和错误页检查源标记及响应头。
2. 请求 sitemap 与 robots 相关入口，核对预览策略。
3. 对 Production 重复检查，确认索引策略没有交叉污染。
