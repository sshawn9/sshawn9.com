import { describe, expect, it } from 'vitest';
import { geometryPayload } from '@sshawn9/content-ui/frenet-explorer/model';

describe('Frenet geometry payload', () => {
  it('preserves increment geometry and labels for a nondegenerate state', () => {
    const payload = geometryPayload({ phi: 12, d: 0.2, kappa: 0.05 });
    expect(payload.labels.text).toEqual(['Δs', 'd', 'Δℓ', 'φ']);
    expect(
      Object.values(payload)
        .flatMap((trace) => trace.text)
        .filter(Boolean),
    ).toEqual(['Δs', 'd', 'Δℓ', 'φ']);
    const heading = payload.trajectoryIncrement;
    expect(
      Math.hypot(heading.x.at(-1)! - heading.x[0]!, heading.y.at(-1)! - heading.y[0]!),
    ).toBeCloseTo(1, 12);
    expect(payload.referenceIncrement.y.at(-1)).toBeGreaterThan(0);
  });
});
