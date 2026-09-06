# 旧照片池在原有存储键中升级

预置缺少 BlurHash 的旧照片池，再触发刷新。检查新结构仍写入原有 KV 键，不产生另一份照片池。

使用内存 KV 和模拟 fetch，不验证 Cloudflare 平台规则或真实 Unsplash 服务。
