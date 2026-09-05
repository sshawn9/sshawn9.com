import type { ScrollSnapshot } from './state-ledger';

export type ViewNavigationContext = {
  scroll?: ScrollSnapshot;
};

/** The mounted document declares which URL changes its existing data can represent. */
export type PageView = {
  resourceUrl: URL;
  queryParameters: readonly string[];
  normalize(url: URL): URL;
  apply(url: URL, context: ViewNavigationContext): void;
};

export type PageController = {
  view?: PageView;
  destroy(): void;
};

export type ViewUpdateOptions = {
  sourceElement?: Element;
  scrollTarget?: HTMLElement;
};

export type PageNavigation = {
  // Reducers compose against the latest requested URL, even before it is committed.
  requestViewUpdate(update: (current: URL) => URL, options?: ViewUpdateOptions): void;
  // Search input and initial canonicalization replace one entry without a page visit.
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
