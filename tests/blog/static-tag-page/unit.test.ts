import { describe, expect, it } from 'vitest';
import { deriveBlogViewState } from '../../../apps/site/src/features/blog/runtime/blog-state';
import { createBlogCatalog } from '../blog-listing-fixture';

describe('static tag page state', () => {
  it('ignores tag parameters, drops unknown filters, and clamps invalid pagination', () => {
    const listing = createBlogCatalog({
      filterable: false,
      tags: [{ name: 'Alpha', slug: 'alpha' }],
      articleTags: [['alpha'], ['beta']],
    });
    const state = deriveBlogViewState(
      listing,
      new URL('https://sshawn9.com/en/tags/alpha/?tag=unknown&page=-4'),
      20,
    );
    expect(state.selectedSlugs).toEqual([]);
    expect(state.resultCount).toBe(2);
    expect(state.page).toBe(1);
    expect(state.pageSize).toBe(20);
    expect(state.normalizedUrl.search).toBe('');
  });
});
