import {
  applyArticleSidebarBootstrap,
  ARTICLE_SIDEBAR_LIMITS,
  ARTICLE_SIDEBAR_STORAGE_KEY,
  readArticleSidebarState,
  type ArticleSidebarState,
} from './article-sidebar-state';
import { rethrowAfterCleanup, runCleanups } from '../../../runtime/cleanup';

const DESKTOP_MEDIA = '(min-width: 64rem)';
const KEYBOARD_STEP = 16;
const COLLAPSE_DURATION_MS = 200;

type DragStart = {
  pointerId: number;
  x: number;
  width: number;
};

export type ArticleSidebarController = {
  destroy(): void;
};

function clampWidth(width: number): number {
  return Math.min(
    ARTICLE_SIDEBAR_LIMITS.maxWidth,
    Math.max(ARTICLE_SIDEBAR_LIMITS.minWidth, width),
  );
}

export function createArticleSidebarController(
  layout: HTMLElement,
  sourceWindow: Window,
): ArticleSidebarController | undefined {
  const sidebar = layout.querySelector<HTMLElement>('[data-article-sidebar-panel]');
  const toggle = layout.querySelector<HTMLButtonElement>('[data-article-sidebar-toggle]');
  const resizer = layout.querySelector<HTMLElement>('[data-article-sidebar-resizer]');
  if (!sidebar || !toggle || !resizer) return;

  const media = sourceWindow.matchMedia(DESKTOP_MEDIA);
  const listeners = new AbortController();
  const collapseLabel = toggle.dataset.collapseLabel ?? toggle.getAttribute('aria-label') ?? '';
  const expandLabel = toggle.dataset.expandLabel ?? collapseLabel;
  let state: ArticleSidebarState = {
    collapsed: false,
    width: ARTICLE_SIDEBAR_LIMITS.defaultWidth,
  };
  try {
    state = readArticleSidebarState(sourceWindow.localStorage);
  } catch {
    // The default state remains interactive when Storage itself is unavailable.
  }
  let dragStart: DragStart | undefined;
  let animationTimer: number | undefined;
  let destroyed = false;

  const restoreStaticFallback = () => {
    runCleanups(
      () => {
        sidebar.inert = false;
        sidebar.removeAttribute('aria-hidden');
      },
      () => {
        toggle.disabled = true;
        toggle.setAttribute('aria-disabled', 'true');
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-label', collapseLabel);
        toggle.removeAttribute('data-article-sidebar-expand');
        toggle.setAttribute('data-article-sidebar-collapse', '');
      },
      () => {
        resizer.tabIndex = -1;
        resizer.setAttribute('aria-disabled', 'true');
        resizer.removeAttribute('data-dragging');
      },
      () => {
        layout.removeAttribute('data-sidebar-animating');
        layout.removeAttribute('data-sidebar-collapsed');
        layout.removeAttribute('data-sidebar-dragging');
        layout.removeAttribute('data-sidebar-controlled');
        layout.style.setProperty('--article-sidebar-current-width', `${state.width}px`);
        layout.style.setProperty(
          '--article-sidebar-current-track',
          'var(--article-sidebar-current-width)',
        );
      },
    );
  };

  const enableControls = () => {
    toggle.disabled = false;
    toggle.removeAttribute('aria-disabled');
    resizer.tabIndex = 0;
    resizer.removeAttribute('aria-disabled');
  };

  const clearAnimation = () => {
    const timer = animationTimer;
    animationTimer = undefined;
    layout.removeAttribute('data-sidebar-animating');
    if (timer !== undefined) sourceWindow.clearTimeout(timer);
  };

  const applyState = (nextState: ArticleSidebarState) => {
    state = { collapsed: nextState.collapsed, width: clampWidth(nextState.width) };
    const effectivelyCollapsed = media.matches && state.collapsed;

    layout.style.setProperty('--article-sidebar-current-width', `${state.width}px`);
    layout.style.setProperty(
      '--article-sidebar-current-track',
      effectivelyCollapsed ? '0px' : 'var(--article-sidebar-current-width)',
    );
    layout.toggleAttribute('data-sidebar-collapsed', effectivelyCollapsed);
    sidebar.inert = effectivelyCollapsed;
    if (effectivelyCollapsed) sidebar.setAttribute('aria-hidden', 'true');
    else sidebar.removeAttribute('aria-hidden');

    toggle.setAttribute('aria-expanded', String(!effectivelyCollapsed));
    toggle.setAttribute('aria-label', effectivelyCollapsed ? expandLabel : collapseLabel);
    toggle.toggleAttribute('data-article-sidebar-expand', effectivelyCollapsed);
    toggle.toggleAttribute('data-article-sidebar-collapse', !effectivelyCollapsed);
    resizer.setAttribute('aria-valuenow', String(Math.round(state.width)));
  };

  const commitState = () => {
    applyArticleSidebarBootstrap(sourceWindow.document.documentElement, state);
    try {
      sourceWindow.localStorage.setItem(ARTICLE_SIDEBAR_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // The in-memory state remains authoritative when persistence is unavailable.
    }
  };

  const setCollapsed = (collapsed: boolean) => {
    if (!media.matches || state.collapsed === collapsed) return;
    clearAnimation();
    if (!sourceWindow.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      layout.setAttribute('data-sidebar-animating', '');
      void layout.offsetWidth;
    }
    applyState({ ...state, collapsed });
    commitState();
    toggle.focus({ preventScroll: true });
    if (layout.hasAttribute('data-sidebar-animating')) {
      animationTimer = sourceWindow.setTimeout(clearAnimation, COLLAPSE_DURATION_MS + 80);
    }
  };

  const finishDragging = (event?: PointerEvent) => {
    if (!dragStart) return;
    const pointerId = dragStart.pointerId;
    dragStart = undefined;
    layout.removeAttribute('data-sidebar-dragging');
    resizer.removeAttribute('data-dragging');
    if (event && resizer.hasPointerCapture(pointerId)) resizer.releasePointerCapture(pointerId);
    commitState();
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !media.matches || state.collapsed) return;
    clearAnimation();
    dragStart = { pointerId: event.pointerId, x: event.clientX, width: state.width };
    resizer.setPointerCapture(event.pointerId);
    layout.setAttribute('data-sidebar-dragging', '');
    resizer.setAttribute('data-dragging', '');
    event.preventDefault();
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!dragStart || event.pointerId !== dragStart.pointerId) return;
    applyState({ ...state, width: dragStart.width - (event.clientX - dragStart.x) });
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    let nextWidth: number | undefined;
    if (event.key === 'ArrowLeft') nextWidth = state.width + KEYBOARD_STEP;
    if (event.key === 'ArrowRight') nextWidth = state.width - KEYBOARD_STEP;
    if (event.key === 'Home') nextWidth = ARTICLE_SIDEBAR_LIMITS.minWidth;
    if (event.key === 'End') nextWidth = ARTICLE_SIDEBAR_LIMITS.maxWidth;
    if (event.key === 'Enter') {
      event.preventDefault();
      setCollapsed(true);
      return;
    }
    if (nextWidth === undefined) return;
    event.preventDefault();
    clearAnimation();
    applyState({ ...state, width: nextWidth });
    commitState();
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    runCleanups(
      () => listeners.abort(),
      () => finishDragging(),
      clearAnimation,
      restoreStaticFallback,
    );
  };

  try {
    toggle.addEventListener('click', () => setCollapsed(!state.collapsed), {
      signal: listeners.signal,
    });
    resizer.addEventListener('pointerdown', handlePointerDown, { signal: listeners.signal });
    resizer.addEventListener('pointermove', handlePointerMove, { signal: listeners.signal });
    resizer.addEventListener('pointerup', finishDragging, { signal: listeners.signal });
    resizer.addEventListener('pointercancel', finishDragging, { signal: listeners.signal });
    resizer.addEventListener('lostpointercapture', () => finishDragging(), {
      signal: listeners.signal,
    });
    resizer.addEventListener('keydown', handleKeyDown, { signal: listeners.signal });
    layout.addEventListener(
      'transitionend',
      (event) => {
        if (event.target === layout && event.propertyName === 'grid-template-columns') {
          clearAnimation();
        }
      },
      { signal: listeners.signal },
    );
    media.addEventListener('change', () => applyState(state), { signal: listeners.signal });

    applyState(state);
    layout.setAttribute('data-sidebar-controlled', '');
    enableControls();

    return { destroy };
  } catch (error) {
    rethrowAfterCleanup(error, destroy);
  }
}
