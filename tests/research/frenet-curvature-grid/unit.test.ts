import { describe, expect, it } from 'vitest';
import { geometryPayload } from '@sshawn9/content-ui/frenet-explorer/model';

describe('Frenet curvature grid', () => {
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
});
