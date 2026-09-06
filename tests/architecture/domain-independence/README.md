# 领域包保持框架与平台无关

验证 domain 包不依赖框架或平台 API。扫描其静态与动态 import 触发；预期唯一外部依赖为 `github-slugger`。正则检查不覆盖非常规加载方式。
