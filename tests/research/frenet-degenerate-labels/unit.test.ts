import { describe, expect, it } from 'vitest';
import { geometryPayload } from '@sshawn9/content-ui/frenet-explorer/model';

describe('Frenet degenerate labels', () => {
  it('separates coincident increment labels and hides degenerate d and phi labels', () => {
    const payload = geometryPayload({ phi: 0, d: 0, kappa: 0 });
    expect(payload.labels.text).toEqual(['Δs', null, 'Δℓ', null]);
    expect(Math.abs(payload.labels.x[0]! - payload.labels.x[2]!)).toBeGreaterThan(0.4);
    expect(payload.endpoints.x).toEqual([0, 0, 0, 0]);
    expect(payload.endpoints.y).toEqual([0, 0, 1, 1]);
  });
});
