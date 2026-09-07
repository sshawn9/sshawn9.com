# 正式站点应用

本目录是当前分支唯一的正式静态站点应用。M1–M4 已完成，当前处于 M4R 基座收口；历史实现只保留在 Git 历史和已部署的 Cloudflare 版本中。

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

该命令启动壁纸脚本监听与 Astro 开发服务器，不启动本地 Worker。本地配置 `astro.local.config.mjs` 供 dev/preview 共用，将壁纸 API 代理到线上；`Drafts` 与 `Single-language` Toolbar 仅在 dev 启用，生产构建不导入本地配置。

常用验证命令：

```bash
npm run check
npm test
```

`npm test` 已包含构建。`npm run preview` 构建后提供完整搜索，并通过相同代理使用线上壁纸 API；开发模式只有搜索静态回退。修改 Worker 时才需要根目录的 `npm run worker:dev`。安装、格式化、内容模式、API 来源及端口设置见根目录 README。根 `package.json` 定义流程，`justfile` 只作可选转发；本目录不另设页面独立运行入口。

## 目录

```text
config/       生产与开发共享的 Astro 配置工厂
devtools/     仅开发环境导入的内容健康工具
src/content/  应用侧内容发现、解析和路由适配
src/features/ 页面功能、局部控制器与所属样式
src/runtime/  跨页面浏览器组合根和基础设施
src/styles/   token、基础元素和持久外壳样式
```

测试集中在根目录 `tests/<功能>/<案例>/`，每个案例的说明与单元或浏览器测试放在一起。

用户可见行为以当前确认的需求为准，测试及同目录说明记录验证依据与盲区；不得用本 README、历史里程碑或测试细节反向修改需求。
