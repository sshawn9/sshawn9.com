type PlotlyApi = typeof import('plotly.js');

let plotlyPromise: Promise<PlotlyApi> | undefined;
let plotlyStyle: HTMLStyleElement | undefined;
let lifecycleInstalled = false;

function rememberStyle(): void {
  const current = document.getElementById('plotly.js-style-global');
  if (!(current instanceof HTMLStyleElement)) return;
  if (!current.textContent && current.sheet?.cssRules.length) {
    current.textContent = Array.from(current.sheet.cssRules, (rule) => rule.cssText).join('\n');
  }
  plotlyStyle = current;
}

function installLifecycle(): void {
  if (lifecycleInstalled) return;
  lifecycleInstalled = true;
  document.addEventListener('astro:after-swap', () => {
    if (plotlyStyle && !plotlyStyle.isConnected && document.querySelector('[data-plotly-figure]')) {
      document.head.append(plotlyStyle);
    }
  });
}

export async function loadPlotly(): Promise<PlotlyApi> {
  installLifecycle();
  plotlyPromise ??= import('plotly.js-gl3d-dist-min').then((module) => module.default);
  const plotly = await plotlyPromise;
  rememberStyle();
  if (plotlyStyle && !plotlyStyle.isConnected) document.head.append(plotlyStyle);
  return plotly;
}
