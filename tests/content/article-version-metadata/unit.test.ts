import { describe, expect, it } from 'vitest';
import {
  getArticleProjectIds,
  getArticleTags,
  resolveArticles,
  type ResolvableArticleEntry,
} from '@sshawn9/site-domain/articles';

function entry(id: string, tags: string[] = [], projects: string[] = []): ResolvableArticleEntry {
  return {
    id,
    data: {
      publishedAt: new Date('2024-01-01T00:00:00Z'),
      tags,
      projects: projects.map((id) => ({ id })),
      draft: false,
    },
  };
}

describe('article version metadata', () => {
  it('orders versions and derives unique memberships from the latest version only', () => {
    const [article] = resolveArticles(
      [
        entry(
          'guide/v2/index',
          ['Current', 'Shared', 'Current'],
          ['current-project', 'shared-project', 'current-project'],
        ),
        entry('guide/v1/index', ['Legacy', 'Shared'], ['legacy-project']),
      ],
      'en',
    );
    expect(article.versions.map(({ number }) => number)).toEqual([1, 2]);
    expect(article.current.number).toBe(2);
    expect(article.isVersioned).toBe(true);
    expect(getArticleTags(article)).toEqual(['Current', 'Shared']);
    expect(getArticleProjectIds(article)).toEqual(['current-project', 'shared-project']);
  });
});
