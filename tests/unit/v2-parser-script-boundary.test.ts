import { describe, expect, it } from 'vitest';
import { createArticleSidebarPrepaintScript } from '../../apps/site-v2/src/features/article/runtime/article-sidebar-state';
import { createDocumentPreferenceScript } from '../../apps/site-v2/src/features/appearance/runtime/document-preferences';
import { createBlogSidebarPrepaintScript } from '../../apps/site-v2/src/features/blog/runtime/blog-sidebar-state';
import { createBlogViewPrepaintScript } from '../../apps/site-v2/src/features/blog/runtime/blog-view-state';
import { createInitialFrameScript } from '../../apps/site-v2/src/runtime/initial-frame';
import {
  createFallbackDocumentLocaleScript,
  createLocaleEntryRedirectScript,
} from '../../apps/site-v2/src/runtime/locale-preference';
import { createSiteShellControllerScript } from '../../apps/site-v2/src/runtime/site-shell-controller';

const parserScripts = {
  appearance: createDocumentPreferenceScript(),
  'article-sidebar': createArticleSidebarPrepaintScript(),
  'blog-sidebar': createBlogSidebarPrepaintScript(),
  'blog-view': createBlogViewPrepaintScript(),
  'initial-frame': createInitialFrameScript(),
  'locale-entry': createLocaleEntryRedirectScript(),
  'locale-fallback': createFallbackDocumentLocaleScript({ en: 'Missing', zh: '未找到' }),
  'site-shell': createSiteShellControllerScript(),
};

describe('v2 parser script boundary', () => {
  for (const [name, source] of Object.entries(parserScripts)) {
    it(`${name} remains a self-contained browser program after server transforms`, () => {
      expect(source).not.toContain('__vite_ssr_');
      expect(() => new Function(source)).not.toThrow();
    });
  }
});
