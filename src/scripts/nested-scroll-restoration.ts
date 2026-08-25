import { SITE_STORAGE_KEYS } from '../lib/site-preferences';
import { claimClientRuntime } from './client-runtime';

const CONTAINER_SELECTOR = '[data-scroll-restoration-key]';
const PERSIST_DELAY_MS = 120;
const USER_SCROLL_INTENT_WINDOW_MS = 500;
const SCROLL_KEYS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
  ' ',
]);

type SavedScrollPosition = {
  top: number;
  left: number;
};

type HydratingScrollContainer = {
  element: HTMLElement;
  storageKey: string;
  target: SavedScrollPosition;
  userPosition?: SavedScrollPosition;
  scrollIntentUntil: number;
  activePointers: Set<number>;
};

function positionStorageKey(pathname: string, restorationKey: string) {
  return `${SITE_STORAGE_KEYS.nestedScrollPositionPrefix}${pathname}:${restorationKey}`;
}

function savedPosition(pathname: string, restorationKey: string): SavedScrollPosition | undefined {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(positionStorageKey(pathname, restorationKey)) ?? 'null',
    );
    return typeof value === 'object' && value !== null ? (value as SavedScrollPosition) : undefined;
  } catch {
    return undefined;
  }
}

function currentPosition(element: HTMLElement): SavedScrollPosition {
  return { top: element.scrollTop, left: element.scrollLeft };
}

function isValidPosition(
  position: SavedScrollPosition | undefined,
): position is SavedScrollPosition {
  return Boolean(position && Number.isFinite(position.top) && Number.isFinite(position.left));
}

function restorePosition(element: HTMLElement, saved: SavedScrollPosition | undefined) {
  if (!isValidPosition(saved)) return;

  const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
  const maxLeft = Math.max(0, element.scrollWidth - element.clientWidth);
  element.scrollTop = Math.min(maxTop, Math.max(0, saved.top));
  element.scrollLeft = Math.min(maxLeft, Math.max(0, saved.left));
}

export function startNestedScrollRestoration() {
  const runtime = claimClientRuntime('nested-scroll-restoration');
  let activePathname = location.pathname;
  let hydrationListeners = new AbortController();
  let persistTimer: number | undefined;
  const pendingPositions = new Map<string, SavedScrollPosition>();
  const hydratingContainers = new Map<HTMLElement, HydratingScrollContainer>();

  const clearPersistTimer = () => {
    if (persistTimer !== undefined) window.clearTimeout(persistTimer);
    persistTimer = undefined;
  };

  const flushPendingPositions = () => {
    clearPersistTimer();
    for (const [storageKey, position] of pendingPositions) {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(position));
      } catch {
        // Scroll restoration is progressive enhancement when storage is unavailable.
      }
    }
    pendingPositions.clear();
  };

  const capturePosition = (element: HTMLElement, position = currentPosition(element)) => {
    const key = element.dataset.scrollRestorationKey;
    if (!key) return;
    pendingPositions.set(positionStorageKey(activePathname, key), position);
  };

  const persistCurrentPositions = () => {
    document.querySelectorAll<HTMLElement>(CONTAINER_SELECTOR).forEach((element) => {
      const hydrating = hydratingContainers.get(element);
      capturePosition(element, hydrating?.userPosition ?? hydrating?.target);
    });
    flushPendingPositions();
  };

  const schedulePersistence = (
    element: HTMLElement,
    position: SavedScrollPosition = currentPosition(element),
  ) => {
    capturePosition(element, position);
    clearPersistTimer();
    persistTimer = window.setTimeout(flushPendingPositions, PERSIST_DELAY_MS);
  };

  const restoreCurrentPositions = () => {
    document.querySelectorAll<HTMLElement>(CONTAINER_SELECTOR).forEach((element) => {
      const key = element.dataset.scrollRestorationKey;
      restorePosition(element, key ? savedPosition(activePathname, key) : undefined);
    });
  };

  const watchHydratingIslands = () => {
    hydrationListeners.abort();
    hydrationListeners = new AbortController();
    hydratingContainers.clear();
    const islands = new Map<HTMLElement, HydratingScrollContainer[]>();

    document.querySelectorAll<HTMLElement>(CONTAINER_SELECTOR).forEach((element) => {
      const island = element.closest<HTMLElement>('astro-island[ssr]');
      const restorationKey = element.dataset.scrollRestorationKey;
      if (!island || !restorationKey) return;
      const storedTarget = savedPosition(activePathname, restorationKey);

      const state: HydratingScrollContainer = {
        element,
        storageKey: positionStorageKey(activePathname, restorationKey),
        target: isValidPosition(storedTarget) ? storedTarget : currentPosition(element),
        scrollIntentUntil: 0,
        activePointers: new Set(),
      };
      hydratingContainers.set(element, state);
      const islandStates = islands.get(island) ?? [];
      islandStates.push(state);
      islands.set(island, islandStates);
    });

    const pathname = activePathname;
    for (const [island, states] of islands) {
      const finishHydration = (event: Event) => {
        if (event.target !== island || pathname !== activePathname) return;
        island.removeEventListener('astro:hydrate', finishHydration);
        island.removeEventListener('astro:hydration-error', finishHydration);

        for (const state of states) {
          hydratingContainers.delete(state.element);
          pendingPositions.delete(state.storageKey);
          restorePosition(state.element, state.userPosition ?? state.target);
          pendingPositions.set(state.storageKey, currentPosition(state.element));
        }
        flushPendingPositions();
      };
      island.addEventListener('astro:hydrate', finishHydration, {
        signal: hydrationListeners.signal,
      });
      island.addEventListener('astro:hydration-error', finishHydration, {
        signal: hydrationListeners.signal,
      });
    }
  };

  const containerFromEventTarget = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLElement>(CONTAINER_SELECTOR) : null;

  const markScrollIntent = (target: EventTarget | null) => {
    const element = containerFromEventTarget(target);
    const hydrating = element ? hydratingContainers.get(element) : undefined;
    if (hydrating) {
      hydrating.scrollIntentUntil = performance.now() + USER_SCROLL_INTENT_WINDOW_MS;
    }
  };

  const activatePage = () => {
    activePathname = location.pathname;
    restoreCurrentPositions();
    watchHydratingIslands();
  };

  const releasePage = () => {
    persistCurrentPositions();
    hydrationListeners.abort();
    hydratingContainers.clear();
  };

  activatePage();
  runtime.listen(
    document,
    'scroll',
    (event) => {
      if (event.target instanceof HTMLElement && event.target.matches(CONTAINER_SELECTOR)) {
        const hydrating = hydratingContainers.get(event.target);
        if (hydrating) {
          const hasUserIntent =
            hydrating.activePointers.size > 0 || performance.now() <= hydrating.scrollIntentUntil;
          if (hasUserIntent) {
            hydrating.userPosition = currentPosition(event.target);
            schedulePersistence(event.target, hydrating.userPosition);
          }
          return;
        }
        schedulePersistence(event.target);
      }
    },
    { capture: true, passive: true },
  );
  runtime.listen(document, 'wheel', (event) => markScrollIntent(event.target), {
    capture: true,
    passive: true,
  });
  runtime.listen(
    document,
    'keydown',
    (event) => {
      if (event instanceof KeyboardEvent && SCROLL_KEYS.has(event.key)) {
        markScrollIntent(event.target);
      }
    },
    { capture: true },
  );
  runtime.listen(
    document,
    'pointerdown',
    (event) => {
      if (!(event instanceof PointerEvent)) return;
      const element = containerFromEventTarget(event.target);
      const hydrating = element ? hydratingContainers.get(element) : undefined;
      if (!hydrating) return;
      hydrating.activePointers.add(event.pointerId);
      hydrating.scrollIntentUntil = performance.now() + USER_SCROLL_INTENT_WINDOW_MS;
    },
    { capture: true, passive: true },
  );
  const releasePointer = (event: Event) => {
    if (!(event instanceof PointerEvent)) return;
    hydratingContainers.forEach((state) => {
      if (state.activePointers.delete(event.pointerId)) {
        // Preserve touch momentum and the final scrollbar movement after pointer release.
        state.scrollIntentUntil = performance.now() + USER_SCROLL_INTENT_WINDOW_MS;
      }
    });
  };
  runtime.listen(document, 'pointerup', releasePointer, { capture: true, passive: true });
  runtime.listen(document, 'pointercancel', releasePointer, { capture: true, passive: true });
  runtime.listen(document, 'site:before-swap', releasePage);
  runtime.listen(document, 'site:after-swap', activatePage);
  runtime.listen(window, 'pagehide', persistCurrentPositions);
  runtime.onDispose(releasePage);

  return runtime.dispose;
}
