<script lang="ts">
  import { onDestroy } from "svelte";
  import { createDeferredModule } from "../runtime/deferred-module";

  let curvature = $state(24);
  let heavyState = $state<"idle" | "loading" | "ready" | "failed">("idle");
  let heavyStatus = $state("交互增强尚未加载；静态示意图仍可阅读。");

  const heavyRuntime = createDeferredModule(
    async () => {
      const { describeHeavyRuntime } = await import("../runtime/heavy-placeholder");
      return describeHeavyRuntime();
    },
    (state) => {
      heavyState = state.status;
      if (state.status === "loading") {
        heavyStatus = "正在加载交互增强；静态示意图仍可阅读。";
      } else if (state.status === "ready") {
        heavyStatus = state.value;
      } else {
        heavyStatus = "交互增强加载失败；静态示意图仍可阅读。";
      }
    },
  );

  onDestroy(() => heavyRuntime.dispose());

  function loadHeavyRuntime() {
    void heavyRuntime.load();
  }
</script>

<figure class="diagram" data-interactive-diagram>
  <figcaption>局部弧长换算交互图（静态回退始终保留）</figcaption>
  <div class="diagram-stage" aria-hidden="true"></div>
  <label>
    参考曲率
    <input type="range" min="0" max="100" bind:value={curvature} />
    <output>{curvature}</output>
  </label>
  <p data-heavy-status>{heavyStatus}</p>
  <button type="button" onclick={loadHeavyRuntime} disabled={heavyState !== "idle"}>
    {heavyState === "ready"
      ? "交互增强已加载"
      : heavyState === "failed"
        ? "交互增强不可用"
        : "加载重型图形占位"}
  </button>
</figure>
