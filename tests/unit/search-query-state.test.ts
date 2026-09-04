import { describe, expect, it } from 'vitest';
import {
  createSearchQueryUrl,
  readSearchQuery,
} from '../../apps/site/src/features/search/runtime/search-query-state';

describe('search query state', () => {
  it('normalizes the query without dropping unrelated URL state', () => {
    const url = createSearchQueryUrl(
      new URL('https://sshawn9.com/en/search/?source=header#results'),
      '  git identity  ',
    );

    expect(url.pathname).toBe('/en/search/');
    expect(url.searchParams.get('q')).toBe('git identity');
    expect(url.searchParams.get('source')).toBe('header');
    expect(url.hash).toBe('#results');
    expect(readSearchQuery(url)).toBe('git identity');
  });

  it('removes only the query parameter when the query is empty', () => {
    const url = createSearchQueryUrl(
      new URL('https://sshawn9.com/zh/search/?q=git&source=header'),
      '   ',
    );

    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.get('source')).toBe('header');
  });
});
