import { describe, expect, it } from 'vitest';
import {
  deriveMotionControlScene,
  MOTION_CONTROL_INITIAL_POSITION,
  MOTION_CONTROL_MODEL,
} from '@sshawn9/content-ui/motion-control/model';

describe('motion-control steering', () => {
  it('derives bounded front-wheel steering from negative lateral-error feedback', () => {
    const scene = deriveMotionControlScene(MOTION_CONTROL_INITIAL_POSITION);
    const maximumSteering = (MOTION_CONTROL_MODEL.maximumSteeringDegrees * Math.PI) / 180;
    expect(Math.sign(scene.steeringAngle)).toBe(-Math.sign(scene.lateralError));
    expect(Math.abs(scene.steeringAngle)).toBeLessThanOrEqual(maximumSteering);
    expect(scene.wheels.filter(({ axle }) => axle === 'front')).toHaveLength(2);
    expect(
      new Set(
        scene.wheels.filter(({ axle }) => axle === 'front').map(({ angle }) => angle.toFixed(8)),
      ).size,
    ).toBe(2);
  });
});
