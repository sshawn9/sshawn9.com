---
title: Obsidian 为何变成 Electron 图标：一次 Wayland 窗口身份排障
description: 从 GNOME 的重复 Dock 图标出发，完整记录 Obsidian 在原生 Wayland 下的身份排查、失败尝试、Electron desktopName 根因、NixOS 复现环境与后续上游修复。
---

在 GNOME 中，可以从应用列表找到 Obsidian，右键选择“添加到收藏夹”，将它固定到 Dock。这个固定项来自系统安装的 `obsidian.desktop`，显示 Obsidian 自带的紫色图标。正常启动后，GNOME 应在这个固定项旁显示运行标记，并把所有 Obsidian 窗口归到同一个图标下。

实际情况却不同：点击这个固定项启动 Obsidian 后，紫色图标仍像未运行一样，Dock 末尾又出现一个带运行标记的 Electron 默认图标。窗口功能正常，但 GNOME 把启动器和运行窗口识别成了两个应用。

问题最后落在一个很小的字符串上：安装到系统中的 desktop file ID 是 `obsidian.desktop`，而窗口在 Wayland 协议中报告的 `app_id` 却是 `electron`。

## 从 Dock 里的第二个图标开始

最初出现问题的环境是：

| 项目     | 版本或状态                           |
| -------- | ------------------------------------ |
| 系统     | NixOS unstable                       |
| 桌面     | GNOME Shell 49.2，原生 Wayland 会话  |
| Obsidian | 1.12.4                               |
| Electron | 41.0.2                               |
| Ozone    | 通过 `NIXOS_OZONE_WL=1` 使用 Wayland |

Ozone 是 Chromium/Electron 的窗口系统抽象层；这里设置 `NIXOS_OZONE_WL=1`，目的是让 Electron 直接创建 Wayland 窗口，而不是退回 XWayland。

GNOME 能找到并固定 `obsidian.desktop`，所以静态图标并没有安装错误；问题只在窗口启动后出现。这首先把范围缩小到“运行时窗口如何声明自己”。

### 进程名不是窗口身份

在 X11 下，桌面环境通常用 `WM_CLASS` 把窗口和 `.desktop` 文件对应起来，desktop entry 中也有 `StartupWMClass` 这个字段。原生 Wayland 没有 `WM_CLASS`；应用会通过 `xdg_toplevel.set_app_id` 提交 `app_id`，合成器再用它寻找相应的 desktop file ID。

可以把两条路径粗略地写成：

```text
X11:     WM_CLASS  ↔ StartupWMClass
Wayland: app_id    ↔ desktop file ID（通常是文件名去掉 .desktop）
```

因此，进程叫 `obsidian`、命令行从 `obsidian.desktop` 启动，甚至 X11 的 class 已经正确，都不能证明原生 Wayland 窗口具有正确身份。真正要读的是窗口提交给合成器的 `app_id`。

## GNOME 49 下的观测限制

systemd 会为图形应用创建 scope，Linux 则在 `/proc/<PID>/cgroup` 中记录进程所属的控制组。先用 `pgrep` 找到 Obsidian 进程，再将实际 PID 代入检查命令：

```bash
pgrep -af 'obsidian|app.asar'

pid=123456  # 替换为上一条命令输出的 Obsidian PID
cat "/proc/$pid/cgroup"
```

输出中的 scope 名称类似 `app-electron-XXXX.scope`。它暗示启动链中的某一层使用了 `electron`，但 cgroup 名不是 Wayland `app_id`，不能直接作为窗口身份的证据。

VS Code 提供了反例。它使用自带的 Electron，图标和窗口分组都正常，但用同样方法读取其 cgroup，scope 可能叫 `app-org.chromium.Chromium-XXXX.scope`。systemd 如何命名 scope，和 GNOME Shell 最终如何识别窗口不是同一套信息。

下一步是直接从 GNOME 读取窗口身份。GNOME 49 对相关接口的限制使这些方法都没有得到 `app_id`。

### `org.gnome.Shell.Eval`

旧版 GNOME Shell 可以执行一段 JavaScript，读取窗口的 GTK application ID：

```bash
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval \
  'JSON.stringify(global.get_window_actors().map(a => [a.meta_window.get_title(), a.meta_window.get_gtk_application_id()]))'
```

GNOME 49 返回：

```text
(false, '')
```

`Eval` 已被禁用，表达式没有执行。

### `org.gnome.Shell.Introspect`

GNOME Shell 还暴露了两个看似更合适的 D-Bus 方法：

```bash
gdbus call --session \
  --dest org.gnome.Shell.Introspect \
  --object-path /org/gnome/Shell/Introspect \
  --method org.gnome.Shell.Introspect.GetWindows

gdbus call --session \
  --dest org.gnome.Shell.Introspect \
  --object-path /org/gnome/Shell/Introspect \
  --method org.gnome.Shell.Introspect.GetRunningApplications
```

两次调用都返回 `AccessDenied`。这些接口只允许 GNOME 授权的调用方访问，普通终端进程无法用它们枚举窗口。

### X11 工具

`xprop` 和 `xdotool` 可以验证 XWayland 窗口的 `WM_CLASS`：

```bash
xprop WM_CLASS
xdotool search --name 'Obsidian' getwindowclassname %@
```

待测窗口运行在原生 Wayland 下，两条命令都无法读取它。这里得到的结论仅是“X11 工具不可见”，而不是 Obsidian 的 `app_id` 值。

### Wayland 协议日志与 `strace`

```bash
WAYLAND_DEBUG=client obsidian
strace -f -e sendmsg obsidian
```

第一次运行 `WAYLAND_DEBUG` 没有任何有用输出。原因是 Obsidian 使用单实例锁：已有进程接收了这次启动请求，新进程在创建窗口之前就退出，自然不会再次发送 `xdg_toplevel.set_app_id`。`strace -f -e sendmsg` 也没有把目标字符串直接暴露出来。

### wlroots、GJS 与 AT-SPI

先检查 GNOME 是否提供 wlroots 的 foreign-toplevel 协议：

```bash
wayland-info | rg 'zwlr_foreign_toplevel_manager_v1'
```

命令没有输出，因为 GNOME 不实现该协议，依赖它的窗口枚举工具不能工作。

GJS 只是换一种方式调用同一个 `Shell.Eval` 接口：

```bash
gjs -c '
const { Gio, GLib } = imports.gi;
const result = Gio.DBus.session.call_sync(
  "org.gnome.Shell",
  "/org/gnome/Shell",
  "org.gnome.Shell",
  "Eval",
  new GLib.Variant("(s)", ["global.get_window_actors().length.toString()"]),
  new GLib.VariantType("(bs)"),
  Gio.DBusCallFlags.NONE,
  -1,
  null
);
print(result.print(true));
'
```

结果仍是 `(false, '')`。通过 `accerciser` 检查 AT-SPI 应用树也没有找到 Wayland `app_id`：

```bash
accerciser
```

D-Spy、临时 GNOME Shell 扩展、`wl-spy` 和 `wayland-tracer` 仍可继续深入，但这些分支没有实际执行，不能作为已经验证过的结果。

此时还没有直接证据证明 `app_id=electron`，只有 cgroup 提供的可疑线索。接下来的尝试也因此主要围绕“是不是启动方式把 Obsidian 变成了 electron”展开。

## 从 desktop entry 到 wrapper：逐条排除

以下复核命令都使用同一组固定版本。先构建 Obsidian 1.12.4 和 Electron 41.0.2，并为各次启动准备互不干扰的配置目录：

```bash
nixpkgs_ref='github:NixOS/nixpkgs/46db2e09e1d3f113a13c0d7b81e2f221c63b8ce9'
test_root="$(mktemp -d)"

obsidian_store="$(
  NIXPKGS_ALLOW_UNFREE=1 nix build --impure --no-link --print-out-paths \
    "$nixpkgs_ref#obsidian"
)"
electron_store="$(
  nix build --no-link --print-out-paths "$nixpkgs_ref#electron_41"
)"
app_asar="$obsidian_store/share/obsidian/app.asar"
```

这些实验最初在 GNOME 中只能通过“重复图标是否消失”判断结果。切换到 Niri 后，同样的启动参数又通过 `niri msg windows` 逐项复核，因此下面同时给出启动命令和窗口身份检查命令。

每次实验前都应从应用菜单完全退出上一个 Obsidian 实例，并用下面的命令确认没有残留进程：

```bash
pgrep -af 'obsidian|app.asar'
```

如果已有实例仍在运行，新命令可能只把启动请求转交给旧进程，实际窗口仍来自上一组参数。

### 尝试一：`--class=obsidian`

第一项修改是在 desktop entry 中同时设置 Chromium class 和 `StartupWMClass`：

```ini
Exec=obsidian --class=obsidian %u
StartupWMClass=obsidian
```

不安装 desktop entry 也可以单独验证 `--class` 对 Wayland 窗口的影响：

```bash
XDG_CONFIG_HOME="$test_root/class" \
NIXPKGS_ALLOW_UNFREE=1 \
NIXOS_OZONE_WL=1 \
nix run --impure "$nixpkgs_ref#obsidian" -- --class=obsidian
```

窗口出现后，在另一个终端读取它：

```bash
niri msg windows | rg -A 7 'Title: "Obsidian"'
```

`App ID` 仍为 `electron`。`--class` 来自 Chromium/X11 语境，主要改变 `WM_CLASS`，不等价于原生 Wayland 的 `xdg_toplevel.app_id`。

### 尝试二：`CHROME_DESKTOP`

第二项修改通过 Nix 的 `overrideAttrs` 和 `wrapProgram` 向 Obsidian wrapper 注入环境变量：

```nix
pkgs.obsidian.overrideAttrs (old: {
  nativeBuildInputs = (old.nativeBuildInputs or [ ]) ++ [ pkgs.makeWrapper ];
  postFixup = (old.postFixup or "") + ''
    wrapProgram "$out/bin/obsidian" \
      --set CHROME_DESKTOP obsidian.desktop
  '';
})
```

以下命令可以在不重建 wrapper 的情况下验证同一变量：

```bash
XDG_CONFIG_HOME="$test_root/chrome-desktop" \
CHROME_DESKTOP=obsidian.desktop \
NIXOS_OZONE_WL=1 \
"$obsidian_store/bin/obsidian"
```

从 `niri msg windows` 取得 PID 后，可以确认变量已经传入进程：

```bash
pid=123456  # 替换为 Obsidian 窗口的 PID
tr '\0' '\n' < "/proc/$pid/environ" | rg '^CHROME_DESKTOP='
niri msg windows | rg -A 7 'Title: "Obsidian"'
```

第一条命令输出 `CHROME_DESKTOP=obsidian.desktop`，第二条仍输出 `App ID: "electron"`。变量传递成功，但没有参与 Electron 的 Wayland app ID 计算。Chromium 浏览器层的 `chrome/browser/shell_integration_linux.cc` 会读取 `CHROME_DESKTOP`，这不代表 Electron 应用层使用同一机制。

这轮实验中，一次不正确的多层 wrapper 组合还导致：

```text
Cannot find module 'electron'
```

这个报错不是根因，只说明改写 wrapper 时已经干扰了 Electron 对应用入口参数的解释。修正启动参数后 Obsidian 能再次启动，图标问题仍在。

### 尝试三：让可执行文件看起来叫 `obsidian`

Nixpkgs 中 Obsidian 的启动链大致是：

```text
obsidian wrapper
  → electron wrapper（设置 GTK/GIO 等运行环境）
    → electron-unwrapped ELF
      → app.asar
```

第三项实验让入口文件名变成 `obsidian`：

```bash
ln -s "$electron_store/bin/electron" "$test_root/obsidian"

XDG_CONFIG_HOME="$test_root/symlink" \
NIXOS_OZONE_WL=1 \
"$test_root/obsidian" "$app_asar"
```

窗口仍报告 `App ID: "electron"`。检查 Electron wrapper 的末尾可以解释符号链接为什么无效：

```bash
tail -n 3 "$electron_store/bin/electron"
```

最后一行使用写死的 store 路径：

```sh
exec "/nix/store/...-electron-unwrapped-41.0.2/bin/electron" "$@"
```

它不会用 `exec -a "$0"` 保留外层链接名，所以符号链接没有改变最后看到的 `argv[0]`。

### 尝试四：直接改写 `argv[0]`

符号链接无法穿过 wrapper，因此第四项实验保留 wrapper 中的 GTK/GIO 环境设置，只把最后的 `exec` 改成 `exec -a obsidian`：

```bash
sed 's/^exec /exec -a obsidian /' \
  "$electron_store/bin/electron" > "$test_root/electron-as-obsidian"
chmod +x "$test_root/electron-as-obsidian"

tail -n 3 "$test_root/electron-as-obsidian"

XDG_CONFIG_HOME="$test_root/exec-a" \
NIXOS_OZONE_WL=1 \
"$test_root/electron-as-obsidian" "$app_asar"
```

修改后的最后一行等价于：

```sh
exec -a obsidian /nix/store/...-electron-unwrapped-41.0.2/bin/electron \
  /nix/store/...-obsidian-1.12.4/share/obsidian/app.asar "$@"
```

应用能够运行，但 GNOME 中的重复图标没有消失；通过 `niri msg windows` 复核，`app_id` 仍然是 `electron`。

至此可以排除“只要让二进制或 `argv[0]` 叫 obsidian 就行”的假设。Electron 41 的 Ozone/Wayland 路径并不靠这里生成最终的窗口 ID。

### 尝试五：从 desktop entry 注入环境变量

第五项实验不修改程序 wrapper，而是在 desktop entry 的 `Exec` 中注入同一变量：

```ini
Exec=env CHROME_DESKTOP=obsidian.desktop obsidian %u
```

激活该 desktop entry 后，用 desktop file ID 启动应用，再读取窗口：

```bash
gtk-launch obsidian
niri msg windows | rg -A 7 'Title: "Obsidian"'
```

结果与尝试二相同：变量存在，但 `App ID` 仍为 `electron`。改变变量的注入位置不会改变 Electron 是否用它设置 Wayland application ID。

### 未执行的备选分支

原始排查记录中还保留了几条候选方向：

- GNOME 是否因为 desktop file 位于 `/etc/profiles/per-user/star/share/applications` 而没有发现它；
- 尝试 `--ozone-platform-hint=auto`，或显式设置 `GIO_LAUNCHED_DESKTOP_FILE` 与 `GIO_LAUNCHED_DESKTOP_FILE_PID`；
- 通过 preload 在应用启动早期调用 `app.setName('obsidian')`；
- 强制走 XWayland，对比 `WM_CLASS` 路径；
- 解包更多 Electron 应用，与 VS Code 的启动方式和元数据逐项比较。

这些分支没有实际执行，不能把它们写成失败结论。取得真实 `app_id` 并找到 Electron 的专用 API 后，继续验证它们已经没有必要：desktop file 的搜索位置无法解释窗口主动提交的 `electron`；`app.setName()` 也不是控制 Linux desktop name 的正确接口。

## Niri 给出的决定性证据

Niri 可以直接列出合成器管理的窗口：

```bash
niri msg windows | rg -A 7 'Title: "Obsidian"'
```

Obsidian 1.12.4 的输出为：

```text
Window ID 63:
  Title: "Obsidian"
  App ID: "electron"
  Is floating: yes
  PID: 3016044
```

升级到 1.12.7 后再次检查，结果仍然相同。这个观察也排除了“只是 GNOME 没有扫描到 Nix profile 中的 desktop entry”一类假设：不论 GNOME 是否找到文件，客户端在协议层提交的值确实就是字面量 `electron`。

Wayland 调试日志也能复现同一结论。先从应用菜单完全退出 Obsidian，并确认 `pgrep -af 'obsidian|app.asar'` 没有返回残留进程，再运行：

```bash
XDG_CONFIG_HOME="$test_root/wayland-debug" \
WAYLAND_DEBUG=1 \
NIXOS_OZONE_WL=1 \
"$obsidian_store/bin/obsidian" 2>&1 | rg 'set_app_id'
```

日志中可以看到等价于下面的请求：

```text
xdg_toplevel.set_app_id("electron")
```

证据链不再依赖 cgroup、进程名或 GNOME 的推测：安装的文件叫 `obsidian.desktop`，正在运行的窗口却自报为 `electron`。

## Electron 的 `desktopName` 机制

Obsidian 的 Electron 元数据位于 `app.asar`。使用前面构建得到的 `$app_asar`，可以直接提取并筛选 `package.json`：

```bash
mkdir "$test_root/app-metadata"
(
  cd "$test_root/app-metadata"
  nix shell nixpkgs#asar --command \
    asar extract-file "$app_asar" package.json
)

jq '{name, description, version, productName, desktopName, main}' \
  "$test_root/app-metadata/package.json"
```

这里只提取所需文件。直接执行 `asar extract` 会继续寻找归档外部的 `app.asar.unpacked` 内容，而历史 Nix 包没有把所有这些文件放在归档旁边，会产生与窗口身份无关的 `ENOENT`。

Obsidian 1.12.4 的输出为：

```json
{
  "name": "obsidian",
  "description": "Obsidian",
  "version": "1.12.4",
  "productName": null,
  "desktopName": null,
  "main": "main.js"
}
```

其中没有 `desktopName`，也没有可供回退的 `productName`。这里的 `name=obsidian` 看似已经足够，但 Electron 对 Linux 桌面身份有另一个专门的接口。

Electron 文档规定，应用可以在 `ready` 事件之前调用：

```js
app.setDesktopName('obsidian.desktop');
```

也可以在 `package.json` 中提供：

```json
{
  "desktopName": "obsidian.desktop"
}
```

该值用于 Linux 的默认 X11 `WM_CLASS` 和 Wayland XDG application ID，并应与应用安装的 `.desktop` 文件名相符。Electron 在 [PR #34855](https://github.com/electron/electron/pull/34855) 中把这条信息接入了 Wayland app ID 的设置路径。

[Signal Desktop](https://github.com/signalapp/Signal-Desktop/blob/main/package.json) 等能够正确匹配的 Electron 应用会显式设置类似 `"desktopName": "signal.desktop"` 的值，而不是依赖 Electron 从二进制名称或 wrapper 猜测。

至此，历史版本的问题可以压缩成三行：

```text
系统安装：obsidian.desktop
窗口上报：app_id = electron
应用元数据：缺少 desktopName
```

Nixpkgs 使用系统 Electron 启动 `app.asar`，而系统 Electron 的二进制就叫 `electron`。Obsidian 没有提供稳定的 desktop name 时，Electron 的回退值因此暴露为 `electron`。官方 AppImage 在当时的测试中没有出现同样的图标问题，说明不同的捆绑与启动方式可能得到不同的回退结果；但这反而说明应用不应依赖打包环境猜出自己的身份。

## 根因位于应用元数据

根本修复应由应用层提供稳定、与 desktop entry 一致的 `desktopName`，或者在初始化阶段调用 `app.setDesktopName()`。这样无论 Electron 来自应用自带、系统包还是 Flatpak，窗口都不会因为底层二进制名不同而变成泛化的 `electron`。

发行版也可以解包 `app.asar`、注入字段后重新打包，但这会修改上游产物，每个版本都需要重新验证签名、哈希和启动行为，不适合作为长期维护方案。

Nixpkgs 的 [Issue #505078](https://github.com/NixOS/nixpkgs/issues/505078) 记录了同一问题。随后 [PR #510075](https://github.com/NixOS/nixpkgs/pull/510075) 暂时把 Electron 固定回 39，避免 Obsidian 升到 Electron 41 后触发这条路径；这是合理的打包止血，但没有给应用补上稳定身份。

Obsidian 论坛中的[上游报告](https://forum.obsidian.md/t/obsidian-reports-wayland-app-id-as-electron-instead-of-obsidian/113080)也经历了类似分工争议：官方 Nix 包不由 Obsidian 维护，但窗口身份是否完整仍取决于应用提供的元数据。[Flathub Issue #265](https://github.com/flathub/md.obsidian.Obsidian/issues/265) 中的同类默认图标问题进一步说明，它并不只存在于 Nix wrapper。

## 版本受限的临时匹配

在上游尚未修复时，本地 workaround 是覆盖 desktop entry，并添加：

```ini
StartupWMClass=electron
```

对应的 Home Manager 配置是：

```nix
xdg.desktopEntries =
  lib.mkIf (pkgs.stdenv.hostPlatform.isLinux && config.my.packages.obsidian.enable)
    {
      obsidian = {
        name = "Obsidian";
        comment = "Knowledge base";
        categories = [ "Office" ];
        exec = "obsidian %u";
        icon = "obsidian";
        mimeType = [ "x-scheme-handler/obsidian" ];
        type = "Application";
        startupNotify = true;
        settings = {
          StartupWMClass = "electron";
          Version = "1.5";
        };
      };
    };
```

这里同时限定 Linux 和 Obsidian 已启用：`.desktop` 文件只对 Linux 桌面有意义，不必让同一个 Home Manager 模块在 Darwin 上写入无效文件。

虽然 `StartupWMClass` 本来描述 X11 的 `WM_CLASS`，GNOME Shell、noctalia 等桌面组件会把它作为额外匹配线索。在当时的环境中，它能把 `app_id=electron` 的窗口吸附到 Obsidian 条目，恢复正确图标和分组。

这个办法有三个明确限制：

1. 它依赖桌面环境的回退匹配行为，不是 Wayland 对 desktop file ID 的标准对应关系；
2. `electron` 是泛化名称，另一款同样缺少 desktop name 的 Electron 应用可能被错误归到 Obsidian；
3. 一旦上游改用新的专属 `app_id`，这条配置就会过时，甚至再次制造不匹配。

因此它只适合个人配置中的、与特定版本绑定的 workaround。改用当时可以正确匹配的官方 AppImage 是另一种临时选择，但也不是对发行版包的根本修复。

### 为什么 `app_id=electron` 时仍可能显示正确图标

`niri msg windows` 只显示应用提交给合成器的原始 `app_id`，不会显示任务栏随后采用了哪个 desktop entry。当前系统若已经启用上述 workaround，就会同时出现下面两项结果：

```text
窗口提交：App ID: "electron"
任务栏匹配：StartupWMClass=electron → obsidian.desktop → Icon=obsidian
```

可以直接查找桌面环境当前能够看到的 Obsidian 条目：

```bash
desktop_file="$(
  find -L \
    "$HOME/.local/share/applications" \
    "/etc/profiles/per-user/$USER/share/applications" \
    -maxdepth 1 -name obsidian.desktop -print -quit 2>/dev/null
)"

printf '%s\n' "$desktop_file"
rg '^(Name|Icon|StartupWMClass)=' "$desktop_file"
```

启用 workaround 后，预期输出包含：

```ini
Name=Obsidian
Icon=obsidian
StartupWMClass=electron
```

因此，`App ID: "electron"` 与任务栏显示紫色 Obsidian 图标并不矛盾。前者说明应用层问题仍可复现，后者说明任务栏根据 `StartupWMClass` 完成了兼容匹配。要观察原始的重复图标，必须先停用这条 desktop entry 覆盖，再重新加载桌面配置。

## 固定一套可以重现的旧环境

为避免依赖模糊的“某个 unstable 版本”，复现环境固定为：

| 项目             | 固定值                                     |
| ---------------- | ------------------------------------------ |
| nixpkgs revision | `46db2e09e1d3f113a13c0d7b81e2f221c63b8ce9` |
| Obsidian         | 1.12.4                                     |
| Electron         | 41.0.2                                     |
| 会话             | 原生 Wayland，`NIXOS_OZONE_WL=1`           |

这个 revision 中的 [Obsidian package](https://github.com/NixOS/nixpkgs/blob/46db2e09e1d3f113a13c0d7b81e2f221c63b8ce9/pkgs/by-name/ob/obsidian/package.nix) 明确是 1.12.4，`electron` 属性指向 Electron 41；同一 revision 的 [Electron 版本表](https://github.com/NixOS/nixpkgs/blob/46db2e09e1d3f113a13c0d7b81e2f221c63b8ce9/pkgs/development/tools/electron/binary/info.json) 对应 41.0.2。该 Obsidian 包安装 `obsidian.desktop`，其中没有 `StartupWMClass`。

### 快速验证协议层结果

先完全退出所有已有 Obsidian 实例，避免单实例进程接管启动。然后可以临时运行固定 revision 中的包：

```bash
obsidian_repro_config="$(mktemp -d)"

XDG_CONFIG_HOME="$obsidian_repro_config" \
NIXPKGS_ALLOW_UNFREE=1 \
NIXOS_OZONE_WL=1 \
nix run --impure \
  github:NixOS/nixpkgs/46db2e09e1d3f113a13c0d7b81e2f221c63b8ce9#obsidian
```

在 Niri 中另开终端执行：

```bash
niri msg windows
```

预期可以看到 `App ID: "electron"`。其他合成器若没有窗口查询接口，可以在确认旧进程已经退出后改用：

```bash
WAYLAND_DEBUG=1 \
XDG_CONFIG_HOME="$obsidian_repro_config" \
NIXOS_OZONE_WL=1 \
nix run --impure \
  github:NixOS/nixpkgs/46db2e09e1d3f113a13c0d7b81e2f221c63b8ce9#obsidian \
  2>&1 | rg 'set_app_id'
```

这只能快速验证窗口上报的 `app_id`。若要完整复现“一个固定图标加一个运行图标”，还必须把同一个包安装进 profile，使 `obsidian.desktop` 对桌面环境可见，并先固定那个条目。运行前可直接检查历史包自带的 desktop entry：

```bash
obsidian_store="$(
  NIXPKGS_ALLOW_UNFREE=1 nix build --impure --no-link --print-out-paths \
    github:NixOS/nixpkgs/46db2e09e1d3f113a13c0d7b81e2f221c63b8ce9#obsidian
)"

rg '^(Name|Exec|Icon|StartupWMClass)=' \
  "$obsidian_store/share/applications/obsidian.desktop"
```

输出包含 `Name=Obsidian`、`Exec=obsidian %u` 和 `Icon=obsidian`，但没有 `StartupWMClass`。

### 在 NixOS/Home Manager 中安装同一版本

可以额外添加一个只用于复现的 nixpkgs input：

```nix
inputs.obsidian-repro-nixpkgs.url =
  "github:NixOS/nixpkgs/46db2e09e1d3f113a13c0d7b81e2f221c63b8ce9";
```

再在能接收 `inputs` 的 Home Manager 模块中导入它：

```nix
{ inputs, pkgs, ... }:

let
  reproPkgs = import inputs.obsidian-repro-nixpkgs {
    system = pkgs.stdenv.hostPlatform.system;
    config.allowUnfree = true;
  };
in
{
  home.packages = [ reproPkgs.obsidian ];
}
```

复现时还要暂时停用前面的 `StartupWMClass=electron` 覆盖，否则 workaround 会把症状遮住。重新登录或刷新 desktop database 后，固定 `obsidian.desktop`，启动 Obsidian，再分别检查重复图标和 `app_id`。

干净复现应同时得到两条结果：

```text
desktop file ID: obsidian.desktop
Wayland app_id:  electron
```

前者说明桌面入口存在，后者说明运行窗口提供了另一个身份；两者的差异才是问题本身，而不仅仅是某个 Shell 恰好显示了错误图标。

## 2026 年复查：应用已修，打包仍需对齐

截至 2026-08-22，Obsidian 官方最新桌面版本是 1.13.7。以下命令下载官方 `.deb`，同时检查 Electron 元数据和 desktop entry：

```bash
nix shell \
  nixpkgs#binutils nixpkgs#xz nixpkgs#asar \
  nixpkgs#jq nixpkgs#ripgrep nixpkgs#curl \
  --command bash -euo pipefail -c '
    work_dir="$(mktemp -d)"
    deb="$work_dir/obsidian_1.13.7_amd64.deb"

    curl -fL \
      "https://github.com/obsidianmd/obsidian-releases/releases/download/v1.13.7/obsidian_1.13.7_amd64.deb" \
      -o "$deb"

    mkdir "$work_dir/root"
    (cd "$work_dir" && ar x "$deb")
    tar -xJf "$work_dir/data.tar.xz" -C "$work_dir/root"
    mkdir "$work_dir/app"
    (
      cd "$work_dir/app"
      asar extract-file \
        "$work_dir/root/opt/Obsidian/resources/app.asar" package.json
    )

    jq "{version, desktopName}" "$work_dir/app/package.json"
    rg "^(Name|Exec|Icon|StartupWMClass)=" \
      "$work_dir/root/usr/share/applications/md.obsidian.Obsidian.desktop"
  '
```

`package.json` 的相关输出为：

```json
{
  "version": "1.13.7",
  "desktopName": "md.obsidian.Obsidian.desktop"
}
```

官方 `.deb` 也安装同名的：

```text
/usr/share/applications/md.obsidian.Obsidian.desktop
```

其中还设置了：

```ini
StartupWMClass=md.obsidian.Obsidian
```

Electron 去掉 `.desktop` 后使用 `md.obsidian.Obsidian` 作为 Wayland `app_id`。对官方 1.13.7 包而言，应用元数据、窗口 ID 和 desktop file ID 已经首尾一致；历史版本中的应用层根因已经修复。

但“上游有了正确字段”不等于所有发行版包会自动匹配。复查使用的 nixpkgs revision `2fcb964de67fcf60b43471c55d5d99e61a9ccb5a` 仍为 Obsidian 1.13.4。下面的命令可以检查这一固定 revision：

```bash
current_ref='github:NixOS/nixpkgs/2fcb964de67fcf60b43471c55d5d99e61a9ccb5a'
current_root="$(
  NIXPKGS_ALLOW_UNFREE=1 nix build --impure --no-link --print-out-paths \
    "$current_ref#obsidian"
)"
current_unpack="$(mktemp -d)"

mkdir "$current_unpack/app"
(
  cd "$current_unpack/app"
  nix shell nixpkgs#asar --command \
    asar extract-file "$current_root/share/obsidian/app.asar" package.json
)

jq '{version, desktopName}' "$current_unpack/app/package.json"
find -L "$current_root/share/applications" -maxdepth 1 -name '*.desktop' -print
```

该版本的应用元数据已经包含 `desktopName=md.Obsidian.desktop`，Nixpkgs 却仍生成 `obsidian.desktop`。窗口身份不再是 `electron`，但两个名称依然不同。

状态可以概括为：

| 组合                                        | desktop file                   | 预期 Wayland `app_id`  | 是否对齐 |
| ------------------------------------------- | ------------------------------ | ---------------------- | -------- |
| 历史 Nixpkgs：Obsidian 1.12.4 + Electron 41 | `obsidian.desktop`             | `electron`             | 否       |
| 官方 Obsidian 1.13.7                        | `md.obsidian.Obsidian.desktop` | `md.obsidian.Obsidian` | 是       |
| 固定 revision `2fcb964…`：Obsidian 1.13.4   | `obsidian.desktop`             | `md.Obsidian`          | 否       |

[Nixpkgs PR #551212](https://github.com/NixOS/nixpkgs/pull/551212) 正在把 Obsidian 更新到 1.13.7；截至复查时，它只更新版本与哈希，没有同步更名 Nixpkgs 生成的 desktop entry。如果以这个形态合并，`app_id` 会从 `md.Obsidian` 变成 `md.obsidian.Obsidian`，但仍然无法与 `obsidian.desktop` 按标准规则对应。打包侧还需要采用上游的 desktop 文件名，或者做等价的一致性处理。

这也意味着旧 workaround `StartupWMClass=electron` 已经不能被当作长期配置：它只准确描述 Obsidian 1.12.x + Electron 41 的历史组合。升级后应重新读取实际 `app_id`，让 desktop file 的名称随上游对齐，而不是继续匹配 `electron`。

## 可复用的排查顺序

主要时间消耗发生在无法读取 `app_id` 的阶段：进程名、cgroup、环境变量和 wrapper 都只能提供间接线索。遇到同类问题时，可以按以下顺序减少无效分支：

1. 确认窗口是原生 Wayland 还是 XWayland；
2. 用合成器接口或 `WAYLAND_DEBUG` 读取真实 `app_id`；
3. 找到桌面环境实际加载的 desktop file ID；
4. 对 Electron 应用检查 `desktopName` 或 `app.setDesktopName()`；
5. 再检查发行版是否改名、重建或遗漏了上游 desktop entry；
6. 只有无法立即修复前两端时，才使用 `StartupWMClass` 等桌面环境特定的回退手段。

重复图标看起来只是桌面上的一处小瑕疵，背后却是一份跨越应用、运行时与发行版的命名契约。最可靠的诊断依据始终是窗口在协议层实际说了什么，以及磁盘上的 desktop file 究竟叫什么。

## 参考资料

- [Electron `app.setDesktopName()` 文档](https://github.com/electron/electron/blob/main/docs/api/app.md)
- [Electron PR #34855：为 Wayland 设置 application ID](https://github.com/electron/electron/pull/34855)
- [Electron Issue #33578：原生 Wayland 下没有正确设置 app ID](https://github.com/electron/electron/issues/33578)
- [Electron Issue #48391：Linux desktop name 的后续处理](https://github.com/electron/electron/issues/48391)
- [Nixpkgs Issue #505078：Obsidian 的 Wayland 图标与 `app_id`](https://github.com/NixOS/nixpkgs/issues/505078)
- [Nixpkgs PR #510075：将 Obsidian 暂时固定到 Electron 39](https://github.com/NixOS/nixpkgs/pull/510075)
- [Nixpkgs PR #551212：Obsidian 1.13.7 更新](https://github.com/NixOS/nixpkgs/pull/551212)
- [Obsidian 论坛：Wayland `app_id` 报告为 `electron`](https://forum.obsidian.md/t/obsidian-reports-wayland-app-id-as-electron-instead-of-obsidian/113080)
- [Flathub Obsidian Issue #265：Wayland 下显示默认图标](https://github.com/flathub/md.obsidian.Obsidian/issues/265)
- [Obsidian desktop release 索引](https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/desktop-releases.json)
- [Obsidian 1.13.7 release](https://github.com/obsidianmd/obsidian-releases/releases/tag/v1.13.7)
- [Flathub 的 `md.obsidian.Obsidian.desktop`](https://github.com/flathub/md.obsidian.Obsidian/blob/master/md.obsidian.Obsidian.desktop)
