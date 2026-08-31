export const ARTICLE_HEADING_SELECTOR = '.article-prose :is(h2[id], h3[id])';
export const ARTICLE_TOC_LINK_SELECTOR = '[data-article-toc] a[data-toc-slug]';

export function readArticleHeadingOffset(heading: HTMLElement, sourceWindow: Window): number {
  const value = Number.parseFloat(sourceWindow.getComputedStyle(heading).scrollMarginTop);
  return Number.isFinite(value) ? value : 0;
}

export function findCurrentArticleHeading(
  sourceDocument: Document,
  sourceWindow: Window,
): HTMLElement | undefined {
  const headings = [...sourceDocument.querySelectorAll<HTMLElement>(ARTICLE_HEADING_SELECTOR)];
  const first = headings[0];
  if (!first) return undefined;

  const threshold = readArticleHeadingOffset(first, sourceWindow) + 1;
  let current = first;
  for (const heading of headings) {
    if (heading.getBoundingClientRect().top > threshold) break;
    current = heading;
  }
  return current;
}

export function setActiveArticleToc(sourceDocument: Document, slug: string): void {
  for (const link of sourceDocument.querySelectorAll<HTMLAnchorElement>(
    ARTICLE_TOC_LINK_SELECTOR,
  )) {
    const active = link.dataset.tocSlug === slug;
    link.toggleAttribute('data-active', active);
    if (active) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}

/** Shared by the parser-time first frame and the normal article controller. */
export function synchronizeArticleToc(
  sourceDocument: Document,
  sourceWindow: Window,
): string | undefined {
  const heading = findCurrentArticleHeading(sourceDocument, sourceWindow);
  if (!heading) return undefined;
  setActiveArticleToc(sourceDocument, heading.id);
  return heading.id;
}

/** Serializes the exact current-section algorithm used by the normal runtime. */
export function createArticleTocInitialFrameSource(): string {
  return [
    `const ARTICLE_HEADING_SELECTOR = ${JSON.stringify(ARTICLE_HEADING_SELECTOR)};`,
    `const ARTICLE_TOC_LINK_SELECTOR = ${JSON.stringify(ARTICLE_TOC_LINK_SELECTOR)};`,
    readArticleHeadingOffset.toString(),
    findCurrentArticleHeading.toString(),
    setActiveArticleToc.toString(),
    synchronizeArticleToc.toString(),
  ].join('\n');
}
