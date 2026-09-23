import { describe, expect, it } from 'vitest';
import { deriveBlogViewState } from '../../../apps/site/src/features/blog/runtime/blog-state';
import { createBlogCatalog } from '../blog-listing-fixture';

describe('blog filter state', () => {
  it('keeps filtering, pagination, and the normalized URL consistent', () => {
    const listing = createBlogCatalog({
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
      5,
    );
    expect(state.selectedSlugs).toEqual(['alpha', 'beta']);
    expect(state.resultCount).toBe(11);
    expect(state.pageCount).toBe(3);
    expect(state.page).toBe(3);
    expect(state.normalizedUrl.search).toBe('?tag=alpha&tag=beta&page=3');
  });
});
