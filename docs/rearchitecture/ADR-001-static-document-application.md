# ADR-001：采用静态文档应用架构

- 状态：已接受；用于正式站点实现
- 日期：2026-08-28
- 接受日期：2026-08-29
- 决策范围：渲染模型、客户端增强、托管边界和框架职责

本记录保留架构选择及其理由；具体交互以当前确认的需求为准。不同构建之间使用完整文档导航，首次文字呈现等待必需字体，本站最终呈现与交互需要 JavaScript。

## 背景

本站同时具有静态内容站和文档应用的特征：

- 每个 URL 必须直接返回完整、可读、可索引的 HTML；
- HTML 保留完整语义、可索引内容；本站交互与最终呈现明确要求 JavaScript；
- 站内导航需要连续壁纸、稳定 Header、动画、取消、历史和多个滚动区恢复；
- 长研究文章中的重型图形必须独立按需启动；
- 首个可见文字帧必须直接稳定；冷缓存可保留背景与进度线并等待必需字体；
- 普通请求优先由 Cloudflare 免费静态资源层直接服务。

选择需要同时解决静态交付和导航连续性，避免为了局部交互把整篇正文纳入客户端组件树。

## 决策

采用“静态文档应用”模型：

1. Astro 负责内容编译、路由展开和完整 HTML 静态生成。
2. Astro 官方 ClientRouter 是唯一的客户端文档导航器。
3. Header 由每个目标文档的 Astro HTML 直接提供；只有必须保持画面连续的壁纸视觉层跨页持久化。
4. 页面正文保持 Astro HTML；复杂交互按岛屿独立服务端渲染并按需水合。
5. 本站自有的复杂交互岛使用 Solid；普通增强使用 TypeScript，第三方图形、媒体和搜索库保留自身运行时。
6. Pagefind 承担构建后静态搜索；输入、结果呈现与查询状态的分工见 [ADR-002](ADR-002-client-runtime-and-state-ownership.md#语言与搜索边界)。
7. Cloudflare Static Assets 直接服务页面和资源；Worker 负责显式路由的壁纸 API、Cron 和 KV。
8. 不引入常驻 SSR，也不要求额外服务器。

2026-08-29 选型时，Astro 垂直切片验证了完整静态 HTML、连续导航、状态恢复与隔离交互岛。同期测试的 Qwik City SSG 方案在客户端导航中把完整正文再次交付进路由 JavaScript，因正文重复交付而未被选用。这是当时版本和实现的比较，不是对各框架后续版本能力的永久判断；实验源码不作为长期架构依赖保留。

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

壁纸 API ──► Cloudflare Worker ──► KV / Cron / Unsplash
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

## 依赖方向

具体目录和修改入口见 [应用说明](../../apps/site/README.md)。目录可以按职责调整，以下边界避免内容、框架和运行时互相渗透：

- `site-domain` 不导入 Astro、Solid、DOM 或 Cloudflare API；
- `apps/site` 的内容配置、Markdown 和 Git 适配只在构建期把领域事实接到 Astro/Node 边界，与浏览器运行时和纯领域代码分开；
- `site-i18n` 是全站唯一的消息与语言策略来源；
- `content-ui` 可以依赖领域和 i18n 包，但不得回头导入任一应用源码；
- `content` 只能通过包出口取得交互实现，不得导入应用内组件、库或样式实现；
- UI 组件调用明确的领域/runtime 接口，不读取隐藏全局变量；
- `worker/` 与浏览器 runtime 不互相导入；共享内容只能是纯类型、schema 或纯函数；
- 框架专用适配代码停留在边界，不能渗入内容和状态模型。

## CSS 与字体边界

- 全站只保留一层稳定的设计 token、基础布局和字体声明；它在导航期间不被删除。
- 页面源样式归所属 `features/` 管理，并由所属页面或组件显式导入；Astro 负责生成页面块与跨页共享块。交互岛继续拥有自己的局部样式。
- 不允许组件水合后向 head 注入决定页面主要几何的样式。
- 布局默认值、绘制前偏好恢复和客户端接管共用状态解析与投影规则，避免接管时再次可见修正。
- 字体准备属于导航准备阶段，不能通过先替换正文再等待字体实现。

## Cloudflare 部署模型

- 一次发布必须包含彼此匹配的 HTML、索引、脚本、样式、字体和 Worker 代码。
- 带内容哈希的资源长期缓存；稳定 URL 默认重新验证。Pagefind 元数据入口是显式例外，其请求查询参数随构建改变，具体规则见 [缓存说明](../cloudflare-browser-cache.md)。
- 分支预览与不可变版本地址继续隔离。
- HTML 缓存优化不能成为正确性的前提；客户端使用构建 ID 防止不同代际运行时混合。
- 普通静态请求不得为了统计、ETag 或路由进入 Worker。

相关平台能力以 [Cloudflare Static Assets](https://developers.cloudflare.com/workers/static-assets/) 和 [版本与部署](https://developers.cloudflare.com/workers/versions-and-deployments/) 为依据。

## 取舍与升级

- 仍需自行实现状态账本、字体准备、精确首帧边界和构建代际门，但它们被隔离成可独立测试的基础设施模块。
- 依赖版本由包配置与锁文件管理，可以升级；升级时核对版本耦合的适配点与测试探针，按风险验证受影响契约，不以保留旧版本代替验证。
- 交互岛统一使用 Solid；静态外壳和普通增强不得为了共享少量状态扩大 island 边界。
- `rel=expect` 的自动化证据目前来自 Chromium；Firefox/Safari 的支持或等价降级仍是生产迁移门槛。

不采用自建路由器或全站 SSR，是因为当前需求下增加的状态协议与服务端运维成本没有相应收益；需求或工具能力改变时可以重新评估。平台验收、生产切换与回滚状态以 [迁移计划](MIGRATION.md) 为准，不由本 ADR 推断。

## 参考

- [Astro Islands](https://docs.astro.build/en/concepts/islands/)
- [Astro 组件](https://docs.astro.build/en/basics/astro-components/)
- [Astro 客户端脚本](https://docs.astro.build/en/guides/client-side-scripts/)
- [Astro ClientRouter 与视图过渡](https://docs.astro.build/en/guides/view-transitions/)
- [Astro Solid 集成](https://docs.astro.build/en/guides/integrations-guide/solid-js/)
- [HTML `rel=expect`](https://html.spec.whatwg.org/multipage/links.html#link-type-expect)
