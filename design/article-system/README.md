# 文章系统设计交付包

状态：Design review  
版本：0.2  
日期：2026-07-31  
范围：文章列表、标签、普通文章、多版本文章、历史版本、版本比较  
状态：已同步至生产实现。

## 交付物索引

- [设计评审总入口](./review.html)

### 设计定义

- [产品与设计简报](./01-design-brief.md)
- [信息架构与用户流](./02-information-architecture.md)
- [导航与版本语义](./03-navigation-and-version-model.md)
- [布局与视觉规范](./04-layout-and-visual-spec.md)
- [组件与状态矩阵](./05-component-state-matrix.md)
- [响应式、内容与可访问性](./06-responsive-content-accessibility.md)
- [设计验收与实施门禁](./07-handoff-and-acceptance.md)
- [设计评审决策单](./08-review-decisions.md)

### 图形材料

- [信息架构图](./diagrams/information-architecture.svg)
- [版本阅读流](./diagrams/version-navigation-flow.svg)
- [桌面端低保真线框](./wireframes/desktop.html)
- [移动端低保真线框](./wireframes/mobile.html)

### 高保真原型

- [可交互原型](./prototype/index.html)
- [原型使用说明](./prototype/README.md)

### 导出图

[导出图索引](./exports/README.md)保存由上述原型自动导出的桌面端、移动端 PNG。它们用于评审和视觉回归，不作为实现源文件。

## 本次关键设计决定

1. 全局导航标签仍为“文章”，文章索引不再设置可见 H1 或说明区。
2. 列表入口直接显示文章数量、标签、文章列表与必要分页。
3. SEO 元数据不进入可见内容，不再为填补版面增加说明文案。
4. 所有文章子页面使用同一个面包屑组件和同一布局起点。
5. 删除全部临时“返回……”链接，不再让不同页面自行发明返回语义。
6. 普通文章不出现任何版本界面；存在多个版本时才渲染版本工具。
7. 历史版本使用状态提示解释“正在阅读什么”，不把状态操作伪装成返回导航。
8. 不建立独立版本历史页面，也不提供“固定链接”操作。
9. Diff 允许访问者自由选择任意两个不同版本。
10. 完整删除相邻文章、上一篇、下一篇和 `KEEP EXPLORING` 区域。
11. 文章列表保留分页，不增加年份归档。
12. 标签作为完整信息架构存在：标签索引、标签文章列表、可点击标签和标签分页。

## 评审顺序

1. 先确认 [信息架构](./02-information-architecture.md)。
2. 再确认 [导航与版本语义](./03-navigation-and-version-model.md)。
3. 检查桌面和移动低保真线框。
4. 使用高保真原型走完普通文章、多版本文章、历史版本和自由双版本 Diff。
5. 最后确认视觉规范、状态矩阵和验收清单。

任何一项未确认，都不进入生产实现。
