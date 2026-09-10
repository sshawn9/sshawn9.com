import {
  navigate,
  type TransitionBeforePreparationEvent,
  type TransitionBeforeSwapEvent,
} from 'astro:transitions/client';
import { decideBuildNavigation, readDocumentBuildId } from './build-generation';
import { CURRENT_BUILD_ID } from './build-identity';
import {
  consumeLocaleNavigationTransfer,
  discardLocaleNavigationTransfer,
  localeNavigationRouteKey,
  persistLocaleNavigationTransfer,
  type LocaleNavigationPoint,
} from './locale-navigation-transfer';
import { saveLocalePreference } from './locale-preference';
import {
  createBrowserFeedbackClock,
  NavigationFeedback,
  reflectNavigationFeedback,
} from './navigation-feedback';
import { PageOutletTransition } from './page-outlet-transition';
import type { PageNavigation, PageView, ViewUpdateOptions } from './page-navigation';
import type { PageRuntime } from './page-runtime';
import { prepareRequiredFonts } from './required-fonts';
import {
  persistCurrentScroll,
  readCurrentScroll,
  restoreNestedScroll,
  restorePageScroll,
  routeKey,
} from './scroll-state';

type NavigationPhase =
  | { kind: 'idle' }
  | {
      kind: 'document';
      stage: 'preparing' | 'swapping' | 'settling';
      id: number;
      feedbackId: number;
      navigationType: TransitionBeforePreparationEvent['navigationType'];
      focusMainContent: boolean;
    }
  | {
      kind: 'view';
      id: number;
      view: PageView;
      navigationType: TransitionBeforePreparationEvent['navigationType'];
      scroll: ReturnType<typeof readCurrentScroll>;
      originPoint: LocaleNavigationPoint;
      hashChanged: boolean;
      scrollTarget?: HTMLElement;
    };

type ViewRequest = ViewUpdateOptions & { url: URL };

type NavigationDependencies = {
  pages: PageRuntime;
  closeDocumentOverlays(): void;
  documentReady(): void;
};

interface InternalNavigation {
  link: HTMLAnchorElement;
  target: URL;
  targetLocale?: 'en' | 'zh';
}

interface PendingLocaleTransfer {
  target: URL;
  point: LocaleNavigationPoint;
}

function internalNavigation(
  sourceWindow: Window,
  event: MouseEvent,
): InternalNavigation | undefined {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return undefined;
  }

  const Anchor = (sourceWindow as Window & typeof globalThis).HTMLAnchorElement;
  const source = event
    .composedPath()
    .find((candidate): candidate is HTMLAnchorElement => candidate instanceof Anchor);
  if (!source || (source.target && source.target !== '_self')) return undefined;
  if (source.hasAttribute('download')) return undefined;

  const url = new URL(source.href, sourceWindow.location.href);
  if (url.origin !== sourceWindow.location.origin) return undefined;

  const locale = source.dataset.localeSwitch;
  return {
    link: source,
    target: url,
    targetLocale: locale === 'en' || locale === 'zh' ? locale : undefined,
  };
}

function readableSessionStorage(sourceWindow: Window): Storage | undefined {
  try {
    return sourceWindow.sessionStorage;
  } catch {
    return undefined;
  }
}

export function installNavigationCoordinator(
  sourceDocument: Document,
  sourceWindow: Window,
  dependencies: NavigationDependencies,
): PageNavigation & { dispose(): void } {
  const feedback = new NavigationFeedback(createBrowserFeedbackClock(sourceWindow), (state) =>
    reflectNavigationFeedback(sourceDocument, state),
  );
  const pageTransition = new PageOutletTransition(sourceDocument, sourceWindow);
  let sequence = 0;
  let phase: NavigationPhase = { kind: 'idle' };
  let restoringTraversal = false;
  let scrollSaveFrame = 0;
  let pendingLocaleTransfer: PendingLocaleTransfer | undefined;
  let pendingMainFocus: URL | undefined;
  let disposed = false;
  // During traversal the address bar already names the destination, while
  // this URL still belongs to the page the user can see and interact with.
  let committedUrl = new URL(sourceWindow.location.href);
  const viewRequests: ViewRequest[] = [];

  function locationMatchesPage(): boolean {
    return routeKey(sourceWindow.location) === routeKey(committedUrl);
  }

  function currentPageUrl(): URL {
    // Native same-page anchors bypass preparation/swap. Read their current
    // hash from location without mistaking a pending traversal for a commit.
    return new URL(locationMatchesPage() ? sourceWindow.location.href : committedUrl);
  }

  function persistPageScroll(): void {
    if (locationMatchesPage()) persistCurrentScroll(sourceDocument, sourceWindow);
  }

  // Only pending intents live here. Astro remains the sole owner of pushed
  // history entries; reducers can compose before its asynchronous swap commits.
  async function drainViewRequests(): Promise<void> {
    while (!disposed && viewRequests.length > 0) {
      const request = viewRequests[0]!;
      try {
        await navigate(request.url.href, {
          history: 'push',
          sourceElement: request.sourceElement,
          info: request,
        });
      } catch (error) {
        if (viewRequests[0] !== request) return;
        viewRequests.length = 0;
        sourceWindow.reportError(error);
        return;
      }
      if (viewRequests[0] !== request) return;
      viewRequests.shift();
    }
  }

  function requestViewUpdate(update: (current: URL) => URL, options: ViewUpdateOptions = {}): void {
    if (disposed) return;
    const base = viewRequests.at(-1)?.url ?? currentPageUrl();
    const requested = update(new URL(base));
    const view = dependencies.pages.resolveView(requested);
    const url = view?.normalize(requested) ?? requested;
    if (url.href === base.href) return;
    viewRequests.push({ ...options, url });
    if (viewRequests.length === 1) void drainViewRequests();
  }

  function replaceViewUrl(url: URL): void {
    // Traversal has already selected another history entry while the outgoing
    // page may still be interactive. It must not rewrite that destination.
    if (disposed || restoringTraversal || !locationMatchesPage()) return;
    if (!dependencies.pages.resolveView(url)) {
      throw new Error('A page may only replace URL parameters owned by its current view.');
    }
    persistPageScroll();
    sourceWindow.history.replaceState(sourceWindow.history.state, '', url);
    committedUrl = new URL(url);
    persistPageScroll();
  }

  function isCurrentTransaction(id: number): boolean {
    return !disposed && phase.kind !== 'idle' && phase.id === id;
  }

  function cancelScheduledScrollSave(): void {
    if (scrollSaveFrame === 0) return;
    sourceWindow.cancelAnimationFrame(scrollSaveFrame);
    scrollSaveFrame = 0;
  }

  function scheduleScrollSave(): void {
    if (restoringTraversal || scrollSaveFrame !== 0) return;
    scrollSaveFrame = sourceWindow.requestAnimationFrame(() => {
      scrollSaveFrame = 0;
      persistPageScroll();
    });
  }

  function prepareNavigation(rawEvent: Event): void {
    const event = rawEvent as TransitionBeforePreparationEvent;
    const id = ++sequence;
    const navigationType = event.navigationType;
    const request = viewRequests[0];
    if (request && event.info === request) {
      // An anchor can abort this request without emitting another preparation.
      // Completed/older requests must never cancel a newer queue head.
      event.signal.addEventListener(
        'abort',
        () => {
          if (viewRequests[0] === request) viewRequests.length = 0;
        },
        { once: true },
      );
    } else {
      viewRequests.length = 0;
    }
    if (routeKey(event.from) === routeKey(committedUrl)) committedUrl.hash = event.from.hash;
    const currentBuild = readDocumentBuildId(sourceDocument);
    const view =
      !event.formData &&
      decideBuildNavigation(CURRENT_BUILD_ID, currentBuild, currentBuild).mode === 'client'
        ? dependencies.pages.resolveView(event.to)
        : undefined;
    cancelScheduledScrollSave();
    restoringTraversal = navigationType === 'traverse';
    const scroll = restoringTraversal ? readCurrentScroll(sourceWindow, event.to) : undefined;
    if (!restoringTraversal) persistPageScroll();

    if (view) {
      event.to = view.normalize(new URL(event.to));
      pageTransition.cancel();
      phase = {
        kind: 'view',
        id,
        view,
        navigationType,
        scroll,
        originPoint: { x: sourceWindow.scrollX, y: sourceWindow.scrollY },
        hashChanged: event.from.hash !== event.to.hash,
        scrollTarget: event.info === request ? request?.scrollTarget : undefined,
      };
      pendingLocaleTransfer = undefined;
      pendingMainFocus = undefined;
      // Public Astro lifecycle: retain the current Document and let the router
      // commit history normally. The view is applied immediately after that
      // commit, before paint, so it always observes the authoritative URL.
      event.loader = async () => undefined;
      event.signal.addEventListener(
        'abort',
        () => {
          if (!isCurrentTransaction(id)) return;
          restoringTraversal = false;
          phase = { kind: 'idle' };
        },
        { once: true },
      );
      return;
    }

    viewRequests.length = 0;
    const feedbackId = feedback.begin(event.to.href);
    dependencies.closeDocumentOverlays();
    const focusMainContent = pendingMainFocus?.href === event.to.href;
    pendingMainFocus = undefined;

    const transferStorage = readableSessionStorage(sourceWindow);
    const localeTransfer =
      pendingLocaleTransfer &&
      localeNavigationRouteKey(pendingLocaleTransfer.target) === localeNavigationRouteKey(event.to)
        ? pendingLocaleTransfer
        : undefined;
    pendingLocaleTransfer = undefined;
    if (transferStorage) {
      if (localeTransfer) {
        persistLocaleNavigationTransfer(transferStorage, event.to, localeTransfer.point);
      } else {
        discardLocaleNavigationTransfer(transferStorage);
      }
    }
    let handingOffToDocument = false;

    phase = {
      kind: 'document',
      stage: 'preparing',
      id,
      feedbackId,
      navigationType,
      focusMainContent,
    };

    event.signal.addEventListener(
      'abort',
      () => {
        if (!handingOffToDocument && transferStorage && localeTransfer) {
          discardLocaleNavigationTransfer(transferStorage, event.to);
        }
        if (phase.kind === 'idle' || phase.id !== id) return;
        pageTransition.cancel();
        restoringTraversal = false;
        phase = { kind: 'idle' };
        // Astro aborts A immediately before preparing its replacement B. Let B
        // inherit A's feedback; with no replacement, clear it before the next paint.
        sourceWindow.queueMicrotask(() => feedback.cancel(feedbackId));
      },
      { once: true },
    );

    const frameworkLoader = event.loader;
    event.loader = async () => {
      await frameworkLoader();
      if (event.defaultPrevented || event.signal.aborted || !isCurrentTransaction(id)) {
        return;
      }

      const generation = decideBuildNavigation(
        CURRENT_BUILD_ID,
        readDocumentBuildId(sourceDocument),
        readDocumentBuildId(event.newDocument),
      );
      if (generation.mode === 'document') {
        // Astro 7.1.6 converts a cancelled preparation into a document
        // navigation. This is the only router-version-specific seam here.
        handingOffToDocument = true;
        event.preventDefault();
        return;
      }

      dependencies.pages.prepareTargetDocument(event.newDocument, event.to);

      try {
        const fontPreparation = prepareRequiredFonts(sourceDocument, event.newDocument, {
          signal: event.signal,
        });
        if (fontPreparation) await fontPreparation;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        throw error;
      }
      if (!event.signal.aborted && isCurrentTransaction(id)) {
        event.newDocument.documentElement.dataset.fontState = 'ready';
        feedback.prepared(feedbackId);
        await pageTransition.prepareOutgoing(event.signal);
      }
    };
  }

  function prepareSwap(rawEvent: Event): void {
    const event = rawEvent as TransitionBeforeSwapEvent;
    if (phase.kind === 'view') {
      const transaction = phase;
      event.viewTransition.skipTransition();
      event.swap = () => {
        if (event.signal.aborted || !isCurrentTransaction(transaction.id)) return;
        // Astro appends a fresh announcer after page-load. A normal body swap
        // removes the previous one; retaining the body makes cleanup ours.
        for (const announcer of sourceDocument.querySelectorAll('.astro-route-announcer')) {
          announcer.remove();
        }
        sourceDocument.documentElement.dataset.navigationScope = 'view';
      };
      return;
    }
    if (phase.kind !== 'document' || phase.stage !== 'preparing') return;

    reflectNavigationFeedback(event.newDocument, feedback.current());
    pageTransition.prepareSwap(event);
    const frameworkSwap = event.swap;
    event.swap = () => {
      dependencies.closeDocumentOverlays();
      dependencies.pages.beforeDocumentSwap(event.newDocument, event.to);
      frameworkSwap();
    };
    phase.stage = 'swapping';
  }

  function afterSwap(): void {
    if (phase.kind === 'view') {
      committedUrl = new URL(sourceWindow.location.href);
      phase.view.apply(committedUrl, {
        scroll: phase.scroll,
      });
      if (phase.navigationType === 'traverse') {
        if (phase.scroll) {
          restorePageScroll(sourceDocument, sourceWindow, phase.scroll.page);
          restoreNestedScroll(sourceDocument, phase.scroll);
        }
      } else if (!phase.hashChanged) {
        restorePageScroll(sourceDocument, sourceWindow, phase.originPoint);
      }
      phase.scrollTarget?.scrollIntoView({
        behavior: sourceWindow.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
        block: 'start',
      });
      restoringTraversal = false;
      phase = { kind: 'idle' };
      persistPageScroll();
      return;
    }
    if (phase.kind !== 'document' || phase.stage !== 'swapping') return;
    committedUrl = new URL(sourceWindow.location.href);

    const transferStorage = readableSessionStorage(sourceWindow);
    const localePoint = transferStorage
      ? consumeLocaleNavigationTransfer(transferStorage, sourceWindow.location)
      : undefined;
    if (localePoint) {
      restorePageScroll(sourceDocument, sourceWindow, localePoint);
    } else if (phase.navigationType === 'traverse') {
      const snapshot = readCurrentScroll(sourceWindow);
      if (snapshot) {
        // Starting a replacement navigation can update Astro's own root-scroll
        // cache while the outgoing DOM is still visible. Our entry snapshot
        // remains authoritative for both root and nested restoration.
        restorePageScroll(sourceDocument, sourceWindow, snapshot.page);
        restoreNestedScroll(sourceDocument, snapshot);
      }
    }
    if (phase.focusMainContent) {
      sourceDocument.querySelector<HTMLElement>('#main-content')?.focus({ preventScroll: true });
    }
    pageTransition.enterTarget();
    restoringTraversal = false;
    phase.stage = 'settling';
  }

  function finishNavigation(): void {
    // A page-load can arrive after another navigation has begun preparing.
    // Mount the current document by identity, independently of that new flight.
    dependencies.documentReady();
    if (phase.kind !== 'document' || phase.stage !== 'settling') return;
    feedback.finish(phase.feedbackId);
    restoringTraversal = false;
    phase = { kind: 'idle' };
  }

  function inspectNavigationClick(rawEvent: Event): void {
    const navigation = internalNavigation(sourceWindow, rawEvent as MouseEvent);
    if (!navigation) return;

    if (navigation.targetLocale) {
      // Static route generation cannot include the current query or fragment.
      // Complete the locale destination before ClientRouter reads the link.
      const currentUrl = currentPageUrl();
      navigation.target.search = currentUrl.search;
      navigation.target.hash = currentUrl.hash;
      navigation.link.href = navigation.target.href;
      try {
        saveLocalePreference(sourceWindow.localStorage, navigation.targetLocale);
      } catch {}
    }

    const href = navigation.target.href;

    const state = feedback.current();
    if (state.pending && href === state.href) {
      rawEvent.preventDefault();
      return;
    }

    const localeTransfer = navigation.targetLocale
      ? {
          target: navigation.target,
          point: { x: sourceWindow.scrollX, y: sourceWindow.scrollY },
        }
      : undefined;
    const mainFocus = (rawEvent as MouseEvent).detail === 0 ? new URL(href) : undefined;
    pendingLocaleTransfer = localeTransfer;
    pendingMainFocus = mainFocus;

    // These values describe this activation, not global navigation state. A
    // timer keeps them alive through the router's later event listener while
    // still discarding them before an unrelated future activation.
    sourceWindow.setTimeout(() => {
      if (pendingLocaleTransfer === localeTransfer) pendingLocaleTransfer = undefined;
      if (pendingMainFocus === mainFocus) pendingMainFocus = undefined;
    }, 0);
  }

  function persistBeforeDocumentLeaves(): void {
    // During an active traversal, history already points at the destination;
    // writing the outgoing DOM's position would corrupt that entry.
    if (phase.kind === 'idle') persistPageScroll();
  }

  sourceDocument.addEventListener('astro:before-preparation', prepareNavigation);
  sourceDocument.addEventListener('astro:before-swap', prepareSwap);
  sourceDocument.addEventListener('astro:after-swap', afterSwap);
  sourceDocument.addEventListener('astro:page-load', finishNavigation);
  sourceDocument.addEventListener('click', inspectNavigationClick, true);
  sourceDocument.addEventListener('scroll', scheduleScrollSave, { capture: true, passive: true });
  sourceWindow.addEventListener('pagehide', persistBeforeDocumentLeaves);

  return {
    requestViewUpdate,
    replaceViewUrl,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelScheduledScrollSave();
      viewRequests.length = 0;
      pendingLocaleTransfer = undefined;
      pendingMainFocus = undefined;
      restoringTraversal = false;
      phase = { kind: 'idle' };
      feedback.dispose();
      pageTransition.dispose();
      sourceDocument.removeEventListener('astro:before-preparation', prepareNavigation);
      sourceDocument.removeEventListener('astro:before-swap', prepareSwap);
      sourceDocument.removeEventListener('astro:after-swap', afterSwap);
      sourceDocument.removeEventListener('astro:page-load', finishNavigation);
      sourceDocument.removeEventListener('click', inspectNavigationClick, true);
      sourceDocument.removeEventListener('scroll', scheduleScrollSave, true);
      sourceWindow.removeEventListener('pagehide', persistBeforeDocumentLeaves);
    },
  };
}
