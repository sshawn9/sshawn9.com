import { closestPointOnBezier, evalDeCasteljau, tangent } from 'flo-bezier3';

export type Point = { x: number; y: number };

type Wheel = {
  axle: 'front' | 'rear';
  side: 'left' | 'right';
  center: Point;
  angle: number;
};

export type MotionControlScene = {
  vehicle: Point;
  projection: Point;
  tangent: Point;
  normal: Point;
  heading: Point;
  bodyLeft: Point;
  pathAngle: number;
  headingAngle: number;
  headingError: number;
  lateralError: number;
  steeringAngle: number;
  wheels: Wheel[];
};

export const MOTION_CONTROL_VIEW_BOX = {
  width: 960,
  height: 480,
} as const;

const TESLA_MODEL_3_DIMENSIONS_MM = {
  length: 4_720,
  width: 1_850,
  wheelbase: 2_875,
  frontOverhang: 868,
  rearOverhang: 977,
  track: 1_584,
} as const;
const DIAGRAM_WHEELBASE = 78;
const MODEL_3_SCALE = DIAGRAM_WHEELBASE / TESLA_MODEL_3_DIMENSIONS_MM.wheelbase;

export const MOTION_CONTROL_MODEL = {
  headingDegrees: -9,
  lateralFeedbackGain: 0.006,
  maximumSteeringDegrees: 28,
  wheelbase: DIAGRAM_WHEELBASE,
  bodyLength: TESLA_MODEL_3_DIMENSIONS_MM.length * MODEL_3_SCALE,
  bodyWidth: TESLA_MODEL_3_DIMENSIONS_MM.width * MODEL_3_SCALE,
  frontOverhang: TESLA_MODEL_3_DIMENSIONS_MM.frontOverhang * MODEL_3_SCALE,
  rearOverhang: TESLA_MODEL_3_DIMENSIONS_MM.rearOverhang * MODEL_3_SCALE,
  halfTrack: (TESLA_MODEL_3_DIMENSIONS_MM.track * MODEL_3_SCALE) / 2,
} as const;

export const REFERENCE_CURVES: number[][][] = [
  [
    [45, 310],
    [130, 345],
    [230, 455],
    [405, 330],
  ],
  [
    [405, 330],
    [510, 255],
    [735, 35],
    [920, 180],
  ],
];

export const REFERENCE_PATH = REFERENCE_CURVES.map((curve, index) => {
  const [start, control1, control2, end] = curve;
  const move = index === 0 ? `M ${start[0]} ${start[1]} ` : '';
  return `${move}C ${control1[0]} ${control1[1]} ${control2[0]} ${control2[1]} ${end[0]} ${end[1]}`;
}).join(' ');

const DRAG_BOUNDS = {
  left: 66,
  right: MOTION_CONTROL_VIEW_BOX.width - 76,
  top: 66,
  bottom: MOTION_CONTROL_VIEW_BOX.height - 62,
} as const;

const add = (left: Point, right: Point): Point => ({
  x: left.x + right.x,
  y: left.y + right.y,
});

const subtract = (left: Point, right: Point): Point => ({
  x: left.x - right.x,
  y: left.y - right.y,
});

const scale = (point: Point, value: number): Point => ({
  x: point.x * value,
  y: point.y * value,
});

const dot = (left: Point, right: Point): number => left.x * right.x + left.y * right.y;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const toPoint = (point: number[]): Point => ({ x: point[0] ?? 0, y: point[1] ?? 0 });

const normalize = (point: Point): Point => {
  const length = Math.hypot(point.x, point.y);
  return length > Number.EPSILON ? scale(point, 1 / length) : { x: 1, y: 0 };
};

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

const referenceSegment = (parameter: number): { curve: number[][]; localParameter: number } => {
  const scaled = clamp(parameter, 0, 1) * REFERENCE_CURVES.length;
  const index = Math.min(Math.floor(scaled), REFERENCE_CURVES.length - 1);
  return {
    curve: REFERENCE_CURVES[index],
    localParameter: scaled - index,
  };
};

const pointOnReference = (parameter: number): Point => {
  const segment = referenceSegment(parameter);
  return toPoint(evalDeCasteljau(segment.curve, segment.localParameter));
};

const frameOnReference = (parameter: number): { tangent: Point; normal: Point } => {
  const segment = referenceSegment(parameter);
  const pathTangent = normalize(toPoint(tangent(segment.curve, segment.localParameter)));
  return {
    tangent: pathTangent,
    // SVG's y-axis points down. This is the visual representation of the
    // mathematical left normal J T.
    normal: { x: pathTangent.y, y: -pathTangent.x },
  };
};

const transformVehiclePoint = (
  origin: Point,
  heading: Point,
  bodyLeft: Point,
  longitudinal: number,
  lateral: number,
): Point => add(origin, add(scale(heading, longitudinal), scale(bodyLeft, lateral)));

function wheelSteeringAngle(steeringAngle: number, lateral: number): number {
  if (Math.abs(steeringAngle) < 1e-6) return 0;
  const turnRadius = MOTION_CONTROL_MODEL.wheelbase / Math.tan(steeringAngle);
  return Math.atan(MOTION_CONTROL_MODEL.wheelbase / (turnRadius - lateral));
}

export function clampMotionControlVehicle(point: Point): Point {
  return {
    x: clamp(point.x, DRAG_BOUNDS.left, DRAG_BOUNDS.right),
    y: clamp(point.y, DRAG_BOUNDS.top, DRAG_BOUNDS.bottom),
  };
}

export function deriveMotionControlScene(rawVehicle: Point): MotionControlScene {
  const vehicle = clampMotionControlVehicle(rawVehicle);
  const closest = REFERENCE_CURVES.map((curve, index) => {
    const result = closestPointOnBezier(curve, [vehicle.x, vehicle.y]);
    const dx = result.p[0] - vehicle.x;
    const dy = result.p[1] - vehicle.y;
    return {
      ...result,
      distanceSquared: dx * dx + dy * dy,
      globalParameter: (index + result.t) / REFERENCE_CURVES.length,
    };
  }).reduce((best, candidate) =>
    candidate.distanceSquared < best.distanceSquared ? candidate : best,
  );
  const projection = toPoint(closest.p);
  const referenceFrame = frameOnReference(closest.globalParameter);
  const lateralError = dot(subtract(vehicle, projection), referenceFrame.normal);
  const pathAngle = Math.atan2(referenceFrame.tangent.y, referenceFrame.tangent.x);
  const headingAngle = radians(MOTION_CONTROL_MODEL.headingDegrees);
  const heading = { x: Math.cos(headingAngle), y: Math.sin(headingAngle) };
  const bodyLeft = { x: Math.sin(headingAngle), y: -Math.cos(headingAngle) };
  const headingError = wrapAngle(pathAngle - headingAngle);
  const maximumSteering = radians(MOTION_CONTROL_MODEL.maximumSteeringDegrees);
  const steeringAngle = clamp(
    -MOTION_CONTROL_MODEL.lateralFeedbackGain * lateralError,
    -maximumSteering,
    maximumSteering,
  );
  const wheels: Wheel[] = (['rear', 'front'] as const).flatMap((axle) =>
    (['left', 'right'] as const).map((side) => {
      const lateral =
        side === 'left' ? MOTION_CONTROL_MODEL.halfTrack : -MOTION_CONTROL_MODEL.halfTrack;
      const localSteering = axle === 'front' ? wheelSteeringAngle(steeringAngle, lateral) : 0;
      return {
        axle,
        side,
        center: transformVehiclePoint(
          vehicle,
          heading,
          bodyLeft,
          axle === 'front' ? MOTION_CONTROL_MODEL.wheelbase : 0,
          lateral,
        ),
        // Mathematical positive steering is counter-clockwise, while SVG's
        // positive rotation follows the screen's clockwise y-down convention.
        angle: headingAngle - localSteering,
      };
    }),
  );

  return {
    vehicle,
    projection,
    tangent: referenceFrame.tangent,
    normal: referenceFrame.normal,
    heading,
    bodyLeft,
    pathAngle,
    headingAngle,
    headingError,
    lateralError,
    steeringAngle,
    wheels,
  } satisfies MotionControlScene;
}

const initialParameter = 0.6;
const initialPoint = pointOnReference(initialParameter);
const initialFrame = frameOnReference(initialParameter);

export const MOTION_CONTROL_INITIAL_POSITION = clampMotionControlVehicle(
  add(initialPoint, scale(initialFrame.normal, 24)),
);

export function pointAlong(point: Point, direction: Point, distance: number): Point {
  return add(point, scale(direction, distance));
}

export function angleDegrees(angle: number): number {
  return (angle * 180) / Math.PI;
}

export function arcPath(
  center: Point,
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  const delta = wrapAngle(endAngle - startAngle);
  const end = startAngle + delta;
  const startPoint = {
    x: center.x + radius * Math.cos(startAngle),
    y: center.y + radius * Math.sin(startAngle),
  };
  const endPoint = {
    x: center.x + radius * Math.cos(end),
    y: center.y + radius * Math.sin(end),
  };
  return `M ${startPoint.x} ${startPoint.y} A ${radius} ${radius} 0 0 ${delta >= 0 ? 1 : 0} ${endPoint.x} ${endPoint.y}`;
}
