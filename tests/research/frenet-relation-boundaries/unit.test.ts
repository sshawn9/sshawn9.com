import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  isCoordinateDegenerate,
  relationBoundaries,
} from '@sshawn9/content-ui/frenet-explorer/model';

describe('Frenet relation boundaries', () => {
  it('identifies the coordinate-degeneration boundary at dκ = 1', () => {
    const state = createInitialState(['d']);
    state.parameters.kappa = 2;
    expect(relationBoundaries(state)).toEqual([{ kind: 'coordinate-degeneracy', position: 0.5 }]);
    expect(isCoordinateDegenerate(0.5, 2)).toBe(true);
  });
});
