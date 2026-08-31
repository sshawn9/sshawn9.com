import { describe, expect, it } from 'vitest';
import {
  applyArticleSidebarBootstrap,
  createArticleSidebarPrepaintScript,
  decodeArticleSidebarState,
} from '../../apps/site-v2/src/features/article/runtime/article-sidebar-state';

describe('v2 article sidebar state', () => {
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

  it('applies the exact width and collapsed track before the page layout is parsed', () => {
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

    applyArticleSidebarBootstrap(root, { collapsed: true, width: 320 });

    expect(attributes).toContain('data-article-sidebar-collapsed');
    expect(properties.get('--article-sidebar-boot-width')).toBe('320px');
    expect(properties.get('--article-sidebar-boot-track')).toBe('0px');
  });

  it('emits a self-contained head prepaint script', () => {
    expect(() => new Function(createArticleSidebarPrepaintScript())).not.toThrow();
  });
});
