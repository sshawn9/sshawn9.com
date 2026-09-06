# sshawn9.com

Shawn 的个人网站，用于展示项目、发布博客和个人介绍。当前分支只有一套站点应用；历史实现不再留在工作树中，需要对照时从 Git 历史读取。

## 技术栈

- Astro 7：静态生成与官方 ClientRouter
- Astro Content Collections：具有类型约束的文章与项目内容
- Paraglide JS：类型安全的中英文界面文案
- Pagefind Component UI：构建时生成的多语言全站搜索
- 按功能归属的 CSS 与 TypeScript 控制器：布局、导航、列表和目录增强
- 隔离的 SolidJS 岛：研究图形与复杂局部交互
- Diff2Html 与 jsdiff：按需比较文章的完整历史版本
- PhotoSwipe：文章图片查看器
- Astro 官方 sitemap 集成：生产站点地图
- 浏览器原生 Popover API：菜单与展开面板
- Cloudflare Workers Static Assets：生产环境托管
- Cloudflare Cron Triggers 与 Workers KV：定时更新 Unsplash 背景照片池

## 本地开发

本地和 CI 共用 devenv 原生环境：`devenv.nix` 定义工具与运行库，`devenv.yaml` 沿用官方默认来源，`devenv.lock` 由 CLI 管理。机器需要安装 Nix、devenv 和 direnv，并启用 direnv 的 shell hook。当前面向 `x86_64-linux` 的 NixOS 与 Ubuntu；NixOS 还需在系统配置中启用 `programs.nix-ld.enable = true`。

```sh
direnv allow
just install
just browser-install
```

direnv 通过 `use devenv` 加载环境，不需要 nix-direnv。Node 大版本由 `.nvmrc` 决定；JavaScript 模块其余行为沿用默认值，包括提供 TypeScript Language Server、不自动安装项目依赖。进入目录不下载测试浏览器、不启动服务。不使用 direnv 时运行 `devenv shell`，非交互任务使用 `devenv shell npm test` 等原有 npm 命令。不使用 Nix 时仍可自行安装 Node 24 及所需系统依赖，直接使用 npm。

根目录 `package.json` 定义完整日常流程，运行 `npm run` 查看命令。`justfile` 只是可选的外部快捷入口，逐项转发下表命令；不安装 just 也能完成全部操作。

| npm 入口                                  | 能力                                                     | 可选快捷入口           |
| ----------------------------------------- | -------------------------------------------------------- | ---------------------- |
| `npm ci`                                  | 按锁文件安装依赖                                         | `just install`         |
| `npm exec -- playwright install chromium` | 按需安装测试浏览器                                       | `just browser-install` |
| `npm run dev`                             | 热更新、Dev Toolbar、线上壁纸 API；搜索使用静态回退      | `just dev`             |
| `npm run preview`                         | 先构建，再预览完整页面与 Pagefind 搜索；壁纸使用线上 API | `just preview`         |
| `npm run worker:dev`                      | 仅调试本地 Worker API，不启动站点                        | `just worker-dev`      |
| `npm run build`                           | 只生成 `apps/site/dist/` 部署产物，不启动服务            | `just build`           |
| `npm test`                                | 单测 → 一次构建 → 浏览器测试，不必先 build               | `just test`            |
| `npm run check`                           | 工作区和根项目类型检查                                   | `just check`           |
| `npm run format`                          | 使用项目锁定的 Prettier 格式化                           | `just fmt`             |
| `npm run format:check`                    | 只检查格式                                               | `just fmt-check`       |

`dev` 在 `http://127.0.0.1:4332` 提供热更新页面，`preview` 在 `http://127.0.0.1:4333` 提供构建后的页面；两者均通过 `apps/site/astro.local.config.mjs` 将 `/api/wallpapers` 及其下载上报接口代理至 `https://sshawn9.com`，真正的图片仍从 Unsplash CDN 获取。日常页面开发不启动本地 Worker，不需要本地 KV 或 Unsplash 密钥，但壁纸依赖网络和线上 API 可用性。应用目录的 npm 脚本仅承担内部构建和检查。

只有修改 Worker 本身时才运行 `npm run worker:dev`（默认端口 `8787`，可用 `SITE_WORKER_PORT` 覆盖）。它使用本地 Wrangler 数据与 `.dev.vars` 的 `UNSPLASH_ACCESS_KEY`；空照片池仍返回 503，不会自动填充。页面需要联调本地 Worker 时，可显式使用 `SITE_WALLPAPER_API_ORIGIN=http://127.0.0.1:8787 npm run dev`，该覆盖对 `preview` 同样有效。

日常预览由 Astro 提供产物，不模拟 Cloudflare 的 `_headers`、Access 等平台规则；这些规则仍需在 Cloudflare 部署环境验证。默认构建配置不包含本地代理，也不改变线上 API 的访问权限。

`dev`、`preview`、`test` 默认使用 `preview` 内容模式（含草稿、`noindex`），`build` 默认使用 `production`。需要覆盖时使用同一个 `SITE_MODE` 环境变量，例如 `SITE_MODE=production npm run preview`、`SITE_MODE=production npm test` 或 `SITE_MODE=preview npm run build`；它只决定站点内容，不切换云端 Worker 环境。`dev` 独有的 `Drafts` Toolbar 列出草稿，`Single-language` 列出缺少语言版本的文章；验证完整搜索使用 `npm run preview`。

所有服务前台运行，用 Ctrl-C 结束；开发的壁纸脚本监听与 Astro 两个子进程由 `concurrently` 统一启停。手动调整页面端口可用 `SITE_PORT=4334 npm run dev` 或 `SITE_PORT=4335 npm run preview`。这些环境变量对 just 转发同样有效。工作区的生成目录与构建产物共享，不并行构建、测试，也不重建正在使用的预览产物；优先复用已有开发服务，谁启动谁负责停止。

Playwright 由 npm 锁定和升级，Chromium 及 headless shell 由其官方安装器下载，不使用 nixpkgs 的 Playwright/browser 包。首次测试或升级 Playwright 后执行 `just browser-install`；`npm ci` 不隐式安装浏览器。NixOS 下，`NIX_LD`、`NIX_LD_LIBRARY_PATH` 提供加载器和运行库，devenv 的 `scripts.ldd` 让 Playwright 的依赖检查使用同一组库，不全局导出 `LD_LIBRARY_PATH`。Ubuntu CI 使用官方 `playwright install --with-deps chromium` 安装宿主系统库，`ldd` 直接委托 `/usr/bin/ldd`。需要人工对照时仍可通过 `PLAYWRIGHT_CHROME_PATH` 指定已有 Chrome，但环境验收应使用默认下载的浏览器。

测试内部服务器由 Playwright 启停，默认端口 `4399`（可用 `PLAYWRIGHT_PORT` 覆盖），不复用已有服务器，也不是人工预览入口。既有测试场景和数据模拟保持不变，不另设 `test:e2e` 公开命令。

完整验证为 `npm run format:check`、`npm run check`、`npm test`。CI 先安装 Nix 和 devenv，再通过默认 devenv shell 执行这套 npm 命令，不依赖 just，也不另建任务流程。环境依赖使用 `devenv update` 更新，JS 依赖使用 npm 更新，验证后提交对应锁文件。CLI 是宿主工具，不受项目锁文件固定；本地由系统管理，CI 使用官方安装入口 `nix profile add nixpkgs#devenv`，不要求 CLI 与模块版本号相同。

构建配置自动生成 `SITE_BUILD_ID`，并将同一个 UUID 写入 HTML、客户端代码和搜索配置，不依赖外部传值，也不关联版本号。测试从待测产物读取标识；预览和部署直接使用已有产物。CI 直接上传测试过的产物，不重复构建；部署仍由现有 GitHub Actions 负责。

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

`packages/site-domain/src/article-convention.ts` 定义路径约定，`apps/site/src/content/` 负责把 Astro 内容条目适配成页面所需的数据。路由和组件消费规范化后的文章与版本数据，不自行解析路径。

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

`packages/site-domain/src/projects.ts` 定义项目解析规则，`apps/site/src/content/project-catalog.ts` 负责当前应用的数据适配。项目详情页首先渲染人工编写的项目正文，然后根据最新已发布文章的元信息生成相关文章列表。

Paraglide 负责页面级文案和界面文案，长篇文章与项目记录仍由 Content Collections 管理。

## 部署

每个已推送分支都有稳定的 Worker Preview URL。`main` 分支拥有已部署的 `sshawn9-com-preview` Worker URL；其他分支使用稳定别名，且不会改变该部署。预览构建包含草稿文章、不生成 sitemap，并同时通过 HTML 与 HTTP 响应头声明 `noindex`。拉取请求执行相同的预览模式验证，但不会使用部署密钥。每次部署摘要都会提供稳定分支 URL 和不可变版本 URL。分支删除后不会主动删除其别名，旧版本也不会主动删除；它们最终由 Cloudflare 的 Preview URL 保留策略清理。

在 `main` 分支上，分别通过验证的预览产物和生产产物会在验证完成后独立部署。生产版本排除草稿并保留 sitemap；预览版本包含草稿且不会改变生产流量。`workflow_dispatch` 遵循相同的分支行为。

需要配置一个 GitHub Actions 仓库密钥：

- `CLOUDFLARE_API_TOKEN`：使用 Cloudflare 的 **Edit Cloudflare Workers** 模板创建，并限制在目标账户内的令牌
- `UNSPLASH_ACCESS_KEY`：Unsplash 应用的 Access Key，只作为 Worker 运行时密钥上传

生产 Worker 每天 18:00 UTC 更新一次照片池。更新过程搜索最新的横向自然风景候选图片，并且只有在得到足够多的有效结果后才替换现有清单；候选图片入池本身不计作下载。浏览器成功启用某张图片作为背景后，再由 Worker 异步调用该图片的 Unsplash 下载跟踪地址。更新失败时继续使用上一份清单。浏览器在每次会话中随机选择一张图片，页面切换时保持不变，长时间停留时每十分钟淡入切换一次；减少动态效果的用户不会自动轮换。

照片始终使用 Unsplash API 返回的 CDN 地址，不转存到本站。固定在页面右下角的摄影师与 Unsplash 链接用于满足 API 署名要求。搜索条件只能提高风景题材的命中率，不能提供严格的内容保证；需要绝对控制时，应将来源改为人工维护的 Unsplash Collection。

`wrangler.jsonc` 中不填写 KV ID，由 Wrangler 在生产 Worker 和预览 Worker 首次部署时分别自动配置 KV。生产环境配置 Cron；预览环境不创建 Cron。照片池为空时接口返回 503，不会因首次或重复访问自动初始化。

`wrangler.jsonc` 是两个隔离 Worker 环境的唯一配置来源。默认的 `sshawn9-com` Worker 通过 `sshawn9.com` 提供生产服务，不开放 `workers.dev` 或 Preview URL。`preview` 环境将包含草稿的 `main` 构建部署到 `sshawn9-com-preview`；其他分支上传带有稳定别名但不设为当前部署的版本。每次构建也会获得一个不可变版本 URL。稳定的生产自定义域映射由独立的长期 Terraform 基础设施管理。本方案不使用 Cloudflare Pages 项目，也不为每个分支创建 DNS 记录。

首次迁移资源所有权时，应先应用 `actions-private/cf-dns` 配置，并确认它已经导入现有的 `sshawn9.com` 自定义域，然后再部署本仓库中不含路由的 Wrangler 配置。
