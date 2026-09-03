export const BLOG_SIDEBAR_STORAGE_KEY = 'blog-sidebar-layout';

export const BLOG_SIDEBAR_LIMITS = {
  defaultWidth: 272,
  minWidth: 208,
  maxWidth: 400,
} as const;

export type BlogSidebarState = {
  collapsed: boolean;
  width: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function decodeBlogSidebarState(value: unknown): BlogSidebarState {
  const width = isRecord(value) && typeof value.width === 'number' ? value.width : NaN;
  return {
    collapsed: isRecord(value) && typeof value.collapsed === 'boolean' ? value.collapsed : false,
    width: Number.isFinite(width)
      ? Math.min(BLOG_SIDEBAR_LIMITS.maxWidth, Math.max(BLOG_SIDEBAR_LIMITS.minWidth, width))
      : BLOG_SIDEBAR_LIMITS.defaultWidth,
  };
}

export function readBlogSidebarState(storage: Pick<Storage, 'getItem'>): BlogSidebarState {
  try {
    return decodeBlogSidebarState(JSON.parse(storage.getItem(BLOG_SIDEBAR_STORAGE_KEY) ?? 'null'));
  } catch {
    return decodeBlogSidebarState(null);
  }
}

export function applyBlogSidebarBootstrap(root: HTMLElement, state: BlogSidebarState): void {
  root.toggleAttribute('data-blog-sidebar-collapsed', state.collapsed);
  root.style.setProperty('--blog-sidebar-boot-width', `${state.width}px`);
  root.style.setProperty('--blog-sidebar-boot-track', state.collapsed ? '0px' : `${state.width}px`);
}

export function prepareTargetBlogSidebarState(
  targetDocument: Document,
  sourceWindow: Window,
): void {
  if (!targetDocument.querySelector('[data-blog-sidebar-layout]')) return;
  let state = decodeBlogSidebarState(null);
  try {
    state = readBlogSidebarState(sourceWindow.localStorage);
  } catch {
    // Sandboxed documents can reject access to the Storage object itself.
  }
  applyBlogSidebarBootstrap(targetDocument.documentElement, state);
}
