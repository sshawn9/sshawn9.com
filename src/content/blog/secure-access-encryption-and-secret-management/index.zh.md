---
title: SSH 访问、age 文件加密与 SOPS 机密管理
description: 梳理 SSH 公钥认证、age 文件加密与 SOPS 结构化机密管理的基本机制和常用操作，并说明 SSH 密钥与 age identity 之间的转换及验证方法。
---

## SSH

SSH 是一种安全远程访问协议。最常见的公钥认证方式使用一对密钥：公钥可以分发，私钥必须由持有者保管。

### 生成密钥

生成 Ed25519 密钥对：

```bash
# -t 指定密钥类型
# -C 添加用于识别密钥的可选注释，不参与密钥生成或身份认证
# 接受默认保存路径后生成 ~/.ssh/id_ed25519（私钥）和 ~/.ssh/id_ed25519.pub（公钥）
ssh-keygen -t ed25519 -C "name@example.com"
```

### 安装公钥

如果远程服务器允许密码登录，可以使用 `ssh-copy-id` 安装公钥：

```bash
# -i 指定要安装的公钥文件
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@example.com
```

`ssh-copy-id` 通常把公钥登记到远程账户的 `~/.ssh/authorized_keys` 中。服务器由此授权该公钥用于登录认证：客户端用对应私钥对当前会话的认证数据签名，服务器再用已经授权的公钥验证签名；能够产生有效签名，便证明客户端持有对应私钥。整个过程中，私钥无需传输。

### 查看与验证密钥

GitHub 会在 SSH keys 页面显示每把已登记公钥的 SHA-256 指纹。运行以下命令并比较两处的 `SHA256:...`；指纹一致，说明 GitHub 中登记的就是这一本地公钥：

```bash
# -l 显示公钥指纹，-f 指定要读取的密钥文件
ssh-keygen -lf ~/.ssh/id_ed25519.pub
```

从私钥重新导出公钥：

```bash
# -y 从私钥读取并输出对应的公钥，-f 指定私钥文件
ssh-keygen -y -f ~/.ssh/id_ed25519
```

它可以用来验证私钥是否与某个公钥对应。导出的结果通常没有原公钥末尾的注释，因此应比较密钥类型和 Base64 编码部分，而不是要求整行文本完全相同。

### 使用 `ssh-agent`

`ssh-agent` 可以在当前登录会话中保存已经解锁的私钥，避免每次连接都重新输入私钥口令。许多桌面环境会自动启动 agent；如果当前环境没有，可以手动启动并添加密钥：

```bash
# -s 输出适用于 Bourne shell 的环境变量设置命令
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

查看 agent 中已经加载的密钥：

```bash
# -l 列出 agent 中密钥的指纹
ssh-add -l
```

从 agent 中移除指定密钥：

```bash
# -d 从 agent 中删除指定私钥
ssh-add -d ~/.ssh/id_ed25519
```

### 使用 SSH 配置

经常连接同一主机时，可以在 `~/.ssh/config` 中保存主机名、用户名和密钥路径：

```text
Host example
  HostName example.com
  User user
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes # 限制客户端只使用明确指定的 identity，避免 agent 中密钥过多时逐个尝试。
```

之后只需执行：

```bash
ssh example
```

OpenSSH 对公钥格式、`authorized_keys` 和文件权限的完整说明参见 [`sshd(8)`](https://man.openbsd.org/sshd) 与 [`ssh_config(5)`](https://man.openbsd.org/ssh_config)。

## age

age 是一个面向文件加密的工具。它把加密目标称为 **recipient**，把解密凭据称为 **identity**：recipient 可以公开，identity 必须保密。

### 生成 age identity

生成一对原生 age 密钥：

```bash
mkdir -p ~/.config/sops/age
# -o 指定 identity 的输出文件
age-keygen -o ~/.config/sops/age/keys.txt
chmod 600 ~/.config/sops/age/keys.txt
```

上述命令将 identity 写入 `keys.txt`，同时在终端输出与之对应、以 `age1` 开头的 recipient。加密文件时使用 recipient；如果之后需要重新取得它，可以从 identity 推导：

```bash
# -y 从 identity 输出对应的 recipient
age-keygen -y ~/.config/sops/age/keys.txt
```

同一份 identity 始终会推导出同一个 recipient。这里采用 `~/.config/sops/age/keys.txt`，是因为它同时也是 SOPS 在 Linux 上查找 age identity 的默认位置。

### 加密与解密文件

使用 recipient 加密文件：

```bash
# -r 指定 recipient，-o 指定加密文件的输出路径
age -r age1example... -o document.txt.age document.txt
```

使用 identity 解密：

```bash
# --decrypt 进入解密模式，-i 指定 identity，-o 指定明文输出路径
age --decrypt \
  -i ~/.config/sops/age/keys.txt \
  -o document.txt \
  document.txt.age
```

对同一个文件重复使用 `-r`，可以添加多个 recipients：

```bash
# 每个 -r 添加一个 recipient；-o 指定加密文件的输出路径
age \
  -r age1alice... \
  -r age1bob... \
  -o document.txt.age \
  document.txt
```

对应的任意一个 identity 都可以独立解密该文件。

### 使用口令加密

不需要公私钥时，也可以使用口令：

```bash
# --passphrase 使用口令而非 recipient 加密，-o 指定输出路径
age --passphrase -o document.txt.age document.txt
# --decrypt 进入解密模式，-o 指定明文输出路径
age --decrypt -o document.txt document.txt.age
```

加密和解密时，age 会通过终端交互读取口令。口令不会作为命令行参数出现。

### 直接使用 SSH 密钥

age 原生支持 RSA 和 Ed25519 SSH 公钥。可以直接使用 SSH 公钥文件加密，再使用对应私钥解密：

```bash
# -R 从文件读取 recipients，-o 指定加密文件的输出路径
age -R ~/.ssh/id_ed25519.pub -o document.txt.age document.txt
# --decrypt 进入解密模式，-i 指定 SSH 私钥，-o 指定明文输出路径
age --decrypt -i ~/.ssh/id_ed25519 -o document.txt document.txt.age
```

GitHub 会公开用户添加到账号中的 SSH 公钥。可以下载公钥列表并作为 recipients 文件使用；其中只有 age 支持的 RSA 或 Ed25519 公钥能够作为 SSH recipient：

```bash
# -f 在 HTTP 错误时失败，-s 静默输出，-S 仍显示错误，-L 跟随重定向，-o 指定输出文件
curl -fsSL https://github.com/<username>.keys -o recipients.txt
# -R 从文件读取 recipients，-o 指定加密文件的输出路径
age -R recipients.txt -o document.txt.age document.txt
```

下载后应确认列表中至少包含一把受支持的密钥，并检查具体密钥与指纹，而不是未经确认就把远程返回结果直接用于长期加密。GitHub 账号中的 SSH 密钥也可能在以后被替换或删除。

age 把 SSH recipient 定义为已有 SSH 密钥的便利兼容方式；能够单独管理文件加密密钥时，仍应优先使用原生 age identity。SSH recipient 支持的密钥类型和限制参见 age 手册的 [SSH keys](https://github.com/FiloSottile/age/blob/main/doc/age.1.ronn#ssh-keys) 章节。

### `ssh-to-age`

`ssh-to-age` 可以从 Ed25519 SSH 密钥确定性地派生原生 age 密钥。它适用于下游工具只接受 `age1...` recipient、但现有输入是 Ed25519 SSH 密钥的场景。

从 SSH 公钥导出 age recipient：

```bash
# -i 指定要转换的 SSH 公钥文件
ssh-to-age -i ~/.ssh/id_ed25519.pub
```

从 SSH 私钥导出 age identity：

```bash
# -private-key 表示输入为 SSH 私钥，-i 指定输入文件，-o 指定 age identity 输出文件
ssh-to-age \
  -private-key \
  -i ~/.ssh/id_ed25519 \
  -o derived-age-identity.txt
```

如果 SSH 私钥受口令保护，`ssh-to-age` 需要通过 `-stdinpass` 从标准输入读取口令，或通过 `SSH_TO_AGE_PASSPHRASE` 环境变量提供口令。截至本文写作时，其使用的 Go SSH 库只能解密采用 `aes256-ctr` 或 `aes256-cbc` 加密的 OpenSSH 私钥；其他密码算法可能导致解析失败，具体限制参见官方文档。

比较由 SSH 公钥和 age identity 分别导出的 recipient：

```bash
# 两个 -i 分别指定待转换的 SSH 公钥和待读取的 age identity
ssh-to-age -i ~/.ssh/id_ed25519.pub
age-keygen -y derived-age-identity.txt
```

两个命令输出的 `age1...` recipient 应当相同。

如果需要进一步验证现有 age identity 是否与指定 SSH 私钥的转换结果完全相同，可以重新转换 SSH 私钥并直接比较两份 identity：

```bash
# -private-key 转换 SSH 私钥，-i 指定输入文件；cmp 的 -s 只返回比较结果，不输出 identity 内容
cmp -s \
  <(ssh-to-age -private-key -i ~/.ssh/id_ed25519) \
  derived-age-identity.txt
echo $?
```

退出状态为 `0` 表示内容相同，`1` 表示不同，大于 `1` 表示比较过程出错。

`ssh-to-age` 只转换 Ed25519，不支持 RSA。派生出的 age identity 具备独立的解密能力；如果把它以未加密形式保存在磁盘上，读取该文件不再需要原 SSH 私钥的口令。相关原理与风险参见 `ssh-to-age` [Security considerations](https://github.com/Mic92/ssh-to-age#security-considerations)。

## SOPS

SOPS 是一个加密文件编辑器，支持 YAML、JSON、dotenv、INI 和二进制文件，并能使用 age、PGP、云 KMS 等机制保护文件密钥。

对于 YAML、JSON、dotenv 和 INI，SOPS 默认保留字段名与结构，只加密叶子值。这样可以在 Git 中看到配置结构的变化，同时避免直接暴露具体值。字段名本身不会被隐藏，不应在字段名中写入敏感信息。

### 配置 recipients

在仓库根目录创建 `.sops.yaml`：

```yaml
creation_rules:
  - path_regex: ^secrets/.*\.ya?ml$
    age:
      - age1example...
```

SOPS 会从当前工作目录向上查找 `.sops.yaml`，并使用第一条匹配目标文件路径的 `creation_rules`。文件名必须是 `.sops.yaml`；`.sops.yml` 不会被自动发现。

多个 recipients 可以写成列表：

```yaml
creation_rules:
  - path_regex: ^secrets/.*\.ya?ml$
    age:
      - age1alice...
      - age1bob...
```

默认情况下，任意一个对应 identity 都可以解密。

SOPS 也接受 `ssh-ed25519` 和 `ssh-rsa` 公钥作为 age recipients：

```yaml
creation_rules:
  - path_regex: ^secrets/.*\.ya?ml$
    age:
      - ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA...
```

### 创建和编辑文件

通过 SOPS 直接创建文件：

```bash
# 直接传入文件路径；SOPS 会创建文件，并在保存时写入密文
sops secrets/application.sops.yaml
```

SOPS 会打开编辑器；保存退出后，写入磁盘的是加密文件。

编辑已有密文仍然使用同一命令：

```bash
# 直接传入已有密文路径；SOPS 会提供明文编辑视图，并在保存时重新加密
sops secrets/application.sops.yaml
```

SOPS 会在编辑期间提供明文视图，并在保存时重新加密。

如果已经存在明文文件，可以原地加密：

```bash
# encrypt 执行加密，--in-place 原地覆盖输入文件
sops encrypt --in-place secrets/application.yaml
```

执行前应确认该明文没有被提交到 Git 历史中。

### 解密文件

把明文输出到终端：

```bash
# decrypt 解密文件，并把明文写到标准输出
sops decrypt secrets/application.sops.yaml
```

输出到文件：

```bash
# > 将命令的标准输出重定向到指定文件
sops decrypt secrets/application.sops.yaml > application.yaml
```

第二种方式会在磁盘上生成明文文件。应限制该文件的访问权限，确保它不被提交到版本控制，并根据实际环境判断它是否会进入备份或同步系统；使用完成后，还应按照存储介质和威胁模型处理该明文文件。

### 指定 age identity

SOPS 默认会在用户配置目录中查找 `sops/age/keys.txt`。也可以通过 `SOPS_AGE_KEY_FILE` 显式指定 identity 文件：

```bash
# SOPS_AGE_KEY_FILE 为本次命令指定原生 age identity 文件
SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt" \
  sops decrypt secrets/application.sops.yaml
```

这里指定的文件必须包含 age identity，而不是 `age1...` recipient。

使用 SSH recipient 时，可以显式指定 SSH 私钥：

```bash
# SOPS_AGE_SSH_PRIVATE_KEY_FILE 为本次命令指定用于 age 解密的 SSH 私钥
SOPS_AGE_SSH_PRIVATE_KEY_FILE="$HOME/.ssh/id_ed25519" \
  sops decrypt secrets/application.sops.yaml
```

`SOPS_AGE_KEY_FILE` 和 `SOPS_AGE_SSH_PRIVATE_KEY_FILE` 分别对应原生 age identity 与 SSH 私钥，不应混用。

### 更新 recipients

SOPS 并不直接使用 age recipient 加密每一个配置值。它会在内部为每个文件生成一把随机的对称密钥，用这把密钥加密文件内容；这把由 SOPS 自动管理的内部密钥称为**数据密钥**。随后，SOPS 分别使用各个 recipient 加密数据密钥，并把加密后的副本保存在文件的 `sops` 元数据中。解密时，identity 先解开数据密钥，再由数据密钥解开文件内容。

数据密钥不是 age identity 或 recipient，也不是文件中的密码、令牌等机密内容；用户不需要单独生成或保存它。

修改 `.sops.yaml` 不会自动修改已经存在的密文。增加或删除 recipient 后，使用 `updatekeys` 同步文件中的 recipient 信息：

```bash
# updatekeys 按当前配置更新文件的 recipient 密钥元数据
sops updatekeys secrets/application.sops.yaml
```

`updatekeys` 不改变文件内容和数据密钥，只按照当前配置重新确定哪些 recipients 能够解开这把数据密钥。单纯增加新的 recipient 时，通常执行这一步即可。

如果移除的是已经泄露或不再可信的 recipient，还应让当前文件改用一把新生成的数据密钥：

```bash
# rotate 生成新的数据密钥，--in-place 原地更新文件
sops rotate --in-place secrets/application.sops.yaml
```

`rotate` 会让 SOPS 生成新的数据密钥，并用它重新加密当前文件中的所有值。它不会更换 age identity，也不会修改密码、令牌等明文内容；同样无法收回他人此前已经取得的旧密文、数据密钥或明文副本。如果不可信的 identity 曾经能够读取文件，仍需根据实际情况更换其中的密码、令牌等机密，并检查 Git 历史、备份和其他可能保留旧副本的位置。详细流程参见 SOPS 官方的 [Key management](https://getsops.io/docs/usage/key-management/)。

### 常见问题

- **找不到创建规则**：确认配置名是 `.sops.yaml`，并从该文件所在目录或其子目录执行命令。
- **使用了错误解析格式**：SOPS 通常根据文件扩展名判断 YAML、JSON、dotenv 或二进制格式，改名后可能需要显式指定输入与输出类型。
- **新 recipient 无法解密旧文件**：修改 `.sops.yaml` 后还需要对旧文件执行 `sops updatekeys`。
- **指定了公钥却无法解密**：recipient 只能加密，解密需要对应的 age identity 或 SSH 私钥。
- **误以为结构也被隐藏**：SOPS 的结构化格式默认保留字段名与层级；需要隐藏整个文件时，应按二进制文件处理，或者直接使用 age。

## 三个工具如何配合

最常见的组合关系是：

- SSH 密钥用于登录服务器和访问 Git 服务；
- age 用于加密普通文件，也可以直接复用现有 RSA 或 Ed25519 SSH 公钥；
- SOPS 使用 age recipient 管理需要保留结构和 Git diff 的机密配置；
- `ssh-to-age` 只在需要把 Ed25519 SSH 密钥转换为原生 age 格式时使用。

## 参考资料

1. [OpenSSH manual pages](https://www.openssh.com/manual.html)
2. [age documentation](https://github.com/FiloSottile/age/tree/main/doc)
3. [SOPS documentation](https://getsops.io/docs/)
4. [`ssh-to-age` documentation](https://github.com/Mic92/ssh-to-age)
