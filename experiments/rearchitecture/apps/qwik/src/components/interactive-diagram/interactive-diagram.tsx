import { component$, useSignal } from "@builder.io/qwik";

/** Lightweight resumable control with an explicitly deferred heavy module. */
export const InteractiveDiagram = component$(() => {
  const curvature = useSignal(24);
  const heavyStatus = useSignal("尚未加载重型依赖");

  return (
    <figure class="diagram" data-interactive-diagram>
      <figcaption>局部弧长换算交互图（静态回退始终保留）</figcaption>
      <div class="diagram-stage" aria-hidden="true" />
      <label>
        参考曲率
        <input
          type="range"
          min="0"
          max="100"
          value={curvature.value}
          onInput$={(_, element) => {
            curvature.value = Number(element.value);
          }}
        />
        <output>{curvature.value}</output>
      </label>
      <p data-heavy-status>{heavyStatus.value}</p>
      <button
        type="button"
        onClick$={async () => {
          heavyStatus.value = "正在加载";
          const { describeHeavyRuntime } = await import(
            "../../runtime/heavy-placeholder"
          );
          heavyStatus.value = describeHeavyRuntime();
        }}
      >
        加载重型图形占位
      </button>
    </figure>
  );
});
