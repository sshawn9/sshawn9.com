import { rethrowAfterCleanup } from '../../../runtime/cleanup';
import type { ScrollPoint } from '../../../runtime/state-ledger';

const RESERVE = '--blog-pagination-reserve';
const GAP = 16;
const SIDE_INSET = 32;

type Viewport = { left: number; top: number; right: number; bottom: number; width: number };

function viewport(sourceWindow: Window, layoutRight = sourceWindow.innerWidth): Viewport {
  const visual = sourceWindow.visualViewport;
  const left = visual?.offsetLeft ?? 0;
  const top = visual?.offsetTop ?? 0;
  const right = Math.min(left + (visual?.width ?? sourceWindow.innerWidth), layoutRight);
  return {
    left,
    top,
    right,
    bottom: top + (visual?.height ?? sourceWindow.innerHeight),
    width: right - left,
  };
}

function readingTop(sourceDocument: Document, visible: Viewport): number {
  const header = sourceDocument.querySelector('.site-header')?.getBoundingClientRect();
  return Math.max(visible.top, header?.bottom ?? visible.top) + GAP;
}

function setLength(element: HTMLElement, property: string, value: number): void {
  const text = `${Math.round(value * 100) / 100}px`;
  if (element.style.getPropertyValue(property) !== text) element.style.setProperty(property, text);
}

function placePagination(
  listing: HTMLElement,
  pagination: HTMLElement,
  sourceWindow: Window,
): void {
  const sourceDocument = listing.ownerDocument;
  if (pagination.hidden) {
    sourceDocument.documentElement.style.removeProperty(RESERVE);
    return;
  }
  // Measure the vertical form independently of the current placement. This
  // also reads the native fixed-position edge, which honors the reserved root
  // scrollbar gutter even when no scrollbar is visible or the document is wider.
  pagination.setAttribute('data-measure-side', '');
  let side: DOMRect;
  try {
    side = pagination.getBoundingClientRect();
  } finally {
    pagination.removeAttribute('data-measure-side');
  }
  const visible = viewport(sourceWindow, side.right);
  if (visible.width <= 0 || visible.bottom <= visible.top) return;
  setLength(pagination, '--blog-pagination-viewport-width', visible.width);
  pagination.toggleAttribute('data-visual-zoom', (sourceWindow.visualViewport?.scale ?? 1) > 1);
  const styles = sourceWindow.getComputedStyle(pagination);
  const safeBottom =
    Number.parseFloat(styles.getPropertyValue('--blog-pagination-safe-bottom')) || 0;
  const safeRight = Number.parseFloat(styles.getPropertyValue('--blog-pagination-safe-right')) || 0;
  const contentRight = listing.getBoundingClientRect().right;
  const top = readingTop(sourceDocument, visible);
  const bottom = visible.bottom - GAP - safeBottom;
  const fitsSide =
    contentRight >= visible.left &&
    contentRight + GAP + side.width <= visible.right - SIDE_INSET - safeRight &&
    side.height <= bottom - top;
  const placement = fitsSide ? 'side' : 'bottom';
  if (pagination.dataset.placement !== placement) pagination.dataset.placement = placement;
  const box = pagination.getBoundingClientRect();
  const x = fitsSide
    ? visible.right - SIDE_INSET - safeRight - box.width
    : visible.left + (visible.width - box.width) / 2;
  const credit = sourceDocument.querySelector('[data-wallpaper-credit]')?.getBoundingClientRect();
  const controlBottom =
    !fitsSide &&
    credit &&
    credit.height > 0 &&
    credit.right > x &&
    credit.left < x + box.width &&
    credit.top > visible.top &&
    credit.top < bottom
      ? credit.top - GAP
      : bottom;
  const y = fitsSide
    ? top + (bottom - top - box.height) / 2
    : Math.max(visible.top + GAP, controlBottom - box.height);

  setLength(pagination, 'left', x);
  setLength(pagination, 'top', y);
  setLength(pagination, '--blog-pagination-bottom-gap', visible.bottom - y - box.height);
  pagination.setAttribute('data-positioned', '');
  setLength(sourceDocument.documentElement, RESERVE, fitsSide ? 0 : visible.bottom - y + GAP);
}

/** Initial and swapped documents need their final height before restoring scroll. */
export function prepareBlogPaginationLayout(sourceDocument: Document, sourceWindow: Window): void {
  const listing = sourceDocument.querySelector<HTMLElement>('[data-blog-listing]');
  const pagination = listing?.querySelector<HTMLElement>('[data-blog-pagination]');
  if (listing && pagination) placePagination(listing, pagination, sourceWindow);
}

/** Geometry only: an already visible heading must not be aligned again. */
export function revealBlogHeading(
  headingTop: number,
  readableTop: number,
  readableBottom: number,
  scrollY: number,
): number | undefined {
  if (readableBottom <= readableTop) return undefined;
  if (headingTop >= readableTop - 1 && headingTop < readableBottom - 1) return undefined;
  return Math.max(0, scrollY + headingTop - readableTop);
}

export function createBlogPaginationLayout(
  listing: HTMLElement,
  sourceWindow: Window,
): { update(): void; resolveScroll(): ScrollPoint | undefined; destroy(): void } | undefined {
  const pagination = listing.querySelector<HTMLElement>('[data-blog-pagination]');
  if (!pagination) return undefined;
  const sourceDocument = listing.ownerDocument;
  const listeners = new AbortController();
  let frame = 0;
  let disposed = false;
  let observer: ResizeObserver | undefined;

  const update = (): void => {
    if (!disposed && listing.isConnected) placePagination(listing, pagination, sourceWindow);
  };
  const schedule = (): void => {
    if (disposed || frame) return;
    frame = sourceWindow.requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  };
  const destroy = (): void => {
    if (disposed) return;
    disposed = true;
    listeners.abort();
    observer?.disconnect();
    if (frame) sourceWindow.cancelAnimationFrame(frame);
    sourceDocument.documentElement.style.removeProperty(RESERVE);
    pagination.removeAttribute('data-placement');
    pagination.removeAttribute('data-positioned');
    pagination.removeAttribute('data-visual-zoom');
    for (const property of [
      'left',
      'top',
      '--blog-pagination-viewport-width',
      '--blog-pagination-bottom-gap',
    ]) {
      pagination.style.removeProperty(property);
    }
  };

  try {
    const Resize = (sourceWindow as Window & typeof globalThis).ResizeObserver;
    if (Resize) {
      observer = new Resize(schedule);
      observer.observe(listing);
      observer.observe(pagination);
      const header = sourceDocument.querySelector('.site-header');
      if (header) observer.observe(header);
      const credit = sourceDocument.querySelector('[data-wallpaper-credit]');
      if (credit) observer.observe(credit);
    }
    sourceWindow.addEventListener('resize', schedule, { signal: listeners.signal });
    sourceWindow.visualViewport?.addEventListener('resize', schedule, { signal: listeners.signal });
    sourceWindow.visualViewport?.addEventListener('scroll', schedule, { signal: listeners.signal });
    return {
      update,
      resolveScroll() {
        if (disposed || !listing.isConnected) return undefined;
        update();
        const heading = listing.querySelector<HTMLElement>('[data-blog-article]:not([hidden]) h2');
        if (!heading) return undefined;
        const visible = viewport(sourceWindow);
        const bottom =
          !pagination.hidden && pagination.dataset.placement === 'bottom'
            ? pagination.getBoundingClientRect().top - GAP
            : visible.bottom - GAP;
        const y = revealBlogHeading(
          heading.getBoundingClientRect().top,
          readingTop(sourceDocument, visible),
          bottom,
          sourceWindow.scrollY,
        );
        return y === undefined ? undefined : { x: sourceWindow.scrollX, y };
      },
      destroy,
    };
  } catch (error) {
    rethrowAfterCleanup(error, destroy);
  }
}
