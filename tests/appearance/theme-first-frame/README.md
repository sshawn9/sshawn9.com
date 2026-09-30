# 主题与文章首批帧

- 目的：保存的深色主题、正文可见性、真实字体和文章标题几何在首批采样帧一致。
- 触发：预置深色主题，从 FCP 通知后连续采样八帧。
- 预期：每帧都为深色、正文可见；标题使用已加载的 Manrope，FontFaceSet.check 成功，几何稳定。没有接受 loading 隐藏的分支。
- 限制：FCP 通知后的 rAF 不证明此前的每个真实合成帧；跨文档连续刷新像素验收由 `tests/navigation/refresh-continuity/` 承担。
