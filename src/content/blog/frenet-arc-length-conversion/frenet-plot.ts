import type { Config, Data, Layout, PlotData } from 'plotly.js';
import {
  automaticRange,
  GEOMETRY_TRACE_KEYS,
  geometryPayload,
  geometryViewRanges,
  quantityValue,
  relationBoundaries,
  relationArrays,
  surfaceCoordinateDegeneracy,
  surfaceArrays,
  VARIABLE_SPECS,
  type ExplorerState,
  type GeometryTraceKey,
  type Variable,
} from './frenet-model';

export type PlotFigure = {
  data: Data[];
  layout: Partial<Layout>;
  config: Partial<Config>;
};

export type MainPlotFigure = PlotFigure & {
  selectedTraceIndex?: number;
};

export type FrenetPlotLabels = {
  variables: Record<Variable, string>;
  quantity: string;
  relationCurve: string;
  relationSurface: string;
};

export const DEFAULT_SPLIT_PERCENTAGE = 64;

type PlotTheme = {
  foreground: string;
  muted: string;
  background: string;
  grid: string;
  fontFamily: string;
};

const COLORS = {
  blue: '#4c78a8',
  cyan: '#06b6d4',
  orange: '#f59e0b',
  green: '#22c55e',
  purple: '#a78bfa',
  red: '#ef4444',
};

const KATEX_MATH_FONT_FAMILY = 'KaTeX_Math, KaTeX_Main, Times New Roman, serif';

function traceIndexBySemantic(data: Data[], semantic: string): number {
  const index = data.findIndex(
    (trace) =>
      ((trace as { meta?: { semantic?: string } }).meta?.semantic ?? undefined) === semantic,
  );
  if (index < 0) throw new Error(`Missing Plotly trace: ${semantic}.`);
  return index;
}

function labelFontFamily(text: string, theme: PlotTheme): string {
  return text.includes('φ') ? KATEX_MATH_FONT_FAMILY : theme.fontFamily;
}

export function readPlotTheme(element: HTMLElement): PlotTheme {
  const style = getComputedStyle(element);
  const value = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    foreground: value('--ink', '#111827'),
    muted: value('--muted', '#667085'),
    background: value('--frenet-plot-background', 'rgba(0,0,0,0)'),
    grid: value('--line', 'rgba(100,116,139,.18)'),
    fontFamily: style.fontFamily,
  };
}

function axisTheme(theme: PlotTheme) {
  return {
    color: theme.muted,
    gridcolor: theme.grid,
    linecolor: theme.grid,
    zerolinecolor: theme.grid,
    tickfont: { color: theme.muted },
    title: { font: { color: theme.foreground } },
  };
}

function baseLayout(theme: PlotTheme, revision: string): Partial<Layout> {
  return {
    autosize: true,
    paper_bgcolor: theme.background,
    plot_bgcolor: theme.background,
    font: { color: theme.foreground, family: theme.fontFamily, size: 13 },
    hovermode: 'closest',
    showlegend: false,
    uirevision: revision,
  };
}

function titleAnnotation(
  text: string,
  theme: PlotTheme,
): NonNullable<Layout['annotations']>[number] {
  return {
    text,
    x: 0.5,
    y: 1.08,
    xref: 'paper',
    yref: 'paper',
    showarrow: false,
    font: { size: 15, color: theme.foreground },
  };
}

function plotConfig(): Partial<Config> {
  return {
    displaylogo: false,
    displayModeBar: 'hover',
    responsive: false,
    scrollZoom: true,
    modeBarButtonsToRemove: ['select2d', 'lasso2d', 'toImage'],
  };
}

function geometryConfig(): Partial<Config> {
  return {
    displaylogo: false,
    displayModeBar: false,
    responsive: false,
    scrollZoom: false,
  };
}

type GeometryTraceMap = Record<GeometryTraceKey, Data>;

function geometryTraces(theme: PlotTheme): GeometryTraceMap {
  const base = {
    type: 'scatter' as const,
    showlegend: false,
    hoverinfo: 'skip' as const,
  };
  const trace = (semantic: GeometryTraceKey, data: Partial<PlotData>): Data =>
    ({ ...base, ...data, meta: { semantic } }) as unknown as Data;

  return {
    parallelGrid: trace('parallelGrid', {
      mode: 'lines',
      line: { color: theme.grid, width: 1 },
    }),
    normalGrid: trace('normalGrid', {
      mode: 'lines',
      line: { color: theme.grid, width: 1.4 },
    }),
    referencePath: trace('referencePath', {
      mode: 'lines',
      line: { color: COLORS.blue, width: 4 },
    }),
    referenceIncrement: trace('referenceIncrement', {
      mode: 'lines',
      line: { color: COLORS.cyan, width: 5 },
    }),
    lateralOffset: trace('lateralOffset', {
      mode: 'lines',
      line: { color: COLORS.green, width: 3 },
    }),
    projectionGuide: trace('projectionGuide', {
      mode: 'lines',
      line: { color: theme.muted, width: 1.25, dash: 'dot' },
    }),
    trajectoryIncrement: trace('trajectoryIncrement', {
      mode: 'lines',
      line: { color: COLORS.purple, width: 4 },
    }),
    headingAngle: trace('headingAngle', {
      mode: 'lines',
      line: { color: theme.muted, width: 1.5 },
    }),
    endpoints: trace('endpoints', {
      mode: 'markers',
      marker: {
        color: [COLORS.blue, COLORS.purple, COLORS.cyan, COLORS.purple],
        size: [10, 11, 9, 9],
      },
    }),
    labels: trace('labels', {
      mode: 'text',
      textfont: {
        family: KATEX_MATH_FONT_FAMILY,
        size: 16,
        color: [COLORS.cyan, COLORS.green, COLORS.purple, theme.muted],
      },
      textposition: 'middle center',
    }),
    continuation: trace('continuation', {
      mode: 'text',
      textfont: {
        family: theme.fontFamily,
        size: 22,
        color: COLORS.cyan,
      },
      textposition: 'middle center',
    }),
  };
}

function assignGeometryData(
  traces: GeometryTraceMap,
  state: ExplorerState,
  view: { x: number; y: number },
): void {
  const payload = geometryPayload(state.selected, view, state.quantity === 'coordinate-scale');
  for (const key of GEOMETRY_TRACE_KEYS) Object.assign(traces[key], payload[key]);
}

function relationFigure(
  state: ExplorerState,
  theme: PlotTheme,
  labels: FrenetPlotLabels,
  viewRevision: number,
): MainPlotFigure {
  const variable = state.axes[0];
  if (!variable) throw new Error('Missing relation axis.');
  const range = state.ranges[variable];
  if (!range) throw new Error(`Missing range for ${variable}.`);

  const arrays = relationArrays(state);
  const displayRange = automaticRange(arrays.values, state.valueRange);
  const singularX: Array<number | null> = [];
  const singularY: Array<number | null> = [];
  const boundaries = relationBoundaries(state);
  for (const boundary of boundaries) {
    singularX.push(boundary.position, boundary.position, null);
    singularY.push(displayRange[0], displayRange[1], null);
  }

  const data = [
    {
      type: 'scatter',
      mode: 'lines',
      x: arrays.x,
      y: arrays.values,
      line: { color: COLORS.blue, width: 3 },
      meta: { semantic: 'relationCurve' },
      hovertemplate: `${VARIABLE_SPECS[variable].label}=%{x:.4f}<br>${labels.quantity}=%{y:.4f}<extra></extra>`,
      hoverlabel: { font: { family: labelFontFamily(labels.variables[variable], theme) } },
      showlegend: false,
    },
    {
      type: 'scatter',
      mode: 'lines',
      x: range,
      y: [1, 1],
      line: { color: COLORS.purple, width: 1.5, dash: 'dot' },
      meta: { semantic: 'unitReference' },
      hoverinfo: 'skip',
      showlegend: false,
    },
    {
      type: 'scatter',
      mode: 'lines',
      x: singularX,
      y: singularY,
      line: {
        color: boundaries[0]?.kind === 'parameterization-failure' ? COLORS.orange : COLORS.red,
        width: 1.5,
        dash: 'dash',
      },
      meta: { semantic: 'boundary' },
      hoverinfo: 'skip',
      showlegend: false,
    },
    {
      type: 'scatter',
      mode: 'markers',
      ...selectedPointTrace(state),
      marker: { color: COLORS.cyan, size: 9, line: { color: theme.background, width: 2 } },
      meta: { semantic: 'selectedPoint' },
      hoverinfo: 'skip',
      showlegend: false,
    },
  ] as unknown as Data[];

  return {
    data,
    layout: {
      ...baseLayout(theme, `frenet-main-${state.axes.join('-')}-${viewRevision}`),
      margin: { l: 58, r: 22, t: 58, b: 52 },
      annotations: [titleAnnotation(labels.relationCurve, theme)],
      xaxis: {
        ...axisTheme(theme),
        title: {
          text: labels.variables[variable],
          font: {
            color: theme.foreground,
            family: labelFontFamily(labels.variables[variable], theme),
          },
        },
        range: [...range],
        ticksuffix: variable === 'phi' ? '°' : '',
      },
      yaxis: {
        ...axisTheme(theme),
        title: { text: labels.quantity, font: { color: theme.foreground } },
        range: displayRange,
      },
    },
    config: plotConfig(),
    selectedTraceIndex: traceIndexBySemantic(data, 'selectedPoint'),
  };
}

function surfaceFigure(
  state: ExplorerState,
  theme: PlotTheme,
  labels: FrenetPlotLabels,
  viewRevision: number,
): MainPlotFigure {
  const [xVariable, yVariable] = state.axes;
  if (!xVariable || !yVariable) throw new Error('Missing surface axes.');
  const xRange = state.ranges[xVariable];
  const yRange = state.ranges[yVariable];
  if (!xRange || !yRange) throw new Error('Missing surface axis range.');

  const arrays = surfaceArrays(state);
  const displayRange = automaticRange(arrays.z, state.valueRange);
  const coordinateBoundary = surfaceCoordinateDegeneracy(state);
  const data = [
    {
      type: 'surface',
      x: arrays.x,
      y: arrays.y,
      z: arrays.z,
      colorscale: 'RdBu',
      cmin: displayRange[0],
      cmax: displayRange[1],
      connectgaps: false,
      colorbar: {
        title: { text: labels.quantity },
        thickness: 14,
        x: 1.02,
        xanchor: 'left',
        len: 0.74,
        y: 0.5,
      },
      hovertemplate: `${VARIABLE_SPECS[xVariable].label}=%{x:.4f}<br>${VARIABLE_SPECS[yVariable].label}=%{y:.4f}<br>${labels.quantity}=%{z:.4f}<extra></extra>`,
      hoverlabel: {
        font: {
          family: labelFontFamily(
            `${labels.variables[xVariable]} ${labels.variables[yVariable]}`,
            theme,
          ),
        },
      },
      showscale: true,
    },
    {
      type: 'surface',
      x: xRange,
      y: yRange,
      z: [
        [1, 1],
        [1, 1],
      ],
      surfacecolor: [
        [0, 0],
        [0, 0],
      ],
      colorscale: [
        [0, COLORS.purple],
        [1, COLORS.purple],
      ],
      cmin: 0,
      cmax: 1,
      opacity: 0.24,
      showscale: false,
      hoverinfo: 'skip',
    },
  ] as unknown as Data[];
  if (coordinateBoundary) {
    data.push({
      type: 'scatter3d',
      mode: 'lines',
      x: coordinateBoundary.x,
      y: coordinateBoundary.y,
      z: coordinateBoundary.z,
      line: { color: COLORS.red, width: 4 },
      hovertemplate: '1 − dκᵣ = 0<extra></extra>',
      showlegend: false,
    } as unknown as Data);
  }

  return {
    data,
    layout: {
      ...baseLayout(theme, `frenet-main-${state.axes.join('-')}-${viewRevision}`),
      margin: { l: 12, r: 72, t: 58, b: 18 },
      annotations: [titleAnnotation(labels.relationSurface, theme)],
      scene: {
        domain: { x: [0, 1], y: [0, 1] },
        xaxis: {
          ...axisTheme(theme),
          title: {
            text: labels.variables[xVariable],
            font: {
              color: theme.foreground,
              family: labelFontFamily(labels.variables[xVariable], theme),
            },
          },
          range: [...xRange],
          ticksuffix: xVariable === 'phi' ? '°' : '',
        },
        yaxis: {
          ...axisTheme(theme),
          title: {
            text: labels.variables[yVariable],
            font: {
              color: theme.foreground,
              family: labelFontFamily(labels.variables[yVariable], theme),
            },
          },
          range: [...yRange],
          ticksuffix: yVariable === 'phi' ? '°' : '',
        },
        zaxis: {
          ...axisTheme(theme),
          title: { text: labels.quantity, font: { color: theme.foreground } },
          range: displayRange,
        },
        bgcolor: theme.background,
        aspectmode: 'cube',
        camera: { eye: { x: 1.45, y: 1.45, z: 0.95 } },
      },
    },
    config: plotConfig(),
  };
}

export function buildMainFigure(
  state: ExplorerState,
  theme: PlotTheme,
  labels: FrenetPlotLabels,
  viewRevision = 0,
): MainPlotFigure {
  return state.axes.length === 1
    ? relationFigure(state, theme, labels, viewRevision)
    : surfaceFigure(state, theme, labels, viewRevision);
}

export function geometryViewportLayout(view: {
  x: number;
  y: number;
}): Pick<Layout, 'xaxis' | 'yaxis'> {
  return {
    xaxis: {
      visible: false,
      fixedrange: true,
      range: [view.x, -view.x],
      domain: [0, 1],
      constrain: 'domain',
    },
    yaxis: {
      visible: false,
      fixedrange: true,
      range: [-view.y, view.y],
      domain: [0, 1],
      scaleanchor: 'x',
      scaleratio: 1,
    },
  };
}

export function buildGeometryFigure(state: ExplorerState, theme: PlotTheme): PlotFigure {
  const view = geometryViewRanges(state);
  const traces = geometryTraces(theme);
  assignGeometryData(traces, state, view);
  const data = GEOMETRY_TRACE_KEYS.map((key) => traces[key]);

  return {
    data,
    layout: {
      ...baseLayout(theme, `frenet-geometry-${state.axes.join('-')}`),
      margin: { l: 18, r: 18, t: 18, b: 18 },
      ...geometryViewportLayout(view),
    },
    config: geometryConfig(),
  };
}

export function selectedPointTrace(state: Pick<ExplorerState, 'axes' | 'quantity' | 'selected'>): {
  x: number[];
  y: Array<number | null>;
} {
  const [xVariable] = state.axes;
  if (!xVariable) throw new Error('Missing selected axis.');
  const value = quantityValue(state.quantity, state.selected);
  return { x: [state.selected[xVariable]], y: [value] };
}
