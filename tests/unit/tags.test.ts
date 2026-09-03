import { describe, expect, it } from 'vitest';
import { resolveArticles, type ResolvableArticleEntry } from '@sshawn9/site-domain/articles';
import { getArticlesForTag, getTagDefinitions, getTagSlug } from '@sshawn9/site-domain/tags';

function entry(id: string, tags: string[]): ResolvableArticleEntry {
  return {
    id,
    data: {
      publishedAt: new Date('2024-01-01T00:00:00Z'),
      tags,
      projects: [],
      draft: false,
    },
  };
}

describe('tag routes', () => {
  it('creates URL-safe tag slugs with the maintained slugger', () => {
    expect(getTagSlug('Control Systems')).toBe('control-systems');
  });

  it('counts each article once and uses only its latest version', () => {
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
    expect(getArticlesForTag(articles, 'Control Systems').map((article) => article.id)).toEqual([
      'guide',
      'notes',
    ]);
  });

  it('rejects ambiguous generated slugs instead of publishing unstable routes', () => {
    const articles = resolveArticles(
      [entry('cpp/index', ['C++']), entry('csharp/index', ['C#'])],
      'en',
    );

    expect(() => getTagDefinitions(articles)).toThrow('resolve to the same slug');
  });
});
