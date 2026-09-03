# ADR-001：采用静态文档应用架构

- 状态：已接受；用于正式 v2 实现
- 日期：2026-08-28
- 接受日期：2026-08-29
- 决策范围：渲染模型、客户端增强、托管边界和框架职责
- 用户可见变化：`BCP-001` 的跨代际导航边界，以及已批准的必需字体等待与 JavaScript 前提

## 背景

本站同时具有静态内容站和文档应用的特征：

- 每个 URL 必须直接返回完整、可读、可索引的 HTML；
- HTML 保留完整语义、可索引内容；本站交互与最终呈现明确要求 JavaScript；
- 站内导航需要连续壁纸、稳定 Header、动画、取消、历史和多个滚动区恢复；
- 长研究文章中的重型图形必须独立按需启动；
- 首个可见文字帧必须直接稳定；冷缓存可保留背景与进度线并等待必需字体；
- 普通请求优先由 Cloudflare 免费静态资源层直接服务。

普通 SSG 只解决第一项，完整 SPA 会削弱第一、二、四项。目标架构必须同时承载静态文档和有限的应用行为。

## 建议决策

采用“静态文档应用”模型：

1. Astro 负责内容编译、路由展开和完整 HTML 静态生成。
2. Astro 官方 ClientRouter 是唯一的客户端文档导航器。
3. Header 由每个目标文档的 Astro HTML 直接提供；只有必须保持画面连续的壁纸视觉层跨页持久化。
4. 页面正文保持 Astro HTML；复杂交互按岛屿独立服务端渲染并按需水合。
5. Solid 是复杂交互岛的唯一 UI 运行时；普通增强继续使用 TypeScript，不为统一语法重写正确的数学逻辑。
6. Pagefind 继续承担构建后静态搜索，直到它不能满足已定义行为为止。
7. Cloudflare Static Assets 直接服务页面和资源；Worker 只接管明确的 `/api/*`、Cron、KV 和其他可信边缘能力。
8. 不引入常驻 SSR，也不要求额外服务器。

Qwik City SSG 曾作为垂直切片挑战者。它在真实 SPA 导航中把完整文章正文再次交付进路由 JavaScript，触发硬门槛，因此不再作为默认候选。冻结 POC 的长期有效证据已经收敛如下，实验源码不再作为架构依赖保留：

| 验证项                                 | Astro | Qwik |
| -------------------------------------- | ----- | ---- |
| 每个 URL 直接生成完整列表和文章 HTML   | 通过  | 通过 |
| 同构建客户端导航保持全局视觉连续       | 通过  | 通过 |
| 导航载荷不再次包含完整文章正文         | 通过  | 失败 |
| 构建产物可由普通静态文件服务器直接提供 | 通过  | 通过 |

失败依据是正文所有权和重复交付，而不是某次压缩体积排名。Qwik 改用完整文档导航可以避免正文进入路由脚本，但会同时放弃本站要求的同构建导航连续性；Astro 则在同一模型内同时满足两项边界。

## 职责边界

```text
内容文件
  │
  ▼
领域模型 ──► Astro SSG ──► 完整 HTML / CSS / 哈希资源 ──► Cloudflare Static Assets
               │
               ├── 文档 Header（Astro 静态 HTML）
               ├── 持久壁纸视觉层
               ├── 文档生命周期控制器（普通 TypeScript）
               ├── 静态页面出口（Astro HTML）
               └── 独立交互岛（Solid）

/api/* ──► Cloudflare Worker ──► KV / Cron / 外部受信服务
```

### Astro 负责

- 路由和多语言页面展开；
- Markdown/MDX 与类型化内容集合；
- 正文、目录、文章信息、标签链接和静态回退；
- 页面级 head、SEO、站点地图和构建产物；
- ClientRouter 的文档获取、样式准备、交换、历史和可访问性基础行为。

Astro 不是全站客户端状态容器。页面不得为了共享少量状态而被包装成一个完整应用。

### Header 与壁纸边界

- 目标文档的静态 HTML 直接提供 Header、主导航、语言入口、当前项和主题/壁纸控件语义；
- 只对壁纸图片与遮罩组成的纯视觉层使用 `transition:persist`；
- `WallpaperSystem` 在交换前把当前状态投影到目标文档，Header 不再维护手工属性同步协议；
- 导航进度由独立 `NavigationCoordinator` 驱动，跳到正文由页面骨架负责。

Header 不水合、不创建全站组件树，不解析整篇文章，也不拥有页面 Sidebar、文章目录、导航事务或研究图形状态。

### 页面交互岛负责

- 自己的服务端标记、客户端状态和销毁；
- 保留服务端语义标记；增强失败不能损坏已经提交的静态内容；
- 只加载自身所需运行时，不把 Plotly、Vega 等依赖提升到全站入口；
- 不通过全局事件总线寻找自己的 DOM。

### Worker 负责

- 不能暴露给浏览器的密钥和上游调用；
- 壁纸清单、下载上报、定时任务和 KV；
- 将来确有依据的其他 API。

Worker 不接管普通 HTML，仅为了页面路由或状态恢复而执行 Worker 属于架构回退。

## 目录与依赖方向

目标代码按真实职责分层，不引入泛化的企业框架：

```text
apps/site-v2/src/
  features/             页面功能的组件、浏览器行为与源样式
  components/           跨页面静态外壳与首帧组件
  content/              应用侧构建期内容适配
  runtime/              跨页面浏览器基础设施与组合根
  styles/               token、基础元素、外壳与稳定级联入口
packages/site-domain/   内容、语言、版本、标签等纯领域逻辑
packages/site-build/    Astro 内容集合、Markdown 与构建期适配
packages/site-i18n/     唯一消息目录、Paraglide 配置与生成运行时
packages/content-ui/    文章/项目交互组件、模型、样式与显式安装入口
src/content/            MD/MDX、元数据和本地媒体；不放实现代码
worker/                 与页面运行时隔离的边缘代码
```

依赖规则：

- `site-domain` 不导入 Astro、Solid、DOM 或 Cloudflare API；
- `site-build` 只把领域事实接到 Astro 构建边界；
- `site-i18n` 是两代应用唯一的消息与语言策略来源；
- `content-ui` 可以依赖领域和 i18n 包，但不得回头导入任一应用源码；
- `src/content` 只能通过包出口取得交互实现，不得导入旧 `components/lib/styles`；
- UI 组件调用明确的领域/runtime 接口，不读取隐藏全局变量；
- `worker/` 与浏览器 runtime 不互相导入；共享内容只能是纯类型、schema 或纯函数；
- 框架专用适配代码停留在边界，不能渗入内容和状态模型。

## CSS 与字体边界

- 全站只保留一层稳定的设计 token、基础布局和字体声明；它在导航期间不被删除。
- 页面源样式归所属 `features/` 管理，并由所属页面或组件显式导入；Astro 负责生成页面块与跨页共享块。交互岛继续拥有自己的局部样式。
- 不允许组件水合后向 head 注入决定页面主要几何的样式。
- 所有可变尺寸必须由同一个初始状态同时驱动服务端标记、绘制前恢复和客户端接管。
- 字体准备属于导航准备阶段，不能通过先替换正文再等待字体实现。

## Cloudflare 部署模型

- 一次发布必须包含彼此匹配的 HTML、索引、脚本、样式、字体和 Worker 代码。
- 哈希资源长期 immutable；稳定 URL 重新验证。
- 分支预览与不可变版本地址继续隔离。
- HTML 缓存优化不能成为正确性的前提；客户端使用构建 ID 防止不同代际运行时混合。
- 普通静态请求不得为了统计、ETag 或路由进入 Worker。

相关平台能力以 [Cloudflare Static Assets](https://developers.cloudflare.com/workers/static-assets/) 和 [版本与部署](https://developers.cloudflare.com/workers/versions-and-deployments/) 为依据。

## 为什么不是其他主方案

| 方案                 | 不作为默认方案的原因                                                            |
| -------------------- | ------------------------------------------------------------------------------- |
| SvelteKit 全站应用   | 路由和快照优秀，但长静态文章会进入全应用客户端边界；关闭 CSR 又会失去客户端路由 |
| Nuxt 静态生成        | 内容生态成熟，但全应用运行时和 payload 对当前长文档站偏重                       |
| Hugo / Eleventy      | 静态生成优秀，但没有本站需要的导航事务和复合历史恢复；最终仍需自建客户端路由    |
| SolidStart           | 不把正在变化的全栈路线作为绿地核心；现有 Solid 只作为隔离 UI 运行时             |
| 自建 SPA Router      | 会重新制造当前 Swup 外围的 head、脚本、取消、可访问性和生命周期问题             |
| 全站 Worker SSR      | 没有需求收益，却增加请求配额、运行时故障和缓存复杂度                            |
| 仅依赖原生跨文档过渡 | 无法在当前目标浏览器中稳定提供完整视觉连续性和状态恢复                          |

Solid 只用于确实需要组件状态与生命周期的交互岛，不成为外壳、领域或导航核心，因此将来替换 UI 框架不需要重写状态协议。

## 代价

- 仍需自行实现状态账本、字体准备、精确首帧边界和构建代际门，但它们被隔离成可独立测试的基础设施模块。
- Astro ClientRouter 升级可能带来行为回归，必须精确锁定版本并通过完整契约测试后升级。
- 交互岛统一使用 Solid；静态外壳和普通增强不得为了共享少量状态扩大 island 边界。
- `rel=expect` 的自动化证据目前来自 Chromium；Firefox/Safari 的支持或等价降级仍是生产迁移门槛。
- 当前大量依赖 Swup 内部对象的测试需要改写成行为断言。

## 接受依据

1. Astro 垂直切片已经证明完整静态 HTML、视觉连续性、状态恢复、交互岛和跨代际边界可由该模型承载；
2. Qwik 挑战者因导航时重复交付正文触发硬门槛；
3. `BCP-001` 已批准采用跨代际完整文档导航；
4. SiteShell 改为静态 Astro HTML 后消除了早期 UI island 引导代码造成的错误中间帧；
5. 剩余真实内容、跨浏览器和 Cloudflare 平台证据属于正式 v2 的迁移与生产切换门槛，不再扩展 POC。
6. 技术选型结论进入 ADR 后，隔离 POC 的源码、构建产物和测试不再作为长期项目组成保留。

## 参考

- [Astro Islands](https://docs.astro.build/en/concepts/islands/)
- [Astro 组件](https://docs.astro.build/en/basics/astro-components/)
- [Astro 客户端脚本](https://docs.astro.build/en/guides/client-side-scripts/)
- [Astro ClientRouter 与视图过渡](https://docs.astro.build/en/guides/view-transitions/)
- [Astro Solid 集成](https://docs.astro.build/en/guides/integrations-guide/solid-js/)
- [HTML `rel=expect`](https://html.spec.whatwg.org/multipage/links.html#link-type-expect)
- [Qwik 静态生成](https://qwik.dev/docs/guides/static-site-generation/)
- [Qwik Resumability](https://qwik.dev/docs/concepts/resumable/)
