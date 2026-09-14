export type ResearchFigureKind =
  'planar-curvature-signs' | 'planar-heading' | 'vehicle-state' | 'vehicle-velocity';

type Point = readonly [number, number];
type Color = 'ink' | 'muted' | 'blue' | 'orange' | 'green' | 'purple';
type Label = {
  at: Point;
  text: string;
  latex?: boolean;
  subscript?: string;
  color?: Color;
  size?: number;
  bold?: boolean;
  math?: boolean;
  background?: boolean;
  horizontal?: 'left' | 'center' | 'right';
  vertical?: 'top' | 'middle' | 'bottom';
};
type Segment = { from: Point; to: Point; color: Color; arrow?: boolean; width?: number };

export type ResearchPanel = {
  x: Point;
  y: Point;
  title?: string;
  paths: { d: string; color: Color; width: number }[];
  segments: Segment[];
  points: { at: Point; color: Color }[];
  labels: Label[];
};

function panel(x: Point, y: Point): ResearchPanel {
  return { x, y, paths: [], segments: [], points: [], labels: [] };
}

// Geometry uses mathematical coordinates (positive y upwards). Only this
// projection and SVG paths invert y; labels retain their normal text layout.
export function projectPoint(panel: ResearchPanel, [x, y]: Point): Point {
  return [
    ((x - panel.x[0]) / (panel.x[1] - panel.x[0])) * 100,
    ((panel.y[1] - y) / (panel.y[1] - panel.y[0])) * 100,
  ];
}

function vector(
  target: ResearchPanel,
  from: Point,
  to: Point,
  color: Color,
  text: string,
  placement: Omit<Label, 'at' | 'text' | 'color'> & { position?: number; offset?: number } = {},
): void {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  const { position = 0.72, offset = 0.14, ...label } = placement;
  target.segments.push({ from, to, color, arrow: true });
  target.labels.push({
    at: [
      from[0] + dx * position - (dy / length) * offset,
      from[1] + dy * position + (dx / length) * offset,
    ],
    text,
    color,
    background: true,
    ...label,
  });
}

function circlePoint(radius: number, angle: number): Point {
  return [radius * Math.sin(angle), radius * (1 - Math.cos(angle))];
}

function arc(radius: number, start: number, end: number): string {
  const a = circlePoint(radius, start);
  const b = circlePoint(radius, end);
  return `M ${a[0]} ${-a[1]} A ${radius} ${radius} 0 0 0 ${b[0]} ${-b[1]}`;
}

function add(point: Point, direction: Point, length = 1): Point {
  return [point[0] + direction[0] * length, point[1] + direction[1] * length];
}

function curvatureSigns(): ResearchPanel[] {
  return [0.24, 0, -0.24].map((bend, index) => {
    const result = panel([-2.25, 2.25], [-1.35, 1.45]);
    result.title = ['(a) κᵣ > 0', '(b) κᵣ = 0', '(c) κᵣ < 0'][index];
    const endY = bend * 2.2 ** 2;
    // An exact quadratic replaces the old samples of y = bend * x².
    result.paths.push({ d: `M -2.2 ${-endY} Q 0 ${endY} 2.2 ${-endY}`, color: 'blue', width: 3 });
    result.points.push({ at: [0, 0], color: 'blue' });
    vector(result, [0, 0], [1.05, 0], 'orange', 'T', {
      bold: true,
      offset: index === 2 ? 0.28 : -0.28,
    });
    vector(result, [0, 0], [0, 1.12], 'green', 'N = JT', {
      bold: true,
      position: 0.88,
      offset: -0.18,
      horizontal: 'left',
    });
    if (bend)
      vector(result, [0, 0], [0, bend > 0 ? 0.72 : -0.72], 'purple', 'K', {
        bold: true,
        position: 0.62,
        offset: 0.32,
      });
    else result.labels.push({ at: [-0.9, -0.42], text: 'K = 0', color: 'purple', bold: true });
    return result;
  });
}

function heading(): ResearchPanel[] {
  const left = panel([-1.55, 1.7], [-0.42, 1.58]);
  const right = panel([0.05, 3.85], [-0.35, 1.85]);
  const theta = (35 * Math.PI) / 180;
  left.segments.push(
    { from: [-1.45, 0], to: [1.55, 0], color: 'muted', width: 1 },
    { from: [0, -0.35], to: [0, 1.45], color: 'muted', width: 1 },
  );
  vector(left, [0, 0], [Math.cos(theta), Math.sin(theta)], 'orange', 'T', {
    bold: true,
    offset: -0.28,
  });
  vector(left, [0, 0], [-Math.sin(theta), Math.cos(theta)], 'green', 'N', {
    bold: true,
    offset: 0.28,
  });
  left.labels.push({
    at: [-1.42, 1.46],
    text: '(a)',
    size: 13,
    horizontal: 'left',
    vertical: 'top',
  });
  right.paths.push({ d: arc(2.4, 0.1, 1.18), color: 'blue', width: 3 });
  for (const [angle, text, offset, vertical] of [
    [0.42, 'T(s)', -0.32, 'top'],
    [0.82, 'T(s + Δs)', 0.34, 'bottom'],
  ] as const) {
    const point = circlePoint(2.4, angle);
    right.points.push({ at: point, color: 'blue' });
    vector(right, point, add(point, [Math.cos(angle), Math.sin(angle)], 0.78), 'orange', text, {
      bold: true,
      position: 0.58,
      offset,
      vertical,
    });
  }
  right.labels.push(
    { at: [0.202, 1.718], text: '(b)', size: 13, horizontal: 'left', vertical: 'top' },
    { at: [2.026, -0.306], text: 'κᵣ(s) = lim Δθᵣ / Δs', size: 13, vertical: 'bottom' },
  );
  return [left, right];
}

function vehicleState(): ResearchPanel[] {
  const result = panel([0, 8.4], [-0.25, 5.65]);
  const angle = 0.62;
  const point = circlePoint(6.8, angle);
  const tangent: Point = [Math.cos(angle), Math.sin(angle)];
  const normal: Point = [-Math.sin(angle), Math.cos(angle)];
  const vehicle = add(point, normal, 1.25);
  const heading: Point = [Math.cos(angle + 0.34), Math.sin(angle + 0.34)];
  const dimensionStart = add(point, tangent, 0.4);
  const dimensionEnd = add(vehicle, tangent, 0.4);
  result.paths.push({ d: arc(6.8, 0.05, 1.3), color: 'blue', width: 3 });
  result.points.push({ at: point, color: 'blue' }, { at: vehicle, color: 'purple' });
  vector(result, point, add(point, tangent), 'orange', 'T(s)', {
    bold: true,
    size: 18,
    position: 0.65,
    offset: -0.3,
    vertical: 'top',
  });
  vector(result, point, add(point, normal), 'green', 'N(s)', {
    bold: true,
    size: 18,
    position: 0.58,
    offset: 0.32,
    horizontal: 'right',
  });
  vector(result, vehicle, add(vehicle, heading, 1.15), 'purple', 'e', {
    subscript: 'θ',
    bold: true,
    size: 18,
    position: 0.82,
    offset: 0.2,
    horizontal: 'right',
    vertical: 'bottom',
  });
  vector(result, dimensionStart, dimensionEnd, 'purple', 'd', {
    bold: true,
    size: 18,
    position: 0.5,
    offset: -0.28,
    horizontal: 'left',
  });
  result.segments.push(
    { from: dimensionEnd, to: dimensionStart, color: 'purple', arrow: true },
    { from: point, to: dimensionStart, color: 'purple', width: 1 },
    { from: vehicle, to: dimensionEnd, color: 'purple', width: 1 },
  );
  result.labels.push({
    at: [0.336, 5.355],
    text: '‖T‖ = ‖N‖ = 1',
    color: 'muted',
    size: 18,
    horizontal: 'left',
    vertical: 'top',
  });
  return [result];
}

function vehicleVelocity(): ResearchPanel[] {
  return [false, true].map((physical) => {
    const result = panel([-0.3, 4.48], [-0.55, 2.72]);
    result.segments.push(
      { from: [-0.2, 0], to: [4.15, 0], color: 'muted', width: 1 },
      { from: [0, -0.2], to: [0, 2.45], color: 'muted', width: 1 },
    );
    vector(result, [0, 0], [3.15, 1.72], 'purple', physical ? 'v e' : String.raw`\dot{\mathbf z}`, {
      latex: !physical,
      subscript: physical ? 'θ' : undefined,
      bold: true,
      size: 18,
      position: 0.6,
      offset: 0.36,
      vertical: 'bottom',
    });
    vector(
      result,
      [0, 0],
      [3.15, 0],
      'orange',
      physical ? 'v cosφ T' : String.raw`(1-d\kappa_r)\dot{s}\,\mathbf T`,
      {
        latex: !physical,
        math: physical,
        size: 18,
        position: 0.5,
        offset: -0.32,
        vertical: 'top',
      },
    );
    vector(
      result,
      [3.15, 0],
      [3.15, 1.72],
      'green',
      physical ? 'v sinφ N' : String.raw`\dot{d}\,\mathbf N`,
      {
        latex: !physical,
        math: physical,
        size: 18,
        position: 0.5,
        offset: -0.36,
        horizontal: 'left',
      },
    );
    result.labels.push({
      at: [-0.3, 2.7854],
      text: physical ? '(b)' : '(a)',
      size: 18,
      horizontal: 'left',
      vertical: 'bottom',
    });
    return result;
  });
}

export function researchPanels(kind: ResearchFigureKind): ResearchPanel[] {
  switch (kind) {
    case 'planar-curvature-signs':
      return curvatureSigns();
    case 'planar-heading':
      return heading();
    case 'vehicle-state':
      return vehicleState();
    case 'vehicle-velocity':
      return vehicleVelocity();
  }
}
