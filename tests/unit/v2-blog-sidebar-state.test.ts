import { describe, expect, it } from 'vitest';
import {
  applyBlogSidebarBootstrap,
  createBlogSidebarPrepaintScript,
  decodeBlogSidebarState,
} from '../../apps/site-v2/src/features/blog/runtime/blog-sidebar-state';

describe('v2 blog sidebar state', () => {
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

  it('applies one bootstrap snapshot without owning the live layout', () => {
    const attributes = new Set<string>();
    const properties = new Map<string, string>();
    const root = {
      toggleAttribute(name: string, force: boolean) {
        if (force) attributes.add(name);
        else attributes.delete(name);
      },
      style: {
        setProperty(name: string, value: string) {
          properties.set(name, value);
        },
      },
    } as unknown as HTMLElement;

    applyBlogSidebarBootstrap(root, { collapsed: true, width: 320 });

    expect(attributes).toContain('data-blog-sidebar-collapsed');
    expect(properties.get('--blog-sidebar-boot-width')).toBe('320px');
    expect(properties.get('--blog-sidebar-boot-track')).toBe('0px');
  });

  it('emits a self-contained head prepaint script', () => {
    expect(() => new Function(createBlogSidebarPrepaintScript())).not.toThrow();
  });
});
