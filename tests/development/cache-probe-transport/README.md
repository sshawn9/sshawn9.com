# 缓存探测传输层

验证缓存探测使用一个贯穿整次运行的 Undici client 完成真实 GET，并在轮次之间保留连接池。测试只启动临时本地 HTTP、HTTPS 与 HTTP 代理服务，不访问线上站点。

- 出口 trace、页面和静态资源请求均使用 `ShawnCacheProbe (+https://sshawn9.com)` User-Agent，并在传输元信息中记录。
- 完整读取并验证压缩响应，分别记录线上编码字节数和解码字节数；只有显式设置 `captureLimit` 的 trace 类请求保留正文。
- HTTPS 下依次验证 gzip、deflate、Brotli、Zstd 的正文、编码/解码字节数及同一 TLS 连接复用。`localhost.pem` 是公开的本地测试证书和密钥，不用于部署；先验证未受信任时请求失败，再临时加入测试进程信任，结束后恢复原设置，不关闭证书校验、不依赖外部证书生成工具。
- 收到最终响应头便同步调用 `onHeaders`，即使 429 正文仍悬挂也能立即暂停后续调度；回调异常会中止请求并向调用方抛出。
- 不跟随重定向、不自动重试，不附加 Cookie、条件请求或随机查询参数。
- 单请求总墙钟超时默认 20 秒，外部取消和截断 gzip 都会留下 `complete: false` 记录并完成清理。
- 使用 `EnvHttpProxyAgent` 支持 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY` 及代理 URL 中的 `socks:`/`socks5:`。Undici 8 不直接读取 `ALL_PROXY`，传输层仅将受支持的 URL 映射为缺失的 HTTP(S) 代理回退，显式 HTTP(S) 配置优先；其他协议不会静默直连或泄漏凭据。
- 固定使用 HTTP/1.1 keep-alive：Undici 8 的 HTTP/2 实现会在 GOAWAY 或 REFUSED_STREAM 时内部重放可重放请求，且不服从 `idempotent: false`；禁用 H2 才能保证一次调度只产生一个线上 GET。
- `firstByteMs` 截止 Undici 收到完整最终响应头，`totalMs` 截止解码与完整性验证完成；不输出无法可靠获取的独立 DNS、建连、TLS 或排队耗时。
- `diagnostics_channel` 只关联本 client 的目标 GET，代理 CONNECT 不计为资源请求；连接关闭时解除订阅。

运行：`devenv shell npm exec -- vitest run tests/development/cache-probe-transport/unit.test.ts`。
