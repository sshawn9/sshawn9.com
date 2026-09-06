import { describe, expect, it } from 'vitest';
import { resolveArticles, type ResolvableArticleEntry } from '@sshawn9/site-domain/articles';
import { getArticlesForTag, getTagDefinitions } from '@sshawn9/site-domain/tags';

function entry(id: string, tags: string[]): ResolvableArticleEntry {
  return {
    id,
    data: { publishedAt: new Date('2024-01-01T00:00:00Z'), tags, projects: [], draft: false },
  };
}

describe('tag article index', () => {
  it('counts each article once and derives tags from its latest version only', () => {
    const articles = resolveArticles(
      [
        entry('guide/v2/index', ['Control Systems', 'Control Systems']),
        entry('guide/v1/index', ['Legacy']),
        entry('notes/index', ['Control Systems', 'Robotics']),
      ],
      'en',
    );
    expect(getTagDefinitions(articles)).toEqual([
      { name: 'Control Systems', slug: 'control-systems', count: 2 },
      { name: 'Robotics', slug: 'robotics', count: 1 },
    ]);
    expect(getArticlesForTag(articles, 'Control Systems').map(({ id }) => id)).toEqual([
      'guide',
      'notes',
    ]);
  });
});
