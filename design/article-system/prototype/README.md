# 高保真原型使用说明

直接打开 [index.html](./index.html)。

原型顶部工具条用于切换页面：

- 文章索引
- 标签索引
- 标签文章
- 普通文章
- 当前版本
- 历史版本
- 版本比较

也可以使用 Hash 直接定位：

```text
#articles
#tags
#tag
#single
#current
#old
#compare
```

查询参数 `?export=1` 会隐藏原型工具条，用于导出评审截图：

```text
index.html?export=1#current
```

原型目的：

- 确认信息层级；
- 确认统一面包屑；
- 确认桌面与移动布局；
- 确认版本功能的出现条件；
- 确认历史版本与自由双版本 Diff 的关系；
- 确认正文底部没有相邻文章模块。

原型不是生产代码，不包含 Astro 数据读取、SEO、构建路由或真实 Diff 算法。
