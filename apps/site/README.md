# 站点代码入口

本目录是 Astro 站点应用。安装、运行、测试、内容编写与部署统一见 [根 README](../../README.md)；本目录的 npm 脚本只承担内部构建和检查。

## 目录职责

```text
config/          Astro 配置、构建标识与构建集成
devtools/        仅开发环境导入的内容健康工具
public/          原样发布的静态资源及生成的壁纸启动脚本
scripts/         应用构建步骤与壁纸脚本打包
src/pages/       路由、静态页面与端点
src/layouts/     文档骨架和页面布局
src/components/  跨功能静态组件、首帧入口和文档外壳
src/content/     构建期内容发现、解析和路由适配，不存放文章正文
src/features/    页面功能的组件、控制器与所属样式
src/runtime/     跨页面浏览器组合根、导航和状态恢复
src/styles/      全局 token、字体、基础布局与级联入口
```

## 从哪里改

- 路由与文档结构：从 [BaseLayout](src/layouts/BaseLayout.astro)、`src/pages/` 和 [SiteShell](src/components/SiteShell.astro) 进入。文档交换时 Header 来自目标 HTML；只有壁纸视觉层跨文档持久化，同页视图更新不交换文档。
- 页面交互：在所属 `src/features/<功能>/` 中修改，由 [PageRuntime](src/runtime/page-runtime.ts) 挂载、销毁；跨页生命周期由 [SiteRuntime](src/runtime/site-runtime.ts) 组合。复杂研究交互位于根目录 `packages/content-ui/`。
- 内容：正文与媒体在根目录 `content/`，本目录 `src/content/` 只作应用适配；纯内容规则在 `packages/site-domain/`。Astro 构建适配位于 [content.config.ts](src/content.config.ts) 和 [markdown.ts](config/markdown.ts)，Git 适配位于 [git-last-modified.ts](src/content/git-last-modified.ts)。界面消息在根目录 `messages/`，i18n 接线在 `packages/site-i18n/`。
- 构建与本地服务：[共享配置](config/create-site-config.mjs) 定义站点构建，[本地配置](astro.local.config.mjs) 只补充 dev/preview 的代理和开发工具。壁纸 API 实现在根目录 `worker/`，不属于浏览器运行时。

边界的设计理由见 [静态文档架构](../../docs/rearchitecture/ADR-001-static-document-application.md) 与 [运行时状态所有权](../../docs/rearchitecture/ADR-002-client-runtime-and-state-ownership.md)。
