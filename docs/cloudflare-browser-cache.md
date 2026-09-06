# Cloudflare Workers 静态站点的浏览器缓存策略

本文记录 `sshawn9.com` 在 Cloudflare Workers Static Assets 上的浏览器缓存问题、验证过程、最终策略与适用边界。记录日期为 2026 年 8 月 10 日。

## 当前部署结构

网站使用 Astro 构建为静态文件，构建结果位于 `dist/`，再由 Wrangler 部署到 Cloudflare Workers Static Assets。生产域名为 `https://sshawn9.com`。

当前 `wrangler.jsonc` 将 `dist/` 配置为静态资源目录，并使用 `auto-trailing-slash` 处理 HTML 路由。网站没有通过自定义 Worker 脚本动态生成页面。

构建前后的资源关系如下：

- Markdown 和 MDX 内容在构建时生成路由对应的 HTML，例如 `index.zh.md` 最终成为某个 `dist/zh/.../index.html`。
- 来自 `src/` 的客户端 JavaScript、CSS、字体和经过 Astro 资源管线处理的文件通常输出到 `dist/_astro/`，文件名包含内容哈希。
- `public/` 中的普通文件按原路径复制到 `dist/`，不会因为放在 `public/` 中而自动获得内容哈希。
- Pagefind 在 Astro 构建完成后生成 `dist/pagefind/`。其中包含稳定文件名，因此不能把整个目录无条件视为不可变资源。

浏览器不会直接请求源文件中的 `.md`、`.mdx` 或 `.tsx` 文件。需要分别讨论最终生成的 HTML 和浏览器实际请求的构建资源。

## 需要区分的两层缓存

### Cloudflare 边缘缓存

`CF-Cache-Status: HIT` 表示文件已由 Cloudflare 边缘节点提供。它描述的是 Cloudflare 网络内部的缓存状态，不等于浏览器可以在本地长期直接使用该文件。

### 浏览器缓存

浏览器主要根据响应中的 `Cache-Control`、`ETag` 等标头决定能否直接复用本地副本。`Cache-Control: public, max-age=0, must-revalidate` 表示浏览器可以保存响应，但它会立即变为陈旧状态，再次使用前必须向服务器检查。

因此，`CF-Cache-Status: HIT` 和 `max-age=0` 可以同时出现：服务器侧由 Cloudflare 边缘缓存快速返回，浏览器侧仍然检查内容是否发生变化。

## 修改前的线上实测

在尚未添加 `_headers` 文件时，直接请求生产域名得到以下结果。

首页和博客 HTML：

```http
HTTP/2 200
content-type: text/html
cf-cache-status: HIT
cache-control: public, max-age=0, must-revalidate
```

Astro 生成的哈希 JavaScript：

```http
HTTP/2 200
content-type: text/javascript
cf-cache-status: HIT
cache-control: public, max-age=0, must-revalidate
etag: "59a5b1bcc3aab145e7285ee0d8a2567e"
```

使用该 ETag 发出条件请求时，服务器返回 `304 Not Modified`，说明构建资源能够通过 ETag 完成重新验证。

`robots.txt` 和 `sitemap-index.xml` 同样返回 `max-age=0, must-revalidate`，并带有 ETag。

实测时，Cloudflare 面板中的 Zone 级“浏览器缓存 TTL”为 4 小时，但生产域名和对应的 `workers.dev` 域名仍返回上述 `max-age=0` 标头。这说明当前 Worker Static Assets 请求链路没有被该 4 小时设置覆盖。Cloudflare 的 Worker 规则说明也将客户端到 Worker 的 Browser Cache TTL 列为忽略项。

生产环境中通过规范化路由访问的 HTML 没有观察到 ETag。即使 Cloudflare 的 Static Assets 文档将 ETag 列为默认响应头，也不能据此声称当前 HTML 一定使用 ETag；对这个网站而言，应以实际响应为准。HTML 仍然通过 `max-age=0, must-revalidate` 保证浏览器不会在未重新请求的情况下长期使用旧页面，但服务器可能返回完整的 HTML，而不一定是 `304`。

## 最终策略

### Cloudflare 面板

将 Zone 级“浏览器缓存 TTL”设置为“遵循现有标头”。

这项修改对当前 Worker Static Assets 的线上响应没有观察到直接影响，但它是更合适的域名级默认值：未来同一 Zone 下的其他子域名可以按照各自服务返回的响应头控制浏览器缓存，而不会被统一抬高到 4 小时。

### 仓库中的 `_headers`

在 `public/_headers` 中只配置 Astro 的哈希资源目录：

```text
/_astro/*
  Cache-Control: public, max-age=31536000, immutable
```

Astro 构建时会把该文件复制为 `dist/_headers`，Wrangler 部署 Static Assets 时解析规则。`_headers` 本身不会作为普通静态文件对外提供。

这条规则表示：

- 浏览器可以保存 `/_astro/*` 资源 365 天；
- 在缓存仍然新鲜时，不需要再次验证；
- 资源内容变化后，Astro 会生成新的哈希文件名，新 HTML 将引用新 URL，因此不会继续使用旧内容。

没有为 `/*` 设置统一缓存规则。HTML、robots、sitemap、Web Manifest、Pagefind 和其他稳定 URL 文件继续使用 Workers Static Assets 的默认重新验证策略。

## 为什么只缓存 `/_astro/*`

Astro 默认使用内容哈希命名来自源码的构建资源。例如：

```text
/_astro/component.ABC123.js
/_astro/styles.XYZ789.css
```

当内容变化时，文件名中的哈希也随之变化。长期缓存旧 URL 不会阻止浏览器请求新 URL，这是使用 `immutable` 的必要前提。

实施前对当前构建结果进行了检查：

- `dist/_astro/` 中共有 106 个文件；
- 文件名全部具有哈希形式；
- 仓库不存在人工维护的 `public/_astro/` 目录。

后续不得把没有内容哈希、但可能原地更新的文件手工放入 `public/_astro/`。如果以后自定义 Astro 的构建文件名，也必须保留内容哈希，否则一年 `immutable` 将不再安全。

## Markdown 和 MDX 更新后的行为

Markdown 和 MDX 最终生成稳定 URL 的 HTML，而不是带哈希的文章文件。更新文章并重新部署后：

1. 浏览器重新请求文章 HTML；
2. Cloudflare 返回当前部署中的 HTML；
3. 如果文章引用的客户端代码或 CSS 发生变化，新 HTML 会引用新的 `/_astro/*` 哈希 URL；
4. 浏览器下载新的哈希资源，旧缓存不会干扰新页面。

因此不需要给每篇 Markdown 或 MDX 文章增加任何缓存字段，也不需要改变文章目录结构。

## 本地隔离验证

使用与 CI 一致的 Wrangler 4.120.0，在临时 Static Assets 项目中加入同一条 `_headers` 规则，得到以下响应。

HTML：

```http
Cache-Control: public, max-age=0, must-revalidate
ETag: "e31408f3f6abe5fdebabf0cc9edee560"
```

匹配 `/_astro/*` 的 JavaScript：

```http
Cache-Control: public, max-age=31536000, immutable
ETag: "670ce0ac5ed85d0cedb43505e64df284"
```

结果证明该规则只覆盖目标目录，不会把 HTML 一并设置为一年缓存。这里的本地 HTML ETag 只能证明 Wrangler 隔离环境的行为，不能替代生产环境实测；生产环境中的规范化 HTML 路由仍以线上响应为准。

## 部署后的验证方法

首先确认构建产物包含规则文件：

```sh
npm run build
test -f apps/site/dist/_headers
sed -n '1,20p' apps/site/dist/_headers
```

部署后检查一个 HTML 页面：

```sh
curl -sS -D - -o /dev/null https://sshawn9.com/zh/
```

预期仍然包含：

```http
Cache-Control: public, max-age=0, must-revalidate
```

然后从当前构建结果中选择一个真实存在的 `/_astro/*` URL 并检查：

```sh
curl -sS -D - -o /dev/null https://sshawn9.com/_astro/<实际文件名>
```

预期包含：

```http
Cache-Control: public, max-age=31536000, immutable
```

还应确认 `robots.txt`、`sitemap-index.xml` 和 Pagefind 稳定文件名没有意外获得一年缓存。

## 回退方法

如果部署后响应头与预期不符，删除 `public/_headers` 中的对应规则并重新部署，即可恢复 Workers Static Assets 的默认响应头。浏览器已经缓存的哈希 URL 不需要主动清除，因为它们对应不可变内容；新的构建会使用新的 URL。

## 参考资料

- [Cloudflare Workers Static Assets：Headers](https://developers.cloudflare.com/workers/static-assets/headers/)
- [Cloudflare：Set Browser Cache TTL](https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/set-browser-ttl/)
- [Cloudflare：Page Rules with Workers](https://developers.cloudflare.com/workers/configuration/workers-with-page-rules/)
- [Astro：Customize file names in the build output](https://docs.astro.build/en/recipes/customizing-output-filenames/)
