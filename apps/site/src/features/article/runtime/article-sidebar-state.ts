export const ARTICLE_SIDEBAR_STORAGE_KEY = 'article-sidebar-layout';

export const ARTICLE_SIDEBAR_LIMITS = {
  defaultWidth: 224,
  minWidth: 208,
  maxWidth: 352,
} as const;

export type ArticleSidebarState = {
  collapsed: boolean;
  width: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function decodeArticleSidebarState(value: unknown): ArticleSidebarState {
  const width = isRecord(value) && typeof value.width === 'number' ? value.width : NaN;
  return {
    collapsed: isRecord(value) && typeof value.collapsed === 'boolean' ? value.collapsed : false,
    width: Number.isFinite(width)
      ? Math.min(ARTICLE_SIDEBAR_LIMITS.maxWidth, Math.max(ARTICLE_SIDEBAR_LIMITS.minWidth, width))
      : ARTICLE_SIDEBAR_LIMITS.defaultWidth,
  };
}

export function readArticleSidebarState(storage: Pick<Storage, 'getItem'>): ArticleSidebarState {
  try {
    return decodeArticleSidebarState(
      JSON.parse(storage.getItem(ARTICLE_SIDEBAR_STORAGE_KEY) ?? 'null'),
    );
  } catch {
    return decodeArticleSidebarState(null);
  }
}

export function applyArticleSidebarBootstrap(root: HTMLElement, state: ArticleSidebarState): void {
  root.toggleAttribute('data-article-sidebar-collapsed', state.collapsed);
  root.style.setProperty('--article-sidebar-boot-width', `${state.width}px`);
  root.style.setProperty(
    '--article-sidebar-boot-track',
    state.collapsed ? '0px' : `${state.width}px`,
  );
}

export function prepareTargetArticleSidebarState(
  targetDocument: Document,
  sourceWindow: Window,
): void {
  if (!targetDocument.querySelector('[data-article-page]')) return;
  let state = decodeArticleSidebarState(null);
  try {
    state = readArticleSidebarState(sourceWindow.localStorage);
  } catch {
    // Sandboxed documents can reject access to the Storage object itself.
  }
  applyArticleSidebarBootstrap(targetDocument.documentElement, state);
}
