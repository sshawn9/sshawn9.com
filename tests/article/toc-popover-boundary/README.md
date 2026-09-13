# 文章目录与原生 Popover 边界

- 目的：隐藏的手机目录不因缺失 Popover JS 能力阻断宽屏文章初始化；移除手写展开状态后，目录和版本弹层仍保留原生无障碍语义与箭头反馈。
- 触发：删除公开 Popover 方法，并让 `Element.matches(':popover-open')` 抛出 `SyntaxError`，分别冷进入文章、从博客列表 SPA 进入；另在原生支持环境打开手机目录并跟随章节链接，在桌面与窄屏开关版本弹层。
- 预期：文章 runtime 就绪，SPA 保持同一文档且导航 pending/busy 清除，右侧目录仍更新片段与活动项并滚动；原生按钮的 AX expanded 状态及箭头与弹层一致，手机目录选项导航后关闭弹层。
- 自动化覆盖：四个 Chromium 浏览器用例。展开状态通过 CDP Accessibility 树读取，不要求浏览器写出 `aria-expanded` DOM 属性。旧代码会在缺失选择器支持的冷启动/SPA 初始化中抛错；另外两例防止删除同步代码时遗留基于显式 ARIA 属性的箭头 CSS，或删掉目录选项关闭行为。
- 盲区：能力注入只模拟缺失方法与 `matches()` 选择器错误，不模拟旧 Safari 的 CSS、原生行为或 VoiceOver；不验收旧浏览器弹层降级及任意初始化失败收尾。弹层互斥、断点切换关闭与焦点恢复由 `tests/overlays` 覆盖，本组不重复。
