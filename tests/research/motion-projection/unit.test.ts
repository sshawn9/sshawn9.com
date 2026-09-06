import { describe, expect, it } from 'vitest';
import {
  deriveMotionControlScene,
  MOTION_CONTROL_INITIAL_POSITION,
} from '@sshawn9/content-ui/motion-control/model';

describe('motion-control projection', () => {
  it('uses a closest-point projection and a signed left-normal error', () => {
    const scene = deriveMotionControlScene(MOTION_CONTROL_INITIAL_POSITION);
    const displacement = {
      x: scene.vehicle.x - scene.projection.x,
      y: scene.vehicle.y - scene.projection.y,
    };
    expect(displacement.x * scene.tangent.x + displacement.y * scene.tangent.y).toBeCloseTo(0, 7);
    expect(displacement.x * scene.normal.x + displacement.y * scene.normal.y).toBeCloseTo(
      scene.lateralError,
      8,
    );
    expect(scene.lateralError).toBeGreaterThan(0);
  });
});
