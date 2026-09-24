import { readCurrentScroll } from '../../../runtime/scroll-state';

const ARTICLE_HEADING_SELECTOR = '.article-prose :is(h2[id], h3[id])';
export const ARTICLE_TOC_LINK_SELECTOR = '[data-article-toc] a[data-toc-slug]';

function findArticleHeading(sourceDocument: Document, slug: string): HTMLElement | undefined {
  const heading = sourceDocument.getElementById(slug);
  return heading?.matches(ARTICLE_HEADING_SELECTOR) ? heading : undefined;
}

export function readArticleFragmentTarget(
  sourceDocument: Document,
  href: string,
): HTMLElement | undefined {
  try {
    const slug = decodeURIComponent(new URL(href).hash.slice(1));
    return slug ? findArticleHeading(sourceDocument, slug) : undefined;
  } catch {
    return undefined;
  }
}

function readArticleReadingViewport(sourceDocument: Document, sourceWindow: Window) {
  const visual = sourceWindow.visualViewport;
  const top = visual?.offsetTop ?? 0;
  const bottom = top + (visual?.height ?? sourceWindow.innerHeight);
  const header = sourceDocument.querySelector<HTMLElement>('.site-header');
  return {
    top: Math.min(bottom, Math.max(top, header?.getBoundingClientRect().bottom ?? top)),
    bottom,
  };
}

/** First visible heading; without one, the visible prose belongs to the preceding heading. */
export function findReadingArticleHeading(
  sourceDocument: Document,
  sourceWindow: Window,
): HTMLElement | undefined {
  const headings = [...sourceDocument.querySelectorAll<HTMLElement>(ARTICLE_HEADING_SELECTOR)];
  if (!headings.length) return undefined;
  const viewport = readArticleReadingViewport(sourceDocument, sourceWindow);
  const prose = sourceDocument.querySelector('.article-prose')!.getBoundingClientRect();
  if (prose.bottom <= viewport.top || prose.top >= viewport.bottom) return undefined;

  let preceding: HTMLElement | undefined;
  for (const heading of headings) {
    const box = heading.getBoundingClientRect();
    if (box.height === 0) continue;
    if (box.top >= viewport.bottom) break;
    if (box.bottom > viewport.top) return heading;
    preceding = heading;
  }
  return preceding;
}

/** Restore explicit navigation or automatic reading without inferring intent from coordinates. */
export function readInitialArticleTarget(
  sourceDocument: Document,
  sourceWindow: Window,
): HTMLElement | undefined {
  if (!sourceDocument.querySelectorAll(ARTICLE_HEADING_SELECTOR).length) return undefined;
  const saved = readCurrentScroll(sourceWindow);
  if (saved) {
    return typeof saved.articleTocTarget === 'string'
      ? findArticleHeading(sourceDocument, saved.articleTocTarget)
      : undefined;
  }
  return readArticleFragmentTarget(sourceDocument, sourceWindow.location.href);
}

/** The scroll-history owner captures this state together with the document position. */
export function reflectArticleTocTarget(
  sourceDocument: Document,
  target: HTMLElement | undefined,
): void {
  const article = sourceDocument.querySelector<HTMLElement>('[data-article-page]');
  const value = target?.id ?? '';
  if (article && article.dataset.articleTocTarget !== value)
    article.dataset.articleTocTarget = value;
}

export function setActiveArticleToc(sourceDocument: Document, slug: string | undefined): void {
  for (const link of sourceDocument.querySelectorAll<HTMLAnchorElement>(
    ARTICLE_TOC_LINK_SELECTOR,
  )) {
    const active = link.dataset.tocSlug === slug;
    if (link.hasAttribute('data-active') !== active) link.toggleAttribute('data-active', active);
    if (active && link.getAttribute('aria-current') !== 'location')
      link.setAttribute('aria-current', 'location');
    else if (!active && link.hasAttribute('aria-current')) link.removeAttribute('aria-current');
  }
}

/** Initial placement only. The mounted controller owns subsequent navigation and reading. */
export function synchronizeArticleToc(
  sourceDocument: Document,
  sourceWindow: Window,
): string | undefined {
  const target = readInitialArticleTarget(sourceDocument, sourceWindow);
  reflectArticleTocTarget(sourceDocument, target);
  const heading = target ?? findReadingArticleHeading(sourceDocument, sourceWindow);
  setActiveArticleToc(sourceDocument, heading?.id);
  return heading?.id;
}
