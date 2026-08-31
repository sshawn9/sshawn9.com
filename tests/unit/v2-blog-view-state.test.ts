import { describe, expect, it } from 'vitest';
import {
  createBlogViewPrepaintScript,
  deriveBlogViewState,
} from '../../apps/site-v2/src/features/blog/runtime/blog-view-state';

type FakeElement = {
  dataset: Record<string, string>;
};

function createListing(options: {
  filterable?: boolean;
  tags: Array<{ name: string; slug: string }>;
  articleTags: string[][];
}): HTMLElement {
  const tags = options.tags.map(({ name, slug }) => ({
    dataset: { tagName: name, tagSlug: slug },
  }));
  const articles = options.articleTags.map((tagSlugs) => ({
    dataset: { articleTagSlugs: JSON.stringify(tagSlugs) },
  }));
  return {
    dataset: { blogFilterable: String(options.filterable !== false) },
    querySelectorAll(selector: string): FakeElement[] {
      if (selector === '[data-blog-tag-definition]') return tags;
      if (selector === '[data-blog-article]') return articles;
      return [];
    },
  } as unknown as HTMLElement;
}

describe('v2 blog view state', () => {
  it('uses ordered union filtering and clamps pagination into one normalized URL', () => {
    const listing = createListing({
      tags: [
        { name: 'Alpha', slug: 'alpha' },
        { name: 'Beta', slug: 'beta' },
      ],
      articleTags: [
        ...Array.from({ length: 6 }, () => ['alpha']),
        ...Array.from({ length: 4 }, () => ['beta']),
        ['alpha', 'beta'],
        ['other'],
      ],
    });

    const state = deriveBlogViewState(
      listing,
      new URL('https://sshawn9.com/en/blog/?tag=beta&tag=Alpha&page=99'),
    );

    expect(state.selectedSlugs).toEqual(['alpha', 'beta']);
    expect(state.resultCount).toBe(11);
    expect(state.pageCount).toBe(2);
    expect(state.page).toBe(2);
    expect(state.normalizedUrl.search).toBe('?tag=alpha&tag=beta&page=2');
  });

  it('drops unknown filters and ignores tag parameters on a static tag page', () => {
    const listing = createListing({
      filterable: false,
      tags: [{ name: 'Alpha', slug: 'alpha' }],
      articleTags: [['alpha'], ['beta']],
    });

    const state = deriveBlogViewState(
      listing,
      new URL('https://sshawn9.com/en/tags/alpha/?tag=unknown&page=-4'),
    );

    expect(state.selectedSlugs).toEqual([]);
    expect(state.resultCount).toBe(2);
    expect(state.page).toBe(1);
    expect(state.normalizedUrl.search).toBe('');
  });

  it('emits a self-contained parser script', () => {
    expect(() => new Function(createBlogViewPrepaintScript())).not.toThrow();
  });
});
