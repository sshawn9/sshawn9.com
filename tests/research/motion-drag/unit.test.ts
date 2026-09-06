import { describe, expect, it } from 'vitest';
import {
  angleDegrees,
  clampMotionControlVehicle,
  deriveMotionControlScene,
  MOTION_CONTROL_INITIAL_POSITION,
  MOTION_CONTROL_MODEL,
  MOTION_CONTROL_VIEW_BOX,
} from '@sshawn9/content-ui/motion-control/model';

describe('motion-control drag model', () => {
  it('keeps heading fixed while dragged position, projection, and steering change', () => {
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
