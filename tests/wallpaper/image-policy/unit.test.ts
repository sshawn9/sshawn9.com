import { expect, it } from 'vitest';
import { resolveImagePolicy } from '../../../apps/site/src/features/appearance/wallpaper/model';

it('chooses one bounded image policy for a full-document viewport', () => {
  expect(resolveImagePolicy(720, 1).width).toBe(960);
  expect(resolveImagePolicy(1000, 1.5).width).toBe(1600);
  expect(resolveImagePolicy(1600, 2).width).toBe(2400);
});
