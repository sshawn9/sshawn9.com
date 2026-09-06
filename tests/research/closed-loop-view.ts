import { parse, View } from 'vega';
import {
  createClosedLoopControlTimingSpec,
  type ClosedLoopControlTimingCopy,
} from '@sshawn9/content-ui/closed-loop-control-timing/spec';

const copy = new Proxy({} as ClosedLoopControlTimingCopy, {
  get: (_target, property) => String(property),
});

export type TimingDatum = {
  sourceTime: number;
  time: number;
  nextApplication?: number;
  nextDecision?: number;
  latestAtNextApplication?: boolean;
  latestAtNextDecision?: boolean;
};

export async function createClosedLoopView(): Promise<View> {
  const view = new View(parse(createClosedLoopControlTimingSpec(copy)), { renderer: 'none' });
  await view.runAsync();
  return view;
}
