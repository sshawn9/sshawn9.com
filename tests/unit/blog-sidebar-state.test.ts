import { describe, expect, it } from 'vitest';
import { decodeBlogSidebarState } from '../../apps/site/src/features/blog/runtime/blog-sidebar-state';

describe('blog sidebar state', () => {
  it('validates persisted values and clamps width at the domain boundary', () => {
    expect(decodeBlogSidebarState(null)).toEqual({ collapsed: false, width: 272 });
    expect(decodeBlogSidebarState({ collapsed: true, width: 999 })).toEqual({
      collapsed: true,
      width: 400,
    });
    expect(decodeBlogSidebarState({ collapsed: 'yes', width: 20 })).toEqual({
      collapsed: false,
      width: 208,
    });
  });
});
