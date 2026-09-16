# B01：旧浏览器弹层兼容，暂缓处理

2026-09-17 决定：暂不修复，不默认引入兼容库或第二套弹层实现。以后确认实际使用确有需要，再评估收益、兼容成本和实机验证结果。

## 问题与影响

本站壁纸设置、窄屏站点导航、窄屏文章目录和版本比较入口使用浏览器原生 Popover。缺少这项能力时，浏览器不会自动提供面板的默认隐藏、按钮开关和外部点击关闭等行为，可能出现面板常驻或按钮无效。

用户曾在 iPadOS 16.3.1 的 Safari 和 Chrome 反馈此类问题；该设备换 Chrome 并不能获得新版 WebKit 的 Popover 能力。原生支持起点为 [Safari 17](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/)、[Chromium 114](https://developer.chrome.com/blog/new-in-chrome-114?hl=en)、[Firefox 125](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/125)，并非只按 Safari 版本判断，也不表示达到这些版本就没有其他浏览器缺陷。

不受此项直接影响：普通目录锚点、普通版本切换链接，以及不使用 Popover 的桌面侧栏折叠／调宽。宽屏不参与交互的移动目录已不再运行其弹层操作；A01 的初始化失败清理也已另行修复。两者不等于给旧浏览器补齐弹层功能，B01 也不是之前背景模糊问题的修复范围。

## 何时重新考虑

当仍需使用的旧设备上，导航、设置或文章操作确实受阻，且不能接受现状时，再启动兼容设计。不能仅因为审计清单存在这一项就实施，也不能只靠现代 Chromium 中删除 API 的模拟宣布旧 iPad 已兼容。

届时优先比较成熟兼容库与基本可用的降级，不自行复制完整标准。核对默认隐藏、开关、外部点击／Esc 关闭、焦点、面板互斥、窄宽切换、站内导航和初次加载，尤其是祖先裁切和遮挡。现成兼容库也无法真正模拟浏览器最顶层显示机制，参见 [Popover polyfill 的限制](https://github.com/oddbird/popover-polyfill#caveats)。

源码入口：

- [共享弹层生命周期](../../apps/site/src/runtime/transient-overlay-controller.ts)
- [站点导航](../../apps/site/src/components/SiteShell.astro)与[壁纸设置](../../apps/site/src/features/appearance/components/WallpaperSettings.astro)
- [文章移动目录](../../apps/site/src/features/article/components/ArticlePage.astro)与[版本比较入口](../../apps/site/src/features/article/components/ArticleVersionSwitcher.astro)

本文件只记录问题和暂缓决定，不表示已选定修复方案、增加了兼容依赖或提高了全站浏览器支持下限。
