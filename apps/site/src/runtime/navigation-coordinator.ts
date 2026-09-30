import {
  navigate,
  type TransitionBeforePreparationEvent,
  type TransitionBeforeSwapEvent,
} from 'astro:transitions/client';
import { decideBuildNavigation, readDocumentBuildId } from './build-generation';
import { CURRENT_BUILD_ID } from './build-identity';
import { rethrowAfterCleanup, runCleanups } from './cleanup';
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
import { synchronizeClientRouterScrollState } from './initial-frame';
import type { PageNavigation, PageView, ViewUpdate, ViewUpdateOptions } from './page-navigation';
import type { PageRuntime } from './page-runtime';
import { prepareRequiredFonts } from './required-fonts';
import { prepareRequiredStylesheets } from './required-stylesheets';
import { mountInitialDocumentContent } from './initial-document-content';
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
      update: ViewUpdate;
      expectedUrl: string;
      navigationType: TransitionBeforePreparationEvent['navigationType'];
      scroll: ReturnType<typeof readCurrentScroll>;
      originPoint: LocaleNavigationPoint;
      hashChanged: boolean;
      resolveScroll?: ViewUpdateOptions['resolveScroll'];
      request?: ViewRequest;
    };

type ViewRequest = ViewUpdateOptions & {
  view: PageView;
  history: 'push' | 'replace';
  resolve(current: URL): ViewUpdate;
  update?: ViewUpdate;
  committed?: boolean;
};

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
  const listeners = new AbortController();
  let sequence = 0;
  let phase: NavigationPhase = { kind: 'idle' };
  let restoringTraversal = false;
  let scrollSaveFrame = 0;
  let fragmentSaveFrame = 0;
  let pendingLocaleTransfer: PendingLocaleTransfer | undefined;
  let pendingMainFocus: URL | undefined;
  let disposed = false;
  // During traversal the address bar already names the destination, while
  // this URL still belongs to the page the user can see and interact with.
  let committedUrl = new URL(sourceWindow.location.href);
  const viewRequests: ViewRequest[] = [];
  let activeViewRequest: ViewRequest | undefined;

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

  function cancelViewRequests(): void {
    viewRequests.length = 0;
    activeViewRequest = undefined;
  }

  function refreshRetainedView(id: number): void {
    // Native anchors can cancel a route without preparing a replacement. Saved
    // settings still belong to the retained page; reconcile after that decision.
    sourceWindow.queueMicrotask(() => {
      if (disposed || sequence !== id || phase.kind !== 'idle' || !locationMatchesPage()) return;
      const view = dependencies.pages.resolveView(currentPageUrl());
      view?.refresh?.();
    });
  }

  function failViewCommit(error: unknown, id: number): void {
    if (disposed || sequence !== id) return;
    restoringTraversal = false;
    phase = { kind: 'idle' };
    cancelViewRequests();
    sourceWindow.reportError(error);
    if (!disposed && sequence === id) sourceWindow.location.reload();
  }

  // A content failure can leave a partial view. Placement failures cannot undo
  // an already successful content commit, and must never trigger a reload.
  function applyView(update: ViewUpdate, scroll?: ReturnType<typeof readCurrentScroll>): boolean {
    const id = sequence;
    try {
      update.apply({ scroll });
      return true;
    } catch (error) {
      failViewCommit(error, id);
      return false;
    }
  }

  function finishViewEffects(
    update: ViewUpdate,
    restore: () => void,
    resolveScroll?: ViewUpdateOptions['resolveScroll'],
  ): void {
    try {
      runCleanups(
        () => update.afterApply?.(),
        restore,
        () => {
          const point = resolveScroll?.();
          if (point) restorePageScroll(sourceDocument, sourceWindow, point);
        },
        persistPageScroll,
      );
    } catch (error) {
      sourceWindow.reportError(error);
    }
  }

  async function drainViewRequests(interruptNavigation = false): Promise<void> {
    if (activeViewRequest) return;
    if (phase.kind !== 'idle' && (!interruptNavigation || viewRequests[0]?.history !== 'push'))
      return;
    while (!disposed && viewRequests.length > 0) {
      const request = viewRequests.shift()!;
      activeViewRequest = request;
      try {
        const current = currentPageUrl();
        if (dependencies.pages.resolveView(current) !== request.view) {
          cancelViewRequests();
          return;
        }
        const update = request.resolve(new URL(current));
        request.update = update;
        if (update.url.href === current.href) {
          const origin = { x: sourceWindow.scrollX, y: sourceWindow.scrollY };
          if (!applyView(update)) return;
          finishViewEffects(update, () => restorePageScroll(sourceDocument, sourceWindow, origin));
        } else {
          await navigate(update.url.href, {
            history: request.history,
            ...(request.history === 'replace' ? { state: sourceWindow.history.state } : {}),
            sourceElement: request.sourceElement,
            info: request,
          });
          if (activeViewRequest === request && !request.committed) {
            throw new Error('View navigation completed without applying the requested view.');
          }
        }
      } catch (error) {
        if (activeViewRequest !== request) return;
        cancelViewRequests();
        if (phase.kind === 'view' && phase.request === request) {
          phase = { kind: 'idle' };
          restoringTraversal = false;
        }
        if (request.history === 'push') refreshRetainedView(sequence);
        sourceWindow.reportError(error);
        return;
      }
      if (activeViewRequest !== request) return;
      activeViewRequest = undefined;
      if (phase.kind !== 'idle') return;
    }
  }

  function requestViewUpdate(
    resolve: (current: URL) => ViewUpdate,
    options: ViewUpdateOptions = {},
  ): void {
    if (disposed) return;
    const view = dependencies.pages.resolveView(currentPageUrl());
    if (!view) return;
    viewRequests.push({ view, history: 'push', resolve, ...options });
    void drainViewRequests(true);
  }

  function requestViewRefresh(resolve: (current: URL) => ViewUpdate): void {
    // Confirmed preferences are saved separately, even when the old page leaves.
    // A newly mounted target can enqueue its canonicalization while settling.
    if (disposed || (phase.kind === 'document' && phase.stage !== 'settling')) return;
    const view = dependencies.pages.resolveView(currentPageUrl());
    if (!view) return;
    viewRequests.push({ view, history: 'replace', resolve });
    // Initial canonicalization is queued while the runtime is mounting. Let
    // installation finish and release its document-navigation guard first.
    sourceWindow.queueMicrotask(() => {
      void drainViewRequests();
    });
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

  function settleDocumentNavigation(
    transaction: Extract<NavigationPhase, { kind: 'document' }>,
    failed: boolean,
  ): void {
    if (disposed || phase !== transaction) return;
    restoringTraversal = false;
    phase = { kind: 'idle' };
    if (failed) {
      refreshRetainedView(transaction.id);
      runCleanups(
        () => pageTransition.cancel(),
        () => feedback.cancel(transaction.feedbackId),
      );
    } else {
      feedback.finish(transaction.feedbackId);
    }
  }

  function failDocumentNavigation(
    transaction: Extract<NavigationPhase, { kind: 'document' }>,
    error: unknown,
    cleanup: () => void = () => {},
  ): never {
    // Traversal changes the URL before the document commits. Only that failed
    // current transaction needs a native load of the already-selected entry.
    const reloadTraversal =
      !disposed &&
      phase === transaction &&
      transaction.navigationType === 'traverse' &&
      !locationMatchesPage();
    try {
      rethrowAfterCleanup(error, () => {
        if (disposed || phase !== transaction) return;
        runCleanups(() => settleDocumentNavigation(transaction, true), cleanup);
      });
    } catch (failure) {
      if (reloadTraversal && !disposed && sequence === transaction.id) {
        // Do not rely on a later unhandledrejection: unloading can discard it.
        // Still reject below so Astro cannot continue a failed preparation/swap.
        sourceWindow.reportError(failure);
        if (!disposed && sequence === transaction.id) sourceWindow.location.reload();
      }
      throw failure;
    }
  }

  function cancelFragmentScrollSave(): void {
    if (fragmentSaveFrame === 0) return;
    sourceWindow.cancelAnimationFrame(fragmentSaveFrame);
    fragmentSaveFrame = 0;
  }

  function cancelScheduledScrollSave(): void {
    cancelFragmentScrollSave();
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

  function saveFragmentCommit(event: PopStateEvent): void {
    cancelFragmentScrollSave();
    // Astro notifies same-page link commits with a null-state popstate.
    if (event.state !== null || sourceWindow.history.state === null) return;
    const href = sourceWindow.location.href;
    fragmentSaveFrame = sourceWindow.requestAnimationFrame(() => {
      fragmentSaveFrame = 0;
      if (
        disposed ||
        phase.kind !== 'idle' ||
        sourceWindow.location.href !== href ||
        !locationMatchesPage()
      )
        return;
      // Run after the article has handled the fragment, even when no scroll occurs.
      persistPageScroll();
      synchronizeClientRouterScrollState(sourceWindow.history, {
        x: sourceWindow.scrollX,
        y: sourceWindow.scrollY,
      });
    });
  }

  function prepareNavigation(rawEvent: Event): void {
    const event = rawEvent as TransitionBeforePreparationEvent;
    const id = ++sequence;
    const navigationType = event.navigationType;
    const request =
      activeViewRequest && event.info === activeViewRequest ? activeViewRequest : undefined;
    if (!request) cancelViewRequests();
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
      const update = request?.update ?? view.resolve(new URL(event.to));
      // Traversal selects its entry before normalization; other navigations
      // commit the resolved target directly.
      const expectedUrl = restoringTraversal ? event.to.href : update.url.href;
      event.to = update.url;
      pageTransition.cancel();
      phase = {
        kind: 'view',
        id,
        update,
        expectedUrl,
        navigationType,
        scroll,
        originPoint: { x: sourceWindow.scrollX, y: sourceWindow.scrollY },
        hashChanged: event.from.hash !== event.to.hash,
        resolveScroll: request?.resolveScroll,
        request,
      };
      pendingLocaleTransfer = undefined;
      pendingMainFocus = undefined;
      // Public Astro lifecycle: retain the current Document and let the router
      // commit history normally. The view is applied immediately after that
      // commit, before paint, so it always observes the authoritative URL.
      event.loader = async () => {
        dependencies.closeDocumentOverlays();
      };
      event.signal.addEventListener(
        'abort',
        () => {
          if (disposed || sequence !== id) return;
          // A newly starting route may already own the queue. Otherwise all
          // commands attached to the cancelled view navigation are obsolete.
          if (activeViewRequest === request) cancelViewRequests();
          restoringTraversal = false;
          phase = { kind: 'idle' };
          refreshRetainedView(id);
        },
        { once: true },
      );
      return;
    }

    cancelViewRequests();
    const feedbackId = feedback.begin(event.to.href);
    const focusMainContent = pendingMainFocus?.href === event.to.href;
    pendingMainFocus = undefined;

    const transferStorage = readableSessionStorage(sourceWindow);
    const localeTransfer =
      pendingLocaleTransfer &&
      localeNavigationRouteKey(pendingLocaleTransfer.target) === localeNavigationRouteKey(event.to)
        ? pendingLocaleTransfer
        : undefined;
    pendingLocaleTransfer = undefined;
    let handingOffToDocument = false;

    const transaction: Extract<NavigationPhase, { kind: 'document' }> = {
      kind: 'document',
      stage: 'preparing',
      id,
      feedbackId,
      navigationType,
      focusMainContent,
    };
    phase = transaction;

    event.signal.addEventListener(
      'abort',
      () => {
        if (!handingOffToDocument && transferStorage && localeTransfer) {
          discardLocaleNavigationTransfer(transferStorage, event.to);
        }
        if (phase.kind === 'idle' || phase.id !== id) return;
        restoringTraversal = false;
        phase = { kind: 'idle' };
        // Astro aborts A immediately before preparing its replacement B. Let B
        // inherit A's feedback; with no replacement, clear it before the next paint.
        sourceWindow.queueMicrotask(() => feedback.cancel(feedbackId));
        refreshRetainedView(id);
        pageTransition.cancel();
      },
      { once: true },
    );

    const frameworkLoader = event.loader;
    event.loader = async () => {
      try {
        // Preparation failures must reject the loader, not just throw from the
        // before-preparation listener (dispatchEvent does not propagate those).
        dependencies.closeDocumentOverlays();
        if (transferStorage) {
          if (localeTransfer) {
            persistLocaleNavigationTransfer(transferStorage, event.to, localeTransfer.point);
          } else {
            discardLocaleNavigationTransfer(transferStorage);
          }
        }
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

        // Prepare only the detached target; the current page remains displayed.
        mountInitialDocumentContent(event.newDocument);
        dependencies.pages.prepareTargetDocument(event.newDocument, event.to);

        const styles = prepareRequiredStylesheets(sourceDocument, event.newDocument, {
          signal: event.signal,
        });
        if (styles) await styles;
        if (event.signal.aborted || !isCurrentTransaction(id)) return;
        const fontPreparation = prepareRequiredFonts(sourceDocument, event.newDocument, {
          signal: event.signal,
        });
        if (fontPreparation) await fontPreparation;
        if (!event.signal.aborted && isCurrentTransaction(id)) {
          event.newDocument.documentElement.dataset.fontState = 'ready';
          feedback.prepared(feedbackId);
          await pageTransition.prepareOutgoing(event.signal);
        }
      } catch (error) {
        if (event.signal.aborted && error instanceof DOMException && error.name === 'AbortError')
          return;
        failDocumentNavigation(transaction, error, () => {
          if (!handingOffToDocument && transferStorage && localeTransfer) {
            discardLocaleNavigationTransfer(transferStorage, event.to);
          }
        });
      }
    };
  }

  function prepareSwap(rawEvent: Event): void {
    const event = rawEvent as TransitionBeforeSwapEvent;
    if (phase.kind === 'view') {
      const transaction = phase;
      // Skipping our local animation intentionally rejects ready. The router
      // owns updateCallbackDone; handle only this animation's expected rejection.
      void event.viewTransition.ready.catch(() => undefined);
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

    const transaction = phase;
    const frameworkSwap = event.swap;
    event.swap = () => {
      try {
        reflectNavigationFeedback(event.newDocument, feedback.current());
        pageTransition.prepareSwap(event);
        dependencies.closeDocumentOverlays();
        dependencies.pages.beforeDocumentSwap(event.newDocument, event.to);
        frameworkSwap();
      } catch (error) {
        failDocumentNavigation(transaction, error);
      }
    };
    phase.stage = 'swapping';
  }

  function afterSwap(): void {
    if (phase.kind === 'view') {
      const transaction = phase;
      try {
        const actual = new URL(sourceWindow.location.href);
        // An aborted Astro swap may still commit its old location. Leave a
        // newer transaction pending until its own target actually commits.
        if (actual.href !== transaction.expectedUrl) return;
        committedUrl = new URL(transaction.update.url);
        if (committedUrl.href !== actual.href) {
          // Astro already targets the normalized URL. Traversal alone retains the
          // selected entry's old address, so correct it without another visit.
          sourceWindow.history.replaceState(sourceWindow.history.state, '', committedUrl);
        }
      } catch (error) {
        failViewCommit(error, transaction.id);
        return;
      }
      if (!applyView(transaction.update, transaction.scroll) || phase !== transaction) return;
      if (transaction.request) transaction.request.committed = true;
      restoringTraversal = false;
      phase = { kind: 'idle' };
      finishViewEffects(
        transaction.update,
        () => {
          if (transaction.navigationType === 'traverse') {
            if (transaction.scroll) {
              restorePageScroll(sourceDocument, sourceWindow, transaction.scroll.page);
              restoreNestedScroll(sourceDocument, transaction.scroll);
            }
          } else if (!transaction.hashChanged) {
            restorePageScroll(sourceDocument, sourceWindow, transaction.originPoint);
          }
        },
        transaction.navigationType === 'traverse' ? undefined : transaction.resolveScroll,
      );
      return;
    }
    if (phase.kind !== 'document' || phase.stage !== 'swapping') return;
    const transaction = phase;
    try {
      committedUrl = new URL(sourceWindow.location.href);
      dependencies.pages.prepareCurrentLayout?.();

      const transferStorage = readableSessionStorage(sourceWindow);
      const localePoint = transferStorage
        ? consumeLocaleNavigationTransfer(transferStorage, sourceWindow.location)
        : undefined;
      const snapshot =
        !localePoint && transaction.navigationType === 'traverse'
          ? readCurrentScroll(sourceWindow)
          : undefined;
      if (localePoint) {
        restorePageScroll(sourceDocument, sourceWindow, localePoint);
      } else if (snapshot) {
        // Starting a replacement navigation can update Astro's own root-scroll
        // cache while the outgoing DOM is still visible. Our entry snapshot
        // remains authoritative for both root and nested restoration.
        restorePageScroll(sourceDocument, sourceWindow, snapshot.page);
      }
      dependencies.pages.prepareCurrentDocument();
      if (snapshot) restoreNestedScroll(sourceDocument, snapshot);
      if (transaction.focusMainContent) {
        sourceDocument.querySelector<HTMLElement>('#main-content')?.focus({ preventScroll: true });
      }
      if (phase !== transaction) return;
      pageTransition.enterTarget();
      restoringTraversal = false;
      transaction.stage = 'settling';
    } catch (error) {
      failDocumentNavigation(transaction, error);
    }
  }

  function finishNavigation(): void {
    // A page-load can arrive after another navigation has begun preparing.
    // Mount the current document by identity, independently of that new flight.
    const transaction = phase.kind === 'document' && phase.stage === 'settling' ? phase : undefined;
    try {
      dependencies.documentReady();
    } catch (error) {
      if (transaction) failDocumentNavigation(transaction, error);
      throw error;
    }
    if (transaction) settleDocumentNavigation(transaction, false);
    if (phase.kind === 'idle' && viewRequests.length) void drainViewRequests();
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

  const coordinator = {
    requestViewUpdate,
    requestViewRefresh,
    replaceViewUrl,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelViewRequests();
      pendingLocaleTransfer = undefined;
      pendingMainFocus = undefined;
      restoringTraversal = false;
      phase = { kind: 'idle' };
      runCleanups(
        () => listeners.abort(),
        cancelScheduledScrollSave,
        () => feedback.dispose(),
        () => pageTransition.dispose(),
      );
    },
  };

  try {
    sourceDocument.addEventListener('astro:before-preparation', prepareNavigation, {
      signal: listeners.signal,
    });
    sourceDocument.addEventListener('astro:before-swap', prepareSwap, { signal: listeners.signal });
    sourceDocument.addEventListener('astro:after-swap', afterSwap, { signal: listeners.signal });
    sourceDocument.addEventListener('astro:page-load', finishNavigation, {
      signal: listeners.signal,
    });
    sourceDocument.addEventListener('click', inspectNavigationClick, {
      capture: true,
      signal: listeners.signal,
    });
    sourceDocument.addEventListener('scroll', scheduleScrollSave, {
      capture: true,
      passive: true,
      signal: listeners.signal,
    });
    sourceWindow.addEventListener('popstate', saveFragmentCommit, { signal: listeners.signal });
    sourceWindow.addEventListener('pagehide', persistBeforeDocumentLeaves, {
      signal: listeners.signal,
    });
    return coordinator;
  } catch (error) {
    rethrowAfterCleanup(error, coordinator.dispose);
  }
}
