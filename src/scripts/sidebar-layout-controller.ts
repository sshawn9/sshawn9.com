import {
  ARTICLE_SIDEBAR_LAYOUT,
  BLOG_SIDEBAR_LAYOUT,
  SITE_STORAGE_KEYS,
  getSiteBootstrapState,
  type StoredSidebarLayout,
} from '../lib/site-preferences';

type SidebarKind = 'blog' | 'article';

type SidebarDefinition = {
  side: 'left' | 'right';
  limits: {
    defaultWidth: number;
    minWidth: number;
    maxWidth: number;
  };
  storageKey: string;
  collapsibleMedia?: string;
};

type DragStart = {
  pointerId: number;
  x: number;
  width: number;
};

export type SidebarLayoutController = {
  destroy: () => void;
};

const KEYBOARD_STEP = 16;
const COLLAPSE_DURATION = 200;

const SIDEBAR_DEFINITIONS: Record<SidebarKind, SidebarDefinition> = {
  blog: {
    side: 'left',
    limits: BLOG_SIDEBAR_LAYOUT,
    storageKey: SITE_STORAGE_KEYS.blogSidebarLayout,
    collapsibleMedia: '(min-width: 64rem)',
  },
  article: {
    side: 'right',
    limits: ARTICLE_SIDEBAR_LAYOUT,
    storageKey: SITE_STORAGE_KEYS.articleSidebarLayout,
  },
};

function readBootstrapLayout(kind: SidebarKind) {
  const bootstrap = getSiteBootstrapState();
  return kind === 'blog' ? bootstrap?.blogSidebarLayout : bootstrap?.articleSidebarLayout;
}

function writeBootstrapLayout(kind: SidebarKind, state: StoredSidebarLayout) {
  const bootstrap = getSiteBootstrapState();
  if (!bootstrap) return;

  if (kind === 'blog') bootstrap.blogSidebarLayout = { ...state };
  else bootstrap.articleSidebarLayout = { ...state };
}

export function createSidebarLayoutController(
  kind: SidebarKind,
  layout: HTMLElement,
): SidebarLayoutController | undefined {
  const sidebar = layout.querySelector<HTMLElement>('[data-sidebar-panel]');
  const toggle = layout.querySelector<HTMLButtonElement>('[data-sidebar-toggle]');
  const resizer = layout.querySelector<HTMLElement>('[data-sidebar-resizer]');
  if (!sidebar || !toggle || !resizer) return;

  const definition = SIDEBAR_DEFINITIONS[kind];
  const namespace = `${kind}-sidebar`;
  const root = document.documentElement;
  const collapsedAttribute = `data-${namespace}-collapsed`;
  const currentWidthProperty = `--${namespace}-current-width`;
  const currentTrackProperty = `--${namespace}-current-track`;
  const bootWidthProperty = `--${namespace}-boot-width`;
  const bootTrackProperty = `--${namespace}-boot-track`;
  const collapseLabel = toggle.dataset.collapseLabel ?? toggle.getAttribute('aria-label') ?? '';
  const expandLabel = toggle.dataset.expandLabel ?? collapseLabel;
  const media = definition.collapsibleMedia
    ? window.matchMedia(definition.collapsibleMedia)
    : undefined;
  const bootstrapLayout = readBootstrapLayout(kind);
  const clampWidth = (width: number) =>
    Math.min(definition.limits.maxWidth, Math.max(definition.limits.minWidth, width));
  const restoredState: StoredSidebarLayout = {
    collapsed: bootstrapLayout?.collapsed ?? false,
    width: clampWidth(bootstrapLayout?.width ?? definition.limits.defaultWidth),
  };

  let state: StoredSidebarLayout = {
    ...restoredState,
    collapsed: media ? media.matches && restoredState.collapsed : restoredState.collapsed,
  };
  let animationTimer: number | undefined;
  let dragStart: DragStart | undefined;
  let destroyed = false;
  const listeners = new AbortController();

  const applyState = (nextState: StoredSidebarLayout) => {
    state = {
      collapsed: nextState.collapsed,
      width: clampWidth(nextState.width),
    };

    layout.style.setProperty(currentWidthProperty, `${state.width}px`);
    layout.style.setProperty(
      currentTrackProperty,
      state.collapsed ? '0px' : `var(${currentWidthProperty})`,
    );
    layout.toggleAttribute('data-sidebar-collapsed', state.collapsed);

    if (state.collapsed) sidebar.setAttribute('aria-hidden', 'true');
    else sidebar.removeAttribute('aria-hidden');
    sidebar.inert = state.collapsed;

    toggle.toggleAttribute(`data-${namespace}-collapse`, !state.collapsed);
    toggle.toggleAttribute(`data-${namespace}-expand`, state.collapsed);
    toggle.setAttribute('aria-expanded', String(!state.collapsed));
    toggle.setAttribute('aria-label', state.collapsed ? expandLabel : collapseLabel);
    resizer.setAttribute('aria-valuenow', String(Math.round(state.width)));
  };

  const commitSnapshot = () => {
    const snapshot = { ...state };
    root.toggleAttribute(collapsedAttribute, snapshot.collapsed);
    root.style.setProperty(bootWidthProperty, `${snapshot.width}px`);
    root.style.setProperty(bootTrackProperty, snapshot.collapsed ? '0px' : `${snapshot.width}px`);
    writeBootstrapLayout(kind, snapshot);

    try {
      localStorage.setItem(definition.storageKey, JSON.stringify(snapshot));
    } catch {
      // The in-memory and first-frame snapshots remain consistent when storage is unavailable.
    }
  };

  const clearAnimation = () => {
    if (animationTimer !== undefined) clearTimeout(animationTimer);
    animationTimer = undefined;
    layout.removeAttribute('data-sidebar-animating');
  };

  const setCollapsed = (nextCollapsed: boolean) => {
    if (nextCollapsed === state.collapsed) return;

    clearAnimation();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduceMotion) {
      layout.setAttribute('data-sidebar-animating', '');
      void layout.offsetWidth;
    }

    applyState({ collapsed: nextCollapsed, width: state.width });
    commitSnapshot();
    toggle.focus({ preventScroll: true });

    if (!reduceMotion) {
      animationTimer = window.setTimeout(clearAnimation, COLLAPSE_DURATION + 80);
    }
  };

  const finishDragging = (event?: PointerEvent) => {
    if (!dragStart) return;

    const pointerId = dragStart.pointerId;
    dragStart = undefined;
    layout.removeAttribute('data-sidebar-dragging');
    resizer.removeAttribute('data-dragging');
    if (event && resizer.hasPointerCapture(pointerId)) resizer.releasePointerCapture(pointerId);
    commitSnapshot();
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || state.collapsed) return;

    clearAnimation();
    dragStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      width: state.width,
    };
    resizer.setPointerCapture(event.pointerId);
    layout.setAttribute('data-sidebar-dragging', '');
    resizer.setAttribute('data-dragging', '');
    event.preventDefault();
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;

    const direction = definition.side === 'left' ? 1 : -1;
    const width = dragStart.width + direction * (event.clientX - dragStart.x);
    applyState({ ...state, width });
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const direction = definition.side === 'left' ? 1 : -1;
    let nextWidth: number | undefined;

    if (event.key === 'ArrowLeft') nextWidth = state.width - KEYBOARD_STEP * direction;
    if (event.key === 'ArrowRight') nextWidth = state.width + KEYBOARD_STEP * direction;
    if (event.key === 'Home') nextWidth = definition.limits.minWidth;
    if (event.key === 'End') nextWidth = definition.limits.maxWidth;
    if (event.key === 'Enter') {
      event.preventDefault();
      setCollapsed(true);
      return;
    }

    if (nextWidth === undefined) return;
    event.preventDefault();
    clearAnimation();
    applyState({ ...state, width: nextWidth });
    commitSnapshot();
  };

  const handleBreakpointChange = () => {
    if (!media?.matches && state.collapsed) {
      clearAnimation();
      if (document.activeElement === toggle) toggle.blur();
      // The mobile presentation is always open without overwriting the saved desktop preference.
      applyState({ collapsed: false, width: state.width });
    }
  };

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
  media?.addEventListener('change', handleBreakpointChange, { signal: listeners.signal });

  applyState(state);
  layout.setAttribute('data-sidebar-controlled', '');

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;

      if (dragStart) {
        const pointerId = dragStart.pointerId;
        dragStart = undefined;
        if (resizer.hasPointerCapture(pointerId)) resizer.releasePointerCapture(pointerId);
        commitSnapshot();
      }
      listeners.abort();
      clearAnimation();
      layout.removeAttribute('data-sidebar-dragging');
      resizer.removeAttribute('data-dragging');
    },
  };
}
