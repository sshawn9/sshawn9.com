# sshawn9.com

Shawn 的个人网站，用于展示项目、发布博客和进行个人介绍。当前文案有意保持简短，便于决定最终保留哪些内容。

## 技术栈

- Astro 7：静态生成与官方客户端视图过渡
- Tailwind CSS 4：设计系统与响应式界面
- Astro Content Collections：具有类型约束的文章与项目内容
- Paraglide JS：类型安全的中英文界面文案
- Expressive Code：代码块渲染
- Pagefind Component UI：构建时生成的多语言全站搜索
- 基于 Kobalte 原语的小型 SolidJS 岛：文章筛选与分页
- Tocbot：文章目录及当前章节高亮
- Diff2Html 与 jsdiff：按需比较文章的完整历史版本
- `astro-seo`、`astro-seo-schema` 与 Astro 官方 sitemap 集成：页面元信息
- 浏览器原生 Popover API：菜单与展开面板
- Motion：渐进增强且尊重“减少动态效果”偏好的动画
- Cloudflare Workers Static Assets：生产环境托管
- Cloudflare Cron Triggers 与 Workers KV：定时更新 Unsplash 背景照片池

## 本地开发

```bash
npm ci
npm run dev
```

本仓库也支持由 Astro 管理的后台开发服务器：

```bash
npm run astro -- dev --background
```

完整的本地验证流程：

```bash
npm run check
npm test
npm run format:check
npm run build
npm run test:e2e
npm run preview
```

普通的 Astro 开发服务器不执行 Cloudflare Worker，因此会显示原有网格回退背景。测试完整的动态背景前，将 Unsplash Access Key 写入本地密钥文件：

```bash
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，填写 UNSPLASH_ACCESS_KEY
npm run preview:worker
```

`preview:worker` 先构建静态网站，再由 Wrangler 同时运行静态资源、照片清单接口和本地 KV。

本仓库使用 Node 24 作为经过测试的开发运行时，`.nvmrc` 记录了这一建议版本。`npm run build` 会生成静态网站及其 Pagefind 多语言全站索引。浏览器测试使用 4322 端口，因此不会干扰运行在 4321 端口的常规开发服务器。

## 国际化

英文是程序内部的基础语言。所有公开页面都使用语言前缀：

```text
/en/...
/zh/...
```

访问不带语言前缀的 `/` 时，网站会依次依据 Paraglide 保存的语言偏好、浏览器的语言偏好顺序和英文默认值选择语言。URL 中显式指定的语言决定页面的渲染语言。语言图标用于直接切换中文和英文并保存选择，界面不会额外暴露“自动”模式。

界面文案位于 `messages/en.json` 和 `messages/zh.json`。Astro 负责本地化静态路由树，Paraglide 负责具有类型约束的界面文案。Pagefind 根据页面的 `<html lang>` 属性，为每种语言分别建立索引。

## 文章内容

每篇逻辑文章都有独立目录，使 Markdown 正文与相关资源可以存放在一起。

单版本文章不需要版本目录：

```text
src/content/blog/my-article/
├── meta.yaml         # 共享的日期、标签、所属项目与发布状态
├── index.md          # 英文基础版本
├── index.en.md       # 可选的显式英文版本
├── index.zh.md       # 可选的中文版本
└── images/
```

当文章出现实质性修订后，每个不可变版本都保存为一份完整快照：

```text
src/content/blog/my-article/
├── v1/
│   ├── meta.yaml
│   ├── index.md
│   ├── index.zh.md
│   └── images/
└── v2/
    ├── meta.yaml
    ├── index.md
    ├── index.zh.md
    └── images/
```

Astro 通过专用 Content Collection 加载所有 `meta.yaml`。元信息 ID 由目录路径推导，因此相邻的 Markdown 文件不需要重复声明这一关系：

```yaml
# meta.yaml
publishedAt: 2026-07-31
tags:
  - Astro
  - Content revision
projects:
  - my-project
```

```yaml
# index.zh.md frontmatter
title: 文章标题
description: 本地化摘要
```

对于多版本文章，元信息 ID 是包含版本号的路径，例如 `my-article/v2`。因此，每个完整版本的日期、标签和草稿状态都只有一个数据源；标题、描述、修订摘要和正文则分别进行本地化。

`index.md` 是基础英文别名。如果 `index.md` 与 `index.en.md` 同时存在，则优先使用显式的英文文件。代码不会围绕不完整翻译建立复杂的禁止规则。

文章发现与语言解析是两个独立过程：

1. 发现所有逻辑文章目录。
2. 选择每篇文章最新的已发布逻辑版本。
3. 在同一版本中解析请求的语言。
4. 必要时回退到其他可用语言。
5. 在每种语言的文章列表中，每篇逻辑文章只渲染一次。

因此，缺少中文内容不会使文章从 `/zh/blog/` 消失，缺少翻译也不会导致解析器回退到旧版本。

标签是与内容语言无关的规范字符串，永远不会被翻译。标签只存在于对应版本共享的 `meta.yaml` 中。博客分类系统只读取每篇逻辑文章的最新版本，旧版本不会参与标签集合或数量统计：

```yaml
# meta.yaml
tags:
  - Astro
  - Content revision
```

可选的 `projects` 数组使用 Astro Content Collection 引用。一篇文章可以属于多个项目，只有最新的已发布版本参与项目归属关系：

```yaml
projects:
  - autonomous-driving-motion-control
  - another-project
```

## 创建文章修订版本

仓库刻意不提供修改内容目录的自动化脚本。当文章第一次发生实质性修订时，将原文章及其元信息完整保留为 `v1/` 快照，并将 `v2/` 创建为一份完整的新快照。后续修订依次增加 `v3/`、`v4/` 等目录。所有版本专属资源都应复制到对应版本目录，已经发布的旧版本目录保持不变。

`src/lib/article-convention.ts` 中的路径解析器和 `src/lib/articles.ts` 中的小型适配器是仅有的理解这套约定的代码。路由和组件消费规范化后的 `Article` 与 `ArticleVersion` 数据，而不会自行解析路径。

每篇文章只有一个规范的版本比较页面。访客打开该页面时，网站只下载当前选中的两份不可变 Markdown 快照。

## 页面与项目内容

本地化的页面文案和界面文案位于 `messages/<locale>.json`。每个项目将稳定元信息、本地化内容和未来资源存放在同一目录：

```text
src/content/projects/my-project/
├── meta.yaml       # 展示顺序与稳定的项目 ID
├── index.en.md     # 英文摘要与项目正文
├── index.zh.md     # 可选的中文摘要与项目正文
└── images/
```

`src/lib/projects.ts` 使用与文章相同的“请求语言优先、其他语言回退”规则。项目详情页首先渲染人工编写的项目正文，然后根据最新已发布文章的元信息生成相关文章列表。因此，文章标题和可选描述会遵循当前语言及其常规回退规则，不需要复制到项目 Markdown 中。

Paraglide 负责页面级文案和界面文案，长篇文章与项目记录仍由 Content Collections 管理。

## 质量验证

Vitest 覆盖文章路径、版本、语言回退和标签计数约定。Playwright 覆盖静态检查无法证明的行为，包括语言偏好、ClientRouter 下的语言与主题切换、固定标签筛选项以及按需版本比较。GitHub Actions 验证任务会执行格式检查、类型检查、单元测试、预览构建和浏览器测试。`main` 分支部署还会在发布前重新构建并测试生产版本。

## 部署

每个已推送分支都有稳定的 Worker Preview URL。`main` 分支拥有已部署的 `sshawn9-com-preview` Worker URL；其他分支使用稳定别名，且不会改变该部署。预览构建包含草稿文章、不生成 sitemap，并同时通过 HTML 与 HTTP 响应头声明 `noindex`。拉取请求执行相同的预览模式验证，但不会使用部署密钥。每次部署摘要都会提供稳定分支 URL 和不可变版本 URL。分支删除后不会主动删除其别名，旧版本也不会主动删除；它们最终由 Cloudflare 的 Preview URL 保留策略清理。

在 `main` 分支上，分别通过验证的预览产物和生产产物会在验证完成后独立部署。生产版本排除草稿并保留 sitemap；预览版本包含草稿且不会改变生产流量。`workflow_dispatch` 遵循相同的分支行为。

需要配置一个 GitHub Actions 仓库密钥：

- `CLOUDFLARE_API_TOKEN`：使用 Cloudflare 的 **Edit Cloudflare Workers** 模板创建，并限制在目标账户内的令牌
- `UNSPLASH_ACCESS_KEY`：Unsplash 应用的 Access Key，只作为 Worker 运行时密钥上传

生产 Worker 每天 18:00 UTC 更新一次照片池。更新过程搜索最新的横向自然风景候选图片，并且只有在得到足够多的有效结果后才替换现有清单；候选图片入池本身不计作下载。浏览器成功启用某张图片作为背景后，再由 Worker 异步调用该图片的 Unsplash 下载跟踪地址。更新失败时继续使用上一份清单。浏览器在每次会话中随机选择一张图片，页面切换时保持不变，长时间停留时每十分钟淡入切换一次；减少动态效果的用户不会自动轮换。

照片始终使用 Unsplash API 返回的 CDN 地址，不转存到本站。固定在页面右下角的摄影师与 Unsplash 链接用于满足 API 署名要求。搜索条件只能提高风景题材的命中率，不能提供严格的内容保证；需要绝对控制时，应将来源改为人工维护的 Unsplash Collection。

`wrangler.jsonc` 中不填写 KV ID，由 Wrangler 在生产 Worker 和预览 Worker 首次部署时分别自动配置 KV。生产环境配置每日 Cron；预览环境不创建 Cron，首次访问照片清单接口时初始化其共享照片池。

`wrangler.jsonc` 是两个隔离 Worker 环境的唯一配置来源。默认的 `sshawn9-com` Worker 通过 `sshawn9.com` 提供生产服务，不开放 `workers.dev` 或 Preview URL。`preview` 环境将包含草稿的 `main` 构建部署到 `sshawn9-com-preview`；其他分支上传带有稳定别名但不设为当前部署的版本。每次构建也会获得一个不可变版本 URL。稳定的生产自定义域映射由独立的长期 Terraform 基础设施管理。本方案不使用 Cloudflare Pages 项目，也不为每个分支创建 DNS 记录。

首次迁移资源所有权时，应先应用 `actions-private/cf-dns` 配置，并确认它已经导入现有的 `sshawn9.com` 自定义域，然后再部署本仓库中不含路由的 Wrangler 配置。

## 当前边界

- 表单、评论、身份验证及其他动态功能只在出现真实需求时添加。
