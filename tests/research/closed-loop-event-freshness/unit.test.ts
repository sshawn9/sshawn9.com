import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { View } from 'vega';
import { createClosedLoopView, type TimingDatum } from '../closed-loop-view';

describe('closed-loop event freshness', () => {
  let view: View;
  beforeEach(async () => {
    view = await createClosedLoopView();
  });
  afterEach(() => view.finalize());

  it('classifies feedback against the next decision even when it is outside the view', async () => {
    view
      .signal('feedbackOffset', 104)
      .signal('feedbackInterval', 100)
      .signal('feedbackDelay', 0)
      .signal('decisionTime', 0)
      .signal('decisionInterval', 10);
    await view.runAsync();
    expect(view.data('feedbackAvailability') as TimingDatum[]).toContainEqual(
      expect.objectContaining({
        sourceTime: 104,
        time: 104,
        nextDecision: 110,
        latestAtNextDecision: true,
      }),
    );
  });

  it('distinguishes information that remains latest from information superseded before the next event', async () => {
    view
      .signal('feedbackOffset', 0)
      .signal('feedbackInterval', 6)
      .signal('feedbackDelay', 0)
      .signal('decisionTime', 5)
      .signal('decisionInterval', 10);
    await view.runAsync();
    const feedback = view.data('feedbackAvailability') as TimingDatum[];
    expect(feedback).toContainEqual(
      expect.objectContaining({ time: 0, nextDecision: 5, latestAtNextDecision: true }),
    );
    expect(feedback).toContainEqual(
      expect.objectContaining({ time: 6, nextDecision: 15, latestAtNextDecision: false }),
    );

    view
      .signal('decisionTime', 0)
      .signal('decisionInterval', 6)
      .signal('commandDelay', 0)
      .signal('applicationOffset', 5)
      .signal('applicationInterval', 10);
    await view.runAsync();
    const commands = view.data('commandAvailability') as TimingDatum[];
    expect(commands).toContainEqual(
      expect.objectContaining({ time: 0, nextApplication: 5, latestAtNextApplication: true }),
    );
    expect(commands).toContainEqual(
      expect.objectContaining({ time: 6, nextApplication: 15, latestAtNextApplication: false }),
    );
  });
});
