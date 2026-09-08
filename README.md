# sshawn9.com

Shawn 的个人网站，用于展示项目、发布博客和个人介绍。站点应用位于 `apps/site/`。

本文件说明开发、内容编写和部署；代码入口见 [应用目录说明](apps/site/README.md)，架构理由见 [ADR-001](docs/rearchitecture/ADR-001-static-document-application.md) 和 [ADR-002](docs/rearchitecture/ADR-002-client-runtime-and-state-ownership.md)。平台验收与回滚门槛单独记录在 [迁移与回滚计划](docs/rearchitecture/MIGRATION.md)。

## 技术栈

- Astro：静态生成与官方 ClientRouter
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
npm ci
npm exec -- playwright install chromium
```

direnv 通过 `use devenv` 加载环境，不需要 nix-direnv。Node 大版本由 `.nvmrc` 决定，具体工具版本由环境锁文件固定；项目依赖和测试浏览器显式安装，进入目录不启动服务。不使用 direnv 时运行 `devenv shell`，非交互任务使用 `devenv shell npm test` 等原有 npm 命令。不使用 Nix 时也可自行准备对应 Node 和系统依赖，直接使用 npm。

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

Playwright 由 npm 锁定和升级，浏览器由其官方安装器下载，不使用 nixpkgs 的 Playwright/browser 包。首次测试或升级 Playwright 后执行上表的浏览器安装命令；`npm ci` 不隐式安装浏览器。NixOS 的加载器、运行库及依赖检查适配集中在 `devenv.nix`；Ubuntu CI 使用 `playwright install --with-deps chromium` 安装宿主系统库。`PLAYWRIGHT_CHROME_PATH` 可用于人工对照已有 Chrome，环境验收使用默认下载的浏览器。

测试内部服务器由 Playwright 启停，默认端口 `4399`（可用 `PLAYWRIGHT_PORT` 覆盖），不复用已有服务器，也不是人工预览入口。测试集中在 `tests/<功能>/<案例>/`，每个案例的 Markdown 说明与单元或浏览器测试放在一起。

完整验证为 `npm run format:check`、`npm run check`、`npm test`。[CI](.github/workflows/verify.yml) 在 devenv 环境内执行同一套 npm 命令，并分别验证所需的 Preview／Production 产物。环境依赖使用 `devenv update` 更新，JS 依赖使用 npm 更新，验证后提交对应锁文件。devenv CLI 是宿主工具，由系统或 CI 安装，不受项目锁文件固定。

构建标识由应用自动生成，无需手动设置 `SITE_BUILD_ID`。CI 部署直接使用测试过的产物，不再次构建；标识与缓存的关系见 [缓存说明](docs/cloudflare-browser-cache.md)。

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
content/blog/my-article/
├── meta.yaml         # 共享的日期、标签、所属项目与发布状态
├── index.md          # 英文基础版本
├── index.en.md       # 可选的显式英文版本
├── index.zh.md       # 可选的中文版本
└── images/
```

当文章出现实质性修订后，每个不可变版本都保存为一份完整快照：

```text
content/blog/my-article/
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

当文章第一次发生实质性修订时，将原文章及其元信息完整保留为 `v1/` 快照，并将 `v2/` 创建为一份完整的新快照。后续修订依次增加 `v3/`、`v4/` 等目录。所有版本专属资源都应复制到对应版本目录，已经发布的旧版本目录保持不变。

`packages/site-domain/src/article-convention.ts` 定义路径约定，`apps/site/src/content/` 负责把 Astro 内容条目适配成页面所需的数据。路由和组件消费规范化后的文章与版本数据，不自行解析路径。

每篇文章只有一个规范的版本比较页面。访客打开该页面时，网站只下载当前选中的两份不可变 Markdown 快照。

## 页面与项目内容

本地化的页面文案和界面文案位于 `messages/<locale>.json`。每个项目将稳定元信息、本地化内容和未来资源存放在同一目录：

```text
content/projects/my-project/
├── meta.yaml       # 展示顺序与稳定的项目 ID
├── index.en.md     # 英文摘要与项目正文
├── index.zh.md     # 可选的中文摘要与项目正文
└── images/
```

`packages/site-domain/src/projects.ts` 定义项目解析规则，`apps/site/src/content/project-catalog.ts` 负责当前应用的数据适配。项目详情页首先渲染人工编写的项目正文，然后根据最新已发布文章的元信息生成相关文章列表。

Paraglide 负责页面级文案和界面文案，长篇文章与项目记录仍由 Content Collections 管理。

## 部署

以下描述仓库的 [工作流配置](.github/workflows/site.yml)，不代表已完成线上平台验收：

- 分支推送或手动触发：验证后发布 Preview；`main` 更新 `sshawn9-com-preview` 的当前部署，其他分支只上传带稳定别名的版本。部署摘要提供稳定分支 URL 和不可变版本 URL。
- `main` 还会独立验证并部署 Production；拉取请求只验证 Preview，不使用部署密钥。
- Preview 包含草稿、不生成 sitemap，并在 HTML 和 `_headers` 中声明 `noindex`；Production 排除草稿并生成 sitemap。工作流不主动清理已删除分支的预览别名。

需要配置以下 GitHub Actions 仓库密钥：

- `CLOUDFLARE_API_TOKEN`：具备目标账户 Worker 部署权限的令牌
- `UNSPLASH_ACCESS_KEY`：Unsplash 应用的 Access Key，只作为 Worker 运行时密钥上传

`wrangler.jsonc` 声明 Production 与 Preview 两个 Worker 环境及各自的 KV 绑定，KV ID 由 Wrangler 配置。普通页面与资源走 Static Assets，只有壁纸 API 优先进入 Worker。生产配置关闭 `workers.dev`，但两个环境的 `preview_urls` 均为 `true`；不能据此认定生产版本 URL 已关闭，也不能据此推断线上 Access 保护状态。生产域名绑定不由当前 Wrangler 文件声明，部署前需确认外部域名配置与目标 Worker 一致。

### 景观壁纸

生产照片池按 [`wrangler.jsonc`](wrangler.jsonc) 的 Cron 更新，当前每三小时一次；Preview 不配置 Cron。[Worker](worker/index.ts) 合并新候选与已有照片，验证后写入清单；更新失败保留旧清单，内容未变时不改写。照片池为空时 API 返回 503，不会因首次或重复访问自动初始化。

浏览器按标签页维护当前／下一张照片，站内导航不换图。自动轮换在当前照片淡化完成后重新计时，范围由 [壁纸模型](apps/site/src/features/appearance/wallpaper/model.ts) 定义，当前为随机 5–9 分钟；后台补图不改变已有计时。关闭自动轮换、页面隐藏或启用减少动态效果时不自动换图。

图片从 Unsplash CDN 获取，不转存到本站。浏览器报告图片的实际使用或下载，Worker 调用对应的 Unsplash 下载跟踪接口；页面保留摄影师与 Unsplash 署名链接。搜索条件不能严格保证照片题材。
