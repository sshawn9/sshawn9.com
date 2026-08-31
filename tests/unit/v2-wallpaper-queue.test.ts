import { describe, expect, it } from 'vitest';
import {
  reconcileWallpaperQueue,
  replenishWallpaperQueue,
  restoreWallpaperQueue,
} from '../../apps/site-v2/src/features/appearance/runtime/wallpaper-queue';

describe('v2 wallpaper queue', () => {
  it('restores only available unique photos other than the current photo', () => {
    expect(
      restoreWallpaperQueue(
        ['current', 'kept', 'removed', 'kept', 'second'],
        ['current', 'kept', 'second'],
        'current',
      ),
    ).toEqual(['kept', 'second']);
  });

  it('preserves retained order and appends only newly introduced photos', () => {
    expect(
      reconcileWallpaperQueue(
        ['kept', 'removed'],
        ['current', 'kept', 'removed'],
        ['current', 'kept', 'new-a', 'new-b'],
        'current',
        () => 0.999,
      ),
    ).toEqual(['kept', 'new-a', 'new-b']);
  });

  it('replenishes a complete round without the current photo or duplicates', () => {
    const queue = replenishWallpaperQueue(['a', 'b', 'c'], 'b', () => 0.5);
    expect(new Set(queue)).toEqual(new Set(['a', 'c']));
    expect(queue).toHaveLength(2);
  });
});
