import { describe, expect, it } from 'vitest';
import { deriveBlogViewState } from '../../../apps/site/src/features/blog/runtime/blog-view-state';
import { createBlogListing } from '../blog-listing-fixture';

describe('blog filter state', () => {
  it('keeps filtering, pagination, and the normalized URL consistent', () => {
    const listing = createBlogListing({
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
});
