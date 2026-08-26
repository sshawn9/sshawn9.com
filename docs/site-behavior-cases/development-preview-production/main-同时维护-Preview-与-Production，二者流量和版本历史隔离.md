# 案例：main 同时维护 Preview 与 Production，二者流量和版本历史隔离

### 场景

main 分支既需要包含草稿的审阅环境，也需要公开的 Production。

### 正确行为

- 同一已验证源码可以生成或发布到 main Preview 与 Production 的各自目标。
- 两个目标拥有独立流量入口、部署历史、回滚目标和内容可见规则。
- 更新或回滚其中一个目标不会暗中改变另一个目标。

### 禁止状态

- Preview 与 Production 共用同一可变部署地址。
- 回滚 Production 顺带回滚 Preview，或反向影响。
- 为减少构建而把包含草稿的 Preview 产物直接暴露给 Production。

### 验收

1. 部署 main 的 Preview 与 Production 并记录各自版本。
2. 独立更新、切流和回滚其中一个目标。
3. 核对另一目标的流量、内容与版本历史完全不变。
