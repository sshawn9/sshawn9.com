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
import { loadPlotly } from '../../../lib/plotly-client';
import * as m from '../../../paraglide/messages.js';
import { getLocale } from '../../../paraglide/runtime.js';
import { whenTypographyReady } from '../../../scripts/typography-controller';
import {
  clamp,
  createInitialState,
  GEOMETRY_TRACE_KEYS,
  geometryPayload,
  geometryViewRanges,
  isCoordinateDegenerate,
  quantityValue,
  VARIABLE_ORDER,
  VARIABLE_SPECS,
  type AnalysisQuantity,
  type CurvatureSign,
  type ExplorerState,
  type Parameters,
  type Range,
  type Variable,
} from './frenet-model';
import {
  DEFAULT_SPLIT_PERCENTAGE,
  buildGeometryFigure,
  buildMainFigure,
  geometryViewportLayout,
  readPlotTheme,
  selectedPointTrace,
  type FrenetPlotLabels,
  type MainPlotFigure,
} from './frenet-plot';

type PlotlyApi = typeof import('plotly.js');

type Props = {
  axes: Variable[];
  contentLocale?: ContentLocale;
  quantity?: AnalysisQuantity;
  curvatureSign?: CurvatureSign;
};

type ContentLocale = ReturnType<typeof getLocale>;

const INITIAL_SPLIT_SIZES = [DEFAULT_SPLIT_PERCENTAGE, 100 - DEFAULT_SPLIT_PERCENTAGE];
const SPLITTER_PANELS = [
  { id: 'relation', minSize: 48 },
  { id: 'geometry', minSize: INITIAL_SPLIT_SIZES[1] },
];

type ScalarControlProps = {
  variable: Variable;
  label: string;
  value: number;
  bounds: Range;
  onChange: (value: number) => void;
};

const ScalarControl: Component<ScalarControlProps> = (props) => {
  const spec = () => VARIABLE_SPECS[props.variable];
  const [draftValue, setDraftValue] = createSignal([props.value]);
  createEffect(() => setDraftValue([props.value]));
  return (
    <div
      class="frenet-control frenet-scalar-control"
      data-frenet-control={props.variable}
      data-frenet-control-kind="condition"
    >
      <Slider
        class="frenet-slider"
        value={draftValue()}
        minValue={props.bounds[0]}
        maxValue={props.bounds[1]}
        step={spec().step}
        onChange={(values) => {
          setDraftValue(values);
          props.onChange(values[0] ?? props.value);
        }}
        getValueLabel={({ values }) => (values[0] ?? props.value).toFixed(spec().digits)}
      >
        <div class="frenet-control-heading">
          <Slider.Label classList={{ 'frenet-math-label': props.label.includes('φ') }}>
            {props.label}
          </Slider.Label>
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

const RangeControl: Component<RangeControlProps> = (props) => {
  const [draftValues, setDraftValues] = createSignal<Range>([...props.values]);
  createEffect(() => setDraftValues([...props.values]));
  return (
    <div class="frenet-control" data-frenet-control={props.name}>
      <Slider
        class="frenet-slider"
        value={draftValues()}
        minValue={props.bounds[0]}
        maxValue={props.bounds[1]}
        step={props.step}
        minStepsBetweenThumbs={1}
        onChange={(values) => {
          const range: Range = [values[0] ?? props.values[0], values[1] ?? props.values[1]];
          setDraftValues(range);
          props.onChange(range);
        }}
        getValueLabel={({ values }) =>
          `${(values[0] ?? props.values[0]).toFixed(props.digits)} – ${(values[1] ?? props.values[1]).toFixed(props.digits)}`
        }
      >
        <div class="frenet-control-heading">
          <Slider.Label classList={{ 'frenet-math-label': props.label.includes('φ') }}>
            {props.label}
          </Slider.Label>
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
};

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
      <legend classList={{ 'frenet-math-label': props.label.includes('φ') }}>{props.label}</legend>
      <NumberField rawValue={lower()} onRawValueChange={setLower} step={props.step} changeOnWheel>
        <NumberField.Input
          aria-label={m.frenet_minimum_value({ label: props.label }, { locale: props.locale })}
          onBlur={commit}
          onKeyDown={(event) => event.key === 'Enter' && commit()}
        />
      </NumberField>
      <span aria-hidden="true">—</span>
      <NumberField rawValue={upper()} onRawValueChange={setUpper} step={props.step} changeOnWheel>
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
  const quantity = props.quantity ?? 'arc-length-rate';
  const initialStateOptions = { quantity, curvatureSign: props.curvatureSign };
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
    quantity: quantity === 'coordinate-scale' ? '1 − dκᵣ' : 'dℓ/ds',
    relationCurve:
      quantity === 'coordinate-scale'
        ? m.frenet_coordinate_scale_curve_title({}, { locale: contentLocale })
        : m.frenet_relation_curve_title({}, { locale: contentLocale }),
    relationSurface: m.frenet_relation_surface_title({}, { locale: contentLocale }),
  };
  const [state, setState] = createStore<ExplorerState>(
    createInitialState(axes, initialStateOptions),
  );
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
  let dirtyMainFigure = true;
  let dirtyGeometryFigure = true;
  let dirtyGeometryData = false;
  let pendingSelection: Parameters | undefined;
  let dirtyResize = false;
  let mainViewRevision = 0;
  let observedWidth = 0;

  const relevantVariables =
    quantity === 'coordinate-scale' ? (['d', 'kappa'] as Variable[]) : VARIABLE_ORDER;
  const fixedVariables = relevantVariables.filter((variable) => !axes.includes(variable));
  const axisRangeLabel = (variable: Variable, index: number) => {
    const label = variableTitles[variable];
    if (axes.length === 1) {
      return m.frenet_horizontal_axis_range({ label }, { locale: contentLocale });
    }
    return index === 0
      ? m.frenet_x_axis_range({ label }, { locale: contentLocale })
      : m.frenet_y_axis_range({ label }, { locale: contentLocale });
  };
  const outputLabel = plotLabels.quantity;
  const outputRangeLabel =
    axes.length === 1
      ? m.frenet_vertical_axis_range({ label: outputLabel }, { locale: contentLocale })
      : m.frenet_z_axis_range({ label: outputLabel }, { locale: contentLocale });
  const outputValue = createMemo(() => quantityValue(quantity, state.selected));
  const statusText = createMemo(() => {
    const value = outputValue();
    const degeneracy = isCoordinateDegenerate(state.selected.d, state.selected.kappa)
      ? ` · ${m.frenet_coordinate_degeneracy({}, { locale: contentLocale })}`
      : '';
    if (quantity === 'coordinate-scale') {
      const radius = 1 / state.selected.kappa;
      return `d=${state.selected.d.toFixed(4)}, κᵣ=${state.selected.kappa.toFixed(4)}, ρᵣ=${radius.toFixed(4)}, 1−dκᵣ=${value?.toFixed(4)}${degeneracy}`;
    }
    return `φ=${state.selected.phi.toFixed(2)}°, d=${state.selected.d.toFixed(4)}, κᵣ=${state.selected.kappa.toFixed(4)}, dℓ/ds=${value === null ? m.frenet_undefined({}, { locale: contentLocale }) : value.toFixed(4)}${degeneracy}`;
  });

  const schedule = () => {
    if (destroyed || frame || rendering || !plotly || !mainPlot || !geometryPlot) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      void flush();
    });
  };

  const invalidateMainFigure = (geometryChanged = false) => {
    dirtyMainFigure = true;
    if (geometryChanged) dirtyGeometryData = true;
    schedule();
  };

  const invalidateAllFigures = () => {
    dirtyMainFigure = true;
    dirtyGeometryFigure = true;
    dirtyGeometryData = false;
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
      if (dirtyMainFigure || dirtyGeometryFigure || dirtyGeometryData) {
        const updates: Array<Promise<unknown>> = [];
        pendingSelection = undefined;
        const theme = readPlotTheme(rootElement);
        if (dirtyMainFigure) {
          dirtyMainFigure = false;
          mainFigure = buildMainFigure(state, theme, plotLabels, mainViewRevision);
          updates.push(
            plotly.react(mainPlot, mainFigure.data, mainFigure.layout, mainFigure.config),
          );
        }
        if (dirtyGeometryFigure) {
          dirtyGeometryFigure = false;
          dirtyGeometryData = false;
          const geometryFigure = buildGeometryFigure(state, theme);
          updates.push(
            plotly.react(
              geometryPlot,
              geometryFigure.data,
              geometryFigure.layout,
              geometryFigure.config,
            ),
          );
        } else if (dirtyGeometryData) {
          dirtyGeometryData = false;
          const payload = geometryPayload(
            state.selected,
            geometryViewRanges(state),
            quantity === 'coordinate-scale',
          );
          const traces = GEOMETRY_TRACE_KEYS.map((key) => payload[key]);
          updates.push(
            plotly.restyle(
              geometryPlot,
              {
                x: traces.map((trace) => trace.x),
                y: traces.map((trace) => trace.y),
                text: traces.map((trace) => trace.text),
              } as unknown as Data,
              GEOMETRY_TRACE_KEYS.map((_, index) => index),
            ),
          );
        }
        await Promise.all(updates);
      } else if (pendingSelection) {
        const selection = pendingSelection;
        pendingSelection = undefined;
        if (!mainFigure) throw new Error('Missing main plot figure.');
        const payload = geometryPayload(
          selection,
          geometryViewRanges(state),
          quantity === 'coordinate-scale',
        );
        const traces = GEOMETRY_TRACE_KEYS.map((key) => payload[key]);
        const updates: Array<Promise<unknown>> = [
          plotly.restyle(
            geometryPlot,
            {
              x: traces.map((trace) => trace.x),
              y: traces.map((trace) => trace.y),
              text: traces.map((trace) => trace.text),
            } as unknown as Data,
            GEOMETRY_TRACE_KEYS.map((_, index) => index),
          ),
        ];
        if (mainFigure.selectedTraceIndex !== undefined) {
          const selected = selectedPointTrace({ axes, quantity, selected: selection });
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
        const geometryView = geometryViewRanges(state);
        await Promise.all([
          plotly.relayout(mainPlot, { autosize: true }),
          plotly.relayout(geometryPlot, {
            autosize: true,
            ...geometryViewportLayout(geometryView),
          }),
        ]);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setStatus('error');
    } finally {
      rendering = false;
      if (dirtyMainFigure || dirtyGeometryFigure || dirtyGeometryData) schedule();
      else if (dirtyResize || pendingSelection) void flush();
    }
  };

  const setParameter = (variable: Variable, value: number) => {
    const [lower, upper] = state.bounds[variable];
    const next = clamp(value, lower, upper);
    setState('parameters', variable, next);
    setState('selected', variable, next);
    invalidateMainFigure(true);
  };

  const setAxisRange = (variable: Variable, range: Range) => {
    const previousSelection = state.selected[variable];
    setState('ranges', variable, range);
    setState('selected', variable, clamp(state.selected[variable], range[0], range[1]));
    invalidateMainFigure(state.selected[variable] !== previousSelection);
  };

  const setOutputRange = (range: Range) => {
    setState('valueRange', range);
    invalidateMainFigure();
  };

  const setBounds = (key: Variable | 'output', bounds: Range) => {
    if (key === 'output') {
      setState('valueBounds', bounds);
      const nextRange: Range = [
        clamp(state.valueRange[0], bounds[0], bounds[1]),
        clamp(state.valueRange[1], bounds[0], bounds[1]),
      ];
      setState('valueRange', nextRange[0] < nextRange[1] ? nextRange : [...bounds]);
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
    invalidateAllFigures();
  };

  const reset = () => {
    setState(reconcile(createInitialState(axes, initialStateOptions)));
    mainViewRevision += 1;
    invalidateAllFigures();
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
      await whenTypographyReady();
      if (destroyed) return;
      plotly = await loadPlotly();
      if (destroyed) return;
      setCompact(rootElement.clientWidth < 720);
      const theme = readPlotTheme(rootElement);
      mainFigure = buildMainFigure(state, theme, plotLabels, mainViewRevision);
      const geometryFigure = buildGeometryFigure(state, theme);
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
      dirtyMainFigure = false;
      dirtyGeometryFigure = false;
      dirtyGeometryData = false;
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

      themeObserver = new MutationObserver(() => invalidateAllFigures());
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
      data-frenet-quantity={quantity}
      data-frenet-curvature-sign={props.curvatureSign}
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
        <div class="frenet-controls-toolbar">
          <span class="frenet-controls-title" lang={contentLanguageTag}>
            {m.frenet_controls_title({}, { locale: contentLocale })}
          </span>
          <button class="frenet-reset" type="button" lang={uiLanguageTag} onClick={reset}>
            <RotateCcw aria-hidden="true" />
            {m.frenet_reset({}, { locale: uiLocale })}
          </button>
        </div>

        <Show when={axes.length === 1}>
          <fieldset class="frenet-control-group" data-frenet-control-group="conditions">
            <legend lang={contentLanguageTag}>
              {m.frenet_experiment_conditions({}, { locale: contentLocale })}
            </legend>
            <div
              class="frenet-condition-controls"
              data-frenet-control-count={fixedVariables.length}
            >
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
            </div>
          </fieldset>
        </Show>

        <fieldset class="frenet-control-group" data-frenet-control-group="window">
          <legend lang={contentLanguageTag}>
            {axes.length === 1
              ? m.frenet_plot_window({}, { locale: contentLocale })
              : m.frenet_surface_controls({}, { locale: contentLocale })}
          </legend>
          <div class="frenet-range-controls">
            <For each={axes}>
              {(variable, index) => (
                <RangeControl
                  name={`${variable}-range`}
                  label={axisRangeLabel(variable, index())}
                  values={state.ranges[variable]!}
                  bounds={state.bounds[variable]}
                  step={VARIABLE_SPECS[variable].step}
                  digits={VARIABLE_SPECS[variable].digits}
                  onChange={(range) => setAxisRange(variable, range)}
                />
              )}
            </For>
            <RangeControl
              name="output-range"
              label={outputRangeLabel}
              values={state.valueRange}
              bounds={state.valueBounds}
              step={0.001}
              digits={3}
              onChange={setOutputRange}
            />
            <Show when={axes.length === 2}>
              <For each={fixedVariables}>
                {(variable) => (
                  <ScalarControl
                    variable={variable}
                    label={m.frenet_experiment_condition(
                      { label: variableTitles[variable] },
                      { locale: contentLocale },
                    )}
                    value={state.parameters[variable]}
                    bounds={state.bounds[variable]}
                    onChange={(value) => setParameter(variable, value)}
                  />
                )}
              </For>
            </Show>
          </div>
        </fieldset>

        <Collapsible class="frenet-advanced">
          <Collapsible.Trigger class="frenet-advanced-trigger" lang={uiLanguageTag}>
            <SlidersHorizontal aria-hidden="true" />
            {m.frenet_absolute_ranges({}, { locale: uiLocale })}
            <ChevronDown class="frenet-chevron" aria-hidden="true" />
          </Collapsible.Trigger>
          <Collapsible.Content class="frenet-advanced-content">
            <For each={relevantVariables}>
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
              label={outputLabel}
              locale={contentLocale}
              bounds={state.valueBounds}
              step={0.001}
              onCommit={(bounds) => setBounds('output', bounds)}
            />
          </Collapsible.Content>
        </Collapsible>
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
