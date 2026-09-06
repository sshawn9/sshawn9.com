import { describe, expect, it } from 'vitest';
import { decodeArticleSidebarState } from '../../../apps/site/src/features/article/runtime/article-sidebar-state';

describe('article sidebar state', () => {
  it('validates persisted values and clamps width at the domain boundary', () => {
    expect(decodeArticleSidebarState(null)).toEqual({ collapsed: false, width: 224 });
    expect(decodeArticleSidebarState({ collapsed: true, width: 999 })).toEqual({
      collapsed: true,
      width: 352,
    });
    expect(decodeArticleSidebarState({ collapsed: 'yes', width: 20 })).toEqual({
      collapsed: false,
      width: 208,
    });
  });
});
