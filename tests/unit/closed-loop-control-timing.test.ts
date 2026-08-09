import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse, View } from 'vega';
import {
  createClosedLoopControlTimingSpec,
  type ClosedLoopControlTimingCopy,
} from '../../src/content/blog/closed-loop-control-timing/closed-loop-control-timing-spec';

const copy = new Proxy({} as ClosedLoopControlTimingCopy, {
  get: (_target, property) => String(property),
});

type TimingDatum = {
  sourceTime: number;
  time: number;
  nextApplication?: number;
  nextDecision?: number;
  latestAtNextApplication?: boolean;
  latestAtNextDecision?: boolean;
};

describe('closed-loop control timing Vega dataflow', () => {
  let view: View;

  beforeEach(async () => {
    view = new View(parse(createClosedLoopControlTimingSpec(copy)), { renderer: 'none' });
    await view.runAsync();
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

  it('classifies feedback against the next decision even when that decision is outside the view', async () => {
    view.signal('feedbackOffset', 104);
    view.signal('feedbackInterval', 100);
    view.signal('feedbackDelay', 0);
    view.signal('decisionTime', 0);
    view.signal('decisionInterval', 10);
    await view.runAsync();

    const feedback = view.data('feedbackAvailability') as TimingDatum[];
    expect(feedback).toContainEqual(
      expect.objectContaining({
        sourceTime: 104,
        time: 104,
        nextDecision: 110,
        latestAtNextDecision: true,
      }),
    );
  });

  it('distinguishes information that is still latest from information superseded before the next event', async () => {
    view.signal('feedbackOffset', 0);
    view.signal('feedbackInterval', 6);
    view.signal('feedbackDelay', 0);
    view.signal('decisionTime', 5);
    view.signal('decisionInterval', 10);
    await view.runAsync();

    const feedback = view.data('feedbackAvailability') as TimingDatum[];

    expect(feedback).toContainEqual(
      expect.objectContaining({
        time: 0,
        nextDecision: 5,
        latestAtNextDecision: true,
      }),
    );
    expect(feedback).toContainEqual(
      expect.objectContaining({
        time: 6,
        nextDecision: 15,
        latestAtNextDecision: false,
      }),
    );
    view.signal('decisionTime', 0);
    view.signal('decisionInterval', 6);
    view.signal('commandDelay', 0);
    view.signal('applicationOffset', 5);
    view.signal('applicationInterval', 10);
    await view.runAsync();

    const commands = view.data('commandAvailability') as TimingDatum[];
    expect(commands).toContainEqual(
      expect.objectContaining({
        time: 0,
        nextApplication: 5,
        latestAtNextApplication: true,
      }),
    );
    expect(commands).toContainEqual(
      expect.objectContaining({
        time: 6,
        nextApplication: 15,
        latestAtNextApplication: false,
      }),
    );
  });
});
