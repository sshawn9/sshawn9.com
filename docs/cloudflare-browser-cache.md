# Cloudflare Workers 静态站点的浏览器缓存

本文说明本站当前的浏览器缓存决策及其正确性边界。仓库中的配置是事实来源；Cloudflare 边缘节点和浏览器最终收到的响应头仍须在部署后验证。

## 请求边界

`wrangler.jsonc` 将 `apps/site/dist/` 作为 Workers Static Assets 目录，并且只让 `/api/wallpapers` 与 `/api/wallpapers/download` 优先进入 Worker。普通 HTML 和静态文件由 Static Assets 提供，构建时从 `apps/site/public/` 原样复制的 `_headers` 为这些响应增加规则。

`_headers` 不控制 Worker 代码生成的响应。因此壁纸清单、不可用响应和下载上报的缓存策略分别由 `worker/index.ts` 设置，不能通过本文所述的静态资源规则推断。

还需区分两层缓存：`CF-Cache-Status` 描述 Cloudflare 边缘缓存，不代表浏览器可以长期直接复用本地副本；浏览器主要依据响应中的 `Cache-Control` 和验证器处理自己的缓存。

## 当前规则

规则的唯一配置来源是 `apps/site/public/_headers`：

| URL 范围                        | 浏览器缓存规则                        | 原因                                                                                      |
| ------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `/_astro/*`                     | `public, max-age=31536000, immutable` | 包括壁纸启动脚本在内的构建资源使用内容哈希文件名；内容不变时 URL 不随构建 ID 改变。       |
| `/pagefind/pagefind-entry.json` | `public, max-age=31536000, immutable` | 页面把本次构建 UUID 作为 Pagefind `meta-cache-tag`，使元数据请求的查询参数随构建改变。    |
| 其他静态文件                    | 不自定义                              | HTML、robots、sitemap、Web Manifest 和 Pagefind 其余文件沿用 Static Assets 的默认响应头。 |

`_headers` 还为匹配的 `workers.dev` 地址设置 `X-Robots-Tag: noindex`。这是索引策略，不是缓存策略；配置存在不代表这些地址已经在线可达或绕过访问控制。

Cloudflare 当前文档说明，普通静态请求未携带 `Authorization` 或 `Range` 时，默认返回 `Cache-Control: public, max-age=0, must-revalidate`；Static Assets 同时提供 ETag，自定义 `_headers` 可以覆盖默认响应头。该描述是平台契约，不等同于本站当前生产域名已经实测为相同结果。

## 正确性条件

- `/_astro/*` 下只能存在带内容指纹的构建资源。若以后自定义 Astro 输出文件名，必须继续保留内容哈希；不要把可原地更新的文件手工放入该路径。
- 壁纸启动脚本由 `config/classic-script-bundles.mjs` 在 Astro 构建中编译并输出为内容哈希资源，没有独立编译步骤或 `.cache` 中间文件；HTML 仍以同步经典脚本加载它，不改为延迟执行。新部署不额外保留旧文件：发布交界时取得旧 HTML 且没有可用脚本缓存的访问，可能加载失败；新版部署正常时刷新可恢复。
- Pagefind 元数据的长期缓存依赖每次构建生成新的 ID，并把同一 ID 同时写入 HTML、客户端代码和 `meta-cache-tag`。不能去掉、固定或复用旧标记后继续保留该入口的 `immutable` 规则。
- 不要为 `/*` 统一设置长期缓存。文章内容最终是稳定 URL 的 HTML；重新部署后，浏览器应先重新验证 HTML，再从新文档取得新的哈希资源 URL 和搜索构建标记。
- `apps/site/public/` 中的其他文件由 Astro 原样复制，不会仅因位于 `public/` 而自动获得内容指纹。

修改服务端规则不会主动撤销浏览器已经保存的 `immutable` 响应。若修正错误的长期缓存策略，应同时使用新的资源 URL 或构建标记，不能只改 `_headers` 后假定旧缓存立即失效。

`tests/build/artifact-identity/` 检查 HTML、客户端和 Pagefind 请求使用同一构建 ID；`tests/search/deployment-cache/` 检查新构建不会复用上一部署长期缓存的元数据入口。这些测试覆盖应用的代际协议，不验证 Cloudflare 实际解析 `_headers` 后的线上响应。

## 部署验收

发布后应在生产域名以及本次部署的不可变版本 URL 分别检查：

1. HTML 仍要求重新验证，没有获得一年 `immutable`；
2. 一个实际存在的 `/_astro/*` 资源具有一年 `immutable`；
3. HTML 的 `data-wallpaper-system-entry` 引用真实存在的 `/_astro/` 哈希脚本，响应具有一年 `immutable`，且脚本仍在首屏同步执行；
4. 带当前构建查询参数的 `/pagefind/pagefind-entry.json` 具有一年 `immutable`，换一次部署后查询参数发生变化；
5. robots、sitemap、Web Manifest 和其他稳定 URL 没有意外继承长期缓存；
6. 两个 `/api/wallpapers` 端点仍返回 Worker 代码各自声明的缓存头。

这一步还应记录 `Cache-Control`、ETag 和 `CF-Cache-Status`，但不能用边缘 `HIT` 代替浏览器缓存策略的核对。Cloudflare 控制台中的 Zone 级规则不在仓库内，若存在，也须与实际响应一起单独核实。

## 参考

- [Cloudflare Workers Static Assets：自定义响应头](https://developers.cloudflare.com/workers/static-assets/headers/)
- [Cloudflare Workers Static Assets：请求路由与缓存](https://developers.cloudflare.com/workers/static-assets/)
- [Astro：项目结构与 `public/` 目录](https://docs.astro.build/en/basics/project-structure/)
- [Astro：构建资源文件名](https://docs.astro.build/en/recipes/customizing-output-filenames/)
- [Pagefind：`meta-cache-tag`](https://pagefind.app/docs/search-config/#meta-cache-tag)
