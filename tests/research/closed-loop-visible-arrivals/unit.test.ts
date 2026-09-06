import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { View } from 'vega';
import { createClosedLoopView, type TimingDatum } from '../closed-loop-view';

describe('closed-loop visible arrivals', () => {
  let view: View;
  beforeEach(async () => {
    view = await createClosedLoopView();
  });
  afterEach(() => view.finalize());

  it('keeps an in-view arrival but omits its connector when the source is outside the view', () => {
    const commands = view.data('commandAvailability') as TimingDatum[];
    const feedback = view.data('feedbackAvailability') as TimingDatum[];
    const commandConnections = view.data('commandAvailabilityConnections') as TimingDatum[];
    const feedbackConnections = view.data('feedbackAvailabilityConnections') as TimingDatum[];
    expect(commands).toContainEqual(expect.objectContaining({ sourceTime: -10, time: 5 }));
    expect(feedback).toContainEqual(expect.objectContaining({ sourceTime: -9.5, time: 0.5 }));
    expect(commandConnections).not.toContainEqual(expect.objectContaining({ sourceTime: -10 }));
    expect(feedbackConnections).not.toContainEqual(expect.objectContaining({ sourceTime: -9.5 }));
    expect(commandConnections).toContainEqual(expect.objectContaining({ sourceTime: 0, time: 15 }));
    expect(feedbackConnections).toContainEqual(
      expect.objectContaining({ sourceTime: -3.5, time: 6.5 }),
    );
  });
});
