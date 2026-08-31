import { describe, expect, it } from 'vitest';
import {
  arcLengthRate,
  automaticRange,
  constantCurvatureCoordinates,
  coordinateScale,
  createInitialState,
  geometryPayload,
  isCoordinateDegenerate,
  relationBoundaries,
  relationArrays,
  surfaceCoordinateDegeneracy,
  surfaceArrays,
} from '@sshawn9/content-ui/frenet-explorer/model';

describe('Frenet arc-length model', () => {
  it('evaluates the conversion rate and preserves its singularity', () => {
    expect(arcLengthRate(0, 0, 0)).toBe(1);
    expect(arcLengthRate(60, 0.2, 0.1)).toBeCloseTo(1.96, 12);
    expect(arcLengthRate(90, 0, 0)).toBeNull();
  });

  it('uses the straight-path limit for zero curvature', () => {
    expect(constantCurvatureCoordinates(0, 2.5, -0.3)).toEqual({
      tangent: 2.5,
      left: -0.3,
    });
  });

  it('samples relation curves without drawing through phi singularities', () => {
    const state = createInitialState(['phi']);
    state.bounds.phi = [-100, 100];
    state.ranges.phi = [-100, 100];
    const arrays = relationArrays(state);

    expect(arrays.x).toHaveLength(1201);
    expect(arrays.values.some((value) => value === null)).toBe(true);
    expect(relationBoundaries(state)).toEqual([
      { kind: 'parameterization-failure', position: -90 },
      { kind: 'parameterization-failure', position: 90 },
    ]);
  });

  it('configures complementary d-axis and kappa-axis experiments for both curvature signs', () => {
    expect(coordinateScale(10, 0.1)).toBe(0);
    expect(coordinateScale(-10, -0.1)).toBe(0);

    const positive = createInitialState(['d'], {
      quantity: 'coordinate-scale',
      curvatureSign: 'positive',
    });
    const negative = createInitialState(['d'], {
      quantity: 'coordinate-scale',
      curvatureSign: 'negative',
    });
    const positiveByCurvature = createInitialState(['kappa'], {
      quantity: 'coordinate-scale',
      curvatureSign: 'positive',
    });
    const negativeByCurvature = createInitialState(['kappa'], {
      quantity: 'coordinate-scale',
      curvatureSign: 'negative',
    });

    expect(positive.parameters.kappa).toBeGreaterThan(0);
    expect(positive.ranges.d).toEqual([-1, 3]);
    expect(relationArrays(positive).values).toContain(0);
    expect(negative.parameters.kappa).toBeLessThan(0);
    expect(negative.ranges.d).toEqual([-3, 1]);
    expect(relationArrays(negative).values).toContain(0);
    expect(positiveByCurvature.parameters.d).toBe(1.5);
    expect(positiveByCurvature.ranges.kappa).toEqual([0.25, 1]);
    expect(relationBoundaries(positiveByCurvature)).toEqual([
      { kind: 'coordinate-degeneracy', position: 2 / 3 },
    ]);
    expect(negativeByCurvature.parameters.d).toBe(-1.5);
    expect(negativeByCurvature.ranges.kappa).toEqual([-1, -0.25]);
    expect(relationBoundaries(negativeByCurvature)).toEqual([
      { kind: 'coordinate-degeneracy', position: -2 / 3 },
    ]);
  });

  it('distinguishes Frenet coordinate degeneration from parameterization failure', () => {
    const relationState = createInitialState(['d']);
    relationState.parameters.kappa = 2;
    expect(relationBoundaries(relationState)).toEqual([
      { kind: 'coordinate-degeneracy', position: 0.5 },
    ]);
    expect(isCoordinateDegenerate(0.5, 2)).toBe(true);
  });

  it('draws only the true coordinate-degeneration curve inside a surface range', () => {
    const state = createInitialState(['d', 'kappa']);
    state.ranges.d = [-2, 2];
    state.ranges.kappa = [-2, 2];
    const boundary = surfaceCoordinateDegeneracy(state);
    const points = boundary?.x.flatMap((d, index) => {
      const kappa = boundary.y[index];
      return d === null || kappa == null ? [] : ([[d, kappa]] as const);
    });

    expect(points?.length).toBeGreaterThan(0);
    expect(points?.every(([d, kappa]) => Math.abs(d * kappa - 1) < 1e-12)).toBe(true);
    expect(boundary?.z.filter((value) => value !== null).every((value) => value === 0)).toBe(true);

    const noIntersection = createInitialState(['phi', 'd']);
    expect(surfaceCoordinateDegeneracy(noIntersection)).toBeNull();
  });

  it('creates a surface with dimensions matching the selected variables', () => {
    const state = createInitialState(['phi', 'd']);
    const surface = surfaceArrays(state);

    expect(surface.x).toHaveLength(121);
    expect(surface.y).toHaveLength(61);
    expect(surface.z).toHaveLength(61);
    expect(surface.z[0]).toHaveLength(121);
  });

  it('clips automatic display ranges while retaining the dℓ/ds = 1 reference', () => {
    expect(automaticRange([1.4, 1.6], [0, 2])).toEqual([0.964, 1.6360000000000001]);
    expect(automaticRange([100, 200], [0, 2])).toEqual([0.94, 2]);
  });

  it('produces the complete linked Frenet geometry payload', () => {
    const payload = geometryPayload({ phi: 12, d: 0.2, kappa: 0.05 });

    expect(Object.keys(payload)).toHaveLength(11);
    expect(payload.referencePath.x.length).toBe(301);
    expect(payload.labels.text).toEqual(['Δs', 'd', 'Δℓ', 'φ']);
    expect(
      Object.values(payload)
        .flatMap((trace) => trace.text)
        .filter(Boolean),
    ).toEqual(['Δs', 'd', 'Δℓ', 'φ']);

    const heading = payload.trajectoryIncrement;
    const referenceIncrement = payload.referenceIncrement;
    const headingLength = Math.hypot(
      heading.x.at(-1)! - heading.x[0]!,
      heading.y.at(-1)! - heading.y[0]!,
    );
    expect(headingLength).toBeCloseTo(1, 12);

    expect(referenceIncrement.y.at(-1)).toBeGreaterThan(0);

    const labels = payload.labels;
    const dsLabel = [labels.x[0]!, labels.y[0]!];
    const headingLabel = [labels.x[2]!, labels.y[2]!];
    expect(Math.hypot(dsLabel[0] - headingLabel[0], dsLabel[1] - headingLabel[1])).toBeGreaterThan(
      0.5,
    );
  });

  it('separates coincident Δs and Δℓ labels and hides degenerate d and φ labels', () => {
    const payload = geometryPayload({ phi: 0, d: 0, kappa: 0 });
    const labels = payload.labels;

    expect(labels.text).toEqual(['Δs', null, 'Δℓ', null]);
    expect(Math.abs(labels.x[0]! - labels.x[2]!)).toBeGreaterThan(0.4);
    expect(payload.endpoints.x).toEqual([0, 0, 0, 0]);
    expect(payload.endpoints.y).toEqual([0, 0, 1, 1]);
  });

  it('extends the coordinate grid to the projection-point curvature center', () => {
    const positive = geometryPayload({ phi: 0, d: 0, kappa: 0.5 }, { x: 5, y: 6 }, true);
    const negative = geometryPayload({ phi: 0, d: 0, kappa: -0.5 }, { x: 5, y: 6 }, true);

    expect(positive.normalGrid.x).toContain(2);
    expect(positive.normalGrid.y).toContain(0);
    expect(negative.normalGrid.x).toContain(-2);
    expect(negative.normalGrid.y).toContain(0);
    expect(Object.values(positive).flatMap((trace) => trace.text)).not.toContain('Cᵣ');
    expect(Object.values(negative).flatMap((trace) => trace.text)).not.toContain('Cᵣ');
  });

  it('draws the local reference increment on the branch selected by ds/dℓ', () => {
    const positive = geometryPayload({ phi: 0, d: 1.6, kappa: 0.5 }, { x: 5, y: 7 }, true);
    const negative = geometryPayload({ phi: 0, d: 2.4, kappa: 0.5 }, { x: 5, y: 7 }, true);
    const degenerate = geometryPayload({ phi: 0, d: 2, kappa: 0.5 }, { x: 5, y: 7 }, true);

    expect(positive.referenceIncrement.y.at(-1)).toBeGreaterThan(0);
    expect(negative.referenceIncrement.y.at(-1)).toBeLessThan(0);
    expect(negative.endpoints.x[2]).toBeNull();
    expect(negative.endpoints.y[2]).toBeNull();
    expect(negative.continuation.text).toEqual(['…']);
    expect(degenerate.referenceIncrement.x).toEqual([]);
    expect(degenerate.referenceIncrement.y).toEqual([]);
    expect(degenerate.endpoints.x[2]).toBeNull();
    expect(degenerate.endpoints.y[2]).toBeNull();
  });

  it('draws up to one sixth of the osculating circle before using continuation', () => {
    const withinLimit = geometryPayload({ phi: 0, d: 1, kappa: 0.5 }, { x: 5, y: 7 }, true);
    const beyondLimit = geometryPayload({ phi: 0, d: 1.2, kappa: 0.5 }, { x: 5, y: 7 }, true);

    expect(withinLimit.endpoints.x[2]).not.toBeNull();
    expect(withinLimit.continuation.text).toEqual([]);
    expect(beyondLimit.endpoints.x[2]).toBeNull();
    expect(beyondLimit.continuation.text).toEqual(['…']);
  });

  it('finds label layouts throughout the normal and coordinate-scale domains', () => {
    for (const phi of [-30, -12, 0, 12, 30]) {
      for (const d of [-0.5, 0, 0.5]) {
        for (const kappa of [-0.1, 0, 0.1]) {
          expect(() => geometryPayload({ phi, d, kappa }, { x: 1.75, y: 3.25 })).not.toThrow();
        }
      }
    }
    for (const d of [-3, -2.001, -2, -1.999, 0, 1.999, 2, 2.001, 3]) {
      for (const kappa of [-1, -0.5, 0.5, 1]) {
        expect(() => geometryPayload({ phi: 0, d, kappa }, { x: 4.25, y: 6.75 })).not.toThrow();
      }
    }
  });
});
