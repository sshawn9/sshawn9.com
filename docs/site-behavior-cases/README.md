# sshawn9.com 网站行为案例

本目录以真实使用场景记录网站必须保持的行为。每个案例分别说明场景、正确行为、禁止状态和验收方法；实现与测试只能作为证据，不能反向定义行为。

## 使用方式

- 行为案例描述用户可观察结果，不绑定 Astro、Solid、Swup、Pagefind 或 Cloudflare 的当前实现。
- 任一“禁止状态”在观察窗口内出现，即使最终画面正确，仍然属于失败。
- 修改网站行为时，先定位相关案例，再决定是否需要更新实现、测试或案例本身。
- 自动化测试不能覆盖真实视觉、系统指针、原生滚动或边缘平台时，保留明确的人工验收步骤。
- 本目录中的 198 个案例当前全部生效；未经批准，不得因为重构、换框架或测试难度而降低要求。

## 治理与证据

- [行为契约治理](./GOVERNANCE.md)：契约分类、变更审批、实现术语与用户结果的边界。
- [测试证据基线](./TEST-COVERAGE.md)：当前自动化证据、人工/平台证据和重构期间必须补齐的缺口。
- [跨部署导航边界提案](./proposals/BCP-001-cross-generation-navigation.md)：已批准；规定跨构建代际使用完整文档导航。
- [文章阅读顺序提案](./proposals/BCP-002-article-reading-order.md)：已批准；规定文章头、支持信息、正文的线性顺序与桌面视觉布局解耦。
- [Pagefind 标准加载与 Escape 提案](./proposals/BCP-003-pagefind-standard-loading-and-escape.md)：已批准；允许搜索结果区使用官方骨架并采用标准清空语义。

行为案例的相对路径就是稳定标识，例如
`refresh-navigation-lifecycle/站内导航只替换页面出口，站点外壳保持同一实例.md`。测试、缺陷和架构决策应引用这个路径，不再维护一套容易漂移的数字编号。

## 目录

| 文档                                                                  | 范围                               | 案例数 |
| --------------------------------------------------------------------- | ---------------------------------- | -----: |
| [刷新、导航与客户端生命周期](./refresh-navigation-lifecycle/)         | 刷新、导航与客户端生命周期         |     14 |
| [全站结构、响应式与视觉边界](./site-structure-responsive-visual/)     | 全站结构、响应式与视觉边界         |      9 |
| [语言、主题与字体](./locale-theme-fonts/)                             | 语言、主题与字体                   |     15 |
| [轮换景观背景](./scenic-wallpaper/)                                   | 轮换景观背景                       |     19 |
| [博客列表、标签筛选与左侧 Sidebar](./blog-tags-sidebar/)              | 博客列表、标签筛选与左侧 Sidebar   |     29 |
| [文章页面、右侧 Sidebar、目录与版本](./article-sidebar-toc-versions/) | 文章页面、右侧 Sidebar、目录与版本 |     27 |
| [内容索引、标签、项目与媒体](./content-tags-projects-media/)          | 内容索引、标签、项目与媒体         |     21 |
| [站内搜索](./search/)                                                 | 站内搜索                           |      9 |
| [交互式研究文章与项目可视化](./research-interactions/)                | 交互式研究文章与项目可视化         |     20 |
| [开发、预览、生产与发布](./development-preview-production/)           | 开发、预览、生产与发布             |     21 |
| [浏览器缓存与部署产物](./browser-cache-artifacts/)                    | 浏览器缓存与部署产物               |      6 |
| [验收与故障判定](./validation-failure-classification/)                | 验收与故障判定                     |      8 |

合计 198 个案例。
