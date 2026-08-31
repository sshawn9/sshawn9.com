# 网站行为测试证据基线

本文记录重构开始前的测试证据现状。它不把现有测试数量等同于行为覆盖率，也不声称 198 个案例已经全部自动化。

## 证据类型

每个行为案例最终至少要指向一种主要证据，并在风险需要时组合多种证据：

| 证据           | 适用范围                                                     |
| -------------- | ------------------------------------------------------------ |
| 单元或组件测试 | 纯状态转换、内容模型、几何、排序、去重、错误分类             |
| 浏览器行为测试 | 导航、历史、焦点、滚动、响应式、失败回退和客户端生命周期     |
| 连续帧视觉测试 | 首帧稳定、闪烁、布局位移、动画时序、字体替换和背景过渡       |
| 人工设备测试   | 原生指针、触摸、拖动手感、系统字体、真实浏览器和主观视觉质量 |
| 平台集成测试   | Cloudflare 缓存、Access、版本地址、预览隔离、发布和回滚      |

最终截图不能替代连续帧证据，本地预览不能替代实际边缘平台证据。

## 当前自动化资产

重构基线包含 56 个生产 Playwright 场景和 43 个 Vitest 场景；截至 M4.7，Vitest 共 105 项，正式 v2 另有 50 项独立 Playwright 场景。一个测试可能支持多个行为案例，一个案例也可能需要多种证据，因此不能把场景数直接换算成 198 个案例的覆盖率。

| 行为领域                       | 当前主要证据                                                                                                              | 当前状态与关键缺口                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 刷新、导航与客户端生命周期     | `tests/e2e/site.spec.ts`                                                                                                  | 已覆盖无脚本导航、进度、焦点和部分刷新时序；缺跨构建版本、完整连续帧和更系统的快速导航事务证据                            |
| 全站结构、响应式与视觉边界     | `tests/e2e/site.spec.ts`                                                                                                  | 有桌面和移动断言；没有独立视觉基线，iPad/Safari 和横向溢出组合仍需人工或额外项目验证                                      |
| 语言、主题与字体               | v2 语言、外观和字体 E2E/单元测试、旧站对应测试                                                                            | v2 已覆盖语言边界、主题首帧/持久和字体独立降级；仍缺跨浏览器与真实平台证据                                                |
| 轮换景观背景                   | `apps/site-v2/tests/e2e/appearance-wallpaper.spec.ts`、队列与 Worker 单元测试                                             | v2 已覆盖本地副本同图首帧、六次硬刷新、真实失败正文直出、单次过渡、队列和下载上报；仍缺主观连续帧、跨浏览器与边缘平台证据 |
| 博客列表、标签和左侧 Sidebar   | `tests/e2e/site.spec.ts`、`apps/site-v2/tests/e2e/blog-listing.spec.ts`                                                   | v2 已按领域拆分并覆盖静态回退、筛选、历史、连续首帧、键盘调宽、滚动和响应式；仍缺真实触摸、性能阈值与平台证据             |
| 文章、右侧 Sidebar、目录和版本 | `apps/site-v2/tests/e2e/article-sidebar-toc-versions.spec.ts`、版本/Sidebar 单元测试、旧站对应测试                        | v2 已覆盖静态阅读顺序、Sidebar 首帧、深滚动目录、永久版本、比较懒加载/容器响应/失败回退；仍缺跨浏览器、真实触摸与平台证据 |
| 内容、标签、项目与媒体         | 项目/文章/标签单元测试、`apps/site-v2/tests/e2e/projects-media.spec.ts`                                                   | v2 已覆盖项目解析、静态回退、语言回退、自动关联、持久导航和显式附件查看器；引用质量与图文语义仍需人工编辑验收             |
| 搜索                           | `apps/site-v2/tests/e2e/search.spec.ts`、搜索查询状态单元测试                                                             | v2 已覆盖精确索引范围、双语、URL、键盘、返回滚动、无脚本及组件/索引/分片失败；缺真实部署中入口与分片跨版本一致性测试      |
| 研究交互与项目可视化           | `apps/site-v2/tests/e2e/research-interactions.spec.ts`、`apps/site-v2/tests/e2e/projects-media.spec.ts`、相关模型单元测试 | v2 已覆盖无脚本/失败回退、字体依赖、真实控件、主题、聚焦、离场清理、单实例与项目拖动；真实触摸、跨浏览器和长任务仍归 M5   |
| 开发、预览、生产与发布         | `tests/e2e/deployment-mode.spec.ts`、`.github/workflows/verify.yml`、`.github/workflows/site.yml`                         | 草稿、noindex、sitemap 和产物复用有证据；缺分支隔离、不可变版本、Access、回滚和失败不改流量的自动平台验收                 |
| 浏览器缓存与部署产物           | 构建配置与少量 Worker 响应头单元测试                                                                                      | HTML/静态资源缓存、浏览器条件请求、边缘命中和搜索分片代际一致性尚无完整自动化                                             |
| 验收与故障判定                 | 案例文档及现有排障过程                                                                                                    | 属于测试方法本身；需要把冷/温缓存、延迟注入、系统 Chrome 和平台复核固化为可重复的测试运行配置                             |

## 已确认的测试架构债务

- `tests/e2e/site.spec.ts` 超过 3000 行，跨越导航、字体、壁纸、两个 Sidebar 和版本比较，已经失去清晰的领域边界。
- 多个测试直接断言 `#swup`、`window.swup`、`site:*` 事件和 `data-swup-*` 属性。这些是旧实现证据，不是行为契约；重构时必须改成用户结果和公开语义断言。
- 当前 Playwright 只有 Chromium 项目，不能单独证明 Safari/iPad 或 Firefox 的兼容行为。
- 当前生产测试还没有正式连续帧视觉回归套件；隔离 POC 已建立该能力，但尚未迁回生产测试目录。
- 当前没有自动连接实际 Cloudflare Preview 的平台测试层。

## 隔离重构 POC 的新增证据

下列测试位于 `experiments/rearchitecture/`，不计入上面的生产测试数量，也不代表对应领域已经全部完成。它们用于证明新架构能否承载既有行为契约：

| 行为契约组               | POC 证据                                                                                                                           | 已覆盖边界                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 导航、字体与快速取消     | `tests/e2e/astro-resilience.spec.ts`、`tests/unit/font-coordinator.test.ts`                                                        | 旧页等待、字体失败、迟到导航、显式结果分类                                      |
| 初始文档与连续帧         | `tests/e2e/astro-visual-frames.spec.ts`、`tests/e2e/vertical-slice.spec.ts`、`tests/unit/initial-frame.test.ts`                    | 冷启动慢字体、边界超时/异常释放、静态壳层/关键区先于 island、刷新滚动原子恢复   |
| 历史项与多滚动区         | `tests/e2e/astro-resilience.spec.ts`、`tests/unit/state-ledger.test.ts`                                                            | 同路径多历史项、正文/目录独立恢复、损坏状态和写入失败                           |
| 系统主题与存储降级       | `tests/e2e/astro-resilience.spec.ts`                                                                                               | 系统实时跟随、显式亮/暗、刷新、损坏值、存储异常和主动 600 ms 过渡               |
| 静态正文与交互岛失败边界 | `tests/e2e/astro-island-resilience.spec.ts`                                                                                        | 同节点水合、稳定几何、按需重型 chunk、两类脚本失败和迟到完成                    |
| 异步资源离场所有权       | `tests/unit/deferred-module.test.ts`                                                                                               | 并发去重、失败分类、`dispose` 后禁止迟到回调                                    |
| 跨构建代际与资产一致性   | `tests/cross-generation/navigation.spec.ts`、`tests/cross-generation/visual-frames.spec.ts`、`tests/unit/build-generation.test.ts` | 双真实产物、旧运行时零 swap、A/B 资产隔离、未知 ID、状态恢复和完整 A/B 可呈现帧 |

隔离 POC 的跨构建证据来自本地双产物服务器；`BCP-001` 已于 2026-08-29 批准，但这些证据仍不能替代 Cloudflare Preview。Chromium 已具备 DOM 每动画帧采样、浏览器 screencast、filmstrip 与原始视频四类连续帧证据。正式 v2 使用固定文档末端 marker 作为解析与字体需求扫描边界；壁纸/底色不受字体阻塞，经登记的文字表面以实际字形或 1.8 秒固定回退一次提交。Firefox/Safari 的真实连续帧和无脚本证据仍未完成；其余主要缺口是真实最长文章性能、完整移动/键盘矩阵和平台验证。

## 正式 v2 的当前证据

M3.3 已把基础运行时、完整静态基础页面与首帧证据迁入正式应用，而不是继续扩展 POC：

| 边界                     | 正式证据                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 构建代际与状态 schema    | `tests/unit/v2-build-generation.test.ts`、`tests/unit/v2-state-ledger.test.ts`                                                     |
| 字体首帧与有限失败路径   | `tests/unit/v2-font-coordinator.test.ts`、`tests/unit/v2-initial-frame.test.ts`、`apps/site-v2/tests/e2e/font-first-frame.spec.ts` |
| 绘制前主题与共享实现     | `tests/unit/v2-document-preferences.test.ts`、`tests/unit/v2-initial-frame.test.ts`                                                |
| 初始静态文档解析边界     | `tests/unit/v2-initial-frame.test.ts`、`apps/site-v2/tests/e2e/foundation-pages.spec.ts`                                           |
| 进度时序与过期事务       | `tests/unit/v2-navigation-feedback.test.ts`                                                                                        |
| 持久外壳的显式语义同步   | `tests/unit/v2-site-shell-controller.test.ts`                                                                                      |
| 标签领域与博客视图状态   | `tests/unit/v2-blog-view-state.test.ts`、`tests/unit/v2-blog-sidebar-state.test.ts`                                                |
| 文章 Sidebar 与目录状态  | `tests/unit/v2-article-sidebar-state.test.ts`                                                                                      |
| 版本比较选择与响应规则   | `tests/unit/v2-version-comparison.test.ts`                                                                                         |
| 项目解析与内容关系       | `tests/unit/projects.test.ts`                                                                                                      |
| 完整静态页面与连续首帧   | `apps/site-v2/tests/e2e/foundation-pages.spec.ts`                                                                                  |
| 正式 ClientRouter 的接线 | `apps/site-v2/tests/e2e/runtime.spec.ts`                                                                                           |
| 博客列表与左侧 Sidebar   | `apps/site-v2/tests/e2e/blog-listing.spec.ts`                                                                                      |
| 文章、目录、版本与比较   | `apps/site-v2/tests/e2e/article-sidebar-toc-versions.spec.ts`                                                                      |
| 语言路由与内容语言边界   | `tests/unit/v2-locale-navigation.test.ts`、`apps/site-v2/tests/e2e/locale-navigation.spec.ts`                                      |
| 项目、内容关系与媒体     | `apps/site-v2/tests/e2e/projects-media.spec.ts`                                                                                    |
| 全站搜索与 Pagefind      | `tests/unit/v2-search-query-state.test.ts`、`apps/site-v2/tests/e2e/search.spec.ts`                                                |
| 研究交互与项目可视化     | `apps/site-v2/tests/e2e/research-interactions.spec.ts`、`apps/site-v2/tests/e2e/projects-media.spec.ts`                            |

正式 Chromium 集成测试已经证明：首页、About 和普通文章在无脚本时仍是完整文档；固定末端 marker 位于完整静态内容之后；深滚动硬刷新在首个可见帧恢复；预绘制主题与标题几何连续稳定。同一套正式测试还证明同构建导航保持外壳节点、跨语言后语义同步、慢导航反馈、快速取消不迟到，以及目标 HTML 构建 ID 不一致时不发生客户端 swap 而执行完整文档导航。M4.1 进一步证明博客和标签页的完整静态回退、并集筛选与历史同步、筛选和第二页冷进入连续帧、Sidebar 指针与键盘几何、折叠和宽度首帧恢复、标签独立滚动及移动端同一内容树。M4.2 证明文章头、支持信息、正文的批准顺序，桌面正文左/Sidebar 右布局，历史版本自身元数据，Sidebar 首帧与目录深滚动恢复，以及比较页的按路由懒加载、实际容器响应、手动覆盖和资源失败回退。M4.3 证明中立静态入口的偏好解析与无脚本链接、同代语言切换的持久外壳/query/hash/点击滚动、跨代完整文档的首帧滚动转移，以及界面 `<html lang>` 与回退正文 `<article lang>` 的职责分离。M4.4/M4R.6 证明主题和景观背景的绘制前恢复、六次同图硬刷新、真实失败正文直出、持久状态、单次过渡及下载上报边界；主题已改为实时 DOM token 过渡，主观连续帧仍待验收。M4.5 证明项目页完整静态回退、语言与正文回退、自动文章关联、同壳导航，以及显式附件的无脚本链接、按需查看器、Escape 关闭和焦点返回。M4.6 证明 38 个批准页面按语言精确建索引，查询、URL、键盘、返回滚动一致，且无脚本或组件、索引、分片失败时有限释放到静态导航。M4.7 证明研究文章在无脚本或绘图库失败时仍可读，现有 Plotly/Vega/Frenet/闭环和项目拖动在 v2 中正常工作，且主题、聚焦、离场和再次进入遵守单实例生命周期。代际门测试通过修改一次客户端 HTML fetch 验证。双真实构建、跨浏览器和 Cloudflare Preview 仍保留在 M5。

## 目标测试结构

重构测试按行为领域组织，而不是按组件或框架组织：

```text
tests/
├── unit/                 纯领域逻辑与基础设施状态机
├── contract/             完整 HTML、导航、历史、滚动、失败回退
├── visual/               首帧、连续帧、动画和布局稳定
├── interaction/          研究图形、触摸、键盘和高频输入
└── platform/             Preview、缓存、Access、版本和回滚
```

每个测试通过行为案例相对路径引用其证据目标。路径是唯一标识，不在测试中复制完整需求文本。共享 helper 只封装浏览器操作和采样机制，不能隐藏业务断言。

## 重构准入门槛

正式替换生产路由前，至少补齐以下跨领域证据：

1. 博客列表进入最长研究文章再返回的冷、温缓存连续帧记录；
2. 字体延迟、字体失败、脚本延迟和快速连续导航；
3. 主滚动区、标签 Sidebar 和文章目录滚动区的历史项恢复；
4. 同构建导航的持久外壳身份，以及跨构建版本的安全降级；
5. 禁用 JavaScript 后的完整 HTML、导航、文章、标签链接和搜索回退；
6. Chromium 自动化，加上 Safari/iPad、Firefox 和系统 Chrome 的明确人工清单；
7. 实际 Cloudflare Preview 中的静态资产直出、缓存策略、Access 和不可变版本验证。
