# 上游刷新失败不破坏已有照片池

模拟 Unsplash 返回 503，检查刷新报告失败，同时 KV 中的已有照片池原样保留。

使用内存 KV 和模拟 fetch，不验证 Cloudflare 平台规则或真实 Unsplash 服务。
