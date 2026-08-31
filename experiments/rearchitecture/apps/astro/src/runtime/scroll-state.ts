import { mergeSnapshot, readSnapshot, type ScrollSnapshot } from './state-ledger';

export function currentRouteKey() {
  return window.location.pathname + window.location.search;
}

export function captureScrollSnapshot(): ScrollSnapshot {
  const regions = Object.fromEntries(
    Array.from(document.querySelectorAll<HTMLElement>('[data-scroll-region]')).flatMap(
      (element) => {
        const key = element.dataset.scrollRegion;
        return key ? [[key, { x: element.scrollLeft, y: element.scrollTop }] as const] : [];
      },
    ),
  );

  return {
    version: 1,
    routeKey: currentRouteKey(),
    page: { x: window.scrollX, y: window.scrollY },
    regions,
  };
}

export function persistCurrentScroll() {
  try {
    history.replaceState(mergeSnapshot(history.state, captureScrollSnapshot()), '');
    return true;
  } catch {
    return false;
  }
}

/** Applies one validated snapshot without animation or intermediate geometry. */
export function applyScrollSnapshot(snapshot: ScrollSnapshot) {
  const previousScrollBehavior = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = 'auto';
  window.scrollTo(snapshot.page.x, snapshot.page.y);
  document.documentElement.style.scrollBehavior = previousScrollBehavior;
  for (const element of document.querySelectorAll<HTMLElement>('[data-scroll-region]')) {
    const key = element.dataset.scrollRegion;
    const point = key ? snapshot.regions[key] : undefined;
    if (point) {
      element.scrollTo(point.x, point.y);
    }
  }
}

export function restoreCurrentScroll() {
  const snapshot = readSnapshot(history.state, currentRouteKey());
  if (!snapshot) {
    return false;
  }

  applyScrollSnapshot(snapshot);

  return true;
}
