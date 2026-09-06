import { describe, expect, it } from 'vitest';
import { resolveArticles, type ResolvableArticleEntry } from '@sshawn9/site-domain/articles';

function entry(id: string, publishedAt: string): ResolvableArticleEntry {
  return { id, data: { publishedAt: new Date(publishedAt), tags: [], projects: [], draft: false } };
}

describe('article publication order', () => {
  it('sorts articles by their first publication date', () => {
    const articles = resolveArticles(
      [entry('older/index', '2024-01-01T00:00:00Z'), entry('newer/index', '2025-01-01T00:00:00Z')],
      'en',
    );
    expect(articles.map(({ id }) => id)).toEqual(['newer', 'older']);
  });
});
