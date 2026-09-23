import { describe, expect, it } from 'vitest';
import {
  BLOG_PAGE_SIZES,
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
  it.each(BLOG_PAGE_SIZES)('retains page three with a preference of %i', (pageSize) => {
    const state = deriveBlogViewState(catalog, url('?page=3'), pageSize);
    expect(state.page).toBe(3);
    expect(state.pageSize).toBe(pageSize);
    expect(state.rangeStart).toBe(2 * pageSize + 1);
    expect(state.rangeEnd).toBe(Math.min(3 * pageSize, 123));
    expect(state.normalizedUrl.search).toBe('?page=3');
  });

  it('starts later operations at the clamped page without resurrecting the old page number', () => {
    const small = { ...catalog, articleTags: catalog.articleTags.slice(0, 60) };
    const large = deriveBlogViewState(small, url('?page=3'), 50);
    expect(large.normalizedUrl.search).toBe('?page=2');
    const smaller = deriveBlogViewState(small, large.normalizedUrl, 5);
    expect(smaller.page).toBe(2);
    expect(
      deriveBlogViewState(small, smaller.normalizedUrl, 5, { kind: 'page', direction: 'next' })
        .normalizedUrl.search,
    ).toBe('?page=3');
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

  it.each(['', '5', '10', '50', '0', '8', '05', '10&pageSize=20'])(
    'ignores and removes the retired pageSize=%s parameter',
    (value) => {
      const state = deriveBlogViewState(catalog, url(`?page=3&pageSize=${value}`), 20);
      expect(state.pageSize).toBe(20);
      expect(state.normalizedUrl.search).toBe('?page=3');
    },
  );

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
    for (const size of BLOG_PAGE_SIZES) {
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
