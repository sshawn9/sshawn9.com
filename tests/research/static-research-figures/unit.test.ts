import { describe, expect, it } from 'vitest';
import { projectPoint, researchPanels } from '@sshawn9/content-ui/research-figure/geometry';

describe('static research figure geometry', () => {
  it('expresses time derivatives as mathematical accents instead of precomposed text letters', () => {
    const [coordinates, physical] = researchPanels('vehicle-velocity');
    expect(coordinates.labels.filter((label) => label.latex).map((label) => label.text)).toEqual([
      String.raw`\dot{\mathbf z}`,
      String.raw`(1-d\kappa_r)\dot{s}\,\mathbf T`,
      String.raw`\dot{d}\,\mathbf N`,
    ]);
    expect(physical.labels.some((label) => label.latex)).toBe(false);
  });

  it('projects the mathematical frame without changing x or y direction', () => {
    const panel = researchPanels('vehicle-state')[0];
    expect(projectPoint(panel, [panel.x[0], panel.y[0]])).toEqual([0, 100]);
    expect(projectPoint(panel, [panel.x[1], panel.y[1]])).toEqual([100, 0]);
  });

  it('keeps the heading frame orthonormal with the left normal', () => {
    const [left] = researchPanels('planar-heading');
    const [tangent, normal] = left.segments
      .filter((segment) => segment.arrow)
      .map((segment) => segment.to);
    expect(Math.hypot(...tangent)).toBeCloseTo(1, 12);
    expect(Math.hypot(...normal)).toBeCloseTo(1, 12);
    expect(tangent[0] * normal[0] + tangent[1] * normal[1]).toBeCloseTo(0, 12);
    expect(normal).toEqual([-tangent[1], tangent[0]]);
  });

  it('shows the same velocity as a sum of tangential and normal components in both panels', () => {
    for (const panel of researchPanels('vehicle-velocity')) {
      const arrows = panel.segments.filter((segment) => segment.arrow);
      expect(arrows).toHaveLength(3);
      const [velocity, tangent, normal] = arrows;
      expect(velocity.from).toEqual(tangent.from);
      expect(tangent.to).toEqual(normal.from);
      expect(normal.to).toEqual(velocity.to);
      expect(tangent.to[1]).toBe(tangent.from[1]);
      expect(normal.to[0]).toBe(normal.from[0]);
    }
  });
});
