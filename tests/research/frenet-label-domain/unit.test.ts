import { describe, expect, it } from 'vitest';
import { geometryPayload, type GeometryPayload } from '@sshawn9/content-ui/frenet-explorer/model';

type Point = { x: number; y: number };
type LabelBox = Point & { halfWidth: number; halfHeight: number; text: string };

const criticalTraceKeys = [
  'referencePath',
  'referenceIncrement',
  'lateralOffset',
  'projectionGuide',
  'trajectoryIncrement',
  'headingAngle',
] as const;

function segmentIntersectsBox(start: Point, end: Point, box: LabelBox, padding: Point): boolean {
  let entry = 0;
  let exit = 1;
  for (const axis of ['x', 'y'] as const) {
    const extent = axis === 'x' ? box.halfWidth + padding.x : box.halfHeight + padding.y;
    const minimum = box[axis] - extent;
    const maximum = box[axis] + extent;
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) <= 1e-12) {
      if (start[axis] < minimum || start[axis] > maximum) return false;
      continue;
    }
    const first = (minimum - start[axis]) / delta;
    const second = (maximum - start[axis]) / delta;
    entry = Math.max(entry, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (entry > exit) return false;
  }
  return true;
}

function labelBoxes(payload: GeometryPayload, view: Point): LabelBox[] {
  return payload.labels.text.flatMap((text, index) => {
    const x = payload.labels.x[index];
    const y = payload.labels.y[index];
    if (!text) {
      expect(x).toBeNull();
      expect(y).toBeNull();
      return [];
    }
    expect(x).toEqual(expect.any(Number));
    expect(y).toEqual(expect.any(Number));
    return [
      {
        text,
        x: x!,
        y: y!,
        halfWidth: view.x * (text.length > 1 ? 0.09 : 0.055),
        halfHeight: view.y * 0.065,
      },
    ];
  });
}

function expectReadableLabels(payload: GeometryPayload, view: Point): void {
  const boxes = labelBoxes(payload, view);
  expect(boxes.length).toBeGreaterThan(0);
  const labelGap = { x: view.x * 0.012, y: view.y * 0.012 };
  const lineGap = { x: view.x * 0.025, y: view.y * 0.025 };

  boxes.forEach((box) => {
    expect(box.x - box.halfWidth).toBeGreaterThanOrEqual(-view.x);
    expect(box.x + box.halfWidth).toBeLessThanOrEqual(view.x);
    expect(box.y - box.halfHeight).toBeGreaterThanOrEqual(-view.y);
    expect(box.y + box.halfHeight).toBeLessThanOrEqual(view.y);
  });

  for (let first = 0; first < boxes.length; first += 1) {
    for (let second = first + 1; second < boxes.length; second += 1) {
      const a = boxes[first]!;
      const b = boxes[second]!;
      const separated =
        Math.abs(a.x - b.x) >= a.halfWidth + b.halfWidth + labelGap.x ||
        Math.abs(a.y - b.y) >= a.halfHeight + b.halfHeight + labelGap.y;
      expect(separated, `${a.text} and ${b.text} overlap`).toBe(true);
    }
  }

  for (const key of criticalTraceKeys) {
    const trace = payload[key];
    for (let index = 1; index < trace.x.length; index += 1) {
      const previousX = trace.x[index - 1];
      const previousY = trace.y[index - 1];
      const x = trace.x[index];
      const y = trace.y[index];
      if (previousX === null || previousY === null || x === null || y === null) continue;
      boxes.forEach((box) => {
        expect(
          segmentIntersectsBox({ x: previousX, y: previousY }, { x, y }, box, lineGap),
          `${box.text} covers ${key}`,
        ).toBe(false);
      });
    }
  }
}

describe('Frenet label layout domain', () => {
  it('keeps labels within the view and away from each other and key geometry', () => {
    const normalView = { x: 1.75, y: 3.25 };
    for (const phi of [-30, -12, 0, 12, 30])
      for (const d of [-0.5, 0, 0.5])
        for (const kappa of [-0.1, 0, 0.1]) {
          expectReadableLabels(geometryPayload({ phi, d, kappa }, normalView), normalView);
        }

    const criticalView = { x: 4.25, y: 6.75 };
    for (const d of [-3, -2.001, -2, -1.999, 0, 1.999, 2, 2.001, 3])
      for (const kappa of [-1, -0.5, 0.5, 1]) {
        expectReadableLabels(geometryPayload({ phi: 0, d, kappa }, criticalView), criticalView);
      }
  });
});
