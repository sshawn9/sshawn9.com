# 审计剩余事项

初次核对日期：2026-09-15。诊断源码基线：`8e5c1900ef3a4b8ca9de7b4b7e107d0cf31198b2`。

本页只保留[原审计](2026-09-13/report.md)尚未处理的事项，不重复已完成的修复。原报告 D 节的五条线索按原顺序编号为 D01–D05，后续回归发现的问题从 D06 继续编号。查明原因不等于已修复；“受控时序”表示诊断人为安排了操作先后，不能当作正常访问已经发生同样故障。

初次整理只核对代码、执行本地诊断并记录，没有修改业务源码、正式测试或线上配置；后续完成项从本页移除，修复记录保留在原审计中。诊断版本为 Playwright `1.63.0`、默认 Chromium `153.0.8010.12`、Astro `7.3.1`、Plotly `4.0.0`，未操作个人 Chrome。当时使用的构建标注提交为 `4beee1f`；它与诊断源码基线之间，下述导航、字体、聚焦控制器及 Frenet 交互实现均无差异。

## 已确认、尚未修复

### B05：旧壁纸还能保留，但照片淘汰后无法上报下载

浏览器的当前照片不会因为候选名单更新就强制替换；服务器却只在当前候选池中查找下载上报身份。两者有效期不同。

本地对照使用 250 张合法照片，再加入一张更新的照片：池仍为 250 张，最老的 `photo-0` 被淘汰。上报该照片返回 404，不调用上游；上报仍在池中的 `photo-249` 返回 202，并调用模拟的下载上报接口。没有访问真实 Unsplash。

客户端先完成文件下载，再发上报请求，而且不检查非成功 HTTP 状态。因此文件保存成功不代表上报成功。**待决定并实现历史照片上报身份的保留方式和有效期**，同时保留上报失败的可观察性。

源码：[Worker](../../worker/index.ts)、[当前照片与名单更新](../../apps/site/src/features/appearance/wallpaper/system.ts)、[下载和上报](../../apps/site/src/features/appearance/wallpaper/download.ts)。

## 需要决策或明确暂缓

### B01：旧 iPad 上真正需要使用的弹层

壁纸设置、窄屏站点导航、窄屏文章目录及版本比较入口仍依赖原生 Popover，没有旧浏览器等价实现。普通版本切换链接本身不依赖它。Safari 从 17 才支持这套能力，[WebKit 官方发布说明](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/#popover)可核对；用户反馈的设备是 iPadOS 16.3.1。

待决定：提供基本可用的降级，还是明确提高支持下限。降级需要覆盖隐藏、开关、焦点和关闭行为，不能只给缺失的方法加空函数。这与 A01 的通用异常收尾不是同一个问题。

源码：[设置入口](../../apps/site/src/components/site-shell/SiteHeaderUtilities.astro)、[站点导航](../../apps/site/src/components/SiteShell.astro)、[文章版本入口](../../apps/site/src/features/article/components/ArticleVersionSwitcher.astro)、[弹层生命周期](../../apps/site/src/runtime/transient-overlay-controller.ts)。

### B04：部署到 Cloudflare 的 Preview 照片池由谁维护

Preview 配置关闭 Cron；访客接口只读；仓库部署流程不初始化或同步照片池。因此绑定空池时不会靠多访问几次自动得到照片，已有池也没有这套配置中的定期更新路径。

这不等于当前 Preview 线上一定为空：真实绑定是否共享、是否人工预置，本轮没有核查。**按此前决定留待另议。** 需要确定共享生产池、同步数据或独立更新中的维护方式。日常本地 dev／preview 代理线上 API，不属于这里的空池问题。

依据：[wrangler.jsonc](../../wrangler.jsonc)、[部署流程](../../.github/workflows/site-deployment.yml)、[本地代理](../../apps/site/astro.local.config.mjs)。

### B06：字体失败时是否仍应允许阅读，减少动画时是否应持续提示等待

目前这是明确保留的策略，不是自动认定的实现错误：

- 必需字体失败时一直等待，文字不提交，没有超时后的系统字体回退。
- 减少动画模式把等待动画缩到单次极短播放；随后没有常驻可见的等待提示。

待决定：是否允许字体失败后的基本阅读回退，以及等待期间是否显示静态提示。改变前需明确视觉取舍，并同时调整行为测试，不直接移除现有约束。

依据：[字体实现](../../apps/site/src/runtime/required-fonts.ts)、[减少动画样式](../../apps/site/src/styles/reduced-motion.css)、[现有 ADR](../rearchitecture/ADR-002-client-runtime-and-state-ownership.md#必需字体)。

### C02：是否抽取博客与文章侧栏的重复机械交互

两份控制器仍重复实现拖动、键盘调宽、持久化、折叠动画及清理，方向、状态字段和默认宽度不同。这是结构简化候选，不是已确认的功能故障。

**状态：你此前认为存疑，暂缓。** 若重新评估，应比较抽取共同机制后的总复杂度；不为了少几行代码增加通用组件框架。

源码：[博客侧栏](../../apps/site/src/features/blog/runtime/blog-sidebar-controller.ts)、[文章侧栏](../../apps/site/src/features/article/runtime/article-sidebar-controller.ts)。

### C04：Paraglide 仍有“两个站点应用”的旧注释

[paraglide.ts](../../packages/site-i18n/src/paraglide.ts) 的注释仍写着 `Both site applications`，与当前单站点应用结构不符。只需更新注释，不涉及国际化行为或重新划分包边界。

## 尚未定位的现象

### D04：桌面刷新时整页短暂闪黑

历史上发生过，随后浏览器状态变化后暂不复现，根因仍未确定。原录屏仍位于 `/home/star/Videos/Video_2026-09-13_04-24-12.mp4`；当时一些浏览器诊断仅存在 `/tmp`，本轮核对时已丢失。

本轮没有获得当时的浏览器状态，也没有操作个人 Chrome。不能用新开浏览器正常排除本站问题，不能用 D05 新标签的现象替代这次刷新故障的证据。仍需要在原现象再次出现时关联同一次刷新的屏幕画面、文档提交、资源加载和实际绘制记录。

## 尚缺验证，不等于已经发现缺陷

- **旧 iPad 实机验收**：iPadOS 16.3.1 Safari／Chrome 下，实际弹层可用性、背景模糊、静态图排版、聚焦滚动与关闭、触摸交互。Chromium 自动化和 CSS 产物检查不能替代这些结果。
- **其他浏览器与辅助技术**：原审计没有完成 Firefox／WebKit 的实际页面验收，也没有屏幕阅读器验收；不把“测试文件存在”当作已覆盖。
- **原审计明确未覆盖的领域**：实际 Cloudflare 绑定与权限、依赖漏洞全量扫描、真实网络配额／代理、长期内存、全文数学证明、逐条外链可用性。它们是尚未开展的验证范围，不自动视为待修复漏洞，也不在本轮擅自扩展执行。
