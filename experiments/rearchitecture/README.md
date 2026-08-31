# 全站重构垂直切片

本目录同时验证两个互不依赖的候选：

- `apps/astro`：Astro SSG + ClientRouter + 静态 Astro 持久外壳 + 独立 Svelte 交互岛；
- `apps/qwik`：Qwik City SSG + Qwik Router。

它们共享的只有内容 fixture、视觉 token 和测试契约，不共享浏览器运行时代码。两个应用都可以独立删除，不影响生产站点。

## 使用

在本目录运行 `npm install`、`npm run build`、`npm run measure` 和 `npm run test`。

`npm run test` 最后会额外构建 `generation-a` 与 `generation-b` 两份 Astro 产物，并在独立服务器中模拟部署切换。该测试验证旧运行时不接管新文档、资产不混代、同代持久导航恢复、跨文档历史边界的状态恢复，以及延迟 CSS/字体时只呈现完整 A 或完整 B 的连续帧。可用 `npm run test:e2e:cross-generation` 单独运行这一组。

`npm run measure` 读取两份已经完成的构建，生成 `reports/build-metrics.json`。报告使用同一压缩参数，并列出任何包含正文探针的 JavaScript/JSON 资产。

`npm run fixtures` 会生成两份框架原生的长文章源码。正文以静态路由标记编写，而不是作为客户端 JSON 对象导入；共享门禁会继续检查框架是否把它复制进导航载荷。生成的路由源码和构建产物均不提交。

当前验证结论和已知边界见 [`RESULTS.md`](./RESULTS.md)。

## 约束

- 不导入现有 Swup、全局事件总线、nanostore 或页面控制器；
- 不修改根目录依赖、生产入口、Worker 或 Cloudflare 配置；
- 先通过共享行为门槛，再比较性能；
- 本目录中的探针只服务 POC，不得原样迁移到生产 bundle。
