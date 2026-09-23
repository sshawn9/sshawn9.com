# sshawn9.com

Shawn 的个人网站，用于展示项目、发布博客和个人介绍。站点应用位于 `apps/site/`。

本文件说明开发、内容编写和部署；代码入口见 [应用目录说明](apps/site/README.md)，架构理由见 [ADR-001](docs/rearchitecture/ADR-001-static-document-application.md) 和 [ADR-002](docs/rearchitecture/ADR-002-client-runtime-and-state-ownership.md)。平台验收与回滚门槛单独记录在 [迁移与回滚计划](docs/rearchitecture/MIGRATION.md)。

## 技术栈

- Astro：静态生成与官方 ClientRouter
- Astro Content Collections：具有类型约束的文章与项目内容
- Paraglide JS：类型安全的中英文界面文案
- Pagefind：构建时生成的多语言全站搜索，本站界面直接调用查询 API
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

项目要求 Node 24 或更高版本；devenv 继续使用 `.nvmrc` 指定的 Node 24，不为旧版本增加 TypeScript 加载器。

```sh
direnv allow
npm ci
npm exec -- playwright install chromium
```

direnv 通过 `use devenv` 加载环境，不需要 nix-direnv。Node 大版本由 `.nvmrc` 决定，具体工具版本由环境锁文件固定；项目依赖和测试浏览器显式安装，进入目录不启动服务。不使用 direnv 时运行 `devenv shell`，非交互任务使用 `devenv shell npm test` 等原有 npm 命令。不使用 Nix 时也可自行准备对应 Node 和系统依赖，直接使用 npm。

根目录 `package.json` 定义完整日常流程，运行 `npm run` 查看命令。`justfile` 只是可选的外部快捷入口，逐项转发下表命令；不安装 just 也能完成全部操作。

| npm 入口                                  | 能力                                                       | 可选快捷入口           |
| ----------------------------------------- | ---------------------------------------------------------- | ---------------------- |
| `npm ci`                                  | 按锁文件安装依赖                                           | `just install`         |
| `npm exec -- playwright install chromium` | 按需安装测试浏览器                                         | `just browser-install` |
| `npm run dev`                             | 热更新、Dev Toolbar、线上壁纸 API；搜索使用静态回退        | `just dev`             |
| `npm run preview`                         | 先构建，再预览完整页面与 Pagefind 搜索；壁纸使用线上 API   | `just preview`         |
| `npm run worker:dev`                      | 仅调试本地 Worker API，不启动站点                          | `just worker-dev`      |
| `npm run build`                           | 只生成 `apps/site/dist/` 部署产物，不启动服务              | `just build`           |
| `npm run inventory`                       | 分析已有构建，导出页面、资源和双向对应清单；不构建、不联网 | `just inventory`       |
| `npm run inventory:diff`                  | 校验两份生产清单，离线比较页面和资源 URL 的增减            | —                      |
| `npm run cache:probe`                     | 读取线上生产部署清单探测缓存，按出口 IP 保留轮次及增量汇总 | `just cache-probe`     |
| `npm run globalping:install`              | 通过 Go 安装或更新官方最新 Globalping CLI                  | —                      |
| `npm run globalping:record`               | 官方 CLI 探测单个 URL，每节点解析结果追加到单表 SQLite     | —                      |
| `npm test`                                | 单测 → 一次构建 → 浏览器测试，不必先 build                 | `just test`            |
| `npm run check`                           | 工作区和根项目类型检查                                     | `just check`           |
| `npm run format`                          | 使用项目锁定的 Prettier 格式化                             | `just fmt`             |
| `npm run format:check`                    | 只检查格式                                                 | `just fmt-check`       |

`dev` 在 `http://127.0.0.1:4332` 提供热更新页面，`preview` 在 `http://127.0.0.1:4333` 提供构建后的页面；两者均通过 `apps/site/astro.local.config.mjs` 将 `/api/wallpapers` 及其下载上报接口代理至 `https://sshawn9.com`，真正的图片仍从 Unsplash CDN 获取。日常页面开发不启动本地 Worker，不需要本地 KV 或 Unsplash 密钥，但壁纸依赖网络和线上 API 可用性。应用目录的 npm 脚本仅承担内部构建和检查。

只有修改 Worker 本身时才运行 `npm run worker:dev`（默认端口 `8787`，可用 `SITE_WORKER_PORT` 覆盖）。它使用本地 Wrangler 数据与 `.dev.vars` 的 `UNSPLASH_ACCESS_KEY`；空照片池仍返回 503，不会自动填充。页面需要联调本地 Worker 时，可显式使用 `SITE_WALLPAPER_API_ORIGIN=http://127.0.0.1:8787 npm run dev`，该覆盖对 `preview` 同样有效。

日常预览由 Astro 提供产物，不模拟 Cloudflare 的 `_headers`、Access 等平台规则；这些规则仍需在 Cloudflare 部署环境验证。默认构建配置不包含本地代理，也不改变线上 API 的访问权限。

`dev`、`preview`、`test` 默认使用 `preview` 内容模式（含草稿、`noindex`），`build` 默认使用 `production`。需要覆盖时使用同一个 `SITE_MODE` 环境变量，例如 `SITE_MODE=production npm run preview`、`SITE_MODE=production npm test` 或 `SITE_MODE=preview npm run build`；它只决定站点内容，不切换云端 Worker 环境。`dev` 独有的 `Drafts` Toolbar 列出草稿，`Single-language` 列出缺少语言版本的文章；验证完整搜索使用 `npm run preview`。

所有服务前台运行，用 Ctrl-C 结束；Astro 同时负责壁纸脚本的按需编译与依赖监听，不需要独立编译或监听进程。手动调整页面端口可用 `SITE_PORT=4334 npm run dev` 或 `SITE_PORT=4335 npm run preview`。这些环境变量对 just 转发同样有效。工作区的生成目录与构建产物共享，不并行构建、测试，也不重建正在使用的预览产物；优先复用已有开发服务，谁启动谁负责停止。

Playwright 由 npm 锁定和升级，浏览器由其官方安装器下载，不使用 nixpkgs 的 Playwright/browser 包。全套浏览器测试通过 `channel: 'chromium'` 使用随附完整 Chromium 的无界面模式，不使用默认 headless shell；后者在目录新标签测试中出现过导航事件缺失。首次测试或升级 Playwright 后执行上表的浏览器安装命令；`npm ci` 不隐式安装浏览器。NixOS 的加载器、运行库及依赖检查适配集中在 `devenv.nix`；Ubuntu CI 使用 `playwright install --with-deps chromium` 安装宿主系统库。`PLAYWRIGHT_CHROME_PATH` 可用于人工对照已有 Chrome，环境验收使用默认下载的浏览器。

测试内部服务器由 Playwright 启停，默认端口 `4399`（可用 `PLAYWRIGHT_PORT` 覆盖），不复用已有服务器，也不是人工预览入口。测试集中在 `tests/<功能>/<案例>/`，每个案例的 Markdown 说明与单元或浏览器测试放在一起。

完整验证为 `npm run format:check`、`npm run check`、`npm test`。[站点验证工作流](.github/workflows/site-validation.yml) 在 devenv 环境内执行同一套 npm 命令，并分别验证所需的 Preview／Production 产物。环境依赖使用 `devenv update` 更新，JS 依赖使用 npm 更新，验证后提交对应锁文件。devenv CLI 是宿主工具，由系统或 CI 安装，不受项目锁文件固定。

构建标识由应用自动生成，无需手动设置 `SITE_BUILD_ID`。CI 部署直接使用测试过的产物，不再次构建；标识与缓存的关系见 [缓存说明](docs/cloudflare-browser-cache.md)。

搜索通过 [构建集成](apps/site/config/search-index.mjs) 调用 Pagefind 官方 Node API，在 Astro 页面和站点地图生成后写入 `dist/pagefind`；索引失败会使构建失败，后台进程在结束时关闭。搜索构建参数集中在该文件，不再自动读取 Pagefind CLI 配置文件或 `PAGEFIND_*` 环境变量；当前使用默认参数，`dev` 的静态搜索回退不变。

最后，`build` 在 `.astro/resource-inventory-build.json` 保存最终产物的文件名单、SHA-256 和客户端依赖信息（位于应用目录，不会部署）。之后运行 `npm run inventory`，在 `apps/site/.reports/` 同时生成 `resource-inventory.json` 和供人阅读的 `resource-inventory.md`，包含 `pages`、`resources`、`pageResources`、`resourcePages` 四部分及构建标识。Markdown 提供概览、索引和可折叠的双向对应关系，适合在 IDE 的 Markdown 预览中阅读；两种格式来自同一次分析。任何产物缺失、新增、内容改变，或字体规则与记录不符时都会报错，包括搜索分片和部署响应头；不会自动构建或请求线上网站。异地分析须使用对应代码、同一次构建的 `dist` 和这份构建信息；本地校验不等于验证远端部署。

分析失败时保留上一次报告。分析成功后先写完两个临时文件，再逐个原子替换正式文件；两个文件不构成文件系统事务，若进程在替换期间异常终止，应重新运行 `npm run inventory`。

对应关系是一份页面关联资源集合，不按首次加载、延迟加载或交互时机分栏。大小图、响应式变体、页面交互脚本和版本数据都归入所属页面；图片查看器只归入有可放大图片的文章。字体按本站字体规则、页面文字、固定交互文字及 CSS `unicode-range` 筛选，同时保留声明的回退字体和格式备选，因此不是一次访问的精确请求记录。搜索只关联当前语言的已构建索引和全部结果数据，不模拟不同查询，不纳入目标文章资源或备用搜索 UI；自由输入对应字体保留完整字符覆盖。随机壁纸图片、第三方 iframe 内部及无法静态确定的运行时地址仍不在保证范围。反向清单由正向清单派生；没有找到引用的资源不等于可删除。

大小统计包含资源的 `bytes`（原始字节）和 `brotliBytes`，以及全站 `sizeTotals`、每页 `pageSizeTotals`。Brotli 使用 Node 内置实现的默认参数，参数与适用扩展名记录在报告的 `compression` 中；对文本、WASM、TTF/OTF 逐文件计算，图片、WOFF/WOFF2、Pagefind 压缩数据等保留原大小，不生成额外部署文件。合计按物理文件去重，全站包含未被页面引用的构建资源；未知项单独计数，Markdown 显示 `+ N unknown`，JSON 的 `knownBytes`／`knownBrotliBytes` 只表示已知部分。这里统计的是资源集合体积，不是 Cloudflare 实测传输量或用户单次访问流量。

### 单机缓存探测

`cache:probe` 每次运行开始时下载一次 `https://sshawn9.com/resource-inventory.json`，整个运行使用这份生产部署清单，不构建、不爬取页面、不清缓存，也不更改部署。下载失败或内容无效就报错，不回退到本地清单。可用 `--inventory PATH|URL` 显式指定本地文件或 HTTP(S) 地址；不要求运行机器上有 `dist`，也不需要 GitHub 凭据。使用项目 Node 环境与 npm 安装的 Undici，只探测清单内的本站资源（包含 HTML），完整保留查询参数；外站资源单独列为未探测项。没有接入 GitHub Actions 自动预热或 Globalping。

生产 CI 在构建和测试通过后运行 `npm run inventory`，再把 JSON 放进同一份 `dist` 部署产物。清单与网站一起切换生产版本，不另维护“最新 CI 产物”指针；失败的构建或尚未上线的产物不会通过该生产地址提供。清单地址设置 `Cache-Control: no-store`，不复用客户端保存的旧清单；Cloudflare 的静态资源与 Worker 随同一次部署发布，见[官方说明](https://developers.cloudflare.com/workers/static-assets/#how-it-works)。清单是打包时附加的部署元数据，不把自身列为待预热资源；本地 `inventory` 命令仍只生成 `.reports` 报告。

```sh
npm run cache:probe
npm run cache:probe -- --hit-streak 3 --max-attempts 8
just cache-probe --concurrency 1
npm run cache:probe -- --inventory /path/to/deployed-resource-inventory.json
```

每个资源在该出口 IP 下最近连续 N 次实际探测均完整下载、HTTP 状态符合预期、`CF-Cache-Status` 为 `HIT`，且 `CF-Ray` 的机房代码相同且已知，就跳过。默认 N 为 2，`--hit-streak N` 可逐次运行调整；跳过不计作新 HIT，也不改最后测量时间。明确标识的 404 页面接受 HTTP 200/404，其他资源要求 HTTP 200。历史不自动过期，因此历史达标不等于当前缓存仍然命中，也不验证该 URL 是否已切换到新部署。

每轮只请求尚未达标且未耗尽本次尝试次数的资源，每项一次；单个资源本次默认最多尝试 3 次（`--max-attempts N`）。达到历史命中条件，或剩余项都耗尽次数时结束。不再提供固定轮数、总时限或轮间隔；单请求超时默认 20 秒（`--request-timeout SEC`），超时、失败及 429 都消耗一次尝试，下一轮再试。

默认最多同时进行 2 个资源请求（`--concurrency N`）。并发池未满时，仅保留一个补位计时器，每次独立随机等待 1–3 秒后加入一个请求；池满时取消计时，满转不满时重新等待完整间隔。未满期间已有请求完成不重置计时。可用 `--interval-min SEC`、`--interval-max SEC` 调整范围。随机间隔用于节流，不保证不会被安全规则拦截。

资源请求收到 429 响应头就暂停新资源请求，已发出的请求继续收尾。有效 `Retry-After` 指定等待秒数或日期；缺失或无效时等待 60 秒，多个暂停期限取最晚值。暂停到期后重新等待完整补位间隔；期限写入该 IP 的历史，重跑时该 IP 的资源请求继续遵守尚未到期的暂停。403 或 Cloudflare challenge 停止本次运行，不尝试绕过。没有总时限，遇到很长的服务器等待要求时可用 Ctrl-C 结束。

同一次运行共用 Undici 连接池，跨资源及轮次复用 HTTP/1.1 长连接。禁用 HTTP/2 是为了避免其协议级自动重发绕过调度与尝试次数；不跟随重定向、不携带登录信息、不加绕缓存参数。正文完整接收并解压验证后丢弃。代理沿用 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 回退及 `NO_PROXY`（小写变量优先），由客户端原生处理支持的 HTTP(S)/SOCKS5 代理，不静默改变出口。Undici 官方解压器目前首次使用会输出一次实验性功能提示。

结果保存在 `apps/site/.reports/cache-probe/<egress-ip>/`，IPv6 文件夹名将冒号替换为下划线；`--output PATH` 可改父目录。相同出口的多次运行共用追加式 `events.jsonl` 和增量 `report.json`／`report.md`，每个资源完成后更新。每次运行有自己的 `run-<id>.json`，每轮的 `round-<run-id>-<number>.json`／`.md` 都保留。请求开始只追加日志，不重写报表；资源结果、暂停和结束时更新报表。重开目录时回放日志、比较报表内容，只重写缺失或不一致的文件。汇总展示各资源最近一次真实结果和连续 HIT 数，轮报告单独标记跳过、未请求和尝试耗尽，不用历史 HIT 冒充本轮测量。

同一 IP 目录不允许两个进程同时写入。SIGINT/SIGTERM 会取消活动请求、保存未完成轮次并释放连接和锁；SIGKILL 后下次打开目录会从日志重建汇总，但须先确认原进程已退出，再移除残留 `.lock`。日志损坏会明确报错，不静默丢弃历史。文件系统写入或关闭失败时以非零退出码和终端错误为准，落盘报告可能未反映最终收尾错误。

出口 IP/国家通过同域 `/cdn-cgi/trace` 在每次运行开始时查询一次，整次运行使用这个 IP 归档，不再逐轮查询。出口查询不加入资源的重试或 429 暂停策略，失败就停止；运行期间不重新确认出口。逐资源记录 `CF-Ray` 的机房代码，不据此推断完整缓存链路。报告中的清单 buildId 不代表已核验线上版本；Static Assets 的 HIT/MISS 也存在平台误报边界，见 [Cloudflare 说明](https://developers.cloudflare.com/workers/static-assets/headers/#footnotes)。

报告记录输入清单的 URL 或文件路径、实际解析的 JSON 字节数及 SHA-256，以及各资源的 HTTP、缓存状态、机房、连接复用、实际 socket IP、编码及解码字节数、响应头到达时间和完整下载时间。计时从资源请求交给客户端开始，不含补位或清单下载等待；需要建连时包含建连耗时，不是纯服务端耗时。不输出无法可靠获取的独立 DNS、建连、TLS 或排队耗时。

退出码：`0` 为当前资源均达到历史命中条件，`2` 为尝试耗尽仍未达标，`3` 为访问被拦截，`1` 为执行错误，`130`/`143` 为 SIGINT/SIGTERM 中断。报告包含公网 IP、主机标识和 URL，不自动上传；对外分享前自行检查。

### Globalping 单 URL 探测记录

先执行 `npm run globalping:install`，通过 Go 的 `@latest` 安装官方 CLI 到项目 `.tools/bin/globalping-cli`；devenv 提供 Go 工具链。然后执行：

```sh
npm run globalping:record -- --url 'https://sshawn9.com/zh/' --from 'China+Shanghai' --limit 1
```

使用官方 CLI 的 `--json --ci`，默认 GET。每个节点结果保存到 `apps/site/.reports/globalping/measurements.sqlite` 的唯一业务表 `measurements`，固定 57 列，仅解析已确认的查询字段，完整源结果另存 JSON。终端默认显示摘要，加 `--json` 可输出完整结果。历史全部追加，不读取历史决定跳过，不计算累计 HIT，不自动清理或重试。

目标输入仅一个 `--url`，外层程序自行读取资源清单、循环及调度。该入口与 `cache:probe` 独立。完整参数、SQL 示例、Node 调用和错误处理见 [Globalping 工具说明](apps/site/tools/globalping/README.md)，字段与边界见 [实施方案](docs/globalping-redesign-plan.md)。

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

以下描述仓库的 [CI/CD 入口](.github/workflows/site-pipeline.yml)及其调用的[站点验证](.github/workflows/site-validation.yml)和[Cloudflare 部署](.github/workflows/site-deployment.yml)工作流，不代表已完成线上平台验收：

- 分支推送或手动触发：验证后发布 Preview；`main` 更新 `sshawn9-com-preview` 的当前部署，其他分支只上传带稳定别名的版本。部署摘要提供稳定分支 URL 和不可变版本 URL。
- `main` 还会独立验证并部署 Production；拉取请求只验证 Preview，不使用部署密钥。
- `main` 的正在运行流程和生产部署不会被后续推送自动取消，保证旧清单快照、部署和报告顺序完成；新任务需要等待，多个待运行任务仍只保留最新一个。其他分支保留自动取消旧运行的行为。
- Preview 包含草稿、不生成 sitemap，并在 HTML 和 `_headers` 中声明 `noindex`；Production 排除草稿并生成 sitemap。工作流不主动清理已删除分支的预览别名。

生产部署在 Wrangler 执行前下载线上 `resource-inventory.json` 为 `before.json`，并把本次已验证产物中的清单复制为 `after.json`。下载及清单校验最多尝试三次，每次请求最多 20 秒，失败间隔 2 秒；404、网络失败、JSON/必要字段无效或两份清单站点不一致都会阻止部署，不使用空清单替代旧版本。快照保存在 `apps/site/.reports/production-inventory/`，不进入部署目录。

部署成功后，直接离线比较这两份清单，不再请求线上新清单。Actions Summary 显示旧、新构建标识、数量和新增/减少页面、资源四组列表；页面按 `pages[].url`，资源按 `resources[].url` 排除各自清单中的页面 URL，完整保留查询参数。文件名哈希变化体现为旧 URL 减少、新 URL 增加；同一 URL 的标题、大小或内容变化不计入增减，外部资源标明为外部引用。报告失败会使任务失败并注明生产部署已成功。

快照和完整的 `diff.json`、`diff.md` 保存为 `production-inventory-<run_id>-<run_attempt>` artifact，保留 30 天，摘要提供下载链接。摘要过长时仅截断展示列表，artifact 保留完整报告；部署前校验或部署失败时也尽量上传已保存的快照，此时 `after.json` 只代表待部署产物，不代表已上线，且不会生成成功部署的差异报告。

可在项目环境中离线校验或复算下载的快照（不构建、不联网、不部署）：

```sh
npm run inventory:diff -- before.json after.json --check
npm run inventory:diff -- before.json after.json --output apps/site/.reports/production-inventory
```

需要配置以下 GitHub Actions 仓库密钥：

- `CLOUDFLARE_API_TOKEN`：具备目标账户 Worker 部署权限的令牌
- `UNSPLASH_ACCESS_KEY`：Unsplash 应用的 Access Key，只作为 Worker 运行时密钥上传

`wrangler.jsonc` 声明 Production 与 Preview 两个 Worker 环境及各自的 KV 绑定，KV ID 由 Wrangler 配置。普通页面与资源走 Static Assets，只有壁纸 API 优先进入 Worker。生产配置关闭 `workers.dev`，但两个环境的 `preview_urls` 均为 `true`；不能据此认定生产版本 URL 已关闭，也不能据此推断线上 Access 保护状态。生产域名绑定不由当前 Wrangler 文件声明，部署前需确认外部域名配置与目标 Worker 一致。

### 景观壁纸

生产照片池按 [`wrangler.jsonc`](wrangler.jsonc) 的 Cron 更新，当前每三小时一次；Preview 不配置 Cron。[Worker](worker/index.ts) 合并新候选与已有照片，验证后写入清单；更新失败保留旧清单，内容未变时不改写。照片池为空时 API 返回 503，不会因首次或重复访问自动初始化。

浏览器按标签页维护当前／下一张照片，站内导航不换图。自动轮换在当前照片淡化完成后重新计时，范围由 [壁纸模型](apps/site/src/features/appearance/wallpaper/model.ts) 定义，当前为随机 5–9 分钟；后台补图不改变已有计时。关闭自动轮换、页面隐藏或启用减少动态效果时不自动换图。

图片从 Unsplash CDN 获取，不转存到本站。浏览器报告图片的实际使用或下载，Worker 调用对应的 Unsplash 下载跟踪接口；页面保留摄影师与 Unsplash 署名链接。搜索条件不能严格保证照片题材。
