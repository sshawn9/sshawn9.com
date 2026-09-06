import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  isCoordinateDegenerate,
  relationArrays,
  relationBoundaries,
} from '@sshawn9/content-ui/frenet-explorer/model';

describe('Frenet relation boundaries', () => {
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

  it('distinguishes coordinate degeneration from parameterization failure', () => {
    const state = createInitialState(['d']);
    state.parameters.kappa = 2;
    expect(relationBoundaries(state)).toEqual([{ kind: 'coordinate-degeneracy', position: 0.5 }]);
    expect(isCoordinateDegenerate(0.5, 2)).toBe(true);
  });
});
