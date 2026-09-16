# 首帧初始化失败

单元测试隔离首帧脚本的两条完成边界：页面侧栏等准备失败不能阻止字体准备；字体成功后，滚动或目录放置失败仍必须释放文本 gate 并报告原错误。另验证晚到字体回调不触碰已替换的 body，以及成功路径保留 root scroll、TOC、nested scroll 的顺序。

同时验证字体未决／拒绝时保持 loading，同步字体路径放置报错仍释放文字；runtime-ready 前后原生导航保护正确移除；语言切换位置优先于历史记录且不混用嵌套滚动快照。

真实字体准备失败仍保持 loading，属于既有 B06 等待策略，不由这些用例改写。真实 HTML 内联执行路径由 `tests/navigation/initialization-failure/browser.spec.ts` 另行验证，不能只用隔离单测声称首帧可读。
