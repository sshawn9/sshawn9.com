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
    expect(projectPoint(panel, [4.2, 2.7])).toEqual([50, 50]);
  });

  it('keeps the left normal fixed while curvature changes sign', () => {
    const panels = researchPanels('planar-curvature-signs');
    for (const panel of panels) {
      expect(panel.segments[0]).toMatchObject({ from: [0, 0], to: [1.05, 0] });
      expect(panel.segments[1]).toMatchObject({ from: [0, 0], to: [0, 1.12] });
    }
    expect(panels[0].segments[2].to).toEqual([0, 0.72]);
    expect(panels[1].segments).toHaveLength(2);
    expect(panels[2].segments[2].to).toEqual([0, -0.72]);
    expect(panels[1].labels.some((label) => label.text === 'K = 0')).toBe(true);
    // The quadratic control point is reflected across y=0, so the tangent at
    // its midpoint is horizontal and the midpoint itself remains the origin.
    panels.forEach((panel, index) => {
      const [x0, y0, cx, cy, x1, y1] = panel.paths[0].d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      expect([x0, cx, x1]).toEqual([-2.2, 0, 2.2]);
      expect((y0 + 2 * cy + y1) / 4).toBeCloseTo(0, 12);
      expect(y0).toBe(y1);
      expect(-y0).toBeCloseTo([0.24, 0, -0.24][index] * 2.2 ** 2, 12);
    });
  });

  it('keeps the heading frame orthonormal and the arc tangents aligned with the path', () => {
    const [left, right] = researchPanels('planar-heading');
    const [tangent, normal] = left.segments
      .filter((segment) => segment.arrow)
      .map((segment) => segment.to);
    expect(Math.hypot(...tangent)).toBeCloseTo(1, 12);
    expect(Math.hypot(...normal)).toBeCloseTo(1, 12);
    expect(tangent[0] * normal[0] + tangent[1] * normal[1]).toBeCloseTo(0, 12);
    expect(normal).toEqual([-tangent[1], tangent[0]]);
    right.segments.forEach((segment, index) => {
      const angle = [0.42, 0.82][index];
      expect(Math.hypot(segment.from[0], segment.from[1] - 2.4)).toBeCloseTo(2.4, 12);
      expect(
        Math.atan2(segment.to[1] - segment.from[1], segment.to[0] - segment.from[0]),
      ).toBeCloseTo(angle, 12);
    });
  });

  it('preserves the vehicle offset and heading relative to the Frenet frame', () => {
    const panel = researchPanels('vehicle-state')[0];
    const [projection, vehicle] = panel.points.map((point) => point.at);
    const offset = [vehicle[0] - projection[0], vehicle[1] - projection[1]];
    expect(Math.hypot(...offset)).toBeCloseTo(1.25, 12);
    expect(offset[0] * Math.cos(0.62) + offset[1] * Math.sin(0.62)).toBeCloseTo(0, 12);
    const heading = panel.segments[2];
    expect(
      Math.atan2(heading.to[1] - heading.from[1], heading.to[0] - heading.from[0]),
    ).toBeCloseTo(0.96, 12);
    const dimension = panel.segments[3];
    expect(
      Math.hypot(dimension.to[0] - dimension.from[0], dimension.to[1] - dimension.from[1]),
    ).toBeCloseTo(1.25, 12);
    expect(panel.segments[4]).toMatchObject({
      from: dimension.to,
      to: dimension.from,
      arrow: true,
    });
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
