import type {
  TransitionBeforePreparationEvent,
  TransitionBeforeSwapEvent,
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
import { prepareRequiredFonts } from './required-fonts';
import {
  persistCurrentScroll,
  readCurrentScroll,
  restoreNestedScroll,
  restorePageScroll,
} from './scroll-state';

type NavigationPhase =
  | { kind: 'idle' }
  | {
      kind: 'preparing';
      id: number;
      feedbackId: number;
      navigationType: string;
      focusMainContent: boolean;
    }
  | {
      kind: 'swapping';
      id: number;
      feedbackId: number;
      navigationType: string;
      focusMainContent: boolean;
    }
  | {
      kind: 'settling';
      id: number;
      feedbackId: number;
      navigationType: string;
      focusMainContent: boolean;
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

export type TargetDocumentPreparer = (targetDocument: Document, targetUrl: URL) => void;

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
  sourceDocument: Document = document,
  sourceWindow: Window = window,
  prepareTargetDocument: TargetDocumentPreparer = () => undefined,
): () => void {
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
      persistCurrentScroll(sourceDocument, sourceWindow);
    });
  }

  function prepareNavigation(rawEvent: Event): void {
    const event = rawEvent as TransitionBeforePreparationEvent;
    const id = ++sequence;
    const navigationType = event.navigationType;
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
    if (transferStorage) {
      if (localeTransfer) {
        persistLocaleNavigationTransfer(transferStorage, event.to, localeTransfer.point);
      } else {
        discardLocaleNavigationTransfer(transferStorage);
      }
    }
    let handingOffToDocument = false;

    restoringTraversal = navigationType === 'traverse';
    phase = {
      kind: 'preparing',
      id,
      feedbackId,
      navigationType,
      focusMainContent,
    };
    if (restoringTraversal) cancelScheduledScrollSave();
    else persistCurrentScroll(sourceDocument, sourceWindow);

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
        feedback.cancel(feedbackId);
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

      prepareTargetDocument(event.newDocument, event.to);

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
        await pageTransition.prepareOutgoing(event.signal);
      }
    };
  }

  function prepareSwap(rawEvent: Event): void {
    const event = rawEvent as TransitionBeforeSwapEvent;
    if (phase.kind !== 'preparing') return;

    reflectNavigationFeedback(event.newDocument, feedback.current());
    pageTransition.prepareSwap(event);
    phase = {
      kind: 'swapping',
      id: phase.id,
      feedbackId: phase.feedbackId,
      navigationType: phase.navigationType,
      focusMainContent: phase.focusMainContent,
    };
  }

  function afterSwap(): void {
    if (phase.kind !== 'swapping') return;

    const transferStorage = readableSessionStorage(sourceWindow);
    const localePoint = transferStorage
      ? consumeLocaleNavigationTransfer(transferStorage, sourceWindow.location)
      : undefined;
    if (localePoint) {
      restorePageScroll(sourceDocument, sourceWindow, localePoint);
    } else if (phase.navigationType === 'traverse') {
      const snapshot = readCurrentScroll(sourceWindow);
      if (snapshot) restoreNestedScroll(sourceDocument, snapshot);
    }
    if (phase.focusMainContent) {
      sourceDocument.querySelector<HTMLElement>('#main-content')?.focus({ preventScroll: true });
    }
    pageTransition.enterTarget();
    restoringTraversal = false;
    phase = {
      kind: 'settling',
      id: phase.id,
      feedbackId: phase.feedbackId,
      navigationType: phase.navigationType,
      focusMainContent: phase.focusMainContent,
    };
  }

  function finishNavigation(): void {
    if (phase.kind === 'idle') return;
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
      navigation.target.search = sourceWindow.location.search;
      navigation.target.hash = sourceWindow.location.hash;
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
    if (phase.kind === 'idle') persistCurrentScroll(sourceDocument, sourceWindow);
  }

  sourceDocument.addEventListener('astro:before-preparation', prepareNavigation);
  sourceDocument.addEventListener('astro:before-swap', prepareSwap);
  sourceDocument.addEventListener('astro:after-swap', afterSwap);
  sourceDocument.addEventListener('astro:page-load', finishNavigation);
  sourceDocument.addEventListener('click', inspectNavigationClick, true);
  sourceDocument.addEventListener('scroll', scheduleScrollSave, { capture: true, passive: true });
  sourceWindow.addEventListener('pagehide', persistBeforeDocumentLeaves);

  return () => {
    if (disposed) return;
    disposed = true;
    cancelScheduledScrollSave();
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
  };
}
