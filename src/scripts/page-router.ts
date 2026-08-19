import Swup from 'swup';
import type { Visit } from 'swup';
import SwupA11yPlugin from '@swup/a11y-plugin';
import SwupHeadPlugin from '@swup/head-plugin';
import SwupPreloadPlugin from '@swup/preload-plugin';
import SwupScriptsPlugin from '@swup/scripts-plugin';

export const SITE_PAGE_EVENTS = {
  beforeSwap: 'site:before-swap',
  afterSwap: 'site:after-swap',
  pageLoad: 'site:page-load',
} as const;

let activeRouter: Swup | undefined;

function isPointerActivation(visit: Visit) {
  const event = visit.trigger.event;
  return event instanceof MouseEvent && event.detail > 0;
}

class InputAwareA11yPlugin extends SwupA11yPlugin {
  constructor() {
    super({
      announcements: {
        en: {
          visit: 'Navigated to: {title}',
          url: 'New page at {url}',
        },
        'zh-CN': {
          visit: '已导航至：{title}',
          url: '新页面：{url}',
        },
        '*': {
          visit: '{title}',
          url: '{url}',
        },
      },
    });
    this.rootSelector = '#main-content';
    const focusAnchor = this.handleAnchorScroll;
    this.handleAnchorScroll = (visit, args) => {
      if (!isPointerActivation(visit)) focusAnchor(visit, args);
    };
  }

  override prepareVisit(visit: Visit) {
    super.prepareVisit(visit);
    if (isPointerActivation(visit)) visit.a11y.focus = false;
  }
}

class OutletScriptsPlugin extends SwupScriptsPlugin {
  override getScope() {
    return document.querySelector<HTMLElement>('#swup');
  }
}

function dispatchPageEvent(name: (typeof SITE_PAGE_EVENTS)[keyof typeof SITE_PAGE_EVENTS]) {
  document.dispatchEvent(new Event(name));
}

function syncDocumentLocale(context: string) {
  try {
    const value = JSON.parse(context) as { locale?: unknown; languageTag?: unknown };
    if ((value.locale !== 'en' && value.locale !== 'zh') || typeof value.languageTag !== 'string') {
      return;
    }

    document.documentElement.lang = value.languageTag;
    document.documentElement.dataset.locale = value.locale;
  } catch {
    // SiteChrome performs full validation and will ignore malformed context as well.
  }
}

function syncSiteChromeContext(visit: Visit) {
  const incoming = visit.to.document?.querySelector<HTMLScriptElement>('#site-chrome-context');
  if (!incoming?.textContent) return;

  syncDocumentLocale(incoming.textContent);
  const current = document.querySelector<HTMLScriptElement>('#site-chrome-context');
  if (current) current.textContent = incoming.textContent;
  document.dispatchEvent(new CustomEvent('site:chrome-context', { detail: incoming.textContent }));
}

export function startPageRouter() {
  if (activeRouter) return activeRouter;

  const router = new Swup({
    containers: ['#swup'],
    animationScope: 'containers',
    native: false,
    cache: true,
    plugins: [
      new InputAwareA11yPlugin(),
      new SwupHeadPlugin({
        awaitAssets: true,
        persistTags: '#plotly.js-style-global',
      }),
      new SwupPreloadPlugin({
        throttle: 2,
        preloadHoveredLinks: true,
        preloadVisibleLinks: false,
      }),
      new OutletScriptsPlugin(),
    ],
  });

  window.swup = router;
  router.hooks.before('content:replace', () => dispatchPageEvent(SITE_PAGE_EVENTS.beforeSwap));
  router.hooks.on('content:replace', (visit) => {
    syncSiteChromeContext(visit);
    dispatchPageEvent(SITE_PAGE_EVENTS.afterSwap);
  });
  router.hooks.on('page:view', () => dispatchPageEvent(SITE_PAGE_EVENTS.pageLoad));
  activeRouter = router;
  return router;
}
