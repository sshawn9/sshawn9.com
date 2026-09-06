import { describe, expect, it } from 'vitest';
import { deriveBlogViewState } from '../../../apps/site/src/features/blog/runtime/blog-view-state';
import { createBlogListing } from '../blog-listing-fixture';

describe('static tag page state', () => {
  it('ignores tag parameters, drops unknown filters, and clamps invalid pagination', () => {
    const listing = createBlogListing({
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
});
