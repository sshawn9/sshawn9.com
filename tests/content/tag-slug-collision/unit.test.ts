import { describe, expect, it } from 'vitest';
import { resolveArticles, type ResolvableArticleEntry } from '@sshawn9/site-domain/articles';
import { getTagDefinitions } from '@sshawn9/site-domain/tags';

function entry(id: string, tags: string[]): ResolvableArticleEntry {
  return {
    id,
    data: { publishedAt: new Date('2024-01-01T00:00:00Z'), tags, projects: [], draft: false },
  };
}

describe('tag slug collision', () => {
  it('rejects ambiguous generated slugs instead of publishing unstable routes', () => {
    const articles = resolveArticles(
      [entry('cpp/index', ['C++']), entry('csharp/index', ['C#'])],
      'en',
    );
    expect(() => getTagDefinitions(articles)).toThrow('resolve to the same slug');
  });
});
