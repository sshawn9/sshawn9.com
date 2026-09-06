import { describe, expect, it } from 'vitest';
import {
  arcLengthRate,
  constantCurvatureCoordinates,
} from '@sshawn9/content-ui/frenet-explorer/model';

describe('Frenet rate and mathematical limits', () => {
  it('evaluates conversion rates and preserves singular and straight-path limits', () => {
    expect(arcLengthRate(0, 0, 0)).toBe(1);
    expect(arcLengthRate(60, 0.2, 0.1)).toBeCloseTo(1.96, 12);
    expect(arcLengthRate(90, 0, 0)).toBeNull();
    expect(constantCurvatureCoordinates(0, 2.5, -0.3)).toEqual({ tangent: 2.5, left: -0.3 });
  });
});
