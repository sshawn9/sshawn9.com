import { Splitter } from '@ark-ui/solid/splitter';
import { Collapsible } from '@kobalte/core/collapsible';
import { NumberField } from '@kobalte/core/number-field';
import { Slider } from '@kobalte/core/slider';
import { ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-solid';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { Data, PlotlyHTMLElement, PlotMouseEvent } from 'plotly.js';
import * as m from '../../../paraglide/messages.js';
import { getLocale } from '../../../paraglide/runtime.js';
import {
  arcLengthRate,
  clamp,
  createInitialState,
  geometryPayload,
  VARIABLE_ORDER,
  VARIABLE_SPECS,
  type ExplorerState,
  type Parameters,
  type Range,
  type Variable,
} from './frenet-model';
import {
  DEFAULT_SPLIT_PERCENTAGE,
  buildGeometryFigure,
  buildMainFigure,
  readPlotTheme,
  selectedPointTrace,
  type FrenetPlotLabels,
  type MainPlotFigure,
} from './frenet-plot';

type PlotlyApi = typeof import('plotly.js');

let plotlyPromise: Promise<PlotlyApi> | undefined;
let plotlyStyleElement: HTMLStyleElement | undefined;
let plotlyStyleLifecycleInstalled = false;

function rememberPlotlyStyle(): void {
  const currentStyle = document.getElementById('plotly.js-style-global');
  if (!(currentStyle instanceof HTMLStyleElement)) return;
  if (!currentStyle.textContent && currentStyle.sheet?.cssRules.length) {
    currentStyle.textContent = Array.from(currentStyle.sheet.cssRules, (rule) => rule.cssText).join(
      '\n',
    );
  }
  plotlyStyleElement = currentStyle;
}

function installPlotlyStyleLifecycle(): void {
  if (plotlyStyleLifecycleInstalled) return;
  plotlyStyleLifecycleInstalled = true;
  document.addEventListener('astro:after-swap', () => {
    if (
      plotlyStyleElement &&
      !plotlyStyleElement.isConnected &&
      document.querySelector('.frenet-article-figure')
    ) {
      document.head.append(plotlyStyleElement);
    }
  });
}

async function loadPlotly(): Promise<PlotlyApi> {
  installPlotlyStyleLifecycle();
  plotlyPromise ??= import('plotly.js-gl3d-dist-min').then((module) => module.default);
  const plotly = await plotlyPromise;
  rememberPlotlyStyle();
  if (plotlyStyleElement && !plotlyStyleElement.isConnected)
    document.head.append(plotlyStyleElement);
  return plotly;
}

type Props = {
  axes: Variable[];
  contentLocale?: ContentLocale;
};

type ContentLocale = ReturnType<typeof getLocale>;

const SPLITTER_PANELS = [
  { id: 'relation', minSize: 48 },
  { id: 'geometry', minSize: 28 },
];

const INITIAL_SPLIT_SIZES = [DEFAULT_SPLIT_PERCENTAGE, 100 - DEFAULT_SPLIT_PERCENTAGE];

type ScalarControlProps = {
  variable: Variable;
  label: string;
  value: number;
  bounds: Range;
  onChange: (value: number) => void;
};

const ScalarControl: Component<ScalarControlProps> = (props) => {
  const spec = () => VARIABLE_SPECS[props.variable];
  return (
    <div class="frenet-control" data-frenet-control={props.variable}>
      <Slider
        class="frenet-slider"
        value={[props.value]}
        minValue={props.bounds[0]}
        maxValue={props.bounds[1]}
        step={spec().step}
        onChange={(values) => props.onChange(values[0] ?? props.value)}
        getValueLabel={({ values }) => (values[0] ?? props.value).toFixed(spec().digits)}
      >
        <div class="frenet-control-heading">
          <Slider.Label>{props.label}</Slider.Label>
          <Slider.ValueLabel as="output" class="frenet-slider-value" />
        </div>
        <Slider.Track class="frenet-slider-track">
          <Slider.Fill class="frenet-slider-fill" />
          <Slider.Thumb class="frenet-slider-thumb">
            <Slider.Input />
          </Slider.Thumb>
        </Slider.Track>
        <div class="frenet-slider-bounds" aria-hidden="true">
          <span>{props.bounds[0].toFixed(spec().digits)}</span>
          <span>{props.bounds[1].toFixed(spec().digits)}</span>
        </div>
      </Slider>
    </div>
  );
};

type RangeControlProps = {
  label: string;
  values: Range;
  bounds: Range;
  step: number;
  digits: number;
  name: string;
  onChange: (range: Range) => void;
};

const RangeControl: Component<RangeControlProps> = (props) => (
  <div class="frenet-control" data-frenet-control={props.name}>
    <Slider
      class="frenet-slider"
      value={props.values}
      minValue={props.bounds[0]}
      maxValue={props.bounds[1]}
      step={props.step}
      minStepsBetweenThumbs={1}
      onChange={(values) =>
        props.onChange([values[0] ?? props.values[0], values[1] ?? props.values[1]])
      }
      getValueLabel={({ values }) =>
        `${(values[0] ?? props.values[0]).toFixed(props.digits)} – ${(values[1] ?? props.values[1]).toFixed(props.digits)}`
      }
    >
      <div class="frenet-control-heading">
        <Slider.Label>{props.label}</Slider.Label>
        <Slider.ValueLabel as="output" class="frenet-slider-value" />
      </div>
      <Slider.Track class="frenet-slider-track">
        <Slider.Fill class="frenet-slider-fill" />
        <Slider.Thumb class="frenet-slider-thumb">
          <Slider.Input />
        </Slider.Thumb>
        <Slider.Thumb class="frenet-slider-thumb">
          <Slider.Input />
        </Slider.Thumb>
      </Slider.Track>
      <div class="frenet-slider-bounds" aria-hidden="true">
        <span>{props.bounds[0].toFixed(props.digits)}</span>
        <span>{props.bounds[1].toFixed(props.digits)}</span>
      </div>
    </Slider>
  </div>
);

type BoundsEditorProps = {
  label: string;
  locale: ContentLocale;
  bounds: Range;
  step: number;
  onCommit: (bounds: Range) => void;
};

const BoundsEditor: Component<BoundsEditorProps> = (props) => {
  const [lower, setLower] = createSignal(props.bounds[0]);
  const [upper, setUpper] = createSignal(props.bounds[1]);
  const valid = () => Number.isFinite(lower()) && Number.isFinite(upper()) && lower() < upper();
  createEffect(() => {
    setLower(props.bounds[0]);
    setUpper(props.bounds[1]);
  });
  const commit = () => {
    if (valid()) props.onCommit([lower(), upper()]);
    else {
      setLower(props.bounds[0]);
      setUpper(props.bounds[1]);
    }
  };

  return (
    <fieldset class="frenet-bounds-row">
      <legend>{props.label}</legend>
      <NumberField
        rawValue={lower()}
        onRawValueChange={setLower}
        step={props.step}
        changeOnWheel
        format={false}
      >
        <NumberField.Input
          aria-label={m.frenet_minimum_value({ label: props.label }, { locale: props.locale })}
          onBlur={commit}
          onKeyDown={(event) => event.key === 'Enter' && commit()}
        />
      </NumberField>
      <span aria-hidden="true">—</span>
      <NumberField
        rawValue={upper()}
        onRawValueChange={setUpper}
        step={props.step}
        changeOnWheel
        format={false}
      >
        <NumberField.Input
          aria-label={m.frenet_maximum_value({ label: props.label }, { locale: props.locale })}
          onBlur={commit}
          onKeyDown={(event) => event.key === 'Enter' && commit()}
        />
      </NumberField>
    </fieldset>
  );
};

const FrenetExplorer: Component<Props> = (props) => {
  const axes = [...props.axes];
  const uiLocale = getLocale();
  const uiLanguageTag = uiLocale === 'zh' ? 'zh-CN' : 'en';
  const contentLocale = props.contentLocale ?? 'en';
  const contentLanguageTag = contentLocale === 'zh' ? 'zh-CN' : 'en';
  const variableTitles: Record<Variable, string> = {
    phi: m.frenet_phi_title({}, { locale: contentLocale }),
    d: m.frenet_d_title({}, { locale: contentLocale }),
    kappa: m.frenet_kappa_title({}, { locale: contentLocale }),
  };
  const plotLabels: FrenetPlotLabels = {
    variables: variableTitles,
    relationCurve: m.frenet_relation_curve_title({}, { locale: contentLocale }),
    relationSurface: m.frenet_relation_surface_title({}, { locale: contentLocale }),
    geometry: m.frenet_geometry_title({}, { locale: contentLocale }),
  };
  const [state, setState] = createStore<ExplorerState>(createInitialState(axes));
  const [status, setStatus] = createSignal<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = createSignal('');
  const [compact, setCompact] = createSignal(false);
  let rootElement!: HTMLDivElement;
  let mainPlotElement!: HTMLDivElement;
  let geometryPlotElement!: HTMLDivElement;
  let mainPlot: PlotlyHTMLElement | undefined;
  let geometryPlot: PlotlyHTMLElement | undefined;
  let mainFigure: MainPlotFigure | undefined;
  let plotly: PlotlyApi | undefined;
  let intersectionObserver: IntersectionObserver | undefined;
  let resolveVisibility: (() => void) | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let themeObserver: MutationObserver | undefined;
  let destroyed = false;
  let frame = 0;
  let rendering = false;
  let dirtyFigure = true;
  let pendingSelection: Parameters | undefined;
  let dirtyResize = false;
  let mainViewRevision = 0;
  let observedWidth = 0;

  const fixedVariables = VARIABLE_ORDER.filter((variable) => !axes.includes(variable));
  const rate = createMemo(() =>
    arcLengthRate(state.selected.phi, state.selected.d, state.selected.kappa),
  );
  const statusText = createMemo(() => {
    const value = rate();
    return `φ=${state.selected.phi.toFixed(2)}°, d=${state.selected.d.toFixed(4)}, κᵣ=${state.selected.kappa.toFixed(4)}, dℓ/ds=${value === null ? m.frenet_undefined({}, { locale: contentLocale }) : value.toFixed(4)}`;
  });

  const schedule = () => {
    if (destroyed || frame || rendering || !plotly || !mainPlot || !geometryPlot) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      void flush();
    });
  };

  const invalidateFigure = () => {
    dirtyFigure = true;
    schedule();
  };

  const resizePlots = () => {
    dirtyResize = true;
    if (!rendering) void flush();
  };

  const invalidateSelection = () => {
    pendingSelection = { ...state.selected };
    if (!frame && !rendering) void flush();
  };

  const flush = async () => {
    if (destroyed || rendering || !plotly || !mainPlot || !geometryPlot) return;
    rendering = true;
    try {
      if (dirtyFigure) {
        dirtyFigure = false;
        pendingSelection = undefined;
        const theme = readPlotTheme(rootElement);
        mainFigure = buildMainFigure(state, theme, plotLabels, mainViewRevision);
        const geometryFigure = buildGeometryFigure(state, theme, plotLabels);
        await plotly.react(mainPlot, mainFigure.data, mainFigure.layout, mainFigure.config);
        await plotly.react(
          geometryPlot,
          geometryFigure.data,
          geometryFigure.layout,
          geometryFigure.config,
        );
      } else if (pendingSelection) {
        const selection = pendingSelection;
        pendingSelection = undefined;
        if (!mainFigure) throw new Error('Missing main plot figure.');
        const payload = geometryPayload(selection);
        const updates: Array<Promise<unknown>> = [
          plotly.restyle(
            geometryPlot,
            {
              x: payload.map((trace) => trace.x),
              y: payload.map((trace) => trace.y),
              text: payload.map((trace) => trace.text),
            } as unknown as Data,
            payload.map((_, index) => index),
          ),
        ];
        if (mainFigure.selectedTraceIndex !== undefined) {
          const selected = selectedPointTrace({ axes, selected: selection });
          updates.push(
            plotly.restyle(mainPlot, { x: [selected.x], y: [selected.y] } as unknown as Data, [
              mainFigure.selectedTraceIndex,
            ]),
          );
        }
        await Promise.all(updates);
      }
      if (dirtyResize) {
        dirtyResize = false;
        await Promise.all([
          plotly.relayout(mainPlot, { autosize: true }),
          plotly.relayout(geometryPlot, { autosize: true }),
        ]);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setStatus('error');
    } finally {
      rendering = false;
      if (dirtyFigure) schedule();
      else if (dirtyResize || pendingSelection) void flush();
    }
  };

  const setParameter = (variable: Variable, value: number) => {
    const [lower, upper] = state.bounds[variable];
    const next = clamp(value, lower, upper);
    setState('parameters', variable, next);
    setState('selected', variable, next);
    invalidateFigure();
  };

  const setAxisRange = (variable: Variable, range: Range) => {
    setState('ranges', variable, range);
    setState('selected', variable, clamp(state.selected[variable], range[0], range[1]));
    invalidateFigure();
  };

  const setRateRange = (range: Range) => {
    setState('rateRange', range);
    invalidateFigure();
  };

  const setBounds = (key: Variable | 'rate', bounds: Range) => {
    if (key === 'rate') {
      setState('rateBounds', bounds);
      const nextRange: Range = [
        clamp(state.rateRange[0], bounds[0], bounds[1]),
        clamp(state.rateRange[1], bounds[0], bounds[1]),
      ];
      setState('rateRange', nextRange[0] < nextRange[1] ? nextRange : [...bounds]);
    } else {
      setState('bounds', key, bounds);
      setState('parameters', key, clamp(state.parameters[key], bounds[0], bounds[1]));
      setState('selected', key, clamp(state.selected[key], bounds[0], bounds[1]));
      const range = state.ranges[key];
      if (range) {
        const nextRange: Range = [
          clamp(range[0], bounds[0], bounds[1]),
          clamp(range[1], bounds[0], bounds[1]),
        ];
        setState('ranges', key, nextRange[0] < nextRange[1] ? nextRange : [...bounds]);
      }
    }
    invalidateFigure();
  };

  const reset = () => {
    setState(reconcile(createInitialState(axes)));
    mainViewRevision += 1;
    invalidateFigure();
  };

  const selectFromPlot = (event: PlotMouseEvent) => {
    const point = event.points[0];
    if (!point || point.curveNumber !== 0) return;
    const [xVariable, yVariable] = axes;
    if (xVariable) setState('selected', xVariable, Number(point.x));
    if (yVariable) setState('selected', yVariable, Number(point.y));
    invalidateSelection();
  };

  const waitUntilNearViewport = () =>
    new Promise<void>((resolve) => {
      resolveVisibility = resolve;
      if (typeof IntersectionObserver === 'undefined') {
        resolveVisibility = undefined;
        resolve();
        return;
      }
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          intersectionObserver?.disconnect();
          intersectionObserver = undefined;
          resolveVisibility = undefined;
          resolve();
        },
        { rootMargin: '600px 0px' },
      );
      intersectionObserver.observe(rootElement);
    });

  onMount(async () => {
    try {
      await waitUntilNearViewport();
      if (destroyed) return;
      plotly = await loadPlotly();
      if (destroyed) return;
      setCompact(rootElement.clientWidth < 720);
      const theme = readPlotTheme(rootElement);
      mainFigure = buildMainFigure(state, theme, plotLabels, mainViewRevision);
      const geometryFigure = buildGeometryFigure(state, theme, plotLabels);
      mainPlot = await plotly.newPlot(
        mainPlotElement,
        mainFigure.data,
        mainFigure.layout,
        mainFigure.config,
      );
      geometryPlot = await plotly.newPlot(
        geometryPlotElement,
        geometryFigure.data,
        geometryFigure.layout,
        geometryFigure.config,
      );
      if (destroyed) return;
      dirtyFigure = false;
      setStatus('ready');

      mainPlot.on('plotly_hover', selectFromPlot);
      mainPlot.on('plotly_click', selectFromPlot);

      resizeObserver = new ResizeObserver((entries) => {
        let plotsChangedSize = false;
        for (const entry of entries) {
          if (entry.target === rootElement) {
            const width = entry.contentRect.width;
            if (Math.abs(width - observedWidth) >= 1) {
              observedWidth = width;
              setCompact(width < 720);
            }
          } else {
            plotsChangedSize = true;
          }
        }
        if (plotsChangedSize) resizePlots();
      });
      observedWidth = rootElement.getBoundingClientRect().width;
      resizeObserver.observe(rootElement);
      resizeObserver.observe(mainPlotElement);
      resizeObserver.observe(geometryPlotElement);

      themeObserver = new MutationObserver(() => invalidateFigure());
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setStatus('error');
    }
  });

  onCleanup(() => {
    destroyed = true;
    if (frame) cancelAnimationFrame(frame);
    resolveVisibility?.();
    resolveVisibility = undefined;
    intersectionObserver?.disconnect();
    resizeObserver?.disconnect();
    themeObserver?.disconnect();
    if (mainPlot && plotly) {
      mainPlot.removeAllListeners('plotly_hover');
      mainPlot.removeAllListeners('plotly_click');
      plotly.purge(mainPlot);
    }
    if (geometryPlot && plotly) plotly.purge(geometryPlot);
  });

  return (
    <section
      class="frenet-explorer"
      ref={rootElement}
      data-frenet-explorer={axes.join('-')}
      data-frenet-dimensions={axes.length}
      data-pagefind-ignore
      aria-label={m.frenet_interactive_figure(
        {
          axes: new Intl.ListFormat(contentLanguageTag, {
            style: 'short',
            type: 'conjunction',
          }).format(axes.map((axis) => variableTitles[axis])),
        },
        { locale: contentLocale },
      )}
    >
      <div class="frenet-controls">
        <For each={fixedVariables}>
          {(variable) => (
            <ScalarControl
              variable={variable}
              label={variableTitles[variable]}
              value={state.parameters[variable]}
              bounds={state.bounds[variable]}
              onChange={(value) => setParameter(variable, value)}
            />
          )}
        </For>
        <For each={axes}>
          {(variable) => (
            <RangeControl
              name={`${variable}-range`}
              label={m.frenet_range({ label: variableTitles[variable] }, { locale: contentLocale })}
              values={state.ranges[variable]!}
              bounds={state.bounds[variable]}
              step={VARIABLE_SPECS[variable].step}
              digits={VARIABLE_SPECS[variable].digits}
              onChange={(range) => setAxisRange(variable, range)}
            />
          )}
        </For>
        <RangeControl
          name="rate-range"
          label={m.frenet_rate_range({}, { locale: contentLocale })}
          values={state.rateRange}
          bounds={state.rateBounds}
          step={0.001}
          digits={3}
          onChange={setRateRange}
        />

        <div class="frenet-control-actions">
          <Collapsible class="frenet-advanced">
            <Collapsible.Trigger class="frenet-advanced-trigger" lang={uiLanguageTag}>
              <SlidersHorizontal aria-hidden="true" />
              {m.frenet_absolute_ranges({}, { locale: uiLocale })}
              <ChevronDown class="frenet-chevron" aria-hidden="true" />
            </Collapsible.Trigger>
            <Collapsible.Content class="frenet-advanced-content">
              <For each={VARIABLE_ORDER}>
                {(variable) => (
                  <BoundsEditor
                    label={variableTitles[variable]}
                    locale={contentLocale}
                    bounds={state.bounds[variable]}
                    step={VARIABLE_SPECS[variable].step}
                    onCommit={(bounds) => setBounds(variable, bounds)}
                  />
                )}
              </For>
              <BoundsEditor
                label="dℓ/ds"
                locale={contentLocale}
                bounds={state.rateBounds}
                step={0.001}
                onCommit={(bounds) => setBounds('rate', bounds)}
              />
            </Collapsible.Content>
          </Collapsible>
          <button class="frenet-reset" type="button" lang={uiLanguageTag} onClick={reset}>
            <RotateCcw aria-hidden="true" />
            {m.frenet_reset({}, { locale: uiLocale })}
          </button>
        </div>
      </div>

      <output class="frenet-status" data-frenet-status>
        {statusText()}
      </output>
      <div class="frenet-plot-shell" aria-busy={status() === 'loading'}>
        <Splitter.Root
          class="frenet-plot-splitter"
          style={{ width: '100%', height: '100%' }}
          orientation={compact() ? 'vertical' : 'horizontal'}
          panels={SPLITTER_PANELS}
          defaultSize={INITIAL_SPLIT_SIZES}
          keyboardResizeBy={16}
        >
          <Splitter.Panel id="relation" class="frenet-split-panel frenet-main-panel">
            <div class="frenet-plot frenet-main-plot" ref={mainPlotElement} />
          </Splitter.Panel>
          <Show when={!compact()}>
            <Splitter.ResizeTrigger
              id="relation:geometry"
              class="frenet-split-trigger"
              lang={uiLanguageTag}
              aria-label={m.frenet_splitter_label({}, { locale: uiLocale })}
            >
              <Splitter.ResizeTriggerIndicator class="frenet-split-indicator" />
            </Splitter.ResizeTrigger>
          </Show>
          <Splitter.Panel id="geometry" class="frenet-split-panel frenet-geometry-panel">
            <div class="frenet-plot frenet-geometry-plot" ref={geometryPlotElement} />
          </Splitter.Panel>
        </Splitter.Root>
        <Show when={status() === 'loading'}>
          <div class="frenet-plot-message" role="status" lang={uiLanguageTag}>
            {m.frenet_loading({}, { locale: uiLocale })}
          </div>
        </Show>
        <Show when={status() === 'error'}>
          <div class="frenet-plot-message frenet-plot-error" role="alert" lang={uiLanguageTag}>
            {m.frenet_error({ message: errorMessage() }, { locale: uiLocale })}
          </div>
        </Show>
      </div>
    </section>
  );
};

export default FrenetExplorer;
