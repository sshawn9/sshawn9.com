import { describe, expect, it } from 'vitest';
import {
  BLOG_DISPLAY_MODES,
  deriveBlogViewState,
  readBlogPageSize,
} from '../../../apps/site/src/features/blog/runtime/blog-state';
import { createBlogCatalog } from '../blog-listing-fixture';

const catalog = createBlogCatalog({
  tags: [
    { name: 'Alpha', slug: 'alpha' },
    { name: 'Beta', slug: 'beta' },
  ],
  articleTags: Array.from({ length: 123 }, (_, index) => [index < 23 ? 'alpha' : 'beta']),
});
const url = (query = '') => new URL(`https://sshawn9.com/en/blog/${query}`);

describe('pagination from route and preference', () => {
  it('keeps an interior page and clamps the last page with accurate article ranges', () => {
    const middle = deriveBlogViewState(catalog, url('?page=3'), 20);
    expect(middle.page).toBe(3);
    expect(middle.rangeStart).toBe(41);
    expect(middle.rangeEnd).toBe(60);
    expect(middle.normalizedUrl.search).toBe('?page=3');

    const last = deriveBlogViewState(catalog, url('?page=3'), 100);
    expect(last.page).toBe(2);
    expect(last.rangeStart).toBe(101);
    expect(last.rangeEnd).toBe(123);
    expect(last.normalizedUrl.search).toBe('?page=2');
    expect(last.previousUrl?.search).toBe('');
    expect(last.nextUrl).toBeUndefined();
  });

  it('filters at page one and preserves unrelated URL parts', () => {
    const state = deriveBlogViewState(catalog, url('?unknown=x&page=3#results'), 20, {
      kind: 'tag',
      slug: 'alpha',
    });
    const target = state.normalizedUrl;
    expect(target.search).toBe('?unknown=x&tag=alpha');
    expect(target.hash).toBe('#results');
    expect(state.resultCount).toBe(23);
    expect(state.nextUrl?.search).toBe('?unknown=x&tag=alpha&page=2');
  });

  it.each([undefined, '', '0', '-1', '8', '10.0', '05', '1e1', 'Infinity', '10x'])(
    'defaults an invalid stored preference %s',
    (value) => {
      expect(readBlogPageSize(value)).toBe(5);
    },
  );

  it.each(['0', '-3', '3.5', '3x', 'Infinity', '9007199254740992', '2&page=3'])(
    'rejects invalid page=%s independently of preference',
    (value) => {
      const state = deriveBlogViewState(catalog, url(`?page=${value}`), 10);
      expect(state.page).toBe(1);
      expect(state.normalizedUrl.search).toBe('');
    },
  );

  it('keeps the preference for zero and single-page results', () => {
    for (const count of [0, 1, 4]) {
      const state = deriveBlogViewState(
        { ...catalog, articleTags: catalog.articleTags.slice(0, count) },
        url('?page=999'),
        50,
      );
      expect(state.page).toBe(1);
      expect(state.pageCount).toBe(count ? 1 : 0);
      expect(state.rangeStart).toBe(count ? 1 : 0);
      expect(state.rangeEnd).toBe(count);
      expect(state.pageSize).toBe(50);
      expect(state.previousUrl).toBeUndefined();
      expect(state.nextUrl).toBeUndefined();
      expect(state.normalizedUrl.search).toBe('');
    }
  });

  it.each([
    ['?page=999', 'previous', 24],
    ['?page=999', 'next', 25],
    ['', 'previous', 1],
  ] as const)(
    'applies %s / %s from the normalized current page',
    (query, direction, expectedPage) => {
      const state = deriveBlogViewState(catalog, url(query), 5, { kind: 'page', direction });
      expect(state.page).toBe(expectedPage);
      expect(state.rangeStart).toBe((expectedPage - 1) * 5 + 1);
    },
  );

  it('toggles a normalized tag at page one while an unknown tag leaves the current selection intact', () => {
    const source = url('?tag=Alpha&tag=beta&page=3');
    const toggled = deriveBlogViewState(catalog, source, 5, { kind: 'tag', slug: 'alpha' });
    expect(toggled.selectedSlugs).toEqual(['beta']);
    expect(toggled.page).toBe(1);
    expect(toggled.visibleIndices).toEqual([23, 24, 25, 26, 27]);
    const unchanged = deriveBlogViewState(catalog, source, 5, { kind: 'tag', slug: 'unknown' });
    expect(unchanged.selectedSlugs).toEqual(['alpha', 'beta']);
    expect(unchanged.page).toBe(3);
  });

  it('covers every article once for each preference and normalizes idempotently', () => {
    for (const size of new Set(
      Object.values(BLOG_DISPLAY_MODES).flatMap((mode) => mode.pageSizes),
    )) {
      let state = deriveBlogViewState(catalog, url('?page=01&tag=Beta&tag=beta&tag=unknown'), size);
      const indices: number[] = [];
      for (;;) {
        expect(deriveBlogViewState(catalog, state.normalizedUrl, size).normalizedUrl.href).toBe(
          state.normalizedUrl.href,
        );
        indices.push(...state.visibleIndices);
        if (!state.nextUrl) break;
        const next = deriveBlogViewState(catalog, state.nextUrl, size);
        expect(next.previousUrl?.href).toBe(state.normalizedUrl.href);
        state = next;
      }
      expect(indices).toEqual(Array.from({ length: 100 }, (_, index) => index + 23));
    }
  });
});
