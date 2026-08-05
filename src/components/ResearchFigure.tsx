import { createEffect, onCleanup, onMount, type Component } from 'solid-js';
import type { Config, Data, Layout, PlotlyHTMLElement } from 'plotly.js';
import { loadPlotly } from '../lib/plotly-client';

export type ResearchFigureKind =
  'planar-curvature-signs' | 'planar-heading' | 'vehicle-state' | 'vehicle-velocity';

type Props = {
  kind: ResearchFigureKind;
};

type Theme = {
  ink: string;
  muted: string;
  line: string;
  surface: string;
  blue: string;
  orange: string;
  green: string;
  purple: string;
};

type Figure = {
  data: Data[];
  layout: Partial<Layout>;
};

type Annotation = NonNullable<Layout['annotations']>[number];
type XReference = 'x' | 'x2' | 'x3';
type YReference = 'y' | 'y2' | 'y3';

const CONFIG: Partial<Config> = {
  responsive: false,
  displaylogo: false,
  displayModeBar: false,
  scrollZoom: false,
};

function css(root: HTMLElement, name: string, fallback: string): string {
  return getComputedStyle(root).getPropertyValue(name).trim() || fallback;
}

function readTheme(root: HTMLElement): Theme {
  return {
    ink: css(root, '--ink', '#0f172a'),
    muted: css(root, '--muted', '#64748b'),
    line: css(root, '--line', '#d8dee9'),
    surface: css(root, '--surface-strong', '#ffffff'),
    blue: '#4c78a8',
    orange: '#f58518',
    green: '#54a24b',
    purple: '#b279a2',
  };
}

function range(start: number, end: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => start + ((end - start) * index) / (count - 1));
}

function line(
  x: number[],
  y: number[],
  color: string,
  width = 2.6,
  extra: Partial<Data> = {},
): Data {
  return {
    type: 'scatter',
    mode: 'lines',
    x,
    y,
    line: { color, width },
    hoverinfo: 'skip',
    showlegend: false,
    ...extra,
  } as Data;
}

function marker(x: number, y: number, color: string, xaxis?: string, yaxis?: string): Data {
  return {
    type: 'scatter',
    mode: 'markers',
    x: [x],
    y: [y],
    xaxis,
    yaxis,
    marker: { color, size: 8 },
    hoverinfo: 'skip',
    showlegend: false,
  } as Data;
}

function arrow(
  x: number,
  y: number,
  ax: number,
  ay: number,
  color: string,
  xref: XReference,
  yref: YReference,
): Annotation {
  return {
    x,
    y,
    ax,
    ay,
    xref,
    yref,
    axref: xref,
    ayref: yref,
    text: '',
    showarrow: true,
    arrowhead: 2,
    arrowsize: 1,
    arrowwidth: 2.2,
    arrowcolor: color,
  } as Annotation;
}

type VectorLabelPlacement = {
  position?: number;
  normalOffset?: number;
  xanchor?: 'left' | 'center' | 'right';
  yanchor?: 'top' | 'middle' | 'bottom';
  xshift?: number;
  yshift?: number;
};

function vector(
  x: number,
  y: number,
  ax: number,
  ay: number,
  text: string,
  color: string,
  background: string,
  xref: XReference,
  yref: YReference,
  placement: VectorLabelPlacement = {},
): Annotation[] {
  const dx = x - ax;
  const dy = y - ay;
  const length = Math.hypot(dx, dy) || 1;
  const position = placement.position ?? 0.72;
  const normalOffset = placement.normalOffset ?? 0.14;
  const labelX = ax + dx * position - (dy / length) * normalOffset;
  const labelY = ay + dy * position + (dx / length) * normalOffset;

  return [
    arrow(x, y, ax, ay, color, xref, yref),
    {
      x: labelX,
      y: labelY,
      xref,
      yref,
      text,
      showarrow: false,
      xanchor: placement.xanchor ?? 'center',
      yanchor: placement.yanchor ?? 'middle',
      xshift: placement.xshift ?? 0,
      yshift: placement.yshift ?? 0,
      bgcolor: background,
      borderpad: 2,
      font: { color, size: 12 },
    } as Annotation,
  ];
}

function baseLayout(theme: Theme): Partial<Layout> {
  return {
    autosize: true,
    margin: { l: 28, r: 28, t: 46, b: 30 },
    paper_bgcolor: theme.surface,
    plot_bgcolor: theme.surface,
    font: { color: theme.ink, family: 'Manrope Variable, ui-sans-serif, system-ui, sans-serif' },
    showlegend: false,
    hovermode: false,
    uirevision: 'research-figure',
  };
}

function hiddenAxis(
  domain: [number, number],
  rangeValue: [number, number],
): Partial<Layout['xaxis']> {
  return {
    domain,
    range: rangeValue,
    visible: false,
    fixedrange: true,
    constrain: 'domain',
  };
}

function buildCurvatureSigns(theme: Theme): Figure {
  const bends = [0.24, 0, -0.24];
  const domains: [number, number][] = [
    [0, 0.3],
    [0.35, 0.65],
    [0.7, 1],
  ];
  const data: Data[] = [];
  const annotations: NonNullable<Layout['annotations']> = [];
  const labels = ['(a) κᵣ > 0', '(b) κᵣ = 0', '(c) κᵣ < 0'];
  const xs = range(-2.2, 2.2, 241);

  bends.forEach((bend, index) => {
    const suffix = index === 0 ? '' : String(index + 1);
    const xaxis = index === 0 ? undefined : `x${index + 1}`;
    const yaxis = index === 0 ? undefined : `y${index + 1}`;
    const xref = (index === 0 ? 'x' : `x${index + 1}`) as XReference;
    const yref = (index === 0 ? 'y' : `y${index + 1}`) as YReference;
    data.push(
      line(
        xs,
        xs.map((x) => bend * x * x),
        theme.blue,
        3,
        { xaxis, yaxis },
      ),
    );
    data.push(marker(0, 0, theme.blue, xaxis, yaxis));
    annotations.push(
      ...vector(1.05, 0, 0, 0, '<b>T</b>', theme.orange, theme.surface, xref, yref, {
        normalOffset: -0.28,
      }),
      ...vector(0, 1.12, 0, 0, '<b>N = JT</b>', theme.green, theme.surface, xref, yref, {
        position: 0.72,
        normalOffset: -0.34,
      }),
      {
        x: 0.04,
        y: 0.94,
        xref: `x${suffix} domain`,
        yref: `y${suffix} domain`,
        text: labels[index],
        showarrow: false,
        xanchor: 'left',
        yanchor: 'top',
        font: { color: theme.ink, size: 13 },
      } as Annotation,
    );
    if (bend !== 0) {
      annotations.push(
        ...vector(
          0,
          bend > 0 ? 0.72 : -0.72,
          0,
          0,
          '<b>K</b>',
          theme.purple,
          theme.surface,
          xref,
          yref,
          { position: 0.62, normalOffset: 0.32 },
        ),
      );
    } else {
      annotations.push({
        x: -0.9,
        y: -0.42,
        xref,
        yref,
        text: '<b>K = 0</b>',
        showarrow: false,
        font: { color: theme.purple, size: 12 },
      } as Annotation);
    }
  });

  const layout = baseLayout(theme);
  return {
    data,
    layout: {
      ...layout,
      annotations,
      xaxis: hiddenAxis(domains[0], [-2.25, 2.25]),
      yaxis: { ...hiddenAxis([0, 1], [-1.35, 1.45]), scaleanchor: 'x', scaleratio: 1 },
      xaxis2: hiddenAxis(domains[1], [-2.25, 2.25]),
      yaxis2: { ...hiddenAxis([0, 1], [-1.35, 1.45]), scaleanchor: 'x2', scaleratio: 1 },
      xaxis3: hiddenAxis(domains[2], [-2.25, 2.25]),
      yaxis3: { ...hiddenAxis([0, 1], [-1.35, 1.45]), scaleanchor: 'x3', scaleratio: 1 },
    },
  };
}

function buildHeading(theme: Theme): Figure {
  const theta = (35 * Math.PI) / 180;
  const tangent = [Math.cos(theta), Math.sin(theta)];
  const normal = [-Math.sin(theta), Math.cos(theta)];
  const pathAngles = range(0.1, 1.18, 240);
  const radius = 2.4;
  const pathX = pathAngles.map((angle) => radius * Math.sin(angle));
  const pathY = pathAngles.map((angle) => radius * (1 - Math.cos(angle)));
  const p = (angle: number) => [radius * Math.sin(angle), radius * (1 - Math.cos(angle))];
  const p0 = p(0.42);
  const p1 = p(0.82);
  const data: Data[] = [
    line(pathX, pathY, theme.blue, 3, { xaxis: 'x2', yaxis: 'y2' }),
    marker(p0[0], p0[1], theme.blue, 'x2', 'y2'),
    marker(p1[0], p1[1], theme.blue, 'x2', 'y2'),
  ];
  const annotations: NonNullable<Layout['annotations']> = [
    ...vector(tangent[0], tangent[1], 0, 0, '<b>T</b>', theme.orange, theme.surface, 'x', 'y', {
      normalOffset: -0.28,
    }),
    ...vector(normal[0], normal[1], 0, 0, '<b>N</b>', theme.green, theme.surface, 'x', 'y', {
      normalOffset: 0.28,
    }),
    ...vector(
      p0[0] + 0.78 * Math.cos(0.42),
      p0[1] + 0.78 * Math.sin(0.42),
      p0[0],
      p0[1],
      '<b>T(s)</b>',
      theme.orange,
      theme.surface,
      'x2',
      'y2',
      { position: 0.58, normalOffset: -0.32, yanchor: 'top' },
    ),
    ...vector(
      p1[0] + 0.78 * Math.cos(0.82),
      p1[1] + 0.78 * Math.sin(0.82),
      p1[0],
      p1[1],
      '<b>T(s + Δs)</b>',
      theme.orange,
      theme.surface,
      'x2',
      'y2',
      { position: 0.58, normalOffset: 0.34, yanchor: 'bottom' },
    ),
    {
      x: 0.04,
      y: 0.94,
      xref: 'x domain',
      yref: 'y domain',
      text: '(a)',
      showarrow: false,
      font: { color: theme.ink, size: 13 },
    },
    {
      x: 0.04,
      y: 0.94,
      xref: 'x2 domain',
      yref: 'y2 domain',
      text: '(b)',
      showarrow: false,
      font: { color: theme.ink, size: 13 },
    },
    {
      x: 0.52,
      y: 0.02,
      xref: 'x2 domain',
      yref: 'y2 domain',
      text: 'κᵣ(s) = lim Δθᵣ / Δs',
      showarrow: false,
      font: { color: theme.ink, size: 13 },
    },
  ];
  return {
    data,
    layout: {
      ...baseLayout(theme),
      annotations,
      shapes: [
        {
          type: 'line',
          x0: -1.45,
          x1: 1.55,
          y0: 0,
          y1: 0,
          xref: 'x',
          yref: 'y',
          line: { color: theme.muted, width: 1 },
        },
        {
          type: 'line',
          x0: 0,
          x1: 0,
          y0: -0.35,
          y1: 1.45,
          xref: 'x',
          yref: 'y',
          line: { color: theme.muted, width: 1 },
        },
      ],
      xaxis: hiddenAxis([0, 0.45], [-1.55, 1.7]),
      yaxis: { ...hiddenAxis([0, 1], [-0.42, 1.58]), scaleanchor: 'x', scaleratio: 1 },
      xaxis2: hiddenAxis([0.55, 1], [0.05, 3.85]),
      yaxis2: { ...hiddenAxis([0, 1], [-0.35, 1.85]), scaleanchor: 'x2', scaleratio: 1 },
    },
  };
}

function vehicleGeometry(): {
  referenceX: number[];
  referenceY: number[];
  point: [number, number];
  tangent: [number, number];
  normal: [number, number];
  vehicle: [number, number];
  heading: [number, number];
} {
  const radius = 6.8;
  const angles = range(0.05, 1.3, 320);
  const referenceX = angles.map((angle) => radius * Math.sin(angle));
  const referenceY = angles.map((angle) => radius * (1 - Math.cos(angle)));
  const angle = 0.62;
  const point: [number, number] = [radius * Math.sin(angle), radius * (1 - Math.cos(angle))];
  const tangent: [number, number] = [Math.cos(angle), Math.sin(angle)];
  const normal: [number, number] = [-Math.sin(angle), Math.cos(angle)];
  const offset = 1.25;
  const vehicle: [number, number] = [point[0] + offset * normal[0], point[1] + offset * normal[1]];
  const headingAngle = angle + 0.34;
  const heading: [number, number] = [Math.cos(headingAngle), Math.sin(headingAngle)];
  return { referenceX, referenceY, point, tangent, normal, vehicle, heading };
}

function buildVehicleState(theme: Theme): Figure {
  const geometry = vehicleGeometry();
  const { point, vehicle, tangent, normal, heading } = geometry;
  const dimensionOffset = 0.4;
  const dimensionStart: [number, number] = [
    point[0] + dimensionOffset * tangent[0],
    point[1] + dimensionOffset * tangent[1],
  ];
  const dimensionEnd: [number, number] = [
    vehicle[0] + dimensionOffset * tangent[0],
    vehicle[1] + dimensionOffset * tangent[1],
  ];
  const data: Data[] = [
    line(geometry.referenceX, geometry.referenceY, theme.blue, 3),
    marker(point[0], point[1], theme.blue),
    marker(vehicle[0], vehicle[1], theme.purple),
  ];
  const annotations: NonNullable<Layout['annotations']> = [
    ...vector(
      point[0] + tangent[0],
      point[1] + tangent[1],
      point[0],
      point[1],
      '<b>T(s)</b>',
      theme.orange,
      theme.surface,
      'x',
      'y',
      { position: 0.65, normalOffset: -0.3, yanchor: 'top' },
    ),
    ...vector(
      point[0] + normal[0],
      point[1] + normal[1],
      point[0],
      point[1],
      '<b>N(s)</b>',
      theme.green,
      theme.surface,
      'x',
      'y',
      { position: 0.58, normalOffset: 0.32, xanchor: 'right' },
    ),
    ...vector(
      vehicle[0] + 1.15 * heading[0],
      vehicle[1] + 1.15 * heading[1],
      vehicle[0],
      vehicle[1],
      '<b>eθ</b>',
      theme.purple,
      theme.surface,
      'x',
      'y',
      { position: 0.66, normalOffset: -0.3, yanchor: 'top' },
    ),
    ...vector(
      dimensionEnd[0],
      dimensionEnd[1],
      dimensionStart[0],
      dimensionStart[1],
      '<b>d</b>',
      theme.purple,
      theme.surface,
      'x',
      'y',
      { position: 0.5, normalOffset: -0.28, xanchor: 'left' },
    ),
    arrow(
      dimensionStart[0],
      dimensionStart[1],
      dimensionEnd[0],
      dimensionEnd[1],
      theme.purple,
      'x',
      'y',
    ),
    {
      x: 0.04,
      y: 0.95,
      xref: 'x domain',
      yref: 'y domain',
      text: '‖T‖ = ‖N‖ = 1',
      showarrow: false,
      font: { color: theme.muted, size: 12 },
    },
  ];
  return {
    data,
    layout: {
      ...baseLayout(theme),
      annotations,
      shapes: [
        {
          type: 'line',
          x0: point[0],
          y0: point[1],
          x1: dimensionStart[0],
          y1: dimensionStart[1],
          line: { color: theme.purple, width: 1 },
        },
        {
          type: 'line',
          x0: vehicle[0],
          y0: vehicle[1],
          x1: dimensionEnd[0],
          y1: dimensionEnd[1],
          line: { color: theme.purple, width: 1 },
        },
      ],
      xaxis: hiddenAxis([0, 1], [0, 8.4]),
      yaxis: { ...hiddenAxis([0, 1], [-0.25, 5.65]), scaleanchor: 'x', scaleratio: 1 },
    },
  };
}

function buildVehicleVelocity(theme: Theme): Figure {
  const tangent = 3.15;
  const normal = 1.72;
  const data: Data[] = [];
  const annotations: NonNullable<Layout['annotations']> = [];
  ['left', 'right'].forEach((_, index) => {
    const xref = (index === 0 ? 'x' : 'x2') as XReference;
    const yref = (index === 0 ? 'y' : 'y2') as YReference;
    annotations.push(
      ...vector(
        tangent,
        normal,
        0,
        0,
        index === 0 ? '<b>ż</b>' : '<b>v eθ</b>',
        theme.purple,
        theme.surface,
        xref,
        yref,
        { position: 0.6, normalOffset: 0.36, yanchor: 'bottom' },
      ),
      ...vector(
        tangent,
        0,
        0,
        0,
        index === 0 ? '(1 − dκᵣ) ṡ T' : 'v cosφ T',
        theme.orange,
        theme.surface,
        xref,
        yref,
        { position: 0.5, normalOffset: -0.32, yanchor: 'top' },
      ),
      ...vector(
        tangent,
        normal,
        tangent,
        0,
        index === 0 ? 'ḋ N' : 'v sinφ N',
        theme.green,
        theme.surface,
        xref,
        yref,
        { position: 0.5, normalOffset: -0.36, xanchor: 'left', xshift: 2 },
      ),
      {
        x: 0.03,
        y: 0.95,
        xref: `${xref} domain`,
        yref: `${yref} domain`,
        text: index === 0 ? '(a)' : '(b)',
        showarrow: false,
        font: { color: theme.ink, size: 13 },
      } as Annotation,
    );
  });
  return {
    data,
    layout: {
      ...baseLayout(theme),
      annotations,
      shapes: [
        {
          type: 'line',
          x0: -0.2,
          x1: 4.15,
          y0: 0,
          y1: 0,
          xref: 'x',
          yref: 'y',
          line: { color: theme.muted, width: 1 },
        },
        {
          type: 'line',
          x0: 0,
          x1: 0,
          y0: -0.2,
          y1: 2.45,
          xref: 'x',
          yref: 'y',
          line: { color: theme.muted, width: 1 },
        },
        {
          type: 'line',
          x0: -0.2,
          x1: 4.15,
          y0: 0,
          y1: 0,
          xref: 'x2',
          yref: 'y2',
          line: { color: theme.muted, width: 1 },
        },
        {
          type: 'line',
          x0: 0,
          x1: 0,
          y0: -0.2,
          y1: 2.45,
          xref: 'x2',
          yref: 'y2',
          line: { color: theme.muted, width: 1 },
        },
      ],
      xaxis: hiddenAxis([0, 0.45], [-0.3, 4.48]),
      yaxis: { ...hiddenAxis([0, 1], [-0.55, 2.72]), scaleanchor: 'x', scaleratio: 1 },
      xaxis2: hiddenAxis([0.55, 1], [-0.3, 4.48]),
      yaxis2: { ...hiddenAxis([0, 1], [-0.55, 2.72]), scaleanchor: 'x2', scaleratio: 1 },
    },
  };
}

function buildFigure(kind: ResearchFigureKind, theme: Theme): Figure {
  switch (kind) {
    case 'planar-curvature-signs':
      return buildCurvatureSigns(theme);
    case 'planar-heading':
      return buildHeading(theme);
    case 'vehicle-state':
      return buildVehicleState(theme);
    case 'vehicle-velocity':
      return buildVehicleVelocity(theme);
  }
}

const ResearchFigure: Component<Props> = (props) => {
  let root!: HTMLDivElement;
  let graph!: HTMLDivElement;
  let plot: PlotlyHTMLElement | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let themeObserver: MutationObserver | undefined;
  let disposed = false;

  const render = async () => {
    const plotly = await loadPlotly();
    if (disposed) return;
    const figure = buildFigure(props.kind, readTheme(root));
    plot = (await plotly.react(graph, figure.data, figure.layout, CONFIG)) as PlotlyHTMLElement;
  };

  onMount(() => {
    void render();
    resizeObserver = new ResizeObserver(() => {
      if (!plot) return;
      void loadPlotly().then((plotly) => plotly.Plots.resize(plot!));
    });
    resizeObserver.observe(root);
    themeObserver = new MutationObserver(() => void render());
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
  });

  createEffect(() => props.kind);

  onCleanup(() => {
    disposed = true;
    resizeObserver?.disconnect();
    themeObserver?.disconnect();
    if (plot) void loadPlotly().then((plotly) => plotly.purge(plot!));
  });

  return (
    <div ref={root} class="research-plot" data-plotly-figure data-kind={props.kind}>
      <div ref={graph} class="research-plot-canvas" />
    </div>
  );
};

export default ResearchFigure;
