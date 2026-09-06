import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  surfaceCoordinateDegeneracy,
} from '@sshawn9/content-ui/frenet-explorer/model';

describe('Frenet surface degeneracy', () => {
  it('draws only the true coordinate-degeneration curve inside the surface range', () => {
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
    expect(surfaceCoordinateDegeneracy(createInitialState(['phi', 'd']))).toBeNull();
  });
});
