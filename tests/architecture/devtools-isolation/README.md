# 开发工具不得进入生产应用依赖图

验证开发工具不会进入生产应用依赖图或 Astro 配置。扫描应用源码与配置文本触发；预期无 devtools/content-health 引用。文本检查不等同于完整 bundler 依赖图。
