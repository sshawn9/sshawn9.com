---
title: 'CARLA 仿真工作'
description: '记录既有运动控制框架接入 CARLA 的平台适配工作、仿真时间与真实时间的同步需求，以及手柄控制链路的运行效果。'
---

## CARLA 的时间推进机制

CARLA 基于[客户端—服务器架构](https://carla.readthedocs.io/en/0.9.16/foundations/#world-and-client)：服务器运行仿真，客户端读取仿真状态并请求修改世界。仿真的时间推进由两个彼此独立的维度共同决定，分别是客户端与服务器采用同步模式还是异步模式，以及仿真采用固定时间步长还是可变时间步长。

### 仿真时间与真实时间

[CARLA 将仿真时间与真实时间明确区分](https://carla.readthedocs.io/en/0.9.16/adv_synchrony_timestep/#simulation-time-step)。服务器计算相邻两个仿真状态需要消耗真实时间，而**时间步长**表示这两个状态在仿真时钟上相隔的时间，两者不要求相等。例如，服务器可能只用几毫秒完成一次计算，但该仿真步仍可被设定为推进一秒仿真时间。

[异步模式是默认模式，服务器不等待客户端，自行尽快推进仿真](https://github.com/carla-simulator/carla/blob/0.9.16/Docs/adv_synchrony_timestep.md#L113-L117)。[同步模式下，服务器完成当前仿真步后等待客户端发出 `tick`，收到 tick 才进入下一步](https://carla.readthedocs.io/en/0.9.16/adv_synchrony_timestep/#setting-synchronous-mode)，因此推进时机由发送 tick 的客户端控制。

[可变时间步长也是默认设置，它不预先指定恒定的仿真时间增量，而是逐帧确定仿真时间增量](https://carla.readthedocs.io/en/0.9.16/adv_synchrony_timestep/#variable-time-step)。由于各步时间不同，重放时需要插值；同时，以浮点数累计可变时间增量会引入误差，不利于精确复现。[固定时间步长保持每一步经过的仿真时间不变](https://carla.readthedocs.io/en/0.9.16/adv_synchrony_timestep/#fixed-time-step)，并通过 [`fixed_delta_seconds`](https://carla.readthedocs.io/en/0.9.16/python_api/#carla.WorldSettings.fixed_delta_seconds) 指定其数值。例如，设置为 $20\,\mathrm{ms}$，表示每个仿真秒包含 50 个仿真步。

[官方文档将两个维度归纳为四种组合](https://carla.readthedocs.io/en/0.9.16/adv_synchrony_timestep/#possible-configurations)：

| 配置                    | 运行方式                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| 异步模式 + 可变时间步长 | 默认配置；服务器与客户端异步运行，仿真步长逐帧变化，官方将其描述为仿真时间随真实时间推进，精确复现较为困难。 |
| 异步模式 + 固定时间步长 | 服务器仍尽快运行，但每一步对应固定的仿真时间；服务器性能足够时，仿真可以快于真实时间。                       |
| 同步模式 + 可变时间步长 | 服务器等待客户端会使可变时间步长增大，可能导致仿真时间与物理计算失去一致性。                                 |
| 同步模式 + 固定时间步长 | 客户端控制仿真推进，每一步经过固定的仿真时间，适用于重视同步与精度的场景。                                   |

[CARLA 官方要求同步模式始终配合固定时间步长](https://github.com/carla-simulator/carla/blob/0.9.16/Docs/adv_synchrony_timestep.md#L196-L197)。同步模式决定由谁推进仿真，固定时间步长决定每一步推进多少仿真时间；二者都不会自动约束相邻两步在真实时间中的间隔。从上述四种时间配置与 [`WorldSettings`](https://carla.readthedocs.io/en/0.9.16/python_api/#carla.WorldSettings) 可以看到，CARLA 没有提供独立的、以墙上时间闭环校正仿真时钟的“实时仿真”设置；按照真实时钟控制 tick 属于客户端在上述机制之上增加的调度逻辑。

### 默认可变时间步长与墙上时间的关系

这里需要单独回答一个容易混淆的问题：默认的异步模式与可变时间步长，究竟只是让服务器不受限制地运行，还是应当使仿真时间与墙上时间保持相同尺度？官方文档给出了后一个答案，但源码实现的保证程度弱于文档字面容易造成的印象。

#### 官方文档表达的设计语义

CARLA 0.9.16 的时间步长文档分别作出了三层表述：

1. [在可变时间步长下，相邻仿真步之间经过的仿真时间，是服务器完成这些步骤所用的时间](https://github.com/carla-simulator/carla/blob/0.9.16/Docs/adv_synchrony_timestep.md#L28-L30)；
2. [在解释可变步长的浮点误差时，文档称仿真使用“等于真实时间的时间步长”](https://github.com/carla-simulator/carla/blob/0.9.16/Docs/adv_synchrony_timestep.md#L65-L71)；
3. [在四种配置的总结中，文档直接说明默认的“异步模式 + 可变时间步长”使仿真时间随真实时间推进](https://github.com/carla-simulator/carla/blob/0.9.16/Docs/adv_synchrony_timestep.md#L190)。

[CARLA 0.10.0 的版本化文档保留了相同表述](https://github.com/carla-simulator/carla/blob/0.10.0/Docs/adv_synchrony_timestep.md)。因此，仅根据 0.9.16 和 0.10.0 的官方文档，不能把默认可变步长解释成“仿真时钟可以任意快于或慢于墙上时间”。官方给出的设计语义确实是

$$
\Delta t_{\mathrm{sim}}
\approx
\Delta t_{\mathrm{wall}}.
$$

[文档同时称异步服务器会“尽快”运行](https://carla.readthedocs.io/en/0.9.16/adv_synchrony_timestep/#client-server-synchrony)，这与上述结论并不矛盾。假设服务器在一段墙上时间 $T$ 内生成 $N$ 帧，则服务器的实际帧率由 $N/T$ 描述，而同一期间经过的仿真时间为

$$
\Delta t_{\mathrm{sim,total}}
=
\sum_{i=1}^{N}\Delta t_{\mathrm{sim},i}.
$$

服务器性能较高时，可以在同样的墙上时间内生成更多帧；只要每一帧累加的仿真时间相应减小，累计仿真时间仍可近似等于墙上时间。因而需要严格区分：

- **实际帧率**：每秒真实时间生成多少个仿真帧；
- **仿真步长**：一个仿真帧在仿真时钟上推进多少时间；
- **时间比例**：累计仿真时间与累计墙上时间之比。

“服务器尽快生成帧”只直接描述第一项，不能据此推出第三项一定大于 $1$。同样，文档所说的可变时间步长浮点误差主要关系到累计精度和重放重复性，也不能解释仿真时间长期、大幅快于墙上时间的现象。

#### 源码中的实际计时链路

文档中“服务器完成计算所用的时间”是一种概念性描述，并不表示 CARLA 对每个仿真步骤单独测量 CPU 或 GPU 计算耗时。CARLA 0.9.16 的实际计时链路是：

1. Unreal Engine 调用 [`FCarlaEngine::OnPreTick`](https://github.com/carla-simulator/carla/blob/0.9.16/Unreal/CarlaUE4/Plugins/Carla/Source/Carla/Game/CarlaEngine.cpp#L279-L318)，并传入当前世界帧的 `DeltaSeconds`；
2. CARLA 将 `DeltaSeconds` 交给 [`TickTimers`](https://github.com/carla-simulator/carla/blob/0.9.16/Unreal/CarlaUE4/Plugins/Carla/Source/Carla/Game/CarlaEpisode.h#L360-L375)；
3. `TickTimers` 直接把它累加到仿真过程的累计时间：

```cpp
ElapsedGameTime += DeltaSeconds;
```

经过 $N$ 帧后，CARLA 的累计仿真时间实际为

$$
t_{\mathrm{sim},N}
=
t_{\mathrm{sim},0}
+
\sum_{i=1}^{N}\texttt{DeltaSeconds}_i.
$$

另一方面，[`WorldObserver`](https://github.com/carla-simulator/carla/blob/0.9.16/Unreal/CarlaUE4/Plugins/Carla/Source/Carla/Sensor/WorldObserver.cpp#L296-L301)会在同一个世界快照中分别写入操作系统提供的 `platform_timestamp` 和当前帧的 `delta_seconds`。在这条计时链路中，`platform_timestamp` 只是随快照发送的观测值，没有被用于计算 `ElapsedGameTime`，也没有形成如下闭环校正：

```text
测量墙上时间
    ↓
比较仿真时间与墙上时间
    ↓
根据累计误差修正下一帧时间增量
```

CARLA 0.10.0 的 [`OnPreTick`](https://github.com/carla-simulator/carla/blob/0.10.0/Unreal/CarlaUnreal/Plugins/Carla/Source/Carla/Game/CarlaEngine.cpp#L283-L325)、[`TickTimers`](https://github.com/carla-simulator/carla/blob/0.10.0/Unreal/CarlaUnreal/Plugins/Carla/Source/Carla/Game/CarlaEpisode.h#L362-L373)与[世界快照写入逻辑](https://github.com/carla-simulator/carla/blob/0.10.0/Unreal/CarlaUnreal/Plugins/Carla/Source/Carla/Sensor/WorldObserver.cpp#L307-L313)仍采用相同结构。

这意味着默认可变时间步长依赖 Unreal Engine 提供的帧增量能够代表相应的真实帧间隔。可是 [`UWorld::GetDeltaSeconds`](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/UWorld/GetDeltaSeconds) 给出的是经过引擎时间机制调整的世界帧增量，而不是 CARLA 独立读取墙上时钟后计算出的差值。CARLA 在设置固定时间步长时还会通过 [`FApp::SetFixedDeltaTime`](https://github.com/carla-simulator/carla/blob/0.9.16/Unreal/CarlaUE4/Plugins/Carla/Source/Carla/Game/CarlaEngine.cpp#L47-L55)改变引擎使用的时间增量。由此可见，`DeltaSeconds` 与墙上时间的关系取决于实际生效的引擎时间状态，CARLA 的累计计时器本身不会检查或消除两者之间的偏差。

因此，官方文档表达的是默认模式的设计语义，而不是一个由独立墙上时钟强制维持的数学约束。源码并不保证在任意运行状态下恒有

$$
t_{\mathrm{sim}}-t_{\mathrm{sim},0}
=
t_{\mathrm{wall}}-t_{\mathrm{wall},0}.
$$

#### 社区讨论能够证明什么

CARLA 社区对 `FPS`、仿真速度和真实运行耗时的表述并不总是使用同一个定义，因此需要逐项限定其证据范围。

| 讨论                                                                                        | 已经明确的内容                                                                                                                         | 不能据此推出的结论                                                                                               |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [issue #4154](https://github.com/carla-simulator/carla/issues/4154#issuecomment-839622916)  | CARLA 贡献者说明，默认配置没有固定 FPS，异步可变步长下的运行速度受机器性能影响。                                                       | 该评论没有定义“simulation speed”指实际帧率还是仿真时间与墙上时间之比，不能单独证明默认仿真时钟应当快于墙上时间。 |
| [issue #4202](https://github.com/carla-simulator/carla/issues/4202#issuecomment-848560300)  | `fixed_delta_seconds` 固定的是相邻帧之间的**仿真时间**；服务器仍会尽可能快地生成帧。若要控制实际 FPS，需要使用同步模式并由客户端控制。 | 固定仿真步长不等于固定真实帧率，也不自动实现实时运行。                                                           |
| [issue #5654](https://github.com/carla-simulator/carla/issues/5654#issuecomment-1255874218) | 同步模式下的真实运行耗时取决于客户端发送 tick 的节奏以及代码和硬件性能；需要时可以由外部调度降低推进速度。                             | 该结论针对同步推进，不能用来解释默认异步可变步长的累计时间为何偏离。                                             |
| [issue #9543](https://github.com/carla-simulator/carla/issues/9543)                         | 2026 年 2 月，一名 CARLA 0.9.16 用户报告仿真时间明显快于真实时间。现有回复只引导其阅读同步与时间步长文档。                             | 报告没有提供完整复现脚本，维护者也没有确认根因，因此不能据此断言 0.9.16 存在已经定位的通用计时缺陷。             |

其中，issue #9543 至少说明“大幅快于真实时间”并非只有一次观察；但在得到可复现配置和服务器时间戳之前，它仍然只是未定位的问题报告。相反，#4154、#4202 和 #5654 主要说明了帧率、仿真步长与真实执行耗时不能混为一谈，也不能用其中任何一句关于“运行得快”的描述替代对仿真时钟的实际测量。

#### 如何判定偏差发生在哪一层

CARLA 的 [`Timestamp`](https://carla.readthedocs.io/en/0.9.16/python_api/#carla.Timestamp) 同时提供：

- `elapsed_seconds`：当前仿真过程累计经过的仿真时间；
- `delta_seconds`：相对上一帧经过的仿真时间；
- `platform_timestamp`：生成当前快照时，由服务器操作系统给出的时间。

对于同一服务器先后生成的两个世界快照 $a$ 和 $b$，可以直接计算

$$
R_{\mathrm{server}}
=
\frac{
t_{\mathrm{sim},b}-t_{\mathrm{sim},a}
}{
t_{\mathrm{platform},b}-t_{\mathrm{platform},a}
}
=
\frac{
\Delta\texttt{elapsed\_seconds}
}{
\Delta\texttt{platform\_timestamp}
}.
$$

- $R_{\mathrm{server}}\approx1$：累计仿真时间在该区间内近似跟随服务器墙上时间；
- $R_{\mathrm{server}}>1$：仿真时间推进得更快；
- $R_{\mathrm{server}}<1$：仿真时间推进得更慢。

下面的最小检查只适用于正在验证的默认异步模式；它通过 [`world.get_settings()`](https://carla.readthedocs.io/en/0.9.16/python_api/#carla.World.get_settings) 输出实际生效的世界设置，再通过 `world.wait_for_tick()` 跨越足够多的服务器快照比较两种累计时间：

```python
world = client.get_world()
settings = world.get_settings()

print(f"synchronous_mode={settings.synchronous_mode}")
print(f"fixed_delta_seconds={settings.fixed_delta_seconds}")

first = world.wait_for_tick()
last = first

for _ in range(500):
    last = world.wait_for_tick()

sim_elapsed = (
    last.timestamp.elapsed_seconds
    - first.timestamp.elapsed_seconds
)
platform_elapsed = (
    last.timestamp.platform_timestamp
    - first.timestamp.platform_timestamp
)

print(f"frames={last.frame - first.frame}")
print(f"simulation seconds={sim_elapsed:.6f}")
print(f"platform seconds={platform_elapsed:.6f}")
print(f"simulation/platform={sim_elapsed / platform_elapsed:.6f}")
```

这里不要求客户端与服务器的绝对时钟已经同步，因为分子和分母都只使用各自区间的差值，而且决定性比值中的两个时间字段来自服务器快照。跨越数百帧计算累计比例，也可以避免把单帧抖动误认为长期时间尺度差异。

测量时不宜直接按照异步 `on_tick` 回调的执行先后累计数据。[issue #1106](https://github.com/carla-simulator/carla/issues/1106#issuecomment-452051185)记录了这类回调可能并发执行，较旧帧的回调不一定先于较新帧完成；如果没有检查 `frame`，客户端得到的顺序可能制造时间倒退或错误间隔。使用 `wait_for_tick()` 获取端点快照，或者按 `frame` 检查和排序，可以避免把这一客户端现象误认为服务器时钟异常。

如果 $R_{\mathrm{server}}$ 已经明显偏离 $1$，那么偏差存在于服务器使用的仿真时间与服务器平台时间之间，客户端网络延迟和客户端本机时钟都不能解释这个结果。如果 $R_{\mathrm{server}}\approx1$，但客户端观察到的车辆运动或数据播放仍显著快于真实时间，则应继续区分客户端接收与播放节奏、车辆控制、物理状态和传感器数据处理，而不能继续把问题归因于 CARLA 的累计仿真时钟。

#### 一次异步可变时间步长实测

2026 年 8 月 12 日，使用[独立测试脚本](https://gist.github.com/sshawn9/607546b8565f8af661d95b07a8a21057)对一个正在运行的 CARLA 实例进行测量。脚本只读取世界设置和连续世界快照，不修改仿真状态。测试开始时的设置为：

```text
synchronous_mode: False
fixed_delta_seconds: None
```

这表示世界处于异步模式，并采用可变时间步长。跨越 10 000 个连续世界帧后得到：

| 测量量                 | 结果        |
| ---------------------- | ----------- |
| 仿真时间增量           | 20.283579 s |
| 服务器平台时间增量     | 20.283598 s |
| 客户端单调时钟时间增量 | 20.283615 s |
| 仿真时间/服务器时间    | 0.999999    |
| 世界帧平均生成频率     | 493.009 Hz  |
| 每帧平均仿真时间增量   | 2.028358 ms |

服务器在约 20.28 秒真实时间内生成了 10 000 个世界帧，因此实际帧率接近 493 Hz；与此同时，每一帧平均只推进约 2.03 ms 仿真时间。高帧率与较小的可变时间步长共同作用，使累计仿真时间仍然近似等于真实时间，并未随世界帧率成比例加速。

服务器平台时间与客户端单调时钟来自两条独立的真实时间测量路径，它们分别只比仿真时间多 19 微秒和 36 微秒。至少在这次运行中，此前由“服务器尽快运行”或高帧率推断“仿真时钟明显快于真实时间”的判断并不成立；这种印象很可能混淆了**单位真实时间生成的帧数**与**累计仿真时间相对于真实时间的比例**。

这次测量结果与默认异步可变时间步长的文档语义一致，但不能据此断言所有版本、场景和负载下都会得到相同结果。本次记录也没有包含具体 CARLA 版本和场景负载，因此 493 Hz 只用于描述这一次运行，不构成跨环境的性能结论。

#### 目前能够成立的结论

官方文档确实把默认的异步模式与可变时间步长描述为仿真时间随真实时间推进，以上实测也与这一名义行为一致；源码则通过逐帧累加 Unreal Engine 的 `DeltaSeconds` 实现这一设计。但是，这不是以独立墙上时钟为参照、持续修正累计误差的严格实时同步机制。

因此，如果实际生效的设置确实是 `synchronous_mode = false` 且未设置 `fixed_delta_seconds`，而 $R_{\mathrm{server}}$ 仍长期、大幅偏离 $1$，这个结果不符合官方文档描述的名义行为。下一步应核对是否有其他客户端覆盖世界设置、Unreal Engine 实际提供了怎样的 `DeltaSeconds`，或者是否存在 CARLA/Unreal 的实现问题。在完成这些检查前，既不能把偏差说成默认模式的正常行为，也不能直接把它定性为已经确认的 CARLA 通用缺陷。

### 仿真帧与 tick

每次世界更新都会产生一个仿真帧。在同步模式下，[`world.tick()`](https://carla.readthedocs.io/en/0.9.16/python_api/#carla.World.tick)向服务器发送继续执行的信号，并阻塞等待服务器计算出下一帧，随后返回新帧的 frame ID。`world.tick(seconds=10.0)` 的 `seconds` 参数只是等待服务器响应的超时时间，不是仿真步长，也不负责控制 tick 周期。

在异步模式下，[`world.wait_for_tick()`](https://carla.readthedocs.io/en/0.9.16/python_api/#carla.World.wait_for_tick)只等待服务器产生下一帧并返回对应的世界快照，不会主动推进仿真；[`world.on_tick()`](https://carla.readthedocs.io/en/0.9.16/python_api/#carla.World.on_tick)则用于注册每帧触发的回调。

每个[`WorldSnapshot`](https://carla.readthedocs.io/en/0.9.16/python_api/#carla.WorldSnapshot)表示某一帧中整个世界的状态，并包含这一帧的 [`ActorSnapshot`](https://carla.readthedocs.io/en/0.9.16/python_api/#carla.ActorSnapshot) 与 `Timestamp`。时间戳中可用于分析时间关系的字段包括：

- `frame`：仿真器启动以来经过的帧数；
- `elapsed_seconds`：当前[仿真过程（episode）](https://carla.readthedocs.io/en/0.9.16/python_api/#carla.World.id)开始以来经过的仿真时间；
- `delta_seconds`：相对上一帧经过的仿真时间；
- `platform_timestamp`：记录该帧时由操作系统给出的时间。

其中，`elapsed_seconds` 与 `delta_seconds` 属于仿真时钟，`platform_timestamp` 属于平台时钟。CARLA 文档没有承诺服务器与客户端位于不同主机时，两端操作系统的时钟已经同步，因此不能在没有统一时基的前提下直接比较跨主机时间戳。

### 物理子步

`fixed_delta_seconds` 定义的是外层仿真帧的时间跨度，不一定是物理引擎实际使用的积分步长。CARLA 默认启用[物理子步](https://carla.readthedocs.io/en/0.9.16/adv_synchrony_timestep/#physics-substepping)，在两个外层帧之间使用更小的时间间隔执行物理计算。默认设置为：

- [`max_substep_delta_time`](https://carla.readthedocs.io/en/0.9.16/python_api/#carla.WorldSettings.max_substep_delta_time) `= 0.01` 秒；
- [`max_substeps`](https://carla.readthedocs.io/en/0.9.16/python_api/#carla.WorldSettings.max_substeps) `= 10`。

[固定时间步长与物理子步必须满足](https://github.com/carla-simulator/carla/blob/0.9.16/Docs/adv_synchrony_timestep.md#L91-L95)：

$$
\texttt{fixed\_delta\_seconds}
\le
\texttt{max\_substep\_delta\_time}
\times
\texttt{max\_substeps}.
$$

[官方文档给出的实验结果显示](https://github.com/carla-simulator/carla/blob/0.9.16/Docs/adv_synchrony_timestep.md#L97-L108)，物理子步应小于 $0.01666\,\mathrm{s}$，理想情况下不超过 $0.01\,\mathrm{s}$；当物理子步超过 $0.01\,\mathrm{s}$ 后，速度与加速度等物理量会出现逐渐增大的偏差。因此，“每 $20\,\mathrm{ms}$ 推进一帧”并不表示物理引擎每 $20\,\mathrm{ms}$ 只计算一次，外层仿真步长与内部物理积分精度需要分别设置。

### 传感器采样、生成帧与到达时刻

每份[`SensorData`](https://carla.readthedocs.io/en/0.9.16/python_api/#carla.SensorData)都携带生成数据时的 `frame`、仿真时间 `timestamp` 和传感器位姿 `transform`。这些字段描述数据在仿真中生成的时刻，而不是客户端收到回调的真实时刻。

传感器还通过[`sensor_tick`](https://carla.readthedocs.io/en/0.9.16/ref_sensors/#rgb-camera)独立设置采样周期，单位为仿真秒。默认值 `0.0` 表示尽可能快地采样，相机等传感器通常在每个仿真步产生数据；非零值表示传感器不一定每一帧都有输出。世界以 50 Hz 推进，并不意味着设置为 `sensor_tick = 0.1` 的传感器也会以 50 Hz 输出。

数据的生成帧与到达顺序同样不能混为一谈。官方说明，[基于 GPU 的传感器数据通常会延迟数帧到达](https://carla.readthedocs.io/en/0.9.16/adv_synchrony_timestep/#using-synchronous-mode)，其中最常见的是相机。因而不能仅按回调顺序认定不同传感器的数据属于同一仿真时刻，而应使用 `frame` 对齐世界快照和各传感器数据。

CARLA 的[多传感器同步示例](https://github.com/carla-simulator/carla/blob/0.9.16/PythonAPI/examples/synchronous_mode.py)分别为世界快照和每个传感器建立队列。每次 `world.tick()` 返回后，示例从各队列中读取数据，跳过不属于目标帧的内容，并确认所有数据的 `frame` 都等于 tick 返回的 frame ID。不过，如果某个传感器的 `sensor_tick` 大于世界时间步长，它本来就不会在每一帧产生数据，此时不能无条件等待该传感器的同帧数据。

### 控制指令的生效帧

[`vehicle.apply_control()`](https://carla.readthedocs.io/en/0.9.16/python_api/#carla.Vehicle.apply_control)不会修改已经计算完成的当前帧，其官方语义是把控制量应用到下一次 tick。同步控制循环中的状态与控制关系因此可以写为：

```text
读取第 k 帧状态
    ↓
计算控制量 u(k)
    ↓
apply_control(u(k))
    ↓
world.tick()
    ↓
控制量在下一帧推进过程中生效
    ↓
得到第 k+1 帧
```

需要在同一个仿真步提交多条命令时，可以使用[`client.apply_batch_sync()`](https://carla.readthedocs.io/en/0.9.16/python_api/#carla.Client.apply_batch_sync)。它会阻塞等待批处理调用返回，并为每条命令返回成功或失败结果；`due_tick_cue` 用于决定提交命令后是否同时触发一次 `world.tick()`。

### 多客户端与 Traffic Manager

[多客户端场景中只能由一个客户端负责发送 tick](https://github.com/carla-simulator/carla/blob/0.9.16/Docs/adv_synchrony_timestep.md#L119-L120)。服务器不会区分 tick 来自哪个客户端，而会把每一个收到的 tick 都视为推进世界的信号；多个客户端同时发送 tick 会破坏服务器与客户端之间的帧对应关系。

如果仿真使用[`Traffic Manager`](https://carla.readthedocs.io/en/0.9.16/adv_traffic_manager/)，世界进入同步模式后，Traffic Manager 也必须进入同步模式，并由负责 world tick 的客户端进行设置。Traffic Manager 本身运行在客户端侧：它先缓存当前仿真状态，再依次完成定位、碰撞、交通规则、运动规划和车辆灯光等阶段；各阶段之间设有[同步屏障](https://carla.readthedocs.io/en/0.9.16/adv_traffic_manager/#control-loop)，所有受控车辆完成当前阶段后才进入下一阶段。最终控制命令被组成批次并在同一帧发送给服务器。Traffic Manager 的控制循环保证的是其内部各车辆和各处理阶段的帧一致性，并不替代世界同步或客户端的 tick 调度。

存在多个 Traffic Manager 时，只能有一个 [`TM-Server`](https://carla.readthedocs.io/en/0.9.16/adv_traffic_manager/#traffic-manager-servers-and-clients) 被设置为同步模式。[脚本结束前还应关闭世界与 Traffic Manager 的同步模式](https://carla.readthedocs.io/en/0.9.16/adv_traffic_manager/#synchronous-mode)，否则服务器会继续停在等待 tick 的状态。

### 确定性与记录重放

[物理与碰撞确定性](https://carla.readthedocs.io/en/0.9.16/adv_synchrony_timestep/#physics-determinism)和实时推进是不同问题。CARLA 为重复实验列出的条件包括：

- 启用同步模式与固定时间步长；
- 在加载或重新加载世界之前启用同步设置；
- 每次重复实验都重新加载世界；
- 使用批处理命令，而不是逐条发送命令；
- 使用 Traffic Manager 时同时启用其同步模式并[固定随机种子](https://carla.readthedocs.io/en/0.9.16/adv_traffic_manager/#deterministic-mode)，每次重新加载世界后重新设置种子。

如果仿真涉及行人死亡动画，[`deterministic_ragdolls`](https://carla.readthedocs.io/en/0.9.16/python_api/#carla.WorldSettings.deterministic_ragdolls)还会影响确定性：启用后使用确定性更强但视觉效果较弱的处理，关闭后采用更真实的物理布娃娃模拟，但官方不保证其确定性。

CARLA 的[记录与重放](https://carla.readthedocs.io/en/0.9.16/foundations/#recorder)也不等同于确定性。Recorder 保存 actor、交通灯和环境等状态并据此重放；确定性则要求在相同条件下重新执行脚本时得到相同结果。[可变时间步长的记录](https://carla.readthedocs.io/en/0.9.16/adv_synchrony_timestep/#tips-when-recording-the-simulation)在重放时还会受到时间步差异、插值和浮点累计误差的影响。

### 与真实时间同步的边界

在同步模式与固定时间步长下，客户端可以控制 tick 的真实发送时刻，但这种调度只有在每个周期内能够完成服务器计算、数据等待和客户端处理时才能持续。若单帧偶尔超时，后续周期可以根据累计相位误差进行补偿；若上述耗时长期超过目标周期，系统已没有可供调度的剩余时间，单靠周期补偿无法维持仿真时间与真实时间同步。

分析时间误差时，还需要明确比较的时基。仿真时间可以直接使用 `elapsed_seconds`，也可以在固定时间步长下由帧数计算；客户端真实时间则应在同一单调时钟下测量。相对起点的时间偏差可以表示为：

$$
e_k =
\left(t_{\mathrm{wall},k} - t_{\mathrm{wall},0}\right)
-
\left(t_{\mathrm{sim},k} - t_{\mathrm{sim},0}\right).
$$

这里需要分别观察单周期抖动、长期相位漂移、偶发超时与持续算力不足。同步模式解决谁推进仿真，固定时间步长解决每帧推进多少仿真时间，真实时间调度解决仿真时钟与真实时钟的相对进度，确定性则解决相同条件下能否重复得到相同结果，四者不能互相替代。

### 0.9.16 与 0.10.0 的实现边界

CARLA 0.9.16 与 0.10.0 在同步方式、时间步长、tick、物理子步、传感器帧、控制指令生效时机和确定性条件上的文档语义基本一致，但底层仿真实现并不相同。[CARLA 0.10.0 从 Unreal Engine 4.26 迁移到 Unreal Engine 5.5](https://carla.org/2024/12/19/release-0.10.0/)，并将车辆物理切换到 [Chaos 物理引擎](https://carla.org/2024/12/19/release-0.10.0/#upgraded-vehicle-roster)。因此，相同的时间推进 API 不代表两个版本会产生完全相同的车辆动力学结果。

[0.10.0 首发说明](https://carla.org/2024/12/19/release-0.10.0/#differences-between-carla-0915-and-0100)还记录了当时内部测试的峰值帧率约为 24–25 FPS，并明确指出性能仍在继续优化。这个数据只描述该版本发布时的特定内部测试结果，没有给出可推广到所有硬件、地图、传感器与负载组合的统一性能上限。

## 实时仿真

这项工作采用同步模式与固定时间步长，并在客户端进一步控制每次 tick 的实际发送时刻，使仿真时间与真实时间保持同步。一次 $20\,\mathrm{ms}$ 的仿真步可能只需要很短的真实时间完成，也可能因计算负载而耗时更长，因此不能仅凭 `fixed_delta_seconds = 0.02` 认定仿真已经按照真实时间运行。

周期调度不可避免地存在误差。即使目标周期固定为 $20\,\mathrm{ms}$，一次 tick 的实际触发时刻仍可能提前或滞后；如果后续周期不考虑已经产生的偏差，误差便可能在长期运行中不断累积。

这项工作通过统计每个周期中仿真时间与真实时间的偏差，并对后续调度进行动态补偿，避免单周期误差持续累积。在当时的运行结果中，单个时间步的时间偏差以及长时间运行后的总偏差均能维持在几十至几百微秒量级。该结果记录的是具体实现与运行环境下的实际表现，不作为其他系统的通用精度保证。

## 手柄控制

手柄控制原本就是运动控制框架中的一个组成模块。CARLA 接入完成后，同一模块可以通过新增的平台接口控制仿真车辆，因此，使用手柄驾驶 CARLA 车辆只是平台适配工作带来的附加能力。

<iframe
  src="https://player.bilibili.com/player.html?bvid=BV1dTy9BWE4v&p=1&autoplay=0"
  title="CARLA 手柄控制演示"
  width="1280"
  height="720"
  style="display: block; width: 100%; height: auto; aspect-ratio: 16 / 9; border: 0"
  scrolling="no"
  loading="lazy"
  referrerpolicy="strict-origin-when-cross-origin"
  allow="autoplay 'none'; fullscreen; picture-in-picture"
  allowfullscreen>
</iframe>
