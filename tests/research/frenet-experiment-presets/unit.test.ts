import { describe, expect, it } from 'vitest';
import {
  coordinateScale,
  createInitialState,
  relationArrays,
  relationBoundaries,
} from '@sshawn9/content-ui/frenet-explorer/model';

describe('Frenet experiment presets', () => {
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
    const positiveKappa = createInitialState(['kappa'], {
      quantity: 'coordinate-scale',
      curvatureSign: 'positive',
    });
    const negativeKappa = createInitialState(['kappa'], {
      quantity: 'coordinate-scale',
      curvatureSign: 'negative',
    });
    expect(positive.parameters.kappa).toBeGreaterThan(0);
    expect(positive.ranges.d).toEqual([-1, 3]);
    expect(relationArrays(positive).values).toContain(0);
    expect(negative.parameters.kappa).toBeLessThan(0);
    expect(negative.ranges.d).toEqual([-3, 1]);
    expect(relationArrays(negative).values).toContain(0);
    expect(positiveKappa.parameters.d).toBe(1.5);
    expect(positiveKappa.ranges.kappa).toEqual([0.25, 1]);
    expect(relationBoundaries(positiveKappa)).toEqual([
      { kind: 'coordinate-degeneracy', position: 2 / 3 },
    ]);
    expect(negativeKappa.parameters.d).toBe(-1.5);
    expect(negativeKappa.ranges.kappa).toEqual([-1, -0.25]);
    expect(relationBoundaries(negativeKappa)).toEqual([
      { kind: 'coordinate-degeneracy', position: -2 / 3 },
    ]);
  });
});
