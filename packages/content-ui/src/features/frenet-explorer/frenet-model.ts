export type Variable = 'phi' | 'd' | 'kappa';
export type Range = [number, number];
export type AnalysisQuantity = 'arc-length-rate' | 'coordinate-scale';
export type CurvatureSign = 'positive' | 'negative';

export type Parameters = Record<Variable, number>;

export type VariableSpec = {
  label: string;
  limits: Range;
  step: number;
  digits: number;
  points2d: number;
  points3d: number;
};

export type ExplorerState = {
  axes: Variable[];
  quantity: AnalysisQuantity;
  parameters: Parameters;
  selected: Parameters;
  bounds: Record<Variable, Range>;
  ranges: Partial<Record<Variable, Range>>;
  valueBounds: Range;
  valueRange: Range;
};

export type InitialStateOptions = {
  quantity?: AnalysisQuantity;
  curvatureSign?: CurvatureSign;
};

export type GeometryTracePayload = {
  x: Array<number | null>;
  y: Array<number | null>;
  text: Array<string | null>;
};

export const GEOMETRY_TRACE_KEYS = [
  'parallelGrid',
  'normalGrid',
  'referencePath',
  'referenceIncrement',
  'lateralOffset',
  'projectionGuide',
  'trajectoryIncrement',
  'headingAngle',
  'endpoints',
  'labels',
  'continuation',
] as const;

export type GeometryTraceKey = (typeof GEOMETRY_TRACE_KEYS)[number];
export type GeometryPayload = Record<GeometryTraceKey, GeometryTracePayload>;

export type RelationBoundary = {
  kind: 'parameterization-failure' | 'coordinate-degeneracy';
  position: number;
};

export type SurfaceBoundary = {
  x: Array<number | null>;
  y: Array<number | null>;
  z: Array<number | null>;
};

export const VARIABLE_ORDER: Variable[] = ['phi', 'd', 'kappa'];

export const VARIABLE_SPECS: Record<Variable, VariableSpec> = {
  phi: {
    label: 'φ',
    limits: [-30, 30],
    step: 0.01,
    digits: 2,
    points2d: 1201,
    points3d: 121,
  },
  d: {
    label: 'd',
    limits: [-0.5, 0.5],
    step: 0.001,
    digits: 3,
    points2d: 1001,
    points3d: 61,
  },
  kappa: {
    label: 'κᵣ',
    limits: [-0.1, 0.1],
    step: 0.001,
    digits: 3,
    points2d: 1001,
    points3d: 61,
  },
};

export const DEFAULT_RATE_RANGE: Range = [0, 2];
export const COS_ZERO_TOLERANCE = 1e-8;
export const COORDINATE_DEGENERACY_TOLERANCE = 1e-10;
export const DISPLAY_GAP_COSINE = Math.sin((2 * Math.PI) / 180);

export function clamp(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, value));
}

export function linspace(lower: number, upper: number, count: number): number[] {
  if (count <= 1) return [lower];
  const step = (upper - lower) / (count - 1);
  return Array.from({ length: count }, (_, index) => lower + index * step);
}

export function arcLengthRate(
  phiDegrees: number,
  lateralOffset: number,
  referenceCurvature: number,
): number | null {
  const cosine = Math.cos((phiDegrees * Math.PI) / 180);
  if (Math.abs(cosine) <= COS_ZERO_TOLERANCE) return null;
  return (1 - lateralOffset * referenceCurvature) / cosine;
}

export function coordinateScale(lateralOffset: number, referenceCurvature: number): number {
  return 1 - lateralOffset * referenceCurvature;
}

export function quantityValue(quantity: AnalysisQuantity, parameters: Parameters): number | null {
  return quantity === 'coordinate-scale'
    ? coordinateScale(parameters.d, parameters.kappa)
    : arcLengthRate(parameters.phi, parameters.d, parameters.kappa);
}

export function isCoordinateDegenerate(lateralOffset: number, referenceCurvature: number): boolean {
  return Math.abs(1 - lateralOffset * referenceCurvature) <= COORDINATE_DEGENERACY_TOLERANCE;
}

export function constantCurvatureCoordinates(
  referenceCurvature: number,
  arcLength: number,
  offset: number,
): { tangent: number; left: number } {
  if (Math.abs(referenceCurvature) <= 1e-10) {
    return { tangent: arcLength, left: offset };
  }

  const angle = referenceCurvature * arcLength;
  return {
    tangent: Math.sin(angle) / referenceCurvature - offset * Math.sin(angle),
    left: (1 - Math.cos(angle)) / referenceCurvature + offset * Math.cos(angle),
  };
}

function sequenceCoordinates(
  referenceCurvature: number,
  arcLengths: number[],
  offsets: number | number[],
): { tangent: number[]; left: number[] } {
  const tangent: number[] = [];
  const left: number[] = [];
  const offsetArray = Array.isArray(offsets) ? offsets : Array(arcLengths.length).fill(offsets);

  arcLengths.forEach((arcLength, index) => {
    const point = constantCurvatureCoordinates(
      referenceCurvature,
      arcLength,
      offsetArray[index] ?? 0,
    );
    tangent.push(point.tangent);
    left.push(point.left);
  });

  return { tangent, left };
}

export function createInitialState(
  axes: Variable[],
  options: InitialStateOptions = {},
): ExplorerState {
  if (axes.length < 1 || axes.length > 2 || new Set(axes).size !== axes.length) {
    throw new Error('FrenetExplorer requires one or two distinct axes.');
  }

  const quantity = options.quantity ?? 'arc-length-rate';
  if (
    quantity === 'coordinate-scale' &&
    (axes.length !== 1 || (axes[0] !== 'd' && axes[0] !== 'kappa'))
  ) {
    throw new Error('Coordinate-scale analysis requires d or kappa as its only axis.');
  }

  const curvatureSign = options.curvatureSign ?? 'positive';
  const scaleAnalysis = quantity === 'coordinate-scale';
  const scaleAxis = scaleAnalysis ? axes[0] : undefined;
  const curvature = curvatureSign === 'positive' ? 0.5 : -0.5;
  const lateralOffset = scaleAxis === 'kappa' ? (curvatureSign === 'positive' ? 1.5 : -1.5) : 0;
  const lateralRange: Range = curvatureSign === 'positive' ? [-1, 3] : [-3, 1];
  const curvatureRange: Range = curvatureSign === 'positive' ? [0.25, 1] : [-1, -0.25];

  const parameters: Parameters = {
    phi: 0,
    d: scaleAnalysis ? lateralOffset : 0,
    kappa: scaleAnalysis ? curvature : 0,
  };
  const bounds: Record<Variable, Range> = {
    phi: [...VARIABLE_SPECS.phi.limits],
    d: scaleAnalysis ? [...lateralRange] : [...VARIABLE_SPECS.d.limits],
    kappa: scaleAnalysis ? [...curvatureRange] : [...VARIABLE_SPECS.kappa.limits],
  };
  return {
    axes: [...axes],
    quantity,
    parameters: { ...parameters },
    selected: { ...parameters },
    bounds,
    ranges: Object.fromEntries(axes.map((variable) => [variable, [...bounds[variable]]])),
    valueBounds: scaleAnalysis ? [-1, 2] : [...DEFAULT_RATE_RANGE],
    valueRange: scaleAnalysis ? [-0.5, 1.5] : [...DEFAULT_RATE_RANGE],
  };
}

export function relationArrays(state: ExplorerState): {
  x: number[];
  values: Array<number | null>;
} {
  const variable = state.axes[0];
  if (!variable) throw new Error('A relation plot requires one axis.');
  const range = state.ranges[variable];
  if (!range) throw new Error(`Missing range for ${variable}.`);

  const x = linspace(range[0], range[1], VARIABLE_SPECS[variable].points2d);
  const values = x.map((value) => {
    const parameters = { ...state.parameters, [variable]: value };
    if (variable === 'phi' && Math.abs(Math.cos((value * Math.PI) / 180)) < DISPLAY_GAP_COSINE) {
      return null;
    }
    return quantityValue(state.quantity, parameters);
  });

  return { x, values };
}

export function surfaceArrays(state: ExplorerState): {
  x: number[];
  y: number[];
  z: Array<Array<number | null>>;
} {
  const [xVariable, yVariable] = state.axes;
  if (!xVariable || !yVariable) throw new Error('A surface plot requires two axes.');
  const xRange = state.ranges[xVariable];
  const yRange = state.ranges[yVariable];
  if (!xRange || !yRange) throw new Error('Missing surface axis range.');

  const x = linspace(xRange[0], xRange[1], VARIABLE_SPECS[xVariable].points3d);
  const y = linspace(yRange[0], yRange[1], VARIABLE_SPECS[yVariable].points3d);
  const z = y.map((yValue) =>
    x.map((xValue) => {
      const parameters = { ...state.parameters };
      parameters[xVariable] = xValue;
      parameters[yVariable] = yValue;
      if (
        state.axes.includes('phi') &&
        Math.abs(Math.cos((parameters.phi * Math.PI) / 180)) < DISPLAY_GAP_COSINE
      ) {
        return null;
      }
      return quantityValue(state.quantity, parameters);
    }),
  );

  return { x, y, z };
}

function flattenFinite(values: unknown, output: number[]): void {
  if (Array.isArray(values)) {
    values.forEach((value) => flattenFinite(value, output));
  } else if (typeof values === 'number' && Number.isFinite(values)) {
    output.push(values);
  }
}

export function automaticRange(values: unknown, clippingRange: Range): Range {
  const finite: number[] = [];
  flattenFinite(values, finite);
  const [clipLower, clipUpper] = clippingRange;
  if (finite.length === 0) return [clipLower, clipUpper];

  let lower = Math.max(Math.min(...finite), clipLower);
  let upper = Math.min(Math.max(...finite), clipUpper);
  if (clipLower <= 1 && 1 <= clipUpper) {
    lower = Math.min(lower, 1);
    upper = Math.max(upper, 1);
  }
  if (!(lower < upper)) {
    const center = clamp(lower, clipLower, clipUpper);
    const fallback = Math.max((clipUpper - clipLower) * 0.025, 1e-3);
    lower = Math.max(clipLower, center - fallback);
    upper = Math.min(clipUpper, center + fallback);
  }

  const padding = Math.max((upper - lower) * 0.06, 1e-6);
  return [Math.max(clipLower, lower - padding), Math.min(clipUpper, upper + padding)];
}

export function relationBoundaries(state: ExplorerState): RelationBoundary[] {
  const variable = state.axes[0];
  if (!variable) return [];
  const range = state.ranges[variable];
  if (!range) return [];
  const [lower, upper] = range;

  if (variable === 'phi') {
    return [-90, 90]
      .filter((value) => lower <= value && value <= upper)
      .map((position) => ({ kind: 'parameterization-failure', position }));
  }
  if (variable === 'd' && Math.abs(state.parameters.kappa) > 1e-12) {
    const position = 1 / state.parameters.kappa;
    return lower <= position && position <= upper
      ? [{ kind: 'coordinate-degeneracy', position }]
      : [];
  }
  if (variable === 'kappa' && Math.abs(state.parameters.d) > 1e-12) {
    const position = 1 / state.parameters.d;
    return lower <= position && position <= upper
      ? [{ kind: 'coordinate-degeneracy', position }]
      : [];
  }
  return [];
}

export function surfaceCoordinateDegeneracy(state: ExplorerState): SurfaceBoundary | null {
  const [xVariable, yVariable] = state.axes;
  if (!xVariable || !yVariable || yVariable === 'phi') return null;
  const xRange = state.ranges[xVariable];
  const yRange = state.ranges[yVariable];
  if (!xRange || !yRange) return null;

  const boundary: SurfaceBoundary = { x: [], y: [], z: [] };
  let previousPointWasVisible = false;
  for (const x of linspace(xRange[0], xRange[1], 401)) {
    const d = xVariable === 'd' ? x : state.parameters.d;
    const kappa = xVariable === 'kappa' ? x : state.parameters.kappa;
    const denominator = yVariable === 'd' ? kappa : d;
    const y = Math.abs(denominator) <= 1e-12 ? Number.NaN : 1 / denominator;
    const phiIsValid =
      xVariable !== 'phi' || Math.abs(Math.cos((x * Math.PI) / 180)) >= DISPLAY_GAP_COSINE;
    const visible = phiIsValid && Number.isFinite(y) && yRange[0] <= y && y <= yRange[1];

    if (visible) {
      boundary.x.push(x);
      boundary.y.push(y);
      boundary.z.push(0);
    } else if (previousPointWasVisible) {
      boundary.x.push(null);
      boundary.y.push(null);
      boundary.z.push(null);
    }
    previousPointWasVisible = visible;
  }

  return boundary.x.some((value) => value !== null) ? boundary : null;
}

export function geometryViewRanges(state: ExplorerState): { x: number; y: number } {
  const maximumOffset = Math.max(Math.abs(state.bounds.d[0]), Math.abs(state.bounds.d[1]), 0.5);
  const curvatureCenterExtent =
    state.quantity === 'coordinate-scale'
      ? 1 /
        Math.min(
          ...state.bounds.kappa
            .map((curvature) => Math.abs(curvature))
            .filter((curvature) => curvature > 1e-10),
        )
      : 0;
  const halfLength = Math.max(3, 1.5 * maximumOffset + 2);
  const lateralExtent = Math.max(1.5, maximumOffset + 0.75);
  return {
    x: Math.max(lateralExtent, maximumOffset + 1, curvatureCenterExtent + 0.75) + 0.25,
    y: halfLength + 0.25,
  };
}

type GeometryPoint = { left: number; tangent: number };
type GeometryLabel = { text: string; anchor: GeometryPoint; preferred: GeometryPoint };
type GeometryPolyline = { left: number[]; tangent: number[] };
type LabelBox = GeometryPoint & { halfWidth: number; halfHeight: number; cost: number };

const LABEL_DIRECTIONS: GeometryPoint[] = [
  { left: 0, tangent: 1 },
  { left: 1, tangent: 1 },
  { left: 1, tangent: 0 },
  { left: 1, tangent: -1 },
  { left: 0, tangent: -1 },
  { left: -1, tangent: -1 },
  { left: -1, tangent: 0 },
  { left: -1, tangent: 1 },
];
const LABEL_RADII = [1, 1.5, 2, 2.5] as const;

function segmentIntersectsLabel(
  start: GeometryPoint,
  end: GeometryPoint,
  label: LabelBox,
  padding: GeometryPoint,
): boolean {
  let entry = 0;
  let exit = 1;
  for (const axis of ['left', 'tangent'] as const) {
    const halfExtent =
      axis === 'left' ? label.halfWidth + padding.left : label.halfHeight + padding.tangent;
    const minimum = label[axis] - halfExtent;
    const maximum = label[axis] + halfExtent;
    const origin = start[axis];
    const delta = end[axis] - origin;
    if (Math.abs(delta) <= 1e-12) {
      if (origin < minimum || origin > maximum) return false;
      continue;
    }
    const first = (minimum - origin) / delta;
    const second = (maximum - origin) / delta;
    entry = Math.max(entry, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (entry > exit) return false;
  }
  return true;
}

function polylineIntersectsLabel(
  polyline: GeometryPolyline,
  label: LabelBox,
  padding: GeometryPoint,
): boolean {
  for (let index = 1; index < polyline.left.length; index += 1) {
    if (
      segmentIntersectsLabel(
        { left: polyline.left[index - 1]!, tangent: polyline.tangent[index - 1]! },
        { left: polyline.left[index]!, tangent: polyline.tangent[index]! },
        label,
        padding,
      )
    ) {
      return true;
    }
  }
  return false;
}

function layoutGeometryLabels(
  labels: GeometryLabel[],
  polylines: GeometryPolyline[],
  view: { x: number; y: number },
): GeometryPoint[] {
  const gap = { left: view.x * 0.025, tangent: view.y * 0.025 };
  const labelGap = { left: view.x * 0.012, tangent: view.y * 0.012 };
  const overlaps = (first: LabelBox, second: LabelBox) =>
    Math.abs(first.left - second.left) < first.halfWidth + second.halfWidth + labelGap.left &&
    Math.abs(first.tangent - second.tangent) <
      first.halfHeight + second.halfHeight + labelGap.tangent;
  const candidateSets = labels.map((label) => {
    const halfWidth = view.x * (label.text.length > 1 ? 0.09 : 0.055);
    const halfHeight = view.y * 0.065;
    const preferredLength = Math.hypot(label.preferred.left, label.preferred.tangent) || 1;
    const isAvailable = (candidate: LabelBox) =>
      candidate.left - candidate.halfWidth >= -view.x &&
      candidate.left + candidate.halfWidth <= view.x &&
      candidate.tangent - candidate.halfHeight >= -view.y &&
      candidate.tangent + candidate.halfHeight <= view.y &&
      !polylines.some((polyline) => polylineIntersectsLabel(polyline, candidate, gap));
    return LABEL_DIRECTIONS.flatMap((direction) => {
      const directionLength = Math.hypot(direction.left, direction.tangent);
      const alignment =
        (direction.left * label.preferred.left + direction.tangent * label.preferred.tangent) /
        (directionLength * preferredLength);
      for (const radius of LABEL_RADII) {
        const candidate: LabelBox = {
          left: label.anchor.left + direction.left * (halfWidth + 2 * gap.left) * radius,
          tangent:
            label.anchor.tangent + direction.tangent * (halfHeight + 2 * gap.tangent) * radius,
          halfWidth,
          halfHeight,
          cost: radius + 0.35 * (1 - alignment),
        };
        if (isAvailable(candidate)) return [candidate];
      }
      return [];
    }).sort((first, second) => first.cost - second.cost);
  });

  const order = labels
    .map((_, index) => index)
    .sort((first, second) => candidateSets[first]!.length - candidateSets[second]!.length);
  const selected: Array<LabelBox | undefined> = Array(labels.length);
  let solution: LabelBox[] | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  const search = (depth: number, cost: number) => {
    if (cost >= bestCost) return;
    if (depth === order.length) {
      solution = selected.map((candidate) => candidate!);
      bestCost = cost;
      return;
    }
    const labelIndex = order[depth]!;
    for (const candidate of candidateSets[labelIndex]!) {
      if (selected.some((placed) => placed && overlaps(candidate, placed))) continue;
      selected[labelIndex] = candidate;
      search(depth + 1, cost + candidate.cost);
      selected[labelIndex] = undefined;
    }
  };
  search(0, 0);
  if (!solution) throw new Error('Unable to place Frenet geometry labels without overlap.');
  return (solution as LabelBox[]).map(({ left, tangent }) => ({ left, tangent }));
}

export function geometryPayload(
  parameters: Parameters,
  view = { x: 1.75, y: 3.25 },
  extendGridToCurvatureCenter = false,
): GeometryPayload {
  const phi = (parameters.phi * Math.PI) / 180;
  let halfLength = Math.max(3, 1.5 * Math.abs(parameters.d) + 2);
  if (Math.abs(parameters.kappa) > 1e-10) {
    halfLength = Math.min(halfLength, 1.35 / Math.abs(parameters.kappa));
  }
  const curvatureCenterOffset =
    extendGridToCurvatureCenter && Math.abs(parameters.kappa) > 1e-10 ? 1 / parameters.kappa : null;
  const lateralExtent = Math.max(
    1.5,
    Math.abs(parameters.d) + 0.75,
    Math.abs(curvatureCenterOffset ?? 0),
  );
  const arcLengths = linspace(-halfLength, halfLength, 301);
  const path = sequenceCoordinates(parameters.kappa, arcLengths, 0);

  const parallelX: Array<number | null> = [];
  const parallelY: Array<number | null> = [];
  for (const offset of linspace(-lateralExtent, lateralExtent, 7)) {
    const coordinates = sequenceCoordinates(parameters.kappa, arcLengths, offset);
    parallelX.push(...coordinates.left, null);
    parallelY.push(...coordinates.tangent, null);
  }

  const normalX: Array<number | null> = [];
  const normalY: Array<number | null> = [];
  const normalOffsets = linspace(-lateralExtent, lateralExtent, 31);
  for (const arcLength of linspace(-halfLength, halfLength, 13)) {
    const coordinates = sequenceCoordinates(
      parameters.kappa,
      Array(normalOffsets.length).fill(arcLength),
      normalOffsets,
    );
    normalX.push(...coordinates.left, null);
    normalY.push(...coordinates.tangent, null);
  }

  const differentialLength = 1;
  const headingEnd = {
    left: parameters.d + differentialLength * Math.sin(phi),
    tangent: differentialLength * Math.cos(phi),
  };
  const scale = coordinateScale(parameters.d, parameters.kappa);
  const referenceArcLength =
    Math.abs(scale) <= COORDINATE_DEGENERACY_TOLERANCE
      ? null
      : (differentialLength * Math.cos(phi)) / scale;
  const localArcLimit =
    Math.abs(parameters.kappa) > 1e-10
      ? Math.PI / (3 * Math.abs(parameters.kappa))
      : Number.POSITIVE_INFINITY;
  const displayedReferenceArcLength =
    referenceArcLength === null ? null : clamp(referenceArcLength, -localArcLimit, localArcLimit);
  const referenceIncrementClipped =
    referenceArcLength !== null &&
    displayedReferenceArcLength !== null &&
    Math.abs(referenceArcLength - displayedReferenceArcLength) > 1e-10;
  const incrementArcLengths =
    displayedReferenceArcLength === null ? [] : linspace(0, displayedReferenceArcLength, 81);
  const referenceIncrement = sequenceCoordinates(parameters.kappa, incrementArcLengths, 0);
  const referenceIncrementEnd =
    displayedReferenceArcLength === null
      ? null
      : constantCurvatureCoordinates(parameters.kappa, displayedReferenceArcLength, 0);

  const arcRadius = 0.35;
  const headingAngles = linspace(0, phi, Math.max(2, Math.floor(Math.abs(phi) * 48) + 2));
  const headingArc = {
    left: headingAngles.map((angle) => parameters.d + arcRadius * Math.sin(angle)),
    tangent: headingAngles.map((angle) => arcRadius * Math.cos(angle)),
  };
  const referenceMidpoint = constantCurvatureCoordinates(
    parameters.kappa,
    (displayedReferenceArcLength ?? 0) / 2,
    0,
  );
  const referenceMidpointAngle = (parameters.kappa * (displayedReferenceArcLength ?? 0)) / 2;
  const referenceNormal = {
    left: Math.cos(referenceMidpointAngle),
    tangent: -Math.sin(referenceMidpointAngle),
  };
  const headingMidpoint = {
    left: (parameters.d + headingEnd.left) / 2,
    tangent: headingEnd.tangent / 2,
  };
  const headingSideOfReference =
    (headingMidpoint.left - referenceMidpoint.left) * referenceNormal.left +
    (headingMidpoint.tangent - referenceMidpoint.tangent) * referenceNormal.tangent;
  const headingAwayFromReference = {
    left: headingMidpoint.left - referenceMidpoint.left,
    tangent: headingMidpoint.tangent - referenceMidpoint.tangent,
  };
  const headingAwayLength = Math.hypot(
    headingAwayFromReference.left,
    headingAwayFromReference.tangent,
  );
  const labelDefinitions = [
    {
      key: 'Δs',
      visible: displayedReferenceArcLength !== null,
      anchor: referenceMidpoint,
      preferred: {
        left: referenceNormal.left * (headingSideOfReference >= 0 ? -1 : 1),
        tangent: referenceNormal.tangent * (headingSideOfReference >= 0 ? -1 : 1),
      },
    },
    {
      key: 'd',
      visible: Math.abs(parameters.d) >= 0.06,
      anchor: { left: parameters.d / 2, tangent: 0 },
      preferred: { left: 0, tangent: (referenceArcLength ?? 0) >= 0 ? -1 : 1 },
    },
    {
      key: 'Δℓ',
      visible: true,
      anchor: headingMidpoint,
      preferred:
        headingAwayLength > 1e-10
          ? {
              left: headingAwayFromReference.left / headingAwayLength,
              tangent: headingAwayFromReference.tangent / headingAwayLength,
            }
          : { left: Math.cos(phi), tangent: -Math.sin(phi) },
    },
    {
      key: 'φ',
      visible: Math.abs(parameters.phi) >= 2,
      anchor: {
        left: parameters.d + arcRadius * Math.sin(phi / 2),
        tangent: arcRadius * Math.cos(phi / 2),
      },
      preferred: { left: Math.sin(phi / 2), tangent: Math.cos(phi / 2) },
    },
  ];
  const activeLabels = labelDefinitions.filter(({ visible }) => visible);
  const labelPositions = layoutGeometryLabels(
    activeLabels.map(({ key, anchor, preferred }) => ({ text: key, anchor, preferred })),
    [
      path,
      referenceIncrement,
      { left: [0, parameters.d], tangent: [0, 0] },
      { left: [parameters.d, parameters.d], tangent: [0, 0.8 * differentialLength] },
      {
        left: referenceIncrement.left,
        tangent: referenceIncrement.tangent,
      },
      { left: [parameters.d, headingEnd.left], tangent: [0, headingEnd.tangent] },
      headingArc,
    ],
    view,
  );
  const labelsByKey = new Map(
    activeLabels.map(({ key }, index) => [key, labelPositions[index]!] as const),
  );
  const labelKeys = ['Δs', 'd', 'Δℓ', 'φ'];

  return {
    parallelGrid: { x: parallelX, y: parallelY, text: [] },
    normalGrid: { x: normalX, y: normalY, text: [] },
    referencePath: { x: path.left, y: path.tangent, text: [] },
    referenceIncrement: {
      x: referenceIncrement.left,
      y: referenceIncrement.tangent,
      text: [],
    },
    lateralOffset: {
      x: [0, parameters.d],
      y: [0, 0],
      text: [],
    },
    projectionGuide: {
      x: [parameters.d, parameters.d],
      y: [0, 0.8 * differentialLength],
      text: [],
    },
    trajectoryIncrement: {
      x: [parameters.d, headingEnd.left],
      y: [0, headingEnd.tangent],
      text: [],
    },
    headingAngle: {
      x: headingArc.left,
      y: headingArc.tangent,
      text: [],
    },
    endpoints: {
      x: [
        0,
        parameters.d,
        referenceIncrementClipped ? null : (referenceIncrementEnd?.left ?? null),
        headingEnd.left,
      ],
      y: [
        0,
        0,
        referenceIncrementClipped ? null : (referenceIncrementEnd?.tangent ?? null),
        headingEnd.tangent,
      ],
      text: [],
    },
    labels: {
      x: labelKeys.map((key) => labelsByKey.get(key)?.left ?? null),
      y: labelKeys.map((key) => labelsByKey.get(key)?.tangent ?? null),
      text: labelKeys.map((key) => (labelsByKey.has(key) ? key : null)),
    },
    continuation: {
      x: referenceIncrementClipped && referenceIncrementEnd ? [referenceIncrementEnd.left] : [],
      y: referenceIncrementClipped && referenceIncrementEnd ? [referenceIncrementEnd.tangent] : [],
      text: referenceIncrementClipped ? ['…'] : [],
    },
  };
}
