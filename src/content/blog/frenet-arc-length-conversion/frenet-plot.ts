import type { Config, Data, Layout } from 'plotly.js';
import {
  arcLengthRate,
  automaticRange,
  geometryPayload,
  geometryViewRanges,
  relationArrays,
  singularPositions,
  surfaceArrays,
  VARIABLE_SPECS,
  type ExplorerState,
  type Parameters,
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
  relationCurve: string;
  relationSurface: string;
  geometry: string;
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
    font: { color: theme.foreground, family: theme.fontFamily, size: 12 },
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
    font: { size: 14, color: theme.foreground },
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

function geometryTraces(theme: PlotTheme): Data[] {
  const arrowMarker = {
    symbol: ['circle', 'arrow'],
    size: [1, 12],
    angleref: 'previous' as const,
  };
  const base = {
    type: 'scatter' as const,
    showlegend: false,
    hoverinfo: 'skip' as const,
  };

  return [
    { ...base, mode: 'lines', line: { color: theme.grid, width: 1 } },
    { ...base, mode: 'lines', line: { color: theme.grid, width: 1.4 } },
    { ...base, mode: 'lines', line: { color: COLORS.blue, width: 4 } },
    {
      ...base,
      mode: 'lines+text',
      line: { color: COLORS.green, width: 3 },
      textposition: 'middle right',
    },
    {
      ...base,
      mode: 'lines+markers+text',
      line: { color: COLORS.orange, width: 3 },
      marker: arrowMarker,
      textposition: 'top left',
    },
    {
      ...base,
      mode: 'lines',
      line: { color: COLORS.orange, width: 1.5, dash: 'dot' },
    },
    {
      ...base,
      mode: 'lines+markers+text',
      line: { color: COLORS.purple, width: 4 },
      marker: arrowMarker,
      textposition: 'top right',
    },
    {
      ...base,
      mode: 'lines+text',
      line: { color: theme.muted, width: 1.5 },
      textposition: 'middle right',
    },
    {
      ...base,
      mode: 'markers+text',
      marker: { color: [COLORS.blue, COLORS.purple], size: [10, 11] },
      textposition: ['bottom left', 'top left'],
    },
  ] as unknown as Data[];
}

function assignGeometryData(traces: Data[], parameters: Parameters): void {
  const payload = geometryPayload(parameters);
  payload.forEach((values, index) => Object.assign(traces[index]!, values));
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
  const displayRange = automaticRange(arrays.rate, state.rateRange);
  const singularX: Array<number | null> = [];
  const singularY: Array<number | null> = [];
  for (const position of singularPositions(state)) {
    singularX.push(position, position, null);
    singularY.push(displayRange[0], displayRange[1], null);
  }

  const data = [
    {
      type: 'scatter',
      mode: 'lines',
      x: arrays.x,
      y: arrays.rate,
      line: { color: COLORS.blue, width: 3 },
      hovertemplate: `${VARIABLE_SPECS[variable].label}=%{x:.4f}<br>dℓ/ds=%{y:.4f}<extra></extra>`,
      showlegend: false,
    },
    {
      type: 'scatter',
      mode: 'lines',
      x: range,
      y: [1, 1],
      line: { color: COLORS.purple, width: 1.5, dash: 'dot' },
      hoverinfo: 'skip',
      showlegend: false,
    },
    {
      type: 'scatter',
      mode: 'lines',
      x: singularX,
      y: singularY,
      line: {
        color: variable === 'phi' ? COLORS.orange : COLORS.red,
        width: 1.5,
        dash: 'dash',
      },
      hoverinfo: 'skip',
      showlegend: false,
    },
    {
      type: 'scatter',
      mode: 'markers',
      ...selectedPointTrace(state),
      marker: { color: COLORS.cyan, size: 9, line: { color: theme.background, width: 2 } },
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
        title: { text: labels.variables[variable], font: { color: theme.foreground } },
        range: [...range],
        ticksuffix: variable === 'phi' ? '°' : '',
      },
      yaxis: {
        ...axisTheme(theme),
        title: { text: 'dℓ/ds', font: { color: theme.foreground } },
        range: displayRange,
      },
    },
    config: plotConfig(),
    selectedTraceIndex: 3,
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
  const displayRange = automaticRange(arrays.z, state.rateRange);
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
        title: { text: 'dℓ/ds' },
        thickness: 14,
        x: 1.02,
        xanchor: 'left',
        len: 0.74,
        y: 0.5,
      },
      hovertemplate: `${VARIABLE_SPECS[xVariable].label}=%{x:.4f}<br>${VARIABLE_SPECS[yVariable].label}=%{y:.4f}<br>dℓ/ds=%{z:.4f}<extra></extra>`,
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
          title: { text: labels.variables[xVariable], font: { color: theme.foreground } },
          range: [...xRange],
          ticksuffix: xVariable === 'phi' ? '°' : '',
        },
        yaxis: {
          ...axisTheme(theme),
          title: { text: labels.variables[yVariable], font: { color: theme.foreground } },
          range: [...yRange],
          ticksuffix: yVariable === 'phi' ? '°' : '',
        },
        zaxis: {
          ...axisTheme(theme),
          title: { text: 'dℓ/ds', font: { color: theme.foreground } },
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

export function buildGeometryFigure(
  state: ExplorerState,
  theme: PlotTheme,
  labels: FrenetPlotLabels,
): PlotFigure {
  const view = geometryViewRanges(state);
  const data = geometryTraces(theme);
  assignGeometryData(data, state.selected);

  return {
    data,
    layout: {
      ...baseLayout(theme, `frenet-geometry-${state.axes.join('-')}`),
      margin: { l: 18, r: 18, t: 58, b: 24 },
      annotations: [titleAnnotation(labels.geometry, theme)],
      xaxis: {
        visible: false,
        fixedrange: true,
        range: [view.x, -view.x],
        constrain: 'domain',
      },
      yaxis: {
        visible: false,
        fixedrange: true,
        range: [-view.y, view.y],
        scaleanchor: 'x',
        scaleratio: 1,
      },
    },
    config: geometryConfig(),
  };
}

export function selectedPointTrace(state: Pick<ExplorerState, 'axes' | 'selected'>): {
  x: number[];
  y: Array<number | null>;
} {
  const [xVariable] = state.axes;
  if (!xVariable) throw new Error('Missing selected axis.');
  const rate = arcLengthRate(state.selected.phi, state.selected.d, state.selected.kappa);
  return { x: [state.selected[xVariable]], y: [rate] };
}
