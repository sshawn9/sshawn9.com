import { describe, expect, it } from 'vitest';
import {
  arcLengthRate,
  automaticRange,
  constantCurvatureCoordinates,
  createInitialState,
  geometryPayload,
  relationArrays,
  singularPositions,
  surfaceArrays,
} from '../../src/content/blog/frenet-arc-length-conversion/frenet-model';

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
    expect(arrays.rate.some((value) => value === null)).toBe(true);
    expect(singularPositions(state)).toEqual([-90, 90]);
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

    expect(payload).toHaveLength(9);
    expect(payload[2]?.x.length).toBe(301);
    expect(payload[8]?.text).toEqual(['r(s)', 'z']);
  });
});
