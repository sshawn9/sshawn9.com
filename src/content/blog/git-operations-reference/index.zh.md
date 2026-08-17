---
title: Git 操作备忘录
description: 面向实际工作场景的 Git 操作速查，帮助快速找到实用但不易记忆的命令，并明确其使用条件与执行影响。
---

## 基础记号与术语

### 命令格式中的记号

| 记号        | 含义                                       |
| ----------- | ------------------------------------------ |
| `<name>`    | 需要替换为实际值的占位符；尖括号本身不输入 |
| `[<name>]`  | 可以省略的占位符；方括号本身不输入         |
| `<name>...` | 可以提供一个或多个同类值；省略号本身不输入 |
| `A \| B`    | 从 `A` 和 `B` 中选择一个；竖线本身不输入   |

### `-ish`

英语后缀 `-ish` 表示“类似……的”或“大致属于……的”。Git 文档用它命名一类能够被解析为特定对象的表达式，它不是需要输入的命令参数。

`commit-ish` 表示能够最终解析为某个提交的名称或表达式，例如：

```text
main          # 分支
v1.0.0        # 指向提交的标签
a1b2c3d       # commit ID
HEAD          # 当前提交
HEAD~2        # 当前提交的前两代祖先
origin/main   # 远程跟踪分支
```

因此，`[<commit-ish>]` 表示这里可以填写分支、标签、commit ID 或 `HEAD` 表达式，也可以省略。

`tree-ish` 表示能够最终解析为树对象的名称或表达式。分支、提交和指向提交的标签都可以继续解析到该提交记录的项目文件树，因此 `main`、`v1.0.0`、`HEAD`、树对象 ID 和 `HEAD^{tree}` 都可以作为 `tree-ish`。

### `HEAD`

`HEAD` 是一个特殊引用：正常状态下指向当前分支；detached HEAD 状态下直接指向某个提交。

当前分支为 `main` 时，从 clean 状态开始修改文件、暂存修改和创建提交，都不会改变 `HEAD → main` 这一引用关系：

<!-- prettier-ignore -->
<svg class="not-prose" viewBox="0 0 1040 150" role="img" aria-label="HEAD 指向 main 时的横向工作流程" aria-describedby="head-workflow-description" style="display: block; width: 100%; height: auto; margin: 1.5rem 0; color: var(--ink)">
  <desc id="head-workflow-description">四个状态从左向右依次为 clean、工作目录有修改、修改已暂存和提交已创建。每个状态都明确显示 HEAD 指向 main；状态之间的操作依次为修改 README.md、git add README.md 和 git commit。</desc>
  <defs>
    <marker id="head-state-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 Z" fill="currentColor" />
    </marker>
    <marker id="head-reference-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 Z" fill="var(--muted)" />
    </marker>
  </defs>
  <rect x="1" y="1" width="1038" height="148" rx="16" fill="var(--surface-strong)" stroke="var(--line)" />
  <g fill="currentColor" font-family="var(--font-sans)" font-size="17" font-weight="650" text-anchor="middle">
    <text x="90" y="73">clean</text>
    <text x="370" y="73">工作目录有修改</text>
    <text x="650" y="73">修改已暂存</text>
    <text x="930" y="73">提交已创建</text>
  </g>
  <g stroke="var(--line)">
    <line x1="90" y1="88" x2="90" y2="100" />
    <line x1="370" y1="88" x2="370" y2="100" />
    <line x1="650" y1="88" x2="650" y2="100" />
    <line x1="930" y1="88" x2="930" y2="100" />
  </g>
  <g fill="currentColor" font-family="var(--font-mono)" font-size="14" font-weight="700" text-anchor="middle">
    <text x="52" y="125">HEAD</text>
    <text x="128" y="125">main</text>
    <text x="332" y="125">HEAD</text>
    <text x="408" y="125">main</text>
    <text x="612" y="125">HEAD</text>
    <text x="688" y="125">main</text>
    <text x="892" y="125">HEAD</text>
    <text x="968" y="125">main</text>
  </g>
  <g fill="none" stroke="var(--muted)" stroke-width="1.5" marker-end="url(#head-reference-arrow)">
    <line x1="72" y1="119" x2="105" y2="119" />
    <line x1="352" y1="119" x2="385" y2="119" />
    <line x1="632" y1="119" x2="665" y2="119" />
    <line x1="912" y1="119" x2="945" y2="119" />
  </g>
  <g fill="none" stroke="currentColor" stroke-width="1.75" marker-end="url(#head-state-arrow)">
    <line x1="130" y1="67" x2="295" y2="67" />
    <line x1="445" y1="67" x2="590" y2="67" />
    <line x1="710" y1="67" x2="870" y2="67" />
  </g>
  <g fill="currentColor" font-family="var(--font-mono)" font-size="14" font-weight="600" text-anchor="middle">
    <text x="212" y="32">修改 README.md</text>
    <text x="518" y="32">git add README.md</text>
    <text x="790" y="32">git commit</text>
  </g>
</svg>

如果直接切换到某个 commit ID，`HEAD` 将不再指向分支，而是直接指向该提交。这称为 **detached HEAD**，即 `HEAD` 与分支脱离：

```text
HEAD → <commit-id>
```

detached HEAD 状态下仍可修改、暂存和提交，但创建提交时不会使任何本地分支前移。需要保留这些提交时，应在离开前执行 `git switch -c <new-branch>` 创建分支。

执行普通的 `git commit` 时，新提交会记录当前分支原来所在的提交；这个紧接在新提交之前的提交称为它的**父提交**。历史起点的根提交没有父提交，普通提交通常有一个父提交，合并多段历史产生的提交则可以有多个父提交。`^` 和 `~` 都利用这种关系向前查找提交。

两者都从一个给定提交出发，但查找规则不同：

- `<commit-ish>^<n>`：选择 `<commit-ish>` 的第 `n` 个父提交，`n` 从 `1` 开始；省略 `<n>` 时选择第一个父提交。
- `<commit-ish>~<n>`：从 `<commit-ish>` 开始，连续选择第一个父提交 `n` 次；省略 `<n>` 时只选择一次。

因此，`^2` 表示“第二个父提交”，`~2` 才表示“沿第一父提交链向前追溯两代”；`<commit-ish>^`、`<commit-ish>^1`、`<commit-ish>~` 和 `<commit-ish>~1` 表示同一个提交。

例如，`feature` 从 `main` 的 `C1` 处分出。在 `main` 上执行 `git merge feature` 后产生合并提交 `M`：

<!-- prettier-ignore -->
<svg class="not-prose" viewBox="0 0 760 300" role="img" aria-label="合并提交及其父提交" aria-describedby="git-parent-graph-description" style="display: block; width: 100%; height: auto; margin: 2rem 0; color: var(--ink)">
  <desc id="git-parent-graph-description">feature 从 main 的 C1 提交分出；main 和 feature 分别前进到 C2 和 F2，随后合并为 M。HEAD、HEAD^、HEAD^2 和 HEAD~2 分别标在对应提交的外围。</desc>
  <defs>
    <marker id="git-history-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 Z" fill="currentColor" />
    </marker>
  </defs>
  <rect x="1" y="1" width="758" height="298" rx="18" fill="var(--surface-strong)" stroke="var(--line)" />
  <g fill="currentColor" font-family="var(--font-mono)" font-size="16">
    <text x="30" y="38">执行位置：main</text>
    <text x="30" y="64">执行命令：git merge feature</text>
    <g fill="var(--muted)">
      <text x="30" y="140">feature</text>
      <text x="30" y="220">main</text>
    </g>
    <g font-weight="700" text-anchor="middle">
      <text x="175" y="220">C0</text>
      <text x="340" y="220">C1</text>
      <text x="505" y="220">C2</text>
      <text x="670" y="220">M</text>
      <text x="340" y="140">F1</text>
      <text x="670" y="140">F2</text>
    </g>
  </g>
  <g fill="none" stroke="currentColor" stroke-width="1.75" marker-end="url(#git-history-arrow)">
    <line x1="197" y1="214" x2="316" y2="214" />
    <line x1="362" y1="214" x2="481" y2="214" />
    <line x1="527" y1="214" x2="649" y2="214" />
    <line x1="362" y1="134" x2="648" y2="134" />
    <line x1="340" y1="196" x2="340" y2="154" />
    <line x1="670" y1="154" x2="670" y2="196" />
  </g>
  <g font-family="var(--font-mono)" font-size="14" text-anchor="middle">
    <g transform="translate(670 96)">
      <rect x="-46" y="-16" width="92" height="30" rx="8" fill="var(--page-muted)" stroke="var(--line)" />
      <text y="4" fill="currentColor">HEAD^2</text>
    </g>
    <g transform="translate(340 264)">
      <rect x="-46" y="-16" width="92" height="30" rx="8" fill="var(--page-muted)" stroke="var(--line)" />
      <text y="4" fill="currentColor">HEAD~2</text>
    </g>
    <g transform="translate(505 264)">
      <rect x="-40" y="-16" width="80" height="30" rx="8" fill="var(--page-muted)" stroke="var(--line)" />
      <text y="4" fill="currentColor">HEAD^</text>
    </g>
    <g transform="translate(670 264)">
      <rect x="-36" y="-16" width="72" height="30" rx="8" fill="var(--page-muted)" stroke="var(--line)" />
      <text y="4" fill="currentColor">HEAD</text>
    </g>
  </g>
</svg>

图中每条有向连线都从父提交指向由它产生的后续提交。

第一、第二不是根据图中的位置或分支名称推断出来的，而是合并提交对象中多条 `parent` 记录的先后顺序。在 `main` 上执行 `git merge feature` 时：

1. 合并前，`HEAD` 指向 `main`，`main` 指向 `C2`；Git 将 `C2` 写入第一条 `parent` 记录。
2. `feature` 指向 `F2`；合并期间，Git 使用 `MERGE_HEAD` 记录这个被合入的提交，并将 `F2` 写入第二条 `parent` 记录。

因此，合并提交 `M` 的相关内容等价于：

```text
parent <C2 的 commit ID>
parent <F2 的 commit ID>
```

图中由 `C2` 和 `F2` 指向 `M` 的两条有向连线对应这两条记录。图中的 `HEAD^`、`HEAD^2` 和 `HEAD~2` 均以合并完成后仍停留在 `main` 为前提，此时 `HEAD` 指向合并提交 `M`。将前述规则应用于此时的 `HEAD`：

- `HEAD^`：取 `M` 排在第一的父提交，得到 `C2`；
- `HEAD^2`：数字 `2` 表示取 `M` 排在第二的父提交，得到 `F2`，不是向前追溯两代；
- `HEAD~2`：连续两次取排在第一的父提交，经过 `M → C2 → C1`，得到 `C1`。

这些记号会从使用它们时 `HEAD` 所指向的提交开始查找，并不固定表示图中的某个提交。若随后切换到 `feature`，`HEAD` 将指向 `F2`，此时 `HEAD^` 表示 `F2` 的第一父提交 `F1`；合并提交 `M` 的父提交关系并未改变，只是不再以 `HEAD` 为起点访问它。

如果改为在 `feature` 上执行 `git merge main`，合并前的 `HEAD` 是 `F2`，所以第一条记录会是 `F2`，第二条记录才是被合入的 `C2`。

合并提交并不只限于两个父提交。在 `main` 上同时合入多个分支时，例如：

```bash
git merge feature-a feature-b
```

如果该命令成功生成一个多分支合并提交，其提交对象可以包含三条 `parent` 记录：

```text
parent <合并前 main 所在提交的 commit ID>
parent <feature-a 所在提交的 commit ID>
parent <feature-b 所在提交的 commit ID>
```

这种合并称为 **Octopus merge**（多分支合并）。此时，`HEAD^3` 读取第三条 `parent` 记录；它与 `HEAD~3` 不同，后者会沿第一条 `parent` 记录连续向前查找三代。提交可以记录任意数量的父提交，具体顺序可直接查看提交对象：

```bash
git cat-file -p HEAD
```

### 工作区状态

**工作区**（working tree，官方中文资料也称“工作目录”）是仓库对应目录中供编辑的实际项目文件。修改文件会直接改变工作区；新建但尚未交给 Git 跟踪的文件会在这里显示为未跟踪文件。

**暂存区**（index，也称 staging area）保存下一次提交所使用的文件快照信息，并不是一个供人直接编辑的目录。`git add` 将指定文件当时的内容写入暂存区，`git commit` 再根据暂存区创建新的提交。

前文介绍的 `HEAD` 提供当前提交的文件快照。依据 Git 官方 [`git-status`](https://git-scm.com/docs/git-status) 文档，常见状态可以归纳为以下几组：

| 常见状态   | 工作区                                                 | 暂存区                                                 | `git status` 官方分类           |
| ---------- | ------------------------------------------------------ | ------------------------------------------------------ | ------------------------------- |
| `clean`    | 已跟踪文件与暂存区一致；除被忽略文件外，没有未跟踪文件 | 与 `HEAD` 一致                                         | `working tree clean`            |
| 已暂存修改 | 可能与暂存区一致，也可能在暂存后又被修改               | 保存下一次提交将包含的修改，与 `HEAD` 不同             | `Changes to be committed`       |
| 未暂存修改 | 已跟踪文件包含尚未写入暂存区的修改                     | 尚未保存工作区中的最新内容，也可能保存着更早暂存的内容 | `Changes not staged for commit` |
| 未跟踪文件 | 存在 Git 尚未跟踪的新路径                              | 没有该路径的记录                                       | `Untracked files`               |
| 未合并路径 | 冲突处理尚未完成                                       | 可以保存同一路径的多个待合并版本                       | `Unmerged paths`                |

除 `clean` 外，其他状态可以同时出现。例如，文件暂存后又被修改，会同时具有已暂存修改和未暂存修改。

## switch：切换分支

`git switch <target-branch>` 尝试让当前 worktree 改用目标分支。切换时已有本地状态的处理过程如下：

<!-- prettier-ignore -->
<svg class="not-prose" viewBox="0 0 1040 295" role="img" aria-label="git switch 处理本地状态的流程" aria-describedby="git-switch-description" style="display: block; width: 100%; height: auto; margin: 1.5rem 0; color: var(--ink)">
  <desc id="git-switch-description">当前 worktree 从 branch-a 切换到 branch-b。如果已暂存修改、未暂存修改和普通未跟踪文件能够安全保留，切换成功，HEAD 改为指向 branch-b，本地状态继续保留，并相对于 branch-b 重新比较；否则切换中止，HEAD、暂存区和工作目录保持不变。</desc>
  <defs>
    <marker id="switch-flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 Z" fill="currentColor" />
    </marker>
  </defs>
  <rect x="1" y="1" width="1038" height="293" rx="18" fill="var(--surface-strong)" stroke="var(--line)" />
  <text x="24" y="31" fill="var(--muted)" font-family="var(--font-sans)" font-size="14">本地状态：已暂存修改、未暂存修改和普通未跟踪文件</text>

  <rect x="24" y="78" width="190" height="140" rx="14" fill="none" stroke="var(--line)" />
  <text x="119" y="108" fill="currentColor" font-family="var(--font-sans)" font-size="17" font-weight="700" text-anchor="middle">切换前</text>
  <line x1="48" y1="121" x2="190" y2="121" stroke="var(--line)" />
  <g fill="currentColor" font-family="var(--font-mono)" font-size="14">
    <text x="48" y="148">HEAD → branch-a</text>
    <text x="48" y="174">暂存区：本地状态</text>
    <text x="48" y="200">工作目录：本地状态</text>
  </g>

  <path d="M 520 73 L 642 148 L 520 223 L 398 148 Z" fill="none" stroke="var(--line)" />
  <g fill="currentColor" font-family="var(--font-sans)" font-size="16" font-weight="700" text-anchor="middle">
    <text x="520" y="143">本地状态能否</text>
    <text x="520" y="168">安全保留？</text>
  </g>

  <g fill="none" stroke="currentColor" stroke-width="1.75" marker-end="url(#switch-flow-arrow)">
    <line x1="214" y1="148" x2="386" y2="148" />
    <line x1="622" y1="110" x2="714" y2="83" />
    <line x1="622" y1="186" x2="714" y2="213" />
  </g>
  <g fill="currentColor" font-family="var(--font-mono)" font-size="14" font-weight="600" text-anchor="middle">
    <text x="300" y="132">git switch branch-b</text>
    <text x="670" y="79">能</text>
    <text x="670" y="218">不能</text>
  </g>

  <rect x="726" y="36" width="290" height="105" rx="14" fill="none" stroke="var(--line)" />
  <text x="871" y="64" fill="currentColor" font-family="var(--font-sans)" font-size="17" font-weight="700" text-anchor="middle">切换成功</text>
  <g fill="currentColor" font-family="var(--font-mono)" font-size="13.5">
    <text x="750" y="88">HEAD → branch-b</text>
    <text x="750" y="111">本地状态：保留</text>
    <text x="750" y="132">git status：相对 branch-b 比较</text>
  </g>

  <rect x="726" y="158" width="290" height="105" rx="14" fill="none" stroke="var(--line)" />
  <text x="871" y="186" fill="currentColor" font-family="var(--font-sans)" font-size="17" font-weight="700" text-anchor="middle">切换中止</text>
  <g fill="currentColor" font-family="var(--font-mono)" font-size="13.5">
    <text x="750" y="210">HEAD → branch-a</text>
    <text x="750" y="233">暂存区、工作目录：保持不变</text>
    <text x="750" y="254">Git 报告阻碍切换的路径</text>
  </g>
</svg>

## restore：取消暂存

本节使用的命令行参数：

| 参数             | 含义                 |
| ---------------- | -------------------- |
| `-S`、`--staged` | 将恢复目标设为暂存区 |

```bash
# 用途：取消指定路径的暂存状态
# 结果：将暂存区中的对应内容恢复为 HEAD 的版本，工作目录文件保持不变
git restore --staged <pathspec>...
# 示例 1：取消暂存 README.md，但保留文件修改
git restore --staged README.md
```

## rebase：在新基线上重放提交

`rebase` 将一个提交序列改接到新的基线。执行 `git rebase <upstream>` 时，Git 找出当前分支中 `<upstream>` 没有的提交，在 `<upstream>` 之后依次重新创建这些提交，最后让当前分支指向重建后的序列；`<upstream>` 本身不会移动。

<!-- prettier-ignore -->
<svg class="not-prose" viewBox="0 0 1040 330" role="img" aria-label="feature/example 变基到 main 前后的提交历史" aria-describedby="rebase-graph-description" style="display: block; width: 100%; height: auto; margin: 1.5rem 0; color: var(--ink)">
  <desc id="rebase-graph-description">变基前，feature/example 从 main 的 B 提交分出并包含 C、D，main 已前进到 E。执行 git rebase main 后，main 仍指向 E，feature/example 的修改在 E 之后被重新创建为 C′、D′，HEAD 仍指向 feature/example。</desc>
  <defs>
    <marker id="rebase-history-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 Z" fill="currentColor" />
    </marker>
  </defs>
  <rect x="1" y="1" width="1038" height="328" rx="18" fill="var(--surface-strong)" stroke="var(--line)" />
  <line x1="30" y1="165" x2="1010" y2="165" stroke="var(--line)" />
  <g font-family="var(--font-sans)" font-size="18" font-weight="700" fill="currentColor">
    <text x="32" y="40">变基前</text>
    <text x="32" y="208">变基后</text>
  </g>
  <g transform="translate(425 147)">
    <rect width="190" height="36" rx="10" fill="var(--page-muted)" stroke="var(--line)" />
    <text x="95" y="24" text-anchor="middle" fill="currentColor" font-family="var(--font-mono)" font-size="15" font-weight="700">git rebase main</text>
  </g>
  <g fill="none" stroke="currentColor" stroke-width="1.75" marker-end="url(#rebase-history-arrow)">
    <line x1="157" y1="118" x2="263" y2="118" />
    <line x1="297" y1="118" x2="403" y2="118" />
    <line x1="295" y1="108" x2="404" y2="74" />
    <line x1="437" y1="68" x2="543" y2="68" />
    <line x1="157" y1="270" x2="263" y2="270" />
    <line x1="297" y1="270" x2="403" y2="270" />
    <line x1="437" y1="270" x2="543" y2="270" />
    <line x1="577" y1="270" x2="683" y2="270" />
  </g>
  <g fill="var(--page-muted)" stroke="currentColor" stroke-width="1.75">
    <circle cx="140" cy="118" r="16" />
    <circle cx="280" cy="118" r="16" />
    <circle cx="420" cy="118" r="16" />
    <circle cx="420" cy="68" r="16" />
    <circle cx="560" cy="68" r="16" />
    <circle cx="140" cy="270" r="16" />
    <circle cx="280" cy="270" r="16" />
    <circle cx="420" cy="270" r="16" />
    <circle cx="560" cy="270" r="16" />
    <circle cx="700" cy="270" r="16" />
  </g>
  <g fill="currentColor" font-family="var(--font-mono)" font-size="14" font-weight="700" text-anchor="middle">
    <text x="140" y="123">A</text>
    <text x="280" y="123">B</text>
    <text x="420" y="123">E</text>
    <text x="420" y="73">C</text>
    <text x="560" y="73">D</text>
    <text x="140" y="275">A</text>
    <text x="280" y="275">B</text>
    <text x="420" y="275">E</text>
    <text x="560" y="275">C′</text>
    <text x="700" y="275">D′</text>
  </g>
  <g font-family="var(--font-mono)" font-size="14" font-weight="650" fill="currentColor">
    <g transform="translate(454 98)">
      <rect width="82" height="40" rx="10" fill="var(--page-muted)" stroke="var(--line)" />
      <text x="41" y="25" text-anchor="middle">main</text>
    </g>
    <g transform="translate(594 48)">
      <rect width="228" height="40" rx="10" fill="var(--page-muted)" stroke="var(--line)" />
      <text x="114" y="25" text-anchor="middle">feature/example · HEAD</text>
    </g>
    <g transform="translate(379 214)">
      <rect width="82" height="36" rx="10" fill="var(--page-muted)" stroke="var(--line)" />
      <text x="41" y="23" text-anchor="middle">main</text>
    </g>
    <line x1="420" y1="250" x2="420" y2="253" stroke="var(--line)" />
    <g transform="translate(734 250)">
      <rect width="228" height="40" rx="10" fill="var(--page-muted)" stroke="var(--line)" />
      <text x="114" y="25" text-anchor="middle">feature/example · HEAD</text>
    </g>
  </g>
</svg>

`C'` 和 `D'` 是根据 `C`、`D` 的修改重新创建的提交。由于父提交发生变化，它们具有新的 commit ID。变基适合整理尚未共享的本地历史；如果其他分支或使用者已经基于这些提交继续工作，应先协调再改写。

本节使用的命令行参数：

| 参数                    | 含义                                                   |
| ----------------------- | ------------------------------------------------------ |
| `--onto <new-base>`     | 将重建提交的起点改为 `<new-base>`                      |
| `-i`、`--interactive`   | 在重建前编辑提交顺序和处理方式                         |
| `--autostash`           | 变基前临时保存本地修改，结束后重新应用                 |
| `-r`、`--rebase-merges` | 尝试在新基线上重新创建原有合并结构                     |
| `--continue`            | 解决冲突或完成编辑后继续变基                           |
| `--skip`                | 跳过当前正在应用的提交                                 |
| `--abort`               | 中止变基并恢复开始前的分支、暂存区和已跟踪工作目录内容 |

```bash
# 用途：将当前分支独有的提交重新应用到新的基线
# 条件：当前分支是需要改写的分支；暂存区和已跟踪文件没有未提交修改；相关提交尚未共享或已协调改写
# 结果：在 <upstream> 之后重建当前分支的提交，并让当前分支指向新的提交序列；<upstream> 不变
git rebase <upstream>
# 示例 1：当前分支为 feature/example，将其独有提交重新应用到 main 之后
git rebase main

# 用途：分别指定新基线、提交选择边界和待改写分支
# 条件：暂存区和已跟踪文件没有未提交修改；<branch> 未被其他 worktree 使用；相关提交尚未共享或已协调改写
# 结果：选择 <branch> 相对于 <upstream> 独有的提交，将其重新应用到 <new-base>，再让 <branch> 指向新序列
git rebase --onto <new-base> <upstream> <branch>
# 示例 1：将 topic/example 相对于 integration 独有的提交重新应用到 main
git rebase --onto main integration topic/example

# 用途：调整提交顺序、修改提交信息、合并或删除提交
# 条件：暂存区和已跟踪文件没有未提交修改；待处理提交尚未共享或已协调改写
# 结果：打开按提交历史从旧到新排列的待办列表，并按照保存后的内容重新创建 <upstream> 之后的提交
git rebase -i <upstream>
# 示例 1：交互式整理当前分支最近五个提交
git rebase -i HEAD~5

# 用途：在存在本地修改时执行变基
# 条件：不存在尚未解决的合并冲突；普通未跟踪文件不得阻碍 Git 写入；相关提交尚未共享或已协调改写
# 结果：变基前创建临时 stash，变基结束后重新应用；重新应用时仍可能产生冲突
git rebase --autostash <upstream>
# 示例 1：临时保存本地修改，将当前分支变基到 main，再重新应用这些修改
git rebase --autostash main

# 用途：变基时重新创建原有合并结构
# 条件：暂存区和已跟踪文件没有未提交修改；相关提交尚未共享或已协调改写
# 结果：在新基线上重新应用普通提交并尝试重新创建合并提交；原有人工冲突解决可能需要再次处理
git rebase --rebase-merges <upstream>
# 示例 1：将当前分支变基到 main，并重新创建其合并结构
git rebase --rebase-merges main

# 用途：解决冲突或完成交互式编辑后继续变基
# 条件：rebase 已暂停；冲突已经解决并用 git add 写入暂存区，或当前编辑已经完成
# 结果：完成当前提交的重建并继续处理剩余提交
git rebase --continue

# 用途：跳过当前无法应用的提交并继续变基
# 条件：rebase 已暂停，并已确认新历史不需要当前提交的修改
# 结果：当前提交不会进入重建后的历史，rebase 继续处理后续提交
git rebase --skip

# 用途：取消处于暂停状态的 rebase
# 条件：rebase 已开始但尚未完成
# 结果：放弃尚未完成的变基，并恢复到变基开始前的状态
git rebase --abort
```

## stash：临时保存修改

`stash` 将当前工作目录和暂存区中的修改记录到本地 stash 中，使相应文件恢复到 `HEAD` 的状态。`stash@{0}` 表示最新记录，后续记录依次为 `stash@{1}`、`stash@{2}`。stash 默认只保存在当前仓库，不会随普通 `push` 发送到远程仓库。

本节使用的命令行参数：

| 参数                                  | 含义                                     |
| ------------------------------------- | ---------------------------------------- |
| `-m <message>`、`--message <message>` | 将 `<message>` 用作 stash 说明           |
| `-u`、`--include-untracked`           | 将未跟踪文件一并保存，但不包含被忽略文件 |
| `-p`、`--patch`                       | 用于 `push` 时，交互选择要保存的修改     |
| `-p`、`--patch`                       | 用于 `show` 时，显示完整补丁             |
| `--stat`                              | 显示差异统计                             |
| `--`                                  | 结束选项解析                             |

```bash
# 用途：查看当前仓库中的 stash 列表
git stash list

# 用途：临时保存已跟踪文件的修改
# 条件：暂存区中不能存在尚未解决的合并冲突
# 结果：创建 stash，保存已暂存和未暂存修改，并使相应文件恢复到 HEAD 的状态
git stash push -m <message>
# 示例 1：保存当前已跟踪文件的修改，并将该记录标记为 wip: example
git stash push -m "wip: example"

# 用途：同时保存已跟踪文件的修改和未跟踪文件
# 条件：暂存区中不能存在尚未解决的合并冲突
# 结果：创建 stash，保存已暂存修改、未暂存修改和未跟踪文件；随后使相应已跟踪文件恢复到 HEAD，并从工作目录移除已保存的未跟踪文件；被忽略文件保持不变
git stash push -u -m <message>
# 示例 1：保存当前修改和未跟踪文件，但不保存被忽略文件
git stash push -u -m "wip: example"

# 用途：只保存指定路径中的修改
# 条件：暂存区中不能存在尚未解决的合并冲突
# 结果：只将匹配路径的修改写入 stash 并撤回，其他路径保持不变
git stash push -m <message> -- <pathspec>...
# 示例 1：只保存 docs/ 和 README.md 中的修改
git stash push -m "wip: docs" -- docs/ README.md

# 用途：查看指定 stash 的差异统计
# 结果：显示该 stash 相对于创建时基线的差异统计，不改变任何状态
git stash show --stat <stash>
# 示例 1：查看最新 stash 的差异统计
git stash show --stat stash@{0}

# 用途：查看指定 stash 的完整补丁
# 结果：显示该 stash 相对于创建时基线的完整差异，不改变任何状态
git stash show -p <stash>
# 示例 1：查看最新 stash 的完整补丁
git stash show -p stash@{0}

# 用途：恢复指定 stash，同时保留该记录
# 条件：工作目录必须与暂存区一致
# 结果：将记录的修改应用到当前状态；可能产生冲突，但不会删除 stash
git stash apply <stash>
# 示例 1：恢复最新 stash，同时保留该记录
git stash apply stash@{0}

# 用途：恢复指定 stash，并在成功后删除该记录
# 条件：工作目录必须与暂存区一致
# 结果：将记录的修改应用到当前状态；成功时删除 stash，发生冲突时保留
git stash pop <stash>
# 示例 1：恢复最新 stash，并在成功后删除该记录
git stash pop stash@{0}

# 用途：从创建 stash 时的基线建立分支并恢复修改
# 条件：<new-branch> 尚不存在，当前本地修改不得妨碍切换到 stash 的基线提交
# 结果：创建并切换到新分支，应用 stash；应用成功时删除该 stash 记录
git stash branch <new-branch> <stash>
# 示例 1：建立 recovery/example 分支并恢复最新 stash
git stash branch recovery/example stash@{0}
```

## worktree：管理多个工作目录

`worktree` 可以让同一个仓库同时拥有多个工作目录，并在其中分别使用不同的分支或提交。各 worktree 的状态相互独立，但共用仓库数据，因此不必为了同时处理多个分支而重复克隆仓库。**主 worktree** 是克隆或初始化仓库时默认建立的仓库目录；`git worktree add` 可以在此之外创建更多 worktree。

```text
主 worktree/
├── 工作目录文件
└── .git/（$GIT_COMMON_DIR）
    ├── objects/（所有 worktree 共享）
    ├── refs/heads/（所有 worktree 共享）
    ├── refs/tags/（所有 worktree 共享）
    ├── config（默认共享）
    ├── HEAD → main（主 worktree 独立）
    ├── index（主 worktree 独立）
    └── worktrees/（子目录名通常取 worktree 的末级目录名，重名时追加数字；不是提交 ID）
        ├── <id-a>/（对应 worktree A）
        │   ├── HEAD → branch-a
        │   └── index
        └── <id-b>/（对应 worktree B）
            ├── HEAD → branch-b
            └── index

worktree A/
├── 工作目录文件
└── .git（普通文件）
    └── 内容：gitdir: 主 worktree/.git/worktrees/<id-a>

worktree B/
├── 工作目录文件
└── .git（普通文件）
    └── 内容：gitdir: 主 worktree/.git/worktrees/<id-b>
```

- 同一本地分支默认只能在一个 worktree 中使用。各 worktree 分别拥有自己的 `HEAD`，但本地分支引用由仓库共享。若强制让两个 worktree 的 `HEAD` 同时指向同一本地分支，其中一个创建提交会使该分支向前移动；另一个 worktree 的 `HEAD` 随即指向新提交，但其暂存区和工作目录仍保留原来的内容。此时 Git 会显示并非由实际编辑产生的已暂存差异，继续提交还可能产生撤销前一处修改的提交。

本节使用的命令行参数：

| 参数              | 含义                                                 |
| ----------------- | ---------------------------------------------------- |
| `-b <new-branch>` | 创建 `<new-branch>`，并让新 worktree 使用该分支      |
| `-d`、`--detach`  | 让新 worktree 的 `HEAD` 直接指向提交，不使用本地分支 |
| `-n`、`--dry-run` | 仅显示 `prune` 将清理的记录                          |

```bash
# 用途：查看仓库关联的所有 worktree
git worktree list

# 用途：从指定起点新建分支，并为该分支创建 worktree
# 条件：执行命令所在的工作区可以是 clean 或 unclean
# 结果：以 <commit-ish> 为起点创建新分支，并在 <path> 中建立该分支的 worktree
git worktree add -b <new-branch> <path> [<commit-ish>]
# 示例 1：以 origin/main 为起点创建 hotfix/example 分支，并在相邻的 project-hotfix/ 目录中建立该分支的 worktree
git worktree add -b hotfix/example ../project-hotfix origin/main
# 示例 2：以当前 HEAD 为起点创建 feature/example 分支，并在相邻的 project-feature/ 目录中建立该分支的 worktree
git worktree add -b feature/example ../project-feature
# 示例 3：以 v1.2.0 为起点创建 hotfix/v1.2.1 分支，并在相邻的 project-hotfix-v1.2.1/ 目录中建立该分支的 worktree
git worktree add -b hotfix/v1.2.1 ../project-hotfix-v1.2.1 v1.2.0

# 用途：为已有的本地分支创建 worktree
# 条件：执行命令所在的工作区可以是 clean 或 unclean；<branch> 未被其他 worktree 使用
# 结果：在 <path> 中建立使用 <branch> 的 worktree；原工作区中的未提交修改和暂存内容不会复制过去
git worktree add <path> <branch>
# 示例 1：在相邻的 project-release/ 目录中建立使用 release/1.x 分支的 worktree
git worktree add ../project-release release/1.x

# 用途：为指定版本创建不绑定分支的临时 worktree，用于检查旧版本、测试或执行 bisect
# 条件：执行命令所在的工作区可以是 clean 或 unclean
# 结果：在 <path> 中建立 worktree，其 HEAD 直接指向指定提交并处于 detached HEAD 状态；原工作区状态不变
git worktree add --detach <path> <commit-ish>
# 示例 1：直接使用缩写提交 ID，在相邻的 project-inspect-commit/ 目录中建立指向提交 9f3a2c1 的临时 worktree
git worktree add --detach ../project-inspect-commit 9f3a2c1
# 示例 2：在相邻的 project-inspect-tag/ 目录中建立指向 v1.2.0 标签所指提交的临时 worktree
git worktree add --detach ../project-inspect-tag v1.2.0

# 用途：删除不再需要的 linked worktree，但保留其分支和提交
# 条件：执行命令所在的工作区可以是 clean 或 unclean；目标必须是 clean、未锁定且不含子模块的 linked worktree
# 结果：删除 <worktree> 工作目录及其管理记录，不删除对应分支和提交
git worktree remove <worktree>
# 示例 1：删除相邻的 project-hotfix/ worktree
git worktree remove ../project-hotfix

# 用途：预览可以清理的失效 worktree 管理记录
# 条件：执行命令所在的工作区可以是 clean 或 unclean；需在该仓库的任一 worktree 中执行
# 结果：列出工作目录已经不存在且符合清理条件的管理记录，不实际删除
git worktree prune --dry-run

# 用途：清理失效的 worktree 管理记录
# 条件：执行命令所在的工作区可以是 clean 或 unclean；需在该仓库的任一 worktree 中执行
# 结果：删除工作目录已经不存在且符合清理条件的管理记录，不删除现存 worktree、分支或提交
git worktree prune

# 用途：修复手动移动主 worktree 或 linked worktree 后失效的关联
# 条件：执行命令所在的工作区和待修复的工作区都可以是 clean 或 unclean；移动 linked worktree 后需提供其新路径
# 结果：重新建立仓库管理目录与相应 worktree 的双向关联，不改变工作目录文件、分支或提交
git worktree repair [<path>...]
# 示例 1：修复已经手动移动到 ../project-hotfix/ 的 linked worktree
git worktree repair ../project-hotfix
```

## cherry-pick：应用指定提交

`cherry-pick` 读取已有提交引入的修改，将其应用到当前分支，并默认创建内容相应但 commit ID 不同的新提交。它适合把独立修复移入其他分支，不会把原提交之前的整段历史一并合入。

本节使用的命令行参数：

| 参数                | 含义           |
| ------------------- | -------------- |
| `-n`、`--no-commit` | 不自动创建提交 |

```bash
# 用途：将一个已有提交引入当前分支
# 条件：当前工作区必须是 clean
# 结果：应用目标提交引入的修改，并在当前分支创建新提交
git cherry-pick <commit-ish>
# 示例 1：将提交 9f3a2c1 引入当前分支
git cherry-pick 9f3a2c1

# 用途：应用已有提交的修改，但不立即创建提交
# 条件：暂存区中不能存在尚未解决的合并冲突；现有本地修改不得被目标修改覆盖
# 结果：将目标修改写入工作目录和暂存区，HEAD 与当前分支保持不变
git cherry-pick --no-commit <commit-ish>
# 示例 1：应用提交 9f3a2c1 的修改，检查或调整后再自行提交
git cherry-pick --no-commit 9f3a2c1
```

## revert：以新提交撤销指定提交

`revert` 创建一个抵消目标提交的新提交，不删除或改写原提交，适合撤销已经共享的历史。

本节使用的命令行参数：

| 参数                                               | 含义                                          |
| -------------------------------------------------- | --------------------------------------------- |
| `-m <parent-number>`、`--mainline <parent-number>` | 将编号为 `<parent-number>` 的父提交指定为主线 |
| `--no-patch`                                       | 用于 `git show` 时，不显示文件补丁            |
| `--pretty=raw`                                     | 用于 `git show` 时，以 raw 格式显示提交元数据 |

```bash
# 用途：撤销普通提交引入的修改
# 条件：当前工作区必须是 clean
# 结果：创建一个抵消目标提交的新提交，原提交和既有历史保持不变
git revert <commit-ish>
# 示例 1：以新提交撤销提交 9f3a2c1
git revert 9f3a2c1

# 用途：撤销合并提交；因其有多个父提交，必须用 -m 指定保留哪条主线
# 条件：当前工作区必须是 clean；目标是合并提交；<parent-number> 对应其一个父提交
# 结果：反向应用合并相对于该父提交的变化；不是撤销该父提交，也不删除原合并提交
git revert -m <parent-number> <merge-commit>
# 示例 1：先核对 parent 顺序，再保留第一父提交所代表的主线并撤销该次合并
git show --no-patch --pretty=raw 6d8f2a1
git revert -m 1 6d8f2a1
# 注意：撤销只反转内容，原合并关系仍存在；再次合并不会自动恢复被撤销的内容
```

## reset：重置 HEAD 与文件状态

`reset` 将当前分支或 detached HEAD 移到指定提交，并根据模式决定是否同时重置暂存区和工作目录。它适合整理尚未共享的本地状态；若相关提交已经被他人使用，移动分支会改写对方所依赖的历史。

三个常用命令行参数的含义如下：

| 参数      | 当前分支或 `HEAD` | 暂存区             | 工作目录           |
| --------- | ----------------- | ------------------ | ------------------ |
| `--soft`  | 移到目标提交      | 保持不变           | 保持不变           |
| `--mixed` | 移到目标提交      | 重置为目标提交内容 | 保持不变           |
| `--hard`  | 移到目标提交      | 重置为目标提交内容 | 重置为目标提交内容 |

```bash
# 用途：移动当前分支，同时保留暂存区和工作目录中的内容
# 条件：暂存区中不能存在尚未解决的合并冲突
# 结果：当前分支或 detached HEAD 移到目标提交；暂存区和工作目录保持不变
git reset --soft <commit-ish>
# 示例 1：撤回当前提交，同时让其中的修改继续保持已暂存状态
git reset --soft HEAD^

# 用途：移动当前分支并取消目标提交之后的暂存状态
# 条件：当前工作区可以是 clean 或 unclean
# 结果：当前分支或 detached HEAD 移到目标提交，暂存区重置为目标内容，工作目录保持不变
git reset --mixed <commit-ish>
# 示例 1：撤回当前提交并取消其修改的暂存状态，但保留文件修改
git reset --mixed HEAD^

# 用途：使当前分支、暂存区和已跟踪文件全部回到指定提交
# 条件：当前工作区可以是 clean 或 unclean
# 结果：当前分支或 detached HEAD 移到目标提交；暂存区和已跟踪文件被目标内容覆盖，阻碍写入的未跟踪路径也可能被删除
git reset --hard <commit-ish>
# 示例 1：将当前分支退回前一个提交，并丢弃暂存区和工作目录中的未提交修改
git reset --hard HEAD^
```

`reset --hard` 会丢弃未提交的已跟踪文件修改，不应用于普通清理。

## reflog：查看引用日志

`reflog`（reference log，引用日志）记录本地仓库中分支及其他引用曾经指向的位置。它与提交历史不同：提交历史保存提交之间的父子关系，reflog 保存引用随本地操作发生的移动。`git reflog` 默认显示 `HEAD` 的引用日志，其中还会记录分支切换；查看某个分支的 reflog，则只反映该分支引用自身的移动。

reflog 只存在于本地，不会通过 `fetch`、`pull` 或 `push` 在仓库之间同步。只要相应记录尚未过期且目标对象仍然存在，就可以通过 reflog 访问已经不再被当前分支或标签指向的提交。

reflog 位置使用 `<ref>@{<specifier>}` 表示：

| 记号                  | 含义                                                               |
| --------------------- | ------------------------------------------------------------------ |
| `<ref>@{0}`           | `<ref>` 最近一次记录后的值，通常就是当前值                         |
| `<ref>@{<n>}`         | `<ref>` 向前数第 `<n>` 次移动前所在的位置；编号从 `0` 开始         |
| `<ref>@{<date>}`      | `<ref>` 在指定时间所处的位置；依据引用更新时间，而不是提交创建时间 |
| `HEAD@{2}`            | `HEAD` 在两次移动之前所处的位置                                    |
| `main@{yesterday}`    | 本地 `main` 在昨天所处的位置                                       |
| `main@{one.week.ago}` | 本地 `main` 在一周前所处的位置                                     |

本节使用的命令行参数：

| 参数              | 含义                         |
| ----------------- | ---------------------------- |
| `-n <count>`      | 最多显示 `<count>` 条记录    |
| `--date=<format>` | 按 `<format>` 显示记录的时间 |

```bash
# 用途：查看 HEAD 或指定引用的更新记录
# 结果：按时间倒序显示 reflog 位置、commit ID 和操作说明，不改变任何引用
git reflog show [-n <count>] [--date=<format>] [<ref>]
# 示例 1：以本地时间显示 HEAD 最近 10 条更新记录
git reflog show -n 10 --date=local HEAD
# 示例 2：显示 main 最近 5 条更新记录
git reflog show -n 5 main

# 用途：列出当前仓库中拥有 reflog 的引用
# 结果：输出引用名称，不改变 reflog 或引用
git reflog list

# 用途：检查指定引用是否拥有 reflog
# 结果：存在时返回退出状态 0，否则返回非零状态；不输出 reflog 内容
git reflog exists <ref>
# 示例 1：检查本地 main 分支是否拥有 reflog
git reflog exists refs/heads/main

# 用途：检查 reflog 中记录的旧位置
# 条件：指定记录尚未过期，且其指向的 Git 对象仍然存在
# 结果：显示该位置对应的提交及其补丁，不移动任何引用
git show <ref>@{<specifier>}
# 示例 1：检查 HEAD 在两次移动之前所指向的提交
git show HEAD@{2}

# 用途：将 reflog 中找到的提交保留为新分支
# 条件：指定记录及其提交仍然存在；<new-branch> 尚不存在
# 结果：创建指向该提交的新分支，不切换分支，也不移动现有引用
git branch <new-branch> <ref>@{<specifier>}
# 示例 1：将 HEAD 在两次移动之前所指向的提交保留为 rescue/example
git branch rescue/example HEAD@{2}
```

reflog 不是永久备份。默认情况下，可从当前引用到达的记录由 `gc.reflogExpire` 控制，默认保留 90 天；无法从当前引用到达的记录由 `gc.reflogExpireUnreachable` 控制，默认保留 30 天。实际期限可以通过配置修改；记录过期后，相应提交若也不再被其他引用或 reflog 保护，之后可能被垃圾回收删除。日常查看与恢复不需要直接执行 `reflog expire`、`delete` 或 `drop`。

## bundle：打包仓库历史

`bundle` 将引用及其可达 Git 对象写入单个文件，可在没有网络连接的环境中传输或备份仓库历史。它不包含工作目录、暂存区、stash、仓库配置、hooks 或 Git LFS 的实际对象。

本节使用的命令行参数：

| 参数    | 含义         |
| ------- | ------------ |
| `--all` | 包含所有引用 |

```bash
# 用途：创建包含所有引用及其可达对象的自包含 bundle
# 条件：执行命令所在的工作区可以是 clean 或 unclean
# 结果：将当前仓库可由所有引用到达的历史写入 <file>，不包含未提交状态和仓库配置
git bundle create <file> --all
# 示例 1：将当前仓库历史写入 project.bundle
git bundle create project.bundle --all

# 用途：验证 bundle 格式及其前置提交
# 条件：在一个 Git 仓库中执行；验证增量 bundle 时，应在接收方仓库中执行
# 结果：检查文件完整性，并列出当前仓库缺少的前置提交；不导入任何对象
git bundle verify <file>
# 示例 1：验证 project.bundle
git bundle verify project.bundle

# 用途：从自包含 bundle 创建新仓库
# 条件：<file> 必须是没有缺失前置提交的 bundle，<directory> 不能是已有的非空目录
# 结果：在 <directory> 中创建包含 bundle 历史的新仓库
git clone <file> <directory>
# 示例 1：从 project.bundle 创建 project/ 仓库
git clone project.bundle project

# 用途：查看 bundle 提供的引用
# 结果：显示其中可供读取的引用及其 commit ID，不导入任何对象
git ls-remote <file>
# 示例 1：查看 project.bundle 提供的引用
git ls-remote project.bundle

# 用途：从 bundle 获取指定引用
# 条件：在接收方仓库中执行；该仓库必须具备 bundle 要求的前置提交
# 结果：导入所需对象，并按引用规范更新本地引用
git fetch <file> <source-ref>:<destination-ref>
# 示例 1：将 project.bundle 的 main 分支获取为 bundle/main 远程跟踪引用
git fetch project.bundle refs/heads/main:refs/remotes/bundle/main
```

## archive：归档版本文件

`archive` 从指定提交、标签或树对象生成源码包。默认只读取该版本中被跟踪的文件，不包含 `.git`、未提交修改或未跟踪文件。

本节使用的命令行参数：

| 参数                               | 含义                           |
| ---------------------------------- | ------------------------------ |
| `--format=<format>`                | 将归档格式设为 `<format>`      |
| `--prefix=<prefix>/`               | 为归档内的路径添加 `<prefix>/` |
| `-o <output>`、`--output=<output>` | 将归档写入 `<output>`          |

```bash
# 用途：将指定版本导出为源码包
# 条件：执行命令所在的工作区可以是 clean 或 unclean
# 结果：把指定版本中的文件写入 <output>，并为包内路径添加 <prefix>/ 前缀
git archive --format=<format> --prefix=<prefix>/ -o <output> <tree-ish>
# 示例 1：将 v1.2.0 标签导出为 project-1.2.0.tar.gz
git archive --format=tar.gz --prefix=project-1.2.0/ -o project-1.2.0.tar.gz v1.2.0
```

`.gitignore` 会间接影响归档内容：被忽略且未加入版本库的文件不在提交中，`git archive` 自然不会导出它们。但 `.gitignore` 不能排除已经存在于被归档版本中的文件；需要从发布包中排除这类受跟踪路径时，在该版本的 `.gitattributes` 中设置 `export-ignore`：

```text
.github/** export-ignore
tests/** export-ignore
```

## bisect：二分定位引入变化的提交

`bisect` 用于在一个已知为 `good` 的提交和一个已知为 `bad` 的提交之间查找状态发生变化的位置。Git 每次选择一个候选提交；将其标记为 `good`、`bad` 或 `skip` 后，Git 缩小范围并选择下一个候选提交，直至定位边界。

整个过程必须使用同一判定标准，并且目标状态在所选范围内应只从 `good` 变为 `bad` 一次。无法可靠判断的提交应标记为 `skip`；如果这类提交紧邻边界，Git 可能只能给出多个候选提交。

```bash
# 用途：指定 bad 与 good 边界并开始二分
# 条件：两个边界已经过验证；工作区能够安全切换提交
# 结果：记录开始前的 HEAD，并切换到第一个候选提交
git bisect start <bad> <good>
# 示例 1：在当前提交与 v1.0.0 之间开始二分
git bisect start HEAD v1.0.0

# 用途：将当前候选提交标记为正常
# 条件：bisect 正在进行，且当前提交已确认为 good
# 结果：更新 good 边界，并切换到下一个候选提交或报告结果
git bisect good

# 用途：将当前候选提交标记为异常
# 条件：bisect 正在进行，且当前提交已确认为 bad
# 结果：更新 bad 边界，并切换到下一个候选提交或报告结果
git bisect bad

# 用途：跳过当前无法可靠判断的候选提交
# 条件：bisect 正在进行，且当前提交不能归类为 good 或 bad
# 结果：选择其他候选提交；边界附近存在 skip 时可能无法确定唯一结果
git bisect skip

# 用途：结束二分
# 条件：bisect 正在进行
# 结果：清除二分状态，并恢复开始二分前所在的分支或提交位置
git bisect reset
```

能够用命令或脚本稳定判断状态时，`git bisect run` 可以自动测试每个候选提交：

| 测试命令的退出状态      | 判定     |
| ----------------------- | -------- |
| `0`                     | `good`   |
| `1`–`127`，但不含 `125` | `bad`    |
| `125`                   | `skip`   |
| 其他值                  | 中止二分 |

```bash
# 用途：用指定命令自动测试候选提交
# 条件：bisect 正在进行；命令能够按约定返回稳定的退出状态
# 结果：反复测试并标记候选提交，直至定位边界或中止二分
git bisect run <command> [<argument>...]
# 示例 1：用仓库外的脚本自动测试候选提交
git bisect start HEAD v1.0.0
git bisect run ../test-regression.sh
git bisect reset
```

测试命令必须能在各候选提交中运行。只有目标状态出现时才应返回 `bad`；与目标无关的构建失败或环境问题应返回 `125`。

```bash
# 用途：输出当前二分过程的操作记录
# 条件：bisect 正在进行
# 结果：输出可供检查、保存或 replay 使用的记录，不改变二分状态
git bisect log
# 示例 1：将记录保存到仓库外的文件
git bisect log > ../bisect.log

# 用途：从已有记录恢复二分进度
# 条件：<log-file> 是 git bisect log 生成的有效记录；工作区能够安全切换提交
# 结果：重放记录中的 start、good、bad 和 skip 操作
git bisect replay <log-file>
# 示例 1：从保存的记录恢复二分进度
git bisect reset
git bisect replay ../bisect.log
```

## maintenance：维护仓库数据

`maintenance` 用于整理不断积累的提交、对象、pack 文件和引用等仓库数据，以缩短历史遍历、获取对象和读取引用所需的时间。它不以修改工作目录中的项目文件为目的，执行时工作区可以是 clean 或 unclean。

长期维护大型或频繁更新的仓库时，通常不需要逐项选择维护任务。最直接的入口是 `git maintenance start`：它将当前仓库加入用户级维护名单，并建立一个供所有已登记仓库共用的后台调度器。此前没有设置维护策略时，Git 同时采用 `incremental` 策略，其实际调度如下：

| 频率   | 自动执行的任务                        | 实际作用                                                                |
| ------ | ------------------------------------- | ----------------------------------------------------------------------- |
| 每小时 | `commit-graph`、`prefetch`            | 更新提交图；把远程对象预取到 `refs/prefetch/`，但不移动普通远程跟踪分支 |
| 每天   | `loose-objects`、`incremental-repack` | 分批打包松散对象，并逐步合并较小的 pack 文件                            |
| 每周   | `pack-refs`                           | 整理松散引用，加快大量引用的遍历                                        |

该策略不调度全面的 `gc`。`prefetch` 会访问远程仓库，但不会更新普通远程跟踪分支或标签；之后执行常规 `fetch` 时，需要传输的对象通常会更少。

本节使用的命令行参数：

| 参数                      | 含义                                                                          |
| ------------------------- | ----------------------------------------------------------------------------- |
| `--task=<task>`           | 只运行指定任务；可以重复使用，并按给定顺序执行                                |
| `--auto`                  | 仅在仓库状态达到相应任务的触发阈值时运行                                      |
| `--scheduler=<scheduler>` | 为 `start` 指定 `auto`、`crontab`、`systemd-timer`、`launchctl` 或 `schtasks` |
| `--global`                | 用于 `git config` 时，读取当前用户的全局配置                                  |
| `--get-all <name>`        | 输出配置项 `<name>` 的全部取值                                                |
| `--unset <name>`          | 删除配置项 `<name>`                                                           |

```bash
# 用途：让当前仓库开始接受定时维护
# 条件：执行命令所在的工作区可以是 clean 或 unclean；操作系统中存在可用调度器
# 结果：登记当前仓库，未配置策略时设为 incremental，关闭普通 Git 命令触发的自动维护，并创建或更新用户级后台调度
git maintenance start [--scheduler=<scheduler>]
# 示例 1：让 Git 根据操作系统自动选择调度器
git maintenance start --scheduler=auto

# 用途：在不改动现有调度器的情况下，将另一个仓库加入维护名单
# 条件：在需要加入的仓库中执行；工作区可以是 clean 或 unclean
# 结果：登记当前仓库并完成与 start 相同的仓库配置，但不创建或启动调度器
git maintenance register
# 示例 1：调度器已经由其他仓库启动，将相邻的 project-b 加入同一维护名单
cd ../project-b
git maintenance register

# 用途：查看已登记的仓库
# 结果：输出当前用户全局配置中的所有 maintenance.repo 值
git config --global --get-all maintenance.repo

# 用途：只停止当前仓库的定时维护
# 条件：当前仓库已经登记；工作区可以是 clean 或 unclean
# 结果：从维护名单中移除当前仓库，其他仓库和调度器保持不变；maintenance.auto=false 仍然保留
git maintenance unregister
# 可选：恢复普通 Git 命令按需触发自动维护的默认行为
git config --unset maintenance.auto

# 用途：暂停所有已登记仓库的定时维护
# 条件：工作区可以是 clean 或 unclean
# 结果：停止并移除共用的用户级调度器，但保留维护名单；以后执行 start 可以继续处理这些仓库
git maintenance stop

# 用途：针对明确问题手动运行指定任务
# 条件：执行命令所在的工作区可以是 clean 或 unclean；每个 <task> 都必须是受支持的任务名称
# 结果：仅按参数出现顺序执行指定任务，不运行其他任务
git maintenance run --task=<task> [--task=<task>...]
# 示例 1：导入大量提交后，立即更新 commit-graph
git maintenance run --task=commit-graph
# 示例 2：仓库积累了大量松散对象和较小 pack 文件，执行增量整理
git maintenance run --task=loose-objects --task=incremental-repack
# 示例 3：需要一次全面整理时单独运行 gc；不要与 loose-objects 放在同一次维护中
git maintenance run --task=gc

# 用途：仅在仓库达到相应维护阈值时运行任务
# 条件：执行命令所在的工作区可以是 clean 或 unclean
# 结果：达到阈值时执行维护，否则不改变仓库数据
git maintenance run --auto
```

全面 `gc` 可能耗时较长，也可能清理已经超过保留期限且无法到达的数据。启用 `start` 后通常无需再手动运行上述任务；显式指定 `--task` 主要用于立即处理已经确认的仓库数据问题。
