import type Swup from 'swup';
import type { Visit } from 'swup';
import { $navigation, resetNavigationState, updateNavigation } from '../stores/site-state';
import { claimClientRuntime } from './client-runtime';
import { prepareTypography } from './typography-controller';

const SHOW_DELAY_MS = 120;
const MIN_VISIBLE_MS = 240;
const FADE_MS = 120;

type SwupHookEvent = CustomEvent<{ visit: Visit }>;

declare global {
  interface Window {
    swup?: Swup;
  }
}

function internalHref(event: MouseEvent) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return undefined;
  }

  const source = event.composedPath().find((node) => node instanceof HTMLAnchorElement);
  if (!(source instanceof HTMLAnchorElement)) return undefined;
  if (source.target && source.target !== '_self') return undefined;
  if (source.hasAttribute('download') || source.hasAttribute('data-no-swup')) return undefined;

  const url = new URL(source.href, location.href);
  return url.origin === location.origin ? url.href : undefined;
}

function reflectNavigationState(target: Document, state = $navigation.get()) {
  const root = target.documentElement;
  root.toggleAttribute('data-navigation-pending', state.pending);
  if (state.phase === 'idle') root.removeAttribute('data-navigation-progress');
  else root.dataset.navigationProgress = state.phase;
  const main = target.querySelector('main');
  if (state.pending) main?.setAttribute('aria-busy', 'true');
  else main?.removeAttribute('aria-busy');
}

function persistScrollPosition() {
  const currentState =
    typeof history.state === 'object' && history.state !== null ? history.state : {};
  history.replaceState(
    { ...currentState, scrollX: window.scrollX, scrollY: window.scrollY },
    '',
    location.href,
  );
}

export function startNavigationController() {
  const runtime = claimClientRuntime('navigation');

  let revision = 0;
  let activeVisitId: number | undefined;
  let shownAt = 0;
  let showTimer: number | undefined;
  let finishTimer: number | undefined;
  let typographyAbort: AbortController | undefined;
  let hookedSwup: Swup | undefined;
  let removeTypographyHook: (() => void) | undefined;
  let scrollFrame = 0;

  const clearTimers = () => {
    window.clearTimeout(showTimer);
    window.clearTimeout(finishTimer);
    showTimer = undefined;
    finishTimer = undefined;
  };

  const reset = (targetRevision = revision) => {
    if (targetRevision !== revision) return;
    clearTimers();
    shownAt = 0;
    activeVisitId = undefined;
    typographyAbort?.abort();
    typographyAbort = undefined;
    resetNavigationState();
    reflectNavigationState(document);
  };

  const installTypographyHook = () => {
    const swup = window.swup;
    if (!swup || swup === hookedSwup) return;

    removeTypographyHook?.();
    hookedSwup = swup;
    removeTypographyHook = swup.hooks.before('content:replace', async (visit) => {
      const nextDocument = visit.to.document;
      if (!nextDocument || visit.id !== activeVisitId) return;

      try {
        await prepareTypography(nextDocument, typographyAbort?.signal);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
      }
    });
  };

  const begin = (event: Event) => {
    persistScrollPosition();
    const visit = (event as SwupHookEvent).detail.visit;
    const navigationRevision = ++revision;
    clearTimers();
    typographyAbort?.abort();
    typographyAbort = new AbortController();
    activeVisitId = visit.id;

    if (visit.trigger.el?.closest('[data-swup-scroll-preserve]')) visit.scroll.reset = false;

    const href = new URL(`${visit.to.url}${visit.to.hash}`, location.origin).href;
    updateNavigation({ pending: true, phase: 'idle', href });
    reflectNavigationState(document);

    showTimer = window.setTimeout(() => {
      if (navigationRevision !== revision) return;
      shownAt = performance.now();
      updateNavigation({ phase: 'active' });
      reflectNavigationState(document);
    }, SHOW_DELAY_MS);
  };

  const finish = (event: Event) => {
    const visit = (event as SwupHookEvent).detail.visit;
    if (visit.id !== activeVisitId) return;

    const state = $navigation.get();
    if (!state.pending) return;

    const navigationRevision = revision;
    window.clearTimeout(showTimer);
    showTimer = undefined;
    typographyAbort = undefined;
    updateNavigation({ pending: false, href: undefined });
    reflectNavigationState(document);

    if (state.phase !== 'active') {
      reset(navigationRevision);
      return;
    }

    const remaining = Math.max(0, MIN_VISIBLE_MS - (performance.now() - shownAt));
    finishTimer = window.setTimeout(() => {
      if (navigationRevision !== revision) return;
      updateNavigation({ phase: 'finishing' });
      reflectNavigationState(document);
      finishTimer = window.setTimeout(() => reset(navigationRevision), FADE_MS);
    }, remaining);
  };

  const abort = (event: Event) => {
    const visit = (event as SwupHookEvent).detail.visit;
    if (visit.id === activeVisitId) reset(revision);
  };

  const reflectReplacement = () => reflectNavigationState(document);

  const preventDuplicateNavigation = (event: Event) => {
    const href = internalHref(event as MouseEvent);
    const state = $navigation.get();
    if (state.pending && href !== undefined && href === state.href) event.preventDefault();
  };

  const handleSwupEnable = () => queueMicrotask(installTypographyHook);
  const scheduleScrollPersistence = () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      persistScrollPosition();
    });
  };
  const persistBeforeDocumentLeaves = () => persistScrollPosition();

  installTypographyHook();
  runtime.listen(document, 'swup:enable', handleSwupEnable);
  runtime.listen(document, 'swup:visit:start', begin);
  runtime.listen(document, 'swup:visit:abort', abort);
  runtime.listen(document, 'swup:visit:end', finish);
  runtime.listen(document, 'site:after-swap', reflectReplacement);
  runtime.listen(document, 'click', preventDuplicateNavigation, true);
  runtime.listen(window, 'scroll', scheduleScrollPersistence, { passive: true });
  runtime.listen(window, 'pagehide', persistBeforeDocumentLeaves);

  runtime.onDispose(() => {
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    removeTypographyHook?.();
    removeTypographyHook = undefined;
    hookedSwup = undefined;
    revision += 1;
    reset(revision);
  });

  return runtime.dispose;
}
