import { describe, expect, it } from 'vitest';
import { geometryPayload } from '@sshawn9/content-ui/frenet-explorer/model';

describe('Frenet label layout domain', () => {
  it('finds label layouts throughout normal and coordinate-scale domains', () => {
    for (const phi of [-30, -12, 0, 12, 30])
      for (const d of [-0.5, 0, 0.5])
        for (const kappa of [-0.1, 0, 0.1]) {
          expect(() => geometryPayload({ phi, d, kappa }, { x: 1.75, y: 3.25 })).not.toThrow();
        }
    for (const d of [-3, -2.001, -2, -1.999, 0, 1.999, 2, 2.001, 3])
      for (const kappa of [-1, -0.5, 0.5, 1]) {
        expect(() => geometryPayload({ phi: 0, d, kappa }, { x: 4.25, y: 6.75 })).not.toThrow();
      }
  });
});
