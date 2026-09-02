# 正式站点 v2

本目录是重构后的正式静态站点应用。M1–M4 已完成，当前处于 M4R 基座收口；在 M5 平台验收和 M6 生产切换完成前，它与现有生产应用保持独立。

## 应用边界

- Astro 生成每个 URL 的完整 HTML；正文、导航和核心链接不依赖 JavaScript 才出现。
- Astro ClientRouter 是唯一文档导航器；站点代码只协调状态、滚动、字体和页面生命周期。
- SiteShell 是持久的静态 Astro HTML，由小型 TypeScript 控制器增强，不建立全站 UI 框架根。
- 普通页面交互使用局部 DOM 控制器；复杂研究交互使用隔离的 Solid 岛。
- 内容源位于仓库根目录 `src/content/`，界面文案位于 `messages/`。
- 领域、构建、i18n 与内容交互分别由 `packages/site-domain`、`site-build`、`site-i18n` 和 `content-ui` 提供。
- 普通 HTML 和静态资源由 Cloudflare Static Assets 直接提供；根目录 `worker/` 只负责壁纸 API、KV 与 Cron。

具体决策见 `docs/rearchitecture/ADR-001-static-document-application.md` 和 `ADR-002-client-runtime-and-state-ownership.md`。

## 本地开发

从仓库根目录运行：

```bash
npm run dev
```

该命令同时启动本应用的 Astro 开发服务器和本地 Worker API。开发配置注册 `Drafts` 与 `Single-language` Toolbar，并代理 `/api`；preview 和 production 配置不导入这些开发能力。

只启动 Astro 页面与 Toolbar：

```bash
npm run dev --workspace @sshawn9/site-v2 -- --background
```

常用验证命令：

```bash
npm run check:v2
npm run build:v2
npm run test:e2e:v2
```

## 目录

```text
config/       生产与开发共享的 Astro 配置工厂
devtools/     仅开发环境导入的内容健康工具
src/content/  应用侧内容发现、解析和路由适配
src/features/ 页面功能、局部控制器与所属样式
src/runtime/  跨页面浏览器组合根和基础设施
src/styles/   token、基础元素和持久外壳样式
tests/e2e/    只能由真实浏览器证明的关键行为证据
```

用户可见行为以 `docs/site-behavior-cases/` 为准。实现不得用本 README、历史里程碑或测试细节反向修改行为。
