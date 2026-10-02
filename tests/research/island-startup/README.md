# 研究图表启动

- 目的：确认两类研究文章的客户端岛能够增强为真实可渲染的图表，而非仅创建外层容器或 Plotly 的 no-WebGL 回退。
- 触发：访问 Frenet 与闭环控制文章并等待图表容器。
- 预期：Frenet 二维图表可见；默认下载的 Playwright Chromium 中三维图具有未丢失且 drawing buffer 非零的 WebGL canvas；闭环 SVG 图表可见。
- 自动化覆盖：覆盖两个代表实现的启动完成状态，并以真实 WebGL 上下文阻止 `.plot-container` 存在造成的假绿。
- 盲区：仅检查代表图表的启动，可见容器不等于每个交互都正确。
