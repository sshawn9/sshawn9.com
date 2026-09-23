import type { ScrollPoint, ScrollSnapshot } from './state-ledger';

export type ViewNavigationContext = {
  scroll?: ScrollSnapshot;
};

/** One resolved input produces both the committed URL and its matching content. */
export type ViewUpdate = {
  url: URL;
  apply(context: ViewNavigationContext): void;
  afterApply?(): void;
};

/** The mounted document declares which URL changes its existing data can represent. */
export type PageView = {
  resourceUrl: URL;
  queryParameters: readonly string[];
  resolve(url: URL): ViewUpdate;
  // Reconcile saved non-route inputs when a cancelled navigation retains this view.
  refresh?(): void;
};

export type PageController = {
  view?: PageView;
  destroy(): void;
};

export type ViewUpdateOptions = {
  sourceElement?: Element;
  // Resolve after the new view and the original scroll position are restored.
  resolveScroll?: () => ScrollPoint | undefined;
};

export type PageNavigation = {
  // Route actions and local refreshes execute in input order for the mounted view.
  requestViewUpdate(resolve: (current: URL) => ViewUpdate, options?: ViewUpdateOptions): void;
  // Refresh non-route inputs even if the URL is unchanged; only replace history.
  requestViewRefresh(resolve: (current: URL) => ViewUpdate): void;
  // Search input replaces one entry synchronously without a page visit.
  replaceViewUrl(url: URL): void;
};

export function belongsToView(
  view: Pick<PageView, 'resourceUrl' | 'queryParameters'>,
  target: URL,
): boolean {
  const resource = new URL(view.resourceUrl);
  const candidate = new URL(target);
  for (const parameter of view.queryParameters) {
    resource.searchParams.delete(parameter);
    candidate.searchParams.delete(parameter);
  }
  resource.hash = candidate.hash = '';
  return resource.href === candidate.href;
}
