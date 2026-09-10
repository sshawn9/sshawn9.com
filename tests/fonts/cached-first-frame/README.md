# 缓存字体首批帧

- 目的：确认浏览器缓存命中的字体仍经过真实 readiness 判定，且不会暴露回退字体正文。
- 触发：通过 Cloudflare Static Assets fixture 预热页面后刷新；同时保留普通 Astro preview 的字体重新验证场景。
- 预期：字体资源性能条目以 `transferSize = 0`、非零正文尺寸证明缓存命中；页面可同步 ready，也可经历 `loading → ready`，但每个 loading 帧都隐藏正文并保持不透明、已启用动画的等待反馈，ready 后字体和几何稳定。旧版进度条轨迹允许条段阶段性离开视口。
- 自动化覆盖：英文首页标题、中文博客卡片、真实代码块和 KaTeX 字形。
- 盲区：Resource Timing 能区分网络传输与缓存复用，但不能区分浏览器的内存缓存和磁盘缓存。
