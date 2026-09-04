# ADR-002：客户端运行时与状态所有权

- 状态：已接受；用于正式站点实现
- 日期：2026-08-28
- 接受日期：2026-08-29
- 决策范围：导航、状态恢复、绘制前状态、字体、滚动和组件生命周期
- 用户可见变化：仅 `BCP-001` 已批准的跨代际完整文档导航边界；其余视觉与交互参数保持不变

## 核心规则

1. ClientRouter 是唯一导航所有者；本站代码不再实现路由、head 合并、脚本执行或历史索引。
2. 每类状态只有一个所有者和一个持久化位置。
3. 客户端运行时按职责拆成小型 TypeScript 模块；可复用逻辑使用显式类型化参数，不使用全局注册表或字符串事件总线。
4. 页面行为由其岛屿或自定义元素生命周期拥有，离开 DOM 即释放。
5. 首帧恢复代码通过构建期入口直接导入运行时的类型、schema 和纯函数，不复制实现或序列化函数源码。

## 组合根

`BaseLayout` 是文档生命周期的组合边界；静态 SiteShell 本身不水合：

```text
BaseLayout（Astro 静态文档）
  ├── WallpaperSystem（head 启动并独立持续运行）
  ├── SiteShell.astro（目标文档权威 Header）
  ├── BackdropVisual（唯一持久 DOM 子树）
  ├── InitialDocument（末端 marker 前同步准备当前文档）
  ├── SiteRuntime（唯一的正常浏览器运行时组合根）
  │   ├── NavigationCoordinator（代际、进度、字体门槛、转场和焦点）
  │   ├── PageRuntime（页面准备与当前页面挂载/销毁）
  │   ├── TransientOverlayController（短暂浮层）
  │   └── Content UI custom-element definitions
  └── 页面交互岛（各自拥有 mount/unmount）
```

目标文档是 Header 文案、链接、当前项和可访问语义的唯一权威来源。独立 WallpaperSystem 从 head 的同一个入口运行，在交换前投影主题、壁纸、署名和控件状态；跨页只移动纯壁纸视觉层，不再保留旧 Header 并手工复制目标属性。其余长期控制器只由 SiteRuntime 安装，组合根持有每个销毁函数。

PageRuntime 是博客、文章和搜索页面的准备、挂载与销毁所有者；它通过显式类型化函数向 NavigationCoordinator 提供目标文档准备能力，后者只负责把这一步排在字体门槛和离场动画之前。旧页面在 swap 前销毁，新页面在 `page-load` 挂载，同一 `main` 不重复挂载。普通文档离开时 SiteRuntime 统一释放监听、动画帧和计时器；进入浏览器 back-forward cache 时保留实例，让冻结文档恢复后继续工作。

所有入口都只使用 Astro 的公开生命周期事件和明确 DOM 语义，不读取 `window.swup`、`window.__...`，也不按名称查找全局 controller。页面级资源仍必须自行提供精确的 `destroy()`；Solid 岛继续由框架拥有 mount/unmount。

静态外壳避免在首屏关键结构之前执行框架 island bootstrap。普通 TypeScript 只增强已有可访问 HTML；Solid 仅在独立交互岛中使用。共享 codec、字体加载器和滚动应用函数保持纯净或显式依赖，因此初始文档脚本与正常导航运行时可以复用同一实现。

## 导航事务

框架实际事件顺序是：

```text
before-preparation
  └── loader(): fetch → parse target document → preload target styles
      └── local preparation: generation check → page preparation → target font preparation → outgoing transition
after-preparation
before-swap
  └── framework swap
      └── framework main-scroll restore
after-swap
  └── nested-scroll restore
page-load
  └── target scripts/islands ready for normal lifecycle
```

Astro 当前事件对象在 `before-preparation` 创建时把 `newDocument` 初始化为当前 `document`。只有原始 `loader()` 完成后，`newDocument` 才是目标文档。因此任何目标文档判断都必须包装并先调用原始 loader，不能在事件刚触发时读取。

建议的导航阶段是可穷举联合类型，而不是散落布尔值：

```ts
type NavigationPhase =
  | { kind: 'idle' }
  | { kind: 'preparing'; id: number; from: URL; to: URL; startedAt: number }
  | { kind: 'swapping'; id: number; to: URL }
  | { kind: 'settling'; id: number; to: URL };
```

事务 ID 只用于拒绝迟到的本地异步结果；取消权属于 ClientRouter 提供的 `AbortSignal`，本站不得再维护第二个导航 AbortController。

### `before-preparation`

1. StateLedger 只为硬刷新首帧和嵌套滚动保存快照，不参与普通目标页面主滚动决策。
2. 导航状态进入 `preparing`，沿用现有进度提示延时和最短显示时间。
3. 包装原始 `loader()` 并等待它完成。
4. loader 失败、非 HTML、目标不支持客户端导航或事务被取消时，交给框架原生回退。
5. loader 成功后读取目标构建 ID；跨代际按已批准的 `BCP-001` 保存状态并执行完整文档导航。
6. NavigationCoordinator 仅在交换边界等待目标文档的 RequiredFonts Promise；字体模块不读取导航状态，等待期间旧页面完整、可读且控件仍可操作。

### `before-swap`

- WallpaperSystem 把主题、背景模式、署名和控件状态投影到目标文档；
- 不删除旧样式，不手写 head 合并；
- 不自行替换 DOM，只允许框架 `swap()` 执行一次；
- 导航状态进入 `swapping`。

### `after-swap` 与 `page-load`

- 框架完成普通主滚动恢复后，本站只处理语言切换位置转移和目标历史项的嵌套滚动区；
- 目标 Header 直接携带正确的 `aria-current`、语言和链接语义，不再执行客户端属性对账；
- 页面岛通过自身 mount/unmount 接管，不扫描并重放所有页面脚本；
- `page-load` 后结束进度策略，进入 `idle`。

## 状态账本

### 状态所有权表

| 状态                                          | 权威来源                                     | 原因                                 |
| --------------------------------------------- | -------------------------------------------- | ------------------------------------ |
| locale、route、tag、page、query、version      | URL                                          | 可分享、可刷新、可由服务端独立重建   |
| 普通客户端导航的主滚动                        | Astro ClientRouter 的历史状态                | 避免两个运行时同时恢复窗口位置       |
| 硬刷新首帧快照与嵌套滚动                      | `history.state.sshawn9`                      | 浏览器不管理嵌套区；刷新必须首帧稳定 |
| 主题、壁纸开关、语言偏好、Sidebar 几何        | `localStorage`                               | 跨标签页会话或跨会话的用户偏好       |
| 当前/下一张壁纸、随机队列、一次性导航状态转移 | `sessionStorage`                             | 固定双槽位，只在当前标签页存活       |
| 导航进度、打开的全局浮层                      | 对应文档级控制器内存与语义 DOM               | 瞬时 UI，不应写入存储                |
| 页面内交互参数                                | 交互岛本地状态；需要历史恢复时写命名 channel | 不把所有组件状态塞进一个全局 store   |
| 文章、语言、版本、标签和项目关系              | 构建期领域模型                               | 内容事实，不由浏览器推断             |
| 构建代际                                      | HTML meta + 构建常量                         | 检测目标文档与当前运行时是否匹配     |

### History schema

本站状态必须保存在自己的命名空间，同时保留 Astro 和浏览器的未知字段：

```ts
type SiteHistoryStateV1 = {
  version: 1;
  routeKey: string;
  page: { x: number; y: number };
  regions: Record<string, { x: number; y: number }>;
  channels?: Record<string, unknown>;
};
```

- 写入使用 `{ ...history.state, sshawn9: nextSiteState }`，禁止覆盖整个 `history.state`；
- 读取必须 schema 校验、数值钳位并安全忽略未知版本；
- 嵌套滚动按历史项保存，不能只按 pathname 保存；
- `channels` 只接受登记过的类型化 codec，不能成为任意对象垃圾场；
- 存储失败时退化为默认状态，不能阻塞核心导航。

### 语言与搜索边界

- 带语言前缀的 URL 是当前界面语言的权威来源；中立 `/` 只按“已保存偏好 → 浏览器语言 → 英语”选择入口，不建立服务端语言会话。
- 语言切换保持同一逻辑内容身份、query 和 hash；回退正文只在内容根标明实际语言，不能反向改变界面语言。
- 搜索查询以 URL 为权威来源，HTML 与 Pagefind 索引属于同一构建代际。
- Pagefind 官方组件拥有输入、结果、键盘、播报和加载语义；本站接线只负责 URL、历史恢复、构建代际和有限失败释放，不复制结果 DOM 或建立第二套搜索状态机。

### 主题与景观背景边界

- 主题与景观开关使用共享偏好；当前照片、下一张照片和队列使用每标签页固定双槽位；可见 DOM 只是状态投影。
- WallpaperSystem 的状态入口只有 `reload()` 和 `advance()`：配置、环境和恢复变化统一重载投影，手动与自动换图统一执行完整换图事务；换图后的备用槽补齐不属于 `advance()` 的等待范围。
- 下载响应通过校验、解码并成功写入槽位后才能成为当前或下一张；有效同图刷新直接恢复同一份字节，不重新请求或播放淡入。
- 新文档只更新下一张所用的图片策略，绝不以视口策略变化替换正在显示的当前照片。
- 同构建导航只持久化壁纸视觉层；WallpaperSystem 自己把主题、背景模式和控件状态投影到目标文档，导航协调器不依赖壁纸模块。
- Worker 只读取 Cron 维护的 KV 清单、代理明确的下载上报并持有密钥；访客读取不得隐式刷新清单，普通 HTML 不进入 Worker。

## 绘制前恢复

初始文档保留三个职责明确的入口：

1. head 中的 WallpaperSystem 单一入口：读取偏好和当前槽位并立即投影，随后由同一实例异步检查下一槽位；
2. head 中的 `<link rel="expect" href="#initial-frame-ready" blocking="render">`：目标是 `SiteRuntime` 前固定的文档末端 marker，只在支持的浏览器中等待静态 HTML 解析到该处，不等待字体、图片或客户端模块；
3. marker 前的 InitialDocument 入口：此时完整 DOM 和 CSS 已登记；它先恢复当前页面可计算状态，再用 `FontFaceSet.check()` 同步处理温缓存，以唯一 RequiredFonts 接口等待冷缓存，最后提交滚动位置和文字表面。

固定末端 marker 使支持 `rel=expect` 的浏览器在首次提交前拥有完整静态布局，也给字体请求一个可靠的内容边界。冷缓存期间只保留独立壁纸/底色与进度线；`[data-font-surface]` 在所有必需字体成功后一次显示。温缓存由同步检查在 render boundary 前直接提交，不产生加载帧。

WallpaperSystem 与 InitialDocument 都由可维护 TypeScript 入口构建成同源 classic script；构建产物不作为第二份源码维护。InitialDocument 在构建期直接打包业务函数，所有普通页面嵌入完全相同的脚本，不使用 `Function.prototype.toString()` 或页面专属源码模板。约束如下：

- 无动态 import、无框架初始化，所有存储读取都经过共享 codec；
- 主题、语言、布局和可计算的滚动状态必须同步准备；
- 字体准备使用当前内容实际字符选中 unicode-range 分片；不设置超时或回退提交；
- 字体只能控制经登记的文字表面，不能隐藏壁纸、底色或进度反馈；图片和第三方资源不能控制正文可见性；
- 初始文档不播放揭示动画；运行时接管只能确认同一状态，不能再做一次可见修正；
- 体积设置构建预算。

此前的 CSS 全局可见性门把壁纸、装饰与正文绑在同一个异步期限内，是刷新暗帧和慢资源放大的根源。当前边界只管理文字表面，不遮挡壁纸和页面底色，也不等待图片或客户端模块。

## 必需字体

RequiredFonts 是无持久状态的独立资源边界：

- 全站字体声明稳定存在于全局样式；Latin 字体自托管并预加载，中文继续按 unicode-range 分片；
- 唯一接口 `prepareRequiredFonts(fontDocument, declarationDocument, options)` 在温路径同步返回，在冷路径返回就绪 Promise；它不拥有导航、进度、滚动、壁纸或页面动画；
- 不使用 localStorage 推测缓存；温刷新只相信当前文档的 `FontFaceSet.check()`，并在 render boundary 前同步提交；
- 初始文档、目标文档和动态结果都从自身真实字符推导所需的 Latin、CJK、斜体、等宽与 KaTeX 字体；
- 冷初始文档等待时隐藏已登记文字表面；客户端导航等待时保留完整旧页；动态内容只约束自身提交边界；
- 所有必需字体成功才解析 Promise；失败保持 pending，不显示 fallback，也不循环重试；
- 可被替代的导航或动态内容复用所属事务的 `AbortSignal`，取消只终止等待，不建立第二套状态机。

生成 HTML 曾在 SiteShell 之后、首屏静态区域完成之前插入并执行 island bootstrap，产生“只有部分静态 DOM”的真实中间帧。静态 SiteShell 与固定文档末端 marker 消除了该解析窗口。字体协调器之前又在 CSS 登记前执行，并且 `FontFaceSet.load()` 未传实际文字，导致 CJK 分片未准备却错误放行；随后所有文档无条件进入异步准备，让热刷新也暴露一帧隐藏文字。现在初始文档与客户端导航共用同一请求推导；当前文档已加载的精确字形同步提交，冷文档才进入有限异步准备。

## 页面生命周期

- Solid 岛使用框架 mount/unmount；
- 简单 DOM 增强优先使用拥有 `connectedCallback`/`disconnectedCallback` 的自定义元素；
- 文档级监听只存在于 SiteRuntime 明确组合的窄职责 controller，并随该 `Document` 一起释放；
- 页面功能不得直接订阅 Astro 全局生命周期；统一由 PageRuntime 挂载和销毁；
- 页面岛不能注册永不释放的 document/window 监听；
- 不保留 `claimClientRuntime(name)` 这种按字符串抢占实例的注册表；
- 不模拟 `site:before-swap`、`site:after-swap`、`site:page-load` 第二套生命周期。

## 错误与降级

| 故障                         | 行为                                                         |
| ---------------------------- | ------------------------------------------------------------ |
| ClientRouter 获取/解析失败   | 原生文档导航                                                 |
| 新导航覆盖旧导航             | 框架 signal 取消旧准备，旧事务不能提交                       |
| 必需字体失败                 | 背景和进度线保留，文字不提交；可替代事务仍可取消             |
| local/session/history 不可用 | 使用安全默认值，不阻塞完整 HTML                              |
| 页面岛加载失败               | 保留 SSR 正文、图注、链接和明确静态回退                      |
| 构建代际不一致               | 按已批准的 `BCP-001` 保存状态并执行完整文档导航              |
| 首帧字体或必要脚本失败       | 壁纸/底色与进度线始终可见；文字表面保持未提交                |
| 浏览器不支持 `rel=expect`    | 按普通静态 HTML 渐进解析与绘制；生产前完成该浏览器连续帧验收 |
| View Transition 不可用       | 使用经过行为测试的动画 fallback；不得擅自改成无过渡整页突变  |

## 禁止重新引入的模式

- 第二个路由器或 head 管理器；
- 以字符串名称连接的全站事件总线；
- 同一状态同时存在 URL、store、DOM dataset 和 storage 四个相互回写的权威副本；
- 页面级巨型 controller 扫描整个文档并认领所有组件；
- 用固定 timeout 代替字体的真实就绪信号；
- 用 `visibility`、`opacity` 或覆盖层建立跨资源的全局页面门；字体只可约束显式登记的文字表面；
- 为测试方便暴露生产全局对象；
- 为少量复用提前建立插件系统、service locator 或通用状态框架。

## 验证要求

- 导航状态机、history codec、存储失败和过期事务使用单元测试；
- ClientRouter 适配器使用最小浏览器集成测试；
- 外壳身份、连续帧、字体阻塞、快速导航和复合滚动使用行为/视觉测试；
- 测试断言用户结果和公开 DOM 语义，不断言框架私有 class 或全局对象；
- 新模块必须能说明职责、公共接口和依赖方向，防止局部修复扩张成新的全局单体。
