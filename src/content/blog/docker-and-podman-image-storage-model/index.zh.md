---
title: Docker 与 Podman 的镜像存储为什么彼此看不见
description: 按 Docker Rootful、Docker Rootless、Podman Rootless、Podman Rootful 和 Podman API service 五种模式，逐一确定镜像与容器数据归谁所有、落在哪里，以及 endpoint 和 sudo 各自改变了什么。
---

Docker Engine 采用[客户端—服务端架构](https://docs.docker.com/get-started/docker-overview/#docker-architecture)：`docker` 是 CLI 客户端，`dockerd` 是持续运行的守护进程，两者通过 REST API 通信。执行 `docker pull` 时，CLI 把请求交给 `dockerd`，由它下载并保存镜像；执行 `docker images` 时，CLI 显示的也是 `dockerd` 返回的列表。因此，同一个 Docker CLI 连接不同的 `dockerd`，看到的内容就会不同。

Podman 的默认形态没有守护进程。直接执行 `podman` 时，打开容器存储的是这个命令进程本身，存储位置由它的有效 UID 决定。因此 rootful 与 rootless 这组词在两者中指向不同的对象：对 Docker 指 daemon 的运行身份，对 Podman 指执行命令那个进程的运行身份。

两条规则并非彼此隔绝。Podman 也可以作为服务常驻，监听一个兼容 Docker API 的 socket，`docker context ls` 中因此可能出现指向 Podman 的端点。此时决定存储的既不是执行命令的用户，也不是任何一个 `dockerd`，而是运行该 Podman 服务的用户。

## Docker Rootful

rootful 说的是 `dockerd` 以 root 身份运行，和执行 `docker` 的用户没有关系。在通常的 Linux 安装中，它由系统服务启动，监听 `unix:///var/run/docker.sock`。镜像、容器和卷等持久状态全部由它管理、写入它配置的数据目录，CLI 自己不打开任何镜像目录。因此一条命令的可见范围先由端点决定，再由该 daemon 的配置决定：

```text
docker CLI
    └── -H / -c / DOCKER_HOST / DOCKER_CONTEXT / 当前 context
            └── Docker API endpoint
                    └── dockerd
                            └── 该 daemon 的数据目录
```

### 端点的解析顺序

链条的第一环由客户端解析，顺序固定：

1. `-H`/`--host` 直接给出端点，`-c`/`--context` 指定一个已保存的 context。两者互斥，同时给会报 `conflicting options: cannot specify both --host and --context`。
2. 命令行都没给时看环境变量，`DOCKER_HOST` 优先于 `DOCKER_CONTEXT`。
3. 环境变量也没有时，用 `docker context use` 选中的 context。

第 3 步读的是 `$HOME/.docker`：context 本身和其余客户端配置都存在那里，可以用 `--config` 或 `DOCKER_CONFIG` 指到别处。这一条是后续全部分歧的根源：**端点的默认来源随执行 CLI 的用户而变**。

本文演示用的机器上保存了三个 context：

```bash
docker context ls --format 'table {{.Name}}\t{{.DockerEndpoint}}'
```

```text
NAME              DOCKER ENDPOINT
default           unix:///var/run/docker.sock
docker-rootless   unix:///run/user/1000/docker.sock
podman            unix:///run/user/1000/podman/podman.sock
```

context 名称由安装方式决定，其他机器上并不相同；有效信息是右侧一列，三个端点各自对应一套独立的数据。

`default` 是其中的特例。它并非保存下来的 context，而代表“由 `DOCKER_HOST` 决定的配置”；`DOCKER_HOST` 未设置时才回落到内置的 `unix:///var/run/docker.sock`。因此 `-c default` 无法覆盖环境变量，已保存的 context 名称则可以：

```bash
# 基准：default 指向 rootful daemon
docker -c default info --format '{{.DockerRootDir}}'

# 增加 DOCKER_HOST 后，-c default 未能覆盖它
DOCKER_HOST=unix:///run/user/1000/docker.sock docker -c default info --format '{{.DockerRootDir}}'

# 改用已保存的 context 名称，DOCKER_HOST 被覆盖
DOCKER_HOST=unix:///var/run/docker.sock docker -c docker-rootless info --format '{{.DockerRootDir}}'
```

```text
/var/lib/docker
/home/<user>/.local/share/docker
/home/<user>/.local/share/docker
```

### `sudo` 改变的是客户端，不是 daemon

普通用户的 `docker images` 与 root 执行的同一命令，只要连接同一个 `/var/run/docker.sock`，查询的就是同一个 daemon、同一份镜像数据。存储位于服务端，客户端更换身份不会改变它。

但两条命令未必解析到同一个端点，因为 `sudo` 正好影响解析顺序中的第 2、3 步。[它默认启用 `env_reset`](https://www.sudo.ws/docs/man/sudoers.man/)，命令得到的是一个最小环境：调用者的 `DOCKER_HOST` 和 `DOCKER_CONTEXT` 不会传过去（除非在 sudoers 的 `env_keep` 里放行），`HOME` 则按目标用户重新初始化。因此 `sudo docker` 读取的是 `/root/.docker`，普通用户通过 `docker context use` 选定的 context 在其中并不存在，只能回落到 root 一侧的当前 context。

实际的分歧出现在 rootless Docker 的两种常见配置方式上：

- 安装脚本创建一个 rootless context 并通过 `docker context use` 切换过去。该选择记录在普通用户的 `~/.docker` 中，root 一侧没有对应记录，`sudo docker` 回落到 `default`，即 `/var/run/docker.sock` 后面的 rootful daemon。
- 按安装提示在 shell 配置中 `export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/docker.sock`。`env_reset` 会清除该变量，`sudo docker` 同样回到 rootful daemon。

两种配置下，`docker images` 查询的是用户自己的 rootless 存储，`sudo docker images` 查询的是 rootful daemon 的存储。“刚拉取的镜像加上 `sudo` 后消失”即源于此：镜像并未丢失，这两条命令始终没有查询同一个 daemon。

无需真正使用 `sudo` 即可复现。下面第二条命令用 `env -i` 清空环境，并将 `HOME` 指向一个不含 `.docker` 的目录，与 `sudo` 交给 root 的环境等效：

```bash
DOCKER_HOST=unix:///run/user/1000/docker.sock docker info --format '{{.DockerRootDir}}'
env -i PATH="$PATH" HOME=/tmp docker info --format '{{.DockerRootDir}}'
```

```text
/home/<user>/.local/share/docker
/var/lib/docker
```

同一用户、同一台机器，仅因环境不同，两条命令就落在两个 daemon、两套存储上。差异全部来自端点解析，而非 `sudo` 为 daemon 产生了第二套存储。固定端点后差异随即消失：

```bash
docker -H unix:///var/run/docker.sock image ls
sudo docker -H unix:///var/run/docker.sock image ls
```

两条命令查询的是同一个 rootful `dockerd`，返回同一份镜像。排除客户端配置干扰最可靠的做法就是显式指定 `-H`。

### 数据目录与存储后端

端点确定之后，数据的位置由该 daemon 决定，且分为两部分。

容器配置、日志、卷等状态写在 daemon 的数据根目录，也就是 `docker info` 里的 `Docker Root Dir`，Linux 上默认 `/var/lib/docker`。要改它，在 [`/etc/docker/daemon.json`](https://docs.docker.com/engine/daemon/#configuration-file) 里写上 `"data-root": "/mnt/docker-data"` 再重启 daemon；等价的写法是在 `dockerd` 的启动命令行上加 `--data-root /mnt/docker-data`，由 init 系统拉起它时传入。`dockerd` 是守护进程本身而非查询工具，在终端中直接执行它等同于尝试再启动一个 daemon；查看选项应使用 `dockerd --help`。

镜像本身则不一定在那里。[Docker Engine 29.0 及以后版本的全新安装默认使用 containerd image store](https://docs.docker.com/engine/storage/containerd/)，镜像数据交给 containerd 的两个子系统：content store 保存从 registry 取回的原始字节，包括 image index、manifest、config 和压缩的 layer blob，按内容摘要寻址；snapshotter 保存解包后的镜像层，并为每个容器叠一个可写快照作为根文件系统。containerd 的 [Content Flow](https://github.com/containerd/containerd/blob/main/docs/content-flow.md) 描述了完整过程。（从旧版本升级的安装保持原有的 [storage driver](https://docs.docker.com/engine/storage/drivers/)，镜像层和容器可写层仍在 `Docker Root Dir` 之下，例如 `overlay2` 用的是 `/var/lib/docker/overlay2`。）

content store 与 snapshotter 由 containerd 管理，不受 Docker 的 `data-root` 控制，其位置取决于 `dockerd` 连接的是哪个 containerd。`dockerd` 启动时先检查 containerd 默认地址上有没有 socket：[有就直接使用那个独立运行的 containerd，没有才启动自己的 managed containerd](https://github.com/moby/moby/blob/master/daemon/command/daemon.go#L1159-L1205)。前者的数据位置由该 containerd 配置里的 `root` 决定，常见默认值是 `/var/lib/containerd`；后者由 Moby 决定，默认放在 `Docker Root Dir` 下的 `containerd/daemon`。

[Docker 文档给出的位置是 `/var/lib/containerd`](https://docs.docker.com/engine/daemon/#daemon-data-directory)，并说明 `data-root` 不影响它，要改得去写 `/etc/containerd/config.toml`。该描述适用于随包安装了独立 containerd 服务的系统；`dockerd` 启动自带的 managed containerd 时并不成立，目录随 `Docker Root Dir` 变化。与其记忆路径，不如按上一节的做法固定端点，直接查询该 daemon：

```bash
docker -H unix:///var/run/docker.sock info \
  --format 'Docker Root Dir: {{.DockerRootDir}}{{println}}Storage Driver:  {{.Driver}}{{println}}driver-type:     {{range .DriverStatus}}{{index . 1}}{{end}}'
```

```text
Docker Root Dir: /var/lib/docker
Storage Driver:  overlayfs
driver-type:     io.containerd.snapshotter.v1
```

`Storage Driver` 一行需要留意：`overlayfs` 是 containerd snapshotter 的名称，storage driver 写作 `overlay2`，二者仅相差两个字符。判据是 `driver-type`，`io.containerd.snapshotter.v1` 表示这个 daemon 走的是 containerd image store。

## Docker Rootless

Rootless Docker 把 `dockerd` 和容器一起放进[一个用户命名空间](https://docs.docker.com/engine/security/rootless/#how-it-works)：daemon 进程在宿主机上属于普通用户，只有在命名空间内部才是 root。它并非让普通用户读取 rootful daemon 的数据目录，而是另行运行一套完整的 daemon，拥有独立的 socket 和数据目录：

```text
socket:   $XDG_RUNTIME_DIR/docker.sock
data:     ~/.local/share/docker
```

前提是该用户在 `/etc/subuid` 和 `/etc/subgid` 中各拥有一段不少于 65536 个的从属 ID，命名空间内的 root 才有可映射的 UID 区间。

### 另一个端点，另一套数据

官方的 [`dockerd-rootless-setuptool.sh install`](https://docs.docker.com/engine/security/rootless/#install) 会创建一个名为 `rootless` 的 CLI context 并切换过去，并提示可改用 `export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/docker.sock`；发行版打包的安装可能使用其他 context 名称，本文机器上为 `docker-rootless`。两种方式下，端点的解析规则与上一章完全一致。

同一个 CLI 因此可以在两个 daemon 之间切换：

```bash
docker -c default images
docker -c docker-rootless images
```

两次结果不同并非 context 自身保存了镜像，而是两个 context 指向不同的 daemon。context 是连接配置，daemon 才是状态边界。

### `name=rootless` 是判据

```bash
docker -c docker-rootless info \
  --format 'Docker Root Dir: {{.DockerRootDir}}{{println}}Storage Driver:  {{.Driver}}{{println}}SecurityOptions: {{json .SecurityOptions}}'
```

```text
Docker Root Dir: /home/<user>/.local/share/docker
Storage Driver:  overlay2
SecurityOptions: ["name=seccomp,profile=builtin","name=rootless","name=cgroupns"]
```

前两行都与上一章不同。数据根目录在 `~/.local/share` 之下，而非 `/var/lib/docker`；存储后端是 `overlay2`，而同一台机器上的 rootful daemon 用的是 containerd image store。两个 daemon 的后端可以完全不同，因此后端只能逐个 daemon 查询，不能按 Engine 版本推定。

判断 rootless 的依据是 `SecurityOptions` 中的 `name=rootless`。命令是否带 `sudo` 不构成证据，socket 位于 `$XDG_RUNTIME_DIR` 下也只是惯例，唯一可靠的是 daemon 自身报告的这一项。

## 权限不是存储模型

前两章都假定普通用户能够连上 rootful daemon 的 socket。这件事本身由文件权限决定：

```bash
stat -c '%U:%G %A %n' /var/run/docker.sock
```

```text
root:docker srw-rw---- /var/run/docker.sock
```

socket 属 `root:docker` 且组可读写，因此 `docker` 组成员无需 `sudo` 即可请求它。rootless daemon 的 socket 位于 `$XDG_RUNTIME_DIR` 下、直接属于用户本人，同理不需要额外授权。

但这只决定谁能建立连接，不决定连接之后看到谁的数据——后者始终由端点后面的服务决定。Docker 官方文档对前一半有明确警告：[`docker` 组授予的是 root 级能力](https://docs.docker.com/engine/install/linux-postinstall/#manage-docker-as-a-non-root-user)。能够控制 rootful daemon 即等同于在主机上取得 root。该组解决的是控制权，而非为每个组成员划分独立的镜像空间。

这也解释了一个常见误解。加入 `docker` 组之后日常操作不再需要 `sudo`，但命令连的仍然是那个以 root 运行的 daemon——“不用 `sudo`”恰恰是 `docker` 组的效果，不是 rootless 的证据。要确认某个 daemon 是否 rootless，看它自己报告的 `SecurityOptions`：

```bash
docker -c default info --format '{{json .SecurityOptions}}'
docker -c docker-rootless info --format '{{json .SecurityOptions}}'
```

```text
["name=seccomp,profile=builtin","name=cgroupns"]
["name=seccomp,profile=builtin","name=rootless","name=cgroupns"]
```

只有 rootless daemon 会报告 `name=rootless`。socket 路径和 context 名称都不是判据：前者只是安装惯例，后者在安装时任意指定。

## Podman Rootless

Podman 默认不运行常驻 daemon。执行 `podman images` 时，打开存储的就是这个 `podman` 进程本身，没有服务端代它做任何选择。因此 rootless 与 rootful 在 Podman 这里不是两套分别安装的东西，而是同一个二进制每次调用时的属性，取决于该进程的有效 UID。

### 用户命名空间与 subuid

一个非 root 的进程要自己管理容器存储，会遇到两处限制。它无法写入 root 所有的系统目录；而镜像层里的文件分属各种 UID 和 GID，解包时需要按原样创建出来，普通进程却只持有自己一个 UID。

前一处限制靠换目录解决，后一处必须靠用户命名空间。[`podman unshare`](https://docs.podman.io/en/latest/markdown/podman-unshare.1.html) 的说明给出了它的构造方式：调用者的 UID 和主 GID 在新命名空间中表现为 0 和 0，`/etc/subuid`、`/etc/subgid` 中匹配该用户的区间借助 `newuidmap(1)`、`newgidmap(1)` 一并映射进来。这两个文件里的区间由管理员分配，是 rootless Podman 的前提条件（见 [rootless tutorial](https://github.com/containers/podman/blob/main/docs/tutorials/rootless_tutorial.md)）。

映射关系可以直接读出：

```bash
grep "^$(id -un):" /etc/subuid
podman unshare cat /proc/self/uid_map
```

```text
<user>:100000:65536
         0       1000          1
         1     100000      65536
```

`uid_map` 的三列依次是命名空间内起始 ID、宿主机上起始 ID、区间长度。第一行把命名空间内的 root 映射到宿主机的 UID 1000，第二行把内部的 1–65536 映射到宿主机自 100000 起的那一段，正是 `/etc/subuid` 分给该用户的区间。

因此容器内的 root 在宿主机上仍是这个普通用户，容器写出的文件归该用户或归那段从属 ID 所有。存储必须位于该用户有写权限的目录中。

### graph root 与 run root

containers/storage 使用两个根目录。graph root 保存持久数据——镜像、层、容器和卷都在它下面；run root 保存运行期状态，重启后不需要保留。命令行上对应 `podman --root` 与 `--runroot`，配置文件中对应 `graphroot` 与 `runroot`。

本机上的实际取值：

```bash
podman info --format 'configFile:  {{.Store.ConfigFile}}{{println}}graphRoot:   {{.Store.GraphRoot}}{{println}}runRoot:     {{.Store.RunRoot}}{{println}}graphDriver: {{.Store.GraphDriverName}}{{println}}rootless:    {{.Host.Security.Rootless}}'
```

```text
configFile:  /home/<user>/.config/containers/storage.conf
graphRoot:   /home/<user>/.local/share/containers/storage
runRoot:     /run/user/1000/containers
graphDriver: overlay
rootless:    true
```

这些值解析自 [`containers-storage.conf`](https://github.com/containers/storage/blob/main/docs/containers-storage.conf.5.md)。该文件有三处，后者覆盖前者：发行版提供的 `/usr/share/containers/storage.conf`、管理员的 `/etc/containers/storage.conf`，以及 rootless 用户自己的 `$XDG_CONFIG_HOME/containers/storage.conf`（未设置时为 `~/.config/containers/storage.conf`）。文档写明，拥有自己那一份的用户不再使用系统文件中的任何选项——上面 `configFile` 一行正是这种情况。

配置文件未设置相应项时才使用内置默认值。rootless 用户的 graph root 可由配置项 `rootless_storage_path` 指定；未指定时默认为 `$XDG_DATA_HOME/containers/storage`，`XDG_DATA_HOME` 也未设置时为 `$HOME/.local/share/containers/storage`。

生效的配置文件和默认路径因此都位于执行命令那个用户的 `$HOME` 之下。换一个 UID 执行 `podman`，配置与路径同时改变；没有常驻进程居中调停，两次执行访问的就是两套独立的 store。

### graph root 的目录布局

```bash
ls -x ~/.local/share/containers/storage
```

```text
db.sql   defaultNetworkBackend  libpod          networks
overlay  overlay-containers     overlay-images  overlay-layers
secrets  storage.lock           userns.lock     volumes
```

`overlay-images`、`overlay-layers`、`overlay-containers` 分别记录镜像、层与容器，`overlay` 是驱动挂载使用的目录，`libpod` 与 `db.sql` 属于 Podman 自身的状态。与 Docker 一样，镜像数据和引擎自身状态是两部分内容，区别在于此处二者同处一个 graph root 之下，而不像 Docker 那样分属 containerd 和 `dockerd` 两个进程。

## Podman Rootful

有效 UID 为 0 时，同一个二进制走的是另一条分支。它读的是系统的 `/etc/containers/storage.conf`（或发行版提供的那份），graph root 落到 [UID 0 的默认值](https://docs.podman.io/en/latest/markdown/podman.1.html) `/var/lib/containers/storage`；上一章那套用户命名空间也不再需要，因为进程本身就持有全部 UID，能够按原样创建镜像层里的文件。

`sudo podman` 正是这条分支：`sudo` 把有效 UID 换成 0，配置来源和存储位置随之整体切换。`sudo` 本身没有任何特殊之处，以 root 登录后直接执行 `podman` 结果相同，起作用的只是有效 UID。

```bash
podman images
sudo podman images
```

这两条命令通常访问两套完全不同的数据。Podman 文档对此有明确表述：非 root 用户创建的容器对其他用户不可见，以 root 身份运行的 Podman 也不会看到或管理它们。

确认 root 一侧的实际位置同样应查询 `podman info`，而不是套用默认路径：

```bash
sudo podman info --format 'configFile: {{.Store.ConfigFile}}{{println}}graphRoot:  {{.Store.GraphRoot}}'
```

Docker 与 Podman 最容易被混为一谈的正是这一点。对 Docker，`sudo` 改变的是客户端进程的身份，而存储归 daemon 所有，端点不变就不会多出一套存储；对直接执行的 Podman，`sudo` 改变的是打开存储那个进程自身的身份，配置文件和 graph root 都跟着换，等于换掉了整个 store。同一个前缀，在两者中作用于完全不同的对象。

## Podman API service

前四章中，Docker 依据端点、Podman 依据 UID，是两条独立的规则。[`podman system service`](https://docs.podman.io/en/latest/markdown/podman-system-service.1.html) 将两者连接起来：Podman 可以作为服务常驻，监听一个兼容 Docker API 的 socket，rootless 时默认位于 `$XDG_RUNTIME_DIR/podman/podman.sock`。协议本身就是 Docker API，Docker CLI 可以直接连接——`docker context ls` 中指向 Podman socket 的端点即来源于此。

这条路径不创建任何新的存储，只是为现有的 rootless Podman store 增加了一个入口：

```bash
docker -c podman info \
  --format 'Docker Root Dir: {{.DockerRootDir}}{{println}}Storage Driver:  {{.Driver}}{{println}}Server Version:  {{.ServerVersion}}'
```

```text
Docker Root Dir: /home/<user>/.local/share/containers/storage
Storage Driver:  overlay
Server Version:  5.8.6
```

Docker CLI 将 Podman 的 graph root 填入了 `Docker Root Dir` 一栏，`Server Version` 报告的是 Podman 的 5.8.6，而非本机 Docker 的 29.x。镜像列表同样是同一份：

```bash
docker -c podman image ls
podman images
```

```text
IMAGE                                     ID             DISK USAGE   CONTENT SIZE   EXTRA
docker.io/library/ubuntu:latest           30ba44506a6d        112MB             0B   U
docker.io/osrf/ros:lyrical-desktop-full   9c2a537078f4       6.64GB             0B   U
docker.io/example/app:latest              08e1fe51ce2e       5.17GB             0B   U

REPOSITORY                   TAG                   IMAGE ID      CREATED       SIZE
docker.io/osrf/ros           lyrical-desktop-full  9c2a537078f4  2 weeks ago   6.64 GB
docker.io/library/ubuntu     latest                30ba44506a6d  4 months ago  112 MB
docker.io/example/app        latest                08e1fe51ce2e  5 months ago  5.17 GB
```

镜像 ID 逐个对应，两张表格的差异仅在客户端排版，数据是同一份。

由此得到一条补充规则：Podman 以服务形式被访问时，决定 store 的不再是执行命令的用户，而是**运行该 service 的用户**。rootless 用户启动的 service 指向该用户的 store，root 启动的 service 指向 `/var/lib/containers/storage`。同理，Podman 的 `--remote` 或 `CONTAINER_HOST` 会将命令转发给远端 Podman 服务，此时本地 UID 也不再起决定作用。

## 参考资料

- [Docker 架构](https://docs.docker.com/get-started/docker-overview/#docker-architecture)
- [Docker daemon 配置文件与数据目录](https://docs.docker.com/engine/daemon/#daemon-data-directory)
- [Docker contexts](https://docs.docker.com/engine/manage-resources/contexts/)
- [containerd image store](https://docs.docker.com/engine/storage/containerd/)
- [Docker storage drivers](https://docs.docker.com/engine/storage/drivers/)
- [Docker Rootless mode 的工作方式与安装](https://docs.docker.com/engine/security/rootless/)
- [docker 组的安全提示](https://docs.docker.com/engine/install/linux-postinstall/#manage-docker-as-a-non-root-user)
- [sudoers(5)：`env_reset` 与 `env_keep`](https://www.sudo.ws/docs/man/sudoers.man/)
- [Podman 存储目录与 rootless 默认值](https://docs.podman.io/en/latest/markdown/podman.1.html)
- [Podman rootless tutorial](https://github.com/containers/podman/blob/main/docs/tutorials/rootless_tutorial.md)
- [podman unshare：用户命名空间的构造](https://docs.podman.io/en/latest/markdown/podman-unshare.1.html)
- [podman system service](https://docs.podman.io/en/latest/markdown/podman-system-service.1.html)
- [containers-storage.conf](https://github.com/containers/storage/blob/main/docs/containers-storage.conf.5.md)
