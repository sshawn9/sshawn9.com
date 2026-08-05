export type Variable = 'phi' | 'd' | 'kappa';
export type Range = [number, number];

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
  parameters: Parameters;
  selected: Parameters;
  bounds: Record<Variable, Range>;
  ranges: Partial<Record<Variable, Range>>;
  rateBounds: Range;
  rateRange: Range;
};

export type GeometryTracePayload = {
  x: Array<number | null>;
  y: Array<number | null>;
  text: Array<string | null>;
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

export function createInitialState(axes: Variable[]): ExplorerState {
  if (axes.length < 1 || axes.length > 2 || new Set(axes).size !== axes.length) {
    throw new Error('FrenetExplorer requires one or two distinct axes.');
  }

  const parameters: Parameters = { phi: 0, d: 0, kappa: 0 };
  return {
    axes: [...axes],
    parameters: { ...parameters },
    selected: { ...parameters },
    bounds: {
      phi: [...VARIABLE_SPECS.phi.limits],
      d: [...VARIABLE_SPECS.d.limits],
      kappa: [...VARIABLE_SPECS.kappa.limits],
    },
    ranges: Object.fromEntries(
      axes.map((variable) => [variable, [...VARIABLE_SPECS[variable].limits]]),
    ),
    rateBounds: [...DEFAULT_RATE_RANGE],
    rateRange: [...DEFAULT_RATE_RANGE],
  };
}

export function relationArrays(state: ExplorerState): {
  x: number[];
  rate: Array<number | null>;
} {
  const variable = state.axes[0];
  if (!variable) throw new Error('A relation plot requires one axis.');
  const range = state.ranges[variable];
  if (!range) throw new Error(`Missing range for ${variable}.`);

  const x = linspace(range[0], range[1], VARIABLE_SPECS[variable].points2d);
  const rate = x.map((value) => {
    const phi = variable === 'phi' ? value : state.parameters.phi;
    const d = variable === 'd' ? value : state.parameters.d;
    const kappa = variable === 'kappa' ? value : state.parameters.kappa;
    if (variable === 'phi' && Math.abs(Math.cos((value * Math.PI) / 180)) < DISPLAY_GAP_COSINE) {
      return null;
    }
    return arcLengthRate(phi, d, kappa);
  });

  return { x, rate };
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
      return arcLengthRate(parameters.phi, parameters.d, parameters.kappa);
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

export function singularPositions(state: ExplorerState): number[] {
  const variable = state.axes[0];
  if (!variable) return [];
  const range = state.ranges[variable];
  if (!range) return [];
  const [lower, upper] = range;

  if (variable === 'phi') return [-90, 90].filter((value) => lower <= value && value <= upper);
  if (variable === 'd' && Math.abs(state.parameters.kappa) > 1e-12) {
    const value = 1 / state.parameters.kappa;
    return lower <= value && value <= upper ? [value] : [];
  }
  if (variable === 'kappa' && Math.abs(state.parameters.d) > 1e-12) {
    const value = 1 / state.parameters.d;
    return lower <= value && value <= upper ? [value] : [];
  }
  return [];
}

export function geometryViewRanges(state: ExplorerState): { x: number; y: number } {
  const maximumOffset = Math.max(Math.abs(state.bounds.d[0]), Math.abs(state.bounds.d[1]), 0.5);
  const halfLength = Math.max(3, 1.5 * maximumOffset + 2);
  const lateralExtent = Math.max(1.5, maximumOffset + 0.75);
  return {
    x: Math.max(lateralExtent, maximumOffset + 1) + 0.25,
    y: halfLength + 0.25,
  };
}

export function geometryPayload(parameters: Parameters): GeometryTracePayload[] {
  const phi = (parameters.phi * Math.PI) / 180;
  let halfLength = Math.max(3, 1.5 * Math.abs(parameters.d) + 2);
  if (Math.abs(parameters.kappa) > 1e-10) {
    halfLength = Math.min(halfLength, 1.35 / Math.abs(parameters.kappa));
  }
  const lateralExtent = Math.max(1.5, Math.abs(parameters.d) + 0.75);
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

  const arrowLength = 1;
  const arcRadius = 0.35;
  const headingAngles = linspace(0, phi, Math.max(2, Math.floor(Math.abs(phi) * 48) + 2));
  const headingArcText: Array<string | null> = Array(headingAngles.length).fill(null);
  headingArcText[headingArcText.length - 1] = 'φ';
  const coincidentPosition = Math.abs(parameters.d) <= 1e-10;
  const coincidentHeading = Math.abs(phi) <= 1e-10;

  return [
    { x: parallelX, y: parallelY, text: [] },
    { x: normalX, y: normalY, text: [] },
    { x: path.left, y: path.tangent, text: [] },
    {
      x: [0, 0.5 * parameters.d, parameters.d],
      y: [0, 0, 0],
      text: [null, 'd', null],
    },
    {
      x: [0, 0],
      y: [0, arrowLength],
      text: [null, coincidentHeading ? null : 'T'],
    },
    {
      x: [parameters.d, parameters.d],
      y: [0, 0.8 * arrowLength],
      text: [],
    },
    {
      x: [parameters.d, parameters.d + arrowLength * Math.sin(phi)],
      y: [0, arrowLength * Math.cos(phi)],
      text: [null, coincidentHeading ? 'eθ = T' : 'eθ'],
    },
    {
      x: headingAngles.map((angle) => parameters.d + arcRadius * Math.sin(angle)),
      y: headingAngles.map((angle) => arcRadius * Math.cos(angle)),
      text: headingArcText,
    },
    {
      x: [0, parameters.d],
      y: [0, 0],
      text: coincidentPosition ? ['r(s) = z', null] : ['r(s)', 'z'],
    },
  ];
}
