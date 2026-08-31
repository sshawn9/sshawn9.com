import { describe, expect, it } from 'vitest';
import {
  decodeScrollSnapshot,
  mergeScrollSnapshot,
  SITE_HISTORY_KEY,
  type ScrollSnapshot,
} from '../../apps/site-v2/src/runtime/state-ledger';

const snapshot: ScrollSnapshot = {
  version: 1,
  routeKey: '/zh/blog/?page=2',
  page: { x: 12, y: 840 },
  regions: { 'tag-rail': { x: 0, y: 310 } },
};

describe('v2 state ledger', () => {
  it('preserves router-owned history fields while updating its namespace', () => {
    const routerState = { index: 7, scrollX: 4, privateRouterKey: 'keep' };
    const merged = mergeScrollSnapshot(routerState, snapshot);

    expect(merged).toMatchObject(routerState);
    expect(merged[SITE_HISTORY_KEY]).toEqual(snapshot);
  });

  it('restores only the matching history entry route', () => {
    const merged = mergeScrollSnapshot({}, snapshot);

    expect(decodeScrollSnapshot(merged, snapshot.routeKey)).toEqual(snapshot);
    expect(decodeScrollSnapshot(merged, '/zh/blog/?page=1')).toBeUndefined();
  });

  it('rejects corrupt schemas and clamps unsafe coordinates', () => {
    expect(
      decodeScrollSnapshot({ [SITE_HISTORY_KEY]: { ...snapshot, version: 99 } }, snapshot.routeKey),
    ).toBeUndefined();

    const malformed = {
      [SITE_HISTORY_KEY]: {
        ...snapshot,
        page: { x: -5, y: Number.POSITIVE_INFINITY },
        regions: {
          'tag-rail': { x: 'bad', y: 42 },
          ['x'.repeat(129)]: { x: 1, y: 2 },
        },
      },
    };
    expect(decodeScrollSnapshot(malformed, snapshot.routeKey)).toEqual({
      ...snapshot,
      page: { x: 0, y: 0 },
      regions: { 'tag-rail': { x: 0, y: 42 } },
    });
  });

  it('uses a safe empty base when history state is unavailable', () => {
    expect(mergeScrollSnapshot(null, snapshot)).toEqual({ [SITE_HISTORY_KEY]: snapshot });
  });
});
