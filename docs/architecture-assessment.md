# sshawn9.com 技术架构评估

本文记录 2026 年 8 月 27 日对 `sshawn9.com` 的一次宏观架构评估，作为后续架构调整的实施依据。评估只阅读代码与配置文件，不阅读 `docs/` 下的说明性文档，以便独立于既有叙述判断实现现状；结论产生后再与 `docs/site-behavior-cases/` 的 198 个行为案例对照，区分哪些复杂度由行为契约必然产生、哪些由实现选择产生。

评估范围限定在框架、依赖、构建管线、运行时分层与工程流程层面，不包含具体缺陷、样式细节或单个函数的实现质量。

## 使用方式

- 每项条目给出现状证据、根因、影响、变更方案、代价与验收标准。证据以文件与行号形式给出，实施前应重新核对，代码可能已经变化。
- 「行为契约」一栏引用 `docs/site-behavior-cases/` 中的相关案例。**任何架构变更都不得改变这些案例描述的用户可观察行为**；案例明确声明自身不绑定 Astro、Solid、Swup、Pagefind 或 Cloudflare 的当前实现，因此它们既是约束，也是重构的验收框架。
- 「必然/偶然」一栏标注该复杂度的性质。必然复杂度只能更换载体，不能消除；偶然复杂度可以直接删除。混淆两者是本次评估中最容易犯的错误。
- 条目之间存在依赖关系，实施顺序见文末「实施路线」。不建议按编号顺序执行。

## 判定框架

站点承载了一组不常见但明确的产品约束：首帧即终态、字体就绪前不排版、站点外壳跨导航保持同一 DOM 实例、无 JavaScript 时核心导航可用、多语言与多版本内容并存。这些约束共同决定了实现不可能是一个简单的静态站点。

因此本评估不把「复杂」本身当作缺陷。判定标准是：

1. **该复杂度是否服务于一条已确立的行为契约。** 服务于契约的复杂度是必然的，问题只在于它是否被安置在合适的载体上。
2. **同一事实是否有多个真相源。** 有多个真相源即为缺陷，与复杂度是否必然无关。
3. **该复杂度是否可以由框架或平台原生承担。** 可以而未采用的，属于可迁移的必然复杂度。
4. **该实现是否引入了构建可复现性、供应链或类型安全上的风险。** 这类问题与产品行为无关，应无条件修复。

## 结论摘要

| 编号                                                 | 主题                                           | 性质                 | 严重度 | 建议动作                    |
| ---------------------------------------------------- | ---------------------------------------------- | -------------------- | ------ | --------------------------- |
| [1](#1-路由层swup-与-astro-岛屿模型的载体错配)       | 路由层：swup 与 Astro 岛屿模型的载体错配       | 必然复杂度、载体错配 | 高     | 迁移到 ClientRouter，分阶段 |
| [2](#2-构建期内容元数据依赖-git-子进程)              | 构建期内容元数据依赖 git 子进程                | 偶然复杂度           | 高     | 改为批量提取或内容字段      |
| [3](#3-i18n-三套系统并存locale-存在十余个真相源)     | i18n 三套系统并存，locale 存在十余个真相源     | 偶然复杂度           | 高     | 收敛到单一真相源            |
| [4](#4-首屏内联脚本没有模块系统导致关键逻辑多份拷贝) | 首屏内联脚本没有模块系统，导致关键逻辑多份拷贝 | 必然复杂度、载体缺失 | 高     | 由构建期生成内联脚本        |
| [5](#5-字体就绪子系统契约昂贵实现集中)               | 字体就绪子系统：契约昂贵，实现集中             | 必然复杂度           | 中     | 保留契约，降低耦合面        |
| [6](#6-worker-仅承担壁纸-api边缘能力闲置)            | Worker 仅承担壁纸 API，边缘能力闲置            | 偶然复杂度           | 中     | 承接根路由、404、类型生成   |
| [7](#7-四套可视化运行时并存)                         | 四套可视化运行时并存                           | 偶然复杂度           | 中     | 静态图构建期出图，收敛栈数  |
| [8](#8-内容即代码缺少依赖边界)                       | 内容即代码，缺少依赖边界                       | 偶然复杂度           | 中     | 建立文章私有依赖边界        |
| [9](#9-测试金字塔倒置复杂控制器零单元覆盖)           | 测试金字塔倒置，复杂控制器零单元覆盖           | 偶然复杂度           | 中     | 补中间层，拆分 e2e          |
| [10](#10-构建可复现性与供应链缺口)                   | 构建可复现性与供应链缺口                       | 偶然复杂度           | 高     | 立即修复，成本极低          |
| [11](#11-全局关键-css-体积)                          | 全局关键 CSS 体积                              | 偶然复杂度           | 低     | CJK 按需子集化              |

严重度按「对后续演进速度的阻碍程度」评定，不按用户可感知的问题严重程度评定。第 10 项成本接近于零而风险实际存在，应最先处理。

---

## 1. 路由层：swup 与 Astro 岛屿模型的载体错配

**性质**：必然复杂度，载体错配。行为契约要求的能力是真实的，但承载它的框架不是原生提供该能力的那一个。

### 现状证据

站点使用 swup 做 MPA 路由（`src/scripts/page-router.ts`）。Astro 的 `client:load` 岛屿在 swup 替换容器内容时不会自动保留，也不会自动重新水合。为弥合这一点，代码围绕 swup 重建了一整套外壳同步与生命周期设施：

| 设施           | 位置                                                                        | 承担的职责                                                                                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 外壳上下文通道 | `src/components/SiteHeader.astro:77,81`、`src/scripts/page-router.ts:81-89` | 把 header 的全部 props 序列化成 `<script id="site-chrome-context" type="application/json">`，每次换页解析新文档中的同名节点、覆写当前节点、派发 `site:chrome-context` 事件，由 SiteChrome 岛屿自行 reconcile |
| 运行时注册表   | `src/scripts/client-runtime.ts`                                             | 以字符串为键的全局 `Map<string, Cleanup>`，`claimClientRuntime(name)` 在注册时先调用同名旧实例的 dispose，手工实现「离场释放、到场只初始化一次」                                                             |
| 站点事件总线   | `src/scripts/page-router.ts:8-12,63-65`                                     | 自定义 `site:before-swap` / `site:after-swap` / `site:page-load` 三个事件，全站控制器订阅                                                                                                                    |
| 文档语言同步   | `src/scripts/page-router.ts:67-79`                                          | 换页后手工写回 `documentElement.lang` 与 `dataset.locale`                                                                                                                                                    |
| 主题同步       | `src/scripts/theme-controller.ts:80`                                        | 监听 `site:after-swap` 重新把主题写入新文档                                                                                                                                                                  |
| 浮层关闭       | `src/scripts/transient-ui.ts:114-116`                                       | 监听 `swup:visit:start` 关闭所有瞬时浮层                                                                                                                                                                     |
| A11y 焦点行为  | `src/scripts/page-router.ts:26-55`                                          | `InputAwareA11yPlugin` 继承官方插件并**覆写实例属性 `handleAnchorScroll`**，以区分指针激活与键盘激活                                                                                                         |
| 脚本作用域     | `src/scripts/page-router.ts:57-61`                                          | `OutletScriptsPlugin` 覆写 `getScope()` 把脚本执行限定在 `#swup` 内                                                                                                                                          |

滚动恢复被拆散在四处，且与 swup 自身的滚动处理并存：

- `src/components/PrepaintState.astro:86-105`：首帧前从 `history.state` 读取并决定 `scrollRestoration` 模式
- `src/components/RestoreScrollPosition.astro:9-13`：body 解析完成、绘制之前执行 `window.scrollTo`
- `src/scripts/nested-scroll-restoration.ts`：259 行，处理 Sidebar、目录等嵌套滚动容器
- `src/scripts/navigation-controller.ts:43-51,167-173`：滚动时以 rAF 节流写回 `history.state`

`InputAwareA11yPlugin` 对插件实例属性的覆写依赖上游未公开的内部行为，是升级 `@swup/a11y-plugin` 时的确定性风险点。

### 根因

swup 是为服务端渲染的传统 MPA 设计的路由器，它的心智模型是「替换 DOM 片段」。Astro 的岛屿模型的心智模型是「组件实例拥有自己的水合生命周期」。两者对「什么是页面」的定义不同，因此每一处需要跨导航存活的状态都必须手工搭桥。上表中的每一项都是同一个错配在不同侧面的显现。

### 与行为契约的关系

这些能力全部对应已确立的契约，**不能通过删除代码来解决**：

- `refresh-navigation-lifecycle/站内导航只替换页面出口，站点外壳保持同一实例.md`
- `refresh-navigation-lifecycle/页面级脚本在离场时释放、到场时只初始化一次.md`
- `refresh-navigation-lifecycle/快速连续导航时，迟到的水合只能接管最新页面.md`
- `refresh-navigation-lifecycle/键盘导航后焦点进入主内容，并以当前语言宣布页面变化.md`
- `refresh-navigation-lifecycle/浏览器前进后退恢复-URL-对应状态，不采用离开后的过期状态.md`

### 变更方案

迁移到 Astro 内置的 `<ClientRouter />`（`node_modules/astro/dist/transitions/`）。它原生提供了上表中大部分能力：

| 当前实现             | ClientRouter 对应物                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 外壳上下文 JSON 通道 | `transition:persist` —— 外壳岛屿跨导航保持同一实例，props 无需序列化重传                                              |
| `site:*` 事件总线    | `astro:before-preparation` / `astro:after-preparation` / `astro:before-swap` / `astro:after-swap` / `astro:page-load` |
| `SwupHeadPlugin`     | 内置 head 合并                                                                                                        |
| `SwupScriptsPlugin`  | 内置脚本重执行                                                                                                        |
| `SwupPreloadPlugin`  | Astro `prefetch` 配置（`defaultStrategy: 'hover'`）                                                                   |
| 主文档滚动恢复       | 内置（`transitions/events.js` 的 `updateScrollPosition`）                                                             |
| 语言与主题的换页同步 | 外壳持久化后大部分不再需要                                                                                            |

**关键可行性验证**：字体就绪契约要求在内容替换前 await 字体准备完成（见第 5 项）。`astro:before-swap` 的 `swap()` 是同步的，无法在此阻塞；但 `TransitionBeforePreparationEvent` 暴露可替换的 `loader: () => Promise<void>`，且 `doPreparation` 本身是异步的（`node_modules/astro/dist/transitions/events.d.ts`）。该事件同时提供 `newDocument`，正是 `prepareTypography(nextDocument)` 需要的入参。因此现有的

```
swup.hooks.before('content:replace', async (visit) => {
  await prepareTypography(visit.to.document, signal);
})
```

可以映射为在 `astro:before-preparation` 中包装 `event.loader`，在原 loader 之后 await 字体准备。**这一点必须在动工前用一个最小原型验证**，它是整项迁移能否成立的前提。

保留 `claimClientRuntime`。ClientRouter 解决的是外壳持久化，页面级控制器的「离场释放、到场只初始化一次」仍需显式管理，注册表模式依然适用，只是订阅的事件从 `site:*` 换成 `astro:*`。

### 代价与风险

- 工作量最大的一项，涉及全部客户端控制器的事件订阅点。
- swup 的动画控制粒度（`animationScope: 'containers'`、`swup-transition-main`）需要用 CSS View Transitions 重新表达。`refresh-navigation-lifecycle/站内页面切换保留既有动画，不退化为整页重载或突变.md` 与 `已取消的入场动画不得在字体或异步资源就绪后复活.md` 是这里的验收硬约束。
- 主题切换当前已使用 `document.startViewTransition`（`src/scripts/theme-controller.ts:44`）。ClientRouter 同样基于 View Transitions，两者叠加时的行为需要专门验证，`locale-theme-fonts/亮暗主题以-600-ms-平滑过渡，不出现整页泛白或旧主题闪帧.md` 覆盖此场景。
- 一旦确认不可行（尤其是异步 loader 验证失败），应停留在 swup 并改为局部改进：至少把 `InputAwareA11yPlugin` 对私有属性的覆写替换为不依赖内部实现的方案。

### 验收标准

`refresh-navigation-lifecycle/` 全部 14 个案例通过，其中「站点外壳保持同一实例」需以 DOM 节点引用相等断言，「离场释放」需以监听器创建/释放计数断言。收益指标：`site-chrome-context` 通道、`site:*` 事件总线、`syncDocumentLocale`、head/scripts 两个自定义插件从代码库消失。

---

## 2. 构建期内容元数据依赖 git 子进程

**性质**：偶然复杂度。可直接消除。

### 现状证据

`src/lib/articles.ts:39-70`：

```
assertCompleteGitHistory();
const timestamp = execFileSync('git', ['log', '-1', '--format=%cI', '--', filePath], {
  cwd: process.cwd(),
  encoding: 'utf8',
}).trim();
```

对每一个未显式声明 `revisedAt` 的文章文件，同步 spawn 一次 `git log`（`src/lib/articles.ts:97-99`）。`assertCompleteGitHistory()` 在首次调用时执行 `git rev-parse --is-shallow-repository`，仓库为浅克隆时直接抛错终止构建。CI 因此必须 `fetch-depth: 0`（`.github/workflows/verify.yml`）。

### 影响

1. **构建环境耦合**：任何不携带完整 git 历史的环境都无法构建——容器化构建、Cloudflare Pages 的默认浅克隆、从内容 CDN 拉取源码的场景。当前 CI 依赖 GitHub Actions 的 checkout 配置来满足这一前提，该前提没有在代码中以任何方式被表达，只在运行时报错。
2. **构建耗时随内容线性增长**：N 篇文章 = N 次同步子进程 spawn，每次阻塞 Node 主线程。同时 `fetch-depth: 0` 使 checkout 耗时随仓库历史增长。
3. **内容事实定义在 VCS 中**：「文章最后更新时间」这一内容属性由提交历史决定。rebase、squash merge、文件重命名、批量格式化提交都会改写它，而这些操作与内容是否真的更新无关。`article-sidebar-toc-versions/错字、格式和链接修复只保留在-Git-历史中，不制造公开版本.md` 说明「不产生新版本」是有意设计，但这恰恰意味着格式修复提交会污染更新时间。

### 与行为契约的关系

`article-sidebar-toc-versions/文章信息展示首次发布与最后更新，不展示阅读时长.md` 要求展示「最后更新」，但**没有规定该时间必须来自 git**。契约只约束展示，不约束来源。

### 变更方案

三个选项，按推荐度排序：

1. **批量提取 + 构建产物落盘**（推荐）。以一次 `git log --format=... --name-only` 遍历全部历史，构建 `filePath -> 最后提交时间` 映射，写入构建缓存。子进程调用从 N 次降到 1 次，浅克隆断言仍然保留但只需检查一次。改动局限在 `src/lib/articles.ts`，风险最低。
2. **改为必填内容字段**。在 `articleMetadata` schema 中要求 `revisedAt`，完全切断构建与 VCS 的耦合。语义最干净，但把维护负担转移给写作流程，且与「格式修复不产生版本」的现有习惯冲突——每次修订都要手工改日期。
3. **保留 git 但移出构建期**。由 CI 在构建前生成一个 JSON 元数据文件，构建只读该文件。本质是选项 1 的外置版本，多一个流程环节，不如选项 1。

选项 1 与选项 2 可以组合：`revisedAt` 显式声明时优先，未声明时回退到批量提取的 git 时间。这正是当前的语义（`src/lib/articles.ts:97-99`），只是把实现从 N 次子进程换成 1 次。

### 验收标准

`development-preview-production/` 相关案例保持通过。新增验收：在浅克隆仓库中构建应给出明确、可操作的错误信息，而非在第一篇文章处抛出底层 git 错误。度量：记录改动前后的构建耗时与子进程调用次数。

---

## 3. i18n 三套系统并存，locale 存在十余个真相源

**性质**：偶然复杂度。

### 现状证据

同时运行三套 i18n 机制：

1. **Astro 原生 i18n**（`astro.config.mjs:123-130`）：提供 `getRelativeLocaleUrl`、`Astro.currentLocale`、路由前缀
2. **Paraglide**（`astro.config.mjs:182-203`）：提供消息函数，同时**自带一套独立的路由与语言协商机制**——`strategy: ['url', 'localStorage', 'preferredLanguage', 'globalVariable', 'baseLocale']` 与自己的 `urlPatterns`
3. **手写的 `src/i18n/config.ts`**：`LOCALES`、`isLocale`、`localePath`、`replacePathLocale`、`toLanguageTag`

`src/middleware.ts` 的全部内容就是把 Astro 的 locale 桥接给 Paraglide 的全局变量：

```
setLocale(assertIsLocale(context.currentLocale ?? baseLocale));
```

这个桥本身即是两套系统不该并存的证据。

`['en', 'zh']` 这一事实的出现位置（不完全枚举）：

| 位置                                                       | 形式                                                |
| ---------------------------------------------------------- | --------------------------------------------------- |
| `astro.config.mjs:125`                                     | `locales: ['en', 'zh']`                             |
| `astro.config.mjs:160`                                     | sitemap `locales: { en: 'en', zh: 'zh-CN' }`        |
| `astro.config.mjs:189-199`                                 | paraglide `urlPatterns` 中的 `en` / `zh` 字面量     |
| `project.inlang/settings.json`                             | `"locales": ["en", "zh"]`                           |
| `src/i18n/config.ts:3`                                     | `LOCALES = ['en', 'zh']`                            |
| `src/i18n/config.ts:22`                                    | `toLanguageTag` 中的 `zh → zh-CN` 映射              |
| `src/i18n/config.ts:32`                                    | 正则 `/^\/(?:en\|zh)(?=\/\|$)/`                     |
| `src/lib/article-convention.ts:12`                         | 正则 `/^index(?:\.(en\|zh))?$/`                     |
| `src/scripts/page-router.ts:70`                            | `value.locale !== 'en' && value.locale !== 'zh'`    |
| `src/dev-toolbar/drafts/integration.ts:5`                  | `LOCALES = ['en', 'zh'] as const`                   |
| `src/pages/404.astro`                                      | 双语内容与 `data-title-en` / `data-title-zh` 硬编码 |
| `public/site.en.webmanifest`、`public/site.zh.webmanifest` | 每语言一个文件                                      |

其中三处是**正则字面量**，无法通过类型系统发现遗漏。新增一门语言需要改动十余处，且没有任何机制会在遗漏时报错。

另有一个附带问题：`messages/en.json` 共 172 条消息，其中 62 条属于单篇文章的界面文案（`frenet_*` 46 条、`closed_loop_control_timing_*` 若干）。单篇文章的翻译进入全站扁平命名空间，随文章数量线性增长且无法隔离。

### 与行为契约的关系

`locale-theme-fonts/` 中 15 个案例定义了语言行为，包括「首次进入中立路由时，已保存语言优先于系统语言，默认回退英语」「切换语言时进入同一内容的对应语言路由并保存选择」「非文章正文的基础界面文案以英语为源，不被单语文章反向改写」。这些契约不要求任何特定的 i18n 库，也不要求两套路由机制并存。

### 变更方案

分两步，第二步可选：

**第一步（推荐，风险低）**：把 `src/i18n/config.ts` 确立为唯一真相源，其余位置从它派生。

- `astro.config.mjs` 从 `src/i18n/config.ts` 导入 locale 列表（配置文件已是 `.mjs`，可直接 import TS 需确认 Astro 的配置加载能力，否则将常量下沉到一个 `.mjs` 共享模块）。
- 消除三处正则字面量：`replacePathLocale` 由 `LOCALES` 动态构造正则；`article-convention.ts` 同理；`page-router.ts:70` 改用 `isLocale()`。
- `src/dev-toolbar/drafts/integration.ts` 导入而非重新声明。
- webmanifest 改为构建期按 locale 生成，而非两个手写文件。
- 增加一个类型层面的守卫：让新增 locale 时至少有一处编译期错误提示，例如 `toLanguageTag` 使用 `Record<Locale, string>` 而非 `if/else`（当前 `src/i18n/config.ts:22-24` 是三元表达式，新增语言时静默回退到 `'en'`）。

**第二步（可选，需评估）**：收敛路由机制。Paraglide 的 `urlPatterns` 与 Astro 的 i18n 路由在描述同一件事。若 Paraglide 仅用于消息函数而不用于路由，可将 `strategy` 收缩为 `['globalVariable']` 并删除 `urlPatterns`，由 middleware 单向驱动。这会移除一整层语言协商逻辑，但需确认 Paraglide 的消息函数在无 URL 策略时的行为，以及 `src/pages/index.astro` 的客户端语言协商（见第 6 项）是否受影响。

文章级消息应与全站消息分离。可行方向：为文章消息建立独立的命名空间或独立的 message 文件，与第 8 项的「文章私有依赖边界」一并设计。

### 验收标准

`locale-theme-fonts/` 全部 15 个案例通过。新增验收：以一次「假想新增第三门语言」的演练验证真相源收敛效果——列出需要改动的文件，目标是 2 处以内（`src/i18n/config.ts` 与 `messages/`）。

---

## 4. 首屏内联脚本没有模块系统，导致关键逻辑多份拷贝

**性质**：必然复杂度，载体缺失。契约要求首帧即终态，必须有阻塞式内联脚本；缺的是让该脚本从单一源码生成的机制。

### 现状证据

`src/components/PrepaintState.astro` 是一段 190 行的 `is:inline` 阻塞脚本，在首帧之前完成主题解析、壁纸背景恢复、Sidebar 尺寸恢复、滚动位置判定、字体缓存状态判定，并把结果写入 `window.__SSHawn9SiteBootstrap`。

`is:inline` 脚本不经过打包，**不能 `import`**。常量只能通过 `define:vars`（`src/components/PrepaintState.astro:24-34`）注入，逻辑只能手抄。结果是同一套逻辑存在多份：

| 逻辑                                                        | 副本 A                                 | 副本 B                                   | 副本 C                                                                     |
| ----------------------------------------------------------- | -------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| 主题解析（stored → system → dark/light）                    | `PrepaintState.astro:111-116`          | `theme-controller.ts:11-13,26-30`        | `404.astro:27-33`，且硬编码字符串 `'theme'` 而非 `SITE_STORAGE_KEYS.theme` |
| 壁纸图片 URL 构造（`auto/fit/q/w` 四个查询参数）            | `PrepaintState.astro:168-173`          | `wallpaper.ts:57-64`                     | —                                                                          |
| 壁纸 photo 结构校验                                         | `SiteHeader.astro:88-99`（逐字段手抄） | `lib/wallpaper.ts` 的 `isWallpaperPhoto` | —                                                                          |
| Sidebar 宽度 clamp                                          | `PrepaintState.astro:133-137,148-152`  | `sidebar-layout-controller.ts`           | —                                                                          |
| 主题写入 DOM（class / dataset / colorScheme / theme-color） | `PrepaintState.astro:186-205`          | `theme-controller.ts:16-24`              | `404.astro:31-33`（部分）                                                  |
| 滚动恢复判定                                                | `PrepaintState.astro:86-105`           | `RestoreScrollPosition.astro:9-13`       | `navigation-controller.ts:43-51`                                           |

`define:vars` 注入的值在脚本内是无类型的 JS；`PrepaintState.astro` 中的 `storageKeys`、`blogSidebarMinWidth` 等在编辑器中没有类型信息，重命名 `SITE_STORAGE_KEYS` 的字段不会在此处报错。

`404.astro` 是问题最集中的一处：它完整复制了站点外壳的 HTML、自己的主题脚本、硬编码的存储键与双语内容，因为静态 404 页无法知道请求的 locale（见第 6 项）。

### 与行为契约的关系

`refresh-navigation-lifecycle/同一页面硬刷新时，首个可见帧即为最终稳定画面.md` 与 `硬刷新恢复正文滚动位置时，不播放滚动或入场动画.md` 直接要求首帧前完成状态恢复。`locale-theme-fonts/主题默认跟随系统，用户选择跨刷新与站内导航保持.md` 同理。**阻塞内联脚本不可删除**，问题只在于它的内容应该由构建生成而非手写。

### 变更方案

用一个小型 Vite 插件（或 Astro 集成）把一个真正的 TS 模块编译为字符串，在构建期注入 `PrepaintState.astro` 的 `set:html`：

1. 新建 `src/prepaint/index.ts`，正常 `import` `SITE_STORAGE_KEYS`、`BLOG_SIDEBAR_LAYOUT`、`isStoredWallpaperBackground`、主题解析函数等。
2. 插件以 esbuild 将其打包为 IIFE、无外部依赖、压缩后的单个字符串。
3. `PrepaintState.astro` 输出该字符串，`define:vars` 完全取消。
4. 主题解析、URL 构造、clamp、photo 校验各自收敛为一份实现，被内联脚本与运行时控制器共同引用。

此方案的价值不限于消除拷贝：它让首屏关键路径进入类型系统与测试范围，而这段代码目前是全站唯一完全不受类型检查约束的部分。

`404.astro` 的重复应通过第 6 项（边缘承接 404）解决，而非在静态层面继续复制。

### 代价与风险

- 需要保证打包结果的体积可控（当前手写脚本约 190 行；打包后应设定一个体积上限并在 CI 中断言）。
- 需要保证打包结果不引入任何异步或模块语法，必须是同步 IIFE。
- 插件本身是自建工程设施，增加一处需要维护的构建逻辑。这是用「一处受控的构建复杂度」换「六处分散的逻辑拷贝」，判断上值得，但应明确记录。

### 验收标准

`refresh-navigation-lifecycle/同一页面硬刷新时，首个可见帧即为最终稳定画面.md` 与 `locale-theme-fonts/` 主题相关案例通过。新增验收：上表中每一行的「副本」数量降为 1；内联脚本产物体积在 CI 中设有上限断言。

---

## 5. 字体就绪子系统：契约昂贵，实现集中

**性质**：必然复杂度。这是本次评估中最容易被误判为过度工程的一项。

### 现状证据

`src/scripts/typography-controller.ts`（251 行）实现了一个五态机（`cold` / `warm` / `revealing` / `ready` / `degraded`，定义于 `src/lib/typography-contract.ts:8`），配合：

- `src/styles/global.css:19-21`：`:root[data-document-state='parsing'] body { visibility: hidden; }`
- `astro.config.mjs:64,96`：两个字体族均为 `display: 'block'`
- `src/scripts/navigation-controller.ts:90-99`：在 swup 的 `content:replace` **之前 await** `prepareTypography(nextDocument)`，即站内导航被字体加载阻塞
- `requirementsFor()`（`typography-controller.ts:119-141`）：扫描整个文档的 `textContent`，提取 CJK 字符集合，按显示/正文/CJK/等宽/KaTeX 分类构造 `document.fonts.load()` 请求
- `TYPOGRAPHY_TIMEOUT_MS = 8_000`（`typography-contract.ts:11`）：失败上限
- `src/lib/font-revision.server.ts`：把 `package-lock.json`（470 KB）导入构建图，对五个字体包的版本求 hash，作为 localStorage 中「字体已缓存」标记的键

耦合点：

- `typography-controller.ts:83-98` 硬编码 KaTeX 内部类名 `.mathcal` / `.mathscr` / `.mathfrak` / `.mathsf` / `.mathtt`，用于判断需要加载哪些 KaTeX 字体变体
- `typography-controller.ts:18` 的 `CODE_SELECTOR` 包含 `.expressive-code` 与 `.version-diff-panel`，耦合 expressive-code 与版本比较组件的类名
- `whenTypographyReady()` 被 `ResearchFigure.tsx:4`、`FrenetExplorer.tsx`、`ClosedLoopControlTimingClient.tsx:167` 等图形消费者 await

### 与行为契约的关系

这套设计**完全对应已确立的契约**，不是随意的：

- `locale-theme-fonts/首次访问可等待字体下载，但必须有明确且有限的就绪过程.md`：明确允许「受控的等待或揭示效果」，明确禁止「为追求立即显示而先用错误字体排版，再明显换字」，明确要求「等待范围与当前页面实际内容匹配」（这正是扫描文档文本按需构造请求的原因）、「有时间上限」（8 秒）、「失败时正文仍可阅读」（`degraded` 态）。
- `locale-theme-fonts/正文、署名、Sidebar、目录和交互图统一等待同一字体就绪契约.md`：明确要求所有几何消费者监听**同一个**状态，禁止各自使用 timeout。这正是 `whenTypographyReady()` 的存在理由。
- `locale-theme-fonts/字体已缓存后的刷新与重访不得发生换字、消失重现或布局位移.md`：这是 `font-revision` + localStorage `warm` 态的存在理由。
- `locale-theme-fonts/频繁更新文章不得使稳定中文字体缓存随内容变化整体失效.md`：这是 revision 基于**包版本**而非内容 hash 的理由。
- `locale-theme-fonts/字体加载失败必须进入可读回退状态，缺字不得显示方框.md`：`degraded` 态。

**因此不建议删除该子系统或改用 `font-display: swap`。** 换用 `swap` 会直接违反「先用错误字体排版再明显换字」这条禁止状态。前一版评估中「删掉整个子系统」的判断是错误的，此处更正。

### 仍然值得处理的部分

契约必然，但实现上有三处可降低耦合面：

1. **`package-lock.json` 进入构建图**（`font-revision.server.ts:2`）。为求五个包的版本 hash 而导入 470 KB JSON。可改为在构建期读取并只提取所需字段，或由一个小脚本生成一个 `font-revision.json` 常量文件。收益是构建图更干净，非功能性改动。
2. **KaTeX 与 expressive-code 的类名耦合**。这些选择器绑定第三方产物的内部结构，升级时静默失效（不会报错，只会退化为字体未预加载）。建议至少加一条 e2e 断言：含公式的文章在字体就绪后 KaTeX 字形已加载，使失效可被发现。
3. **与导航的耦合点**。`navigation-controller.ts:90-99` 通过 `swup.hooks.before('content:replace')` 阻塞导航。第 1 项迁移到 ClientRouter 时，这是必须优先验证的映射点（见第 1 项的「关键可行性验证」）。建议把「阻塞换页直到字体就绪」抽象为一个不依赖具体路由器的小接口，使路由器可替换。

### 验收标准

`locale-theme-fonts/` 中全部字体相关案例（至少 6 条）在改动前后行为一致。任何对本项的改动都必须先建立这些案例的自动化或人工验收记录作为基线。

---

## 6. Worker 仅承担壁纸 API，边缘能力闲置

**性质**：偶然复杂度。

### 现状证据

`wrangler.jsonc` 已将 Worker 置于请求路径上，但 `worker/index.ts:331-341` 中除两个壁纸端点外全部直通静态资源：

```
if (url.pathname === WALLPAPER_DOWNLOAD_ENDPOINT) { ... }
if (url.pathname === WALLPAPER_ENDPOINT) { ... }
return env.ASSETS.fetch(request);
```

Astro 未配置 adapter，`astro.config.mjs` 中没有 `output` 或 `adapter` 字段，即纯静态输出。Worker 与 Astro 之间没有共享的路由定义或类型。

由此产生的下游问题：

1. **根路径的语言协商在客户端**。`src/pages/index.astro:18-51` 是一段内联脚本，读取 localStorage 与 `navigator.languages`，然后 `location.replace()`。该页 `noindex`（`src/pages/index.astro:16`）。无 JavaScript 的用户看到的是 `<noscript>` 中的手动语言选择页（`src/pages/index.astro:72-77`）。这本应是边缘上的一次 302 + `Accept-Language` 协商。
2. **404 页无法知道 locale**，因此 `src/pages/404.astro` 双语并列渲染，并复制了整套外壳（见第 4 项）。`wrangler.jsonc:24` 的 `not_found_handling: "404-page"` 指向这个静态页。
3. **Worker 类型全部手写**。`worker/index.ts:16-33` 手工声明 `KvNamespace`、`AssetsBinding`、`WorkerEnvironment`、`WorkerContext`，未使用 `wrangler types` 生成的绑定类型。`KvNamespace.get` 只声明了 `(key, type: 'json')` 这一个重载，与真实 KV API 不符；与真实运行时之间没有类型契约，绑定配置变更不会在编译期暴露。
4. **`refreshInFlight` 是模块级单例**（`worker/index.ts:60`）。在 Workers 中它只在单个 isolate 内去重，多 isolate 并发冷启动时仍会产生并发的 Unsplash 请求。KV 冷未命中时（`worker/index.ts:270-278`）用户请求会同步等待一次外部 API 调用。

### 与行为契约的关系

- `development-preview-production/www.sshawn9.com-永久重定向到规范主域名-sshawn9.com.md` 说明重定向属于既有关注点。
- `locale-theme-fonts/首次进入中立路由时，已保存语言优先于系统语言，默认回退英语.md` 定义了根路由的协商顺序：**已保存语言优先于系统语言**。这一点很重要——已保存语言在 localStorage 中，边缘不可见。因此根路由不能改为纯边缘 302，必须保留客户端逻辑，或改为边缘按 `Accept-Language` 给出默认、客户端在有已保存语言时再修正。方案需按此契约设计，不能简单替换。

### 变更方案

按收益/风险排序：

1. **`wrangler types` 生成绑定类型**（低风险，立即可做）。删除手写的 `KvNamespace` / `AssetsBinding` / `WorkerEnvironment`，改用生成类型。这是纯粹的类型安全修复。
2. **边缘承接 404**（中风险）。由 Worker 根据路径前缀判断 locale 并返回对应语言的 404 页，使 `404.astro` 可以复用正常布局而非复制外壳。需要构建产出两个 locale 的 404 页。
3. **根路由协商**（需按契约设计）。边缘依 `Accept-Language` 返回 302 到默认语言，客户端脚本仅在 localStorage 存有不同语言时再做一次修正。收益是无 JS 用户与首次访问者不再经过一次客户端跳转；代价是引入了「边缘决定 + 客户端修正」的两段逻辑，需谨慎评估是否比现状更好。**此项可选，不做也可接受。**
4. **壁纸冷启动路径**（低优先）。KV 未命中时同步调用 Unsplash 的行为可改为返回降级响应 + `waitUntil` 后台刷新，避免用户请求等待外部 API。当前已有 `unavailableResponse` 与 `Retry-After: 60` 机制（`worker/index.ts:246-256`），只是在冷未命中时未走该路径。

是否引入 Astro 的 Cloudflare adapter 是一个更大的决策。当前纯静态 + 旁挂 Worker 的组合运行良好，且 `browser-cache-artifacts/` 与 `development-preview-production/` 的多条契约（不可变版本地址、预览隔离、产物复用）建立在静态产物之上。**不建议为了上述改进而引入 adapter**；上述改进在现有结构下都可完成。

### 验收标准

`development-preview-production/` 与 `locale-theme-fonts/首次进入中立路由时...` 案例通过。类型改造以 `npm run check` 通过且 `worker/index.ts` 中不再存在手写绑定类型为准。

---

## 7. 四套可视化运行时并存

**性质**：偶然复杂度。

### 现状证据

构建产物中的可视化相关体积：

| 产物                                 | 体积    | 来源                                                                       |
| ------------------------------------ | ------- | -------------------------------------------------------------------------- |
| `plotly-gl3d.min.*.js`               | 1591 KB | `plotly.js-gl3d-dist-min`，用于 `ResearchFigure.tsx`、`FrenetExplorer.tsx` |
| `vega.module.*.js`                   | 502 KB  | `vega`，用于 `ClosedLoopControlTimingClient.tsx:167`                       |
| `ClosedLoopControlTimingClient.*.js` | 129 KB  | 文章私有                                                                   |
| `FrenetExplorer.*.js`                | 104 KB  | 文章私有                                                                   |
| `MotionControlProjectVisual.*.js`    | 37 KB   | 自写 canvas + `d3-drag` / `d3-selection` / `flo-bezier3`                   |

四套独立的图形栈：Plotly、Vega、d3 + 自写 canvas、以及 `ResearchFigure` 中的声明式图表构造层。全部为懒加载，用户不会一次性下载，但维护面是四份。

`ResearchFigure.tsx`（739 行）中的四张图（`planar-curvature-signs`、`planar-heading`、`vehicle-state`、`vehicle-velocity`）是**纯声明式、无交互**的：`CONFIG` 设置 `responsive: false, displayModeBar: false, scrollZoom: false, hovermode: false`（`ResearchFigure.tsx:34-39,191`）。为四张静态图加载 1.6 MB 的 Plotly（含 WebGL 3D 模块）是不成比例的。

### 与行为契约的关系

`research-interactions/` 目录下 20 个案例定义了交互式图形的行为。需要在实施前逐条核对哪些图**确实需要交互**。`ResearchFigure` 的四张图从配置上看不需要，但必须以契约核对为准，不能以代码配置推断。

### 变更方案

1. **静态图构建期出图**。`ResearchFigure` 的四张图若经契约核对确认无交互需求，可在构建期渲染为 SVG 内联到 HTML。收益：这四张图的读者完全不加载 Plotly；同时它们不再需要 await 字体就绪（第 5 项的消费者减少一个）。风险：需保证 SVG 在亮暗主题下正确——当前颜色来自 CSS 自定义属性（`ResearchFigure.tsx:45-58` 的 `readTheme`），构建期出图需改为双主题各出一份或使用 `currentColor` 与 CSS 变量。
2. **评估 Plotly 的 3D 需求**。`plotly.js-gl3d-dist-min` 包含 WebGL 3D 模块。若只有 `FrenetExplorer` 的曲面图需要 3D，其余 2D 图可换用更小的 Plotly 分发包（如 `plotly.js-basic-dist-min`），按图选择入口。`src/lib/plotly-client.ts` 已是集中加载点，改造成本可控。
3. **不建议强行统一到单一图形库**。Vega 的声明式 spec（`closed-loop-control-timing-spec.ts`）与 Plotly 的命令式布局解决的是不同问题，且 `tests/unit/closed-loop-control-timing.test.ts` 已基于 Vega spec 建立了单元测试——这是全站测试质量最高的一处，不应为了统一而破坏。

### 验收标准

`research-interactions/` 全部 20 个案例通过。度量：首次进入含静态图的文章时，Plotly 相关请求数为 0；`dist/_astro` 中可视化产物总体积下降幅度。

---

## 8. 内容即代码，缺少依赖边界

**性质**：偶然复杂度。

### 现状证据

`src/content/blog/<slug>/` 与 `src/content/projects/<slug>/` 下混放内容与应用代码：

```
src/content/blog/frenet-arc-length-conversion/
  index.md / index.zh.md      ← 内容
  meta.yaml                   ← 内容元数据
  FrenetExplorer.tsx          ← 应用代码
  frenet-model.ts             ← 应用代码
  frenet-plot.ts              ← 应用代码
  frenet-explorer.css         ← 应用代码
```

content collection 的 glob 只匹配 `**/*.{md,mdx}` 与 `**/meta.yaml`（`src/content.config.ts:33,7`），其余文件只是「碰巧放在这里」的普通源码。

后果：

1. **单篇文章可向根 `package.json` 添加依赖**。`flo-bezier3`、`d3-drag`、`d3-selection`、`plotly.js-gl3d-dist-min`、`vega`、`@ark-ui/solid`、`@kobalte/core`、`lucide-solid` 均为文章或项目私有依赖，但都在根依赖列表中，被所有开发者 `npm ci` 安装、被 `npm run check` 全量类型检查。
2. **文章的依赖升级波及全站构建**。一个只影响单篇文章的 Plotly 大版本升级会阻塞整个 `verify` 流水线。
3. **文章私有的 i18n 文案进入全站 message 命名空间**（与第 3 项相关，172 条中 62 条）。
4. **归档成本高**。若某篇文章下线，需要人工判断哪些依赖可以从 `package.json` 移除。

### 与行为契约的关系

`research-interactions/` 的存在说明交互式文章是有意的产品能力，不应被削弱。本项要解决的是**依赖归属与边界**，不是取消交互式文章。

### 变更方案

这是一项设计工作，不是直接的代码改动。可行方向：

1. **约定 + 工具化检查**（推荐起点，成本低）。保持当前物理布局，但建立一份「依赖 → 归属」的声明文件，并在 CI 中检查：根依赖中标注为文章私有的包，不得被 `src/components/`、`src/scripts/`、`src/lib/` 引用。这至少让边界可被机器验证，防止文章依赖渗入站点核心。
2. **npm workspaces**（成本高，收益明确）。把每篇带代码的文章变成一个 workspace 包，依赖声明在各自的 `package.json` 中。收益是真正的隔离；代价是构建配置显著复杂化，且 Astro content collection 与 workspace 布局的配合需要验证。**对当前规模（2 篇交互式文章 + 1 个项目可视化）而言，成本大于收益，暂不建议。**
3. **先做归类，暂不做隔离**。在 `package.json` 中通过注释或分组明确标注哪些依赖属于哪篇文章。零成本，可立即执行，为将来的选项 1 或 2 铺路。

建议路径：立即执行选项 3，在交互式文章数量超过 5 篇时再评估选项 1。

### 验收标准

无用户可观察行为变化。度量：`package.json` 中每一项依赖都能对应到明确的归属方。

---

## 9. 测试金字塔倒置，复杂控制器零单元覆盖

**性质**：偶然复杂度。

### 现状证据

| 层                                   | 规模                  | 覆盖对象                                                                                                                                  |
| ------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| e2e                                  | 4388 行，5 个文件     | 全站行为                                                                                                                                  |
| └ `tests/e2e/site.spec.ts`           | **3040 行**（单文件） | 大部分站点行为                                                                                                                            |
| └ `tests/e2e/frenet-article.spec.ts` | 882 行                | 单篇文章                                                                                                                                  |
| 单元                                 | 7 个文件              | `frenet-model`、`closed-loop-control-timing-spec`、`articles`、`tags`、`i18n-config`、`motion-control-project-visual`、`wallpaper-worker` |

单元测试全部覆盖**纯函数**。而复杂度最高、缺陷成本最高的一批客户端控制器**没有任何单元或组件级覆盖**：

`navigation-controller.ts`(196 行)、`typography-controller.ts`(251 行)、`wallpaper.ts`(700 行)、`sidebar-layout-controller.ts`(270 行)、`nested-scroll-restoration.ts`(259 行)、`transient-ui.ts`(123 行)、`article-toc.ts`(140 行)、`client-runtime.ts`。

这些模块包含 revision 计数、AbortController 竞态处理、rAF 节流、定时器编排等时序逻辑——正是最需要快速、确定性、可重复测试的代码，目前却只能通过启动真实浏览器验证。

流水线成本（`.github/workflows/verify.yml`）：

- `playwright.config.ts:8` `fullyParallel: false`
- `playwright.config.ts:9` CI 上 `workers: 2`
- `playwright.config.ts:11` CI 上 `retries: 2`
- main 分支上 preview 与 production 两次完整构建 + 两次完整 e2e
- job `timeout-minutes: 30`

`retries: 2` 值得注意：近期提交 `7afedb5 test(e2e): stabilize Playwright tests on CI` 与 `e4d19e6 test(e2e): reduce hydration timing flakiness` 表明 e2e 稳定性是一个反复出现的维护负担。重试掩盖了不稳定，而不稳定的根源（水合时序）恰恰是缺少中间层测试的那部分逻辑。

### 与行为契约的关系

`validation-failure-classification/` 目录下 8 个案例定义了验收与故障判定方法。`site-behavior-cases/README.md` 明确指出「自动化测试不能覆盖真实视觉、系统指针、原生滚动或边缘平台时，保留明确的人工验收步骤」——即 e2e 的定位是验证用户可观察行为，**不是**验证控制器内部时序。当前 e2e 被迫承担了后者。

### 变更方案

1. **补中间层**（核心改动）。引入 vitest 的浏览器模式或 happy-dom 环境，为上述控制器建立单元/集成测试。优先顺序按「时序复杂度 × 缺陷成本」：`client-runtime` → `navigation-controller` → `typography-controller` → `sidebar-layout-controller` → `nested-scroll-restoration`。`client-runtime` 是最好的起点：接口极小、语义明确（注册即释放同名旧实例）、且是「离场释放、到场只初始化一次」契约的基石。
2. **拆分 `site.spec.ts`**。3040 行单文件难以定位与并行。建议按 `docs/site-behavior-cases/` 的 12 个分类拆分，使测试文件与行为案例目录一一对应。这同时让「哪条契约缺测试」变得可见。
3. **重新评估 `fullyParallel: false`**。串行执行是当前稳定性的代价之一。中间层建立后，可重新评估能否开启并行。
4. **重新评估 `retries: 2`**。目标是随中间层覆盖率提升逐步降到 1 或 0。保留重试但**在 CI 摘要中报告重试发生次数**，使被掩盖的不稳定重新可见。
5. **重新评估 main 分支上的双次 e2e**。preview 与 production 构建的差异主要是草稿过滤与 noindex（`src/lib/articles.ts:156-158`、`src/components/BaseHead.astro:43`）。`tests/e2e/deployment-mode.spec.ts` 只有 21 行——可考虑让 production 只跑该模式相关子集，而非全量重跑。这能显著缩短 main 分支的流水线时间。**需先确认 `development-preview-production/` 中相关契约允许此简化。**

### 验收标准

度量：中间层测试文件数与覆盖的控制器数；`site.spec.ts` 拆分后单文件最大行数；main 分支流水线端到端耗时；CI 中重试触发次数（新增报告项）。

---

## 10. 构建可复现性与供应链缺口

**性质**：偶然复杂度。**成本极低，风险实际存在，建议最先处理。**

### 缺口一：构建期从第三方 CDN 下载可执行代码

`project.inlang/settings.json`：

```json
"modules": [
  "https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@4.4.0/dist/index.js",
  "https://cdn.jsdelivr.net/npm/@inlang/plugin-m-function-matcher@2.2.6/dist/index.js"
]
```

`project.inlang/.gitignore` 的内容是 `*` + `!settings.json`，经 `git ls-files` 确认该目录下只有 `settings.json` 被跟踪，`project.inlang/cache/` 未纳入版本控制。

因此**每次 CI 构建都会从 jsdelivr 下载并执行这两个模块**，且：

- 没有 integrity / SRI 校验
- 没有 lockfile 记录其内容 hash
- URL 中的版本号是 npm 版本号，但内容由 CDN 提供，不受 `package-lock.json` 保护
- jsdelivr 不可用时构建失败；jsdelivr 被投毒时构建产物被污染，且不会被任何现有检查发现

这是本次评估中唯一的**安全性**问题，其余各项均为工程质量问题。

**修复方案**：将两个插件作为常规 npm devDependency 安装，`settings.json` 的 `modules` 改为本地路径引用（inlang 支持 `./node_modules/...` 形式的本地模块路径，需按当前 inlang 版本确认具体写法）。若本地路径不被支持，退而求其次：将 `project.inlang/cache/` 纳入版本控制，使内容变更在 diff 中可见。

**优先级：最高。** 成本约为一次依赖调整，风险为零。

### 缺口二：sitemap 通过回读构建产物恢复已有信息

`astro.config.mjs:33-53` 的 `isIndexablePage`：

```
const html = await readFile(new URL(relativePath, outDirUrl), 'utf8');
return !/<meta name="robots" content="[^"]*\bnoindex\b/.test(html);
```

在构建过程中读取自己刚生成的 `dist/**/*.html`，用正则匹配 `<meta name="robots">` 判断页面是否 noindex。

该实现耦合了三件本不应耦合的事：

1. `trailingSlash: 'always'` 设置与 URL → 文件路径的映射规则（`astro.config.mjs:39` 手工拼接 `index.html`）
2. `dist/` 的输出目录结构
3. `astro-seo` 生成 `<meta name="robots">` 的确切属性顺序与格式

其中第 3 点最脆弱：`astro-seo` 若改变属性顺序（如输出 `content="noindex" name="robots"`），正则静默失配，所有 noindex 页面会重新进入 sitemap，且不会有任何错误。

而这个信息在页面渲染时是已知的——`BaseLayout` 的 `noIndex` prop（`src/layouts/BaseLayout.astro:16`）、`PostLayout.astro:95` 的计算、`BaseHead.astro:43` 的 `shouldNoIndex`。

**修复方案**：在渲染时把 indexability 记录到一处构建期可访问的数据结构（如一个集成中收集的 Set，或写入一个中间产物文件），sitemap 的 `serialize` 从该结构读取，不再回读 HTML。需要一个小型 Astro 集成来承载该状态。

**优先级：中。** 当前工作正常，但失效方式是静默的，且直接影响 SEO 与 `development-preview-production/Preview-同时使用-HTML-与-HTTP-noindex，并且不生成可索引站点地图.md` 这条契约。

### 缺口三：`tsconfig.json` 的 include 范围过宽

`tsconfig.json:3`：`"include": ["**/*"]`，`"exclude": ["dist"]`。

这会把 `design/`（原型 HTML 与 JS）、`.astro/`（生成物）、`src/paraglide/`（生成的 172 个消息模块）、`scripts/`、`test-results/` 全部纳入类型检查范围。影响 `npm run check` 的耗时，并可能因生成代码的类型问题产生噪音。

**修复方案**：显式列出需要检查的目录，或扩充 `exclude`。低风险改动。

### 验收标准

缺口一：`npm ci && npm run build` 在完全断网（除 npm registry 外）的环境中成功。缺口二：`development-preview-production/Preview-同时使用-HTML-与-HTTP-noindex...` 案例通过，且人为改变 astro-seo 输出格式时该机制应报错而非静默失配。缺口三：`npm run check` 耗时下降。

---

## 11. 全局关键 CSS 体积

**性质**：偶然复杂度。严重度最低，列出以备完整。

### 现状证据

`dist/_astro/global.*.css`：**222 KB 原始 / 70.3 KB gzip**，作为渲染阻塞样式表在每个页面加载。其中包含 **133 条 `@font-face`** 与 **113 条 `unicode-range`**。

来源（`src/styles/global.css:1-6`）：

```css
@import 'tailwindcss';
@import '@fontsource-variable/noto-sans-sc/wght.css'; /* CJK 百余个子集切片 */
@import '@fontsource-variable/jetbrains-mono/wght.css';
@import '@fontsource-variable/jetbrains-mono/wght-italic.css';
@import 'katex/dist/katex.min.css'; /* 约 24 KB */
```

Noto Sans SC 的子集切片是体积主体。`dist` 中有 130 个 woff2 文件。与第 5 项的 `font-display: block` 叠加：关键 CSS 越大，首帧越晚，而首帧之前 body 是 `visibility: hidden` 的。

`.cache/fonts/NotoSansMonoCJKsc-VF.ttf` 的存在表明已有字体处理流程，可作为改造起点。

### 与行为契约的关系

`locale-theme-fonts/频繁更新文章不得使稳定中文字体缓存随内容变化整体失效.md` 是关键约束：**不能**按每篇文章的实际用字做子集化，那会使字体缓存随内容变化失效。这条契约排除了最激进的优化路径。

`locale-theme-fonts/字体加载失败必须进入可读回退状态，缺字不得显示方框.md` 要求子集覆盖必须完整。

### 变更方案

在契约允许的范围内，可行方向有限：

1. **KaTeX CSS 按需加载**。约 24 KB，但只有含公式的文章需要。可从 `global.css` 移出，改为在文章布局中按需引入。收益明确，风险低。**推荐先做这一项。**
2. **JetBrains Mono italic 按需加载**。等宽斜体使用面窄，可评估是否值得进入全局关键路径。
3. **Noto Sans SC 的切片策略评估**。当前是 fontsource 的默认切片。可评估是否存在更适合本站的切片粒度——但必须以「切片边界稳定、不随内容变化」为前提，且需与第 5 项的 revision 机制配合。**收益不确定，建议最后评估。**

### 验收标准

`locale-theme-fonts/` 相关案例通过。度量：`global.css` 的 gzip 体积；含公式与不含公式文章的关键 CSS 体积差异。

---

## 实施路线

不建议按编号顺序执行。建议分四批：

### 第一批：低成本、高确定性（可立即开始，互不依赖）

| 项    | 内容                                  | 预期成本 |
| ----- | ------------------------------------- | -------- |
| 10-一 | inlang 插件改为本地依赖               | 极低     |
| 10-三 | 收窄 `tsconfig.json` 的 include       | 极低     |
| 6-1   | `wrangler types` 生成 Worker 绑定类型 | 低       |
| 8-3   | `package.json` 依赖归属标注           | 极低     |
| 11-1  | KaTeX CSS 移出全局关键路径            | 低       |
| 2     | git 时间戳改为批量提取                | 中低     |

这一批不改变任何用户可观察行为，可用现有 e2e 套件直接回归。

### 第二批：收敛真相源（依赖第一批完成）

| 项       | 内容                                       | 预期成本 |
| -------- | ------------------------------------------ | -------- |
| 3-第一步 | locale 真相源收敛，消除三处正则字面量      | 中       |
| 4        | 首屏内联脚本由构建期生成，消除六处逻辑拷贝 | 中高     |
| 10-二    | sitemap indexability 不再回读 HTML         | 中       |

第 4 项是第二批的核心，也是后续所有工作的基础——它让首屏关键路径进入类型系统。

### 第三批：建立测试中间层（与第二批可并行）

| 项  | 内容                                       | 预期成本 |
| --- | ------------------------------------------ | -------- |
| 9-1 | 补控制器单元测试，从 `client-runtime` 开始 | 中高     |
| 9-2 | 拆分 `site.spec.ts`，与行为案例目录对齐    | 中       |
| 9-5 | 评估 main 分支双次 e2e 的简化空间          | 低       |

**这一批必须在第四批之前完成。** 路由层迁移的风险只能由测试覆盖来控制，在没有控制器级测试的情况下动路由层是不可接受的。

### 第四批：路由层迁移（依赖第三批）

| 项     | 内容                                                                       | 预期成本 |
| ------ | -------------------------------------------------------------------------- | -------- |
| 1-验证 | 用最小原型验证 `astro:before-preparation` 的异步 loader 能承载字体就绪契约 | 低       |
| 1      | swup → ClientRouter 迁移                                                   | 高       |
| 5-3    | 「阻塞换页直到字体就绪」抽象为路由器无关的接口                             | 中       |

**第 1 项以验证步骤为门禁**：若异步 loader 验证失败，整批中止，改为在 swup 上做局部改进（消除对 `@swup/a11y-plugin` 私有属性的覆写）。

### 未排期（需先做设计或收益不明确）

- 6-3 根路由边缘协商：需按「已保存语言优先」契约重新设计，收益与复杂度需权衡
- 7 可视化栈收敛：需先逐条核对 `research-interactions/` 的 20 个案例确认哪些图确实需要交互
- 8-1/8-2 文章依赖边界工具化或 workspaces：当前规模下成本大于收益
- 11-3 CJK 字体切片策略：收益不确定
- 3-第二步 Paraglide 路由机制收敛：需先确认对消息函数行为的影响

## 明确不建议改动的部分

以下几项在评估中被审视过，结论是保持现状：

1. **字体就绪状态机的整体设计**（第 5 项）。它服务于至少 6 条明确的行为契约，改用 `font-display: swap` 会直接违反其中的禁止状态。只调整耦合面，不动契约。
2. **纯静态输出 + 旁挂 Worker 的组合**（第 6 项）。引入 Cloudflare adapter 会影响 `browser-cache-artifacts/` 与 `development-preview-production/` 中建立在静态产物之上的多条契约（不可变版本地址、预览隔离、构建产物复用）。第 6 项的所有改进都可在现有结构下完成。
3. **Vega 与 Plotly 并存**（第 7 项）。两者解决不同问题，且 Vega spec 已有全站质量最高的单元测试（`tests/unit/closed-loop-control-timing.test.ts`）。为统一而统一会破坏既有测试资产。
4. **`claimClientRuntime` 注册表**（第 1 项）。即使迁移到 ClientRouter，页面级控制器的生命周期仍需显式管理。只需更换其订阅的事件源。
5. **npm workspaces 化文章依赖**（第 8 项）。在交互式文章不超过 5 篇时，成本大于收益。

## 度量基线

以下数据采集于 2026 年 8 月 27 日的一次 `npm run build`，供改动前后对比。

| 指标                              | 数值                           |
| --------------------------------- | ------------------------------ |
| `dist/` 总体积                    | 22 MB                          |
| `dist/_astro/`                    | 11 MB                          |
| `dist/pagefind/`                  | 1.3 MB                         |
| HTML 页面数                       | 118                            |
| woff2 文件数                      | 130                            |
| `global.css`                      | 222 KB / 70.3 KB gzip          |
| `global.css` 中 `@font-face` 条数 | 133                            |
| `plotly-gl3d.min.js`              | 1591 KB                        |
| `vega.module.js`                  | 502 KB                         |
| `page-router.js`                  | 39 KB / 12.2 KB gzip           |
| `SiteChrome.js`                   | 44 KB                          |
| e2e 代码行数                      | 4388（`site.spec.ts` 占 3040） |
| 单元测试文件数                    | 7                              |
| 行为案例总数                      | 198                            |
| 全站消息条数                      | 172（其中 62 条属于单篇文章）  |

## 修订记录

- 2026-08-27：首次评估。初稿曾将字体就绪子系统判定为可删除的过度工程，在与 `docs/site-behavior-cases/locale-theme-fonts/` 对照后更正为必然复杂度，仅保留耦合面相关的建议。
