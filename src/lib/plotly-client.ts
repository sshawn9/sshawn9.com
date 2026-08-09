import type { TransitionBeforeSwapEvent } from 'astro:transitions/client';

type PlotlyApi = typeof import('plotly.js');

const PLOTLY_STYLE_ID = 'plotly.js-style-global';

let plotlyPromise: Promise<PlotlyApi> | undefined;
let plotlyStyleText = '';
let lifecycleInstalled = false;

function rememberStyle(): void {
  const current = document.getElementById(PLOTLY_STYLE_ID);
  if (!(current instanceof HTMLStyleElement)) return;
  const cssText =
    current.textContent ||
    (current.sheet?.cssRules.length
      ? Array.from(current.sheet.cssRules, (rule) => rule.cssText).join('\n')
      : '');
  if (!cssText) return;
  current.textContent = cssText;
  plotlyStyleText = cssText;
}

function installStyle(target: Document): void {
  if (!plotlyStyleText) return;
  const current = target.getElementById(PLOTLY_STYLE_ID);
  if (current instanceof HTMLStyleElement) {
    if (!current.textContent) current.textContent = plotlyStyleText;
    return;
  }
  const style = target.createElement('style');
  style.id = PLOTLY_STYLE_ID;
  style.textContent = plotlyStyleText;
  target.head.append(style);
}

function installLifecycle(): void {
  if (lifecycleInstalled) return;
  lifecycleInstalled = true;
  document.addEventListener('astro:before-swap', (event) => {
    installStyle((event as TransitionBeforeSwapEvent).newDocument);
  });
}

export async function loadPlotly(): Promise<PlotlyApi> {
  installLifecycle();
  plotlyPromise ??= import('plotly.js-gl3d-dist-min').then((module) => module.default);
  const plotly = await plotlyPromise;
  rememberStyle();
  installStyle(document);
  return plotly;
}
