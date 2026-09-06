import { describe, expect, it } from 'vitest';
import { geometryPayload } from '@sshawn9/content-ui/frenet-explorer/model';

describe('Frenet reference increment branch', () => {
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
    const within = geometryPayload({ phi: 0, d: 1, kappa: 0.5 }, { x: 5, y: 7 }, true);
    const beyond = geometryPayload({ phi: 0, d: 1.2, kappa: 0.5 }, { x: 5, y: 7 }, true);
    expect(within.endpoints.x[2]).not.toBeNull();
    expect(within.continuation.text).toEqual([]);
    expect(beyond.endpoints.x[2]).toBeNull();
    expect(beyond.continuation.text).toEqual(['…']);
  });
});
