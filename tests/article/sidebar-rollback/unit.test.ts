import { parseHTML } from 'linkedom';
import { expect, test, vi } from 'vitest';
import { createArticleSidebarController } from '../../../apps/site/src/features/article/runtime/article-sidebar-controller';
import { applyArticleSidebarBootstrap } from '../../../apps/site/src/features/article/runtime/article-sidebar-state';

test('a collapsed sidebar rollback restores static access and a later mount re-enables controls', () => {
  const dom = parseHTML(`<!doctype html><html><body>
    <div data-article-sidebar-layout>
      <aside data-article-sidebar-panel><a href="/ordinary-link">Ordinary link</a></aside>
      <button data-article-sidebar-toggle data-collapse-label="Collapse" data-expand-label="Expand"></button>
      <div data-article-sidebar-resizer tabindex="0"></div>
    </div>
  </body></html>`);
  const document = dom.document as unknown as Document;
  const media = Object.assign(new EventTarget(), { matches: true });
  const storage = { getItem: vi.fn(() => '{"collapsed":true,"width":224}'), setItem: vi.fn() };
  const sourceWindow = Object.assign(new EventTarget(), {
    document,
    matchMedia: vi.fn(() => media),
    localStorage: storage,
    clearTimeout: vi.fn(),
  });
  const layout = document.querySelector<HTMLElement>('[data-article-sidebar-layout]')!;
  const sidebar = layout.querySelector<HTMLElement>('[data-article-sidebar-panel]')!;
  const toggle = layout.querySelector<HTMLButtonElement>('[data-article-sidebar-toggle]')!;
  const resizer = layout.querySelector<HTMLElement>('[data-article-sidebar-resizer]')!;
  const failure = new Error('Initial toggle state failed');
  let failedAfterCollapse = false;
  applyArticleSidebarBootstrap(document.documentElement, { collapsed: true, width: 224 });
  vi.spyOn(toggle, 'setAttribute').mockImplementationOnce(() => {
    failedAfterCollapse = sidebar.inert === true;
    throw failure;
  });

  expect(() => createArticleSidebarController(layout, sourceWindow as unknown as Window)).toThrow(
    failure,
  );
  expect(failedAfterCollapse).toBe(true);
  expect(sidebar.inert).toBe(false);
  expect(sidebar.hasAttribute('aria-hidden')).toBe(false);
  expect(sidebar.querySelector('a')?.getAttribute('href')).toBe('/ordinary-link');
  expect(toggle.disabled).toBe(true);
  expect(resizer.tabIndex).toBe(-1);
  expect(document.documentElement.hasAttribute('data-article-sidebar-collapsed')).toBe(true);
  expect(layout.style.getPropertyValue('--article-sidebar-current-width')).toBe('224px');
  expect(layout.style.getPropertyValue('--article-sidebar-current-track')).toBe(
    'var(--article-sidebar-current-width)',
  );
  expect(storage.setItem).not.toHaveBeenCalled();

  vi.restoreAllMocks();
  const controller = createArticleSidebarController(layout, sourceWindow as unknown as Window)!;
  expect(controller).toBeDefined();
  expect(toggle.disabled).toBe(false);
  // linkedom's tabIndex getter treats zero as -1; verify the reflected HTML value.
  expect(resizer.getAttribute('tabindex')).toBe('0');
  expect(sidebar.inert).toBe(true);
  expect(layout.hasAttribute('data-sidebar-collapsed')).toBe(true);
});
