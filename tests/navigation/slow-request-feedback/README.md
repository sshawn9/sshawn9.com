# 慢导航反馈

- 目的：同构建导航立即提供 pending/busy；新一段等待的 120ms 显示计时器先于资源准备完成触发时，才启用进度动画。等待期间保留旧页和持久壁纸节点。
- 触发：拦截目标文章的真实 Astro fetch 并逐帧采样；另用假时钟暂停已完成资源准备后的 outlet 离场动画；单元测试直接驱动 revision API。
- 预期：`data-navigation-pending` 表示逻辑等待，`data-navigation-progress` 表示 `active`/`finishing` 视觉阶段；允许首次显示前的宽限帧，进入 active 后 pending、阶段、透明度和动画启用状态在等待结束前不能中断。240ms 最短时长约束的是 active 阶段，不表示条段持续位于屏内；旧版轨迹允许条段阶段性离开视口。资源在宽限期内准备好时，后续 180ms 离场淡出不会补亮进度条。完成立即清除 pending/busy，finishing 按旧版向右退出；若新等待在 finishing 中开始，则取消旧清理、回到 idle，并重新获得完整 120ms 宽限和自己的最短 active 时长。
- 自动化覆盖：浏览器验证慢请求的等待反馈连续性和最终清理，以及快速准备后的离场淡出；单元测试验证精确计时边界、active 接管与 finishing 后独立重启、begin/prepared/finish/cancel/dispose 和 revision 所有权。
- 盲区：节点身份和几何采样不等于逐像素视觉连续；实际合成截图由 progress-visibility 用例覆盖。
