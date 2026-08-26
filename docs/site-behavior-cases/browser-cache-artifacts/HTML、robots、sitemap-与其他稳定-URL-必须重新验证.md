# 案例：HTML、robots、sitemap 与其他稳定 URL 必须重新验证

### 场景

页面及发现文件使用不会随内容变化而改变的稳定 URL。

### 正确行为

- 浏览器在复用这些响应前按缓存策略向服务器重新验证。
- 验证未变化时可使用 304 降低传输；变化时立即获得新内容。
- HTML、robots 和 sitemap 的环境差异不会被长期旧缓存掩盖。

### 禁止状态

- 对稳定 HTML 声明长期 immutable，使发布后浏览器继续显示旧页面。
- 为避免旧内容而完全禁用所有条件缓存。
- Preview 的 robots 或 noindex 响应被缓存到 Production。

### 验收

1. 连续请求代表性 HTML、robots 和 sitemap，检查条件请求及响应头。
2. 发布内容变化后使用已有浏览器缓存重访，确认得到新响应。
3. 分别检查 Preview 与 Production，确认缓存键和策略不交叉。
