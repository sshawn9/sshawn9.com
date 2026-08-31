import {
  decodeScrollSnapshot,
  mergeScrollSnapshot,
  SITE_HISTORY_VERSION,
  type ScrollSnapshot,
} from './state-ledger';

type RouteLocation = Pick<Location, 'pathname' | 'search'>;

export function routeKey(location: RouteLocation): string {
  return location.pathname + location.search;
}

export function captureScrollSnapshot(
  sourceDocument: Document,
  sourceWindow: Window,
): ScrollSnapshot {
  const regions: ScrollSnapshot['regions'] = {};
  for (const element of sourceDocument.querySelectorAll<HTMLElement>('[data-scroll-region]')) {
    const key = element.dataset.scrollRegion;
    if (key) regions[key] = { x: element.scrollLeft, y: element.scrollTop };
  }

  return {
    version: SITE_HISTORY_VERSION,
    routeKey: routeKey(sourceWindow.location),
    page: { x: sourceWindow.scrollX, y: sourceWindow.scrollY },
    regions,
  };
}

export function persistCurrentScroll(sourceDocument: Document, sourceWindow: Window): boolean {
  try {
    const snapshot = captureScrollSnapshot(sourceDocument, sourceWindow);
    sourceWindow.history.replaceState(
      mergeScrollSnapshot(sourceWindow.history.state, snapshot),
      '',
    );
    return true;
  } catch {
    return false;
  }
}

export function readCurrentScroll(
  sourceWindow: Window,
  location: RouteLocation = sourceWindow.location,
): ScrollSnapshot | undefined {
  return decodeScrollSnapshot(sourceWindow.history.state, routeKey(location));
}

export function restoreNestedScroll(sourceDocument: Document, snapshot: ScrollSnapshot): void {
  for (const element of sourceDocument.querySelectorAll<HTMLElement>('[data-scroll-region]')) {
    const key = element.dataset.scrollRegion;
    const point = key ? snapshot.regions[key] : undefined;
    if (point) element.scrollTo(point.x, point.y);
  }
}

export function restorePageScroll(
  _sourceDocument: Document,
  sourceWindow: Window,
  point: { x: number; y: number },
): void {
  // State restoration is placement, not user-initiated navigation. An explicit
  // instant behavior prevents the root `scroll-behavior: smooth` rule from
  // turning refresh and history restoration into a visible scroll animation.
  sourceWindow.scrollTo({ left: point.x, top: point.y, behavior: 'instant' });
}

/** Used by the initial-frame coordinator; normal ClientRouter traversal owns page scroll. */
export function restorePageAndNestedScroll(
  sourceDocument: Document,
  sourceWindow: Window,
  snapshot: ScrollSnapshot,
): void {
  restorePageScroll(sourceDocument, sourceWindow, snapshot.page);
  restoreNestedScroll(sourceDocument, snapshot);
}

/** Serializes the normal runtime's restoration functions for first paint. */
export function createScrollRestorationSource(): string {
  return [
    restoreNestedScroll.toString(),
    restorePageScroll.toString(),
    restorePageAndNestedScroll.toString(),
  ].join('\n');
}
