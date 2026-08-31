import { describe, expect, it } from 'vitest';
import {
  angleDegrees,
  clampMotionControlVehicle,
  deriveMotionControlScene,
  MOTION_CONTROL_INITIAL_POSITION,
  MOTION_CONTROL_MODEL,
  MOTION_CONTROL_VIEW_BOX,
} from '@sshawn9/content-ui/motion-control/model';

describe('motion-control project model', () => {
  it('uses a true closest-point projection and a signed left-normal error', () => {
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

  it('keeps vehicle heading fixed while position, projection and steering change', () => {
    const initial = deriveMotionControlScene(MOTION_CONTROL_INITIAL_POSITION);
    const moved = deriveMotionControlScene({
      x: MOTION_CONTROL_INITIAL_POSITION.x + 95,
      y: MOTION_CONTROL_INITIAL_POSITION.y - 52,
    });

    expect(angleDegrees(initial.headingAngle)).toBe(MOTION_CONTROL_MODEL.headingDegrees);
    expect(moved.headingAngle).toBe(initial.headingAngle);
    expect(moved.projection).not.toEqual(initial.projection);
    expect(moved.steeringAngle).not.toBe(initial.steeringAngle);
  });

  it('constrains dragging to the visible interaction area', () => {
    const clamped = clampMotionControlVehicle({ x: -500, y: 5_000 });

    expect(clamped.x).toBeGreaterThan(0);
    expect(clamped.y).toBeLessThan(MOTION_CONTROL_VIEW_BOX.height);
  });
});
