---
title: Git 多身份与多环境配置
description: 系统区分 Git 提交身份、GitHub CLI 账号、远程认证与提交签名，并为单账号、多账号和多平台环境建立可核验的配置。
---

多数人第一次使用 Git 时，只会在全局配置中写入一组姓名和邮箱。只使用一个托管账号时，这通常不会产生问题；当同一台计算机开始同时保存个人仓库和工作仓库、分别使用 GitHub 与 Gitee，或者在同一个平台使用多个账号时，一组全局默认值便不再适用于所有仓库。

此时容易出现两类错配：代码能够正常推送，但提交记录了错误的姓名或邮箱；提交身份正确，访问远程仓库时却使用了另一个账号。Git 无法根据“个人仓库”或“工作仓库”这样的使用场景自动切换身份，因为创建提交和访问远程仓库原本就是两套独立机制。

创建提交时，Git 把姓名和邮箱写入提交；访问远程仓库时，SSH 密钥或 HTTPS 凭据向托管平台证明账号身份；如果启用提交签名，还会另外选择一把签名密钥。GitHub CLI（`gh`）又维护着用于 GitHub API 和命令行操作的活动账号。多身份配置就是为每个仓库建立这些信息之间的正确对应关系。

## Git 工作流中的身份

一次常见的 GitHub 工作流会接触四类身份信息：

| 操作                         | 实际使用的身份信息       | 主要来源                                     |
| ---------------------------- | ------------------------ | -------------------------------------------- |
| 创建提交                     | 作者与提交者的姓名、邮箱 | `user.name`、`user.email` 及相关环境变量     |
| `git fetch`、`push`、`clone` | 远程服务认可的账号凭据   | SSH 密钥或 HTTPS credential helper           |
| `gh pr`、`repo`、`api`       | GitHub CLI 的活动账号    | `gh auth login`、`gh auth switch` 或环境变量 |
| 签署提交或标签               | 用于生成数字签名的密钥   | `user.signingKey`、签名格式及签名程序        |

`user.name` 和 `user.email` 只是提交元数据，不是 GitHub、GitLab 等平台的登录凭据。修改这两个配置不会切换 SSH 密钥，也不会替换 HTTPS 凭据；成功推送到某个账号有权访问的仓库，同样不能证明提交中记录的姓名和邮箱正确。

提交对象分别记录作者和提交者。作者表示原始修改的作者，提交者表示创建当前提交对象的人。普通提交中的两组信息通常相同；`cherry-pick`、`rebase` 等操作可能保留作者信息，同时以当前身份重新记录提交者信息。

`gh` 不是 Git 的统一账号开关。它可以调用 GitHub API，也可以作为 Git 的 HTTPS 凭据助手，但不会修改提交中的姓名和邮箱，也不会替 Git 选择签名密钥。提交签名同样不参与远程登录；只有需要证明提交或标签由某个密钥持有者签署时，才需要继续配置签名。

## 提交身份的配置来源

Git 会依次读取 system、global、local、worktree 和 command 等作用域的配置。对于 `user.name`、`user.email` 这类单值配置，后读取的有效值通常覆盖先前的值。用户级配置位于 `~/.gitconfig` 或 `$XDG_CONFIG_HOME/git/config`，仓库级 local 配置位于 Git 管理目录的 `config` 文件中。

`includeIf` 可以在满足条件时加载另一个配置文件。被加载的内容会插入 `includeIf` 所在位置，它本身不构成新的作用域。因此，global 配置中加载的身份文件仍属于 global 作用域，仓库的 local 配置可以继续覆盖它。

多身份配置常用三种选择依据：

| 选择依据                  | 适用情况                             | 边界                                                   |
| ------------------------- | ------------------------------------ | ------------------------------------------------------ |
| `gitdir:`                 | 仓库能够按个人、工作等目录归类       | 仓库需要位于约定目录下                                 |
| `hasconfig:remote.*.url:` | 仓库分散存放，但远程地址具有稳定特征 | 添加远程地址前无法匹配；被加载的文件不能再定义远程 URL |
| 仓库 local 配置           | 少量例外仓库                         | 需要逐个仓库维护                                       |

`onbranch:` 会随当前分支变化，适合分支相关配置，不适合表示一个仓库长期使用的身份。

对于能够统一整理目录的仓库，`gitdir:` 的规则最直接：创建远程地址之前即可生效，移动或复制配置时也容易判断匹配范围。仓库级配置则保留给例外，而不是让每个仓库都重复保存一套相同身份。

## 选择认证方式

提交身份始终可以用 `includeIf` 按目录选择；真正需要根据使用场景决定的是远程认证和 `gh` 的账号选择方式。

| 使用场景                          | 建议方案                                      | 账号选择方式                                      |
| --------------------------------- | --------------------------------------------- | ------------------------------------------------- |
| 只使用一个 GitHub 账号            | `gh` 管理 HTTPS 凭据                          | 登录一次后持续使用该账号                          |
| 同时使用 GitHub 与 Gitee          | `ghq` 按主机组织目录；两端分别认证            | GitHub 使用 `gh`，Gitee 使用自己的 SSH 或 HTTPS   |
| 同一 GitHub 主机上偶尔切换账号    | `gh` 管理 HTTPS 凭据                          | 操作前使用 `gh auth switch` 切换活动账号          |
| 多个 GitHub 账号需要长期并行      | Git 使用 SSH 主机别名，`gh` 单独管理 API 账号 | 每个远程 URL 固定 SSH 密钥；`gh` 仍按活动账号工作 |
| 必须使用 HTTPS 且要按仓库固定账号 | 使用 Git Credential Manager 等多账号凭据助手  | 在远程 URL 中明确写入账号                         |

`gh + HTTPS` 是单一 GitHub 账号下最简洁的路径，也是 GitHub 官方推荐的 HTTPS 凭据方案之一。它也能保存同一主机上的多个账号，但当前采用“每个主机一个活动账号”的模型，而不是“每个仓库自动绑定一个账号”。因此，频繁并行使用多个 GitHub 账号时，SSH 主机别名仍然具有明确且稳定的仓库级选择能力，并未因 `gh` 出现而过时。

## 配置提交身份与认证

下面以按目录划分的个人仓库和工作仓库为共同基础。目录负责选择提交身份，远程认证则根据上一节的使用场景选择 `gh + HTTPS`、SSH 主机别名或其他 HTTPS 凭据助手。两者互不依赖，也应分别检查。

```text
~/code/personal/    个人仓库
~/code/work/        工作仓库
```

### 提交身份

全局配置 `~/.gitconfig` 只保存选择规则和安全约束：

```ini
[user]
    useConfigOnly = true

[includeIf "gitdir:~/code/personal/"]
    path = ~/.config/git/personal.inc

[includeIf "gitdir:~/code/work/"]
    path = ~/.config/git/work.inc
```

以 `/` 结尾的 `gitdir:` 模式会匹配该目录中的所有仓库，包括更深层的子目录。如果路径大小写不稳定，可以使用 `gitdir/i:` 进行不区分大小写的匹配。

个人身份配置 `~/.config/git/personal.inc`：

```ini
[user]
    name = Example User
    email = personal@example.com
```

工作身份配置 `~/.config/git/work.inc`：

```ini
[user]
    name = Example User
    email = user@company.example
```

`user.useConfigOnly = true` 禁止 Git 根据系统用户名和主机名猜测姓名或邮箱。按照上面的配置，如果仓库没有匹配任何身份文件，也没有设置 local 身份，Git 会在创建提交时要求补全身份，而不会悄悄使用推测值。

少量例外可以直接写入当前仓库：

```bash
git config --local user.name "Example User"
git config --local user.email "another-address@example.com"
```

local 配置只影响当前仓库，不会写入提交历史，也不会随项目文件推送到远程仓库。

### GitHub CLI 与 HTTPS

GitHub 官方目前推荐使用 GitHub CLI 或 Git Credential Manager 保存 HTTPS 凭据，而不是把访问令牌写入远程 URL 或普通配置文件。使用 `gh` 的常规配置过程只需要从登录命令开始：

```bash
gh auth login
```

按照交互提示选择 GitHub.com、HTTPS 和浏览器登录；若出现是否使用 GitHub 凭据验证 Git 的提示，选择确认。认证完成后，`gh` 会自动登录 GitHub CLI、保存令牌、记录该主机偏好的 Git 协议，并完成 Git 的 HTTPS 凭据设置。

实际使用中，配置到这里通常已经结束：后续 `gh repo`、`gh pr`、`gh api` 可以直接调用 GitHub API，使用 HTTPS 远程的 `git clone`、`git pull` 和 `git push` 也不需要另外创建或粘贴访问令牌。

网页登录取得的令牌优先保存在系统凭据存储中；系统没有可用凭据存储时，`gh` 会退回到自己的配置文件。当前登录账号、令牌状态和保存方式可以通过 `gh auth status` 查看，不应使用 `--show-token` 记录或分享实际令牌。

如果登录时没有同意为 Git 配置凭据，相关配置后来被删除，或者明确希望让 Git 直接调用 `gh` 获取凭据，可以单独执行：

```bash
gh auth setup-git --hostname github.com
```

这是一条补充或修复命令，不是正常登录流程中的第二步。

完成配置后，普通 HTTPS 远程不需要在 URL 中包含账号或令牌：

```bash
git clone https://github.com/example-user/project.git ~/code/personal/project
git push origin main
```

未通过环境变量覆盖令牌时，GitHub CLI 直接使用 `gh` 的活动账号。Git 的 HTTPS 操作使用哪个账号，还取决于最终生效的 credential helper。`gh auth login` 可以复用计算机上已经存在的凭据助手；只有 Git 的有效配置指向 `gh auth git-credential` 时，Git 才会在每次需要凭据时读取 `gh` 的活动账号：

```text
gh pr、gh repo、gh api
└── gh 直接使用活动账号的令牌

git fetch、git push、git clone https://github.com/...
└── Git 调用 credential helper
    └── gh auth git-credential 返回活动账号的令牌
```

可以分别核对登录、协议、凭据助手和远程地址：

```bash
gh auth status --active --hostname github.com
gh config get git_protocol --host github.com
git config --show-origin --get-all credential.https://github.com.helper
git remote get-url origin
```

如果远程地址以 `https://github.com/` 开头，并且凭据助手中出现 `gh auth git-credential`，该仓库使用的就是 `gh + HTTPS`。这只说明远程认证方式，提交身份仍由 `user.name` 和 `user.email` 决定。

如果有效凭据助手是 Git Credential Manager、系统钥匙串或其他程序，`gh auth login` 仍可在登录过程中把 GitHub 凭据交给它保存，但之后的 Git 操作由该助手管理。此时 `gh auth switch` 一定会切换 GitHub CLI 的账号，却不等于同步切换外部凭据助手为 Git 返回的账号。

#### `gh` 的多账号切换

`gh auth login` 可以在同一个 GitHub 主机下继续添加账号，并会把刚登录的账号设为活动账号。`gh auth status` 会列出所有已保存账号及当前活动账号；只有需要改用另一个已保存账号时，才执行 `gh auth switch`：

```bash
# 再次登录另一个 GitHub 账号；登录成功后，该账号自动成为活动账号
gh auth login

gh auth status --hostname github.com

# 需要改回先前保存的个人账号时再执行
gh auth switch --hostname github.com --user personal-user
```

`gh auth switch` 改变的是 `github.com` 这一主机的活动账号。它会影响后续 `gh` 命令；当 `gh` 已作为 Git 的 credential helper 时，也会改变后续 Git HTTPS 操作取得的令牌。这个选择作用于主机，而不是当前仓库：切换到工作账号后，其他 GitHub 仓库的 HTTPS 操作也会使用工作账号，直到再次切换。

因此，这种方式适合只有一个 GitHub 账号，或者多个账号之间只是偶尔切换的情况。它不适合把个人账号和工作账号长期、自动地分别绑定到不同仓库。远程 URL 中的组织或仓库路径不会让 `gh` 自动选择对应账号。

`gh` 的 `git_protocol` 同样按主机保存，并由该主机下的所有已登录账号共用。它决定 `gh` 创建或克隆仓库时偏好的协议，但不会改写已有仓库的远程 URL；已有远程究竟使用 HTTPS 还是 SSH，仍以 `git remote get-url` 的结果为准。

`GH_TOKEN` 或 `GITHUB_TOKEN` 等环境变量的优先级高于 `gh` 已保存的凭据，主要用于自动化环境。排查本地账号错配时，还需要确认当前 shell 是否设置了这些变量。

### 典型场景：用 `ghq` 管理 GitHub 与 Gitee

常见用法是在同一台计算机上同时保存 GitHub 和 Gitee 仓库：GitHub 使用 `gh` 登录，Gitee 单独配置认证。`ghq` 正好会按远程地址的主机、所有者和仓库名组织目录，因此可以直接为 `includeIf` 提供稳定的路径边界。

先查看 `ghq` 使用的根目录：

```bash
ghq root
```

以下以默认的 `~/ghq` 为例。通过 `ghq get` 克隆后，两个平台的仓库会自然分开：

```text
~/ghq/
├── github.com/
│   └── example-user/
│       └── project/
└── gitee.com/
    └── example-user/
        └── project/
```

`ghq` 不负责选择提交身份或登录账号；它的作用是根据远程地址自动建立这套目录结构。`~/.gitconfig` 可以利用目录结构加载不同身份：

```ini
[includeIf "gitdir:~/ghq/github.com/"]
    path = ~/.config/git/github.inc

[includeIf "gitdir:~/ghq/gitee.com/"]
    path = ~/.config/git/gitee.inc
```

如果两个平台使用相同的姓名、邮箱和签名设置，两条规则可以加载同一个身份文件；如果身份不同，则分别写入 `github.inc` 和 `gitee.inc`。

#### GitHub：`gh` 登录，`ghq` 克隆

首次使用时执行一次 `gh auth login`，选择 HTTPS 并同意为 Git 配置凭据。以后用 HTTPS 地址交给 `ghq`：

```bash
ghq get https://github.com/example-user/project.git
```

`ghq` 实际调用 Git 完成克隆，并把仓库放入：

```text
~/ghq/github.com/example-user/project/
```

仓库的 `origin` 保存原来的 GitHub HTTPS 地址。后续 `git pull` 和 `git push` 通过 Git 的 credential helper 取得 `gh` 已保存的凭据，不需要再次登录，也不需要在命令中写账号。

#### Gitee：独立配置认证

`gh` 只处理 GitHub，不能替 Gitee 登录。Gitee 可以单独使用 SSH；每个平台只使用一个账号时，直接为真实主机配置密钥即可：

```text
Host gitee.com
    User git
    IdentityFile ~/.ssh/id_ed25519_gitee
    IdentitiesOnly yes
```

然后使用 Gitee 的 SSH 地址：

```bash
ghq get git@gitee.com:example-user/project.git
```

仓库会被放入：

```text
~/ghq/gitee.com/example-user/project/
```

以后进入该仓库，`git pull` 和 `git push` 会根据 `origin` 中的 `gitee.com` 自动使用 Gitee 的 SSH 密钥。也可以改用 Gitee HTTPS 地址和 credential helper；它与 GitHub 的凭据记录按主机名分开。

两个平台的日常操作完全相同：

```bash
git pull
git push
```

目录让 `includeIf` 自动选择提交身份，`origin` 的主机名让 Git 自动选择远程平台，SSH 或 credential helper 再选择对应凭据。只有首次克隆时需要提供完整远程地址。

#### 同一个仓库同步到两个平台

这是另一种独立场景：同一个本地仓库需要同时推送到 GitHub 和 Gitee。只有这种情况才需要为两个远程分别命名：

```bash
git remote add github https://github.com/example-user/project.git
git remote add gitee git@gitee.com:example-user/project.git

git push github main
git push gitee main
```

如果两个平台上的仓库是相互独立的项目，则都使用各自默认的 `origin`，不需要上述配置。

### 用 SSH 固定多个 GitHub 账号

本节只处理一种情况：同一台计算机需要长期并行使用两个 GitHub 账号。只有一个 GitHub 账号，或者使用的是 GitHub 和 Gitee 两个不同平台时，不需要这里的主机别名。

SSH 通过密钥证明账号身份。两个 GitHub 账号访问的主机都是 `github.com`，因此需要先给同一个主机定义两个本机名称，再让每个名称固定使用一把密钥：

`~/.ssh/config`：

```text
# 本机名称 github-personal → github.com → 个人密钥
Host github-personal
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_personal
    IdentitiesOnly yes

# 本机名称 github-work → github.com → 工作密钥
Host github-work
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_work
    IdentitiesOnly yes
```

`Host` 后面的名称只在本机使用；`HostName` 才是真正连接的服务器。`IdentityFile` 指定该名称使用的私钥，`IdentitiesOnly yes` 阻止 `ssh-agent` 中其他已加载的密钥被一并尝试。

仓库的远程地址写入哪个本机名称，SSH 就使用哪把密钥：

```text
git@github-work:example-org/project.git
        │
        └─ 匹配 Host github-work
             └─ 连接 github.com
                  └─ 使用 id_ed25519_work
                       └─ GitHub 识别为工作账号
```

克隆仓库时只需选择一次：

```bash
git clone git@github-personal:example-user/project.git \
  ~/code/personal/project

git clone git@github-work:example-org/project.git \
  ~/code/work/project
```

`git clone` 会把来源地址保存为 `origin`。以后进入仓库，直接执行普通 Git 命令，不需要再次指定账号或密钥：

```bash
git pull
git push
```

已有仓库只需修改一次 `origin`：

```bash
git remote set-url origin \
  git@github-work:example-org/project.git
```

目录和远程地址解决的是两个不同问题：`~/code/work/` 通过 `includeIf` 选择提交中记录的姓名、邮箱和签名；`origin` 中的 `github-work` 选择推送时使用的 GitHub 账号。二者配置完成后都会自动生效。

使用 SSH 推送时，Git 不读取 `gh` 的活动账号；`gh pr`、`gh repo` 等命令仍使用 `gh` 的活动账号。需要以另一个账号调用 GitHub API 时，再执行 `gh auth switch`。

### 必须使用 HTTPS 的多个 GitHub 账号

一个 GitHub 账号使用 HTTPS 时，前面的 `gh auth login` 已经足够。多个 GitHub 账号需要长期绑定到不同仓库时，SSH 主机别名通常更直接；只有环境要求必须使用 HTTPS 时，才需要 Git Credential Manager 等支持多账号的凭据助手。

远程地址可以写入公开的 GitHub 用户名，使凭据助手知道应该读取哪个账号的凭据：

```bash
git clone \
  https://personal-user@github.com/example-user/project.git \
  ~/code/personal/project

git clone \
  https://work-user@github.com/example-org/project.git \
  ~/code/work/project
```

这里的 `personal-user` 和 `work-user` 只是用户名，不是访问令牌。首次访问时，凭据助手完成网页登录并把令牌保存到系统安全存储；以后仍然只需使用 `git pull` 和 `git push`。

可以用下面的命令查看当前生效的凭据配置及其来源：

```bash
git config --show-origin --get-regexp '^credential\.'
```

该命令会列出名称以 `credential.` 开头的全部配置，并在每行前面显示配置来自哪个文件。没有输出表示当前没有此类显式配置。若 `credential.helper` 的值为 `store`，凭据会以明文形式长期保存在磁盘，不应将它作为访问令牌的常规存储方式。

### 提交签名与 GitHub `Verified`

提交签名是可选功能，用来证明提交由相应私钥签署。只需要区分提交身份和远程账号时，可以跳过本节；下面以 GitHub 的 `Verified` 标记为具体场景，使用 Git 2.34 及以上版本支持的 SSH 签名。

#### 一次性配置

首先生成一把专用于个人提交签名的密钥，并把私钥加入 `ssh-agent`：

```bash
ssh-keygen -t ed25519 -C "personal@example.com" \
  -f ~/.ssh/id_ed25519_signing_personal
ssh-add ~/.ssh/id_ed25519_signing_personal
```

然后把公钥登记为正确 GitHub 账号的 signing key。已经登录 `gh` 时，可以直接上传；多账号环境先核对活动账号：

```bash
gh auth status --active --hostname github.com
# 仅当活动账号不是 personal-user 时执行
gh auth switch --hostname github.com --user personal-user
gh ssh-key add ~/.ssh/id_ed25519_signing_personal.pub \
  --type signing \
  --title "Personal signing key"
```

也可以在 GitHub 的 **Settings → SSH and GPG keys → New SSH key** 中选择 **Signing Key**，再粘贴 `id_ed25519_signing_personal.pub` 的内容。上传公钥只让 GitHub 能够验证签名，还需要继续告诉本地 Git 使用哪把密钥。

把签名设置写入前面由 `includeIf` 加载的个人身份文件 `personal.inc`：

```ini
[user]
    name = Example User
    email = personal@example.com
    signingKey = /home/example/.ssh/id_ed25519_signing_personal.pub

[gpg]
    format = ssh

[commit]
    gpgSign = true
```

`signingKey` 指向公钥文件，签名时由 `ssh-agent` 提供对应私钥。`commit.gpgSign = true` 让该身份创建的新提交默认带有签名；如果只想签署个别提交，可以删除这一项，并在需要时执行 `git commit -S`。

#### 日常使用

配置完成后，普通提交会自动签名：

```bash
git commit -m "Signed commit"
git push
```

GitHub 收到提交后，会用账号中登记的 signing key 验证签名并显示 `Verified`。这个结果不取决于使用 SSH 还是 HTTPS 推送；提交显示在哪个用户的贡献记录中，仍由提交邮箱与 GitHub 账号的关联关系决定。

#### 可选：在本地验证

GitHub 的 `Verified` 是平台端验证。本地执行 `git verify-commit` 还需要维护 allowed signers 文件，例如 `~/.config/git/allowed_signers`：

```text
personal@example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA...
```

再配置其路径：

```ini
[gpg "ssh"]
    allowedSignersFile = /home/example/.config/git/allowed_signers
```

之后可以在本地验证：

```bash
git verify-commit HEAD
```

allowed signers 文件只决定本机信任哪些公钥，不会上传到 GitHub，也不影响 GitHub 的 `Verified`。工作身份需要独立签名时，在 `work.inc` 中配置另一把 signing key，并把对应公钥登记到工作账号。

## 配置的边界与核验

目录规则是否生效，应以 Git 的实际配置结果为准。移动仓库或创建 linked worktree 后，可以重新执行 `git config --show-origin --get user.email`，确认当前身份来自预期文件。

身份配置只影响此后创建的提交。移动仓库、修改 `user.email` 或更换 SSH 密钥都不会改写已有提交；已有提交中的作者、提交者和签名属于提交对象本身。若通过 rebase 等操作重新创建提交，新提交的提交者信息和签名可能随当前配置变化。

配置文件的内容正确，并不代表当前仓库最终使用的值正确。仓库 local 配置、命令行 `-c` 参数或环境变量都可能改变结果。以下命令分别检查每一层：

| 核验内容                          | 命令                                                                      |
| --------------------------------- | ------------------------------------------------------------------------- |
| 所有配置的最终值、来源和作用域    | `git config --list --show-origin --show-scope`                            |
| Git 将写入的新提交身份            | `git var GIT_AUTHOR_IDENT`、`git var GIT_COMMITTER_IDENT`                 |
| 当前远程地址                      | `git remote get-url origin`                                               |
| `gh` 保存的账号及当前活动账号     | `gh auth status --hostname github.com`                                    |
| `gh` 当前偏好的 Git 传输协议      | `gh config get git_protocol --host github.com`                            |
| GitHub HTTPS 凭据助手及其配置来源 | `git config --show-origin --get-all credential.https://github.com.helper` |
| SSH 别名最终使用的连接配置        | `ssh -G github-work`                                                      |
| GitHub 实际识别的 SSH 账号        | `ssh -T github-work`                                                      |
| 已有提交记录的身份与签名          | `git show --no-patch --format=fuller --show-signature HEAD`               |

常见错配应按实际发生问题的链路分别定位：

| 现象                                        | 检查位置                                                      |
| ------------------------------------------- | ------------------------------------------------------------- |
| 提交邮箱错误，但推送账号正确                | `includeIf` 是否匹配，以及 local 配置是否覆盖身份文件         |
| 提交邮箱正确，但推送账号错误                | 远程 URL、SSH 主机别名、`gh` 活动账号或 HTTPS 凭据记录        |
| `gh` 命令使用错误账号，但 SSH 推送账号正确  | `gh auth status`；SSH 密钥不会替 `gh` 选择 API 账号           |
| `gh auth switch` 后，Git HTTPS 仍使用旧账号 | `gh` 是否确实是 `github.com` 的 credential helper             |
| SSH 别名测试正确，但 Git 使用其他密钥       | `origin` 是否确实使用对应别名，而不是 `github.com`            |
| 新仓库无法创建提交                          | 仓库是否匹配身份文件；`user.useConfigOnly` 是否阻止了身份猜测 |
| 签名成功，但平台未显示为已验证              | 签名公钥登记的账号、提交邮箱和平台验证规则                    |

一套可长期维护的多身份配置不依靠模糊的“当前账号”：仓库配置决定提交中记录谁，远程 URL 与凭据机制决定 `git push` 以谁的权限执行，`gh` 的活动账号决定 GitHub CLI 代表谁调用 API，签名配置决定用哪把密钥签署提交。四条链路可以分别查询，才能在增加账号、平台或签名策略后继续得到可预期的结果。

## 参考文档

- [Git 配置作用域与条件加载](https://git-scm.com/docs/git-config)
- [Git HTTPS 凭据](https://git-scm.com/docs/gitcredentials)
- [`ghq` 官方说明](https://github.com/x-motemen/ghq)
- [OpenSSH 客户端配置](https://man.openbsd.org/ssh_config)
- [GitHub CLI 登录](https://cli.github.com/manual/gh_auth_login)
- [将 GitHub CLI 配置为 Git 凭据助手](https://cli.github.com/manual/gh_auth_setup-git)
- [GitHub CLI 多账号切换](https://cli.github.com/manual/gh_auth_switch)
- [GitHub CLI 多账号设计说明](https://github.com/cli/cli/blob/trunk/docs/multiple-accounts.md)
- [GitHub HTTPS 凭据的推荐管理方式](https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git)
- [GitHub 多账号管理](https://docs.github.com/en/account-and-profile/how-tos/account-management/managing-multiple-accounts)
- [Git Credential Manager 多账号配置](https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/multiple-users.md)
- [Gitee HTTPS 凭据问题说明](https://gitee.com/help/articles/4298)
- [向 GitHub 账号添加 SSH 密钥](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/adding-a-new-ssh-key-to-your-github-account)
- [GitHub 提交签名验证](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification)
