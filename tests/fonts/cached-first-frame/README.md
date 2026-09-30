# 缓存字体首批帧

- 目的：缓存刷新同时保持正文可见、正确字体和稳定排版，不接受先隐藏再显示。
- 触发：Cloudflare Static Assets fixture 预热后刷新；另覆盖普通 Astro preview 重新验证独立字体文件。
- 预期：独立 `.woff2` 文件 的 Resource Timing 条目以零 transferSize、非零 decodedBodySize 证明缓存复用；每个正文已存在的采样帧都必须可见、实际 FontFaceSet.check 成功，且字体与几何从第一帧起稳定。
- 覆盖：英文首页、中文博客、代码文章和 KaTeX 公式。
- 限制：Resource Timing 不区分内存与磁盘缓存；文档内 rAF 不覆盖跨文档画面，连续刷新像素验收由 `tests/navigation/refresh-continuity/` 承担。
