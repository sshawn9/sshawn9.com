# Solid 客户端组件的开发期 SSR 导入

Astro 在开发模式收集 MDX 样式时会导入组件模块，即使组件声明了 `client:only="solid-js"`。工作区内容包中的 Kobalte 和 lucide-solid 必须经过 Vite 的 Solid 条件解析与 SSR 转换，不能交给 Node 直接执行它们的客户端编译产物。

回归使用本站实际 `vite.ssr` 配置和 Solid 插件，在无浏览器 DOM 的 Node 环境导入完整 `FrenetExplorer.tsx`，并在模块失效后重新求值。缺少 Kobalte 配置会在其顶层 `template()` 报错；只修 Kobalte 则会暴露 lucide-solid 的同类错误。

测试使用独立临时缓存，不监听端口、不监听文件变化，不共享开发服务的优化产物；结束后关闭运行器并删除自身缓存。它验证模块导入边界，不模拟 Astro 的全部 MDX/HMR 时序；实际文章加载和图表交互需通过开发服务及现有 research 浏览器用例验收。

修改共享 SSR 配置后，开发服务验收前应重启 `npm run dev`；仅刷新浏览器不保证旧进程重新加载配置模块。
