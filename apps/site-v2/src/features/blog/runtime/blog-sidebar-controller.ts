import {
  applyBlogSidebarBootstrap,
  BLOG_SIDEBAR_LIMITS,
  BLOG_SIDEBAR_STORAGE_KEY,
  readBlogSidebarState,
  type BlogSidebarState,
} from './blog-sidebar-state';

const DESKTOP_MEDIA = '(min-width: 64rem)';
const KEYBOARD_STEP = 16;
const COLLAPSE_DURATION_MS = 200;

type DragStart = {
  pointerId: number;
  x: number;
  width: number;
};

export type BlogSidebarController = {
  destroy(): void;
};

function clampWidth(width: number): number {
  return Math.min(BLOG_SIDEBAR_LIMITS.maxWidth, Math.max(BLOG_SIDEBAR_LIMITS.minWidth, width));
}

export function createBlogSidebarController(
  layout: HTMLElement,
  sourceWindow: Window,
): BlogSidebarController | undefined {
  const sidebar = layout.querySelector<HTMLElement>('[data-blog-sidebar-panel]');
  const toggle = layout.querySelector<HTMLButtonElement>('[data-blog-sidebar-toggle]');
  const resizer = layout.querySelector<HTMLElement>('[data-blog-sidebar-resizer]');
  if (!sidebar || !toggle || !resizer) return;

  const media = sourceWindow.matchMedia(DESKTOP_MEDIA);
  const listeners = new AbortController();
  const collapseLabel = toggle.dataset.collapseLabel ?? toggle.getAttribute('aria-label') ?? '';
  const expandLabel = toggle.dataset.expandLabel ?? collapseLabel;
  let state: BlogSidebarState = {
    collapsed: false,
    width: BLOG_SIDEBAR_LIMITS.defaultWidth,
  };
  try {
    state = readBlogSidebarState(sourceWindow.localStorage);
  } catch {
    // The default state remains interactive when Storage itself is unavailable.
  }
  let dragStart: DragStart | undefined;
  let animationTimer: number | undefined;
  let destroyed = false;

  const clearAnimation = () => {
    if (animationTimer !== undefined) sourceWindow.clearTimeout(animationTimer);
    animationTimer = undefined;
    layout.removeAttribute('data-sidebar-animating');
  };

  const applyState = (nextState: BlogSidebarState) => {
    state = { collapsed: nextState.collapsed, width: clampWidth(nextState.width) };
    const effectivelyCollapsed = media.matches && state.collapsed;

    layout.style.setProperty('--blog-sidebar-current-width', `${state.width}px`);
    layout.style.setProperty(
      '--blog-sidebar-current-track',
      effectivelyCollapsed ? '0px' : 'var(--blog-sidebar-current-width)',
    );
    layout.toggleAttribute('data-sidebar-collapsed', effectivelyCollapsed);
    sidebar.inert = effectivelyCollapsed;
    if (effectivelyCollapsed) sidebar.setAttribute('aria-hidden', 'true');
    else sidebar.removeAttribute('aria-hidden');

    toggle.setAttribute('aria-expanded', String(!effectivelyCollapsed));
    toggle.setAttribute('aria-label', effectivelyCollapsed ? expandLabel : collapseLabel);
    toggle.toggleAttribute('data-blog-sidebar-expand', effectivelyCollapsed);
    toggle.toggleAttribute('data-blog-sidebar-collapse', !effectivelyCollapsed);
    resizer.setAttribute('aria-valuenow', String(Math.round(state.width)));
  };

  const commitState = () => {
    applyBlogSidebarBootstrap(sourceWindow.document.documentElement, state);
    try {
      sourceWindow.localStorage.setItem(BLOG_SIDEBAR_STORAGE_KEY, JSON.stringify(state));
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
    applyState({ ...state, width: dragStart.width + event.clientX - dragStart.x });
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    let nextWidth: number | undefined;
    if (event.key === 'ArrowLeft') nextWidth = state.width - KEYBOARD_STEP;
    if (event.key === 'ArrowRight') nextWidth = state.width + KEYBOARD_STEP;
    if (event.key === 'Home') nextWidth = BLOG_SIDEBAR_LIMITS.minWidth;
    if (event.key === 'End') nextWidth = BLOG_SIDEBAR_LIMITS.maxWidth;
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

  const handleBreakpointChange = () => applyState(state);

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
  media.addEventListener('change', handleBreakpointChange, { signal: listeners.signal });

  applyState(state);
  layout.setAttribute('data-sidebar-controlled', '');

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      finishDragging();
      listeners.abort();
      clearAnimation();
      layout.removeAttribute('data-sidebar-dragging');
      layout.removeAttribute('data-sidebar-controlled');
      resizer.removeAttribute('data-dragging');
    },
  };
}
