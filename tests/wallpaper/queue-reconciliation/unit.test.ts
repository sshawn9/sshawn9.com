import { expect, it } from 'vitest';
import { reconcileQueue } from '../../../apps/site/src/features/appearance/wallpaper/model';

const photos = ['one', 'two', 'three', 'four'].map((id) => ({
  id,
  createdAt: '2026-08-29T00:00:00.000Z',
  blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
  rawUrl: `https://images.unsplash.com/${id}`,
  photographerName: `Photographer ${id}`,
  photographerUrl: `https://unsplash.com/@${id}`,
  photoUrl: `https://unsplash.com/photos/${id}`,
}));

it('preserves queue order while excluding the current and prepared next photos', () => {
  expect(reconcileQueue(['three', 'one', 'three'], photos, ['one', 'two'], () => 0)).toEqual([
    'three',
    'four',
  ]);
});
